const crypto = require('crypto');
const config = require('../../../backend/src/shared/config');
const db = require('../../../backend/src/shared/db');
const logger = require('../../../backend/src/shared/logger');

function signWebhookPayload(rawBody, secret, timestamp) {
  const signedPayload = `${timestamp}.${rawBody}`;
  const digest = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

async function sendSignedHttpWebhook({ targetUrl, signingSecret, eventType, deliveryId, payload }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const bodyObj = {
    id: deliveryId,
    event_type: eventType,
    created_at: new Date().toISOString(),
    data: payload,
  };
  const rawBody = JSON.stringify(bodyObj);
  const signature = signWebhookPayload(rawBody, signingSecret, timestamp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const start = Date.now();

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PayOps-Webhook-Dispatcher/1.0',
        'X-PayOps-Event': eventType,
        'X-PayOps-Delivery-Id': deliveryId,
        'X-PayOps-Timestamp': String(timestamp),
        'X-PayOps-Signature': signature,
      },
      body: rawBody,
      signal: controller.signal,
    });

    const durationMs = Date.now() - start;
    const responseText = (await res.text().catch(() => '')).slice(0, 1000);

    return {
      ok: res.ok,
      statusCode: res.status,
      responseBody: responseText,
      errorMessage: res.ok ? null : `Endpoint returned HTTP ${res.status}`,
      durationMs,
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: err.name === 'AbortError' ? 504 : 503,
      responseBody: null,
      errorMessage: err.name === 'AbortError' ? 'Webhook target timed out after 5000ms' : err.message,
      durationMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchWebhook({ merchantId, envMode, eventType, payload }) {
  const endpointsRes = await db.query(
    `SELECT * FROM webhook_endpoints
     WHERE merchant_id = $1
       AND env_mode = $2
       AND active = true
       AND ($3 = ANY(events) OR '*' = ANY(events))`,
    [merchantId, envMode, eventType]
  );

  if (endpointsRes.rows.length === 0) {
    logger.debug({ merchantId, envMode, eventType }, 'No active webhook endpoints subscribed to event');
    return [];
  }

  const deliveries = [];
  for (const endpoint of endpointsRes.rows) {
    const pendingRow = await db.queryOne(
      `INSERT INTO webhook_deliveries (
         endpoint_id, merchant_id, env_mode, event_type, target_url, payload, status, attempt_count
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending', 1)
       RETURNING *`,
      [endpoint.id, merchantId, envMode, eventType, endpoint.target_url, JSON.stringify(payload || {})]
    );

    const outcome = await sendSignedHttpWebhook({
      targetUrl: endpoint.target_url,
      signingSecret: endpoint.signing_secret || config.security.webhookSigningSecret,
      eventType,
      deliveryId: pendingRow.id,
      payload,
    });

    const finalRow = await db.queryOne(
      `UPDATE webhook_deliveries
       SET status = $1::varchar,
           status_code = $2,
           response_body = $3,
           error_message = $4,
           duration_ms = $5,
           delivered_at = CASE WHEN $1::text = 'success' THEN NOW() ELSE delivered_at END
       WHERE id = $6
       RETURNING *`,
      [
        outcome.ok ? 'success' : 'failed',
        outcome.statusCode,
        outcome.responseBody,
        outcome.errorMessage,
        outcome.durationMs,
        pendingRow.id,
      ]
    );

    deliveries.push(finalRow);
  }

  return deliveries;
}

async function replayWebhook({ deliveryId, merchantId, envMode }) {
  const existing = await db.queryOne(
    `SELECT wd.*, we.signing_secret
     FROM webhook_deliveries wd
     LEFT JOIN webhook_endpoints we ON we.id = wd.endpoint_id
     WHERE wd.id = $1 AND wd.merchant_id = $2 AND wd.env_mode = $3`,
    [deliveryId, merchantId, envMode]
  );

  if (!existing) {
    logger.warn({ deliveryId }, 'Webhook delivery not found for replay');
    return null;
  }

  const outcome = await sendSignedHttpWebhook({
    targetUrl: existing.target_url,
    signingSecret: existing.signing_secret || config.security.webhookSigningSecret,
    eventType: existing.event_type,
    deliveryId: existing.id,
    payload: existing.payload,
  });

  return db.queryOne(
    `UPDATE webhook_deliveries
     SET status = $1::varchar,
         status_code = $2,
         attempt_count = attempt_count + 1,
         response_body = $3,
         error_message = $4,
         duration_ms = $5,
         delivered_at = CASE WHEN $1::text = 'success' THEN NOW() ELSE delivered_at END
     WHERE id = $6
     RETURNING *`,
    [
      outcome.ok ? 'success' : 'failed',
      outcome.statusCode,
      outcome.responseBody,
      outcome.errorMessage,
      outcome.durationMs,
      existing.id,
    ]
  );
}

module.exports = {
  signWebhookPayload,
  dispatchWebhook,
  replayWebhook,
};
