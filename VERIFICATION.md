# Verification | PayOps v2.0

Verified 23-24 November 2026. Release source verified before publication.

## Passed

- Clean npm dependencies and production builds for independently packaged Web (Next.js 15.5.29), Commerce (Next.js + Prisma 5.22) and Identity (Node HTTP + Prisma).
- All three production processes ran simultaneously on separate ports with Web configured WITHOUT `DATABASE_URL` or Prisma.
- Independent service schemas applied to separate Commerce and Identity databases/roles in local PostgreSQL 14.24. Cross-role reads of Commerce tables from Identity were denied. Compose targets separate PostgreSQL 16 containers, separate credentials and internal data networks.
- Six concurrent marketplace requests with one key produced one order/payment. Payload and customer-owner changes with that key returned 409.
- Customer registration/login/logout and wrong-password rejection, customer/cart/order isolation, cart validation, customer order history, admin fulfillment and coupon creation.
- Eight-way single-item checkout replay and eight-way refund replay, no duplicate money records, refund role restrictions and duplicate-refund guard.
- Balanced two-leg payment/refund ledger; database rejects an unbalanced write. Inventory decreases once. Reservation expiry releases once. Webhook failed/dead/requeue/ignored states and invalid delivery hashes.
- Signed synthetic Stripe webhook redelivery x8: one payment/ledger commit, eight delivery receipts, expiry replay, rejection of late paid inventory state. Local OTLP HTTP collector received exported trace data. No real Stripe provider calls used.
- Controlled Identity outage after payment: storefront catalog rendered, account API failed safely, paid order/payment survived, pending outbox recorded delivery failure. After restart, maintenance delivered cart cleanup. Replayed event did not subtract cart quantity twice.
- Service-key checks, Web proxy allowlist, same-origin mutation checks, and public isolation of internal maintenance route.
- All staff pages through Web with admin credentials. Ops dashboard separately checked after removing its dependency on finance-only ledger read API.
- YAML and Docker Compose v2 config validation. Separate Dockerfile/context for each service. Schema/seed steps belong to owning services. Web has no database package.
- Actual mobile browser registration, product page and add-to-cart flow, staff form login redirect/cookie, and ops dashboard/orders passed.
- Desktop 1280px and mobile 390px screenshots from running Web production build. Home, account, staff dashboard inspected. No horizontal document overflow; v1.6 navigation/content gap retained.
- `npm audit --omit=dev`: zero findings in each service at verification time. This is not a security certification.

## Not verified / not provided

- At the v2.0 verification time, Docker Engine was unavailable. Actual Docker image builds, containers, Compose startup, and Postgres 16 runtime had NOT been run then. Compose config validation is not a substitute for that check. Run the supplied Compose smoke command on the target machine.
- GitHub Actions workflow is authored but no successful hosted CI run has been observed.
- Real Stripe API calls, live money, the complete Prometheus/Grafana/Tempo stack, real deployment, load testing, Kubernetes, TLS and production networking are unverified.
- Old data migration is NOT included. Fresh v2 volumes are intentional; preserve the old folder/volumes.
- This is Web + Commerce + Identity, not separate services for orders/payments/inventory. Financial modules share ONE Commerce-owned database by design.

## Reproduction

Use a fresh demo-only stack. Root `tests/smoke.mjs` calls the public BFF. In Compose:

```powershell
docker compose exec -T commerce sh -c 'TEST_APP_URL=http://web:3000 TEST_COMMERCE_URL=http://localhost:3000 node scripts/compose-smoke.mjs'
```

For the direct local process harness, service build commands are `npm ci && npm run build` from each service folder. Commerce's `npm run test:integration` requires a dedicated seeded database, direct `TEST_APP_URL`/`COMMERCE_SERVICE_TOKEN`, a running Web URL for UI checks, admin/ops test tokens and maintenance token. `npm run test:webhooks` starts a second Commerce process on 3101 and uses synthetic keys. The resilience test uses SIGUSR1 coordination and a controlled Identity stop/restart; it is an integration harness for an isolated Unix environment, not a production command.

These tests create QA fixtures and consume stock. Never run them on a real-money database. There is no auto-cleanup of test fixtures.

## v2.1 gateway wiring (2026-11-26)
Run without Docker: gateway unit/integration tests (12 pass); Commerce typecheck (tsc) clean; `tests/gateway-e2e` passes (real gateway + real Commerce code on embedded Postgres): paid checkout, replayed webhook, bad signature, refund, expiry cancel, missed-webhook reconcile, marketplace checkout. **Not run:** `docker compose up` (no Docker available where this was built), the Next.js production build of the new route, the browser UI of the hosted card page.

## v2.2 hosted checkout integration (2026-11-26)
Verified using isolated Docker Compose stacks and Q1's simulated test connector:

- Storefront checkout created a Commerce order and a Q1 hosted checkout session; the secret-protected session returned `requires_payment_method`.
- A simulated test-card payment succeeded. Q1's signed `payment.succeeded` webhook was delivered successfully, and Commerce changed the order to `PAID`.
- A separate checkout was canceled through the hosted-session API. The signed `payment.canceled` webhook was delivered successfully, and Commerce changed the order to `CANCELED`.
- Q1 unit tests passed (17/17); Q1 backend/frontend and Commerce Docker image builds passed; Compose configuration validated.

The runtime checks exercised the API flow, not the hosted checkout page in a browser. Only the simulated test connector was used; no live payment provider or real money was involved.
