// backend/src/core/paymentStateMachine.js
const db = require('../shared/db');

const INTENT_TRANSITIONS = {
  requires_payment_method: new Set(['requires_confirmation', 'processing', 'canceled']),
  requires_confirmation: new Set(['processing', 'canceled']),
  processing: new Set(['requires_capture', 'succeeded', 'failed', 'canceled']),
  requires_capture: new Set(['succeeded', 'partially_captured', 'canceled']),
  partially_captured: new Set(['succeeded']),
  failed: new Set(['processing', 'canceled']), // Allows explicit retry or cancellation after a failed attempt
  succeeded: new Set([]),          // Terminal (refunds tracked in `refunds` table)
  canceled: new Set([]),           // Terminal
};

const ATTEMPT_TRANSITIONS = {
  started: new Set(['pending', 'authorized', 'charged', 'failure']),
  pending: new Set(['authorized', 'charged', 'failure', 'voided']),
  authorized: new Set(['charged', 'voided', 'failure']),
  charged: new Set([]),
  voided: new Set([]),
  failure: new Set([]),
};

class StateTransitionError extends Error {
  constructor(entity, fromState, toState) {
    super(`Invalid ${entity} state transition from '${fromState}' to '${toState}'.`);
    this.name = 'StateTransitionError';
    this.statusCode = 409;
    this.code = 'invalid_state_transition';
  }
}

function assertIntentTransition(fromState, toState) {
  if (fromState === toState) return true;
  const allowed = INTENT_TRANSITIONS[fromState];
  if (!allowed || !allowed.has(toState)) {
    throw new StateTransitionError('payment_intent', fromState, toState);
  }
  return true;
}

function assertAttemptTransition(fromState, toState) {
  if (fromState === toState) return true;
  const allowed = ATTEMPT_TRANSITIONS[fromState];
  if (!allowed || !allowed.has(toState)) {
    throw new StateTransitionError('payment_attempt', fromState, toState);
  }
  return true;
}

async function createIntent({
  merchantId,
  envMode,
  amountCents,
  currency = 'USD',
  captureMethod = 'automatic',
  customerEmail = null,
  description = null,
  metadata = {},
  idempotencyKey = null,
  initialStatus = 'requires_confirmation',
}) {
  return db.queryOne(
    `INSERT INTO payment_intents (
       idempotency_key, env_mode, merchant_id, amount_cents, currency,
       capture_method, status, customer_email, description, metadata
     )
     VALUES ($1, $2, $3, $4, UPPER($5), $6, $7, $8, $9, $10::jsonb)
     RETURNING *`,
    [
      idempotencyKey,
      envMode,
      merchantId,
      amountCents,
      currency,
      captureMethod,
      initialStatus,
      customerEmail,
      description,
      JSON.stringify(metadata || {}),
    ]
  );
}

async function transitionIntent(intentId, toStatus, { activeAttemptId = null, incrementAttempt = false } = {}) {
  return db.withTransaction(async (client) => {
    const currentRes = await client.query(
      `SELECT * FROM payment_intents WHERE id = $1 FOR UPDATE`,
      [intentId]
    );
    if (currentRes.rows.length === 0) {
      throw Object.assign(new Error(`PaymentIntent '${intentId}' not found.`), {
        statusCode: 404,
        code: 'payment_intent_not_found',
      });
    }
    const intent = currentRes.rows[0];
    assertIntentTransition(intent.status, toStatus);

    const updatedRes = await client.query(
      `UPDATE payment_intents
       SET status = $1,
           active_attempt_id = COALESCE($2, active_attempt_id),
           attempt_count = CASE WHEN $3 THEN attempt_count + 1 ELSE attempt_count END,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [toStatus, activeAttemptId, incrementAttempt, intentId]
    );
    return updatedRes.rows[0];
  });
}

async function spawnAttempt({
  intentId,
  envMode,
  merchantId,
  connector,
  attemptIndex,
  amountCents,
  currency,
  vaultToken = null,
  metadata = {},
}) {
  return db.queryOne(
    `INSERT INTO payment_attempts (
       intent_id, env_mode, merchant_id, connector, attempt_index,
       status, amount_cents, currency, vault_token, metadata
     )
     VALUES ($1, $2, $3, $4, $5, 'started', $6, UPPER($7), $8, $9::jsonb)
     RETURNING *`,
    [
      intentId,
      envMode,
      merchantId,
      connector,
      attemptIndex,
      amountCents,
      currency,
      vaultToken,
      JSON.stringify(metadata || {}),
    ]
  );
}

async function finalizeAttempt(attemptId, currentStatus, toStatus, details = {}) {
  assertAttemptTransition(currentStatus, toStatus);
  return db.updatePaymentAttempt(attemptId, {
    status: toStatus,
    connectorTransactionId: details.connectorTransactionId || null,
    errorCode: details.errorCode || null,
    errorMessage: details.errorMessage || null,
    metadata: details.metadata || null,
  });
}

module.exports = {
  INTENT_TRANSITIONS,
  ATTEMPT_TRANSITIONS,
  StateTransitionError,
  assertIntentTransition,
  assertAttemptTransition,
  createIntent,
  transitionIntent,
  spawnAttempt,
  finalizeAttempt,
};
