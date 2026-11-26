# v1.5 verification, 2026-11-23

- Production build and TypeScript check: PASS.
- Database-backed production smoke run on isolated PostgreSQL 16.6: PASS.
- Existing integration.mjs, test-marketplace.mjs and test-signed-webhooks.mjs: all PASS, covering concurrent demo checkout/refund replay, ledger constraints, staff roles, customer/account carts, coupon limits, orders, delivery updates, signed webhook replay and local OTLP collector.
- Browser spacing/overflow checks on 12 public routes at 320/390/768/1280px: PASS. Sticky header and Account/Help dropdown checks at all four widths: PASS. Home/account mobile/desktop screenshots inspected visually.
- Windows setup-local.ps1 syntax/execution checked using PowerShell 7.4.6 on Linux: PASS. Generated env JSON, secret lengths, DB URL consistency and repeat-run preservation checked without exposing secrets. Windows PowerShell 5.1 itself was not available to run.
- Docker Compose v2.32.4 config validation using locally generated .env: PASS. Docker daemon/container/image build not available here, so full Compose services were NOT launched. App was built and run directly against real isolated Postgres.
- Dump/restore into a separate isolated database, historical ledger guards + normalization, and new guard installation: PASS. Data retained and only new named ledger triggers remain. Full Windows/Compose migration commands are documented but not executed against the user's computer.
- Case-insensitive old-brand scan of deliverable text/file paths: zero matches. User's historical database contents are not rewritten.
- Kubernetes/Helm/Terraform renamed starters were not deployed or applied. No live Stripe network purchase/refund was made.
- Completed secret-bearing .env files, dependencies, build caches and test databases are excluded from the ZIP.

Earlier verification history follows. Its checks are scoped to their release.

# Verification record, 23 Nov 2026

These checks ran on the delivered source. No external accounts were charged.

| Check | Result | Scope |
|---|---|---|
| `npm ci --no-audit --no-fund` | PASS | clean lockfile install, Node 22.23.5 |
| `npx prisma generate` | PASS | Prisma 5.22.0, native + Alpine OpenSSL 3 targets |
| `npm run typecheck` | PASS | TypeScript, no emit |
| `npm run build` | PASS | optimized Next.js 15.5.29 build, all routes |
| `npm audit --omit=dev` | PASS, zero findings | point-in-time package audit, not a security review |
| `npm run db:setup` + seed | PASS | actual PostgreSQL 14.24, constraints applied twice successfully |
| `npm run test:integration` | PASS | 8 simultaneous same-key checkouts and 8 refunds each create one effect; key conflict/missing key; duplicate-refund guard; 401/403; ledger totals + rejection of unbalanced insert; reservation release once; webhook retries/dead-letter/requeue/ignore; invalid delivery log; metrics; audit; all admin routes |
| Signed synthetic webhook test | PASS | 8 concurrent signed deliveries create one payment/two ledger legs; all delivery receipts; expiration replay releases once; late paid event fails safely; no Stripe API calls |
| OpenTelemetry HTTP export | PASS | real app instrumentation emitted OTLP to local test HTTP collector; not tested through deployed Tempo |
| Browser login | PASS | actual token form submission, redirect, HttpOnly session and authenticated navigation |
| Responsive UI | PASS | storefront and all admin routes inspected at 390/1280 px; login at 320 px; mobile orders/dashboard now use cards; supplemental ledger details scroll |
| Helm 3.16.4 lint/template | PASS | no chart errors, icon recommendation only; six rendered resource documents |
| Terraform 1.9.8 init/validate/fmt | PASS | real Kubernetes/Helm providers initialized, no cloud credentials or plan/apply used |
| YAML parsing | PASS | Compose, raw K8s, rendered Helm and CI YAML |

Not run: Docker image/Compose startup (no Docker daemon), actual Stripe checkout/refund API, PostgreSQL 16 target, full Prometheus/Grafana/Tempo stack, Kubernetes rollout, Terraform plan/apply against a cluster. The integration CI job targets PostgreSQL 16 but has not been executed on GitHub here.

To repeat the extra signed-webhook/OTLP check, build first and run `node scripts/test-signed-webhooks.mjs` with `DATABASE_URL` exported against an isolated seeded database, port 3101 free. It uses a fake test key only to enable webhook verification and does not call the Stripe API. The script starts/stops its own production app and local collector. Test data is retained for inspection.

Operational limits and deployment prerequisites are documented in README.md beside each feature. Source archives exclude dependencies, build outputs, TypeScript cache, .terraform providers, .env secrets and test databases.

## v1.3 multi-page storefront, 23 Nov 2026

| Check | Result | Scope |
|---|---|---|
| `npm run typecheck` / `npm run build` | PASS | 18 routes including /products, /products/[slug], /cart, /orders, /track, /about |
| `npm run test:integration` | PASS | unchanged v1.1 PayOps suite against PostgreSQL 14.24 |
| `npm run test:marketplace` | PASS | customer auth, carts, coupons, combined checkout, fulfillment |
| `npm run test:webhooks` | PASS | signed synthetic webhooks + OTLP export |
| Headless Chrome 320/390/1280px | PASS | 46 assertions: page split, navigation, filters/sort/search, product pages, cart page, guest merge, demo checkout, orders, tracking; zero client errors |

## v1.4 UI release, 23 Nov 2026

See UI-V1.4.md for the checks run on this release and the upgrade steps. Database, payment, Docker and deployment tests above are historical and were not rerun for v1.4.
