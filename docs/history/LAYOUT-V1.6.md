# PayOps v1.6: header and navigation layout

- The category menu is now rendered inside the sticky header (src/components/Header.tsx), directly under the logo and search row. It stays attached to the header while you scroll.
- The header and the page content no longer touch: `main` has 24px of space above it (16px on mobile) in src/app/globals.css.
- Account and Help dropdowns, search and the cart are unchanged.
- No changes to the database, .env or setup-local.ps1. Follow RENAME-V1.5.md for setup.
