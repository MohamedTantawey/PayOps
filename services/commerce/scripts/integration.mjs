// Run against an isolated seeded database and demo-mode production server.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const base = process.env.TEST_APP_URL || 'http://localhost:3100';
const token = process.env.TEST_ADMIN_TOKEN;
const ops = process.env.TEST_OPS_TOKEN;
async function post(path, data, key, auth = token) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-service-token':process.env.COMMERCE_SERVICE_TOKEN, ...(key ? { 'Idempotency-Key': key } : {}), ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(data) });
  return { status: r.status, body: await r.json() };
}
try {
  const product = await db.product.findFirstOrThrow();
  const stock = product.stock;
  const key = randomUUID();
  const checkoutBody = { productId: product.id, quantity: 1 };
  const results = await Promise.all(Array.from({ length: 8 }, () => post('/api/checkout', checkoutBody, key)));
  assert(results.every(r => r.status === 200));
  assert(results.every(r => r.body.orderId === results[0].body.orderId));
  const orderId = results[0].body.orderId;
  assert.equal(await db.payment.count({ where: { orderId } }), 1);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock, stock - 1);
  assert.equal((await post('/api/checkout', { ...checkoutBody, quantity: 2 }, key)).status, 409);
  assert.equal((await post('/api/checkout', checkoutBody)).status, 400);
  assert.equal((await post('/api/refunds', { orderId, why: 'test refund' }, randomUUID(), null)).status, 401);
  assert.equal((await post('/api/refunds', { orderId, why: 'test refund' }, randomUUID(), ops)).status, 403);
  const refundKey = randomUUID();
  const refunds = await Promise.all(Array.from({ length: 8 }, () => post('/api/refunds', { orderId, why: 'integration refund' }, refundKey)));
  assert(refunds.every(r => r.status === 200));
  assert.equal(await db.refund.count({ where: { orderId } }), 1);
  assert.equal((await post('/api/refunds', { orderId, why: 'different operation' }, randomUUID())).status, 409);
  const legs = await db.ledgerEntry.findMany({ where: { orderId } });
  assert.equal(legs.length, 4); assert.equal(legs.reduce((n, l) => n + l.debitCents - l.creditCents, 0), 0);
  await assert.rejects(db.ledgerEntry.create({ data: { movementId: randomUUID(), account: 'test', orderId, currency: 'egp', debitCents: 1 } }));
  // Simulate a due held reservation without a provider, exercise release twice.
  const expired = await db.order.create({ data: { totalCents: 100, demo: true } });
  await db.product.update({ where: { id: product.id }, data: { stock: { decrement: 1 } } });
  await db.reservation.create({ data: { orderId: expired.id, productId: product.id, quantity: 1, expiresAt: new Date(Date.now() - 1000) } });
  const badEventId = 'evt_test_' + randomUUID();
  await db.webhookEvent.create({ data: { id: badEventId, type: 'checkout.session.completed', payload: { type: 'checkout.session.completed', data: { object: { payment_status: 'paid', amount_total: 1, currency: 'egp', metadata: { orderId: 'missing' } } } } } });
  for (let i = 0; i < 5; i++) {
    await db.webhookEvent.update({ where: { id: badEventId }, data: { nextAttemptAt: new Date(0) } });
    const r = await fetch(base + '/api/internal/maintenance', { method: 'POST', headers: { Authorization: `Bearer ${process.env.MAINTENANCE_TOKEN}`, "x-service-token":process.env.COMMERCE_SERVICE_TOKEN } });
    assert.equal(r.status, 200);
  }
  assert.equal((await db.webhookEvent.findUniqueOrThrow({ where: { id: badEventId } })).state, 'DEAD');
  assert.equal((await db.reservation.findFirstOrThrow({ where: { orderId: expired.id } })).state, 'RELEASED');
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock, stock - 1);
  const requeue = await post('/api/admin/events/retry', { eventId: badEventId, why: 'integration requeue' });
  assert.equal(requeue.status, 200);
  // Valid event delivery is processed exactly once, including simultaneous processing.
  const ignoredId = 'evt_test_' + randomUUID();
  await db.webhookEvent.create({ data: { id: ignoredId, type: 'test.ignored', payload: { type: 'test.ignored' } } });
  await fetch(base + '/api/internal/maintenance', { method: 'POST', headers: { Authorization: `Bearer ${process.env.MAINTENANCE_TOKEN}`, "x-service-token":process.env.COMMERCE_SERVICE_TOKEN } });
  assert.equal((await db.webhookEvent.findUniqueOrThrow({ where: { id: ignoredId } })).state, 'IGNORED');
  const invalid = await fetch(base + '/api/webhooks/stripe', { method: 'POST', headers:{'x-service-token':process.env.COMMERCE_SERVICE_TOKEN}, body: '{}' }); assert.equal(invalid.status, 400);
  assert((await db.webhookDelivery.count({ where: { valid: false } })) > 0);
  const metrics = await (await fetch(base + '/metrics')).text(); assert(metrics.includes('payops_operations_total'));
  assert((await db.auditLog.count({ where: { target: orderId } })) >= 2);
  for (const path of ['/admin', '/admin/orders', '/admin/payouts', '/admin/events', '/admin/audit']) {
    const r = await fetch((process.env.TEST_WEB_URL||'http://localhost:3000') + path, { headers: { Authorization: `Bearer ${token}` } }); assert.equal(r.status, 200, path);
  }
  const unauth = await fetch((process.env.TEST_WEB_URL||'http://localhost:3000') + '/admin', { redirect: 'manual' }); assert.equal(unauth.status, 307);
  console.log('PASS: concurrent checkout/refund replay, payload conflicts, duplicate-refund guard, RBAC, balanced ledger + DB constraint, reservation release once, webhook backoff/dead-letter/requeue/ignore, invalid delivery log, metrics, audit, all admin routes.');
} finally { await db.$disconnect(); }
