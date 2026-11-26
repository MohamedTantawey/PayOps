// backend/src/middleware/authRbac.js
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../shared/db');
const redis = require('../shared/redis');
const logger = require('../shared/logger');

const AUTH_CACHE_TTL_SECONDS = 60;

function extractRawApiKey(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (req.headers['x-api-key']) {
    return String(req.headers['x-api-key']).trim();
  }
  return null;
}

function hashCacheKey(rawKey) {
  return `auth:key:${crypto.createHash('sha256').update(rawKey).digest('hex')}`;
}

/**
 * Validates sk_test_ / sk_live_ API keys, enforces Test/Live isolation, and loads RBAC permissions
 */
async function authenticateApiKey(req, res, next) {
  try {
    const rawKey = extractRawApiKey(req);
    if (!rawKey) {
      return res.status(401).json({
        error: {
          code: 'missing_api_key',
          message: 'Provide a valid PayOps API key via Authorization: Bearer <sk_test_...|sk_live_...> or x-api-key header.',
        },
      });
    }

    let inferredMode = null;
    if (rawKey.startsWith('sk_test_')) inferredMode = 'test';
    else if (rawKey.startsWith('sk_live_')) inferredMode = 'live';
    else {
      return res.status(401).json({
        error: {
          code: 'invalid_api_key_format',
          message: 'API key must begin with sk_test_ or sk_live_.',
        },
      });
    }

    // Enforce explicit header mode match if client sends x-payops-mode
    const requestedMode = req.headers['x-payops-mode'];
    if (requestedMode && requestedMode !== inferredMode) {
      return res.status(403).json({
        error: {
          code: 'environment_mode_mismatch',
          message: `API key belongs to '${inferredMode}' mode but request specified x-payops-mode '${requestedMode}'.`,
        },
      });
    }

    const cacheKey = hashCacheKey(rawKey);
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      const principal = JSON.parse(cached);
      req.auth = principal;
      req.envMode = principal.envMode;
      req.merchantId = principal.merchantId;
      return next();
    }

    // Match candidate rows by prefix first, then verify bcrypt hash
    const candidatesResult = await db.query(
      `SELECT ak.id AS api_key_id,
              ak.key_hash,
              ak.env_mode,
              ak.merchant_id,
              m.name AS merchant_name,
              r.id AS role_id,
              r.name AS role_name
       FROM api_keys ak
       JOIN merchants m ON m.id = ak.merchant_id
       LEFT JOIN rbac_roles r ON r.id = ak.role_id
       WHERE ak.active = true
         AND m.is_active = true
         AND ak.env_mode = $1
         AND $2 LIKE (ak.key_prefix || '%')`,
      [inferredMode, rawKey]
    );

    let matchedRow = null;
    for (const row of candidatesResult.rows) {
      const valid = await bcrypt.compare(rawKey, row.key_hash);
      if (valid) {
        matchedRow = row;
        break;
      }
    }

    if (!matchedRow) {
      return res.status(401).json({
        error: {
          code: 'invalid_api_key',
          message: 'Invalid or inactive API key.',
        },
      });
    }

    let permissions = [];
    if (matchedRow.role_id) {
      const permRes = await db.query(
        `SELECT resource, action FROM rbac_permissions WHERE role_id = $1`,
        [matchedRow.role_id]
      );
      permissions = permRes.rows.map((p) => `${p.resource}:${p.action}`);
    }

    const principal = {
      apiKeyId: matchedRow.api_key_id,
      merchantId: matchedRow.merchant_id,
      merchantName: matchedRow.merchant_name,
      envMode: matchedRow.env_mode,
      role: matchedRow.role_name || 'viewer',
      permissions,
    };

    await redis.set(cacheKey, JSON.stringify(principal), AUTH_CACHE_TTL_SECONDS).catch((err) => {
      logger.debug({ err: err.message }, 'Failed to cache API key principal');
    });

    // Non-blocking audit update
    db.query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [matchedRow.api_key_id]).catch(() => {});

    req.auth = principal;
    req.envMode = principal.envMode;
    req.merchantId = principal.merchantId;
    return next();
  } catch (err) {
    logger.error({ err: err.message }, 'API key authentication error');
    return res.status(500).json({
      error: { code: 'auth_internal_error', message: 'Authentication check failed.' },
    });
  }
}

/**
 * Enforces granular RBAC resource:action permission
 */
function requirePermission(resource, action) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({
        error: { code: 'unauthenticated', message: 'Authentication required.' },
      });
    }

    const needed = `${resource}:${action}`;
    if (req.auth.role === 'admin' || req.auth.permissions.includes(needed)) {
      return next();
    }

    return res.status(403).json({
      error: {
        code: 'insufficient_permissions',
        message: `Role '${req.auth.role}' lacks '${needed}' permission.`,
      },
    });
  };
}

module.exports = {
  authenticateApiKey,
  requirePermission,
};
