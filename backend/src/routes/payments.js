const crypto = require('crypto');
const express = require('express');
const db = require('../shared/db');
const { authenticateApiKey, requirePermission } = require('../middleware/authRbac');
const { idempotencyMiddleware } = require('../middleware/idempotency');
const vaultClient = require('../core/vaultClient');
const stateMachine = require('../core/paymentStateMachine');
const hostedCheckout = require('../core/hostedCheckout');
const routingEngine = require('../core/routingEngine');
const { getConnectorAdapter, getConnectorCredentials } = require('../core/connectorAdapter');
const { enqueueWebhookEvent, enqueueInvoiceGeneration } = require('../queue/jobQueue');
const { paymentIntentsTotal, routingFailoversTotal, renderMetrics } = require('../observability/metrics');

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function publishExecutionOutcome(execution, { merchantId, envMode, autoInvoice = true }) {
  const finalConnector = execution.active_attempt?.connector || 'none';
  paymentIntentsTotal.labels(envMode, execution.intent.status, finalConnector).inc();

  if (execution.routing_summary.failover_triggered && execution.attempts.length >= 2) {
    routingFailoversTotal
      .labels(envMode, execution.attempts[0].connector, finalConnector)
      .inc();
  }

  const eventType =
    execution.intent.status === 'succeeded' || execution.intent.status === 'requires_capture'
      ? 'payment.succeeded'
      : 'payment.failed';

  await enqueueWebhookEvent({
    merchantId,
    envMode,
    eventType,
    payload: {
      intent_id: execution.intent.id,
      amount_cents: Number(execution.intent.amount_cents),
      currency: execution.intent.currency,
      status: execution.intent.status,
      connector: finalConnector,
      attempt_count: execution.attempts.length,
      failover_triggered: execution.routing_summary.failover_triggered,
      metadata: execution.intent.metadata || {},
    },
  });

  if (autoInvoice && execution.intent.status === 'succeeded') {
    const invoiceNumber = `INV-${envMode.toUpperCase()}-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const invoice = await db.queryOne(
      `INSERT INTO invoices (invoice_number, intent_id, merchant_id, env_mode, status, amount_cents, currency, customer_email)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
       RETURNING *`,
      [
        invoiceNumber,
        execution.intent.id,
        merchantId,
        envMode,
        execution.intent.amount_cents,
        execution.intent.currency,
        execution.intent.customer_email,
      ]
    );
    await enqueueInvoiceGeneration({
      invoiceId: invoice.id,
      intentId: execution.intent.id,
      merchantId,
      envMode,
    });
    return invoice;
  }
  return null;
}

router.get('/health', async (req, res) => {
  res.json({ service: 'payments-module', status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/metrics', renderMetrics);

router.get('/checkout/:id', async (req, res, next) => {
  try {
    if (!UUID_PATTERN.test(req.params.id)) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Checkout session not found.' } });
    }
    const session = await hostedCheckout.findHostedCheckout(req.params.id, req.get('x-checkout-secret'));
    if (!session) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Checkout session not found.' } });
    }
    if (new Date(session.expires_at) <= new Date() && session.status !== 'succeeded') {
      return res.status(410).json({ error: { code: 'checkout_expired', message: 'This checkout session has expired.' } });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      checkout: {
        intent_id: session.id,
        amount_cents: Number(session.amount_cents),
        currency: session.currency,
        status: session.status,
        customer_email: session.customer_email,
        description: session.description,
        return_url: session.return_url,
        cancel_url: session.cancel_url,
        expires_at: session.expires_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/checkout/:id/confirm', async (req, res, next) => {
  try {
    if (!UUID_PATTERN.test(req.params.id)) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Checkout session not found.' } });
    }
    const session = await hostedCheckout.findHostedCheckout(req.params.id, req.get('x-checkout-secret'));
    if (!session) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Checkout session not found.' } });
    }
    if (session.status === 'succeeded') {
      return res.json({
        intent: { id: session.id, status: session.status },
        redirect_url: session.return_url,
      });
    }
    if (new Date(session.expires_at) <= new Date()) {
      return res.status(410).json({ error: { code: 'checkout_expired', message: 'This checkout session has expired.' } });
    }
    if (!['requires_payment_method', 'requires_confirmation', 'failed'].includes(session.status)) {
      return res.status(409).json({
        error: { code: 'checkout_not_payable', message: `Checkout cannot be paid while the intent is '${session.status}'.` },
      });
    }

    const execution = await routingEngine.executeRoutedPayment({
      intent: session,
      card: req.body?.card || null,
      vaultToken: req.body?.vault_token || null,
    });
    await publishExecutionOutcome(execution, {
      merchantId: session.merchant_id,
      envMode: session.env_mode,
    });

    return res.json({
      intent: {
        id: execution.intent.id,
        status: execution.intent.status,
        amount_cents: Number(execution.intent.amount_cents),
        currency: execution.intent.currency,
      },
      redirect_url: execution.intent.status === 'succeeded' ? session.return_url : null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/checkout/:id/cancel', async (req, res, next) => {
  try {
    if (!UUID_PATTERN.test(req.params.id)) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Checkout session not found.' } });
    }
    const session = await hostedCheckout.findHostedCheckout(req.params.id, req.get('x-checkout-secret'));
    if (!session) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Checkout session not found.' } });
    }
    if (['succeeded', 'processing', 'requires_capture'].includes(session.status)) {
      return res.status(409).json({
        error: { code: 'checkout_not_cancelable', message: `Checkout cannot be canceled while the intent is '${session.status}'.` },
      });
    }

    if (session.status !== 'canceled') {
      const intent = await stateMachine.transitionIntent(session.id, 'canceled');
      await enqueueWebhookEvent({
        merchantId: session.merchant_id,
        envMode: session.env_mode,
        eventType: 'payment.canceled',
        payload: {
          intent_id: intent.id,
          amount_cents: Number(intent.amount_cents),
          currency: intent.currency,
          status: intent.status,
          metadata: intent.metadata || {},
        },
      });
    }
    return res.json({
      intent: { id: session.id, status: 'canceled' },
      redirect_url: session.cancel_url,
    });
  } catch (err) {
    next(err);
  }
});

router.use(authenticateApiKey);

router.post('/tokenize', requirePermission('payments', 'write'), async (req, res, next) => {
  try {
    const tokenRecord = await vaultClient.tokenize({
      merchantId: req.merchantId,
      envMode: req.envMode,
      card: req.body?.card,
    });
    res.status(201).json({ object: 'vault_token', ...tokenRecord });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  requirePermission('payments', 'write'),
  idempotencyMiddleware(),
  async (req, res, next) => {
    try {
      const {
        amount_cents,
        currency = 'USD',
        capture_method = 'automatic',
        confirm = true,
        customer_email = null,
        description = null,
        metadata = {},
        return_url = null,
        cancel_url = null,
        card = null,
        vault_token = null,
        auto_invoice = true,
      } = req.body || {};

      const parsedAmount = Number(amount_cents);
      if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({
          error: { code: 'invalid_amount', message: '`amount_cents` must be a positive integer.' },
        });
      }

      if (return_url || cancel_url) {
        hostedCheckout.validateRedirectUrl(return_url);
        hostedCheckout.validateRedirectUrl(cancel_url);
      }

      const intent = await stateMachine.createIntent({
        merchantId: req.merchantId,
        envMode: req.envMode,
        amountCents: parsedAmount,
        currency,
        captureMethod: capture_method === 'manual' ? 'manual' : 'automatic',
        customerEmail: customer_email,
        description,
        metadata,
        idempotencyKey: req.idempotencyKey || null,
        initialStatus: card || vault_token ? 'requires_confirmation' : 'requires_payment_method',
      });

      if (return_url || cancel_url) {
        const hosted = await hostedCheckout.createHostedCheckout(intent.id, return_url, cancel_url);
        intent.pay_path = hosted.payPath;
        intent.checkout_expires_at = hosted.expiresAt.toISOString();
      }

      if (!confirm || (!card && !vault_token)) {
        return res.status(201).json({ intent, attempts: [] });
      }

      const execution = await routingEngine.executeRoutedPayment({
        intent,
        card,
        vaultToken: vault_token,
      });

      const invoice = await publishExecutionOutcome(execution, {
        merchantId: req.merchantId,
        envMode: req.envMode,
        autoInvoice: auto_invoice,
      });

      return res.status(201).json({
        ...execution,
        invoice,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/confirm',
  requirePermission('payments', 'write'),
  idempotencyMiddleware(),
  async (req, res, next) => {
    try {
      const intent = await db.queryOne(
        `SELECT * FROM payment_intents WHERE id = $1 AND merchant_id = $2 AND env_mode = $3`,
        [req.params.id, req.merchantId, req.envMode]
      );
      if (!intent) {
        return res.status(404).json({ error: { code: 'not_found', message: 'PaymentIntent not found.' } });
      }

      const execution = await routingEngine.executeRoutedPayment({
        intent,
        card: req.body?.card || null,
        vaultToken: req.body?.vault_token || null,
      });

      const invoice = await publishExecutionOutcome(execution, {
        merchantId: req.merchantId,
        envMode: req.envMode,
        autoInvoice: req.body?.auto_invoice !== false,
      });
      return res.json({ ...execution, invoice });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/cancel',
  requirePermission('payments', 'write'),
  idempotencyMiddleware(),
  async (req, res, next) => {
    try {
      const intent = await db.queryOne(
        `SELECT * FROM payment_intents WHERE id = $1 AND merchant_id = $2 AND env_mode = $3`,
        [req.params.id, req.merchantId, req.envMode]
      );
      if (!intent) {
        return res.status(404).json({ error: { code: 'not_found', message: 'PaymentIntent not found.' } });
      }
      if (intent.status === 'succeeded' || intent.status === 'requires_capture' || intent.status === 'processing') {
        return res.status(409).json({
          error: { code: 'invalid_cancel_state', message: `Payment cannot be canceled while the intent is '${intent.status}'.` },
        });
      }
      if (intent.status === 'canceled') return res.json({ intent });
      if (!['requires_payment_method', 'requires_confirmation', 'failed'].includes(intent.status)) {
        return res.status(409).json({
          error: { code: 'invalid_cancel_state', message: `Payment cannot be canceled while the intent is '${intent.status}'.` },
        });
      }
      const canceled = await stateMachine.transitionIntent(intent.id, 'canceled');
      await enqueueWebhookEvent({
        merchantId: req.merchantId,
        envMode: req.envMode,
        eventType: 'payment.canceled',
        payload: {
          intent_id: canceled.id,
          amount_cents: Number(canceled.amount_cents),
          currency: canceled.currency,
          status: canceled.status,
          metadata: canceled.metadata || {},
        },
      });
      return res.json({ intent: canceled });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/capture',
  requirePermission('payments', 'write'),
  idempotencyMiddleware(),
  async (req, res, next) => {
    try {
      const intent = await db.queryOne(
        `SELECT * FROM payment_intents WHERE id = $1 AND merchant_id = $2 AND env_mode = $3`,
        [req.params.id, req.merchantId, req.envMode]
      );
      if (!intent) {
        return res.status(404).json({ error: { code: 'not_found', message: 'PaymentIntent not found.' } });
      }
      if (intent.status !== 'requires_capture') {
        return res.status(409).json({
          error: {
            code: 'invalid_capture_state',
            message: `Intent must be in 'requires_capture' state (currently '${intent.status}').`,
          },
        });
      }

      const attempt = await db.queryOne(`SELECT * FROM payment_attempts WHERE id = $1`, [
        intent.active_attempt_id,
      ]);
      const adapter = getConnectorAdapter(attempt.connector);
      const credentials = await getConnectorCredentials(req.merchantId, attempt.connector, req.envMode);

      const capRes = await adapter.capture({
        connectorTransactionId: attempt.connector_transaction_id,
        amountCents: req.body?.amount_cents || intent.amount_cents,
        currency: intent.currency,
        credentials,
      });

      if (!capRes.ok) {
        return res.status(502).json({
          error: { code: capRes.errorCode, message: capRes.errorMessage },
        });
      }

      const updatedAttempt = await stateMachine.finalizeAttempt(attempt.id, attempt.status, 'charged');
      const updatedIntent = await stateMachine.transitionIntent(intent.id, 'succeeded');

      return res.json({ intent: updatedIntent, active_attempt: updatedAttempt });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/refund',
  requirePermission('payments', 'write'),
  idempotencyMiddleware(),
  async (req, res, next) => {
    try {
      const intent = await db.queryOne(
        `SELECT * FROM payment_intents WHERE id = $1 AND merchant_id = $2 AND env_mode = $3`,
        [req.params.id, req.merchantId, req.envMode]
      );
      if (!intent) {
        return res.status(404).json({ error: { code: 'not_found', message: 'PaymentIntent not found.' } });
      }
      if (intent.status !== 'succeeded') {
        return res.status(409).json({
          error: { code: 'invalid_refund_state', message: 'Only succeeded payments can be refunded.' },
        });
      }

      const attempt = await db.queryOne(`SELECT * FROM payment_attempts WHERE id = $1`, [
        intent.active_attempt_id,
      ]);
      const refundAmount = Number(req.body?.amount_cents || intent.amount_cents);
      const reason = req.body?.reason || 'requested_by_customer';

      const adapter = getConnectorAdapter(attempt.connector);
      const credentials = await getConnectorCredentials(req.merchantId, attempt.connector, req.envMode);
      const refRes = await adapter.refund({
        connectorTransactionId: attempt.connector_transaction_id,
        amountCents: refundAmount,
        currency: intent.currency,
        reason,
        credentials,
      });

      const refundRow = await db.queryOne(
        `INSERT INTO refunds (
           intent_id, attempt_id, env_mode, merchant_id, connector,
           connector_transaction_id, connector_refund_id, amount_cents, currency, refund_status, reason
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          intent.id,
          attempt.id,
          req.envMode,
          req.merchantId,
          attempt.connector,
          attempt.connector_transaction_id,
          refRes.connectorRefundId,
          refundAmount,
          intent.currency,
          refRes.ok ? 'succeeded' : 'failed',
          reason,
        ]
      );

      if (refRes.ok) {
        await enqueueWebhookEvent({
          merchantId: req.merchantId,
          envMode: req.envMode,
          eventType: 'refund.succeeded',
          payload: {
            refund_id: refundRow.id,
            intent_id: intent.id,
            amount_cents: refundAmount,
            currency: intent.currency,
            connector: attempt.connector,
          },
        });
      }

      return res.status(refRes.ok ? 201 : 502).json({ refund: refundRow });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/', requirePermission('payments', 'read'), async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '25', 10)));
    const result = await db.query(
      `SELECT pi.*,
              pa.connector AS active_connector,
              pa.connector_transaction_id,
              pa.error_code AS last_error_code,
              pa.metadata AS attempt_metadata
       FROM payment_intents pi
       LEFT JOIN payment_attempts pa ON pa.id = pi.active_attempt_id
       WHERE pi.merchant_id = $1 AND pi.env_mode = $2
       ORDER BY pi.created_at DESC
       LIMIT $3`,
      [req.merchantId, req.envMode, limit]
    );
    res.json({ mode: req.envMode, count: result.rows.length, items: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission('payments', 'read'), async (req, res, next) => {
  try {
    const intent = await db.queryOne(
      `SELECT * FROM payment_intents WHERE id = $1 AND merchant_id = $2 AND env_mode = $3`,
      [req.params.id, req.merchantId, req.envMode]
    );
    if (!intent) {
      return res.status(404).json({ error: { code: 'not_found', message: 'PaymentIntent not found.' } });
    }

    const attemptsRes = await db.query(
      `SELECT * FROM payment_attempts WHERE intent_id = $1 ORDER BY attempt_index ASC`,
      [intent.id]
    );
    const refundsRes = await db.query(
      `SELECT * FROM refunds WHERE intent_id = $1 ORDER BY created_at DESC`,
      [intent.id]
    );

    res.json({
      intent,
      attempts: attemptsRes.rows,
      refunds: refundsRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
