# PayOps Marketplace v1.2

This release changes the storefront to a dense marketplace layout inspired by the reference site's shopping structure. PayOps has its own content and product art. No Jumia assets, text or brand marks are included.

## What works

- Responsive PayOps header, search submission, category navigation, two-slide collection banner, product shortcuts and product grids.
- Text search, category filters, stock filter and price/name sorting. No invented discounts, reviews, urgency timers or sales numbers.
- Customer registration, email/password sign-in and logout. Passwords use salted scrypt hashes. Customer sessions are random tokens stored as hashes in the database, sent in HttpOnly, SameSite=Lax cookies, expiring after seven days. Set COOKIE_SECURE=true behind HTTPS.
- Browser-local guest cart and account-synced cart. Quantities 1–10, removal and combined multi-product checkout. Customer IDs come only from the authenticated session.
- Server-side stock/price validation and coupon arithmetic. Finance/admin can create or disable percentage coupons with minimum spend, optional cap, expiry and usage limit in PayOps > Coupons. No promotional code is enabled by default.
- Combined checkout keeps one idempotency key for the exact owner, cart, coupon and address. Retries after uncertain failures are frozen to that request, including after a page reload in the same tab. Provider calls remain outside the financial transaction lock.
- Each line has a reservation. Payment commits all held lines. Expiration releases all lines once. Coupons consume a use when inventory is reserved, even if checkout is abandoned. This conservative policy prevents oversubscription; it does not automatically restore a use.
- Account order history with payment state, totals, coupon discount and delivery milestones. Customers can read only their own orders. Staff update delivery state, tracking number and HTTPS carrier link from PayOps > Orders. Updates require a reason and are audited.
- Existing direct Buy now checkout remains available. When signed in, new direct orders are associated with that customer. Old guest orders are not automatically claimed by matching an email.
- Existing refunds, reconciliation, ledger checks, webhook receipts/retries, RBAC, audit and observability remain in place. A concurrent webhook event-upsert race found during testing was fixed under the existing financial lock.

## Setup / upgrade

1. Back up the existing database and .env before replacing source. Keep .env, database and secrets out of the ZIP or source control.
2. Stop the app and worker during this schema upgrade. Do not run the old and new app concurrently against the upgraded database.
3. Run `npm ci`, then `npm run db:setup`. This adds customer, session, cart, coupon and auth-throttle tables, adds customer/discount/delivery fields on orders, and replaces the single-order Reservation unique index with a normal orderId index for multiple line reservations. No database reset is needed. Review the schema before production use.
4. Run `npm run prisma:seed` only if the catalog needs initial seeding. Existing product values are not overwritten by that script.
5. Run `npm run build`, then start the app and worker using your existing deployment method.
6. Configure the real public HTTPS app URL and COOKIE_SECURE=true. Preserve Stripe webhook and admin/worker configuration. Create coupons only when the store intends to offer them.

The checkout is DEMO MODE when Stripe is not configured. It writes a simulated paid order; no money is charged and no goods are shipped. With Stripe configured, checkout creates a real Stripe Checkout session for the exact validated net EGP total. Payment becomes PAID only when the signed webhook confirms it.

## Boundaries before a real store launch

This is a marketplace starter, not feature parity with a large multi-seller commerce platform. It has no seller onboarding, vendor payouts, reviews, returns portal, recommendation engine, carrier API, automated email receipts, email ownership verification, password reset/recovery, customer MFA, address book, wishlist, app installation or installment financing. Customer delivery status is staff-maintained, not a live courier feed.

Shipping and tax charges are zero in this starter and the cart states this. Configure real fulfillment regions, shipping prices, tax treatment, terms, privacy/retention, customer support, account recovery and email verification before accepting real customers. Abuse protection is a DB-backed per-email attempt limit; production also needs trusted-edge/IP rate limiting, bot controls and request/body limits. No real card payment or deployment was performed for this release.

The six product images are approved AI-generated photographic concepts, not photographs of physical products. Each product card carries an AI concept label. Locally bundled optimized WebP files are in public/images/products. The old campaign concept image remains in public/images for history but is not used by the new storefront.

## Checks

- Clean dependency install, Prisma generation, production build and TypeScript.
- Original v1.1 integration suite: concurrent checkout/refund retries, RBAC, balanced ledger and DB constraints, inventory release, webhook queues, metrics, audit and admin pages.
- `npm run test:marketplace`: customer auth, isolated carts/orders, validation, coupon limits/math, concurrent combined checkout, owner/key conflicts, rollback, multiple reservations, fulfillment and coupon administration.
- `npm run test:webhooks`: synthetic signed webhook concurrency, expiration replay, late-paid review and local OTLP export. Synthetic Stripe signatures only, no provider charge.
- Browser checks at 320, 390 and 1280px: storefront, customer account and checkout routes, search/filter/sort, cart, registration, combined demo checkout and order tracking. Tests use an isolated seeded PostgreSQL database.
