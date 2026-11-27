// backend/src/middleware/idempotency.js
const crypto = require('crypto');
const redis = require('../shared/redis');
const logger = require('../shared/logger');

const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours
const DEFAULT_LOCK_TTL_SECONDS = 15;

function idempotencyMiddleware({ ttlSeconds = DEFAULT_IDEMPOTENCY_TTL_SECONDS } = {}) {
  return async (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
      return next();
    }

    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey) {
      return next();
    }

    const envMode = req.envMode || 'test';
    const merchantId = req.merchantId || 'anonymous';
    const scopedKey = `${envMode}:${merchantId}:${req.baseUrl}${req.path}:${idempotencyKey}`;
    const cacheKey = `idemp:resp:${scopedKey}`;
    const lockKey = `PAYLOCK_idemp_${scopedKey}`;
    const traceId = crypto.randomUUID();

    try {
      // 1. Check cached replay
      const existing = await redis.get(cacheKey);
      if (existing) {
        const parsed = JSON.parse(existing);
        res.setHeader('X-PayOps-Idempotent-Replay', 'true');
        return res.status(parsed.statusCode || 200).json(parsed.body);
      }

      // 2. Acquire distributed lock to prevent concurrent duplicate execution
      const locked = await redis.acquireLock(lockKey, traceId, DEFAULT_LOCK_TTL_SECONDS);
      if (!locked) {
        return res.status(409).json({
          error: {
            code: 'idempotency_conflict',
            message: 'Another request with the same Idempotency-Key is currently in progress.',
          },
        });
      }

      req.idempotencyKey = String(idempotencyKey);

      let lockReleased = false;
      const safeRelease = async () => {
        if (!lockReleased) {
          lockReleased = true;
          await redis.releaseLock(lockKey, traceId).catch(() => {});
        }
      };

      const originalJson = res.json.bind(res);
      res.json = (body) => {
        if (res.statusCode < 500) {
          const payload = JSON.stringify({ statusCode: res.statusCode, body });
          redis.set(cacheKey, payload, ttlSeconds).catch((err) => {
            logger.warn({ err: err.message, cacheKey }, 'Failed to store idempotency response');
          });
        }
        safeRelease();
        return originalJson(body);
      };

      res.on('finish', safeRelease);
      res.on('close', safeRelease);

      return next();
    } catch (err) {
      logger.warn({ err: err.message }, 'Idempotency middleware degraded gracefully');
      req.idempotencyKey = String(idempotencyKey);
      return next();
    }
  };
}

module.exports = { idempotencyMiddleware };
