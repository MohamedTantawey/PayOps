const crypto = require('crypto');
const redis = require('../shared/redis');
const logger = require('../shared/logger');

const JOB_QUEUE_KEY = 'payops:jobs:queue';

async function enqueueJob(type, data) {
  const job = {
    id: crypto.randomUUID(),
    type,
    data,
    attempts: 0,
    maxAttempts: 3,
    createdAt: new Date().toISOString(),
  };

  try {
    await redis.client.lpush(JOB_QUEUE_KEY, JSON.stringify(job));
    logger.debug({ jobId: job.id, type }, 'Enqueued background job');
    return job;
  } catch (err) {
    logger.warn({ err: err.message, type }, 'Failed to enqueue background job to Redis');
    return null;
  }
}

async function enqueueWebhookEvent({ merchantId, envMode, eventType, payload }) {
  return enqueueJob('webhook.dispatch', { merchantId, envMode, eventType, payload });
}

async function enqueueWebhookReplay({ deliveryId, merchantId, envMode }) {
  return enqueueJob('webhook.replay', { deliveryId, merchantId, envMode });
}

async function enqueueInvoiceGeneration({ invoiceId, intentId, merchantId, envMode }) {
  return enqueueJob('invoice.generate', { invoiceId, intentId, merchantId, envMode });
}

async function enqueueBillingRun({ runId, scheduleId, merchantId, envMode }) {
  return enqueueJob('billing.execute_run', { runId, scheduleId, merchantId, envMode });
}

module.exports = {
  JOB_QUEUE_KEY,
  enqueueJob,
  enqueueWebhookEvent,
  enqueueWebhookReplay,
  enqueueInvoiceGeneration,
  enqueueBillingRun,
};
