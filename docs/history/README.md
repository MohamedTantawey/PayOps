# PayOps v1.6

**v1.6:** the category menu (All products, Clothing, Footwear, Accessories) is now part of the sticky header on every page, and there is a clear gap between the header and the page content. No database, env or setup changes: v1.5 instructions still apply. See [LAYOUT-V1.6.md](LAYOUT-V1.6.md).

**Start with [RENAME-V1.5.md](RENAME-V1.5.md).** This is a full identifier rename, not the earlier UI-only update. This release is configured for your chosen clean database start; old data is not imported. Run `setup-local.ps1` to generate your local `.env`. Older version sections below are historical; v1.5 instructions take precedence.

# PayOps v1.4

Brand refresh, sticky navigation, working Account and Help dropdowns, and slightly larger type across pages. See [UI-V1.4.md](UI-V1.4.md) for details. Existing setup and stored data remain compatible.

# PayOps Marketplace v1.2

The current storefront includes customer accounts, cart checkout, coupons and staff-updated order tracking. Read [MARKETPLACE-V1.2.md](MARKETPLACE-V1.2.md) first for setup, upgrade steps, checks and production limits. The original engineering guide follows below.

# PayOps: commerce + PayOps, v1.1

A runnable single-item store with PostgreSQL-backed payment controls, a role-protected operations dashboard, and deployment starters. Stripe is simulated when the secret key is missing or contains `REPLACE_ME`. Demo mode still needs PostgreSQL. This is a learning/starter stack, not a certified financial system or a turnkey production deployment.

## Start with Docker Compose

Requires Docker Engine with Compose, Node 20+ for local commands, and free ports 3000, 3001, 5432 and 9090.

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-local.ps1
docker compose up --build -d
```

Use locally generated random values, for example `openssl rand -hex 32`. `ADMIN_TOKENS` is a JSON array. Assign each operator a distinct name and token:

```dotenv
ADMIN_TOKENS='[{"name":"alice","role":"admin","token":"REPLACE_WITH_A_RANDOM_32_BYTE_VALUE"},{"name":"omar","role":"ops","token":"REPLACE_WITH_A_DIFFERENT_RANDOM_VALUE"},{"name":"salma","role":"finance","token":"REPLACE_WITH_ANOTHER_RANDOM_VALUE"}]'
```

The example strings describe placeholders, not passwords to reuse. Tokens require 24+ characters; `SESSION_SECRET` requires 32+. There is no built-in admin password and the default empty token array denies admin access. Keep `COOKIE_SECURE=false` only for localhost HTTP; use `true` with HTTPS.

- Store: http://localhost:3000
- Login: http://localhost:3000/login, then `/admin`
- Grafana: http://localhost:3001, user `admin`, your `GRAFANA_ADMIN_PASSWORD`
- Prometheus: http://localhost:9090
- Metrics: http://localhost:3000/metrics

Compose starts Postgres, app, a one-minute maintenance worker, Prometheus, Grafana and Tempo. App boot applies the Prisma schema plus ledger constraints and seeds missing products. Seeding no longer resets existing stock. Local Compose binds exposed ports to loopback. This uses locally generated database credentials and must not be exposed as-is.

## Local development

```sh
cp .env.example .env
# Configure secrets above, including GRAFANA_ADMIN_PASSWORD for Compose validation.
docker compose up db -d
npm ci
npm run db:setup
npm run prisma:seed
npm run dev
# In another terminal with the same .env variables exported:
WORKER_APP_URL=http://localhost:3000 npm run worker
```

Next loads `.env` for the app. Prisma CLI loads `.env`. Plain Node worker/test scripts require exported environment variables (Node 20.6+ also supports `node --env-file=.env scripts/worker.mjs`). Without the worker, webhook retries and reservation cleanup do not run on a clock.

## The seven additions

### 1. Persistent idempotency

`POST /api/checkout` and `POST /api/refunds` require an `Idempotency-Key` header of 16-120 letters, digits, `_` or `-`. The browser keeps the same key for retries within the current page. A full reload is a new checkout intent, so API clients should persist their key until the result is known.

`IdempotencyRecord` stores the normalized request fingerprint, durable operation context and completed JSON response. A same-key retry returns the saved response; a different payload with the same key returns 409. Successful routes return HTTP 200. Validation failures before creating an operation are not cached. Financial state transitions use a PostgreSQL advisory transaction lock, shared across app replicas. This deliberately serializes transitions and is not intended for high throughput.

Stripe creation calls also carry stable provider idempotency keys. Network calls run outside database transactions; a crash after provider success can resume using the saved context and provider key. Refund attempts older than 23 hours require manual provider review instead of risking a second refund after Stripe's key-retention window. Checkout session creation must start within the first five minutes of its 35-minute reservation. Unresolved old checkouts are rejected for operator review. Stored keys/results are not automatically deleted.

```sh
curl -X POST http://localhost:3000/api/checkout \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: checkout-example-0001' \
  -d '{"productId":"ID_FROM_DATABASE","quantity":1}'

curl -X POST http://localhost:3000/api/refunds \
  -H "Authorization: Bearer $FINANCE_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: refund-example-000001' \
  -d '{"orderId":"ORDER_ID","why":"Customer requested a full refund"}'
```

Refunds are full-order only, finance/admin only, and require a reason. A pending refund row blocks a competing key from refunding the same order. A pending/failed provider refund stays for operator review; it is not silently retried with a new key or deleted. A successful late webhook can finish the ledger state. Refunds do not automatically restock merchandise.

### 2. Double-entry ledger

Every successful payment posts a debit to `stripe_clearing` and a credit to `sales`. Every successful refund posts a debit to `refunds` and a credit to `stripe_clearing`. Integer amounts are minor currency units. Each movement has two positive legs, one currency and a stable movement ID.

Both legs and the payment/refund/order transition commit in one transaction. `npm run db:setup` installs a deferred PostgreSQL balancing constraint, positive-leg checks and an append-only trigger. Do not use only `prisma:push` for setup: it does not install the SQL constraints. Corrections need reversing entries, not edits/deletes. The database owner can still alter constraints; this is not tamper-proof storage.

`/admin/payouts` groups all ledger entries by currency/account and shows the trial balance, clearing balance and latest 100 legs. Dashboard sales/refunds derive from the ledger (EGP summary). No fee estimates are presented as actual costs. Stripe fees, bank payouts, disputes, taxes, FX and settlement imports are **not implemented**, so the clearing balance is not a bank-reconciled payout. The old Payment fee/net columns remain for compatibility and are not the reporting source.

**Existing v1.0 database:** stop the app/worker and back up first. Run `npm run db:setup`, then `node scripts/backfill-ledger.mjs` once with `DATABASE_URL` exported. The script is repeatable and refuses ambiguous duplicate-payment history, which needs manual reconciliation. Old pending orders without reservations also need operator review. Use reviewed versioned migrations for production, not unattended `db push` on multiple replicas.

### 3. Webhook resilience

`WebhookDelivery` records each accepted-size HTTP delivery, timestamp, signature validity, event ID when verified, and body hash. Invalid payloads are hashed only. Oversized payloads (>1 MB) are rejected before recording. If the database is unavailable, a delivery cannot be stored and returns 503. `WebhookEvent` stores the signed, verified event once, its payload and state:

`RECEIVED -> SUCCEEDED / IGNORED / FAILED -> DEAD`

Failures use exponential backoff starting at 60 seconds, five attempts, then `DEAD`. Stripe redelivery and the minute worker reuse the same stored event; financial transitions are deduplicated transactionally. No permanent PROCESSING lease can strand an event on a crash. Concurrent failed attempts can consume the retry budget faster, but cannot duplicate money entries. Unknown event types become IGNORED. `/admin/events` shows states, attempts, errors, next retry and recent deliveries.

Supported effects: `checkout.session.completed` (paid card sessions only), `checkout.session.expired`, and `charge.refunded` (lists all provider refunds so a truncated embedded list does not lose refunds). Out-of-order refunds retry until their order/payment reference exists. Refunds issued externally in Stripe also enter the local ledger. After fixing a dead event's cause, admin can requeue it with an audited reason:

```sh
curl -X POST http://localhost:3000/api/admin/events/retry \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"eventId":"evt_...","why":"Corrected the missing order mapping"}'
```

Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `NEXT_PUBLIC_APP_URL`. For local test mode:

```sh
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Use the webhook secret returned by your own Stripe CLI. Never use production keys for demo testing. Raw verified webhook JSON may contain personal information; add a retention policy and restrict database access before real use.

### 4. Inventory reservations

Starting checkout atomically subtracts available stock and writes a HELD reservation. Insufficient stock returns 409. The hold lasts **35 minutes**, allowing Stripe's minimum 30-minute Checkout expiry plus session-creation margin. Payment changes HELD to COMMITTED without subtracting twice. Demo payments commit immediately.

The worker releases expired holds once. For Stripe orders it first verifies the saved session is expired; an expired-session webhook can also release the hold. A paid-but-late event after release fails into operator review rather than overselling. If a provider creation crash left no saved session ID, the worker conservatively keeps that stock on hold, because the provider outcome is unknown. Operators must check Stripe, repair the session reference or resolve/cancel the order before release. This exceptional unresolved state is not guaranteed to release automatically at the deadline. Normal releases happen on the next worker tick (roughly up to one minute late while healthy).

### 5. Observability

`src/instrumentation.ts` starts OpenTelemetry in the Node runtime when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. HTTP instrumentation plus explicit `checkout`, `refund` and `webhook` spans export via OTLP/HTTP to Tempo in Compose. No exporter endpoint means no trace export. `/metrics` exposes Prometheus process metrics, operation result counters and duration histograms. Metrics are per app process and restart with it.

Grafana provisions Prometheus + Tempo datasources and a starter PayOps dashboard with operation rate, p95 latency, resident memory and scrape health. Compose mounts the configs under `observability/`. Traces are explored through Tempo; the starter dashboard uses metrics only. There are no alert rules or SLOs. OTLP export was verified with a local test collector; the full Tempo/Grafana stack was not started. `/metrics` is unauthenticated for scraping: restrict it at ingress/network level, and do not expose it to the internet. Infrastructure templates expect your own cluster monitoring stack; Compose monitoring is not bundled into Helm/Terraform.

### 6. RBAC and audit

| Capability | ops | finance | admin |
|---|---|---|---|
| Dashboard/orders/webhook state | yes | yes | yes |
| Ledger/reconciliation and full refund | no | yes | yes |
| Audit log and dead-event requeue | no | no | yes |

`/admin` authenticates server-side. API checks are independent of the UI. Login exchanges an assigned token for an HMAC-signed, HttpOnly, SameSite=Strict one-hour cookie. The cookie contains a token fingerprint, not the reusable token. API clients may use Bearer tokens. Removing a token from config revokes its sessions after restart. Sign-out clears the cookie. Origin checks reject cross-origin browser POSTs. HTTPS plus `COOKIE_SECURE=true` is required for deployment.

`AuditLog` captures who, role, what, target, when (UTC), and why for successful login/logout, every authorized page render, refund request/completion, and dead-event requeue. Read reasons identify the requested page; mutations require a human reason. Unauthenticated attempts, denied reads and background worker activity are not admin actions in this log. Render prefetches can produce extra view entries. `/admin/audit` shows the last 200 rows. Audit is not cryptographically signed or exported to immutable storage. Token auth is deliberately simple: no SSO, MFA, user-management UI or built-in login throttling. Add edge rate limits and enterprise auth before exposure.

### 7. Deployment starters

All three paths deploy the **same** app/Postgres/worker stack. Choose one; do not install multiple owners of the same resources. You need an existing cluster, kubectl, a default StorageClass and an image registry. The sample database is a single instance with a PVC, not HA. There is no cloud-cluster creation, DNS, TLS certificate, ingress, managed database, backup policy, NetworkPolicy or monitoring installation.

Build and push your own immutable image tag:

```sh
docker build -t registry.example.com/team/payops:1.1.0 .
docker push registry.example.com/team/payops:1.1.0
```

**Raw Kubernetes**

1. Create namespace `payops`: `kubectl create namespace payops`.
2. Copy `deploy/k8s/secret.example.yaml` outside the repository. Replace every placeholder, especially database credentials and public URL. Apply your private copy. URL-encode special characters in `DATABASE_URL` passwords.
3. Edit app/worker image references in `deploy/k8s/stack.yaml`, then `kubectl apply -f deploy/k8s/stack.yaml`.
4. `kubectl -n payops rollout status deployment/payops`.
5. Local inspection: `kubectl -n payops port-forward svc/payops 3000:80`. For localhost HTTP testing only, set the secret URL to `http://localhost:3000` and cookie secure false, then restart pods. Production needs HTTPS ingress and the real public URL instead.

`/metrics` health probes verify the web process, not database readiness. App startup applies schema/ledger constraints; production should move this into a controlled migration Job. Keep replicas at one until migrations, pooling, locking throughput and operation coordination are reviewed.

**Helm**

```sh
kubectl create namespace payops
# Create payops-secrets in that namespace from your private, completed secret template first.
helm lint deploy/helm/payops
helm template payops deploy/helm/payops -n payops
helm upgrade --install payops deploy/helm/payops -n payops \
  --set image.repository=registry.example.com/team/payops --set image.tag=1.1.0
```

Chart values expose image, existingSecret and database storage size. Resource/service names are fixed to `payops`; install at most one release per namespace. It does not create secrets.

**Terraform**

```sh
# Existing namespace + secret are prerequisites, created out-of-band as above.
cd deploy/terraform
terraform init
terraform fmt -check
terraform validate
terraform plan -var='image_repository=registry.example.com/team/payops' -var='image_tag=1.1.0'
# Review your own plan, then run terraform apply with the same variables.
```

Terraform reads the existing namespace and installs the local Helm chart through Kubernetes/Helm providers. It does not create a cloud account, cluster or secrets and does not store secret values in configuration. Review state storage/access in your environment. `terraform destroy` uninstalls the Helm release, so back up the database first; PVC retention depends on your cluster/storage policy.

## Checks and tests

```sh
npm ci
npx prisma generate
npm run typecheck
npm run build
npm audit --omit=dev
```

Database-backed test suite (destructive test fixtures, **isolated database only**): export `DATABASE_URL`, `ADMIN_TOKENS` containing admin+ops tokens, `TEST_ADMIN_TOKEN`, `TEST_OPS_TOKEN`, `SESSION_SECRET`, `MAINTENANCE_TOKEN`, and set `NEXT_PUBLIC_APP_URL=http://localhost:3100`. Use demo Stripe settings. Run setup + seed, build, start `PORT=3100 npm start`, then `npm run test:integration` in another terminal. It checks concurrent retries, conflicts, auth/roles, refund guard, ledger balance + DB constraints, expiry/release once, failed/dead/requeued/ignored events, invalid delivery logging, metrics, audit and admin routes. Test fixtures remain for inspection. CI includes this suite against PostgreSQL 16.

Verified on 23 Nov 2026: clean `npm ci`, Prisma generation, TypeScript, production build, and integration suite against local PostgreSQL 14.24. The deployed Compose target is PostgreSQL 16. Next.js was upgraded from inherited 14.2.18 to 15.5.29 after dependency advisories, with async request APIs updated. A PostCSS override removes the nested vulnerable version. Production dependency audit reported zero findings at verification time; this is not a security certification. Prisma/OpenSSL Alpine fix is preserved. Helm lint/template, Terraform init/validate/fmt and YAML parsing also passed. Signed synthetic Stripe webhooks and local OTLP trace export were checked. Docker daemon builds, real Stripe API calls, the full observability stack, and real cluster deployments were not run here. See `VERIFICATION.md` for exact check scope.

## Remaining product scope

Single-product Buy now, no cart/customer accounts; no receipt emails (success page no longer promises one); product art remains gradient/emoji placeholders. The catalog renders fallback products if DB is unavailable but checkout correctly requires the database. Financial and admin paths fail closed on database errors. Add reviewed migrations, stronger auth/rate limits, monitoring alerts, provider settlement/fee ingestion, retention/backups, durable operational runbooks and a security review before real money.
