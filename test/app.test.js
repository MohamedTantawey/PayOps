const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidCard } = require('../server');

test('accepts a valid card number', () => {
  assert.equal(isValidCard('4242424242424242'), true);
});

test('rejects an invalid card number', () => {
  assert.equal(isValidCard('1234567890123456'), false);
});