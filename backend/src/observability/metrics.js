const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'payops_' });

const httpRequestDurationMs = new client.Histogram({
  name: 'payops_http_request_duration_ms',
  help: 'HTTP request latency in milliseconds',
  labelNames: ['method', 'route', 'status_code', 'env_mode'],
  buckets: [5, 15, 30, 60, 120, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

const paymentIntentsTotal = new client.Counter({
  name: 'payops_payment_intents_total',
  help: 'Total payment intents processed by status and connector',
  labelNames: ['env_mode', 'status', 'connector'],
  registers: [register],
});

const routingFailoversTotal = new client.Counter({
  name: 'payops_routing_failovers_total',
  help: 'Total automatic connector failovers triggered',
  labelNames: ['env_mode', 'primary_connector', 'fallback_connector'],
  registers: [register],
});

function metricsMiddleware(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const routeLabel = req.baseUrl ? `${req.baseUrl}${req.route?.path || ''}` : req.path;
    httpRequestDurationMs
      .labels(req.method, routeLabel, String(res.statusCode), req.envMode || 'public')
      .observe(Date.now() - start);
  });
  next();
}

async function renderMetrics(req, res) {
  res.setHeader('Content-Type', register.contentType);
  res.end(await register.metrics());
}

module.exports = {
  register,
  httpRequestDurationMs,
  paymentIntentsTotal,
  routingFailoversTotal,
  metricsMiddleware,
  renderMetrics,
};
