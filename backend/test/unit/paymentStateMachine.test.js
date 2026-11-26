const test = require('node:test');
const assert = require('node:assert/strict');
const {
  StateTransitionError,
  assertIntentTransition,
  assertAttemptTransition,
} = require('../../src/core/paymentStateMachine');

test('allows valid payment intent transitions and no-op transitions', () => {
  assert.equal(assertIntentTransition('processing', 'succeeded'), true);
  assert.equal(assertIntentTransition('requires_confirmation', 'requires_confirmation'), true);
});

test('rejects invalid and terminal payment intent transitions', () => {
  for (const [fromState, toState] of [
    ['requires_confirmation', 'succeeded'],
    ['succeeded', 'processing'],
    ['canceled', 'processing'],
    ['unknown', 'processing'],
  ]) {
    assert.throws(
      () => assertIntentTransition(fromState, toState),
      (error) => error instanceof StateTransitionError &&
        error.code === 'invalid_state_transition' &&
        error.statusCode === 409
    );
  }
});

test('allows valid payment attempt transitions', () => {
  assert.equal(assertAttemptTransition('started', 'authorized'), true);
  assert.equal(assertAttemptTransition('authorized', 'voided'), true);
});

test('rejects transitions out of terminal payment attempt states', () => {
  for (const [fromState, toState] of [
    ['charged', 'failure'],
    ['voided', 'charged'],
    ['failure', 'pending'],
  ]) {
    assert.throws(
      () => assertAttemptTransition(fromState, toState),
      (error) => error instanceof StateTransitionError &&
        error.code === 'invalid_state_transition'
    );
  }
});
