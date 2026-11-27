// backend/src/core/routingEngine.js
const crypto = require('crypto');
const db = require('../shared/db');
const redis = require('../shared/redis');
const logger = require('../shared/logger');
const vaultClient = require('./vaultClient');
const { getConnectorAdapter, getConnectorCredentials } = require('./connectorAdapter');
const stateMachine = require('./paymentStateMachine');

const ROUTING_CACHE_TTL_SECONDS = 30;
const APPROVAL_WINDOW_TTL_SECONDS = 600; // 10-minute rolling approval telemetry
const DEFAULT_FALLBACK_CONNECTORS = ['mock_stripe', 'mock_paymo'];

function routingCacheKey(merchantId, envMode) {
  return `routing:active:${envMode}:${merchantId}`;
}

/**
 * Invalidate cached routing config so dashboard updates take effect with zero restarts
 */
async function invalidateRoutingCache(merchantId, envMode) {
  await redis.del(routingCacheKey(merchantId, envMode)).catch(() => {});
}

async function getActiveRoutingAlgorithm(merchantId, envMode) {
  const cacheKey = routingCacheKey(merchantId, envMode);
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    return JSON.parse(cached);
  }

  const row = await db.queryOne(
    `SELECT id, name, algorithm_type, config
     FROM routing_algorithms
     WHERE merchant_id = $1 AND env_mode = $2 AND active = true
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
    [merchantId, envMode]
  );

  const resolved = row || {
    id: null,
    name: 'system_default_priority',
    algorithm_type: 'priority',
    config: { connectors: DEFAULT_FALLBACK_CONNECTORS },
  };

  await redis.set(cacheKey, JSON.stringify(resolved), ROUTING_CACHE_TTL_SECONDS).catch(() => {});
  return resolved;
}

function evaluateRuleCondition(rule, context) {
  if (rule.currency && String(rule.currency).toUpperCase() !== String(context.currency).toUpperCase()) {
    return false;
  }
  if (rule.card_network && String(rule.card_network).toLowerCase() !== String(context.cardNetwork).toLowerCase()) {
    return false;
  }
  if (rule.min_amount_cents !== undefined && Number(context.amountCents) < Number(rule.min_amount_cents)) {
    return false;
  }
  if (rule.max_amount_cents !== undefined && Number(context.amountCents) > Number(rule.max_amount_cents)) {
    return false;
  }
  return true;
}

function pickWeightedOrder(splits) {
  if (!Array.isArray(splits) || splits.length === 0) return DEFAULT_FALLBACK_CONNECTORS;
  const totalWeight = splits.reduce((acc, s) => acc + Math.max(0, Number(s.weight || 0)), 0);
  if (totalWeight <= 0) return splits.map((s) => s.connector);

  let roll = Math.random() * totalWeight;
  let primary = splits[0].connector;
  for (const split of splits) {
    roll -= Math.max(0, Number(split.weight || 0));
    if (roll <= 0) {
      primary = split.connector;
      break;
    }
  }

  const rest = splits.map((s) => s.connector).filter((c) => c !== primary);
  return [primary, ...rest];
}

function resolveCandidateList(algorithm, context) {
  const cfg = algorithm.config || {};

  switch (algorithm.algorithm_type) {
    case 'single': {
      const single = cfg.connector || (Array.isArray(cfg.connectors) ? cfg.connectors[0] : null);
      return single ? [single] : DEFAULT_FALLBACK_CONNECTORS;
    }
    case 'volume_split': {
      return pickWeightedOrder(cfg.splits);
    }
    case 'rule': {
      const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
      for (const rule of rules) {
        if (evaluateRuleCondition(rule, context)) {
          const matched = Array.isArray(rule.connectors)
            ? rule.connectors
            : [rule.connector].filter(Boolean);
          const fallbacks = (cfg.default_connectors || DEFAULT_FALLBACK_CONNECTORS).filter(
            (c) => !matched.includes(c)
          );
          return [...matched, ...fallbacks];
        }
      }
      return cfg.default_connectors || cfg.connectors || DEFAULT_FALLBACK_CONNECTORS;
    }
    case 'priority':
    default: {
      return Array.isArray(cfg.connectors) && cfg.connectors.length > 0
        ? cfg.connectors
        : DEFAULT_FALLBACK_CONNECTORS;
    }
  }
}

async function recordRoutingTelemetry(envMode, connector, succeeded, latencyMs) {
  const statsKey = `routing:stats:${envMode}:${connector}`;
  try {
    await redis.hincrby(statsKey, 'attempts', 1);
    await redis.hincrby(statsKey, succeeded ? 'approvals' : 'declines', 1);
    await redis.hincrby(statsKey, 'total_latency_ms', Math.max(0, Math.round(latencyMs)));
    await redis.expire(statsKey, APPROVAL_WINDOW_TTL_SECONDS);
    await redis.recordCircuitOutcome(envMode, connector, succeeded);
  } catch (err) {
    logger.debug({ err: err.message, connector }, 'Non-fatal Redis telemetry update failure');
  }
}

async function getConnectorLiveTelemetry(envMode, connectors = DEFAULT_FALLBACK_CONNECTORS) {
  const results = {};
  for (const connector of connectors) {
    const stats = await redis.hgetall(`routing:stats:${envMode}:${connector}`).catch(() => ({}));
    const circuitState = await redis.getCircuitState(envMode, connector).catch(() => 'closed');
    const attempts = parseInt(stats.attempts || '0', 10);
    const approvals = parseInt(stats.approvals || '0', 10);
    const totalLatency = parseInt(stats.total_latency_ms || '0', 10);

    results[connector] = {
      circuit_state: circuitState,
      attempts,
      approvals,
      declines: parseInt(stats.declines || '0', 10),
      approval_rate_pct: attempts > 0 ? Number(((approvals / attempts) * 100).toFixed(2)) : 100,
      avg_latency_ms: attempts > 0 ? Math.round(totalLatency / attempts) : 0,
    };
  }
  return results;
}

/**
 * Core Payment Execution Pipeline: Lock -> Tokenize/Detokenize -> Route -> Cascade Failover
 */
async function executeRoutedPayment({ intent, card = null, vaultToken = null }) {
  const { id: intentId, merchant_id: merchantId, env_mode: envMode } = intent;
  const lockKey = `PAYLOCK_${envMode}_intent_${intentId}`;
  const traceId = crypto.randomUUID();

  const locked = await redis.acquireLock(lockKey, traceId, 20);
  if (!locked) {
    throw Object.assign(new Error('PaymentIntent is currently locked by another active execution.'), {
      statusCode: 409,
      code: 'payment_intent_locked',
    });
  }

  try {
    // 1. Resolve PCI Vault boundary (raw card never touches core payment tables)
    let resolvedVault;
    if (vaultToken) {
      resolvedVault = await vaultClient.detokenize(vaultToken, envMode);
    } else if (card) {
      const tokenRow = await vaultClient.tokenize({ merchantId, envMode, card });
      resolvedVault = await vaultClient.detokenize(tokenRow.token, envMode);
    } else {
      throw Object.assign(new Error('Either `card` or `vault_token` must be provided to confirm payment.'), {
        statusCode: 400,
        code: 'missing_payment_method',
      });
    }

    // 2. Move intent into processing
    let activeIntent = await stateMachine.transitionIntent(intentId, 'processing');

    // 3. Evaluate routing rules & filter open circuit breakers
    const algorithm = await getActiveRoutingAlgorithm(merchantId, envMode);
    const rawCandidates = resolveCandidateList(algorithm, {
      amountCents: activeIntent.amount_cents,
      currency: activeIntent.currency,
      cardNetwork: resolvedVault.card_network,
    });

    const healthyCandidates = [];
    const openCircuitCandidates = [];
    for (const c of rawCandidates) {
      const state = await redis.getCircuitState(envMode, c).catch(() => 'closed');
      if (state === 'open') openCircuitCandidates.push(c);
      else healthyCandidates.push(c);
    }

    // Half-open safeguard: if every configured PSP is tripped, probe the primary candidate anyway
    const executionPlan = healthyCandidates.length > 0 ? healthyCandidates : [rawCandidates[0]];

    const attemptsTrail = [];
    let finalAttempt = null;
    let succeeded = false;

    // 4. Execute connector pipeline with automatic cascading failover
    for (let idx = 0; idx < executionPlan.length; idx++) {
      const connectorName = executionPlan[idx];
      const attemptNumber = Number(activeIntent.attempt_count || 0) + idx + 1;

      const attempt = await stateMachine.spawnAttempt({
        intentId,
        envMode,
        merchantId,
        connector: connectorName,
        attemptIndex: attemptNumber,
        amountCents: activeIntent.amount_cents,
        currency: activeIntent.currency,
        vaultToken: resolvedVault.token,
        metadata: {
          routing_algorithm: algorithm.name,
          routing_type: algorithm.algorithm_type,
          skipped_open_circuits: openCircuitCandidates,
          card_last4: resolvedVault.last4,
          card_network: resolvedVault.card_network,
        },
      });

      const adapter = getConnectorAdapter(connectorName);
      const credentials = await getConnectorCredentials(merchantId, connectorName, envMode);
      const result = await adapter.authorize({
        intent: activeIntent,
        attempt,
        detokenizedCard: resolvedVault,
        credentials,
      });

      await recordRoutingTelemetry(envMode, connectorName, result.ok, result.latencyMs);

      if (result.ok) {
        const targetAttemptStatus =
          activeIntent.capture_method === 'manual' ? 'authorized' : 'charged';

        finalAttempt = await stateMachine.finalizeAttempt(attempt.id, attempt.status, targetAttemptStatus, {
          connectorTransactionId: result.connectorTransactionId,
          metadata: {
            ...attempt.metadata,
            latency_ms: result.latencyMs,
            fees: result.fees,
            failover_recovered: idx > 0,
          },
        });

        attemptsTrail.push(finalAttempt);
        succeeded = true;

        const targetIntentStatus =
          activeIntent.capture_method === 'manual' ? 'requires_capture' : 'succeeded';

        activeIntent = await stateMachine.transitionIntent(intentId, targetIntentStatus, {
          activeAttemptId: finalAttempt.id,
          incrementAttempt: true,
        });

        // Emit non-blocking cost & routing analytics to Redis Streams
        redis.publishAnalyticsEvent(envMode, {
          merchant_id: merchantId,
          event_type: targetIntentStatus === 'succeeded' ? 'payment.succeeded' : 'payment.authorized',
          intent_id: intentId,
          connector: connectorName,
          amount_cents: activeIntent.amount_cents,
          currency: activeIntent.currency,
          latency_ms: result.latencyMs,
          fees: result.fees,
          failover_index: idx,
        }).catch(() => {});

        break;
      }

      // Failed attempt: record details and inspect GSM retryability
      finalAttempt = await stateMachine.finalizeAttempt(attempt.id, attempt.status, 'failure', {
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        metadata: {
          ...attempt.metadata,
          latency_ms: result.latencyMs,
          retryable: result.retryable,
          error_category: result.category,
        },
      });
      attemptsTrail.push(finalAttempt);

      logger.warn(
        {
          intentId,
          connector: connectorName,
          attemptIndex: attemptNumber,
          errorCode: result.errorCode,
          retryable: result.retryable,
        },
        'Connector attempt failed'
      );

      if (!result.retryable) {
        // Hard decline (e.g., stolen_card / insufficient_funds): abort cascade immediately
        break;
      }
    }

    if (!succeeded) {
      activeIntent = await stateMachine.transitionIntent(intentId, 'failed', {
        activeAttemptId: finalAttempt ? finalAttempt.id : null,
        incrementAttempt: true,
      });

      redis.publishAnalyticsEvent(envMode, {
        merchant_id: merchantId,
        event_type: 'payment.failed',
        intent_id: intentId,
        connector: finalAttempt ? finalAttempt.connector : null,
        amount_cents: activeIntent.amount_cents,
        currency: activeIntent.currency,
        latency_ms: finalAttempt?.metadata?.latency_ms || 0,
        error_code: finalAttempt?.error_code || 'all_connectors_failed',
      }).catch(() => {});
    }

    return {
      intent: activeIntent,
      active_attempt: finalAttempt,
      attempts: attemptsTrail,
      routing_summary: {
        algorithm: algorithm.name,
        type: algorithm.algorithm_type,
        evaluated_connectors: executionPlan,
        skipped_open_circuits: openCircuitCandidates,
        failover_triggered: attemptsTrail.length > 1,
      },
    };
  } finally {
    await redis.releaseLock(lockKey, traceId).catch(() => {});
  }
}

module.exports = {
  getActiveRoutingAlgorithm,
  invalidateRoutingCache,
  resolveCandidateList,
  getConnectorLiveTelemetry,
  executeRoutedPayment,
};
