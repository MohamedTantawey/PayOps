const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const db = require('../shared/db');
const { authenticateApiKey, requirePermission } = require('../middleware/authRbac');
const { enqueueInvoiceGeneration } = require('../queue/jobQueue');
const { renderMetrics } = require('../observability/metrics');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ service: 'invoices-module', status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/metrics', renderMetrics);

router.use(authenticateApiKey);

router.get('/', requirePermission('invoices', 'read'), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT * FROM invoices
       WHERE merchant_id = $1 AND env_mode = $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.merchantId, req.envMode]
    );
    res.json({ count: result.rows.length, items: result.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/generate', requirePermission('invoices', 'write'), async (req, res, next) => {
  try {
    const { intent_id } = req.body || {};
    if (!intent_id) {
      return res.status(400).json({ error: { code: 'missing_intent_id', message: '`intent_id` is required.' } });
    }

    const intent = await db.queryOne(
      `SELECT * FROM payment_intents WHERE id = $1 AND merchant_id = $2 AND env_mode = $3`,
      [intent_id, req.merchantId, req.envMode]
    );
    if (!intent) {
      return res.status(404).json({ error: { code: 'not_found', message: 'PaymentIntent not found.' } });
    }

    const invNum = `INV-${req.envMode.toUpperCase()}-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const invoice = await db.queryOne(
      `INSERT INTO invoices (invoice_number, intent_id, merchant_id, env_mode, status, amount_cents, currency, customer_email)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
       RETURNING *`,
      [invNum, intent.id, req.merchantId, req.envMode, intent.amount_cents, intent.currency, intent.customer_email]
    );

    await enqueueInvoiceGeneration({
      invoiceId: invoice.id,
      intentId: intent.id,
      merchantId: req.merchantId,
      envMode: req.envMode,
    });

    res.status(202).json({ invoice });
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:orderId/invoice', requirePermission('invoices', 'read'), async (req, res, next) => {
  try {
    const { orderId } = req.params;
    if (!orderId) {
      return res.status(400).json({ error: { code: 'missing_order_id', message: '`orderId` is required.' } });
    }

    // Look up the invoice linked to this order. The ecommerce order id is stored
    // in the payment intent metadata as { order_id: <ecommerceOrderId> }.
    const invoice = await db.queryOne(
      `SELECT i.*
       FROM invoices i
       JOIN payment_intents pi ON i.intent_id = pi.id
       WHERE i.merchant_id = $1 AND i.env_mode = $2
         AND (pi.metadata @> $3 OR i.id::text = $4)
       ORDER BY i.created_at DESC
       LIMIT 1`,
      [req.merchantId, req.envMode, JSON.stringify({ order_id: orderId }), orderId]
    );

    if (!invoice) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Invoice not found for this order.' } });
    }

    if (invoice.status === 'pending') {
      return res.status(202).json({ status: 'pending' });
    }

    if (invoice.status !== 'ready' || !invoice.object_key) {
      return res.status(409).json({
        error: { code: 'invoice_not_ready', message: `Invoice status is '${invoice.status}'.` },
      });
    }

    const projectRoot = path.resolve(__dirname, '../../../');
    const objectPath = path.isAbsolute(invoice.object_key)
      ? invoice.object_key
      : path.resolve(projectRoot, invoice.object_key);

    if (!fs.existsSync(objectPath)) {
      return res.status(404).json({
        error: { code: 'invoice_file_missing', message: 'Generated PDF file not found on local storage.' },
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoice_number}.pdf"`);
    fs.createReadStream(objectPath).pipe(res);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/download', requirePermission('invoices', 'read'), async (req, res, next) => {
  try {
    const invoice = await db.queryOne(
      `SELECT * FROM invoices WHERE id = $1 AND merchant_id = $2 AND env_mode = $3`,
      [req.params.id, req.merchantId, req.envMode]
    );
    if (!invoice) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Invoice not found.' } });
    }
    if (invoice.status !== 'ready' || !invoice.object_key) {
      return res.status(409).json({
        error: { code: 'invoice_not_ready', message: `Invoice status is '${invoice.status}'.` },
      });
    }

    const projectRoot = path.resolve(__dirname, '../../../');
    const objectPath = path.isAbsolute(invoice.object_key)
      ? invoice.object_key
      : path.resolve(projectRoot, invoice.object_key);

    if (!fs.existsSync(objectPath)) {
      return res.status(404).json({
        error: { code: 'invoice_file_missing', message: 'Generated PDF file not found on local storage.' },
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoice_number}.pdf"`);
    fs.createReadStream(objectPath).pipe(res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
