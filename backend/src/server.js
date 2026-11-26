const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const config = require('./shared/config');
const logger = require('./shared/logger');
const db = require('./shared/db');
const redis = require('./shared/redis');
const { piiMaskerMiddleware } = require('./middleware/piiMasker');
const { metricsMiddleware, renderMetrics } = require('./observability/metrics');
const openApiSpec = require('./docs/openapi');

const statusRouter = require('./routes/status');
const paymentsRouter = require('./routes/payments');
const routingRouter = require('./routes/routing');
const webhooksRouter = require('./routes/webhooks');
const billingRouter = require('./routes/billing');
const invoicesRouter = require('./routes/invoices');
const adminRouter = require('./routes/admin');

const app = express();

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(metricsMiddleware);
app.use(piiMaskerMiddleware);

app.get('/health', (req, res) => {
  res.json({ service: 'payops-backend', status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/metrics', renderMetrics);
app.use('/status', statusRouter);

app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customSiteTitle: 'PayOps API Sandbox',
    swaggerOptions: { persistAuthorization: true },
  })
);
app.get('/api-docs.json', (req, res) => res.json(openApiSpec));

app.use('/api/payments', paymentsRouter);
app.use('/api/routing', routingRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/billing', billingRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/admin', adminRouter);

app.use((req, res) => {
  res.status(404).json({
    error: { code: 'route_not_found', message: `Route ${req.method} ${req.originalUrl} does not exist.` },
  });
});

app.use((err, req, res, _next) => {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'internal_server_error';
  if (statusCode >= 500) {
    logger.error({ err: err.message, stack: err.stack, path: req.originalUrl }, 'Unhandled API error');
  }
  res.status(statusCode).json({
    error: {
      code,
      message: err.message || 'An unexpected error occurred.',
    },
  });
});

async function start() {
  if (config.autoMigrate) {
    await db.runMigrations();
  }

  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.env, docs: `http://localhost:${config.port}/api-docs` },
      'PayOps Backend Gateway started'
    );
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down PayOps Backend Gateway');
    server.close(async () => {
      await db.close().catch(() => {});
      await redis.close().catch(() => {});
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  start().catch((err) => {
    logger.error({ err: err.message }, 'Fatal startup failure');
    process.exit(1);
  });
}

module.exports = app;
