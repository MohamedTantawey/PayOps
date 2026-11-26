# PayOps Architecture — Build-Ready Monorepo

> **Combining:** Hyperswitch routing patterns (traced from `crates/router/`, `crates/hyperswitch_interfaces/`, `connector-template/`) + Q1 Execution Checklists (Backend, Frontend, Database, DevOps).  
> **Stack:** Node.js 20 / Express 5 · React 18 · PostgreSQL 15 · Redis 7 · BullMQ · Docker / K8s / Jenkins / AWS ECS+RDS ready.

---

## Table of Contents

1. [System Overview & Design Principles](#system-overview)
2. [Monorepo Directory Tree](#monorepo-directory-tree)
3. [Layer 1 — API & Request Validation](#layer-1)
4. [Layer 2 — Payment State Machine & Routing Engine](#layer-2)
5. [Layer 3 — Vault Boundary & Connector Adapters](#layer-3)
6. [Layer 4 — Database Schema & Storage](#layer-4)
7. [Layer 5 — Async Workers & Background Jobs](#layer-5)
8. [Layer 6 — Signed Webhooks & Delivery Log](#layer-6)
9. [Layer 7 — React Control Center Frontend](#layer-7)
10. [Layer 8 — Observability & Telemetry](#layer-8)
11. [Configuration, Secrets & RBAC](#configuration-secrets-rbac)
12. [Docker / Docker-Compose Specification](#docker-specification)
13. [Phased Build Plan (Scaffolding Order)](#phased-build-plan)
14. [Environment Variables Reference](#env-reference)

---

## 1. System Overview & Design Principles {#system-overview}

```mermaid
flowchart TD
    subgraph Client["Clients & Consumers"]
        FE["React Control Center\n(Port 8080)"]
        Merchant["Merchant SDK / API Keys"]
        Webhook_Receiver["Merchant Webhook Receivers"]
    end

    subgraph API["Backend API (Port 3000)"]
        Express["Express 5 Gateway\n+CORS +TraceID +EnvMode"]
        PM["/api/payments\n(IntentStateMachine)"]
        BL["/api/billing\n(Payroll/Subscriptions)"]
        INV["/api/invoices\n(PDF + Pre-signed URLs)"]
        WH["/api/webhooks\n(Endpoints, Deliveries, Replay)"]
        ST["/status /health /metrics\n(Telemetry + Prometheus)"]
        DOCS["/api-docs\n(Swagger UI Sandbox)"]
    end

    subgraph Router["Payment Router Layer"]
        R_RULES["Rule Engine\n(Priority / Volume-Split / DSL)"]
        R_CGRAPH["Constraint Graph Filter\n(Currency, Method, 3DS)"]
        R_CIRCUIT["Circuit Breakers\n+Redis Sliding-Window Counters"]
        R_FALLBACK["Auto-Failover Cascade\n+GSM Decision Matrix"]
    end

    subgraph Connectors["Connector Adapters"]
        VAULT["VaultClient\n(Tokenizer Boundary)"]
        STRIPE_MOCK["MockStripe\n(ConnectorAdapter)"]
        PAYMO_MOCK["MockPaymob\n(ConnectorAdapter)"]
    end

    subgraph Worker["Async Worker (Port 3001)"]
        BullMQ["BullMQ / Redis RPUSH\nBlocking BLPOP"]
        INV_GEN["invoice.generate\n(PDF → S3 / local)"]
        WH_DISPATCH["webhook.dispatch_event\n(HMAC-SHA256)"]
        WH_RETRY["webhook.retry\n(Exponential backoff)"]
        PAYROLL["billing.execute_schedule\n(Batch payroll)"]
        ANALYTICS["payment_analytics_events\n(Redis Streams)"]
    end

    subgraph DB["PostgreSQL 15 (AWS RDS)"]
        PI["payment_intents"]
        PA["payment_attempts"]
        RT["routing_configs"]
        RC["rbac_roles + rbac_permissions"]
        VT["vault_tokens"]
        WD["webhook_deliveries"]
        AE["payment_analytics_events"]
    end

    subgraph Cache["Redis 7"]
        IDEM["Idempotency Keys\n(SET NX PX)"]
        LOCK["Distributed Locks\n(PAYLOCK_{payment_id})"]
        ALGO["Routing Algorithm Cache\n(routing:algo:{profileId})"]
        SW["Sliding-Window Counters\n(success/failure rates)"]
        CFG_CACHE["Dynamic Config Cache\n(config:{merchant_id})"]
    end

    FE -->|REST + X-PayOps-Mode| Express
    Merchant -->|sk_test_ / sk_live_| Express
    Express --> PM & BL & INV & WH & ST & DOCS
    PM --> Router
    Router --> R_RULES --> R_CGRAPH --> R_CIRCUIT --> R_FALLBACK
    R_FALLBACK --> VAULT --> STRIPE_MOCK & PAYMO_MOCK
    PM -.->|BullMQ enqueue| BullMQ
    BullMQ --> INV_GEN & WH_DISPATCH & WH_RETRY & PAYROLL & ANALYTICS
    WH_DISPATCH -->|HMAC POST| Webhook_Receiver
    Express <--> DB
    Express <--> Cache
    Router <--> Cache
    DB --> PI & PA & RT & RC & VT & WD & AE
```

### Core Design Principles (Directly from Hyperswitch)
| Principle | Implementation |
| :--- | :--- |
| **Idempotency** | Redis `SET NX PX` on `payment_id` before state mutation; DB `idempotency_key` UNIQUE constraint |
| **Immutable Attempt Log** | Each routing retry creates a new `payment_attempt` row; `payment_intent.active_attempt_id` advances |
| **Terminal State Guards** | Status fields checked before every update; `succeeded`/`failed`/`cancelled` are sink states |
| **Distributed Locking** | `PAYLOCK_{payment_id}` Redis key serializes concurrent API + webhook mutations |
| **No Raw Card Numbers in Core** | `VaultClient` tokenizes before data ever reaches `payment_intents`/`payment_attempts` |
| **Mode Isolation** | `env_mode ∈ {test, live}` on every table row; Redis keys prefixed `{mode}:` |
| **Zero-Downtime Config** | `routing_configs` cached in Redis; invalidated on `POST /api/admin/routing`; no restart needed |

---

## 2. Monorepo Directory Tree {#monorepo-directory-tree}

```
payops/                            ← Git monorepo root
├── backend/                       ← Express API server
│   ├── src/
│   │   ├── server.js              ← Entrypoint: boots HTTP + graceful SIGTERM
│   │   ├── app.js                 ← Express factory: routes, middleware, Swagger
│   │   ├── middleware/
│   │   │   ├── traceId.js         ← UUID trace ID injection + response headers
│   │   │   ├── envMode.js         ← test/live mode from X-PayOps-Mode header
│   │   │   ├── auth.js            ← sk_test_ / sk_live_ API key RBAC
│   │   │   ├── piiMask.js         ← PII masking on logs and DB payloads
│   │   │   └── metrics.js         ← Prometheus histogram per route/feature
│   │   ├── routes/
│   │   │   ├── payments.js        ← /api/payments
│   │   │   ├── billing.js         ← /api/billing
│   │   │   ├── invoices.js        ← /api/invoices
│   │   │   ├── webhooks.js        ← /api/webhooks
│   │   │   ├── telemetry.js       ← /status, /health, /metrics
│   │   │   ├── admin.js           ← /api/admin/routing, /api/admin/rbac
│   │   │   └── docs.js            ← /api-docs (Swagger UI)
│   │   ├── payments/
│   │   │   ├── stateMachine.js    ← payment_intent state guards + transitions
│   │   │   ├── router.js          ← Routing engine: priority, volume-split, circuit
│   │   │   ├── connectors/
│   │   │   │   ├── base.js        ← ConnectorAdapter interface
│   │   │   │   ├── mockStripe.js  ← MockStripe connector
│   │   │   │   └── mockPaymob.js  ← MockPaymob connector
│   │   │   ├── vault.js           ← VaultClient: tokenize/detokenize boundary
│   │   │   └── gsm.js             ← Gateway Status Matrix (retry/step-up/decline)
│   │   ├── shared/
│   │   │   ├── db.js              ← pg Pool + pingDatabase + runMigrations
│   │   │   ├── redis.js           ← ioredis client + lock/unlock + sliding window
│   │   │   ├── queue.js           ← BullMQ enqueue/dequeue (Redis | SQS | memory)
│   │   │   ├── config.js          ← All env vars with safe defaults
│   │   │   ├── logger.js          ← Pino structured JSON logger
│   │   │   ├── metrics.js         ← prom-client counters, histograms, gauges
│   │   │   ├── webhookSender.js   ← HMAC-SHA256 signing + delivery logging
│   │   │   ├── invoiceStorage.js  ← S3 / local adapter for PDF storage
│   │   │   └── crypto.js          ← AES-256-GCM encrypt/decrypt for credentials
│   ├── Dockerfile
│   └── package.json
├── worker/                        ← Standalone async worker process
│   ├── src/
│   │   ├── worker.js              ← BullMQ consumer loop + health probe :3001
│   │   └── handlers/
│   │       ├── invoiceHandler.js  ← PDF generation (pdfkit) + storage upload
│   │       ├── webhookHandler.js  ← Dispatch + retry with exponential backoff
│   │       ├── billingHandler.js  ← Batch payroll schedule execution
│   │       └── analyticsHandler.js← Redis Streams consumer → payment_analytics_events
│   ├── Dockerfile
│   └── package.json
├── frontend/                      ← React 18 Control Center
│   ├── src/
│   │   ├── index.jsx
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── StatusBanner.jsx   ← Persistent /status telemetry bar
│   │   │   ├── PaymentsTable.jsx  ← Real-time payments + attempt cascade
│   │   │   ├── RoutingEditor.jsx  ← Dynamic routing config UI (zero-restart)
│   │   │   ├── WebhookLog.jsx     ← Delivery log + Replay button
│   │   │   ├── InvoiceList.jsx    ← PDF download with pre-signed URLs
│   │   │   └── RbacManager.jsx    ← Role/permission assignment UI
│   │   └── api.js                 ← Shared fetch wrapper (mode header injection)
│   ├── public/index.html
│   ├── Dockerfile                 ← nginx:alpine static server
│   └── package.json
├── db/
│   ├── migrations/
│   │   ├── 001_core_tables.sql    ← payment_intents, payment_attempts, refunds
│   │   ├── 002_billing.sql        ← billing_schedules, billing_runs
│   │   ├── 003_invoices.sql       ← invoices table
│   │   ├── 004_webhooks.sql       ← webhook_endpoints, webhook_deliveries
│   │   ├── 005_routing.sql        ← routing_configs, connector_credentials
│   │   ├── 006_rbac.sql           ← rbac_roles, rbac_permissions, api_keys
│   │   ├── 007_vault.sql          ← vault_tokens
│   │   └── 008_analytics.sql     ← payment_analytics_events
│   └── seeds/
│       ├── test_mode.sql          ← Demo routing rules, mock endpoints
│       └── connectors.sql         ← Encrypted MockStripe / MockPaymob credentials
├── k8s/
│   ├── api-deployment.yaml
│   ├── worker-deployment.yaml
│   ├── frontend-deployment.yaml
│   ├── postgres-statefulset.yaml
│   ├── redis-statefulset.yaml
│   └── ingress.yaml
├── docker-compose.yml             ← Full local dev stack
├── Jenkinsfile                    ← CI: lint → test → build → push → deploy
├── .env.example
└── package.json                   ← Workspace root (npm workspaces)
```

---

## 3. Layer 1 — API & Request Validation {#layer-1}

### `backend/src/app.js` — Express Application Factory

```javascript
// backend/src/app.js
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');

const { attachTraceId }   = require('./middleware/traceId');
const { attachEnvMode }   = require('./middleware/envMode');
const { authenticateKey } = require('./middleware/auth');
const { maskPii }         = require('./middleware/piiMask');
const { recordMetrics }   = require('./middleware/metrics');
const openApiSpec         = require('./routes/docs');

// Feature Routes
const telemetryRoutes  = require('./routes/telemetry');
const paymentsRoutes   = require('./routes/payments');
const billingRoutes    = require('./routes/billing');
const invoicesRoutes   = require('./routes/invoices');
const webhooksRoutes   = require('./routes/webhooks');
const adminRoutes      = require('./routes/admin');

function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(cors({ exposedHeaders: ['X-Trace-Id', 'X-PayOps-Mode', 'X-PayOps-Commit'] }));
  app.use(express.json({ limit: '2mb' }));

  // Core middleware chain (order matters)
  app.use(attachTraceId);    // 1. Inject UUID trace ID
  app.use(attachEnvMode);    // 2. Resolve test/live mode
  app.use(maskPii);          // 3. Redact card numbers & PII from logs
  app.use(recordMetrics);    // 4. Start Prometheus histogram timer

  // Public probes (no auth required)
  app.use('/', telemetryRoutes);  // GET /health, GET /status

  // Prometheus scrape endpoint
  const { register } = require('./shared/metrics');
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // Interactive OpenAPI Sandbox (browser test mode)
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    customSiteTitle: 'PayOps API Sandbox',
    swaggerOptions: { persistAuthorization: true, tryItOutEnabled: true }
  }));
  app.get('/api-docs.json', (req, res) => res.json(openApiSpec));

  // Protected API modules (each with isolated /health + /metrics)
  app.use('/api/payments', authenticateKey, paymentsRoutes);
  app.use('/api/billing',  authenticateKey, billingRoutes);
  app.use('/api/invoices', authenticateKey, invoicesRoutes);
  app.use('/api/webhooks', authenticateKey, webhooksRoutes);
  app.use('/api/admin',    authenticateKey, adminRoutes);   // RBAC + routing config

  // Centralized error handler
  app.use((err, req, res, _next) => {
    req.log?.error('Unhandled exception', { err: err.message, traceId: req.traceId });
    res.status(err.statusCode || 500).json({
      error: err.message || 'Internal server error',
      traceId: req.traceId,
      code: err.code || 'INTERNAL_ERROR'
    });
  });

  return app;
}
module.exports = { createApp };
```

### PII Masking Middleware (`backend/src/middleware/piiMask.js`)

```javascript
// backend/src/middleware/piiMask.js
const CARD_REGEX = /\b(\d{4})\d{8,12}(\d{4})\b/g;
const CVV_REGEX  = /("cv[cv2]"\s*:\s*")(\d{3,4})(")/gi;
const EMAIL_REGEX = /([a-zA-Z0-9._%+-]+)(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

function maskValue(str) {
  return str
    .replace(CARD_REGEX, '$1****$2')
    .replace(CVV_REGEX, '$1***$3')
    .replace(EMAIL_REGEX, '***$2');
}

function maskPii(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    const raw = JSON.stringify(req.body);
    req._maskedBody = maskValue(raw);  // used in log context
  }
  next();
}
module.exports = { maskPii, maskValue };
```

### Module-Level Health Probe Pattern

Every feature route exports a standard `GET /health` probe:
```javascript
// Pattern used in /api/payments/health, /api/billing/health, etc.
router.get('/health', async (req, res) => {
  try {
    const dbLatencyMs = await db.pingDatabase();
    const queueHealth = await queue.getQueueHealth();
    res.json({
      feature: 'payments',   // replaced per module
      healthy: true,
      dbLatencyMs,
      queue: queueHealth,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({ feature: 'payments', healthy: false, error: err.message });
  }
});
```

### Telemetry Endpoint (`GET /status`)

```javascript
// backend/src/routes/telemetry.js  (key excerpt)
router.get('/status', async (req, res) => {
  const [dbLatencyMs, az, queueHealth] = await Promise.all([
    db.pingDatabase().catch(() => null),
    resolveAwsAvailabilityZone(),         // ECS metadata → env var → local fallback
    queue.getQueueHealth()
  ]);

  res.json({
    platform: 'PayOps Payment & Billing Engine',
    status:   dbLatencyMs !== null ? 'operational' : 'degraded',
    hostname: os.hostname(),              // os.hostname()
    region:   config.awsRegion,
    availabilityZone: az,                 // ECS_CONTAINER_METADATA_URI_V4 → task AZ
    gitCommitSha:     config.gitCommitSha,         // GIT_COMMIT_SHA build arg
    jenkinsBuildNumber: config.jenkinsBuildNumber, // JENKINS_BUILD_NUMBER
    uptimeSeconds: Math.floor(process.uptime()),
    activeMode: req.envMode,
    rds:   { healthy: dbLatencyMs !== null, pingLatencyMs: dbLatencyMs, ssl: config.db.ssl },
    queue: queueHealth,
    timestamp: new Date().toISOString()
  });
});
```

---

## 4. Layer 2 — Payment State Machine & Routing Engine {#layer-2}

### Payment Intent State Machine (`backend/src/payments/stateMachine.js`)

Directly modelled on Hyperswitch's `IntentStatus` and `AttemptStatus` from `crates/common_enums/src/enums.rs`:

```javascript
// backend/src/payments/stateMachine.js

const INTENT_STATUSES = [
  'requires_payment_method', 'requires_confirmation', 'requires_customer_action',
  'requires_merchant_action', 'requires_capture', 'processing',
  'partially_captured', 'partially_captured_and_capturable',
  'succeeded', 'failed', 'cancelled', 'expired', 'conflicted'
];

const TERMINAL_INTENT_STATUSES = new Set([
  'succeeded', 'failed', 'cancelled', 'expired', 'partially_captured'
]);

const ATTEMPT_STATUSES = [
  'started', 'authentication_pending', 'authentication_successful',
  'authorizing', 'authorized', 'authorization_failed',
  'capture_initiated', 'charged', 'capture_failed',
  'void_initiated', 'voided', 'void_failed',
  'partial_charged', 'pending', 'failure', 'router_declined', 'expired'
];

const TERMINAL_ATTEMPT_STATUSES = new Set([
  'charged', 'partial_charged', 'voided', 'void_failed',
  'capture_failed', 'failure', 'router_declined', 'expired'
]);

// Deterministic: IntentStatus derived from AttemptStatus (mirrors Hyperswitch transformers.rs)
const ATTEMPT_TO_INTENT_MAP = {
  charged:                'succeeded',
  authorization_failed:   'failed',
  capture_failed:         'failed',
  void_failed:            'failed',
  router_declined:        'failed',
  failure:                'failed',
  voided:                 'cancelled',
  authorized:             'requires_capture',
  authentication_pending: 'requires_customer_action',
  partial_charged:        'partially_captured',
  pending:                'processing',
  authorizing:            'processing',
  capture_initiated:      'processing',
  expired:                'expired',
};

function deriveIntentStatus(attemptStatus) {
  return ATTEMPT_TO_INTENT_MAP[attemptStatus] || 'processing';
}

function isTerminalIntent(status) {
  return TERMINAL_INTENT_STATUSES.has(status);
}

function isTerminalAttempt(status) {
  return TERMINAL_ATTEMPT_STATUSES.has(status);
}

module.exports = { deriveIntentStatus, isTerminalIntent, isTerminalAttempt, TERMINAL_INTENT_STATUSES };
```

### Payment Create + Routing Flow (`backend/src/routes/payments.js`)

```javascript
// POST /api/payments — Create intent, acquire lock, route, attempt, cascade
router.post('/', async (req, res) => {
  const { amount_cents, currency = 'USD', payment_method, idempotency_key,
          merchant_id, customer_email, description, capture_method = 'automatic' } = req.body;

  // 1. Validate input
  if (!Number.isInteger(amount_cents) || amount_cents <= 0)
    return res.status(400).json({ error: 'amount_cents must be a positive integer' });

  // 2. Idempotency check (Redis NX → DB fallback)
  if (idempotency_key) {
    const cached = await redis.getIdempotentReplay(req.envMode, idempotency_key);
    if (cached) return res.json({ idempotentReplay: true, ...cached });
  }

  // 3. Tokenize payment method (VaultClient boundary)
  const { vaultToken, last4, cardNetwork } = await vaultClient.tokenize(payment_method);

  // 4. Create payment_intent row
  const intent = await db.createPaymentIntent({
    envMode: req.envMode, merchantId: merchant_id,
    amountCents: amount_cents, currency, captureMethod: capture_method,
    customerEmail: customer_email, description,
    status: 'requires_confirmation', idempotencyKey: idempotency_key,
  });

  // 5. Acquire distributed lock (prevents duplicate concurrent processing)
  const lockKey = `PAYLOCK_${req.envMode}_${intent.id}`;
  const lockAcquired = await redis.acquireLock(lockKey, req.traceId, 15);
  if (!lockAcquired)
    return res.status(409).json({ error: 'Payment already being processed', paymentId: intent.id });

  try {
    // 6. Route: resolve candidate connectors from routing engine
    const candidates = await paymentRouter.resolveConnectors({
      merchantId: merchant_id, envMode: req.envMode,
      currency, cardNetwork, captureMethod: capture_method,
      amountCents: amount_cents
    });

    // 7. Attempt cascade (Hyperswitch GSM retry pattern)
    let result;
    for (let i = 0; i < candidates.length; i++) {
      const connector = connectorRegistry.get(candidates[i].connectorId);
      const attempt = await db.createPaymentAttempt({
        intentId: intent.id, merchantId: merchant_id, envMode: req.envMode,
        connector: candidates[i].connectorId, amountCents: amount_cents,
        currency, attemptIndex: i + 1, status: 'started'
      });

      const connResult = await connector.authorize({
        attemptId: attempt.id, paymentId: intent.id,
        amountCents: amount_cents, currency,
        vaultToken, captureMethod: capture_method
      });

      await db.updatePaymentAttempt(attempt.id, {
        status: connResult.attemptStatus,
        connectorTransactionId: connResult.connectorTransactionId,
        errorCode: connResult.errorCode, errorMessage: connResult.errorMessage
      });

      const intentStatus = deriveIntentStatus(connResult.attemptStatus);
      await db.updatePaymentIntentStatus(intent.id, intentStatus, attempt.id);

      // 8. GSM Decision: break or cascade
      const decision = gsm.decide(connResult.errorCode, connResult.attemptStatus);
      if (decision === 'succeed' || decision === 'requires_action') { result = { intent, attempt, connResult }; break; }
      if (decision === 'hard_decline') { result = { intent, attempt, connResult }; break; }
      // decision === 'retry' → loop to next candidate
    }

    // 9. Cache idempotency result
    if (idempotency_key)
      await redis.setIdempotentReplay(req.envMode, idempotency_key, result);

    // 10. Queue async jobs
    await queue.enqueue('invoice.generate', { intentId: intent.id });
    await queue.enqueue('webhook.dispatch_event', {
      envMode: req.envMode, merchantId: merchant_id,
      eventType: 'payment.succeeded', data: result.intent
    });
    await redis.publishAnalyticsEvent(req.envMode, { type: 'payment.created', ...result.intent });

    res.status(201).json(result);
  } finally {
    await redis.releaseLock(lockKey, req.traceId);
  }
});
```

### Routing Engine (`backend/src/payments/router.js`)

```javascript
// backend/src/payments/router.js — Hyperswitch CachedAlgorithm pattern

const CACHE_TTL = 60; // seconds

class PaymentRouter {
  constructor(db, redis) {
    this.db = db;
    this.redis = redis;
  }

  // Load algorithm from Redis cache or Postgres (zero-restart config updates)
  async loadAlgorithm(merchantId, envMode) {
    const cacheKey = `routing:algo:${envMode}:${merchantId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const row = await this.db.queryOne(
      `SELECT algorithm_type, config FROM routing_configs
       WHERE merchant_id=$1 AND env_mode=$2 AND active=true
       ORDER BY created_at DESC LIMIT 1`,
      [merchantId, envMode]
    );

    const algo = row || { algorithm_type: 'priority', config: { connectors: ['mock_stripe', 'mock_paymo'] } };
    await this.redis.set(cacheKey, JSON.stringify(algo), CACHE_TTL);
    return algo;
  }

  // Resolve ordered candidate list (mirrors Hyperswitch routing_v1)
  async resolveConnectors({ merchantId, envMode, currency, cardNetwork, captureMethod, amountCents }) {
    const algo = await this.loadAlgorithm(merchantId, envMode);
    let candidates = [];

    if (algo.algorithm_type === 'single') {
      candidates = [algo.config.connector];
    } else if (algo.algorithm_type === 'priority') {
      candidates = algo.config.connectors;
    } else if (algo.algorithm_type === 'volume_split') {
      candidates = this._weightedShuffle(algo.config.splits);
    } else if (algo.algorithm_type === 'rule') {
      candidates = this._evaluateRules(algo.config.rules, { currency, cardNetwork, amountCents });
    }

    // Constraint-graph filter: check circuit breaker state per connector
    const eligible = [];
    for (const connId of candidates) {
      const cb = await this.redis.getCircuitState(envMode, connId);
      if (cb !== 'open') eligible.push({ connectorId: connId });
    }
    return eligible.length > 0 ? eligible : candidates.map(c => ({ connectorId: c }));
  }

  // Volume-split: weighted random selection (Hyperswitch ConnectorVolumeSplit)
  _weightedShuffle(splits) {
    const total = splits.reduce((s, x) => s + x.percentage, 0);
    let rand = Math.random() * total;
    const primary = splits.find(s => (rand -= s.percentage) < 0) || splits[0];
    const rest = splits.filter(s => s !== primary);
    return [primary.connector, ...rest.map(s => s.connector)];
  }

  // Simple DSL rule evaluator
  _evaluateRules(rules, ctx) {
    for (const rule of rules) {
      if (rule.currency && rule.currency !== ctx.currency) continue;
      if (rule.min_amount && ctx.amountCents < rule.min_amount) continue;
      if (rule.card_network && rule.card_network !== ctx.cardNetwork) continue;
      return rule.connectors;
    }
    return [];
  }

  // Redis sliding-window circuit breaker (record success/failure)
  async recordOutcome(envMode, connectorId, succeeded) {
    const key = `cb:${envMode}:${connectorId}`;
    const field = succeeded ? 'success' : 'failure';
    await this.redis.hincrby(key, field, 1);
    await this.redis.expire(key, 300); // 5-min rolling window

    const stats = await this.redis.hgetall(key);
    const failures = parseInt(stats.failure || '0');
    const total = failures + parseInt(stats.success || '0');
    if (total >= 10 && failures / total > 0.5) {
      await this.redis.set(`cb:state:${envMode}:${connectorId}`, 'open', 60);
    }
  }
}
```

### GSM — Gateway Status Matrix (`backend/src/payments/gsm.js`)

```javascript
// backend/src/payments/gsm.js
// Mirrors Hyperswitch GsmDecision (do_gsm_actions in retry.rs)

const HARD_DECLINES = new Set([
  'card_stolen', 'card_lost', 'fraud', 'do_not_honor', 'restricted_card',
  'invalid_card_number', 'expired_card', 'pickup_card'
]);

const STEP_UP_CODES = new Set([
  'authentication_required', 'issuer_requires_3ds'
]);

const RETRYABLE_CODES = new Set([
  'generic_decline', 'try_again_later', 'processing_error',
  'network_timeout', 'gateway_unavailable', 'rate_limited',
  'do_not_retry_later_ok', 'insufficient_funds' // soft decline: try another connector
]);

function decide(errorCode, attemptStatus) {
  if (!errorCode) {
    if (['charged', 'authorized', 'partial_charged'].includes(attemptStatus)) return 'succeed';
    if (attemptStatus === 'authentication_pending') return 'requires_action';
  }
  if (HARD_DECLINES.has(errorCode)) return 'hard_decline';
  if (STEP_UP_CODES.has(errorCode)) return 'step_up';
  if (RETRYABLE_CODES.has(errorCode)) return 'retry';
  return 'hard_decline';  // conservative default
}

module.exports = { decide };
```

---

## 5. Layer 3 — Vault Boundary & Connector Adapters {#layer-3}

### VaultClient (`backend/src/payments/vault.js`)

Raw card data never enters `payment_intents` or `payment_attempts`. The boundary is enforced here:

```javascript
// backend/src/payments/vault.js
const crypto = require('crypto');
const db = require('../shared/db');
const { encrypt, decrypt } = require('../shared/crypto');

const VAULT_KEY = process.env.VAULT_ENCRYPTION_KEY; // 32-byte AES-256-GCM key

class VaultClient {
  async tokenize(paymentMethod) {
    if (paymentMethod.type !== 'card') return { vaultToken: null, last4: null, cardNetwork: null };

    const { card_number, exp_month, exp_year, cvc } = paymentMethod;
    const last4 = card_number.slice(-4);
    const cardNetwork = detectNetwork(card_number);
    const token = `vault_tok_${crypto.randomUUID().replace(/-/g, '')}`;

    const encryptedPayload = encrypt(JSON.stringify({ card_number, exp_month, exp_year, cvc }), VAULT_KEY);

    await db.query(
      `INSERT INTO vault_tokens (token, encrypted_data, last4, card_network, env_mode)
       VALUES ($1, $2, $3, $4, $5)`,
      [token, encryptedPayload, last4, cardNetwork, 'test']
    );

    return { vaultToken: token, last4, cardNetwork };
  }

  async detokenize(vaultToken, envMode) {
    const row = await db.queryOne(
      'SELECT encrypted_data FROM vault_tokens WHERE token=$1 AND env_mode=$2',
      [vaultToken, envMode]
    );
    if (!row) throw new Error('Vault token not found');
    return JSON.parse(decrypt(row.encrypted_data, VAULT_KEY));
  }
}

function detectNetwork(pan) {
  if (/^4/.test(pan)) return 'visa';
  if (/^5[1-5]/.test(pan)) return 'mastercard';
  if (/^3[47]/.test(pan)) return 'amex';
  return 'unknown';
}

module.exports = new VaultClient();
```

### Connector Adapter Interface (`backend/src/payments/connectors/base.js`)

```javascript
// backend/src/payments/connectors/base.js
// TypeScript-equivalent interface as JSDoc + enforced shape

/**
 * @interface ConnectorAdapter
 * All connectors MUST implement the methods below.
 * Mirrors Hyperswitch's ConnectorIntegration<Flow, Req, Resp> trait.
 */
class ConnectorAdapter {
  get id() { throw new Error('id getter required'); }

  /**
   * Build HTTP request: url + headers + body → dispatch → normalize response
   * @param {object} req  - { attemptId, paymentId, amountCents, currency, vaultToken }
   * @returns {ConnectorResult} { attemptStatus, connectorTransactionId, errorCode, errorMessage, requiresRedirect }
   */
  async authorize(req) { throw new Error('authorize() required'); }
  async capture(connectorTxnId, amountCents) { throw new Error('capture() required'); }
  async sync(connectorTxnId) { throw new Error('sync() required'); }
  async cancel(connectorTxnId) { throw new Error('cancel() required'); }
  async refund(req) { throw new Error('refund() required'); }
  verifyWebhook(headers, rawBody, secret) { throw new Error('verifyWebhook() required'); }
  parseWebhook(rawBody) { throw new Error('parseWebhook() required'); }
}
module.exports = ConnectorAdapter;
```

### MockStripe Connector (`backend/src/payments/connectors/mockStripe.js`)

```javascript
// backend/src/payments/connectors/mockStripe.js
const ConnectorAdapter = require('./base');
const crypto = require('crypto');

class MockStripeConnector extends ConnectorAdapter {
  get id() { return 'mock_stripe'; }
  get baseUrl() { return process.env.MOCK_STRIPE_URL || 'http://localhost:4001'; }

  async authorize({ attemptId, amountCents, currency }) {
    // Simulate: amounts divisible by 1000 → hard decline; ending in 42 → 3DS
    if (amountCents % 1000 === 0) {
      return { attemptStatus: 'router_declined', errorCode: 'generic_decline', connectorTransactionId: null };
    }
    if (String(amountCents).endsWith('42')) {
      return { attemptStatus: 'authentication_pending', errorCode: 'authentication_required', connectorTransactionId: null };
    }
    const txnId = `stripe_pi_${crypto.randomUUID().slice(0, 16)}`;
    return { attemptStatus: 'charged', connectorTransactionId: txnId, errorCode: null };
  }

  async capture(txnId, amountCents) {
    return { attemptStatus: 'charged', connectorTransactionId: txnId };
  }

  async sync(txnId) {
    return { attemptStatus: 'charged', connectorTransactionId: txnId };
  }

  async cancel(txnId) {
    return { attemptStatus: 'voided', connectorTransactionId: txnId };
  }

  async refund({ connectorTransactionId, amountCents }) {
    return { refundStatus: 'success', connectorRefundId: `stripe_re_${crypto.randomUUID().slice(0,12)}` };
  }

  verifyWebhook(headers, rawBody, secret) {
    const ts = headers['stripe-timestamp'];
    const sig = headers['stripe-signature'];
    const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
    return sig === `v1=${expected}`;
  }

  parseWebhook(rawBody) {
    const event = JSON.parse(rawBody);
    return {
      eventType: event.type === 'payment_intent.succeeded' ? 'PAYMENT_SUCCEEDED' : 'UNKNOWN',
      connectorTransactionId: event.data?.object?.id,
      status: 'succeeded'
    };
  }
}

module.exports = new MockStripeConnector();
```

### AES-256-GCM Credential Encryption (`backend/src/shared/crypto.js`)

```javascript
// backend/src/shared/crypto.js
// Connector credentials (API keys) are stored encrypted in connector_credentials table

const crypto = require('crypto');
const ALGO = 'aes-256-gcm';

function encrypt(plaintext, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(ciphertext, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const [ivHex, tagHex, encHex] = ciphertext.split(':');
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}

module.exports = { encrypt, decrypt };
```

---

## 6. Layer 4 — Database Schema & Storage {#layer-4}

### Migration: `001_core_tables.sql`

```sql
-- db/migrations/001_core_tables.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- A. payment_intents — business contract (1 per customer checkout)
CREATE TABLE IF NOT EXISTS payment_intents (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key  VARCHAR(128) UNIQUE,
    env_mode         VARCHAR(8)  NOT NULL DEFAULT 'test' CHECK (env_mode IN ('test','live')),
    merchant_id      VARCHAR(64) NOT NULL,
    amount_cents     BIGINT      NOT NULL CHECK (amount_cents > 0),
    currency         VARCHAR(8)  NOT NULL DEFAULT 'USD',
    capture_method   VARCHAR(32) NOT NULL DEFAULT 'automatic',
    status           VARCHAR(64) NOT NULL DEFAULT 'requires_confirmation',
    active_attempt_id UUID,
    attempt_count    SMALLINT    NOT NULL DEFAULT 0,
    customer_email   TEXT,
    description      TEXT,
    metadata         JSONB       NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pi_merchant_env_status ON payment_intents (merchant_id, env_mode, status);
CREATE INDEX idx_pi_idempotency        ON payment_intents (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- B. payment_attempts — per-connector execution (1-to-N per intent)
CREATE TABLE IF NOT EXISTS payment_attempts (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intent_id              UUID NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
    env_mode               VARCHAR(8)  NOT NULL,
    merchant_id            VARCHAR(64) NOT NULL,
    connector              VARCHAR(64) NOT NULL,         -- 'mock_stripe' | 'mock_paymo'
    attempt_index          SMALLINT    NOT NULL DEFAULT 1,
    status                 VARCHAR(64) NOT NULL DEFAULT 'started',
    amount_cents           BIGINT      NOT NULL,
    currency               VARCHAR(8)  NOT NULL,
    connector_transaction_id VARCHAR(255),
    error_code             VARCHAR(255),
    error_message          TEXT,
    vault_token            VARCHAR(128),                 -- VaultClient token (not raw PAN)
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pa_intent_id  ON payment_attempts (intent_id);
CREATE INDEX idx_pa_connector  ON payment_attempts (connector, env_mode, created_at DESC);

-- C. refunds
CREATE TABLE IF NOT EXISTS refunds (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intent_id               UUID NOT NULL REFERENCES payment_intents(id),
    attempt_id              UUID NOT NULL REFERENCES payment_attempts(id),
    env_mode                VARCHAR(8)  NOT NULL,
    merchant_id             VARCHAR(64) NOT NULL,
    connector               VARCHAR(64) NOT NULL,
    connector_transaction_id VARCHAR(255) NOT NULL,
    connector_refund_id     VARCHAR(255),
    amount_cents            BIGINT      NOT NULL,
    currency                VARCHAR(8)  NOT NULL,
    refund_status           VARCHAR(32) NOT NULL DEFAULT 'pending',
    reason                  TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Migration: `005_routing.sql`

```sql
-- db/migrations/005_routing.sql

-- Dynamic routing algorithms (zero-restart updates via Redis cache invalidation)
CREATE TABLE IF NOT EXISTS routing_configs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id    VARCHAR(64) NOT NULL,
    env_mode       VARCHAR(8)  NOT NULL DEFAULT 'test',
    algorithm_type VARCHAR(32) NOT NULL CHECK (algorithm_type IN ('single','priority','volume_split','rule')),
    config         JSONB       NOT NULL,  -- { connectors: [], splits: [], rules: [] }
    active         BOOLEAN     NOT NULL DEFAULT true,
    created_by     VARCHAR(64),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rc_merchant_env ON routing_configs (merchant_id, env_mode, active, created_at DESC);

-- Encrypted connector credentials (AES-256-GCM via crypto.js)
CREATE TABLE IF NOT EXISTS connector_credentials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector       VARCHAR(64)  NOT NULL,
    merchant_id     VARCHAR(64)  NOT NULL,
    env_mode        VARCHAR(8)   NOT NULL DEFAULT 'test',
    encrypted_creds TEXT         NOT NULL,  -- AES-256-GCM: iv:tag:ciphertext
    active          BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (connector, merchant_id, env_mode)
);
```

### Migration: `006_rbac.sql`

```sql
-- db/migrations/006_rbac.sql

CREATE TABLE IF NOT EXISTS rbac_roles (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR(64) UNIQUE NOT NULL,  -- 'admin', 'operator', 'viewer', 'finance'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rbac_permissions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id    UUID NOT NULL REFERENCES rbac_roles(id),
    resource   VARCHAR(64) NOT NULL,   -- 'payments', 'billing', 'routing', 'webhooks'
    action     VARCHAR(32) NOT NULL,   -- 'read', 'write', 'delete', 'replay'
    UNIQUE (role_id, resource, action)
);

CREATE TABLE IF NOT EXISTS api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash    VARCHAR(255) UNIQUE NOT NULL,  -- bcrypt hash of sk_test_xxx / sk_live_xxx
    env_mode    VARCHAR(8) NOT NULL,
    merchant_id VARCHAR(64) NOT NULL,
    role_id     UUID REFERENCES rbac_roles(id),
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_hash ON api_keys (key_hash, env_mode, active);
```

### Migration: `007_vault.sql`

```sql
-- db/migrations/007_vault.sql

CREATE TABLE IF NOT EXISTS vault_tokens (
    token           VARCHAR(128) PRIMARY KEY,          -- vault_tok_<uuid>
    encrypted_data  TEXT NOT NULL,                     -- AES-256-GCM encrypted PAN+CVV
    last4           VARCHAR(4)  NOT NULL,
    card_network    VARCHAR(32),
    env_mode        VARCHAR(8)  NOT NULL DEFAULT 'test',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 year')
);
```

### Migration: `008_analytics.sql`

```sql
-- db/migrations/008_analytics.sql

CREATE TABLE IF NOT EXISTS payment_analytics_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    env_mode     VARCHAR(8)  NOT NULL,
    merchant_id  VARCHAR(64) NOT NULL,
    event_type   VARCHAR(64) NOT NULL,   -- 'payment.created', 'payment.succeeded', 'payment.failed'
    intent_id    UUID REFERENCES payment_intents(id),
    connector    VARCHAR(64),
    amount_cents BIGINT,
    currency     VARCHAR(8),
    latency_ms   INTEGER,
    payload      JSONB       NOT NULL DEFAULT '{}',
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ae_merchant_env_type ON payment_analytics_events (merchant_id, env_mode, event_type, recorded_at DESC);
```

---

## 7. Layer 5 — Async Workers & Background Jobs {#layer-5}

### Worker Entrypoint (`worker/src/worker.js`)

```javascript
// worker/src/worker.js
const http   = require('http');
const queue  = require('../../backend/src/shared/queue');
const db     = require('../../backend/src/shared/db');
const config = require('../../backend/src/shared/config');

const { handleInvoiceGenerate }     = require('./handlers/invoiceHandler');
const { handleWebhookDispatch,
        handleWebhookReplay }       = require('./handlers/webhookHandler');
const { handleBillingSchedule }     = require('./handlers/billingHandler');
const { handleAnalyticsEvent }      = require('./handlers/analyticsHandler');

const JOB_HANDLERS = {
  'invoice.generate':          handleInvoiceGenerate,
  'webhook.dispatch_event':    handleWebhookDispatch,
  'webhook.replay':            handleWebhookReplay,
  'billing.execute_schedule':  handleBillingSchedule,
  'analytics.record_event':    handleAnalyticsEvent,
};

async function processJob(job) {
  const handler = JOB_HANDLERS[job.type];
  if (!handler) { console.warn(`Unknown job type: ${job.type}`); return; }
  await handler(job.payload);
}

// Health probe on :3001 for K8s liveness
http.createServer(async (req, res) => {
  if (req.url === '/health') {
    try { await db.pingDatabase(); res.writeHead(200).end(JSON.stringify({ status: 'healthy' })); }
    catch (e) { res.writeHead(503).end(JSON.stringify({ status: 'unhealthy', error: e.message })); }
  } else { res.writeHead(404).end(); }
}).listen(process.env.WORKER_PORT || 3001, '0.0.0.0');

// BullMQ / Redis BLPOP consumer loop
(async () => {
  console.log('[worker] Starting consumer loop');
  while (true) {
    try {
      const job = await queue.dequeueJob(2);
      if (job) await processJob(job);
    } catch (err) {
      console.error('[worker] Error:', err.message);
      await new Promise(r => setTimeout(r, 1500));
    }
  }
})();
```

### Invoice Handler with S3/Local Adapter

```javascript
// worker/src/handlers/invoiceHandler.js
const PDFDocument = require('pdfkit');
const storage = require('../../backend/src/shared/invoiceStorage');
const db = require('../../backend/src/shared/db');

async function handleInvoiceGenerate({ intentId, invoiceNumber }) {
  const intent = await db.queryOne('SELECT * FROM payment_intents WHERE id=$1', [intentId]);

  // Generate PDF in memory
  const doc = new PDFDocument({ margin: 50 });
  const buffers = [];
  doc.on('data', b => buffers.push(b));
  doc.text(`INVOICE ${invoiceNumber}`, { align: 'center' });
  doc.text(`Amount: ${(intent.amount_cents / 100).toFixed(2)} ${intent.currency}`);
  doc.text(`Customer: ${intent.customer_email}`);
  doc.text(`Date: ${new Date().toLocaleDateString()}`);
  doc.end();
  await new Promise(r => doc.on('end', r));
  const pdfBuffer = Buffer.concat(buffers);

  // Upload via pluggable storage adapter (S3 or local)
  const objectKey = `invoices/${intent.env_mode}/${invoiceNumber}.pdf`;
  const result = await storage.upload(objectKey, pdfBuffer, 'application/pdf');

  await db.query(
    `UPDATE invoices SET status='ready', object_key=$1, storage_driver=$2,
     s3_bucket=$3, file_size_bytes=$4, generated_at=NOW() WHERE intent_id=$5`,
    [objectKey, result.driver, result.bucket || null, pdfBuffer.length, intentId]
  );
}

module.exports = { handleInvoiceGenerate };
```

### Redis Streams Analytics Consumer

```javascript
// worker/src/handlers/analyticsHandler.js
// Consumes from Redis Stream 'payops:analytics:{envMode}'
const db = require('../../backend/src/shared/db');

async function handleAnalyticsEvent({ envMode, merchantId, eventType, intentId,
                                      connector, amountCents, currency, latencyMs, payload }) {
  await db.query(
    `INSERT INTO payment_analytics_events
     (env_mode, merchant_id, event_type, intent_id, connector, amount_cents, currency, latency_ms, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [envMode, merchantId, eventType, intentId, connector, amountCents, currency, latencyMs, JSON.stringify(payload)]
  );
}

module.exports = { handleAnalyticsEvent };
```

---

## 8. Layer 6 — Signed Webhooks & Delivery Log {#layer-6}

### HMAC-SHA256 Signing (`backend/src/shared/webhookSender.js`)

```javascript
// HMAC-SHA256 signing (Stripe-compatible format):
// X-PayOps-Signature: t=<unix_ts>,v1=<hex_digest>
// Signed payload: "<timestamp>.<rawBody>"

function computeHmacSignature(secret, timestamp, rawBody) {
  const payload = `${timestamp}.${rawBody}`;
  const digest = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}
```

### Webhook Delivery Flow

```javascript
// webhook.dispatch_event job handler
async function handleWebhookDispatch({ envMode, merchantId, eventType, data }) {
  const endpoints = await db.query(
    `SELECT * FROM webhook_endpoints
     WHERE merchant_id=$1 AND env_mode=$2 AND active=true AND $3=ANY(events)`,
    [merchantId, envMode, eventType]
  );

  for (const ep of endpoints.rows) {
    await deliverSignedWebhook({
      endpointId: ep.id, envMode, eventType,
      targetUrl: ep.target_url, secret: ep.signing_secret,
      payload: { event: eventType, created: Date.now(), data }
    });
  }
}
```

### Replay API Endpoint

```javascript
// POST /api/webhooks/:id/replay
router.post('/:id/replay', async (req, res) => {
  const record = await db.queryOne(
    `SELECT wd.*, we.signing_secret FROM webhook_deliveries wd
     LEFT JOIN webhook_endpoints we ON we.id=wd.endpoint_id WHERE wd.id=$1`,
    [req.params.id]
  );
  if (!record) return res.status(404).json({ error: 'Not found' });

  await queue.enqueue('webhook.replay', {
    deliveryId: record.id, endpointId: record.endpoint_id, envMode: record.env_mode,
    eventType: record.event_type, targetUrl: record.target_url,
    secret: record.signing_secret, payload: record.payload
  });

  res.json({ message: 'Replay queued', deliveryId: record.id });
});
```

---

## 9. Layer 7 — React Control Center Frontend {#layer-7}

### Status Banner Component (`frontend/src/components/StatusBanner.jsx`)

```jsx
// frontend/src/components/StatusBanner.jsx
import { useEffect, useState } from 'react';

export function StatusBanner({ mode }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/status', { headers: { 'X-PayOps-Mode': mode } });
        setStatus(await res.json());
      } catch { setStatus(null); }
    };
    poll();
    const timer = setInterval(poll, 15000);
    return () => clearInterval(timer);
  }, [mode]);

  if (!status) return <div className="banner banner--error">⚠ System unreachable</div>;

  return (
    <div className={`banner banner--${status.status}`}>
      <span>● {status.status.toUpperCase()}</span>
      <span>Host: {status.hostname}</span>
      <span>AZ: {status.availabilityZone}</span>
      <span>RDS: {status.rds.pingLatencyMs ?? 'ERR'}ms</span>
      <span>Queue ({status.queue.driver}): {status.queue.healthy ? '✓' : '✗'}</span>
      <span>Commit: {String(status.gitCommitSha).slice(0, 8)}</span>
      <span>Jenkins #{status.jenkinsBuildNumber}</span>
    </div>
  );
}
```

### Dynamic Routing Editor Component (`frontend/src/components/RoutingEditor.jsx`)

```jsx
// frontend/src/components/RoutingEditor.jsx
// Allows merchants to change routing config at runtime (zero restart via Redis invalidation)

import { useState, useEffect } from 'react';
import { api } from '../api';

export function RoutingEditor({ mode }) {
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get('/api/admin/routing', mode).then(setConfig); }, [mode]);

  const save = async () => {
    setSaving(true);
    await api.post('/api/admin/routing', config, mode);
    setSaving(false);
  };

  return (
    <div className="routing-editor">
      <h3>Routing Configuration ({mode} mode)</h3>
      <select value={config?.algorithm_type} onChange={e => setConfig({...config, algorithm_type: e.target.value})}>
        <option value="priority">Priority List</option>
        <option value="volume_split">Volume Split</option>
        <option value="rule">Rule-Based (DSL)</option>
      </select>
      <textarea
        rows={8}
        value={JSON.stringify(config?.config || {}, null, 2)}
        onChange={e => setConfig({...config, config: JSON.parse(e.target.value)})}
      />
      <button onClick={save} disabled={saving}>
        {saving ? 'Saving...' : 'Apply (Zero Restart)'}
      </button>
    </div>
  );
}
```

---

## 10. Layer 8 — Observability & Telemetry {#layer-8}

### Prometheus Metrics (`backend/src/shared/metrics.js`)

```javascript
// backend/src/shared/metrics.js
const client = require('prom-client');
client.collectDefaultMetrics({ prefix: 'payops_' });

exports.register = client.register;

exports.paymentIntentsCounter = new client.Counter({
  name: 'payops_payment_intents_total',
  help: 'Total payment intents created',
  labelNames: ['env_mode', 'currency', 'status']
});

exports.paymentAttemptsCounter = new client.Counter({
  name: 'payops_payment_attempts_total',
  help: 'Total payment attempts (per connector)',
  labelNames: ['env_mode', 'connector', 'status']
});

exports.routingDecisionHistogram = new client.Histogram({
  name: 'payops_routing_decision_duration_ms',
  help: 'Time to resolve routing algorithm and select connector',
  buckets: [1, 5, 10, 25, 50, 100]
});

exports.httpRequestDurationMs = new client.Histogram({
  name: 'payops_http_request_duration_ms',
  help: 'HTTP request duration by route',
  labelNames: ['method', 'route', 'status_code', 'feature'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500]
});

exports.webhooksCounter = new client.Counter({
  name: 'payops_webhooks_total',
  labelNames: ['status', 'event_type']
});

exports.circuitBreakerGauge = new client.Gauge({
  name: 'payops_circuit_breaker_state',
  help: '1=closed, 0=open',
  labelNames: ['connector', 'env_mode']
});
```

---

## 11. Configuration, Secrets & RBAC {#configuration-secrets-rbac}

### RBAC Middleware (`backend/src/middleware/auth.js`)

```javascript
// backend/src/middleware/auth.js
const bcrypt = require('bcryptjs');
const db = require('../shared/db');
const redis = require('../shared/redis');

async function authenticateKey(req, res, next) {
  const key = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'API key required' });

  const mode = key.startsWith('sk_live_') ? 'live' : 'test';
  if (mode !== req.envMode) return res.status(403).json({ error: 'API key / mode mismatch' });

  // Check Redis cache first
  const cacheKey = `auth:${key.slice(0, 20)}`;
  const cached = await redis.get(cacheKey);
  if (cached) { req.auth = JSON.parse(cached); return next(); }

  const hash = await bcrypt.hash(key, 10); // For lookup (store pre-computed hash in DB)
  const rows = await db.query(
    `SELECT ak.merchant_id, ak.role_id, r.name AS role_name
     FROM api_keys ak JOIN rbac_roles r ON r.id=ak.role_id
     WHERE ak.active=true AND ak.env_mode=$1`, [mode]
  );

  // Find matching key
  const match = rows.rows.find(row => bcrypt.compareSync(key, row.key_hash));
  if (!match) return res.status(401).json({ error: 'Invalid API key' });

  req.auth = { merchantId: match.merchant_id, role: match.role_name };
  await redis.set(cacheKey, JSON.stringify(req.auth), 300);
  next();
}

module.exports = { authenticateKey };
```

### Admin Routing Update (`backend/src/routes/admin.js`)

```javascript
// POST /api/admin/routing — Save config → invalidate Redis cache (zero restart)
router.post('/routing', async (req, res) => {
  if (req.auth?.role !== 'admin')
    return res.status(403).json({ error: 'Admin role required' });

  const { algorithm_type, config: algoConfig } = req.body;

  await db.query(
    `UPDATE routing_configs SET active=false
     WHERE merchant_id=$1 AND env_mode=$2`, [req.auth.merchantId, req.envMode]
  );
  await db.query(
    `INSERT INTO routing_configs (merchant_id, env_mode, algorithm_type, config, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [req.auth.merchantId, req.envMode, algorithm_type, JSON.stringify(algoConfig), req.auth.merchantId]
  );

  // Invalidate Redis cache → next payment request reloads from DB
  await redis.del(`routing:algo:${req.envMode}:${req.auth.merchantId}`);

  res.json({ message: 'Routing config updated. Active in <1s without restart.' });
});
```

---

## 12. Docker / Docker-Compose Specification {#docker-specification}

### `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:15-alpine
    container_name: payops-postgres
    environment:
      POSTGRES_DB: payops
      POSTGRES_USER: payops_admin
      POSTGRES_PASSWORD: change_me_in_secrets_manager
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/migrations:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U payops_admin -d payops"]
      interval: 5s; timeout: 5s; retries: 10

  redis:
    image: redis:7-alpine
    container_name: payops-redis
    ports: ["6379:6379"]
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]; interval: 5s; timeout: 3s; retries: 10

  api:
    build:
      context: ./backend
      args:
        GIT_COMMIT_SHA: ${GIT_COMMIT_SHA:-local}
        JENKINS_BUILD_NUMBER: ${JENKINS_BUILD_NUMBER:-0}
    container_name: payops-api
    environment:
      PORT: 3000
      DB_HOST: postgres
      REDIS_URL: redis://redis:6379
      QUEUE_DRIVER: redis
      VAULT_ENCRYPTION_KEY: ${VAULT_ENCRYPTION_KEY}
      WEBHOOK_SIGNING_SECRET: ${WEBHOOK_SIGNING_SECRET}
    ports: ["3000:3000"]
    volumes: [invoice_data:/app/storage/invoices]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }

  worker:
    build: ./worker
    container_name: payops-worker
    environment:
      DB_HOST: postgres
      REDIS_URL: redis://redis:6379
      QUEUE_DRIVER: redis
      WORKER_PORT: 3001
    volumes: [invoice_data:/app/storage/invoices]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }

  frontend:
    build: ./frontend
    container_name: payops-frontend
    ports: ["8080:80"]
    depends_on: [api]

  prometheus:
    image: prom/prometheus:latest
    volumes: [./observability/prometheus.yml:/etc/prometheus/prometheus.yml:ro]
    ports: ["9090:9090"]

  grafana:
    image: grafana/grafana:latest
    environment: { GF_SECURITY_ADMIN_PASSWORD: admin }
    volumes:
      - ./observability/grafana/provisioning:/etc/grafana/provisioning:ro
    ports: ["3002:3000"]

volumes:
  pgdata:
  invoice_data:
```

---

## 13. Phased Build Plan {#phased-build-plan}

```mermaid
flowchart LR
    P1[Phase 1\nMonorepo + DB + Config]
    P2[Phase 2\nAPI Gateway + State Machine]
    P3[Phase 3\nRouting Engine + Connectors]
    P4[Phase 4\nVault + Security]
    P5[Phase 5\nWorker + Webhooks]
    P6[Phase 6\nFrontend React UI]
    P7[Phase 7\nDocker + K8s + Jenkins]

    P1 --> P2 --> P3 --> P4 --> P5 --> P6 --> P7
```

### Phase 1 — Monorepo Foundation & Database (Day 1)
```bash
# 1. Init monorepo with npm workspaces
mkdir payops && cd payops
npm init -y
# Add to package.json: "workspaces": ["backend","worker","frontend"]

# 2. Create directory tree
mkdir -p backend/src/{middleware,routes,payments/connectors,shared} \
         worker/src/handlers frontend/src/components \
         db/{migrations,seeds} k8s observability

# 3. Install backend deps
cd backend && npm init -y
npm install express cors swagger-ui-express prom-client pino ioredis pg bcryptjs pdfkit

# 4. Install worker deps
cd ../worker && npm init -y
npm install ioredis pg pdfkit

# 5. Write all 8 migration files in db/migrations/
# 6. Start infrastructure only
docker compose up postgres redis -d

# 7. Run migrations
psql postgresql://payops_admin:change_me@localhost:5432/payops \
  -f db/migrations/001_core_tables.sql
# ... repeat for 002–008
```

### Phase 2 — API Gateway, Middleware, State Machine (Day 1–2)
```
Write in order:
  backend/src/shared/{config.js, logger.js, db.js, redis.js, metrics.js}
  backend/src/middleware/{traceId.js, envMode.js, piiMask.js, metrics.js}
  backend/src/payments/stateMachine.js
  backend/src/payments/gsm.js
  backend/src/routes/telemetry.js  → GET /status, GET /health
  backend/src/app.js + server.js

Test:
  node backend/src/server.js
  curl http://localhost:3000/health
  curl http://localhost:3000/status
```

### Phase 3 — Routing Engine, Connectors, Redis Locking (Day 2–3)
```
Write in order:
  backend/src/shared/redis.js    (acquireLock, releaseLock, slidingWindow, circuitState)
  backend/src/payments/router.js (loadAlgorithm, resolveConnectors, _weightedShuffle, _evaluateRules)
  backend/src/payments/connectors/base.js
  backend/src/payments/connectors/mockStripe.js
  backend/src/payments/connectors/mockPaymo.js
  backend/src/routes/payments.js (full create + cascade flow)
  
  Seed routing config:
  INSERT INTO routing_configs (merchant_id, env_mode, algorithm_type, config, active)
  VALUES ('merch_default','test','priority',
    '{"connectors":["mock_stripe","mock_paymo"]}', true);

Test:
  curl -X POST localhost:3000/api/payments \
    -H "X-PayOps-Mode: test" -H "X-API-Key: sk_test_demo" \
    -d '{"amount_cents":4999,"currency":"USD","merchant_id":"merch_default"}'
```

### Phase 4 — Vault Boundary, Encryption, RBAC (Day 3)
```
Write in order:
  backend/src/shared/crypto.js    (AES-256-GCM encrypt/decrypt)
  backend/src/payments/vault.js   (tokenize, detokenize)
  backend/src/middleware/auth.js  (API key RBAC from api_keys + rbac_roles)
  backend/src/routes/admin.js     (GET/POST /api/admin/routing with cache invalidation)

Seed:
  INSERT INTO rbac_roles (name) VALUES ('admin'),('operator'),('viewer');
  -- Insert hashed test key for sk_test_demo_key
```

### Phase 5 — Async Worker, Webhooks, Analytics (Day 4)
```
Write in order:
  backend/src/shared/queue.js          (enqueue: redis RPUSH / sqs / memory)
  backend/src/shared/webhookSender.js  (HMAC-SHA256 + delivery logging)
  backend/src/shared/invoiceStorage.js (S3 + local adapter)
  backend/src/routes/webhooks.js       (endpoints CRUD + deliveries + replay)
  worker/src/worker.js                 (BLPOP loop + health :3001)
  worker/src/handlers/invoiceHandler.js
  worker/src/handlers/webhookHandler.js
  worker/src/handlers/billingHandler.js
  worker/src/handlers/analyticsHandler.js
  backend/src/routes/billing.js        (schedules + cron trigger)
  backend/src/routes/invoices.js       (list + pre-signed URL download)

Test:
  docker compose up  # starts with redis queue
  curl -X POST localhost:3000/api/payments -d '{"amount_cents":4999,...}'
  # Watch worker logs: invoice generated, webhook dispatched
```

### Phase 6 — React Control Center Frontend (Day 4–5)
```
Write in order:
  frontend/src/api.js              (fetch wrapper with mode header injection)
  frontend/src/components/StatusBanner.jsx
  frontend/src/components/PaymentsTable.jsx
  frontend/src/components/RoutingEditor.jsx
  frontend/src/components/WebhookLog.jsx   (+ Replay button)
  frontend/src/components/InvoiceList.jsx  (+ Pre-signed PDF download)
  frontend/src/components/RbacManager.jsx
  frontend/src/App.jsx
  frontend/public/index.html

Build:
  cd frontend && npm run build
  # nginx serves /dist via frontend/Dockerfile
```

### Phase 7 — Docker, K8s, Jenkins (Day 5–6)
```
Write in order:
  backend/Dockerfile      (node:20-alpine multi-stage)
  worker/Dockerfile       (node:20-alpine)
  frontend/Dockerfile     (node:20-alpine build → nginx:alpine serve)
  docker-compose.yml      (full stack: postgres, redis, api, worker, frontend, prometheus, grafana)
  k8s/api-deployment.yaml         (3 replicas, liveness/readiness probes)
  k8s/worker-deployment.yaml      (1–3 replicas, HPA on queue depth)
  k8s/ingress.yaml                (nginx ingress: / → frontend, /api → api)
  Jenkinsfile                     (lint → test → docker build → ECR push → ECS/K8s deploy)

Run full stack:
  docker compose up --build
  open http://localhost:8080    # React Control Center
  open http://localhost:3000/api-docs  # Swagger UI
  open http://localhost:3002   # Grafana
```

---

## 14. Environment Variables Reference {#env-reference}

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | API server port |
| `WORKER_PORT` | `3001` | Worker health probe port |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_NAME` | `payops` | Database name |
| `DB_USER` | `payops_admin` | DB user |
| `DB_PASSWORD` | *(required)* | DB password (from Secrets Manager) |
| `DB_SSL` | `false` | Enable SSL for RDS |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `QUEUE_DRIVER` | `memory` | `redis` / `sqs` / `memory` |
| `SQS_QUEUE_URL` | *(optional)* | AWS SQS queue URL |
| `VAULT_ENCRYPTION_KEY` | *(required)* | 32-byte hex AES-256-GCM key for PAN encryption |
| `WEBHOOK_SIGNING_SECRET` | *(required)* | HMAC-SHA256 default signing secret |
| `S3_BUCKET_NAME` | *(optional)* | S3 bucket for PDF invoices (local fallback if empty) |
| `S3_PRESIGNED_TTL_SECONDS` | `900` | Pre-signed URL TTL |
| `GIT_COMMIT_SHA` | `local-dev` | Injected by CI/Jenkins build arg |
| `JENKINS_BUILD_NUMBER` | `0` | Injected by Jenkins |
| `AWS_REGION` | `eu-north-1` | AWS deployment region |
| `AWS_AVAILABILITY_ZONE` | *(auto)* | From ECS task metadata or env override |
| `APP_DEFAULT_MODE` | `test` | Default `test` or `live` |
| `SERVE_STATIC_FRONTEND` | `true` | Serve React build from API container |
| `AUTO_MIGRATE` | `true` | Run migrations on startup |
| `MOCK_STRIPE_URL` | `http://localhost:4001` | MockStripe endpoint (integration tests) |
| `MOCK_PAYMO_URL` | `http://localhost:4002` | MockPaymob endpoint |

---

> [!NOTE]
> **What's already built in Q1:** `server.js`, `services/api/`, `services/worker/`, `services/frontend/public/app.js`, `shared/`, `db/init.sql`, `docker-compose.yml`, `Dockerfile`, `Jenkinsfile`, `observability/` are all production-ready and cover the core stack. The architecture above targets the **delta**: adding `payment_intents`/`payment_attempts` state machine, the VaultClient boundary, the routing engine with Redis circuit breakers, encrypted credentials, RBAC, and the React component-based frontend upgrade.

> [!IMPORTANT]
> **Security checklist before going live:**
> - Rotate `VAULT_ENCRYPTION_KEY` and `WEBHOOK_SIGNING_SECRET` from AWS Secrets Manager (never `.env` in production).
> - Enable `DB_SSL=true` for RDS connections.
> - Switch `sk_test_` to `sk_live_` and enforce strict mode isolation at the DB level.
> - Enable Redis `AUTH` and TLS in production (`rediss://`).
> - Run `PCI DSS scope reduction audit`: vault_tokens table must be in a dedicated RDS schema with strict IAM policies.
