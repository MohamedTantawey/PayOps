const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeResponsePayload } = require('../../src/middleware/piiMasker');

test('only endpoint creation can opt into returning its webhook signing secret', () => {
  const payload = {
    endpoint: {
      signing_secret: 'whsec_test_one_time_secret',
      target_url: 'https://store.example/webhook',
    },
  };

  assert.equal(sanitizeResponsePayload(payload).endpoint.signing_secret, undefined);
  assert.equal(
    sanitizeResponsePayload(payload, { allowWebhookSigningSecret: true }).endpoint.signing_secret,
    'whsec_test_one_time_secret'
  );
});
