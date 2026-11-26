import http from 'node:http';
import { createDb, SCHEMA } from './db.js';
import { seed, authenticate, requirePerm } from './auth.js';
import { withIdempotency } from './idempotency.js';
import * as pay from './payments.js';
import * as wh from './webhooks.js';
import { payPage } from './pay-page.js';
import { ApiError, log, metrics, inc, sha256 } from './util.js';

const DOCS = `<!doctype html><title>PayOps API</title><h1>PayOps API</h1><p>Contract: payops-contract.pdf. Auth: <code>Authorization: Bearer sk_test_...</code></p><pre>
POST /api/payments            create (+confirm)     POST /api/payments/tokenize
GET  /api/payments            list                  GET  /api/payments/:id
POST /api/payments/:id/confirm | capture | refund | cancel
POST /api/webhooks/endpoints  GET /api/webhooks/endpoints
GET  /api/webhooks/deliveries POST /api/webhooks/deliveries/:id/replay
POST /api/webhooks/test       GET /health /status /metrics</pre>`;

export async function createApp(opts = {}) {
  const env = opts.env || process.env;
  const db = await createDb(env.DATABASE_URL || 'pglite:');
  await db.exec(SCHEMA);
  const keys = await seed(db, env);
  const started = Date.now();

  // path, method, permission, handler(ctx) -> {status, body} | body
  const routes = [];
  const add = (method, pattern, perm, handler, { idem = false } = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), perm, handler, idem });
  add('POST', '/api/payments/tokenize', 'payments:write', async (c) => ({ status: 201, body: await pay.tokenize(db, c.auth, c.body.card) }));
  add('POST', '/api/payments', 'payments:write', (c) => pay.createPayment(db, c.auth, c.body), { idem: true });
  add('GET', '/api/payments', 'payments:read', (c) => pay.listPayments(db, c.auth, c.query.get('limit')));
  add('GET', '/api/payments/:id', 'payments:read', (c) => pay.getPayment(db, c.auth, c.params.id));
  add('POST', '/api/payments/:id/confirm', 'payments:write', (c) => pay.confirmPayment(db, c.auth, c.params.id, c.body), { idem: true });
  add('POST', '/api/payments/:id/capture', 'payments:write', (c) => pay.capturePayment(db, c.auth, c.params.id, c.body), { idem: true });
  add('POST', '/api/payments/:id/cancel', 'payments:write', (c) => pay.cancelPayment(db, c.auth, c.params.id), { idem: true });
  add('POST', '/api/payments/:id/refund', 'payments:refund', (c) => pay.refundPayment(db, c.auth, c.params.id, c.body), { idem: true });
  add('POST', '/api/webhooks/endpoints', 'webhooks:write', async (c) => ({ status: 201, body: await wh.registerEndpoint(db, c.auth, c.body) }));
  add('GET', '/api/webhooks/endpoints', 'webhooks:read', (c) => wh.listEndpoints(db, c.auth));
  add('GET', '/api/webhooks/deliveries', 'webhooks:read', (c) => wh.listDeliveries(db, c.auth, c.query.get('limit')));
  add('POST', '/api/webhooks/deliveries/:id/replay', 'webhooks:write', (c) => wh.replay(db, c.auth, c.params.id));
  add('POST', '/api/webhooks/test', 'webhooks:write', async (c) => ({ status: 202, body: await wh.queueTest(db, c.auth, c.body) }));

  const sendJson = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (d) => { size += d.length; if (size > 100_000) { reject(new ApiError(413, 'payload_too_large', 'Request body too large.')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (req.method === 'GET' && path === '/health') return sendJson(res, 200, { status: 'ok' });
      if (req.method === 'GET' && path === '/status') {
        const { rows } = await db.query('SELECT 1 AS ok');
        return sendJson(res, 200, { status: rows[0].ok === 1 ? 'ok' : 'degraded', uptime_seconds: Math.floor((Date.now() - started) / 1000), connectors: ['mock_stripe', 'mock_paymob'], api_keys_seeded: keys });
      }
      if (req.method === 'GET' && path === '/metrics') {
        const lines = Object.entries(metrics).flatMap(([g, o]) => Object.entries(o).map(([k, v]) => `payops_gateway_${g}_total{name="${k}"} ${v}`));
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }); return res.end(lines.join('\n') + '\n');
      }
      if (req.method === 'GET' && path === '/api-docs') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(DOCS); }
      const pm = /^\/pay\/([^/]+)$/.exec(path);
      if (pm && ['GET', 'POST'].includes(req.method)) {
        let formBody = null;
        if (req.method === 'POST') formBody = new URLSearchParams(await readBody(req));
        return await payPage(db, req, res, pm[1], url.searchParams, formBody);
      }
      const route = routes.map((r) => ({ r, m: r.re.exec(path) })).find((x) => x.m && x.r.method === req.method);
      if (!route) {
        if (routes.some((r) => r.re.test(path))) throw new ApiError(405, 'method_not_allowed', `Method ${req.method} not allowed on ${path}.`);
        throw new ApiError(404, 'route_not_found', `Route ${req.method} ${path} does not exist.`);
      }
      const auth = await authenticate(db, req);
      requirePerm(auth, route.r.perm);
      const rawBody = req.method === 'POST' ? await readBody(req) : '';
      let body = {};
      if (rawBody) { try { body = JSON.parse(rawBody); } catch { throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON.'); } }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'invalid_json', 'Request body must be a JSON object.');
      const ctx = { req, path, auth, body, rawBody, query: url.searchParams, params: route.m.groups || {} };
      const run = async () => { const out = await route.r.handler(ctx); return out && out.status ? out : { status: 200, body: out }; };
      const out = route.r.idem ? await withIdempotency(db, ctx, run) : await run();
      inc('requests', String(out.status));
      return sendJson(res, out.status, out.body, out.headers);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      if (status === 500) log({ evt: 'error', path, message: e.message });
      inc('requests', String(status));
      sendJson(res, status, { error: { code: e instanceof ApiError ? e.code : 'internal_error', message: status === 500 ? 'Internal error.' : e.message } });
    } finally {
      log({ evt: 'req', method: req.method, path: path.replace(/(cs_)\w+/, '$1***'), ms: Date.now() - t0 });
    }
  });

  let timer;
  if (opts.workers !== false) {
    timer = setInterval(() => {
      wh.dispatchDue(db).catch((e) => log({ evt: 'dispatch_error', message: e.message }));
      pay.issuePendingInvoices(db).catch((e) => log({ evt: 'invoice_error', message: e.message }));
    }, opts.tickMs || 1000);
  }
  return { server, db, close: async () => { clearInterval(timer); await new Promise((r) => server.close(r)); await db.close(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await createApp();
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, '0.0.0.0', () => log({ evt: 'listening', port }));
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => app.close().then(() => process.exit(0)));
}
