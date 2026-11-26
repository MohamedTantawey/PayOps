# PayOps API Contract

This document is the repository implementation contract for the PayOps HTTP API.
It describes the behavior in `backend/src/routes`, `backend/src/middleware`,
`backend/src/core`, and `worker/src/handlers/webhookHandler.js`.

## Base URL

- Docker local API: `http://localhost:3002` (override with `PAYOPS_BACKEND_HOST_PORT`)
- API documentation: `http://localhost:3002/api-docs` or `http://localhost:8080/api-docs`
- Health: `GET /health`
- Status telemetry: `GET /status`

All protected endpoints use the API-key authentication middleware. The API key
also determines the merchant and `test`/`live` environment.

## Authentication

PayOps uses a **secret API key**, not JWT authentication.

Send the key in either of these headers:

```http
Authorization: Bearer sk_test_demo_000000000000000000000000
```

```http
x-api-key: sk_test_demo_000000000000000000000000
```

Seed keys:

```text
Test: sk_test_demo_000000000000000000000000
Live: sk_live_demo_000000000000000000000000
```

Optional environment header:

```http
x-payops-mode: test
```

`x-payops-mode` must match the key prefix. `test` keys belong to
`merch_test_default`; `live` keys belong to `merch_live_default`.

RBAC is checked after authentication. The seed test and live keys have the
`admin` role.

Authentication errors use:

```json
{
  "error": {
    "code": "missing_api_key",
    "message": "Provide a valid PayOps API key..."
  }
}
```

Relevant authentication status codes:

| HTTP | `error.code` | Meaning |
|---:|---|---|
| 401 | `missing_api_key` | Neither authentication header was provided |
| 401 | `invalid_api_key_format` | Key does not start with `sk_test_` or `sk_live_` |
| 401 | `invalid_api_key` | Unknown, inactive, or invalid key |
| 403 | `environment_mode_mismatch` | API key mode differs from `x-payops-mode` |
| 403 | `insufficient_permissions` | Valid key lacks the RBAC permission |

## Common Headers

Protected JSON requests should include:

```http
Content-Type: application/json
Authorization: Bearer sk_test_demo_000000000000000000000000
x-payops-mode: test
```

`Idempotency-Key` is supported on payment creation, confirmation, capture,
refund, and other mutating routes that use `idempotencyMiddleware()`:

```http
Idempotency-Key: idem_demo_001
```

The Redis replay key is scoped by environment, merchant, route, and
idempotency key. A replay includes:

```http
X-PayOps-Idempotent-Replay: true
```

Concurrent reuse of the same key returns HTTP 409:

```json
{
  "error": {
    "code": "idempotency_conflict",
    "message": "Another request with the same Idempotency-Key is currently in progress."
  }
}
```

Successful idempotent responses are cached for 24 hours. Responses with HTTP
5xx are not cached.

## Create a Payment

```http
POST /api/payments
Authorization: Bearer <sk_test_...|sk_live_...>
x-payops-mode: test
Content-Type: application/json
Idempotency-Key: <optional-unique-key>
```

### Request Body

```json
{
  "amount_cents": 12500,
  "currency": "USD",
  "capture_method": "automatic",
  "confirm": true,
  "customer_email": "buyer@acme.io",
  "description": "Enterprise SaaS Seat License",
  "metadata": {
    "order_id": "order_123"
  },
  "return_url": "http://localhost:3000/checkout/success?order=order_123",
  "cancel_url": "http://localhost:3000/checkout/cancel",
  "card": null,
  "vault_token": "vault_tok_test_4242424242424242",
  "auto_invoice": true
}
```

Field rules:

| Field | Type | Default | Contract |
|---|---|---|---|
| `amount_cents` | integer | required | Strict positive integer |
| `currency` | string | `"USD"` | Stored uppercase |
| `capture_method` | string | `"automatic"` | `"automatic"` or `"manual"` |
| `confirm` | boolean | `true` | If false, route execution is not started |
| `customer_email` | string/null | `null` | Optional |
| `description` | string/null | `null` | Optional |
| `metadata` | object | `{}` | Stored as JSONB |
| `return_url` | string | `null` | Optional hosted-checkout return URL; must be used with `cancel_url` and have an origin in `CHECKOUT_ALLOWED_ORIGINS` |
| `cancel_url` | string | `null` | Optional hosted-checkout cancel URL; must be used with `return_url` and have an origin in `CHECKOUT_ALLOWED_ORIGINS` |
| `card` | object/null | `null` | Raw card data; it is tokenized but not stored as plaintext |
| `vault_token` | string/null | `null` | Existing Vault token |
| `auto_invoice` | boolean | `true` | Generate an invoice after a successful charge |

A `card` object has this repository shape:

```json
{
  "number": "4242424242424242",
  "cvv": "424",
  "exp_month": "12",
  "exp_year": "2029"
}
```

To confirm and route immediately, provide either `card` or `vault_token`.
Prefer `vault_token` so raw PAN/CVV does not be sent again.

### Successful Response: `201 Created`

When `confirm: true` and a payment method is present:

```json
{
  "intent": {
    "id": "uuid",
    "merchant_id": "merch_test_default",
    "env_mode": "test",
    "amount_cents": 12500,
    "currency": "USD",
    "capture_method": "automatic",
    "status": "succeeded",
    "active_attempt_id": "uuid",
    "attempt_count": 1,
    "customer_email": "buyer@acme.io",
    "description": "Enterprise SaaS Seat License",
    "metadata": {},
    "created_at": "2026-11-22T19:32:27.222Z",
    "updated_at": "2026-11-22T19:32:27.222Z"
  },
  "active_attempt": {
    "id": "uuid",
    "intent_id": "uuid",
    "env_mode": "test",
    "merchant_id": "merch_test_default",
    "connector": "mock_stripe",
    "attempt_index": 1,
    "status": "charged",
    "amount_cents": 12500,
    "currency": "USD",
    "connector_transaction_id": "mock_stripe_ch_...",
    "error_code": null,
    "error_message": null,
    "vault_token": "vault_tok_test_...",
    "metadata": {},
    "created_at": "2026-11-22T19:32:27.222Z",
    "updated_at": "2026-11-22T19:32:27.222Z"
  },
  "attempts": [],
  "routing_summary": {
    "algorithm": "Priority: Stripe -> Paymob",
    "type": "priority",
    "evaluated_connectors": ["mock_stripe", "mock_paymo"],
    "skipped_open_circuits": [],
    "failover_triggered": false
  },
  "invoice": null
}
```

`invoice` is an invoice row when `auto_invoice: true` and the intent succeeds.
The invoice worker completes it asynchronously.

When `confirm: false`, or no card/vault token is supplied:

```json
{
  "intent": {
    "status": "requires_confirmation"
  },
  "attempts": []
}
```

When both redirect URLs are provided, the response also contains
`intent.pay_path` and `intent.checkout_expires_at`. `pay_path` is a relative
URL for the hosted checkout on the PayOps frontend. It includes a 256-bit
session secret in the URL fragment; the secret hash, not the secret, is stored
in PostgreSQL. Hosted sessions expire after 30 minutes. Redirect origins must
be explicitly configured, for example:

```text
CHECKOUT_ALLOWED_ORIGINS=http://localhost:3000,https://store.example
```

### Hosted Checkout

The customer opens the returned PayOps `pay_path`. The hosted page collects
card details on the PayOps origin and posts them to the API; the storefront
never receives card data or the API key. The checkout secret is sent in the
`X-Checkout-Secret` header and is required on both public session requests:

```http
GET /api/payments/checkout/:id
X-Checkout-Secret: <secret-from-pay_path-fragment>
```

```http
POST /api/payments/checkout/:id/confirm
X-Checkout-Secret: <secret-from-pay_path-fragment>
Content-Type: application/json

{"card":{"number":"4242424242424242","cvv":"424","exp_month":"12","exp_year":"2029"}}
```

These two hosted-session routes do not accept merchant API keys. Possession of
the unguessable session secret authorizes access to that one intent only.
Confirmation runs the normal vault/routing pipeline, emits signed
`payment.succeeded` or `payment.failed` webhooks, and returns a redirect URL
only after success. The session endpoint returns only the amount, currency,
description, email, status, expiration and the configured redirect URLs.

The authenticated cancellation endpoint used by the storefront's reservation
expiry worker is:

```http
POST /api/payments/:id/cancel
Authorization: Bearer <key>
```

It cancels unpaid/failed intents and refuses cancellation while processing,
authorized-for-capture, or succeeded.

The hosted page uses the one-time checkout secret for the corresponding public
cancel route:

```http
POST /api/payments/checkout/:id/cancel
X-Checkout-Secret: <secret-from-pay_path-fragment>
```

Successful cancellation emits a signed `payment.canceled` event with the
intent metadata, allowing the storefront to release its inventory reservation.

The status is `requires_payment_method` only when neither a card nor vault token
is provided for the initial unconfirmed intent.

The create endpoint always returns HTTP 201 for a created intent, even if
connector processing ends in an intent status of `failed`.

### Creation Error Responses

| HTTP | `error.code` | Trigger |
|---:|---|---|
| 400 | `invalid_amount` | `amount_cents` is missing, non-numeric, fractional, or <= 0 |
| 400 | `missing_payment_method` | Execution is requested without `card` or `vault_token` |
| 400 | `unsupported_connector` | Routing references an unknown connector |
| 409 | `payment_intent_locked` | Another execution is active for the intent |
| 409 | `idempotency_conflict` | Concurrent duplicate Idempotency-Key |

## Domain Status Values

### PaymentIntent status

| Status | Meaning |
|---|---|
| `requires_payment_method` | No payment method was supplied |
| `requires_confirmation` | Intent can be confirmed later |
| `processing` | Routing/connector execution is active |
| `requires_capture` | Manual capture authorization succeeded |
| `succeeded` | Automatic capture or manual capture completed |
| `partially_captured` | Valid intermediate/manual state |
| `failed` | Connector attempts did not succeed |
| `canceled` | Intent canceled |

### PaymentAttempt status

| Status | Meaning |
|---|---|
| `started` | Attempt inserted |
| `pending` | Attempt pending |
| `authorized` | Manual-capture authorization succeeded |
| `charged` | Automatic-charge/authorization succeeded |
| `failure` | Connector attempt failed |
| `voided` | Authorization voided |

### Refund status

| Status | Meaning |
|---|---|
| `succeeded` | Connector refund accepted |
| `failed` | Connector refund rejected |

## Confirm a Payment

```http
POST /api/payments/:id/confirm
Authorization: Bearer <key>
Content-Type: application/json
Idempotency-Key: <optional>
```

Body:

```json
{
  "card": null,
  "vault_token": "vault_tok_test_4242424242424242"
}
```

Success: HTTP 200 with the same `execution` shape:

```json
{
  "intent": {},
  "active_attempt": {},
  "attempts": [],
  "routing_summary": {}
}
```

HTTP 404 `not_found` if the intent is absent outside the key's merchant/mode
scope. HTTP 400 `missing_payment_method` if neither payment method is present.

## Capture a Manual Payment

```http
POST /api/payments/:id/capture
Authorization: Bearer <key>
Content-Type: application/json
Idempotency-Key: <optional>
```

Optional body:

```json
{
  "amount_cents": 12500
}
```

Default capture amount is the PaymentIntent amount. Success: HTTP 200:

```json
{
  "intent": {},
  "active_attempt": {}
}
```

Relevant errors:

| HTTP | `error.code` | Trigger |
|---:|---|---|
| 404 | `not_found` | Intent is absent in scope |
| 409 | `invalid_capture_state` | Intent is not `requires_capture` |
| 502 | Connector-provided code | Capture call failed |

## Refund a Payment

```http
POST /api/payments/:id/refund
Authorization: Bearer <key>
Content-Type: application/json
Idempotency-Key: <optional>
```

Body:

```json
{
  "amount_cents": 12500,
  "reason": "requested_by_customer"
}
```

`amount_cents` is optional and defaults to the full intent amount.
`reason` defaults to `requested_by_customer`.

Success: HTTP 201:

```json
{
  "refund": {
    "id": "uuid",
    "intent_id": "uuid",
    "attempt_id": "uuid",
    "env_mode": "test",
    "merchant_id": "merch_test_default",
    "connector": "mock_stripe",
    "connector_transaction_id": "mock_stripe_ch_...",
    "connector_refund_id": "mock_stripe_re_...",
    "amount_cents": 12500,
    "currency": "USD",
    "refund_status": "succeeded",
    "reason": "requested_by_customer",
    "created_at": "2026-11-22T19:32:27.222Z"
  }
}
```

A connector failure returns HTTP 502 with:

```json
{
  "refund": {
    "refund_status": "failed"
  }
}
```

Other relevant errors:

| HTTP | `error.code` | Trigger |
|---:|---|---|
| 404 | `not_found` | Intent is absent in scope |
| 409 | `invalid_refund_state` | Intent is not `succeeded` |

## Read Payments

### List

```http
GET /api/payments?limit=25
Authorization: Bearer <key>
```

`limit` is bounded to 1-100 and defaults to 25.

Response:

```json
{
  "mode": "test",
  "count": 1,
  "items": []
}
```

### Retrieve

```http
GET /api/payments/:id
Authorization: Bearer <key>
```

Response:

```json
{
  "intent": {},
  "attempts": [],
  "refunds": []
}
```

Unknown IDs return HTTP 404 `not_found`.

## Tokenization

```http
POST /api/payments/tokenize
Authorization: Bearer <key>
Content-Type: application/json
```

Body:

```json
{
  "card": {
    "number": "4242424242424242",
    "cvv": "424",
    "exp_month": "12",
    "exp_year": "2029"
  }
}
```

Response: HTTP 201:

```json
{
  "object": "vault_token",
  "token": "vault_tok_test_...",
  "merchant_id": "merch_test_default",
  "env_mode": "test",
  "last4": "4242",
  "card_network": "visa",
  "created_at": "2026-11-22T19:32:27.222Z"
}
```

## Webhooks

PayOps **does send webhooks**. They are queued and dispatched by the worker.

Supported application event types:

| Event type | When emitted |
|---|---|
| `payment.succeeded` | Successful payment/charge |
| `payment.failed` | All applicable connector attempts failed |
| `payment.canceled` | An unpaid intent was canceled |
| `refund.succeeded` | Refund accepted |

The system can also accept arbitrary event types through
`POST /api/webhooks/test`; a test payload is not restricted to the types above.
The default endpoint subscriptions include `payment.succeeded`,
`payment.failed`, `payment.canceled`, and `refund.succeeded`.

### Register an Endpoint

```http
POST /api/webhooks/endpoints
Authorization: Bearer <key>
Content-Type: application/json
```

Body:

```json
{
  "target_url": "https://merchant.example/payops-webhooks",
  "events": [
    "payment.succeeded",
    "payment.failed",
    "refund.succeeded"
  ]
}
```

The target must start with `http://` or `https://`. On success: HTTP 201:

```json
{
  "endpoint": {
    "id": "uuid",
    "merchant_id": "merch_test_default",
    "env_mode": "test",
    "target_url": "https://merchant.example/payops-webhooks",
    "signing_secret": "whsec_test_<random>",
    "events": ["payment.succeeded", "payment.failed", "payment.canceled", "refund.succeeded"],
    "active": true,
    "created_at": "2026-11-22T19:32:27.222Z"
  }
}
```

Store `signing_secret`; it is not returned by list operations.

### Webhook HTTP Request

PayOps sends:

```http
POST <target_url>
Content-Type: application/json
User-Agent: PayOps-Webhook-Dispatcher/1.0
X-PayOps-Event: payment.succeeded
X-PayOps-Delivery-Id: <delivery UUID>
X-PayOps-Timestamp: <Unix seconds>
X-PayOps-Signature: t=<timestamp>,v1=<HMAC hex>
```

The timeout is 5 seconds. HTTP 2xx is considered successful. Other outcomes,
timeouts, and network failures are stored as failed deliveries.

### Webhook Envelope

```json
{
  "id": "delivery UUID",
  "event_type": "payment.succeeded",
  "created_at": "2026-11-22T19:32:27.222Z",
  "data": {}
}
```

Payment data for `payment.succeeded` / `payment.failed`:

```json
{
  "intent_id": "uuid",
  "amount_cents": 12500,
  "currency": "USD",
  "status": "succeeded",
  "connector": "mock_stripe",
  "attempt_count": 1,
  "failover_triggered": false,
  "metadata": {
    "order_id": "order_123"
  }
}
```

Payment `metadata` is copied from the created intent. A storefront integration
must include its order reference in `metadata.order_id`; the commerce webhook
uses it to match and verify the order amount and currency before settlement.

Refund data for `refund.succeeded`:

```json
{
  "refund_id": "uuid",
  "intent_id": "uuid",
  "amount_cents": 12500,
  "currency": "USD",
  "connector": "mock_stripe"
}
```

For `/api/webhooks/test`, `data` is the caller-provided `payload`, defaulting
to:

```json
{
  "test": true,
  "timestamp": "2026-11-22T19:32:27.222Z"
}
```

### Signature Verification

The exact signing input is:

```text
<X-PayOps-Timestamp> + "." + <exact JSON request body>
```

The exact HMAC is:

```text
HMAC_SHA256(signing_secret, signing_input)
hex encoding
```

Verification pseudocode:

```javascript
const timestamp = headers['x-payops-timestamp'];
const signature = headers['x-payops-signature']; // t=...,v1=...
const rawBody = await getRawRequestBodyWithoutParsing();

const suppliedV1 = signature
  .split(',')
  .find((part) => part.trim().startsWith('v1='))
  ?.slice(3);

const expected = crypto
  .createHmac('sha256', signingSecret)
  .update(`${timestamp}.${rawBody}`)
  .digest('hex');

const valid =
  suppliedV1 &&
  crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(suppliedV1, 'utf8')
  );
```

Use the raw bytes/body before JSON parsing or re-serialization. Reject an
unexpectedly old timestamp in the application layer to prevent replay.

The dispatcher currently sends `X-PayOps-Signature` as
`t=<timestamp>,v1=<hex>`, and does not send a bare `sha256=` signature.

### Delivery Records

List deliveries:

```http
GET /api/webhooks/deliveries?limit=30
Authorization: Bearer <key>
```

Response:

```json
{
  "count": 1,
  "items": []
}
```

Delivery status values:

| Status | Meaning |
|---|---|
| `pending` | Delivery created |
| `replaying` | Replay queued |
| `success` | Target returned HTTP 2xx |
| `failed` | Target error, timeout, or non-2xx |

Replay:

```http
POST /api/webhooks/deliveries/:id/replay
Authorization: Bearer <key>
```

Response:

```json
{
  "message": "Webhook replay queued.",
  "delivery": {}
}
```

Send a test event:

```http
POST /api/webhooks/test
Authorization: Bearer <key>
Content-Type: application/json
```

Body:

```json
{
  "event_type": "payment.succeeded",
  "payload": {
    "test": true
  }
}
```

Response: HTTP 202:

```json
{
  "queued": true,
  "job_id": "uuid-or-null"
}
```

## Standard Error Shape

Application errors use:

```json
{
  "error": {
    "code": "error_code",
    "message": "Human-readable message"
  }
}
```

The route-not-found response uses HTTP 404:

```json
{
  "error": {
    "code": "route_not_found",
    "message": "Route GET /unknown does not exist."
  }
}
```
