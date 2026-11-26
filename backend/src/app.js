// backend/src/app.js
const express = require('express');
const cors = require('cors');
const os = require('os');
const config = require('./shared/config');
const db = require('./shared/db');
const redis = require('./shared/redis');

function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(cors({ exposedHeaders: ['X-Trace-Id', 'X-PayOps-Mode', 'X-PayOps-Commit'] }));
  app.use(express.json({ limit: '2mb' }));

  // Trace ID & Env Mode Middleware
  app.use((req, res, next) => {
    req.traceId = req.headers['x-trace-id'] || require('crypto').randomUUID();
    req.envMode = req.headers['x-payops-mode'] || config.appDefaultMode;
    res.setHeader('X-Trace-Id', req.traceId);
    res.setHeader('X-PayOps-Mode', req.envMode);
    res.setHeader('X-PayOps-Commit', config.gitCommitSha);
    next();
  });

  // GET /health probe
  app.get('/health', async (req, res) => {
    try {
      const dbLatencyMs = await db.pingDatabase().catch(() => null);
      const redisLatencyMs = await redis.pingRedis().catch(() => null);
      const isHealthy = dbLatencyMs !== null && redisLatencyMs !== null;
      res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'degraded',
        dbLatencyMs,
        redisLatencyMs,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(503).json({ status: 'unhealthy', error: err.message });
    }
  });

  // GET /status telemetry endpoint
  app.get('/status', async (req, res) => {
    const [dbLatencyMs, redisLatencyMs] = await Promise.all([
      db.pingDatabase().catch(() => null),
      redis.pingRedis().catch(() => null),
    ]);

    res.json({
      platform: 'PayOps Payment & Billing Engine',
      status: dbLatencyMs !== null && redisLatencyMs !== null ? 'operational' : 'degraded',
      hostname: os.hostname(),
      region: config.awsRegion,
      availabilityZone: config.awsAvailabilityZone,
      gitCommitSha: config.gitCommitSha,
      jenkinsBuildNumber: config.jenkinsBuildNumber,
      uptimeSeconds: Math.floor(process.uptime()),
      activeMode: req.envMode,
      rds: { healthy: dbLatencyMs !== null, pingLatencyMs: dbLatencyMs, ssl: !!config.db.ssl },
      redis: { healthy: redisLatencyMs !== null, pingLatencyMs: redisLatencyMs },
      queue: { driver: config.queue.driver, healthy: redisLatencyMs !== null },
      timestamp: new Date().toISOString(),
    });
  });

  // Error handler
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || 500).json({
      error: err.message || 'Internal server error',
      traceId: req.traceId,
      code: err.code || 'INTERNAL_ERROR',
    });
  });

  return app;
}

module.exports = { createApp };
