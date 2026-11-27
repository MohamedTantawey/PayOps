<<<<<<< HEAD
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const apiBaseUrl = process.env.PAYOPS_API_URL || 'http://127.0.0.1:3000';
const apiKey = process.env.PAYOPS_TEST_API_KEY || 'sk_test_demo_000000000000000000000000';

async function post(path, body, headers = {}) {
  const response = await fetch(new URL(path, apiBaseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      ...headers,
    },
    body: JSON.stringify(body),
  });

  return {
    response,
    body: await response.json(),
  };
}

test('rejects missing and malformed card data through the payments API', async () => {
  const missingCard = await post('/api/payments/tokenize', {});
  assert.equal(missingCard.response.status, 400);
  assert.equal(missingCard.body.error.code, 'invalid_card');

  const invalidCard = await post('/api/payments/tokenize', {
    card: { number: '123456789012', cvv: '123' },
  });
  assert.equal(invalidCard.response.status, 400);
  assert.equal(invalidCard.body.error.code, 'invalid_card_number');
});

test('rejects missing, non-positive, and fractional payment amounts', async () => {
  for (const body of [{}, { amount_cents: 0 }, { amount_cents: 100.5 }]) {
    const result = await post('/api/payments', body);
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error.code, 'invalid_amount');
  }
});

test('replays a payment response for a repeated idempotency key', async () => {
  const key = `unit-${crypto.randomUUID()}`;
  const requestBody = {
    amount_cents: 12345,
    confirm: false,
    auto_invoice: false,
  };
  const headers = { 'idempotency-key': key };

  const first = await post('/api/payments', requestBody, headers);
  assert.equal(first.response.status, 201);
  assert.ok(first.body.intent?.id);

  const second = await post('/api/payments', requestBody, headers);
  assert.equal(second.response.status, 201);
  assert.equal(second.response.headers.get('x-payops-idempotent-replay'), 'true');
  assert.equal(second.body.intent.id, first.body.intent.id);
});
=======
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const apiBaseUrl = process.env.PAYOPS_API_URL || 'http://127.0.0.1:3000';
const apiKey = process.env.PAYOPS_TEST_API_KEY || 'sk_test_demo_000000000000000000000000';

async function post(path, body, headers = {}) {
  const response = await fetch(new URL(path, apiBaseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      ...headers,
    },
    body: JSON.stringify(body),
  });

  return {
    response,
    body: await response.json(),
  };
}

test('rejects missing and malformed card data through the payments API', async () => {
  const missingCard = await post('/api/payments/tokenize', {});
  assert.equal(missingCard.response.status, 400);
  assert.equal(missingCard.body.error.code, 'invalid_card');

  const invalidCard = await post('/api/payments/tokenize', {
    card: { number: '123456789012', cvv: '123' },
  });
  assert.equal(invalidCard.response.status, 400);
  assert.equal(invalidCard.body.error.code, 'invalid_card_number');
});

test('rejects missing, non-positive, and fractional payment amounts', async () => {
  for (const body of [{}, { amount_cents: 0 }, { amount_cents: 100.5 }]) {
    const result = await post('/api/payments', body);
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error.code, 'invalid_amount');
  }
});

test('replays a payment response for a repeated idempotency key', async () => {
  const key = `unit-${crypto.randomUUID()}`;
  const requestBody = {
    amount_cents: 12345,
    confirm: false,
    auto_invoice: false,
  };
  const headers = { 'idempotency-key': key };

  const first = await post('/api/payments', requestBody, headers);
  assert.equal(first.response.status, 201);
  assert.ok(first.body.intent?.id);

  const second = await post('/api/payments', requestBody, headers);
  assert.equal(second.response.status, 201);
  assert.equal(second.response.headers.get('x-payops-idempotent-replay'), 'true');
  assert.equal(second.body.intent.id, first.body.intent.id);
});
>>>>>>> origin/payops-control
