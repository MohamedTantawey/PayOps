const test = require('node:test');
const assert = require('node:assert/strict');
const vaultClient = require('../../src/core/vaultClient');

test('rejects a missing card before attempting to access the database', async () => {
  await assert.rejects(
    vaultClient.tokenize({
      merchantId: 'merch_test_default',
      envMode: 'test',
      card: null,
    }),
    (error) => error.code === 'invalid_card' && error.statusCode === 400
  );
});

test('rejects card numbers outside the supported length', async () => {
  await assert.rejects(
    vaultClient.tokenize({
      merchantId: 'merch_test_default',
      envMode: 'test',
      card: { number: '123456789012', cvv: '123' },
    }),
    (error) => error.code === 'invalid_card_number' && error.statusCode === 400
  );
});

test('rejects CVVs that are not three or four digits', async () => {
  await assert.rejects(
    vaultClient.tokenize({
      merchantId: 'merch_test_default',
      envMode: 'test',
      card: { number: '4242424242424242', cvv: '12x' },
    }),
    (error) => error.code === 'invalid_cvv' && error.statusCode === 400
  );
});
