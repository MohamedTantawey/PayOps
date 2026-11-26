# PayOps v1.5: clean local start

You chose a NEW clean database. Existing accounts, orders and carts are not imported. The old database volume stays untouched.

## Windows / PowerShell

1. In the OLD project folder, stop the old stack so it releases ports:
   `docker compose down`
   Do NOT add `-v` and do not prune/delete volumes.
2. Keep that old folder and its `.env` as a backup. Extract this ZIP in a NEW location. Open PowerShell inside the extracted `payops-commerce` folder.
3. Run:
   `powershell -ExecutionPolicy Bypass -File .\setup-local.ps1`
4. Then run:
   `docker compose up --build -d`
5. Open http://localhost:3000 and use Ctrl+F5. Create a NEW customer account. The product catalog is seeded automatically.

No dump/restore or migration is needed for this clean start. Do not copy your old `.env` into the new folder.

`setup-local.ps1` is already inside this ZIP. It generates passwords/tokens on YOUR computer and writes `.env` without printing them. It preserves an already-completed `.env` if run again. `.env.example` contains only a non-secret template. No completed `.env` or secret is included in the ZIP.

For staff login, privately open your local `.env`, find the `local-admin` token in `ADMIN_TOKENS`, and paste it into http://localhost:3000/login. Do not share your `.env` or tokens. Grafana uses `admin` plus `GRAFANA_ADMIN_PASSWORD` from `.env` on a new Grafana volume. If you reuse an old Grafana volume, its existing saved password remains unchanged.

Stripe placeholder keys keep payments simulated. No real charge is made. This setup is local/demo only, not a production deployment.

## Rename details

Source identifiers/CSS, cookies, cart keys, CI, metrics/Grafana, database defaults, ledger guards, Helm/Kubernetes/Terraform names and filenames are renamed. Helm is now `deploy/helm/payops`. No old-brand text remains in the delivered source.

Database defaults are now user/database `payops`, with a fresh named volume key `pgdata_payops_v15`. Old database data is not deleted or overwritten. Customer and staff sessions reset, and guest-only carts are not imported. Finish/reconcile uncertain checkout or refund operations on the old app before retiring it.

There is 28px of space below the sticky header on desktop and 20px on mobile on every route. The larger v1.4 type, dropdowns and other project features remain.

Existing Kubernetes/Helm/Terraform resources/state are not automatically migrated by the renamed deployment starters. Do not apply them to an existing deployment without a separate migration plan.

## Rollback

Stop the new stack with `docker compose down` (no `-v`), return to your OLD folder with its original `.env`, then run `docker compose up --build -d`. The old database remains available. New records created in v1.5 do not copy back automatically. Do not run both apps accepting orders at once.
