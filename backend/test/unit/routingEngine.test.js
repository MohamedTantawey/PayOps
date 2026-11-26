const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCandidateList } = require('../../src/core/routingEngine');

test('selects the configured single connector', () => {
  assert.deepEqual(
    resolveCandidateList(
      { algorithm_type: 'single', config: { connector: 'mock_paymo' } },
      {}
    ),
    ['mock_paymo']
  );
});

test('selects connectors from the first matching routing rule', () => {
  const algorithm = {
    algorithm_type: 'rule',
    config: {
      rules: [
        { currency: 'EUR', connector: 'mock_paymo' },
        { currency: 'USD', connectors: ['mock_stripe'] },
      ],
      default_connectors: ['mock_paymo'],
    },
  };

  assert.deepEqual(
    resolveCandidateList(algorithm, { currency: 'USD' }),
    ['mock_stripe', 'mock_paymo']
  );
  assert.deepEqual(
    resolveCandidateList(algorithm, { currency: 'GBP' }),
    ['mock_paymo']
  );
});

test('respects routing rule amount and card-network conditions', () => {
  const algorithm = {
    algorithm_type: 'rule',
    config: {
      rules: [
        {
          min_amount_cents: 5000,
          card_network: 'visa',
          connector: 'mock_stripe',
        },
      ],
      default_connectors: ['mock_paymo'],
    },
  };

  assert.deepEqual(
    resolveCandidateList(algorithm, { amountCents: 6000, cardNetwork: 'visa' }),
    ['mock_stripe', 'mock_paymo']
  );
  assert.deepEqual(
    resolveCandidateList(algorithm, { amountCents: 1000, cardNetwork: 'visa' }),
    ['mock_paymo']
  );
});
