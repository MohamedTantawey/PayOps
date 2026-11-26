const express = require('express');
const db = require('../shared/db');
const { authenticateApiKey, requirePermission } = require('../middleware/authRbac');
const { enqueueBillingRun } = require('../queue/jobQueue');
const { renderMetrics } = require('../observability/metrics');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ service: 'billing-module', status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/metrics', renderMetrics);

router.use(authenticateApiKey);

router.get('/schedules', requirePermission('billing', 'read'), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT * FROM billing_schedules
       WHERE merchant_id = $1 AND env_mode = $2
       ORDER BY created_at DESC`,
      [req.merchantId, req.envMode]
    );
    res.json({ items: result.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/schedules', requirePermission('billing', 'write'), async (req, res, next) => {
  try {
    const {
      name,
      cron_expr = '0 0 1 * *',
      amount_cents,
      currency = 'USD',
      customer_email,
    } = req.body || {};

    if (!name || !amount_cents || !customer_email) {
      return res.status(400).json({
        error: { code: 'missing_fields', message: '`name`, `amount_cents`, and `customer_email` are required.' },
      });
    }

    const schedule = await db.queryOne(
      `INSERT INTO billing_schedules (merchant_id, env_mode, name, cron_expr, amount_cents, currency, customer_email, active, next_run_at)
       VALUES ($1, $2, $3, $4, $5, UPPER($6), $7, true, NOW() + INTERVAL '1 day')
       RETURNING *`,
      [req.merchantId, req.envMode, name, cron_expr, Number(amount_cents), currency, customer_email]
    );
    res.status(201).json({ schedule });
  } catch (err) {
    next(err);
  }
});

router.post('/schedules/:id/trigger', requirePermission('billing', 'write'), async (req, res, next) => {
  try {
    const schedule = await db.queryOne(
      `SELECT * FROM billing_schedules WHERE id = $1 AND merchant_id = $2 AND env_mode = $3`,
      [req.params.id, req.merchantId, req.envMode]
    );
    if (!schedule) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Billing schedule not found.' } });
    }

    const run = await db.queryOne(
      `INSERT INTO billing_runs (schedule_id, merchant_id, env_mode, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [schedule.id, req.merchantId, req.envMode]
    );

    await enqueueBillingRun({
      runId: run.id,
      scheduleId: schedule.id,
      merchantId: req.merchantId,
      envMode: req.envMode,
    });

    res.status(202).json({ message: 'Batch billing run queued.', run });
  } catch (err) {
    next(err);
  }
});

router.get('/runs', requirePermission('billing', 'read'), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT br.*, bs.name AS schedule_name, bs.amount_cents, bs.currency
       FROM billing_runs br
       JOIN billing_schedules bs ON bs.id = br.schedule_id
       WHERE br.merchant_id = $1 AND br.env_mode = $2
       ORDER BY br.executed_at DESC
       LIMIT 50`,
      [req.merchantId, req.envMode]
    );
    res.json({ items: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
