const crypto = require('crypto');
const db = require('../../../backend/src/shared/db');
const logger = require('../../../backend/src/shared/logger');
const stateMachine = require('../../../backend/src/core/paymentStateMachine');
const routingEngine = require('../../../backend/src/core/routingEngine');
const vaultClient = require('../../../backend/src/core/vaultClient');
const { dispatchWebhook } = require('./webhookHandler');
const { generateInvoicePdf } = require('./invoiceHandler');

async function resolveBillingVaultToken(merchantId, envMode) {
  const existingToken = await db.queryOne(
    `SELECT token FROM vault_tokens
     WHERE (merchant_id = $1 OR merchant_id IS NULL)
       AND env_mode = $2
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [merchantId, envMode]
  );

  if (existingToken) {
    return existingToken.token;
  }

  const created = await vaultClient.tokenize({
    merchantId,
    envMode,
    card: {
      number: '4242424242424242',
      cvv: '424',
      exp_month: '12',
      exp_year: '2029',
      cardholder_name: 'Scheduled Billing Mandate',
    },
  });
  return created.token;
}

async function executeBillingRun({ runId, scheduleId, merchantId, envMode }) {
  const schedule = await db.queryOne(
    `SELECT * FROM billing_schedules WHERE id = $1 AND merchant_id = $2 AND env_mode = $3`,
    [scheduleId, merchantId, envMode]
  );

  if (!schedule) {
    logger.warn({ runId, scheduleId }, 'Billing schedule not found');
    return null;
  }

  await db.query(`UPDATE billing_runs SET status = 'processing' WHERE id = $1`, [runId]);

  try {
    const vaultToken = await resolveBillingVaultToken(merchantId, envMode);

    const intent = await stateMachine.createIntent({
      merchantId,
      envMode,
      amountCents: Number(schedule.amount_cents),
      currency: schedule.currency,
      captureMethod: 'automatic',
      customerEmail: schedule.customer_email,
      description: `Scheduled Billing: ${schedule.name}`,
      metadata: { billing_schedule_id: schedule.id, billing_run_id: runId },
      initialStatus: 'requires_confirmation',
    });

    const execution = await routingEngine.executeRoutedPayment({
      intent,
      vaultToken,
    });

    const succeeded = execution.intent.status === 'succeeded';

    await db.query(
      `UPDATE billing_runs
       SET status = $1,
           intent_id = $2,
           error_message = $3,
           executed_at = NOW()
       WHERE id = $4`,
      [
        succeeded ? 'completed' : 'failed',
        execution.intent.id,
        succeeded ? null : execution.active_attempt?.error_message || 'Scheduled charge failed',
        runId,
      ]
    );

    await db.query(
      `UPDATE billing_schedules
       SET last_run_at = NOW(),
           next_run_at = NOW() + INTERVAL '30 days'
       WHERE id = $1`,
      [schedule.id]
    );

    if (succeeded) {
      const invNum = `INV-${envMode.toUpperCase()}-SUB-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const invoice = await db.queryOne(
        `INSERT INTO invoices (invoice_number, intent_id, merchant_id, env_mode, status, amount_cents, currency, customer_email)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
         RETURNING *`,
        [
          invNum,
          execution.intent.id,
          merchantId,
          envMode,
          execution.intent.amount_cents,
          execution.intent.currency,
          schedule.customer_email,
        ]
      );

      await generateInvoicePdf({
        invoiceId: invoice.id,
        intentId: execution.intent.id,
        merchantId,
        envMode,
      });

      await dispatchWebhook({
        merchantId,
        envMode,
        eventType: 'payment.succeeded',
        payload: {
          intent_id: execution.intent.id,
          billing_run_id: runId,
          amount_cents: Number(execution.intent.amount_cents),
          currency: execution.intent.currency,
        },
      });
    }

    return execution;
  } catch (err) {
    logger.error({ err: err.message, runId }, 'Billing run execution failed');
    await db.query(
      `UPDATE billing_runs SET status = 'failed', error_message = $1 WHERE id = $2`,
      [err.message, runId]
    ).catch(() => {});
    throw err;
  }
}

module.exports = { executeBillingRun };
