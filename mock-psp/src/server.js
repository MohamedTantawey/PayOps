const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const pino = require('pino');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'payops-mock-psp' },
});

const STRIPE_PORT = parseInt(process.env.MOCK_PSP_PORT || '4001', 10);
const PAYMO_PORT = parseInt(process.env.MOCK_PAYMO_PORT || '4002', 10);

const chaosState = {
  mock_stripe: {
    failureRate: 0,
    latencyMs: 60,
    forceMode: 'healthy',
  },
  mock_paymo: {
    failureRate: 0,
    latencyMs: 85,
    forceMode: 'healthy',
  },
};

const receivedWebhooks = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildGatewayApp(defaultGatewayName) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      gateway: defaultGatewayName,
      chaos: chaosState[defaultGatewayName],
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/admin/chaos', (req, res) => {
    res.json({ gateways: chaosState });
  });

  app.post('/admin/chaos', (req, res) => {
    const { gateway, failureRate, latencyMs, forceMode } = req.body || {};
    const target = gateway || defaultGatewayName;
    if (!chaosState[target]) {
      return res.status(400).json({ error: `Unknown gateway '${target}'` });
    }
    if (failureRate !== undefined) {
      chaosState[target].failureRate = Math.max(0, Math.min(1, Number(failureRate)));
    }
    if (latencyMs !== undefined) {
      chaosState[target].latencyMs = Math.max(0, Math.min(10000, Number(latencyMs)));
    }
    if (forceMode !== undefined) {
      chaosState[target].forceMode = String(forceMode);
    }
    logger.info({ target, state: chaosState[target] }, 'Updated Mock PSP chaos configuration');
    return res.json({ gateway: target, state: chaosState[target], gateways: chaosState });
  });

  app.post('/v1/charges', async (req, res) => {
    const gateway = req.headers['x-connector-name'] || defaultGatewayName;
    const cfg = chaosState[gateway] || chaosState[defaultGatewayName];
    const { amount_cents, currency = 'USD', capture_method = 'automatic', card = {} } = req.body || {};

    if (cfg.latencyMs > 0) {
      await sleep(cfg.latencyMs);
    }

    if (cfg.forceMode === 'timeout') {
      await sleep(6000);
      return res.status(504).json({
        status: 'failed',
        error_code: 'gateway_timeout',
        error_message: `${gateway} simulated upstream timeout`,
      });
    }

    if (cfg.forceMode === '5xx' || cfg.forceMode === 'outage') {
      return res.status(503).json({
        status: 'failed',
        error_code: 'processor_unavailable',
        error_message: `${gateway} is currently experiencing a simulated 503 outage`,
      });
    }

    if (cfg.forceMode === 'soft_decline') {
      return res.status(402).json({
        status: 'failed',
        error_code: 'soft_decline',
        error_message: `${gateway} temporary issuer soft decline (retryable)`,
      });
    }

    if (cfg.forceMode === 'hard_decline' || card.last4 === '0002') {
      return res.status(402).json({
        status: 'failed',
        error_code: 'insufficient_funds',
        error_message: 'Card declined permanently due to insufficient funds (non-retryable)',
      });
    }

    if (card.last4 === '9999' && gateway === 'mock_stripe') {
      return res.status(503).json({
        status: 'failed',
        error_code: 'upstream_5xx',
        error_message: 'Deterministic MockStripe outage trigger for card ending 9999',
      });
    }

    if (cfg.failureRate > 0 && Math.random() < cfg.failureRate) {
      return res.status(502).json({
        status: 'failed',
        error_code: 'upstream_5xx',
        error_message: `${gateway} probabilistic chaos failure (${Math.round(cfg.failureRate * 100)}%)`,
      });
    }

    const txId = `${gateway}_ch_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    return res.status(200).json({
      id: txId,
      transaction_id: txId,
      gateway,
      amount_cents,
      currency,
      status: capture_method === 'manual' ? 'authorized' : 'succeeded',
      created_at: new Date().toISOString(),
    });
  });

  app.post('/v1/charges/:id/capture', async (req, res) => {
    const gateway = req.headers['x-connector-name'] || defaultGatewayName;
    const cfg = chaosState[gateway] || chaosState[defaultGatewayName];
    if (cfg.latencyMs > 0) await sleep(cfg.latencyMs);

    if (cfg.forceMode === '5xx' || cfg.forceMode === 'outage') {
      return res.status(503).json({
        status: 'failed',
        error_code: 'processor_unavailable',
        error_message: `${gateway} capture failed due to simulated outage`,
      });
    }

    return res.status(200).json({
      id: req.params.id,
      transaction_id: req.params.id,
      gateway,
      status: 'succeeded',
      captured_at: new Date().toISOString(),
    });
  });

  app.post('/v1/refunds', async (req, res) => {
    const gateway = req.headers['x-connector-name'] || defaultGatewayName;
    const cfg = chaosState[gateway] || chaosState[defaultGatewayName];
    if (cfg.latencyMs > 0) await sleep(cfg.latencyMs);

    if (cfg.forceMode === '5xx' || cfg.forceMode === 'outage') {
      return res.status(503).json({
        status: 'failed',
        error_code: 'processor_unavailable',
        error_message: `${gateway} refund unavailable during outage`,
      });
    }

    const refundId = `${gateway}_re_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
    return res.status(200).json({
      refund_id: refundId,
      transaction_id: req.body?.transaction_id,
      gateway,
      status: 'succeeded',
      created_at: new Date().toISOString(),
    });
  });

  app.post('/webhook', (req, res) => {
    const entry = {
      id: crypto.randomUUID(),
      signature: req.headers['x-payops-signature'] || null,
      event_type: req.headers['x-payops-event'] || req.body?.event_type || 'unknown',
      payload: req.body,
      received_at: new Date().toISOString(),
    };
    receivedWebhooks.unshift(entry);
    if (receivedWebhooks.length > 100) receivedWebhooks.pop();
    logger.info({ event: entry.event_type, signaturePresent: Boolean(entry.signature) }, 'Mock webhook sink received event');
    res.status(200).json({ received: true, id: entry.id });
  });

  app.get('/webhooks/received', (req, res) => {
    res.json({ count: receivedWebhooks.length, items: receivedWebhooks });
  });

  return app;
}

const stripeApp = buildGatewayApp('mock_stripe');
const paymoApp = buildGatewayApp('mock_paymo');

const s1 = stripeApp.listen(STRIPE_PORT, () => {
  logger.info({ port: STRIPE_PORT }, 'MockStripe PSP & Webhook Sink listening');
});

const s2 = paymoApp.listen(PAYMO_PORT, () => {
  logger.info({ port: PAYMO_PORT }, 'MockPaymob PSP listening');
});

function shutdown() {
  s1.close(() => {});
  s2.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
