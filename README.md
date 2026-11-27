# PayOps Platform

> **High-Performance Multi-PSP Payment & Billing Orchestration Platform**

PayOps is an enterprise-grade, build-ready payment routing, vaulting, and billing orchestration platform designed inspired by modern architectures like Hyperswitch. It provides intelligent smart routing across multiple payment service providers (PSPs), secure PCI-compliant vaulting boundaries, distributed state machines, asynchronous background worker jobs via BullMQ, and a comprehensive React Control Center.

---

## 🏗️ Architecture & Core Layers

PayOps is organized as a modular monorepo containing the following core layers:

1. **API Gateway & Request Validation**: Express 5 application with comprehensive error handling, request tracing (`X-Request-ID`), environment mode switching (`test`/`live`), and Swagger documentation.
2. **Payment State Machine & Routing Engine**: Advanced intent state machine with rule-based priority routing, volume-splitting, constraint filtering (currency, payment method, 3DS requirement), dynamic circuit breakers (Redis sliding-window counters), and automated GSM failover cascades.
3. **Vault Boundary & Connector Adapters**: Secure tokenization boundary isolating sensitive cardholder data from core business logic, paired with robust connector adapters (Stripe, Paymob, and mock PSP integrations).
4. **Database & Storage**: PostgreSQL 15 schema supporting multi-tenant merchants, intents, attempts, routing configs, RBAC, vault tokens, webhook deliveries, and analytics events.
5. **Async Workers & Background Jobs**: Dedicated worker service powered by BullMQ and Redis for robust asynchronous processing (invoice generation, webhook delivery and retries, batch payroll execution, and analytics stream ingestion).
6. **Signed Webhooks & Delivery Log**: HMAC-SHA256 signed webhook dispatch engine with automatic exponential backoff retry policies and full audit logging.
7. **React Control Center Frontend**: Modern management dashboard for monitoring live transactions, configuring PSP routing rules, inspecting logs, managing users/RBAC, and viewing analytics.
8. **Observability & Telemetry**: Built-in health checks (`/health`, `/status`), Prometheus metrics endpoints, and structured logging.

---

## 📂 Monorepo Structure

```text
payopsv3/
├── backend/                    # Express REST API, Payment State Machine, Routing Engine, Vault
│   ├── src/
│   │   ├── server.js           # Express server entry point
│   │   ├── routes/             # API route handlers (payments, billing, invoices, webhooks, health)
│   │   ├── services/           # Business logic (routing, vault, state machine, connectors)
│   │   ├── middleware/         # Auth, validation, error handling, tracing
│   │   ├── shared/             # Database pool, migrations, seed scripts
│   │   └── utils/              # Helpers, constants, encryption
│   ├── Dockerfile
│   └── package.json
├── frontend/                   # React 18 / Vite Control Center Dashboard
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   ├── pages/              # Page-level views (Dashboard, Transactions, Routing, Users)
│   │   ├── services/           # API clients, WebSocket connections
│   │   └── hooks/              # Custom React hooks
│   ├── Dockerfile
│   ├── vite.config.js
│   └── package.json
├── worker/                     # BullMQ Async Workers (Webhooks, Invoices, Payroll)
│   ├── src/
│   │   ├── worker.js           # Worker entry point & queue setup
│   │   ├── processors/         # Job processors for each queue
│   │   └── services/           # Shared services (email, PDF, webhook dispatch)
│   ├── Dockerfile
│   └── package.json
├── mock-psp/                   # Standalone Mock Payment Service Provider
│   ├── src/
│   │   ├── server.js           # Express server for Mock Stripe & Mock Paymob
│   │   └── routes/             # PSP endpoint simulators
│   ├── Dockerfile
│   └── package.json
├── migrations/                 # Database migration scripts & SQL schema definitions
├── storage/                    # Local storage volumes for generated invoices & payloads
├── .env.example                # Environment variable template
├── .env                        # Local environment (gitignored - copy from .env.example)
├── docker-compose.yml          # Multi-container orchestration
├── Jenkinsfile                 # CI/CD pipeline definition
└── PAYOPS_ARCHITECTURE.md      # Detailed technical specification and architectural diagrams
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v20+ (LTS recommended)
- **Yarn** (Classic v1.x or Berry v3+) — monorepo uses workspaces
- **Docker** & **Docker Compose** v2+ (for containerized setup)
- **PostgreSQL** 15+ (if running locally without Docker)
- **Redis** 7+ (if running locally without Docker)

---

## ⚙️ Environment Configuration

### 1. Create Local Environment File

```bash
cp .env.example .env
```

### 2. Configure Required Variables in `.env`

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Backend API port | `3100` | Yes |
| `DB_HOST` | PostgreSQL host | `localhost` | Yes |
| `DB_PORT` | PostgreSQL port | `5433` | Yes |
| `DB_NAME` | Database name | `payops` | Yes |
| `DB_USER` | Database user | `payops_admin` | Yes |
| `DB_PASSWORD` | Database password | — | **Yes** |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` | Yes |
| `VAULT_ENCRYPTION_KEY` | 32-byte (64 hex chars) AES-256-GCM key | — | **Yes** |
| `WEBHOOK_SIGNING_SECRET` | HMAC-SHA256 signing secret (32+ chars) | — | **Yes** |
| `APP_DEFAULT_MODE` | `test` or `live` | `test` | No |
| `S3_BUCKET_NAME` | S3 bucket for invoices (optional) | — | No |
| `LOCAL_STORAGE_PATH` | Local invoice storage path | `./storage/invoices` | No |

**Generate Secure Secrets:**
```bash
# Generate VAULT_ENCRYPTION_KEY (64 hex chars = 32 bytes)
openssl rand -hex 32

# Generate WEBHOOK_SIGNING_SECRET
openssl rand -base64 32
```

---

## 🐳 Option 1: Run with Docker Compose (Recommended)

This is the easiest way to run the full stack with all dependencies.

### Prerequisites
- Docker Desktop / Docker Engine + Compose plugin installed
- At least 4GB RAM allocated to Docker

### Quick Start

```bash
# Build all images and start all services
docker compose up --build -d

# View logs
docker compose logs -f

# Check service health
docker compose ps
```

### Services Started

| Service | Port | Description |
|---------|------|-------------|
| **PostgreSQL** | `5433` | Primary database |
| **Redis** | `6379` | Cache, locks, queues, streams |
| **Mock PSP** | `4001` / `4002` | Mock Stripe & Paymob endpoints |
| **Migrations** | — | Runs DB migrations (one-off) |
| **Seed** | — | Seeds initial data (one-off, after migrations) |
| **Backend API** | `3002` | Main REST API (`http://localhost:3002`) |
| **Async Worker** | `3004` | Background job processor |
| **Frontend** | `8080` | React Control Center (`http://localhost:8080`) |

### Access Points

- **Frontend Dashboard**: http://localhost:8080
- **Backend API**: http://localhost:3002
- **API Health Check**: http://localhost:3002/status
- **API Swagger Docs**: http://localhost:3002/api-docs
- **Mock Stripe**: http://localhost:4001
- **Mock Paymob**: http://localhost:4002
- **Worker Health**: http://localhost:3004/status

### Common Docker Commands

```bash
# Stop all services (preserves volumes)
docker compose down

# Stop and remove volumes (clean slate)
docker compose down -v

# Rebuild a specific service
docker compose build backend
docker compose up -d backend

# View logs for specific service
docker compose logs -f backend
docker compose logs -f worker
docker compose logs -f frontend

# Run migrations manually
docker compose run --rm migrate

# Seed database manually
docker compose run --rm seed

# Execute commands in running containers
docker compose exec backend sh
docker compose exec postgres psql -U payops_admin -d payops
docker compose exec redis redis-cli
```

---

## 💻 Option 2: Local Development (Manual)

For active development with hot-reload and debugging.

### 1. Install Dependencies

```bash
# From repository root
yarn install
```

This installs dependencies for all workspaces: `backend`, `frontend`, `worker`, `mock-psp`.

### 2. Start Infrastructure Services

You need PostgreSQL and Redis running locally:

```bash
# Using Docker for just the infrastructure
docker compose up -d postgres redis

# Or start your local PostgreSQL/Redis instances manually
```

### 3. Run Database Migrations & Seeding

```bash
# Run migrations (creates tables, indexes, constraints)
yarn migrate

# Seed initial data (merchants, routing configs, test API keys)
yarn seed
```

### 4. Start Services in Separate Terminals

**Terminal 1 — Mock PSP (required for payment processing):**
```bash
yarn start:mock-psp
# Runs on http://localhost:4001 (Stripe) and http://localhost:4002 (Paymob)
```

**Terminal 2 — Backend API:**
```bash
yarn dev:backend
# Runs on http://localhost:3100 with nodemon hot-reload
```

**Terminal 3 — Async Worker:**
```bash
yarn dev:worker
# Runs on http://localhost:3004, processes BullMQ queues
```

**Terminal 4 — Frontend Control Center:**
```bash
yarn start:frontend
# Runs Vite dev server on http://localhost:8080 with HMR
```

---

## 🔧 Development Workflow

### Running Tests

```bash
# Unit tests (backend + worker)
yarn test:unit

# Integration tests (requires running services)
yarn test:integration

# Run specific test file
node --test backend/test/unit/routing.test.js
```

### Making Code Changes

1. **Backend/Worker/Mock-PSP**: Changes auto-reload via `nodemon` in dev mode
2. **Frontend**: Vite HMR updates instantly in browser
3. **Database Schema**: Modify migration files in `migrations/`, then run `yarn migrate`

### Adding Dependencies

```bash
# Add to specific workspace
yarn workspace @payops/backend add <package>
yarn workspace @payops/worker add <package>
yarn workspace @payops/frontend add <package>
yarn workspace @payops/mock-psp add <package>

# Add dev dependency
yarn workspace @payops/backend add -D <package>
```

---

## 🧪 Testing the Payment Flow

### 1. Create a Payment Intent (Test Mode)

```bash
curl -X POST http://localhost:3100/api/payments \
  -H "Content-Type: application/json" \
  -H "X-PayOps-Mode: test" \
  -H "Authorization: Bearer sk_test_merchant1_key" \
  -d '{
    "amount": 1000,
    "currency": "USD",
    "payment_method": "card",
    "card_token": "tok_visa",
    "customer": { "email": "customer@example.com" },
    "metadata": { "order_id": "ord_123" }
  }'
```

### 2. Check Payment Status

```bash
curl http://localhost:3100/api/payments/pi_<intent_id> \
  -H "X-PayOps-Mode: test" \
  -H "Authorization: Bearer sk_test_merchant1_key"
```

### 3. View in Control Center

Open http://localhost:8080 and navigate to **Transactions** to see the payment flow, routing decisions, and attempt history.

---

## 📊 Key API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/payments` | POST | Create payment intent |
| `/api/payments/:id` | GET | Get payment intent details |
| `/api/payments/:id/confirm` | POST | Confirm payment (3DS, etc.) |
| `/api/payments/:id/capture` | POST | Capture authorized payment |
| `/api/payments/:id/refund` | POST | Refund payment |
| `/api/billing/schedules` | POST | Create billing schedule |
| `/api/invoices` | GET/POST | List/create invoices |
| `/api/webhooks/endpoints` | GET/POST | Manage webhook endpoints |
| `/api/webhooks/deliveries` | GET | View delivery logs |
| `/status` | GET | Service health check |
| `/metrics` | GET | Prometheus metrics |
| `/api-docs` | GET | Swagger UI documentation |

---

## 🏷️ Environment Modes

PayOps supports two modes via `X-PayOps-Mode` header or `APP_DEFAULT_MODE`:

| Mode | Description | Use Case |
|------|-------------|----------|
| `test` | Routes to Mock PSP, uses test API keys (`sk_test_*`) | Development, CI, integration testing |
| `live` | Routes to real PSPs, uses live API keys (`sk_live_*`) | Production |

**Test API Keys (seeded):**
- Merchant 1: `sk_test_merchant1_key`
- Merchant 2: `sk_test_merchant2_key`

---

## 🔐 Security Notes

- **Never commit `.env`** — it's gitignored
- **Rotate secrets** before any production deployment
- **Use secrets manager** (AWS Secrets Manager, HashiCorp Vault, Doppler) in production
- **VAULT_ENCRYPTION_KEY** must be 32 bytes (64 hex chars) — used for AES-256-GCM card encryption
- **WEBHOOK_SIGNING_SECRET** — used for HMAC-SHA256 webhook signatures, verify on receiver side

---

## 📦 Building for Production

### Docker Images

```bash
# Build all production images
docker compose -f docker-compose.yml build

# Tag and push to registry
docker tag payops-backend:latest your-registry/payops-backend:v1.0.0
docker push your-registry/payops-backend:v1.0.0
```

### Frontend Production Build

```bash
cd frontend
yarn build
# Output in frontend/dist/ — serve with nginx or any static host
```

---

## 🛠️ Troubleshooting

### Port Conflicts

```bash
# Check what's using a port
lsof -i :3100
lsof -i :5433
lsof -i :6379

# Change ports in .env and docker-compose.yml if needed
```

### Database Connection Issues

```bash
# Verify PostgreSQL is running
docker compose exec postgres pg_isready -U payops_admin -d payops

# Check logs
docker compose logs postgres

# Reset database completely
docker compose down -v
docker compose up -d postgres
yarn migrate && yarn seed
```

### Redis Connection Issues

```bash
# Test Redis connection
docker compose exec redis redis-cli ping

# Check Redis logs
docker compose logs redis
```

### Migration Failures

```bash
# Check migration logs
docker compose logs migrate

# Run migration manually for debugging
docker compose run --rm migrate node backend/src/shared/migrate.js
```

### Frontend Build Issues

```bash
cd frontend
rm -rf node_modules dist
yarn install
yarn build
```

---

## 📚 Additional Documentation

- **Architecture Deep Dive**: [`PAYOPS_ARCHITECTURE.md`](./PAYOPS_ARCHITECTURE.md) — Comprehensive technical specification with Mermaid diagrams, database schemas, API contracts, and routing engine details
- **API Contract**: [`payops-contract.md`](./payops-contract.md) — Detailed API request/response specifications
- **Jenkins CI/CD**: [`Jenkinsfile`](./Jenkinsfile) — Pipeline configuration

---

## 📄 License

Licensed under the [Apache-2.0 License](LICENSE).

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes with tests
4. Run `yarn test:unit` and `yarn test:integration`
5. Submit a Pull Request

---

## 🆘 Support

- Check existing issues in the repository
- Review `PAYOPS_ARCHITECTURE.md` for implementation details
- Check service logs: `docker compose logs -f <service-name>`