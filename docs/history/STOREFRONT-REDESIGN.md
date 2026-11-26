# PayOps storefront, editorial redesign

This release keeps the v1.1 backend, database schema, API routes, checkout request and idempotency behavior, package versions, worker, deployment templates and observability configuration unchanged.

## What changed

- Warm cream, charcoal, sage and taupe art direction inspired by the project explainer.
- Editorial hero, brand story, quiet call-to-action section and new responsive header/footer.
- Original SVG garment illustrations replace the emoji/gradient art. These are design illustrations, not exact product photography. Unknown product slugs receive a neutral PayOps illustration.
- An AI-generated fictional campaign concept is stored locally in `public/images/payops-editorial.webp`. It is not a photograph of the actual catalog. The campaign caption identifies it as a concept.
- Client-side Everything, Clothing, Footwear and Accessories filters. Categories are inferred from the existing catalog slugs. New catalog types may need a new category rule in `Collection.tsx`.
- Buy buttons retain the existing single-unit checkout API behavior. Loading, sold-out and error states are styled; errors are announced accessibly.
- Checkout return/cancel pages match the storefront. The success page does not claim final payment confirmation before the webhook.
- Responsive two-column phone/three-column desktop collection, keyboard focus, and reduced-motion support. Display font uses the system Georgia stack, so no font download is required.

## Checks performed, 23 Nov 2026

- Clean `npm ci`: passed, zero audit vulnerabilities reported.
- `npm run build`: passed, Next.js 15.5.29 production build.
- `npm run typecheck`: passed.
- Chromium checks against the running production build at 320px, 390px and 1280px: storefront, demo success and cancel routes visually inspected, no horizontal overflow, hero image loads.
- Category filters, filter reset and collection anchor navigation: passed.
- Checkout button request/error presentation: checked with an intercepted synthetic API error, not a real order. Browser console had no page errors.
- Original archive comparison: only storefront/shared chrome and checkout-page files changed. All original API, library, Prisma, scripts and deployment files remain byte-identical.

## Scope and limits

No real Stripe payment, new database integration run, Docker Compose startup or cloud deployment was performed for this visual-only release. Existing v1.1 verification and limitations remain in `VERIFICATION.md`. The shared header/footer are updated on admin pages, but admin forms, dashboards and dark utility styling were not redesigned. There is no cart, sizing selector, shipping estimator, customer account or email signup added by this redesign. Buy now still checks out one unit directly, as in v1.1.
