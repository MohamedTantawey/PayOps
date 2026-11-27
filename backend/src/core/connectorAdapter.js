// backend/src/core/connectorAdapter.js
const crypto = require('crypto');
const config = require('../shared/config');
const db = require('../shared/db');
const { decrypt } = require('../shared/crypto');
const logger = require('../shared/logger');

const SEED_DETERMINISTIC_IV_PREFIX = '010101010101010101010101:';

// Gateway Status Mapping (GSM): Hard declines abort cascade; soft/network failures trigger failover
const HARD_DECLINE_CODES = new Set([
  'insufficient_funds',
  'stolen_card',
  'lost_card',
  'invalid_cvv',
  'expired_card',
  'fraud_suspected',
  'card_declined_hard',
]);

function classifyConnectorError(errorCode, httpStatus) {
  if (errorCode && HARD_DECLINE_CODES.has(errorCode)) {
    return { retryable: false, category: 'hard_decline' };
  }
  if (httpStatus && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429) {
    if (errorCode === 'processor_declined_retryable' || errorCode === 'soft_decline') {
      return { retryable: true, category: 'soft_decline' };
    }
    return { retryable: false, category: 'client_or_hard_decline' };
  }
  return { retryable: true, category: 'processor_unavailable' };
}

async function getConnectorCredentials(merchantId, connectorName, envMode) {
  const row = await db.queryOne(
    `SELECT encrypted_credentials, metadata
     FROM merchant_connector_accounts
     WHERE merchant_id = $1 AND connector_name = $2 AND env_mode = $3 AND is_active = true`,
    [merchantId, connectorName, envMode]
  );

  if (!row) {
    return { apiKey: `default_${connectorName}_${envMode}_key`, metadata: {} };
  }

  try {
    return {
      ...JSON.parse(decrypt(row.encrypted_credentials)),
      metadata: row.metadata || {},
    };
  } catch (err) {
    if (row.encrypted_credentials.startsWith(SEED_DETERMINISTIC_IV_PREFIX)) {
      return { apiKey: `seed_${connectorName}_${envMode}_key`, metadata: row.metadata || {} };
    }
    throw err;
  }
}

class BaseHttpConnector {
  constructor({ name, baseUrl, feeBps = 250, fixedFeeCents = 30 }) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.feeBps = feeBps;
    this.fixedFeeCents = fixedFeeCents;
  }

  computeFees(amountCents) {
    const acquirerFeeCents = Math.round((Number(amountCents) * this.feeBps) / 10000) + this.fixedFeeCents;
    const interchangeCents = Math.round(acquirerFeeCents * 0.65);
    const schemeFeeCents = Math.round(acquirerFeeCents * 0.15);
    return {
      total_fee_cents: acquirerFeeCents,
      interchange_fee_cents: interchangeCents,
      scheme_fee_cents: schemeFeeCents,
      acquirer_markup_cents: acquirerFeeCents - interchangeCents - schemeFeeCents,
    };
  }

  async _postJson(path, payload, credentials, timeoutMs = 4500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Connector-Api-Key': credentials.apiKey || '',
          'X-Connector-Name': this.name,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - start;
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.status === 'failed') {
        const errorCode = data.error_code || (response.status >= 500 ? 'upstream_5xx' : 'connector_declined');
        const gsm = classifyConnectorError(errorCode, response.status);
        return {
          ok: false,
          httpStatus: response.status,
          latencyMs,
          errorCode,
          errorMessage: data.error_message || `Connector ${this.name} returned HTTP ${response.status}`,
          retryable: gsm.retryable,
          category: gsm.category,
          raw: data,
        };
      }

      return {
        ok: true,
        httpStatus: response.status,
        latencyMs,
        connectorTransactionId: data.transaction_id || data.id || `${this.name}_tx_${crypto.randomUUID().slice(0, 12)}`,
        status: data.status || 'succeeded',
        raw: data,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const isTimeout = err.name === 'AbortError';
      return {
        ok: false,
        httpStatus: isTimeout ? 504 : 503,
        latencyMs,
        errorCode: isTimeout ? 'connector_timeout' : 'connector_unreachable',
        errorMessage: isTimeout
          ? `Connector ${this.name} timed out after ${timeoutMs}ms`
          : `Connector ${this.name} network error: ${err.message}`,
        retryable: true,
        category: 'processor_unavailable',
        raw: {},
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async authorize({ intent, attempt, detokenizedCard, credentials }) {
    const res = await this._postJson(
      '/v1/charges',
      {
        intent_id: intent.id,
        attempt_id: attempt.id,
        amount_cents: Number(intent.amount_cents),
        currency: intent.currency,
        capture_method: intent.capture_method,
        card: {
          last4: detokenizedCard.last4,
          card_network: detokenizedCard.card_network,
          exp_month: detokenizedCard.card.exp_month,
          exp_year: detokenizedCard.card.exp_year,
        },
      },
      credentials
    );

    return {
      ...res,
      fees: res.ok ? this.computeFees(intent.amount_cents) : null,
    };
  }

  async capture({ connectorTransactionId, amountCents, currency, credentials }) {
    return this._postJson(
      `/v1/charges/${encodeURIComponent(connectorTransactionId)}/capture`,
      { amount_cents: Number(amountCents), currency },
      credentials
    );
  }

  async refund({ connectorTransactionId, amountCents, currency, reason, credentials }) {
    const res = await this._postJson(
      '/v1/refunds',
      {
        transaction_id: connectorTransactionId,
        amount_cents: Number(amountCents),
        currency,
        reason,
      },
      credentials
    );
    return {
      ...res,
      connectorRefundId: res.raw?.refund_id || (res.ok ? `${this.name}_re_${crypto.randomUUID().slice(0, 10)}` : null),
    };
  }

  verifyWebhook(rawBody, signatureHeader, secret) {
    if (!signatureHeader || !secret) return false;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
      .digest('hex');
    const cleanSig = String(signatureHeader).replace(/^sha256=/, '');
    if (expected.length !== cleanSig.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(cleanSig));
  }
}

class MockStripeConnector extends BaseHttpConnector {
  constructor() {
    super({
      name: 'mock_stripe',
      baseUrl: config.connectors.mockStripeUrl,
      feeBps: 290, // 2.9% + 30c
      fixedFeeCents: 30,
    });
  }
}

class MockPaymobConnector extends BaseHttpConnector {
  constructor() {
    // Note: mock-psp runs both gateways cleanly; supports separate URL or path namespace
    super({
      name: 'mock_paymo',
      baseUrl: config.connectors.mockPaymoUrl,
      feeBps: 225, // 2.25% + 20c
      fixedFeeCents: 20,
    });
  }
}

const adapters = {
  mock_stripe: new MockStripeConnector(),
  mock_paymo: new MockPaymobConnector(),
  mock_paymob: new MockPaymobConnector(),
};

function getConnectorAdapter(connectorName) {
  const normalized = String(connectorName || '').toLowerCase();
  const adapter = adapters[normalized];
  if (!adapter) {
    throw Object.assign(new Error(`Unsupported payment connector '${connectorName}'.`), {
      statusCode: 400,
      code: 'unsupported_connector',
    });
  }
  return adapter;
}

module.exports = {
  getConnectorAdapter,
  getConnectorCredentials,
  classifyConnectorError,
  adapters,
};
