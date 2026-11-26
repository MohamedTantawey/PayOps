# Architecture | v2.0

```text
Browser / Stripe CLI
        |
        v
Web / Next.js BFF :3000  (no database)
        |                 |
        v                 v
Commerce :3000 --------> Identity :3200
        |   session API    |
        |   cart event API |
        v                 v
commerce-db             identity-db
private Postgres        private Postgres

Worker --> Commerce /api/internal/maintenance
Prometheus --> Web /metrics + Commerce /metrics
Web/Commerce OpenTelemetry --> Tempo --> Grafana
```

The same port number is safe because Web and Commerce run in separate containers. For direct local process tests, Web used 3000, Commerce 3100 and Identity 3200.

## Registration and session

1. Browser posts credentials to Web's `/api/customer/auth`.
2. Web calls Identity with its server-only service credential.
3. Identity validates input, rate limits per email, hashes passwords with scrypt + random salt, writes its own customer/session rows, and returns a random session token.
4. Web sets the token as an HttpOnly, SameSite=Lax cookie. It never includes the session token in the browser-facing JSON.
5. Commerce resolves customer identity by sending that session token to Identity's authenticated session API. Commerce stores only the customer ID and order-specific email/address snapshot in its own order data.

No email verification, password reset, MFA, SSO or account-management UI is implemented. The local starter must not be used for real customer accounts without adding them and reviewing privacy/security controls.

## Catalog and cart

Web renders the catalog using Commerce's catalog API. It retains v1's static six-product fallback so browsing can render if Commerce is unavailable. Fallback product IDs cannot be purchased. Checkout fails closed when the backend is down.

Identity owns saved-cart product IDs and quantities. Web joins them to Commerce product DTOs to show current names/prices/availability. Cart writes validate product availability through Commerce, then persist the IDs in Identity. Stock is authoritatively rechecked/reserved in Commerce at checkout, so the cart availability check is not a stock guarantee.

## Marketplace checkout

1. Browser submits items, coupon, address and a durable Idempotency-Key through Web.
2. Commerce verifies the customer with Identity.
3. Under its own PostgreSQL transaction/advisory lock, Commerce validates products, decrements available stock, consumes a coupon use, creates order/item snapshots, writes reservation rows and saves the idempotency context.
4. In Stripe test mode it creates a provider session outside that transaction using a stable provider key. In demo mode it immediately settles the order.
5. Settlement commits reservation state, payment, order status and a balanced two-leg ledger movement in one Commerce transaction. It also writes a cart-cleanup outbox event in that SAME transaction.
6. The maintenance worker sends pending outbox events to Identity. Identity updates the cart and writes the event ID into its inbox in one local transaction. Duplicate deliveries return success without subtracting quantities again.

Checkout's financial commit does not wait for cart cleanup. A paid order can briefly remain in the saved cart, normally until the next one-minute worker tick. The event survives process failure and retries on later ticks. Eventual consistency is explicit, not a distributed transaction. A retry of checkout with the same key returns its saved response; a changed payload/owner with that key returns 409.

## Outbox failure and recovery

An unavailable Identity endpoint leaves `Outbox.deliveredAt` null, increments attempts and stores the last error. A later successful delivery sets the timestamp. If Identity commits but the ACK is lost, the inbox event ID deduplicates the retry. The outbox has no automatic dead-letter cutoff or backoff; it retries once per worker tick, up to 50 oldest pending rows per tick. Persistent poison events can starve later entries, so monitor and repair them manually. No queue broker or distributed tracing for Identity is supplied.

The cart event subtracts purchased quantities from the current saved cart. A cart edited before delayed delivery may have matching quantities removed. This preserves the earlier project's subtraction behavior but is not cart-version conflict resolution. Add cart snapshot/version semantics before multi-device production use.

## Financial controls kept local

- Money is integer minor units, EGP by default.
- Checkout/refund operation contexts and responses are durable idempotency records.
- Payment/refund ledger movements are double-entry, append-only and balanced by deferred PostgreSQL constraints.
- Reservations last 35 minutes. Worker expiry checks provider state where required, then releases stock once. Unresolved provider outcomes remain held for manual review rather than risking overselling.
- Refunds are full-order only. No automatic restock on refund.
- Webhook raw-body signatures are checked by Commerce after Web forwards the unchanged bytes and signature. Verified events are stored once, retried with backoff, then marked DEAD after five attempts. Invalid deliveries store only a hash.
- Staff permissions remain ops/finance/admin. Commerce independently checks them, not only the UI.

Payments, orders and inventory are modules inside ONE Commerce service in this release. They are not separately scalable/deployable services. Extracting them later needs explicit sagas, compensation rules and separate payment/order read projections. No claim is made that this release implements those boundaries.

## Data isolation

Commerce schema: Product, Order, OrderItem, Payment, Refund, IdempotencyRecord, Reservation, LedgerEntry, WebhookEvent, WebhookDelivery, AuditLog, Coupon, Outbox.

Identity schema: Customer, CustomerSession, CartItem, AuthAttempt, Inbox.

There are no shared tables, schema-level cross-service joins or cross-database foreign keys. Web has no database package or credentials. Commerce does not have Identity's database password, and Identity does not have Commerce's. Both can receive API-scoped service credentials. Local Compose uses separate database instances and internal data networks. The process-level verification used separate databases/roles in one test Postgres server, and confirmed that an Identity-role table read in Commerce is denied.

## v2.1 addition: gateway
Web -> Commerce -> **Gateway** (own Postgres, `gateway-db`). The gateway is the only service that talks to payment connectors. Commerce -> gateway: REST with a secret API key. Gateway -> Commerce: signed webhooks via Web's allow-listed `/api/webhooks/payops`. The browser reaches only the gateway's hosted card page (port 3010).
