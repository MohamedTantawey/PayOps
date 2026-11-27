// backend/src/shared/redis.js
const Redis = require('ioredis');
const config = require('./config');
const logger = require('./logger');

const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
  retryStrategy(times) {
    if (times > 10) {
      logger.warn({ times }, 'Max Redis reconnection attempts reached, pausing retries');
      return null; // stop reconnecting automatically
    }
    const delay = Math.min(times * 100, 2000);
    logger.warn({ times, delay }, 'Reconnecting to Redis');
    return delay;
  },
});

let connectPromise = null;
async function ensureConnected() {
  if (redis.status === 'ready' || redis.status === 'connecting' || redis.status === 'connect') {
    return;
  }
  if (!connectPromise) {
    connectPromise = redis.connect().catch((err) => {
      logger.debug({ err: err.message }, 'Redis initial lazy connection failed');
      connectPromise = null;
      throw err;
    });
  }
  await connectPromise;
}

redis.on('connect', () => {
  logger.info('Connected to Redis');
});

redis.on('error', (err) => {
  logger.error({ err: err.message }, 'Redis client connection error');
});

// Lua script for atomic distributed lock release (ensures only the lock owner can release it)
const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Health check probe: returns round-trip ping latency in milliseconds
 * @returns {Promise<number>}
 */
async function pingRedis() {
  await ensureConnected();
  const start = Date.now();
  await redis.ping();
  return Date.now() - start;
}

// -----------------------------------------------------------------------------
// Distributed Lock Management (Hyperswitch PAYLOCK Pattern)
// -----------------------------------------------------------------------------

/**
 * Acquire distributed lock
 * @param {string} lockKey - e.g. PAYLOCK_test_intent_id
 * @param {string} traceId - Unique request/owner identifier
 * @param {number} [ttlSeconds=15] - Lock TTL
 * @returns {Promise<boolean>}
 */
async function acquireLock(lockKey, traceId, ttlSeconds = 15) {
  await ensureConnected();
  const result = await redis.set(lockKey, traceId, 'NX', 'EX', ttlSeconds);
  const acquired = result === 'OK';
  logger.debug({ lockKey, traceId, acquired, ttlSeconds }, 'Distributed lock attempt');
  return acquired;
}

/**
 * Release distributed lock atomically (checks ownership)
 * @param {string} lockKey
 * @param {string} traceId
 * @returns {Promise<boolean>}
 */
async function releaseLock(lockKey, traceId) {
  await ensureConnected();
  const result = await redis.eval(RELEASE_LOCK_LUA, 1, lockKey, traceId);
  const released = result === 1;
  logger.debug({ lockKey, traceId, released }, 'Distributed lock released');
  return released;
}

// -----------------------------------------------------------------------------
// Idempotency Management (SET NX / GET Replay)
// -----------------------------------------------------------------------------

/**
 * Check and retrieve cached idempotent response
 * @param {string} envMode - 'test' | 'live'
 * @param {string} idempotencyKey
 * @returns {Promise<object|null>}
 */
async function getIdempotentReplay(envMode, idempotencyKey) {
  await ensureConnected();
  const cacheKey = `idemp:${envMode}:${idempotencyKey}`;
  const raw = await redis.get(cacheKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Store idempotent response
 * @param {string} envMode
 * @param {string} idempotencyKey
 * @param {object} responsePayload
 * @param {number} [ttlSeconds=86400] - 24 hours default
 */
async function setIdempotentReplay(envMode, idempotencyKey, responsePayload, ttlSeconds = 86400) {
  await ensureConnected();
  const cacheKey = `idemp:${envMode}:${idempotencyKey}`;
  await redis.set(cacheKey, JSON.stringify(responsePayload), 'EX', ttlSeconds);
}

// -----------------------------------------------------------------------------
// Circuit Breaker & Sliding Window Counters
// -----------------------------------------------------------------------------

/**
 * Retrieve current circuit breaker state for connector
 * @param {string} envMode
 * @param {string} connectorId - 'mock_stripe' | 'mock_paymo'
 * @returns {Promise<'open'|'closed'>}
 */
async function getCircuitState(envMode, connectorId) {
  await ensureConnected();
  const state = await redis.get(`cb:state:${envMode}:${connectorId}`);
  return state === 'open' ? 'open' : 'closed';
}

/**
 * Record payment attempt outcome in sliding window and evaluate circuit trip
 * @param {string} envMode
 * @param {string} connectorId
 * @param {boolean} succeeded
 */
async function recordCircuitOutcome(envMode, connectorId, succeeded) {
  await ensureConnected();
  const key = `cb:${envMode}:${connectorId}`;
  const field = succeeded ? 'success' : 'failure';

  await redis.hincrby(key, field, 1);
  await redis.expire(key, 300); // 5-minute rolling window

  const stats = await redis.hgetall(key);
  const failures = parseInt(stats.failure || '0', 10);
  const successes = parseInt(stats.success || '0', 10);
  const total = failures + successes;

  // If >= 10 attempts in window and > 50% failure rate, trip circuit for 60 seconds
  if (total >= 10 && failures / total > 0.5) {
    logger.warn(
      { envMode, connectorId, failures, total, failureRate: (failures / total).toFixed(2) },
      'Tripping circuit breaker to OPEN state'
    );
    await redis.set(`cb:state:${envMode}:${connectorId}`, 'open', 'EX', 60);
  }
}

/**
 * Reset circuit breaker state manually
 * @param {string} envMode
 * @param {string} connectorId
 */
async function resetCircuitState(envMode, connectorId) {
  await ensureConnected();
  await redis.del(`cb:state:${envMode}:${connectorId}`);
  await redis.del(`cb:${envMode}:${connectorId}`);
}

// -----------------------------------------------------------------------------
// Redis Streams & Analytics Event Publishing
// -----------------------------------------------------------------------------

/**
 * Publish an analytics event to Redis Streams
 * @param {string} envMode
 * @param {object} event
 */
async function publishAnalyticsEvent(envMode, event) {
  await ensureConnected();
  const streamKey = `payops:analytics:${envMode}`;
  const payload = {
    ...event,
    timestamp: Date.now().toString(),
  };

  const args = [];
  for (const [k, v] of Object.entries(payload)) {
    args.push(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }

  await redis.xadd(streamKey, '*', ...args);
}

// -----------------------------------------------------------------------------
// Generic Cache Operations
// -----------------------------------------------------------------------------

async function get(key) {
  await ensureConnected();
  return redis.get(key);
}

async function set(key, value, ttlSeconds = null) {
  await ensureConnected();
  if (ttlSeconds) {
    return redis.set(key, value, 'EX', ttlSeconds);
  }
  return redis.set(key, value);
}

async function del(key) {
  await ensureConnected();
  return redis.del(key);
}

async function hgetall(key) {
  await ensureConnected();
  return redis.hgetall(key);
}

async function hincrby(key, field, increment) {
  await ensureConnected();
  return redis.hincrby(key, field, increment);
}

async function expire(key, seconds) {
  await ensureConnected();
  return redis.expire(key, seconds);
}

/**
 * Close Redis connection gracefully
 */
async function close() {
  if (redis.status !== 'wait' && redis.status !== 'end') {
    await redis.quit().catch(() => {});
  }
  logger.info('Redis connection closed');
}

module.exports = {
  client: redis,
  pingRedis,
  acquireLock,
  releaseLock,
  getIdempotentReplay,
  setIdempotentReplay,
  getCircuitState,
  recordCircuitOutcome,
  resetCircuitState,
  publishAnalyticsEvent,
  get,
  set,
  del,
  hgetall,
  hincrby,
  expire,
  close,
};
