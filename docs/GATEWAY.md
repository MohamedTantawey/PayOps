# PayOps Gateway

A payment orchestration service that implements `payops-contract.pdf`: payments, confirm, capture, refunds, vault tokens,
signed webhooks, API keys with test/live modes, idempotency, connector routing with failover and a circuit breaker.
Commerce calls it; Commerce never touches card data or provider keys.

Stack: Node 20, plain `http`, Postgres (`pg`). Its own database. No framework.

## Run
Inside the full project: `docker compose -f docker-compose.yml -f docker-compose.gateway.yml up --build -d` (see `integration/INTEGRATION.md`).
Alone, with no database: `npm install && npm start` (uses embedded PGlite in memory; set `GATEWAY_ALLOW_DEMO_KEYS=true` for the contract's demo keys, local experiments only).
Tests: `npm test` (12 integration tests, embedded Postgres).

## Contract coverage
| Contract item | Status |
|---|---|
| API key auth (Bearer / x-api-key), `x-payops-mode`, error codes (missing_api_key, invalid_api_key_format, invalid_api_key, environment_mode_mismatch, insufficient_permissions) | Done. Keys stored as SHA-256 hashes. Roles: admin, developer, readonly |
| POST /api/payments (+ validation, 201 even if failed, requires_confirmation / requires_payment_method) | Done |
| confirm, capture (manual), refund, list (limit 1-100), retrieve, tokenize | Done |
| Idempotency-Key: scoped by env+merchant+route+key, 24h, replay header, 409 on concurrent use, 5xx not cached | Done (stored in Postgres, not Redis) |
| Priority routing Stripe -> Paymob, failover, skipped_open_circuits | Done with simulated connectors |
| Webhook endpoints, signed `t=...,v1=...` HMAC over `timestamp.rawBody`, deliveries list, replay, test event, 5s timeout | Done |
| payment.succeeded / payment.failed / refund.succeeded | Done |
| auto_invoice (async invoice worker) | Done (invoice row goes pending -> issued) |
| /health, /status, /api-docs | Done (`/api-docs` is a short endpoint list, not Swagger) |

## Deliberate differences and extensions
- Connectors are **simulated** (`mock_stripe`, `mock_paymob`). No real money moves. The connector interface (charge/capture/refund/void) is in `src/connectors.js`; a real Stripe adapter goes there.
- Test cards: 4242424242424242 succeeds; 4000000000000002 declines; 4000000000009995 insufficient funds; 4000000000000341 Stripe down, Paymob succeeds (failover); 4000000000000259 all down; 4000000000000077 refunds fail.
- Hard declines never fail over. Only connector outages do. Three straight outages open a connector's circuit for 30 seconds.
- Partial capture settles the intent as `succeeded` with `captured_amount_cents` (the unused authorization is released). `partially_captured` is never used.
- Refunds can be partial and cumulative (contract says amount optional). Total refunds can never exceed the captured amount, even under concurrent calls.
- Extras: `POST /api/payments/:id/cancel`, `GET /api/webhooks/endpoints`, `return_url` / `cancel_url`, and a hosted card page `GET /pay/:id?cs=<client_secret>` so card numbers go to the gateway, not the store. `client_secret` is returned only when the intent is created.
- Failed webhook deliveries retry automatically (5s, 30s, 2m, 10m, 5 attempts). Replay resets the counter.
- Same Idempotency-Key with a different body returns 422 `idempotency_key_reuse`.
- Live mode: the live key is only seeded if you set `GATEWAY_LIVE_KEY`. With simulated connectors it should stay unset.

## Security notes
PAN and CVV are validated (Luhn, expiry), tokenized, and discarded; only last4, network and expiry are stored. Request bodies are never logged.
Webhook signing secrets are stored in plain text because the HMAC needs them. Webhook targets may be private addresses (needed for Docker). Do not expose the gateway publicly without TLS and rate limiting in front.

## How Commerce uses it (v2.1)
- `services/commerce/src/lib/gateway.ts` is the only code that talks to the gateway. Commerce never sees card numbers or provider keys.
- Checkout (`/api/checkout`, `/api/marketplace/checkout`) creates a payment on the gateway (`confirm:false`, `metadata.order_id`) and sends the customer to the gateway's hosted card page (`http://localhost:3010/pay/...`). The customer returns to `/checkout/success?order=...`, but the order only becomes PAID from the signed webhook (or the worker's reconcile, see below).
- Webhook: gateway -> `web:3000/api/webhooks/payops` -> Commerce `/api/webhooks/payops`. Signature (`X-PayOps-Signature`) is verified on the raw body with a 5-minute window; events are stored, deduplicated by delivery id and retried like the Stripe ones. Amount and currency must match the order.
- Refunds (`/api/refunds`, finance role) call `POST /api/payments/:id/refund` with the refund id as Idempotency-Key.
- Worker: abandoned checkouts are cancelled at the gateway (cancel is refused if the customer paid at that moment) before stock is released. A payment that succeeded but whose webhook was missed is settled instead of released.
- Provider selection: gateway when `GATEWAY_URL` + `GATEWAY_API_KEY` are set, else Stripe (if keys set), else demo mode. Orders keep working with the provider that created them (gateway ids are UUIDs, Stripe ids start with `pi_`/`cs_`).
- `setup-local.ps1` / `setup-local.mjs` generate `GATEWAY_DB_PASSWORD`, `GATEWAY_TEST_KEY`, `GATEWAY_WEBHOOK_SECRET`. The gateway registers the webhook endpoint itself at startup with that secret.
- Test cards at the hosted page: see the table above. Gateway API (for staff/testing): `http://localhost:3010/api-docs`, auth with `GATEWAY_TEST_KEY` from `.env`.
