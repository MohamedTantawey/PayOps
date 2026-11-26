const http = require('http');
const logger = require('../../backend/src/shared/logger');
const db = require('../../backend/src/shared/db');
const redis = require('../../backend/src/shared/redis');
const { JOB_QUEUE_KEY } = require('../../backend/src/queue/jobQueue');
const { dispatchWebhook, replayWebhook } = require('./handlers/webhookHandler');
const { generateInvoicePdf } = require('./handlers/invoiceHandler');
const { executeBillingRun } = require('./handlers/billingHandler');
const { ensureConsumerGroups, drainAnalyticsStreams } = require('./handlers/analyticsConsumer');

const workerPort = parseInt(process.env.WORKER_PORT || '3001', 10);

let running = true;
let jobsProcessed = 0;
let jobsFailed = 0;
let blockingRedis = null;
let analyticsTimer = null;

async function routeJob(job) {
  switch (job.type) {
    case 'webhook.dispatch':
      return dispatchWebhook(job.data);
    case 'webhook.replay':
      return replayWebhook(job.data);
    case 'invoice.generate':
      return generateInvoicePdf(job.data);
    case 'billing.execute_run':
      return executeBillingRun(job.data);
    default:
      logger.warn({ type: job.type }, 'Unrecognized background job type');
      return null;
  }
}

async function startQueueLoop() {
  blockingRedis = redis.client.duplicate();
  blockingRedis.on('error', (err) => {
    logger.warn({ err: err.message }, 'Worker blocking Redis client error');
  });

  if (blockingRedis.status === 'wait') {
    await blockingRedis.connect().catch(() => {});
  }

  await ensureConsumerGroups().catch(() => {});

  analyticsTimer = setInterval(() => {
    if (running) {
      drainAnalyticsStreams().catch(() => {});
    }
  }, 3000);

  logger.info({ queue: JOB_QUEUE_KEY }, 'PayOps Worker job loop started');

  while (running) {
    try {
      const item = await blockingRedis.brpop(JOB_QUEUE_KEY, 2);
      if (!item) continue;

      const [, rawJson] = item;
      const job = JSON.parse(rawJson);
      job.attempts = (job.attempts || 0) + 1;

      try {
        await routeJob(job);
        jobsProcessed += 1;
      } catch (jobErr) {
        jobsFailed += 1;
        logger.error(
          { jobId: job.id, type: job.type, attempt: job.attempts, err: jobErr.message },
          'Background job execution error'
        );
        if (job.attempts < (job.maxAttempts || 3)) {
          await redis.client.lpush(JOB_QUEUE_KEY, JSON.stringify(job)).catch(() => {});
        }
      }
    } catch (loopErr) {
      if (!running) break;
      logger.debug({ err: loopErr.message }, 'Worker BRPOP cycle backoff');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    try {
      const dbLatencyMs = await db.pingDatabase();
      const redisLatencyMs = await redis.pingRedis();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'healthy',
          worker: true,
          jobs_processed: jobsProcessed,
          jobs_failed: jobsFailed,
          dbLatencyMs,
          redisLatencyMs,
          timestamp: new Date().toISOString(),
        })
      );
    } catch (e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'unhealthy', error: e.message }));
    }
  } else {
    res.writeHead(404).end();
  }
});

async function start() {
  server.listen(workerPort, '0.0.0.0', () => {
    logger.info({ port: workerPort }, 'PayOps Worker health server listening');
  });
  startQueueLoop();
}

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down PayOps Worker');
  running = false;
  if (analyticsTimer) clearInterval(analyticsTimer);
  server.close();
  if (blockingRedis) {
    await blockingRedis.quit().catch(() => {});
  }
  await db.close().catch(() => {});
  await redis.close().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (require.main === module) {
  start();
}

module.exports = { server, routeJob };
