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

To use a different host port, set `APP_PORT`, for example
`APP_PORT=3001 docker compose up -d`.

## Jenkins and SonarQube

The `Jenkinsfile` expects the Jenkins SonarQube Scanner installation to be
named `SonarScanner` and the SonarQube server configuration to be named
`SonarQube-server`.

### Jenkins configuration

1. Install the **SonarQube Scanner for Jenkins** plugin.
2. Go to **Manage Jenkins > Tools > SonarQube Scanner installations** and add
   an installation named `SonarScanner`. Let Jenkins install it automatically.
3. Go to **Manage Jenkins > System > SonarQube servers** and add a server
   named `SonarQube-server`.
4. Create a SonarQube token under **My Account > Security**, then add it to
   Jenkins as a **Secret text** credential. Select that credential in the
   server configuration.
5. In SonarQube, add a Jenkins webhook at the URL that SonarQube can reach.
   With SonarQube running in the default Docker bridge network and Jenkins
   running directly on Fedora, use:

   ```text
   http://172.17.0.1:8080/sonarqube-webhook/
   ```

   Do not use `localhost` in this URL: inside the SonarQube container,
   `localhost` refers to SonarQube itself. If Jenkins is exposed through a
   public hostname or tunnel, use that public URL instead:

   ```text
   https://<public-jenkins-host>/sonarqube-webhook/
   ```

6. Create a SonarQube project with key `payops`. The repository's
   `sonar-project.properties` supplies the project name, source paths, and
   exclusions.

The pipeline's **SonarQube analysis** stage publishes the analysis, and the
**Quality gate** stage waits for the webhook result. The quality gate will
fail the build when the SonarQube project does not pass its configured gate.
