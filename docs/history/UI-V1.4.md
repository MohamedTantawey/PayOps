# PayOps UI v1.4

23 Nov 2026. This release changes the UI without changing the database schema, API contracts, cart storage keys, session cookies, database names or deployment resource identifiers.

- Visible PAYOPS branding is now PayOps, including storefront pages, footer and page titles.
- The main header stays at the top while scrolling. Announcement and utility strips scroll away.
- Account and Help open on click. Only one dropdown is open at a time. Click outside, navigate, tab out or press Escape to close. Escape returns focus to the opener. Both buttons and arrows are available on mobile.
- Account links to the existing account, order, tracking and cart pages. Help links to tracking, orders, about and collection pages.
- Fixed-pixel type sizes increased approximately 12%; root type is 18px for rem-based staff pages. The mobile logo is slightly smaller to keep both dropdowns available on one row.

## Upgrade from v1.3 on Windows / Docker Compose

1. Keep the existing project folder, .env, database volume and a database backup. Extract this archive separately first.
2. Copy the new project files over the existing payops-commerce folder. Preserve the existing .env. Keeping the same folder / Compose project name preserves the existing named volumes.
3. From that same folder run `docker compose up --build -d`.
4. Reload the site, using Ctrl+F5 if the old UI remains cached.

Do not run `docker compose down -v`, delete the database volume or reset the database. No schema migration or database reset is needed for v1.4. For a non-Docker setup: keep .env and the database, run `npm ci`, `npm run build`, then restart the app and worker.

## Checks run for v1.4

- npm ci: pass, zero reported vulnerabilities at install time.
- Prisma client generation, TypeScript checking and production Next.js build: pass.
- Browser checks at 320, 360, 390, 768 and 1280px: both dropdowns; one open at a time; click-outside; Escape / focus return; keyboard access; sticky header; About navigation; no page overflow.
- Collection, product, cart, account, orders, tracking, about and staff login layouts checked at 390 and 1280px. Screenshots inspected.
- Storefront uses the bundled demo catalog when no database is configured. Authenticated database flows, payments, Docker Compose and cloud deployment were not rerun for this UI release. Older verification entries below belong to their named releases, not new v1.4 test runs.

This is the historical UI-only release note. The full identifier rename in v1.5 supersedes its compatibility guidance. See RENAME-V1.5.md.
