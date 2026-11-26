const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateRedirectUrl,
  hashCheckoutSecret,
  checkoutSecretMatches,
} = require('../../src/core/hostedCheckout');

test('allows only HTTP(S) checkout redirects on configured origins', () => {
  assert.equal(
    validateRedirectUrl('https://store.example/checkout/success?order=123', 'https://store.example'),
    'https://store.example/checkout/success?order=123'
  );
  assert.throws(
    () => validateRedirectUrl('https://attacker.example/redirect', 'https://store.example'),
    (error) => error.code === 'checkout_redirect_not_allowed'
  );
  assert.throws(
    () => validateRedirectUrl('javascript:alert(1)', 'https://store.example'),
    (error) => error.code === 'checkout_redirect_not_allowed'
  );
  assert.throws(
    () => validateRedirectUrl('https://store.example/', ''),
    (error) => error.code === 'checkout_redirects_not_configured'
  );
});

test('checkout secrets are stored as hashes and compared in constant time', () => {
  const secret = 'a-random-checkout-secret';
  const hash = hashCheckoutSecret(secret);
  assert.notEqual(hash, secret);
  assert.equal(checkoutSecretMatches(secret, hash), true);
  assert.equal(checkoutSecretMatches('another-secret', hash), false);
  assert.equal(checkoutSecretMatches('', hash), false);
});
