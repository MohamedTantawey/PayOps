const db = require('../../../backend/src/shared/db');
const redis = require('../../../backend/src/shared/redis');
const logger = require('../../../backend/src/shared/logger');

const GROUP_NAME = 'payops_analytics_workers';
const CONSUMER_NAME = `worker_${process.pid}`;
const STREAM_MODES = ['test', 'live'];

function parseFlatFields(arr) {
  const obj = {};
  for (let i = 0; i < arr.length; i += 2) {
    obj[arr[i]] = arr[i + 1];
  }
  return obj;
}

async function ensureConsumerGroups() {
  for (const mode of STREAM_MODES) {
    const streamKey = `payops:analytics:${mode}`;
    try {
      await redis.client.xgroup('CREATE', streamKey, GROUP_NAME, '0', 'MKSTREAM');
    } catch (err) {
      if (!String(err.message).includes('BUSYGROUP')) {
        logger.debug({ err: err.message, streamKey }, 'XGROUP setup notice');
      }
    }
  }
}

async function drainAnalyticsStreams() {
  for (const mode of STREAM_MODES) {
    const streamKey = `payops:analytics:${mode}`;
    try {
      const records = await redis.client.xreadgroup(
        'GROUP',
        GROUP_NAME,
        CONSUMER_NAME,
        'COUNT',
        25,
        'STREAMS',
        streamKey,
        '>'
      );

      if (!records || records.length === 0) continue;

      for (const [, entries] of records) {
        for (const [entryId, flatFields] of entries) {
          const data = parseFlatFields(flatFields);
          if (data.merchant_id && data.event_type) {
            await db.query(
              `INSERT INTO payment_analytics_events (
                 env_mode, merchant_id, event_type, intent_id, connector,
                 amount_cents, currency, latency_ms, payload
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
              [
                mode,
                data.merchant_id,
                data.event_type,
                data.intent_id || null,
                data.connector || null,
                data.amount_cents ? Number(data.amount_cents) : null,
                data.currency || null,
                data.latency_ms ? Number(data.latency_ms) : null,
                JSON.stringify(data),
              ]
            );
          }
          await redis.client.xack(streamKey, GROUP_NAME, entryId);
        }
      }
    } catch (err) {
      logger.debug({ err: err.message, streamKey }, 'Analytics stream poll skipped');
    }
  }
}

module.exports = {
  ensureConsumerGroups,
  drainAnalyticsStreams,
};
