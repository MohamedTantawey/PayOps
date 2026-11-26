# Operations | v2.0

## Startup and secrets

Run setup only inside a clean extracted v2 folder. It creates separate database passwords and two server-only service tokens, staff token(s), session secret, maintenance token and Grafana password. Keep `.env` private. None of these values is built into browser bundles. Set HTTPS, a real public `NEXT_PUBLIC_APP_URL` and `COOKIE_SECURE=true` before exposing anything. The local Compose binds ports to loopback and is not a production deployment.

Web requires `COMMERCE_URL`, `COMMERCE_SERVICE_TOKEN`, `IDENTITY_URL`, `IDENTITY_SERVICE_TOKEN`, `ADMIN_TOKENS`, `SESSION_SECRET`, `NEXT_PUBLIC_APP_URL`, `COOKIE_SECURE`.

Commerce requires its own `DATABASE_URL`, `COMMERCE_SERVICE_TOKEN`, `IDENTITY_URL`, `IDENTITY_SERVICE_TOKEN`, staff/session/origin configuration, `MAINTENANCE_TOKEN`, and optional Stripe/OTLP settings. It never receives Identity's database credentials.

Identity requires its own `DATABASE_URL`, `IDENTITY_SERVICE_TOKEN` and optional `PORT` (default 3200). It never receives Commerce's database credentials.

Worker requires only `WORKER_APP_URL`, `MAINTENANCE_TOKEN`, `COMMERCE_SERVICE_TOKEN`. It has no database connection.

The Compose file is the exact source for environment wiring. Each service can be built and deployed independently from its directory. Start backend dependencies before accepting traffic; apply backward-compatible schema/API changes before switching callers. Schema `db push` at startup is acceptable only for this learning setup. Replace it with reviewed versioned migration jobs, backups and controlled rollouts before running multiple production replicas.

## Health and diagnosis

```powershell
docker compose ps
docker compose logs --tail=100 web commerce identity worker
docker compose exec -T commerce node -e "fetch('http://localhost:3000/health').then(r=>r.json()).then(console.log)"
docker compose exec -T identity node -e "fetch('http://localhost:3200/health').then(r=>r.json()).then(console.log)"
```

- Web `/health` means Web is alive only. It does not prove checkout or login works.
- Commerce/Identity `/health` includes only that service's own DB check, not downstream APIs or Stripe.
- Compose waits for healthy backend startup before starting Web, but health failure after startup does not automatically restart dependencies.
- Web retains a static catalog fallback. Seeing products does not prove checkout is ready.
- Identity down: account/session/cart/order-history checks can return 503; catalog still works. Existing financial state remains in Commerce. Pending cart outbox delivery retries after recovery.
- Commerce down: fallback catalog can render but buying, orders, quotes and staff operations fail. Never treat this as a successful payment.
- Worker down: webhook retries, reservation cleanup and outbox delivery stop on a clock. Restart worker and inspect queues before declaring recovery.

## Outbox inspection

```powershell
docker compose exec -T commerce-db psql -U commerce -d commerce -c 'SELECT id, attempts, "lastError", "createdAt" FROM "Outbox" WHERE "deliveredAt" IS NULL ORDER BY "createdAt";'
```

Inspect the Identity error and repair the cause, then let worker retry the SAME event ID. Do not invent a new ID to force delivery; it bypasses deduplication. Never delete pending rows casually. Retention, poison-message routing, backoff and queue alerts are not implemented. A backlog needs manual attention.

## Stripe testing

Leave placeholder keys for demo mode. To test Stripe, set your own TEST secret/webhook keys in `.env`, rebuild/restart the service as needed, and forward the Stripe CLI to `localhost:3000/api/webhooks/stripe`. Raw body and signature cross the BFF unchanged. The public URL and cookie origin must match the browser entry point. Real provider API calls were not performed during this release's verification. Never use live keys for the supplied smoke tests.

## Backup and rollback

Back up BOTH databases and retain credentials securely. They represent different consistency domains; a backup pair is not an atomic distributed snapshot. Quiesce writes/worker and record an operational checkpoint for a consistent recovery plan. Test restoration before relying on it. No automatic backup or data migration script is supplied.

v1 rollback: stop v2 with `docker compose down` from the v2 folder, then start v1 from its untouched folder. Do not use `down -v`, and do not point v1 at the v2 databases. Orders created in v2 will not appear in v1; there is no reverse data migration.

## Production gaps

This remains a local learning starter. Needed before real use: proper auth/MFA/email verification/reset, TLS and network policies, secrets manager and rotation, strict request limits/rate limits, input/security review, reviewed versioned migrations, backups/restore exercises, alerts/SLOs, outbox dead-letter/backoff/retention, customer-data retention, privacy compliance, cart versioning, service failure budgets and contract versioning. The serial financial lock is not a high-throughput design. Stripe fees, disputes, taxes, payouts and bank settlement import are not implemented. The ledger dashboard is not a bank reconciliation system.

Monitoring supplied: process metrics on Web/Commerce and operation metrics/spans in Commerce, Prometheus scrape config, Grafana starter dashboard, Tempo. Identity has DB health checks but no Prometheus/OpenTelemetry instrumentation in this release. The full monitoring stack and Kubernetes deployment were not runtime-tested. Old monolith cluster templates are not shipped as v2 support.
