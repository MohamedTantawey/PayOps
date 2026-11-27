const express = require('express');
const db = require('../shared/db');
const redis = require('../shared/redis');
const config = require('../shared/config');
const { authenticateApiKey, requirePermission } = require('../middleware/authRbac');
const routingEngine = require('../core/routingEngine');

const router = express.Router();
router.use(authenticateApiKey);

router.get('/', requirePermission('routing', 'read'), async (req, res, next) => {
  try {
    const active = await routingEngine.getActiveRoutingAlgorithm(req.merchantId, req.envMode);
    const allRes = await db.query(
      `SELECT * FROM routing_algorithms
       WHERE merchant_id = $1 AND env_mode = $2
       ORDER BY created_at DESC
       LIMIT 10`,
      [req.merchantId, req.envMode]
    );
    const telemetry = await routingEngine.getConnectorLiveTelemetry(req.envMode);

    res.json({
      mode: req.envMode,
      active_algorithm: active,
      history: allRes.rows,
      telemetry,
    });
  } catch (err) {
    next(err);
  }
});

async function upsertRoutingConfig(req, res, next) {
  try {
    const { name = 'Custom Routing Policy', algorithm_type, config: algoConfig } = req.body || {};
    const validTypes = ['single', 'priority', 'volume_split', 'rule'];
    if (!validTypes.includes(algorithm_type)) {
      return res.status(400).json({
        error: {
          code: 'invalid_algorithm_type',
          message: `algorithm_type must be one of: ${validTypes.join(', ')}`,
        },
      });
    }
    if (!algoConfig || typeof algoConfig !== 'object') {
      return res.status(400).json({
        error: { code: 'invalid_routing_config', message: '`config` JSON object is required.' },
      });
    }

    const created = await db.withTransaction(async (client) => {
      await client.query(
        `UPDATE routing_algorithms SET active = false WHERE merchant_id = $1 AND env_mode = $2`,
        [req.merchantId, req.envMode]
      );
      const ins = await client.query(
        `INSERT INTO routing_algorithms (merchant_id, env_mode, name, algorithm_type, config, active, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, true, $6)
         RETURNING *`,
        [req.merchantId, req.envMode, name, algorithm_type, JSON.stringify(algoConfig), req.auth.role]
      );
      return ins.rows[0];
    });

    await routingEngine.invalidateRoutingCache(req.merchantId, req.envMode);

    res.json({
      message: 'Routing algorithm activated with zero-downtime cache invalidation.',
      active_algorithm: created,
    });
  } catch (err) {
    next(err);
  }
}

router.post('/', requirePermission('routing', 'write'), upsertRoutingConfig);
router.put('/', requirePermission('routing', 'write'), upsertRoutingConfig);

router.post('/circuit-reset', requirePermission('routing', 'write'), async (req, res, next) => {
  try {
    const connector = req.body?.connector || 'mock_stripe';
    await redis.resetCircuitState(req.envMode, connector);
    const telemetry = await routingEngine.getConnectorLiveTelemetry(req.envMode);
    res.json({ reset: true, connector, telemetry });
  } catch (err) {
    next(err);
  }
});

router.get('/chaos', requirePermission('routing', 'read'), async (req, res) => {
  try {
    const r = await fetch(`${config.connectors.mockStripeUrl}/admin/chaos`);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: { code: 'mock_psp_unreachable', message: err.message } });
  }
});

router.post('/chaos', requirePermission('routing', 'write'), async (req, res) => {
  try {
    const targetGateway = req.body?.gateway || 'mock_stripe';
    const baseUrl =
      targetGateway === 'mock_paymo'
        ? config.connectors.mockPaymoUrl
        : config.connectors.mockStripeUrl;

    await Promise.allSettled([
      fetch(`${config.connectors.mockStripeUrl}/admin/chaos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      }),
      fetch(`${config.connectors.mockPaymoUrl}/admin/chaos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      }),
    ]);

    const checkRes = await fetch(`${baseUrl}/admin/chaos`);
    const data = await checkRes.json();
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: { code: 'mock_psp_unreachable', message: err.message } });
  }
});

module.exports = router;
