import { createHmac } from 'node:crypto';
import { ApiError, uuid, rand, isHttpUrl, iso, inc, log } from './util.js';

export const EVENT_TYPES = ['payment.succeeded', 'payment.failed', 'refund.succeeded'];
const BACKOFF_MS = [5000, 30000, 120000, 600000];
const MAX_ATTEMPTS = 5;

export const sign = (secret, timestamp, body) => `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

const endpointOut = (r, withSecret) => ({
  id: r.id, merchant_id: r.merchant_id, env_mode: r.env_mode, target_url: r.target_url,
  ...(withSecret ? { signing_secret: r.signing_secret } : {}), events: r.events, active: r.active, created_at: iso(r.created_at),
});
const deliveryOut = (r) => ({
  id: r.id, endpoint_id: r.endpoint_id, event_type: r.event_type, status: r.status, attempts: r.attempts,
  response_status: r.response_status, error: r.error, last_attempt_at: iso(r.last_attempt_at), created_at: iso(r.created_at),
});

export async function registerEndpoint(db, auth, body) {
  const url = body?.target_url;
  if (typeof url !== 'string' || !isHttpUrl(url)) throw new ApiError(400, 'invalid_target_url', 'target_url must start with http:// or https://.');
  const events = body.events ?? EVENT_TYPES;
  if (!Array.isArray(events) || !events.length || events.some((e) => typeof e !== 'string')) throw new ApiError(400, 'invalid_events', 'events must be a non-empty array of event type strings.');
  const secret = `whsec_${auth.env}_${rand(24)}`;
  const { rows } = await db.query(
    'INSERT INTO webhook_endpoints (id, merchant_id, env_mode, target_url, signing_secret, events) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [uuid(), auth.merchant_id, auth.env, url, secret, events]);
  return { endpoint: endpointOut(rows[0], true) };
}
export async function listEndpoints(db, auth) {
  const { rows } = await db.query('SELECT * FROM webhook_endpoints WHERE merchant_id=$1 AND env_mode=$2 ORDER BY created_at DESC', [auth.merchant_id, auth.env]);
  return { count: rows.length, items: rows.map((r) => endpointOut(r, false)) };
}

// Queue one delivery per matching endpoint. Body is fixed at queue time so retries re-send identical bytes.
export async function emit(q, scope, eventType, data) {
  const { rows } = await q.query(
    'SELECT * FROM webhook_endpoints WHERE merchant_id=$1 AND env_mode=$2 AND active AND $3 = ANY(events)', [scope.merchant_id, scope.env_mode, eventType]);
  let first = null;
  for (const ep of rows) {
    const id = uuid();
    const body = JSON.stringify({ id, event_type: eventType, created_at: new Date().toISOString(), data });
    await q.query(
      `INSERT INTO webhook_deliveries (id, endpoint_id, merchant_id, env_mode, event_type, body, status, next_attempt_at) VALUES ($1,$2,$3,$4,$5,$6,'pending', now())`,
      [id, ep.id, scope.merchant_id, scope.env_mode, eventType, body]);
    first ||= id;
  }
  return first;
}

export async function listDeliveries(db, auth, limit) {
  const l = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
  const { rows } = await db.query('SELECT * FROM webhook_deliveries WHERE merchant_id=$1 AND env_mode=$2 ORDER BY created_at DESC LIMIT $3', [auth.merchant_id, auth.env, l]);
  return { count: rows.length, items: rows.map(deliveryOut) };
}
export async function replay(db, auth, id) {
  const { rows } = await db.query(
    `UPDATE webhook_deliveries SET status='replaying', attempts=0, next_attempt_at=now() WHERE id::text=$1 AND merchant_id=$2 AND env_mode=$3 RETURNING *`, [id, auth.merchant_id, auth.env]);
  if (!rows[0]) throw new ApiError(404, 'not_found', 'Delivery not found.');
  return { message: 'Webhook replay queued.', delivery: deliveryOut(rows[0]) };
}
export async function queueTest(db, auth, body) {
  const type = typeof body?.event_type === 'string' && body.event_type ? body.event_type : 'payment.succeeded';
  const payload = body?.payload && typeof body.payload === 'object' ? body.payload : { test: true, timestamp: new Date().toISOString() };
  const jobId = await emit(db, { merchant_id: auth.merchant_id, env_mode: auth.env }, type, payload);
  return { queued: true, job_id: jobId };
}

// Dispatcher: claims due deliveries, POSTs with a 5s timeout, records the result. Failed deliveries retry
// automatically with backoff (5s, 30s, 2m, 10m) up to 5 attempts; replay resets the counter.
export async function dispatchDue(db) {
  const { rows } = await db.query(
    `UPDATE webhook_deliveries SET next_attempt_at = now() + interval '30 seconds'
     WHERE id IN (SELECT id FROM webhook_deliveries WHERE next_attempt_at <= now() AND (status IN ('pending','replaying') OR (status='failed' AND attempts < ${MAX_ATTEMPTS})) ORDER BY next_attempt_at LIMIT 20)
     RETURNING *`);
  await Promise.all(rows.map(async (d) => {
    const ep = (await db.query('SELECT * FROM webhook_endpoints WHERE id=$1', [d.endpoint_id])).rows[0];
    if (!ep) { await db.query(`UPDATE webhook_deliveries SET status='failed', error='endpoint_deleted', next_attempt_at=NULL WHERE id=$1`, [d.id]); return; }
    const ts = Math.floor(Date.now() / 1000);
    let status = null, error = null;
    try {
      const res = await fetch(ep.target_url, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000), body: d.body,
        headers: {
          'Content-Type': 'application/json', 'User-Agent': 'PayOps-Webhook-Dispatcher/1.0', 'X-PayOps-Event': d.event_type,
          'X-PayOps-Delivery-Id': d.id, 'X-PayOps-Timestamp': String(ts), 'X-PayOps-Signature': sign(ep.signing_secret, ts, d.body),
        },
      });
      status = res.status;
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
    } catch (e) { error = e.name === 'TimeoutError' ? 'timeout' : `network_error: ${e.cause?.code || e.message}`.slice(0, 200); }
    const attempts = d.attempts + 1;
    if (!error) {
      await db.query(`UPDATE webhook_deliveries SET status='success', attempts=$2, response_status=$3, error=NULL, next_attempt_at=NULL, last_attempt_at=now() WHERE id=$1`, [d.id, attempts, status]);
      inc('webhooks', 'success');
    } else {
      const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
      await db.query(
        `UPDATE webhook_deliveries SET status='failed', attempts=$2, response_status=$3, error=$4, last_attempt_at=now(),
         next_attempt_at = CASE WHEN $2 < ${MAX_ATTEMPTS} THEN now() + ($5 || ' milliseconds')::interval ELSE NULL END WHERE id=$1`,
        [d.id, attempts, status, error, String(wait)]);
      inc('webhooks', 'failed');
      log({ evt: 'webhook_failed', delivery: d.id, attempts, error });
    }
  }));
  return rows.length;
}
