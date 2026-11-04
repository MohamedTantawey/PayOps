# PayOps

A tiny payment website for practicing Docker and Docker Compose.
The customer chooses a plan, enters a card, and pays.
Payments are **fake** (test mode): no real money, and only the last 4 card digits are saved.

## Files

| File | What it does |
|---|---|
| `server.js` | The app: shows the website and saves payments in the database |
| `public/` | The website (HTML, CSS, JavaScript) |
| `db/init.sql` | Creates the `payments` table on the first start |
| `Dockerfile` | Builds the app image |
| `docker-compose.yml` | Runs 2 containers: `app` and `db` |
| `.env.example` | Database user, password and name |

## Run

```bash
cp .env.example .env
docker compose up --build
```

Open http://localhost:3000

## Test cards (expiry 12/30, CVC 123)

| Card | Result |
|---|---|
| 4242 4242 4242 4242 | Paid |
| 4000 0000 0000 0002 | Card declined |
| 4000 0000 0000 9995 | Insufficient funds |

## Useful commands

```bash
docker compose ps                  # see the containers
docker compose logs -f app         # watch the app logs
docker compose exec db psql -U payops -d payops -c "SELECT * FROM payments;"
docker compose down                # stop (data is kept)
docker compose down -v             # stop and delete the data
```
