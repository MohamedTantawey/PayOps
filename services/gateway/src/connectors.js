// Payment connectors. These are SIMULATED providers (no money moves). Each follows the same interface so a real
// Stripe or Paymob adapter can replace them: charge / capture / refund / void.
// Test card numbers (derived at tokenization, behaviour stored on the vault token; PAN/CVV are never stored):
//   4242424242424242  succeeds
//   4000000000000002  card_declined (hard decline, no failover)
//   4000000000009995  insufficient_funds (hard decline, no failover)
//   4000000000000341  mock_stripe is down, mock_paymob succeeds (failover)
//   4000000000000259  every connector is down (payment fails after failover)
//   4000000000000077  charge succeeds, refunds fail
import { rand } from './util.js';

export const BEHAVIORS = {
  '4000000000000002': 'decline',
  '4000000000009995': 'insufficient_funds',
  '4000000000000341': 'stripe_down',
  '4000000000000259': 'all_down',
  '4000000000000077': 'refund_fails',
};
export const behaviorFor = (pan) => BEHAVIORS[pan] || 'success';

function makeConnector(name, prefix, downFor) {
  return {
    name,
    async charge({ behavior, capture_method }) {
      if (behavior === 'decline') return { ok: false, type: 'decline', error_code: 'card_declined', error_message: 'The card was declined.' };
      if (behavior === 'insufficient_funds') return { ok: false, type: 'decline', error_code: 'insufficient_funds', error_message: 'The card has insufficient funds.' };
      if (behavior === 'all_down' || behavior === downFor) return { ok: false, type: 'error', error_code: 'connector_unavailable', error_message: `${name} is unavailable.` };
      return { ok: true, status: capture_method === 'manual' ? 'authorized' : 'charged', transaction_id: `${prefix}_ch_${rand(10)}` };
    },
    async capture({ transaction_id }) { return { ok: true, transaction_id }; },
    async void({ transaction_id }) { return { ok: true, transaction_id }; },
    async refund({ behavior }) {
      if (behavior === 'refund_fails') return { ok: false, error_code: 'refund_rejected', error_message: 'The connector rejected the refund.' };
      return { ok: true, refund_id: `${prefix}_re_${rand(10)}` };
    },
  };
}

export const CONNECTORS = {
  mock_stripe: makeConnector('mock_stripe', 'mock_stripe', 'stripe_down'),
  mock_paymob: makeConnector('mock_paymob', 'mock_paymob', null),
};
// Priority routing: Stripe -> Paymob.
export const ROUTING = { algorithm: 'Priority: Stripe -> Paymob', type: 'priority', order: ['mock_stripe', 'mock_paymob'] };

// Simple circuit breaker: 3 consecutive connector errors open the circuit for 30 seconds.
const breaker = {};
export const breakerOpen = (n) => (breaker[n]?.openUntil || 0) > Date.now();
export function breakerRecord(n, ok) {
  const b = (breaker[n] ||= { fails: 0, openUntil: 0 });
  if (ok) { b.fails = 0; b.openUntil = 0; } else if (++b.fails >= 3) { b.openUntil = Date.now() + 30000; b.fails = 0; }
}
export const breakerReset = () => { for (const k of Object.keys(breaker)) delete breaker[k]; };
