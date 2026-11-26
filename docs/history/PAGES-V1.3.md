# PayOps multi-page storefront v1.3

v1.3 splits the single stacked homepage into separate pages, in the spirit of a
large marketplace structure. All v1.2 features, content, prices, catalog, AI
product photos and PayOps backend behavior are unchanged.

## Page map

- `/` — home: category navigation, two-slide collection banner, product
  shortcuts, "This week's highlights", promotional panels and an about teaser.
  No product catalog grid on the homepage anymore.
- `/products` — the full PayOps collection: sidebar category filters, stock
  filter, text search, price/name sorting, no-results reset. Deep links:
  `/products?q=hoodie`, `/products?cat=Footwear`. The header search now submits
  here.
- `/products/<slug>` — one page per product: gallery, price, description,
  stock, Add to cart, Buy now, details and "You may also like" (same category).
  Product cards everywhere link to these pages.
- `/cart` — the cart is now its own page instead of an overlay: lines,
  quantities, removal, coupon, totals, delivery address and checkout. Add to
  cart and the header cart button navigate here. Guest cart, account cart sync,
  guest-to-account merge and uncertain-checkout retry behavior are unchanged
  (same localStorage/sessionStorage keys).
- `/account` — sign in / create account, or the account overview with links to
  orders, tracking and cart. Sign-out clears stored cart state as before.
- `/orders` — order history page: items, payment status, coupon discount and
  totals, each linking to its tracking page.
- `/track` — order tracking page: delivery milestone timeline, staff note,
  tracking number/carrier link. `/track?order=<id>` shows one order; without a
  parameter it lists orders to pick from.
- `/about` — about PayOps, including the AI-generated-image disclosure.

Staff/admin routes (`/login`, `/admin/*`), checkout result pages
(`/checkout/success`, `/checkout/cancel`) and all APIs are unchanged.

## Upgrade notes

Same procedure as v1.2: back up `.env` and the database, stop the app and
worker, `npm ci`, `npm run db:setup` (no schema changes in v1.3), rebuild and
restart. No new environment variables or migrations.

## Verification (23 Nov 2026)

- `npm ci`, `npx prisma generate`, `npm run typecheck`, `npm run build`: PASS.
- `npm run test:integration`, `npm run test:marketplace`,
  `npm run test:webhooks`: PASS against an isolated seeded PostgreSQL 14.24.
- Browser checks (headless Chrome) at 320/390/1280px: home renders hero,
  shortcuts, highlights and promos with no stacked catalog; header search lands
  on `/products`; category/search/sort/reset work on the products page;
  deep-linked category filter works; product detail pages render with related
  products; add-to-cart opens the cart page; guest checkout prompts sign-in;
  registration merges the guest cart; combined two-product demo checkout
  completes; orders appear on `/orders`; `/track` shows the delivery timeline;
  cart clears after a paid order; no client-side errors in any session.
