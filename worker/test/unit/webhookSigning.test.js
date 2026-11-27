const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { signWebhookPayload } = require('../../src/handlers/webhookHandler');

test('signs the timestamp and exact raw request body with HMAC-SHA256', () => {
  const rawBody = '{"event_type":"payment.succeeded","id":"delivery-1"}';
  const secret = 'test-webhook-secret';
  const timestamp = 1730000000;
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  assert.equal(
    signWebhookPayload(rawBody, secret, timestamp),
    `t=${timestamp},v1=${digest}`
  );
  assert.notEqual(
    signWebhookPayload(`${rawBody} `, secret, timestamp),
    `t=${timestamp},v1=${digest}`
  );
});
