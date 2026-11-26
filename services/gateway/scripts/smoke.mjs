// node scripts/smoke.mjs  (needs GATEWAY_URL and GATEWAY_TEST_KEY in the environment)
const base = process.env.GATEWAY_URL || 'http://localhost:3010';
const key = process.env.GATEWAY_TEST_KEY;
if (!key) { console.error('Set GATEWAY_TEST_KEY'); process.exit(1); }
const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) }); return [r.status, await r.json()]; };
console.log('health', (await (await fetch(base + '/health')).json()).status);
const [s, pay] = await call('POST', '/api/payments', { amount_cents: 12500, currency: 'EGP', card: { number: '4242424242424242', cvv: '123', exp_month: '12', exp_year: '2030' } });
console.log('create', s, pay.intent.status, pay.active_attempt.connector);
const [rs, rf] = await call('POST', `/api/payments/${pay.intent.id}/refund`, {});
console.log('refund', rs, rf.refund.refund_status);
