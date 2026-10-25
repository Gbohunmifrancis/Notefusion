# NoteFusion

**Hear it. See it. Play it.** NoteFusion listens to live or recorded music (humming, singing,
an instrument, a choir, a song link) and writes it out as **Tonic Solfa** (movable-do) and
**staff notation**, with parts, practice and a hymn library around it.

- Website and web app: <https://notefusion.studio>
- Android app: Google Play (`mobile/`)
- Requirements: [`docs/NoteFusion_PRD.docx`](docs/NoteFusion_PRD.docx) and
  [`docs/NoteFusion_TRD.docx`](docs/NoteFusion_TRD.docx), the source of truth for features and stack
  decisions (extract the text before reading).
- Working on the code? Read [`CLAUDE.md`](CLAUDE.md) first: it is the full, current map of every
  feature and the rules that hold across the repository.

## Architecture

Clients talk **only** to the C# Web API; the API is the single gateway to the Python ML worker.

```
mobile/  web-site/  web-admin/        Android app · website + web app · admin console
            │  HTTPS + JWT
            ▼
src/      C# .NET 10 Web API          modular monolith, clean architecture   ──► Postgres (EF Core)
            │  HTTP, internal only
            ▼
server/   Python FastAPI ML worker    Basic Pitch / ONNX on CPU, one job queue
```

- **API (`src/`)**: headless; layers point inward, `Shared ← Core ← Application ← Infrastructure ← Api`.
  JWT access + rotating refresh tokens, billing (Paystack, Bachs, Google Play), push, email.
- **Solfa engine (`src/NoteFusion.Core/Solfa`)**: the product's core IP. Movable-do, la-based minor,
  the doh from the key; a key change re-labels, never re-transcribes. Mirrored in the worker, the
  phone (`mobile/src/lib/solfa.ts`) and the web (`web-site/assets/choir.js`), in lock-step.
- **ML worker (`server/`)**: audio → notes → MusicXML + solfa, vocal isolation for songs, chords,
  SATB harmony, grading for practice. Reached only by the API; audio is deleted after each job.
- **Mobile (`mobile/`)**: React Native + Expo SDK 56, TypeScript strict, OTA updates through EAS.

## Repository layout

```
src/            C# Web API: Shared, Core, Application, Infrastructure, Api (NoteFusion.slnx)
tests/          xUnit tests for the API (SQLite in-memory, no database needed)
server/         Python ML worker: app/ (pipeline, jobs, ingest), tests/ (incl. accuracy benchmarks), loadtest/
mobile/         Expo app: src/, its native module (modules/), store listing renders (store/)
web-site/       Static website and the /app web client (Vercel)
web-admin/      Next.js admin console (Vercel)
content/        Hymns and authors the website's pages are built from
tools/          Build tooling: blog/ (site and hymn pages), social/ (X journal), asset and piano-sample builders
design/         Source art: practice illustrations, website redesign
ops/            Production operations: backup/ (restic + WAL-G), db/ (database roles), ec2/ (server setup)
docs/           Deployment and operations guides, store listing, curriculum; research/ holds past reports
.github/        CI, deploys, secret scan, the backup drill, scheduled jobs
```

## Run the backend locally

```bash
docker compose up --build          # db (Postgres 16) :5432 · transcriber :8000 · api :5080
```

- API on <http://localhost:5080> (Swagger at `/swagger` in Development); liveness `GET /health`.
- Point the app at `http://10.0.2.2:5080` (Android emulator) or your machine's LAN IP.
- Dev defaults, for local use only: Postgres password `notefusion_dev` (`POSTGRES_PASSWORD`), seed admin
  `admin@notefusion.app` / `ChangeMe!123` (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`).

Configuration comes from the environment (nested keys use `__`, e.g. `Database__Host`). Never commit an
`appsettings*.json` or any secret: the secret scan refuses both.

## Build and test

```bash
# C# API
dotnet build NoteFusion.slnx -c Release
dotnet test  NoteFusion.slnx

# Python ML worker
pip install -r server/requirements.txt && pip install --no-deps basic-pitch==0.4.0
cd server && python -m pytest -q
cd server && python -m tests.accuracy.report --vocal     # sung/hummed accuracy benchmark (slow)

# Mobile
cd mobile && npm ci && npm run lint && npm test

# Website
node --test web-site/tests/*.test.mjs
```

CI ([`ci.yml`](.github/workflows/ci.yml)) runs all of these on every pull request, beside the secret scan.

## Deploying

| What | How | Guide |
|---|---|---|
| API + ML worker | `deploy.yml`: images to GHCR, `docker-compose.prod.yml` on the EC2 host, on every merge to `main` that touches them | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Website and web app | `deploy-web.yml` to Vercel | [docs/DEPLOYMENT_WEB.md](docs/DEPLOYMENT_WEB.md) |
| Admin console | `deploy-admin.yml` to Vercel | [docs/DEPLOYMENT_WEB.md](docs/DEPLOYMENT_WEB.md) |
| Android app | EAS: store builds, and OTA updates on the `production` channel | [docs/DEPLOYMENT_MOBILE.md](docs/DEPLOYMENT_MOBILE.md) |
| Backups | the compose `backup` service; restored weekly by `backup-restore-drill.yml` | [docs/BACKUP_AND_MIGRATION.md](docs/BACKUP_AND_MIGRATION.md) |

## Conventions

- `main` is the only long-lived branch: work goes through a pull request, squash-merged with a written message.
- Every commit is authored by the owner alone (see `CLAUDE.md`).
- The note list is the source of truth: staff and solfa both derive from it.
- Expected failures are `Result`/`Error`, never exceptions; low-confidence audio says so plainly.
- Mobile first: every screen is judged on a mid-range Android phone first.
