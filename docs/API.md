# API contracts | v2.0

## Browser-facing Web routes

The browser uses only http://localhost:3000. JSON mutation requests send `Content-Type: application/json` unless marked as a form. Customer authorization uses an HttpOnly cookie. Staff APIs accept a staff session cookie or Bearer token. All browser POST/PUT origin checks use `NEXT_PUBLIC_APP_URL`.

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/customer/auth` | Current customer; register/login/logout. POST body `{action,email,password,name?}` |
| GET/PUT | `/api/customer/cart` | Saved cart; PUT `{items:[{productId,quantity}]}` |
| GET | `/api/customer/orders` | Current customer's order history and tracking |
| POST | `/api/checkout` | Single-item buy-now `{productId,quantity}`; customer optional |
| POST | `/api/marketplace/checkout` | Authenticated combined checkout `{items,coupon,address}` |
| POST | `/api/marketplace/coupon` | Server-side coupon quote `{code,items}` |
| POST | `/api/refunds` | Finance/admin full refund `{orderId,why}` |
| POST | `/api/admin/fulfillment` | Ops/admin fulfillment `{orderId,status,trackingNumber?,trackingUrl?,why}` |
| POST | `/api/admin/coupons` | Finance/admin create/disable coupon |
| POST | `/api/admin/events/retry` | Admin-only webhook requeue `{eventId,why}` |
| POST | `/api/admin/session` | Form-encoded staff token login, redirect + session cookie |
| POST | `/api/admin/logout` | Staff sign-out |
| POST | `/api/webhooks/stripe` | Unchanged raw webhook bytes + Stripe-Signature header |
| GET | `/health` | Web process liveness, not end-to-end readiness |
| GET | `/metrics` | Web process metrics, private network only |

Checkout/refund routes require an `Idempotency-Key` header of 16-120 ASCII letters, digits, `_` or `-`. Retain the same key until the result is known. A new key is a new purchase/refund intent.

Marketplace address fields are `name`, `phone`, `street`, `city`, `country`, each 2-200 characters; phone has additional validation. Items are 1-50 distinct products with quantity 1-10 each. Successful checkout returns `{url,orderId}`. Navigate to `url`. Successful demo settlement is not a real charge.

Error responses are JSON `{error:string}`. Common statuses: 400 validation, 401 authentication, 403 permission/origin, 404 missing route/product, 409 stock/idempotency/state conflict, 429 auth throttling, 503 service/database/provider unavailable. Never assume a 503 means payment did not happen; retry with the SAME operation key.

## Commerce internal API

Only private network access is expected. Every `/api/*` request requires `X-Service-Token: COMMERCE_SERVICE_TOKEN`, plus customer/staff credentials as required. Web attaches the service token server-side; browser JSON never includes it. Middleware rejects an absent/incorrect key. `/health` and `/metrics` are intentionally outside that middleware, so do not expose Commerce directly to the internet.

- The commerce-facing browser routes above, except customer auth/cart.
- `GET /api/catalog` or `?slug=...`: active product DTOs.
- `GET /api/views/{stats,orders,ledger,events,deliveries,audit,coupons}`: explicit staff read models with role enforcement. This is not a generic database proxy.
- `POST /api/views/audit`: staff view audit `{target}`.
- `POST /api/internal/maintenance`: also requires `Authorization: Bearer MAINTENANCE_TOKEN`. Retries webhooks, releases verified-expired reservations and dispatches cart outbox events.
- `GET /health`: checks its own database with SELECT 1.

Web's public catch-all proxy has a fixed allowlist. It does not expose internal maintenance, staff read models or arbitrary destinations. Server-rendered staff pages call those read models directly with staff credentials and the service key.

## Identity internal API

Private network, `Authorization: Bearer IDENTITY_SERVICE_TOKEN` required except `/health`. Customer-bound calls also send `X-Session-Token` with the opaque customer token.

| Method | Path | Response/effect |
|---|---|---|
| GET | `/health` | Checks Identity's own database |
| GET | `/v1/session` | `{customer:{id,email,name}\|null}` |
| POST | `/v1/auth` | Register/login returns `{customer,sessionToken}` to Web only; logout removes saved session |
| GET | `/v1/cart` | `{items:[{productId,quantity}]}` |
| PUT | `/v1/cart` | Replaces authenticated customer's saved cart |
| POST | `/v1/events/cart-purchased` | `{id,customerId,items}`; idempotently subtracts purchased quantities and persists inbox ID |

The service key authenticates trusted internal callers, not an end user. Protect and rotate it as a secret. APIs are HTTP inside local Compose; production needs TLS/network policy and a credential rotation scheme. There is no service discovery beyond Docker DNS, no API version negotiation or OAuth workload identity. The `/v1` prefix is the Identity contract version, independent of the product's v2.0 label.

## v2.1
| POST | `/api/webhooks/payops` | Raw gateway webhook bytes + `X-PayOps-Signature`, `X-PayOps-Timestamp` headers (via Web) |
Gateway API: see `docs/GATEWAY.md` and `http://localhost:3010/api-docs`.
