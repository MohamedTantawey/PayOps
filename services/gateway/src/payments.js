import { ApiError, uuid, rand, iso, luhn, cardNetwork, inc } from './util.js';
import { CONNECTORS, ROUTING, behaviorFor, breakerOpen, breakerRecord } from './connectors.js';
import { emit } from './webhooks.js';
import { isHttpUrl } from './util.js';

const MAX_AMOUNT = 2_000_000_000;

const intentOut = (r, secret = false) => ({
  id: r.id, merchant_id: r.merchant_id, env_mode: r.env_mode, amount_cents: r.amount_cents, currency: r.currency,
  capture_method: r.capture_method, status: r.status, active_attempt_id: r.active_attempt_id, attempt_count: r.attempt_count,
  customer_email: r.customer_email, description: r.description, metadata: r.metadata,
  captured_amount_cents: r.captured_amount_cents, amount_refunded_cents: r.amount_refunded_cents,
  created_at: iso(r.created_at), updated_at: iso(r.updated_at),
  ...(secret ? { client_secret: r.client_secret, pay_path: `/pay/${r.id}?cs=${r.client_secret}` } : {}),
});
const attemptOut = (r) => ({
  id: r.id, intent_id: r.intent_id, env_mode: r.env_mode, merchant_id: r.merchant_id, connector: r.connector, attempt_index: r.attempt_index,
  status: r.status, amount_cents: r.amount_cents, currency: r.currency, connector_transaction_id: r.connector_transaction_id,
  error_code: r.error_code, error_message: r.error_message, vault_token: r.vault_token, metadata: r.metadata,
  created_at: iso(r.created_at), updated_at: iso(r.updated_at),
});
const refundOut = (r) => ({
  id: r.id, intent_id: r.intent_id, attempt_id: r.attempt_id, env_mode: r.env_mode, merchant_id: r.merchant_id, connector: r.connector,
  connector_transaction_id: r.connector_transaction_id, connector_refund_id: r.connector_refund_id, amount_cents: r.amount_cents,
  currency: r.currency, refund_status: r.refund_status, reason: r.reason, created_at: iso(r.created_at),
});
const invoiceOut = (r) => r && ({ id: r.id, intent_id: r.intent_id, status: r.status, number: r.number, amount_cents: r.amount_cents, currency: r.currency, created_at: iso(r.created_at), issued_at: iso(r.issued_at) });

export function validCard(card) {
  const num = String(card?.number ?? '').replace(/[\s-]/g, '');
  const month = parseInt(card?.exp_month, 10), year = parseInt(card?.exp_year, 10), cvv = String(card?.cvv ?? '');
  if (!/^\d{12,19}$/.test(num) || !luhn(num)) throw new ApiError(400, 'invalid_card', 'Card number is invalid.');
  if (!(month >= 1 && month <= 12) || !(year >= 2000)) throw new ApiError(400, 'invalid_card', 'Card expiry is invalid.');
  if (!/^\d{3,4}$/.test(cvv)) throw new ApiError(400, 'invalid_card', 'Card CVV is invalid.');
  return { num, month, year };
}

// Tokenize: only last4, network, expiry and the simulated behaviour are kept. PAN and CVV are discarded.
export async function tokenize(db, auth, card) {
  const { num, month, year } = validCard(card);
  const token = `vault_tok_${auth.env}_${rand(16)}`;
  const { rows } = await db.query(
    'INSERT INTO vault_tokens (token, merchant_id, env_mode, last4, card_network, exp_month, exp_year, behavior) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [token, auth.merchant_id, auth.env, num.slice(-4), cardNetwork(num), String(month), String(year), behaviorFor(num)]);
  const r = rows[0];
  return { object: 'vault_token', token, merchant_id: auth.merchant_id, env_mode: auth.env, last4: r.last4, card_network: r.card_network, created_at: iso(r.created_at) };
}

async function resolvePm(db, auth, body) {
  if (body.card) return (await tokenize(db, auth, body.card)).token;
  if (body.vault_token) {
    const { rows } = await db.query('SELECT token FROM vault_tokens WHERE token=$1 AND merchant_id=$2 AND env_mode=$3', [String(body.vault_token), auth.merchant_id, auth.env]);
    if (!rows[0]) throw new ApiError(400, 'invalid_vault_token', 'Unknown vault_token.');
    return rows[0].token;
  }
  return null;
}

async function loadIntent(db, auth, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new ApiError(404, 'not_found', 'Payment not found.');
  const { rows } = await db.query('SELECT * FROM payment_intents WHERE id=$1 AND merchant_id=$2 AND env_mode=$3', [id, auth.merchant_id, auth.env]);
  if (!rows[0]) throw new ApiError(404, 'not_found', 'Payment not found.');
  return rows[0];
}

export async function createPayment(db, auth, body = {}) {
  const amount = body.amount_cents;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) throw new ApiError(400, 'invalid_amount', 'amount_cents must be a positive integer.');
  const currency = String(body.currency ?? 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ApiError(400, 'invalid_currency', 'currency must be a 3-letter code.');
  const capture = body.capture_method ?? 'automatic';
  if (!['automatic', 'manual'].includes(capture)) throw new ApiError(400, 'invalid_capture_method', 'capture_method must be automatic or manual.');
  const explicitConfirm = body.confirm === true;
  const confirm = body.confirm ?? true;
  if (typeof confirm !== 'boolean') throw new ApiError(400, 'invalid_request', 'confirm must be a boolean.');
  const metadata = body.metadata ?? {};
  if (typeof metadata !== 'object' || Array.isArray(metadata)) throw new ApiError(400, 'invalid_request', 'metadata must be an object.');
  for (const u of ['return_url', 'cancel_url']) if (body[u] != null && !(typeof body[u] === 'string' && isHttpUrl(body[u]))) throw new ApiError(400, 'invalid_request', `${u} must be an http(s) URL.`);
  const pm = await resolvePm(db, auth, body);
  if (explicitConfirm && !pm) throw new ApiError(400, 'missing_payment_method', 'confirm:true requires card or vault_token.');
  const id = uuid();
  const { rows } = await db.query(
    `INSERT INTO payment_intents (id, merchant_id, env_mode, amount_cents, currency, capture_method, status, customer_email, description, metadata, auto_invoice, payment_method_token, client_secret, return_url, cancel_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15) RETURNING *`,
    [id, auth.merchant_id, auth.env, amount, currency, capture, pm ? 'requires_confirmation' : 'requires_payment_method', body.customer_email ?? null,
      body.description ?? null, JSON.stringify(metadata), body.auto_invoice ?? true, pm, `cs_${rand(20)}`, body.return_url ?? null, body.cancel_url ?? null]);
  inc('payments', 'created');
  if (confirm && pm) return { status: 201, body: await execute(db, auth, rows[0], pm, true) };
  return { status: 201, body: { intent: intentOut(rows[0], true), attempts: [] } };
}

export async function confirmPayment(db, auth, id, body = {}) {
  const intent = await loadIntent(db, auth, id);
  const pm = (await resolvePm(db, auth, body)) ?? intent.payment_method_token;
  if (!pm) throw new ApiError(400, 'missing_payment_method', 'Provide card or vault_token.');
  return { status: 200, body: await execute(db, auth, intent, pm, false) };
}

async function execute(db, auth, intent, pm, withSecret) {
  // Atomic lock: only one execution can move the intent into "processing".
  const lock = await db.query(
    `UPDATE payment_intents SET status='processing', payment_method_token=$4, updated_at=now()
     WHERE id=$1 AND merchant_id=$2 AND env_mode=$3 AND status IN ('requires_payment_method','requires_confirmation','failed') RETURNING *`,
    [intent.id, auth.merchant_id, auth.env, pm]);
  if (!lock.rows[0]) throw new ApiError(409, 'payment_intent_locked', 'Another execution is active or the payment can no longer be confirmed.');
  const cur = lock.rows[0];
  const token = (await db.query('SELECT * FROM vault_tokens WHERE token=$1', [pm])).rows[0];
  const behavior = token?.behavior || 'success';
  const attempts = [];
  const skipped = [], evaluated = [];
  let success = null, idx = cur.attempt_count, failover = false;
  try {
    for (const name of ROUTING.order) {
      if (!CONNECTORS[name]) throw new ApiError(400, 'unsupported_connector', `Unknown connector ${name}.`);
      if (breakerOpen(name)) { skipped.push(name); continue; }
      if (evaluated.length) failover = true;
      evaluated.push(name);
      idx += 1;
      const attemptId = uuid();
      await db.query(
        `INSERT INTO payment_attempts (id, intent_id, env_mode, merchant_id, connector, attempt_index, status, amount_cents, currency, vault_token, metadata) VALUES ($1,$2,$3,$4,$5,$6,'started',$7,$8,$9,$10::jsonb)`,
        [attemptId, cur.id, auth.env, auth.merchant_id, name, idx, cur.amount_cents, cur.currency, pm, JSON.stringify({ last4: token?.last4 })]);
      const res = await CONNECTORS[name].charge({ behavior, capture_method: cur.capture_method, amount_cents: cur.amount_cents, currency: cur.currency });
      inc('connector', `${name}_${res.ok ? 'ok' : res.type}`);
      if (res.type === 'error') breakerRecord(name, false); else breakerRecord(name, true);
      const { rows } = await db.query(
        `UPDATE payment_attempts SET status=$2, connector_transaction_id=$3, error_code=$4, error_message=$5, updated_at=now() WHERE id=$1 RETURNING *`,
        [attemptId, res.ok ? res.status : 'failure', res.transaction_id ?? null, res.error_code ?? null, res.error_message ?? null]);
      attempts.push(rows[0]);
      if (res.ok) { success = rows[0]; break; }
      if (res.type === 'decline') break; // hard decline: never retry on another connector
    }
  } catch (e) {
    await db.query(`UPDATE payment_intents SET status='failed', updated_at=now() WHERE id=$1`, [cur.id]);
    throw e;
  }
  const status = success ? (cur.capture_method === 'manual' ? 'requires_capture' : 'succeeded') : 'failed';
  const active = success || attempts[attempts.length - 1] || null;
  const captured = status === 'succeeded' ? cur.amount_cents : 0;
  let invoice = null;
  const final = await db.tx(async (q) => {
    const up = await q.query(
      `UPDATE payment_intents SET status=$2, active_attempt_id=$3, attempt_count=$4, captured_amount_cents=$5, updated_at=now() WHERE id=$1 RETURNING *`,
      [cur.id, status, active?.id ?? null, idx, captured]);
    if (status === 'succeeded') {
      invoice = await maybeInvoice(q, up.rows[0]);
      await emit(q, { merchant_id: auth.merchant_id, env_mode: auth.env }, 'payment.succeeded', webhookData(up.rows[0], active, failover));
    } else if (status === 'failed') {
      await emit(q, { merchant_id: auth.merchant_id, env_mode: auth.env }, 'payment.failed', webhookData(up.rows[0], active, failover));
    }
    return up.rows[0];
  });
  inc('payments', status);
  return {
    intent: intentOut(final, withSecret), active_attempt: active && attemptOut(active), attempts: attempts.map(attemptOut),
    routing_summary: { algorithm: ROUTING.algorithm, type: ROUTING.type, evaluated_connectors: evaluated, skipped_open_circuits: skipped, failover_triggered: failover },
    invoice: invoiceOut(invoice),
  };
}

const webhookData = (i, a, failover) => ({
  intent_id: i.id, amount_cents: i.amount_cents, currency: i.currency, status: i.status, connector: a?.connector ?? null,
  attempt_count: i.attempt_count, failover_triggered: failover, metadata: i.metadata,
});

async function maybeInvoice(q, intent) {
  if (!intent.auto_invoice) return null;
  const { rows } = await q.query(
    `INSERT INTO invoices (id, intent_id, merchant_id, env_mode, status, amount_cents, currency) VALUES ($1,$2,$3,$4,'pending',$5,$6) RETURNING *`,
    [uuid(), intent.id, intent.merchant_id, intent.env_mode, intent.captured_amount_cents || intent.amount_cents, intent.currency]);
  return rows[0];
}

export async function capturePayment(db, auth, id, body = {}) {
  const intent = await loadIntent(db, auth, id);
  const amount = body.amount_cents ?? intent.amount_cents;
  if (!Number.isInteger(amount) || amount <= 0 || amount > intent.amount_cents) throw new ApiError(400, 'invalid_amount', 'amount_cents must be a positive integer not above the authorized amount.');
  // Atomic transition prevents double capture.
  const lock = await db.query(`UPDATE payment_intents SET status='processing', updated_at=now() WHERE id=$1 AND status='requires_capture' RETURNING *`, [intent.id]);
  if (!lock.rows[0]) throw new ApiError(409, 'invalid_capture_state', 'Payment is not in requires_capture.');
  const attempt = (await db.query('SELECT * FROM payment_attempts WHERE id=$1', [intent.active_attempt_id])).rows[0];
  const res = await CONNECTORS[attempt.connector].capture({ transaction_id: attempt.connector_transaction_id, amount_cents: amount });
  if (!res.ok) {
    await db.query(`UPDATE payment_intents SET status='requires_capture', updated_at=now() WHERE id=$1`, [intent.id]);
    throw new ApiError(502, res.error_code || 'capture_failed', res.error_message || 'Capture failed.');
  }
  const out = await db.tx(async (q) => {
    await q.query(`UPDATE payment_attempts SET status='charged', updated_at=now() WHERE id=$1`, [attempt.id]);
    const up = (await q.query(`UPDATE payment_intents SET status='succeeded', captured_amount_cents=$2, updated_at=now() WHERE id=$1 RETURNING *`, [intent.id, amount])).rows[0];
    await maybeInvoice(q, up);
    await emit(q, { merchant_id: auth.merchant_id, env_mode: auth.env }, 'payment.succeeded', webhookData(up, attempt, false));
    return up;
  });
  const a = (await db.query('SELECT * FROM payment_attempts WHERE id=$1', [attempt.id])).rows[0];
  return { status: 200, body: { intent: intentOut(out), active_attempt: attemptOut(a) } };
}

export async function cancelPayment(db, auth, id) {
  const intent = await loadIntent(db, auth, id);
  const lock = await db.query(
    `UPDATE payment_intents SET status='canceled', updated_at=now() WHERE id=$1 AND status IN ('requires_payment_method','requires_confirmation','requires_capture','failed') RETURNING *`, [intent.id]);
  if (!lock.rows[0]) throw new ApiError(409, 'invalid_cancel_state', 'Only unpaid or authorized-only payments can be canceled.');
  if (intent.status === 'requires_capture') {
    const a = (await db.query('SELECT * FROM payment_attempts WHERE id=$1', [intent.active_attempt_id])).rows[0];
    await CONNECTORS[a.connector].void({ transaction_id: a.connector_transaction_id });
    await db.query(`UPDATE payment_attempts SET status='voided', updated_at=now() WHERE id=$1`, [a.id]);
  }
  return { status: 200, body: { intent: intentOut(lock.rows[0]) } };
}

export async function refundPayment(db, auth, id, body = {}) {
  const intent = await loadIntent(db, auth, id);
  if (intent.status !== 'succeeded') throw new ApiError(409, 'invalid_refund_state', 'Only succeeded payments can be refunded.');
  const remaining = intent.captured_amount_cents - intent.amount_refunded_cents;
  if (remaining <= 0) throw new ApiError(409, 'refund_exceeds_captured', 'Payment is already fully refunded.');
  const amount = body.amount_cents ?? remaining;
  if (!Number.isInteger(amount) || amount <= 0) throw new ApiError(400, 'invalid_amount', 'amount_cents must be a positive integer.');
  if (amount > remaining) throw new ApiError(409, 'refund_exceeds_captured', `Only ${remaining} cents remain refundable.`);
  const reason = typeof body.reason === 'string' && body.reason ? body.reason.slice(0, 200) : 'requested_by_customer';
  // Reserve the amount atomically so concurrent refunds cannot exceed the captured total.
  const hold = await db.query(
    `UPDATE payment_intents SET amount_refunded_cents = amount_refunded_cents + $2, updated_at=now() WHERE id=$1 AND status='succeeded' AND captured_amount_cents - amount_refunded_cents >= $2 RETURNING *`, [intent.id, amount]);
  if (!hold.rows[0]) throw new ApiError(409, 'refund_exceeds_captured', 'Refund exceeds the refundable amount.');
  const attempt = (await db.query('SELECT * FROM payment_attempts WHERE id=$1', [intent.active_attempt_id])).rows[0];
  const token = (await db.query('SELECT behavior FROM vault_tokens WHERE token=$1', [attempt.vault_token])).rows[0];
  const res = await CONNECTORS[attempt.connector].refund({ transaction_id: attempt.connector_transaction_id, amount_cents: amount, behavior: token?.behavior });
  if (!res.ok) {
    await db.query('UPDATE payment_intents SET amount_refunded_cents = amount_refunded_cents - $2 WHERE id=$1', [intent.id, amount]);
    const { rows } = await db.query(
      `INSERT INTO refunds (id, intent_id, attempt_id, env_mode, merchant_id, connector, connector_transaction_id, amount_cents, currency, refund_status, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'failed',$10) RETURNING *`,
      [uuid(), intent.id, attempt.id, auth.env, auth.merchant_id, attempt.connector, attempt.connector_transaction_id, amount, intent.currency, reason]);
    return { status: 502, body: { refund: refundOut(rows[0]), error: { code: res.error_code, message: res.error_message } } };
  }
  const refund = await db.tx(async (q) => {
    const { rows } = await q.query(
      `INSERT INTO refunds (id, intent_id, attempt_id, env_mode, merchant_id, connector, connector_transaction_id, connector_refund_id, amount_cents, currency, refund_status, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'succeeded',$11) RETURNING *`,
      [uuid(), intent.id, attempt.id, auth.env, auth.merchant_id, attempt.connector, attempt.connector_transaction_id, res.refund_id, amount, intent.currency, reason]);
    await emit(q, { merchant_id: auth.merchant_id, env_mode: auth.env }, 'refund.succeeded', {
      refund_id: rows[0].id, intent_id: intent.id, amount_cents: amount, currency: intent.currency, connector: attempt.connector, metadata: intent.metadata });
    return rows[0];
  });
  inc('payments', 'refunded');
  return { status: 201, body: { refund: refundOut(refund) } };
}

export async function listPayments(db, auth, limit) {
  const l = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const { rows } = await db.query('SELECT * FROM payment_intents WHERE merchant_id=$1 AND env_mode=$2 ORDER BY created_at DESC LIMIT $3', [auth.merchant_id, auth.env, l]);
  return { mode: auth.env, count: rows.length, items: rows.map((r) => intentOut(r)) };
}
export async function getPayment(db, auth, id) {
  const intent = await loadIntent(db, auth, id);
  const attempts = (await db.query('SELECT * FROM payment_attempts WHERE intent_id=$1 ORDER BY attempt_index', [intent.id])).rows;
  const refunds = (await db.query('SELECT * FROM refunds WHERE intent_id=$1 ORDER BY created_at', [intent.id])).rows;
  return { intent: intentOut(intent), attempts: attempts.map(attemptOut), refunds: refunds.map(refundOut) };
}

// Used by the hosted pay page. Scope comes from the intent itself, authenticated by its client_secret.
export const _internal = { loadIntent, intentOut };
export async function issuePendingInvoices(db) {
  const { rows } = await db.query(`UPDATE invoices SET status='issued', issued_at=now(), number='INV-' || to_char(now(),'YYYYMM') || '-' || upper(substr(id::text,1,6)) WHERE status='pending' RETURNING id`);
  return rows.length;
}
