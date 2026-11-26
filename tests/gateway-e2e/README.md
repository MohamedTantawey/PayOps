# Commerce <-> gateway end-to-end test (no Docker needed)

Runs the real gateway and the real Commerce code in one process against embedded Postgres (PGlite).
Covers: checkout -> hosted card page -> decline then pay -> signed webhook -> order PAID + balanced ledger; duplicate/replayed
webhook; bad signature; full refund; abandoned checkout released via gateway cancel; paid-but-webhook-missed reconcile; marketplace checkout.

    cd services/commerce && npm ci && npx prisma generate
    cd ../gateway && npm ci
    mkdir -p /tmp/e2e && cd /tmp/e2e && npm i tsx @electric-sql/pglite @electric-sql/pglite-socket
    cd <project>/services/commerce && mkdir -p node_modules/@electric-sql && ln -s /tmp/e2e/node_modules/@electric-sql/pglite* node_modules/@electric-sql/
    cp ../../tests/gateway-e2e/e2e.mts ./e2e.tmp.mts && /tmp/e2e/node_modules/.bin/tsx ./e2e.tmp.mts   # prints ALL PASS; delete e2e.tmp.mts afterwards
