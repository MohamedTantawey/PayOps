# PayOps v2.1 | Microservices edition with payment gateway

A learning/starter commerce project with the v1.6 storefront preserved and backend data split into independently deployable services. Demo payments are enabled by default. This is not a production-ready financial platform.

## What changed

| Component | Owns | Storage | Deployment |
|---|---|---|---|
| Web / BFF | Next.js storefront, staff UI, same-origin API gateway, cookie transport, UI read composition | None. No Prisma client or database URL. | `services/web` |
| Commerce | Products, stock/reservations, orders/items, coupons, payments, refunds, append-only ledger, idempotency, Stripe webhook inbox, staff audit, cart-cleanup outbox | Private `commerce-db` Postgres instance and `commerce_data_v2` volume | `services/commerce` |
| Identity | Customers, password hashes, sessions, auth-attempt throttling, saved cart, event inbox | Private `identity-db` Postgres instance and `identity_data_v2` volume | `services/identity` |
| Worker | One-minute maintenance tick, calls Commerce's authenticated internal endpoint | None | Commerce image, separate process |

Each service has its own package/lockfile, Dockerfile and build. Commerce and Identity never read each other's tables. IDs crossing boundaries are opaque references, not cross-database foreign keys. Commerce's financial modules intentionally stay together so one local transaction can reserve stock, create the order and write balanced ledger entries. This is a coarse-grained microservices split, not five separate orders/payments/inventory services. Do not claim otherwise.

## Important: v1.6 upgrade

**Use a NEW folder, for example `payops-commerce-v2`. Do not copy only `src` and do not overwrite the old folder.**

- v2 creates new database volumes. It does **not** migrate old customers, orders, carts or ledger records.
- The old folder, `.env` and old database volume are not changed. Keep them for rollback.
- Do not copy the v1 `.env` into v2. The setup script generates new local credentials for the split.
- Stop the old stack from its original folder with `docker compose down` before starting v2, since both use localhost:3000/3001/9090. Never add `-v` unless you intend to erase that stack's volumes.
- v2 seeds the six products only; create a new customer account. Product stock is not reset on ordinary restarts.
- If old data matters, stop here and plan a reviewed export/import migration. None is included in this release.

## Windows quick start

Requires Docker Desktop running with Linux containers and Docker Compose v2. Allow the initial image downloads/builds to finish. Node is optional for this Docker path.

```powershell
# Run from the NEW extracted v2 folder
powershell -ExecutionPolicy Bypass -File .\setup-local.ps1
docker compose config --quiet
docker compose up --build -d --wait
docker compose ps
```

- Store: http://localhost:3000
- Customer account: http://localhost:3000/account
- Staff login: http://localhost:3000/login
- Grafana: http://localhost:3001, username `admin`, password from your generated `.env`
- Prometheus: http://localhost:9090

For staff login, open your local `.env` privately and use the `local-admin` token from `ADMIN_TOKENS`. Setup does not print secrets. Do not send `.env` to anyone or commit it.

On macOS/Linux or Windows with Node 20+, `node setup-local.mjs` is an alternative secret generator. It refuses to overwrite an existing `.env`.

Only Web and the monitoring UIs bind host ports, all on loopback. Neither database nor either backend API publishes a host port. Inter-service calls use Docker DNS names; private data networks separate the database containers. Compose starts schema setup in each owning service, not in Web.

## Common commands

```powershell
docker compose logs -f web commerce identity worker
docker compose restart identity
docker compose up --build -d --no-deps web
docker compose up --build -d --no-deps commerce
docker compose up --build -d --no-deps identity
docker compose down
```

Independent rebuilds are possible, but schema/API compatibility is your responsibility. There is no zero-downtime deployment controller, service mesh or automated rollback. Startup schema synchronization is for this local starter only. See [operations](docs/OPERATIONS.md) before touching real data.

## Checks

```powershell
# No host Node installation is required for this smoke test:
docker compose exec -T commerce sh -c 'TEST_APP_URL=http://web:3000 TEST_COMMERCE_URL=http://localhost:3000 node scripts/compose-smoke.mjs'
```

That command creates isolated QA customer/order fixtures in your local demo database and consumes some seeded stock. Never run it against live money or real customer data. CI includes the Compose build/run/smoke workflow; it has been authored but has not been observed running on GitHub in this release.

Production builds and runtime integration tests were performed locally with separate running service processes and PostgreSQL 14.24. Compose targets PostgreSQL 16; Compose config was validated, but Docker Engine is unavailable in the verification environment, so the actual container image build/start and the complete monitoring stack remain unverified. See [VERIFICATION.md](VERIFICATION.md) for exact results and limits.

## Read next

- [Architecture and flows](docs/ARCHITECTURE.md)
- [API and service contracts](docs/API.md)
- [Operations, deployment and failure recovery](docs/OPERATIONS.md)
- [Verification](VERIFICATION.md)
- `docs/history/`: archived v1 documents. They are historical, not v2 setup instructions. The old Kubernetes/Helm/Terraform templates were removed because they deployed the monolith and would be misleading here. No v2 Kubernetes deployment is supplied.

## v2.1: payment gateway
Payments now go through a separate **gateway** service (`services/gateway`) that implements `payops-contract.pdf`: API keys, payments, refunds, idempotency, signed webhooks, Stripe -> Paymob failover. Commerce calls the gateway; the customer pays on the gateway's hosted card page (`http://localhost:3010`). Connectors are simulated: test cards only, no real money. See `docs/GATEWAY.md`. Use a fresh folder and run setup-local again (new variables in `.env`).
