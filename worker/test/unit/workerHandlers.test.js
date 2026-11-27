const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const db = require('../../../backend/src/shared/db');
const config = require('../../../backend/src/shared/config');
const { generateInvoicePdf } = require('../../src/handlers/invoiceHandler');
const { dispatchWebhook } = require('../../src/handlers/webhookHandler');

test('generates an invoice PDF and persists its ready status', async (t) => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payops-invoice-test-'));
  const previousStoragePath = config.storage.localStoragePath;
  config.storage.localStoragePath = storageDir;
  t.after(() => {
    config.storage.localStoragePath = previousStoragePath;
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  const invoice = {
    id: 'invoice-test-1',
    invoice_number: 'INV-TEST-UNIT-1',
    merchant_id: 'merch_test_default',
    env_mode: 'test',
    amount_cents: 1299,
    currency: 'USD',
    customer_email: 'test@example.invalid',
  };
  const intent = {
    id: 'intent-test-1',
    status: 'succeeded',
    description: 'Unit test payment',
  };

  t.mock.method(db, 'queryOne', async (sql) => {
    if (sql.includes('FROM invoices WHERE')) return invoice;
    if (sql.includes('FROM payment_intents WHERE')) return intent;
    if (sql.includes('FROM merchants WHERE')) return { name: 'Test Merchant' };
    if (sql.includes('UPDATE invoices')) return { ...invoice, status: 'ready' };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const result = await generateInvoicePdf({
    invoiceId: invoice.id,
    intentId: intent.id,
    merchantId: invoice.merchant_id,
    envMode: invoice.env_mode,
  });

  const pdfPath = path.join(storageDir, `${invoice.invoice_number}.pdf`);
  assert.equal(result.status, 'ready');
  assert.ok(fs.existsSync(pdfPath));
  assert.ok(fs.statSync(pdfPath).size > 0);
  assert.equal(fs.readFileSync(pdfPath).subarray(0, 5).toString(), '%PDF-');
});

test('returns null when the invoice job references no invoice', async (t) => {
  t.mock.method(db, 'queryOne', async () => null);

  const result = await generateInvoicePdf({
    invoiceId: 'missing-invoice',
    intentId: 'missing-intent',
    merchantId: 'merch_test_default',
    envMode: 'test',
  });

  assert.equal(result, null);
});

test('dispatches a webhook and records its successful delivery', async (t) => {
  const endpoint = {
    id: 'endpoint-test-1',
    target_url: 'https://webhook.example.invalid/events',
    signing_secret: 'test-webhook-secret',
  };
  const pendingDelivery = { id: 'delivery-test-1', status: 'pending' };
  const completedDelivery = { id: pendingDelivery.id, status: 'success', status_code: 200 };
  let queryOneCall = 0;
  let requestOptions;

  t.mock.method(db, 'query', async () => ({ rows: [endpoint] }));
  t.mock.method(db, 'queryOne', async () => {
    queryOneCall += 1;
    return queryOneCall === 1 ? pendingDelivery : completedDelivery;
  });
  t.mock.method(global, 'fetch', async (_url, options) => {
    requestOptions = options;
    return new Response('accepted', { status: 200 });
  });

  const result = await dispatchWebhook({
    merchantId: 'merch_test_default',
    envMode: 'test',
    eventType: 'payment.succeeded',
    payload: { intent_id: 'intent-test-1' },
  });

  assert.equal(result[0].status, 'success');
  assert.equal(result[0].status_code, 200);
  assert.equal(requestOptions.method, 'POST');

  const timestamp = requestOptions.headers['X-PayOps-Timestamp'];
  const expectedSignature = require('../../src/handlers/webhookHandler')
    .signWebhookPayload(requestOptions.body, endpoint.signing_secret, Number(timestamp));
  assert.equal(requestOptions.headers['X-PayOps-Signature'], expectedSignature);
});
