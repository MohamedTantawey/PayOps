import { ApiError, sha256 } from './util.js';

// Idempotency-Key support, scoped by environment + merchant + route + key. Cached 24h, 5xx never cached.
// Same key + different request body -> 422 idempotency_key_reuse. Concurrent reuse -> 409 idempotency_conflict.
export async function withIdempotency(db, ctx, handler) {
  const key = ctx.req.headers['idempotency-key'];
  if (!key) return handler();
  if (String(key).length > 255) throw new ApiError(400, 'invalid_idempotency_key', 'Idempotency-Key is too long.');
  const scope = [ctx.auth.env, ctx.auth.merchant_id, ctx.req.method, ctx.path, key].join('|');
  const fp = sha256(ctx.rawBody || '');
  for (let attempt = 0; attempt < 2; attempt++) {
    const ins = await db.query(
      `INSERT INTO idempotency_keys (scope, fingerprint, state, expires_at) VALUES ($1,$2,'in_progress', now() + interval '24 hours')
       ON CONFLICT (scope) DO NOTHING RETURNING scope`, [scope, fp]);
    if (ins.rows.length) {
      let out;
      try { out = await handler(); } catch (e) { await db.query('DELETE FROM idempotency_keys WHERE scope=$1', [scope]); throw e; }
      if (out.status >= 500) await db.query('DELETE FROM idempotency_keys WHERE scope=$1', [scope]);
      else await db.query(`UPDATE idempotency_keys SET state='done', response_status=$2, response_body=$3::jsonb WHERE scope=$1`, [scope, out.status, JSON.stringify(out.body)]);
      return out;
    }
    const { rows } = await db.query('SELECT * FROM idempotency_keys WHERE scope=$1', [scope]);
    const row = rows[0];
    if (!row) continue;
    if (new Date(row.expires_at) < new Date()) { await db.query('DELETE FROM idempotency_keys WHERE scope=$1', [scope]); continue; }
    if (row.fingerprint !== fp) throw new ApiError(422, 'idempotency_key_reuse', 'This Idempotency-Key was already used with a different request.');
    if (row.state === 'in_progress') throw new ApiError(409, 'idempotency_conflict', 'Another request with the same Idempotency-Key is currently in progress.');
    return { status: row.response_status, body: row.response_body, headers: { 'X-PayOps-Idempotent-Replay': 'true' } };
  }
  throw new ApiError(409, 'idempotency_conflict', 'Another request with the same Idempotency-Key is currently in progress.');
}
