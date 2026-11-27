const crypto = require('crypto');
const express = require('express');
const db = require('../shared/db');
const { authenticateApiKey, requirePermission } = require('../middleware/authRbac');
const { enqueueWebhookReplay, enqueueWebhookEvent } = require('../queue/jobQueue');

const router = express.Router();
router.use(authenticateApiKey);

router.get('/endpoints', requirePermission('webhooks', 'read'), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, merchant_id, env_mode, target_url, events, active, created_at, updated_at
       FROM webhook_endpoints
       WHERE merchant_id = $1 AND env_mode = $2
       ORDER BY created_at DESC`,
      [req.merchantId, req.envMode]
    );
    res.json({ items: result.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/endpoints', requirePermission('webhooks', 'write'), async (req, res, next) => {
  try {
    const { target_url, events = ['payment.succeeded', 'payment.failed', 'payment.canceled', 'refund.succeeded'] } = req.body || {};
    if (!target_url || !/^https?:\/\//.test(target_url)) {
      return res.status(400).json({
        error: { code: 'invalid_target_url', message: 'Provide a valid http:// or https:// target_url.' },
      });
    }
    const secret = `whsec_${req.envMode}_${crypto.randomBytes(18).toString('hex')}`;
    const row = await db.queryOne(
      `INSERT INTO webhook_endpoints (merchant_id, env_mode, target_url, signing_secret, events, active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, merchant_id, env_mode, target_url, signing_secret, events, active, created_at`,
      [req.merchantId, req.envMode, target_url, secret, events]
    );
    res.locals.includeWebhookSigningSecret = true;
    res.status(201).json({ endpoint: row });
  } catch (err) {
    next(err);
  }
});

router.get('/deliveries', requirePermission('webhooks', 'read'), async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '30', 10)));
    const result = await db.query(
      `SELECT * FROM webhook_deliveries
       WHERE merchant_id = $1 AND env_mode = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [req.merchantId, req.envMode, limit]
    );
    res.json({ count: result.rows.length, items: result.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/deliveries/:id/replay', requirePermission('webhooks', 'replay'), async (req, res, next) => {
  try {
    const delivery = await db.queryOne(
      `UPDATE webhook_deliveries
       SET status = 'replaying'
       WHERE id = $1 AND merchant_id = $2 AND env_mode = $3
       RETURNING *`,
      [req.params.id, req.merchantId, req.envMode]
    );
    if (!delivery) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Webhook delivery record not found.' } });
    }

    await enqueueWebhookReplay({
      deliveryId: delivery.id,
      merchantId: req.merchantId,
      envMode: req.envMode,
    });

    res.json({ message: 'Webhook replay queued.', delivery });
  } catch (err) {
    next(err);
  }
});

router.post('/test', requirePermission('webhooks', 'write'), async (req, res, next) => {
  try {
    const job = await enqueueWebhookEvent({
      merchantId: req.merchantId,
      envMode: req.envMode,
      eventType: req.body?.event_type || 'payment.succeeded',
      payload: req.body?.payload || { test: true, timestamp: new Date().toISOString() },
    });
    res.status(202).json({ queued: true, job_id: job?.id || null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
