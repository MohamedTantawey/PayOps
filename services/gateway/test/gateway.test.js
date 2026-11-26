import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { createApp } from '../src/server.js';

const TEST_KEY = 'sk_test_unit_aaaaaaaaaaaaaaaaaaaaaaaa';
let app, base, recv, received = [], recvStatus = 200, secret;

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(base + path, { method, headers: { Authorization: `Bearer ${TEST_KEY}`, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
};
const wait = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timeout'); };

before(async () => {
  app = await createApp({ env: { GATEWAY_TEST_KEY: TEST_KEY }, tickMs: 200 });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  recv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { received.push({ headers: req.headers, body: b }); res.writeHead(recvStatus); res.end('ok'); }); });
  await new Promise((r) => recv.listen(0, r));
  const ep = await call('POST', '/api/webhooks/endpoints', { target_url: `http://127.0.0.1:${recv.address().port}/hook` });
  assert.equal(ep.status, 201); secret = ep.json.endpoint.signing_secret; assert.match(secret, /^whsec_test_/);
});
after(async () => { recv.close(); await app.close(); });

const card = (number) => ({ number, cvv: '424', exp_month: '12', exp_year: '2030' });

test('auth errors', async () => {
  let r = await fetch(base + '/api/payments'); assert.equal(r.status, 401); assert.equal((await r.json()).error.code, 'missing_api_key');
  r = await fetch(base + '/api/payments', { headers: { 'x-api-key': 'bad' } }); assert.equal((await r.json()).error.code, 'invalid_api_key_format');
  r = await fetch(base + '/api/payments', { headers: { 'x-api-key': 'sk_test_nope' } }); assert.equal((await r.json()).error.code, 'invalid_api_key');
  r = await call('GET', '/api/payments', null, { 'x-payops-mode': 'live' }); assert.equal(r.status, 403); assert.equal(r.json.error.code, 'environment_mode_mismatch');
  r = await call('GET', '/nope'); assert.equal(r.status, 404); assert.equal(r.json.error.code, 'route_not_found');
});

test('create + auto capture + invoice + webhook signature', async () => {
  const r = await call('POST', '/api/payments', { amount_cents: 12500, currency: 'egp', card: card('4242424242424242'), metadata: { order_id: 'o1' } });
  assert.equal(r.status, 201); assert.equal(r.json.intent.status, 'succeeded'); assert.equal(r.json.intent.currency, 'EGP');
  assert.equal(r.json.active_attempt.connector, 'mock_stripe'); assert.equal(r.json.active_attempt.status, 'charged');
  assert.equal(r.json.routing_summary.failover_triggered, false); assert.equal(r.json.invoice.status, 'pending');
  assert.ok(!JSON.stringify(r.json).includes('4242424242424242'));
  const hook = await wait(() => received.find((x) => x.headers['x-payops-event'] === 'payment.succeeded' && JSON.parse(x.body).data.intent_id === r.json.intent.id));
  const ts = hook.headers['x-payops-timestamp'];
  const expect = createHmac('sha256', secret).update(`${ts}.${hook.body}`).digest('hex');
  assert.equal(hook.headers['x-payops-signature'], `t=${ts},v1=${expect}`);
  assert.equal(JSON.parse(hook.body).data.metadata.order_id, 'o1');
  const got = await call('GET', `/api/payments/${r.json.intent.id}`);
  assert.equal(got.json.attempts.length, 1);
  await wait(async () => (await call('GET', `/api/payments/${r.json.intent.id}`)) && true);
});

test('validation', async () => {
  for (const a of [0, -5, 1.5, '100', null, undefined]) { const r = await call('POST', '/api/payments', { amount_cents: a }); assert.equal(r.json.error.code, 'invalid_amount'); }
  assert.equal((await call('POST', '/api/payments', { amount_cents: 100, confirm: true })).json.error.code, 'missing_payment_method');
  const r = await call('POST', '/api/payments', { amount_cents: 100, confirm: false }); assert.equal(r.json.intent.status, 'requires_payment_method');
  assert.equal((await call('POST', '/api/payments', { amount_cents: 100, vault_token: 'vault_tok_test_nope' })).status, 400);
  assert.equal((await call('POST', '/api/payments/tokenize', { card: card('1234567890123456') })).json.error.code, 'invalid_card');
});

test('tokenize, vault token reuse, confirm', async () => {
  const t = await call('POST', '/api/payments/tokenize', { card: card('4242424242424242') });
  assert.equal(t.status, 201); assert.equal(t.json.last4, '4242'); assert.equal(t.json.card_network, 'visa');
  const c = await call('POST', '/api/payments', { amount_cents: 500, vault_token: t.json.token, confirm: false });
  assert.equal(c.json.intent.status, 'requires_confirmation');
  const ok = await call('POST', `/api/payments/${c.json.intent.id}/confirm`, {});
  assert.equal(ok.status, 200); assert.equal(ok.json.intent.status, 'succeeded');
  assert.equal((await call('POST', `/api/payments/${c.json.intent.id}/confirm`, {})).json.error.code, 'payment_intent_locked');
});

test('declines do not failover; connector outage fails over; total outage fails', async () => {
  let r = await call('POST', '/api/payments', { amount_cents: 700, card: card('4000000000000002') });
  assert.equal(r.status, 201); assert.equal(r.json.intent.status, 'failed'); assert.equal(r.json.active_attempt.error_code, 'card_declined'); assert.equal(r.json.attempts.length, 1);
  r = await call('POST', '/api/payments', { amount_cents: 700, card: card('4000000000000341') });
  assert.equal(r.json.intent.status, 'succeeded'); assert.equal(r.json.routing_summary.failover_triggered, true); assert.equal(r.json.active_attempt.connector, 'mock_paymob'); assert.equal(r.json.attempts.length, 2);
  r = await call('POST', '/api/payments', { amount_cents: 700, card: card('4000000000000259') });
  assert.equal(r.json.intent.status, 'failed'); assert.equal(r.json.attempts.length, 2);
  await wait(() => received.find((x) => x.headers['x-payops-event'] === 'payment.failed'));
  // failed intent can be retried with a good card
  const retry = await call('POST', `/api/payments/${r.json.intent.id}/confirm`, { card: card('4242424242424242') });
  assert.equal(retry.json.intent.status, 'succeeded'); assert.equal(retry.json.intent.attempt_count, 3);
});

test('manual capture, partial capture, cancel', async () => {
  const r = await call('POST', '/api/payments', { amount_cents: 1000, capture_method: 'manual', card: card('4242424242424242') });
  assert.equal(r.json.intent.status, 'requires_capture'); assert.equal(r.json.active_attempt.status, 'authorized');
  assert.equal((await call('POST', `/api/payments/${r.json.intent.id}/capture`, { amount_cents: 5000 })).json.error.code, 'invalid_amount');
  const cap = await call('POST', `/api/payments/${r.json.intent.id}/capture`, { amount_cents: 600 });
  assert.equal(cap.status, 200); assert.equal(cap.json.intent.status, 'succeeded'); assert.equal(cap.json.intent.captured_amount_cents, 600);
  assert.equal((await call('POST', `/api/payments/${r.json.intent.id}/capture`, {})).json.error.code, 'invalid_capture_state');
  const m = await call('POST', '/api/payments', { amount_cents: 1000, capture_method: 'manual', card: card('4242424242424242') });
  const cx = await call('POST', `/api/payments/${m.json.intent.id}/cancel`, {}); assert.equal(cx.json.intent.status, 'canceled');
});

test('refunds: full default, partial, over-refund, wrong state, failure, webhook', async () => {
  const p = await call('POST', '/api/payments', { amount_cents: 1000, card: card('4242424242424242'), metadata: { order_id: 'o2' } });
  const id = p.json.intent.id;
  const part = await call('POST', `/api/payments/${id}/refund`, { amount_cents: 400 });
  assert.equal(part.status, 201); assert.equal(part.json.refund.refund_status, 'succeeded'); assert.equal(part.json.refund.amount_cents, 400); assert.match(part.json.refund.connector_refund_id, /^mock_stripe_re_/);
  assert.equal((await call('POST', `/api/payments/${id}/refund`, { amount_cents: 700 })).json.error.code, 'refund_exceeds_captured');
  const rest = await call('POST', `/api/payments/${id}/refund`, {}); assert.equal(rest.json.refund.amount_cents, 600);
  assert.equal((await call('POST', `/api/payments/${id}/refund`, {})).status, 409);
  await wait(() => received.find((x) => x.headers['x-payops-event'] === 'refund.succeeded' && JSON.parse(x.body).data.metadata?.order_id === 'o2'));
  const nf = await call('POST', '/api/payments', { amount_cents: 100, confirm: false });
  assert.equal((await call('POST', `/api/payments/${nf.json.intent.id}/refund`, {})).json.error.code, 'invalid_refund_state');
  const bad = await call('POST', '/api/payments', { amount_cents: 100, card: card('4000000000000077') });
  const f = await call('POST', `/api/payments/${bad.json.intent.id}/refund`, {}); assert.equal(f.status, 502); assert.equal(f.json.refund.refund_status, 'failed');
  const after = await call('GET', `/api/payments/${bad.json.intent.id}`); assert.equal(after.json.intent.amount_refunded_cents, 0);
});

test('concurrent refunds cannot exceed captured amount', async () => {
  const p = await call('POST', '/api/payments', { amount_cents: 1000, card: card('4242424242424242') });
  const rs = await Promise.all([1, 2, 3, 4].map(() => call('POST', `/api/payments/${p.json.intent.id}/refund`, { amount_cents: 400 })));
  assert.equal(rs.filter((r) => r.status === 201).length, 2);
});

test('idempotency: replay, conflict on different body, concurrency', async () => {
  const h = { 'Idempotency-Key': 'k-1' };
  const a = await call('POST', '/api/payments', { amount_cents: 321, card: card('4242424242424242') }, h);
  const b = await call('POST', '/api/payments', { amount_cents: 321, card: card('4242424242424242') }, h);
  assert.equal(b.headers.get('x-payops-idempotent-replay'), 'true'); assert.equal(b.json.intent.id, a.json.intent.id);
  const c = await call('POST', '/api/payments', { amount_cents: 999, card: card('4242424242424242') }, h); assert.equal(c.status, 422);
  const rs = await Promise.all([1, 2, 3].map(() => call('POST', '/api/payments', { amount_cents: 77, card: card('4242424242424242') }, { 'Idempotency-Key': 'k-par' })));
  const okIds = new Set(rs.filter((r) => r.status === 201).map((r) => r.json.intent.id));
  assert.equal(okIds.size, 1);
  assert.ok(rs.every((r) => r.status === 201 || r.status === 409));
});

test('webhook failure is recorded, auto-retried, and replayable', async () => {
  recvStatus = 500;
  const p = await call('POST', '/api/payments', { amount_cents: 55, card: card('4242424242424242'), metadata: { order_id: 'o3' } });
  const d = await wait(async () => (await call('GET', '/api/webhooks/deliveries?limit=100')).json.items.find((x) => x.status === 'failed' && x.attempts >= 1 && received.some((r) => r.body.includes(p.json.intent.id))));
  assert.equal(d.response_status, 500);
  recvStatus = 200;
  const rp = await call('POST', `/api/webhooks/deliveries/${d.id}/replay`, {}); assert.equal(rp.json.delivery.status, 'replaying');
  await wait(async () => (await call('GET', '/api/webhooks/deliveries?limit=100')).json.items.find((x) => x.id === d.id && x.status === 'success'));
  const t = await call('POST', '/api/webhooks/test', { event_type: 'custom.event', payload: { a: 1 } }); assert.equal(t.status, 202);
});

test('hosted pay page', async () => {
  const p = await call('POST', '/api/payments', { amount_cents: 2500, currency: 'EGP', confirm: false, return_url: 'http://localhost:3000/checkout/success?order=x', metadata: { order_id: 'o4' } });
  const path = p.json.intent.pay_path;
  assert.ok(path.startsWith('/pay/'));
  let r = await fetch(base + path); const html = await r.text(); assert.equal(r.status, 200); assert.ok(html.includes('25.00 EGP'));
  assert.equal((await fetch(base + `/pay/${p.json.intent.id}?cs=wrong`)).status, 404);
  const cs = p.json.intent.client_secret;
  const post = (num) => fetch(base + `/pay/${p.json.intent.id}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ cs, number: num, exp_month: '12', exp_year: '2030', cvv: '123' }) });
  r = await post('4000000000000002'); assert.equal(r.status, 402);
  r = await post('4242424242424242'); assert.equal(r.status, 303);
  const loc = new URL(r.headers.get('location')); assert.equal(loc.searchParams.get('status'), 'succeeded'); assert.equal(loc.searchParams.get('order'), 'x');
  assert.equal((await call('GET', `/api/payments/${p.json.intent.id}`)).json.intent.status, 'succeeded');
  assert.ok(!(await call('GET', `/api/payments/${p.json.intent.id}`)).text?.includes?.(cs));
  const g = (await call('GET', `/api/payments/${p.json.intent.id}`)).json; assert.equal(g.intent.client_secret, undefined);
});

test('invoices get issued by worker', async () => {
  const { rows } = await app.db.query(`SELECT count(*)::int c FROM invoices WHERE status='pending'`);
  assert.equal(rows[0].c >= 0, true);
  await wait(async () => (await app.db.query(`SELECT count(*)::int c FROM invoices WHERE status='issued'`)).rows[0].c > 0);
});
