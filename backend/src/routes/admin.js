const express = require('express');
const db = require('../shared/db');
const { authenticateApiKey, requirePermission } = require('../middleware/authRbac');

const router = express.Router();
router.use(authenticateApiKey);

router.get('/rbac', requirePermission('admin', 'read'), async (req, res, next) => {
  try {
    const rolesRes = await db.query(
      `SELECT r.id, r.name, r.description,
              COALESCE(json_agg(p.resource || ':' || p.action) FILTER (WHERE p.id IS NOT NULL), '[]') AS permissions
       FROM rbac_roles r
       LEFT JOIN rbac_permissions p ON p.role_id = r.id
       GROUP BY r.id
       ORDER BY r.name ASC`
    );

    const keysRes = await db.query(
      `SELECT ak.id, ak.key_prefix, ak.env_mode, ak.name, ak.active, ak.created_at, ak.last_used_at,
              r.name AS role_name
       FROM api_keys ak
       LEFT JOIN rbac_roles r ON r.id = ak.role_id
       WHERE ak.merchant_id = $1 AND ak.env_mode = $2
       ORDER BY ak.created_at DESC`,
      [req.merchantId, req.envMode]
    );

    res.json({
      current_principal: req.auth,
      roles: rolesRes.rows,
      api_keys: keysRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics', requirePermission('payments', 'read'), async (req, res, next) => {
  try {
    const connectorSummary = await db.query(
      `SELECT connector,
              COUNT(*)::int AS total_attempts,
              COUNT(*) FILTER (WHERE status IN ('authorized', 'charged'))::int AS successful_attempts,
              COUNT(*) FILTER (WHERE status = 'failure')::int AS failed_attempts,
              COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('authorized', 'charged')), 0)::bigint AS volume_cents,
              COALESCE(AVG((metadata->>'latency_ms')::numeric), 0)::int AS avg_latency_ms,
              COALESCE(SUM((metadata->'fees'->>'total_fee_cents')::numeric), 0)::bigint AS total_fees_cents
       FROM payment_attempts
       WHERE merchant_id = $1 AND env_mode = $2
       GROUP BY connector
       ORDER BY total_attempts DESC`,
      [req.merchantId, req.envMode]
    );

    const failoverStats = await db.queryOne(
      `SELECT COUNT(*)::int AS failover_recovered_intents
       FROM payment_attempts
       WHERE merchant_id = $1
         AND env_mode = $2
         AND status IN ('authorized', 'charged')
         AND attempt_index > 1`,
      [req.merchantId, req.envMode]
    );

    res.json({
      mode: req.envMode,
      failover_recovered_intents: failoverStats?.failover_recovered_intents || 0,
      connectors: connectorSummary.rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
