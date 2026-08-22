# NoteFusion

**Hear it. See it. Play it.** NoteFusion listens to live or recorded music and
transcribes it into **Tonic Solfa** (movable-do) and **standard staff notation**.

Product and technical requirements live in [docs/](docs/):
- `NoteFusion_PRD.docx` — product requirements (features, personas, metrics)
- `NoteFusion_TRD.docx` — architecture, ML pipeline, stack selection

> **Extract the text before reading the .docx files** — they are the source of truth
> for features and stack decisions.

## Architecture

Three tiers. The clients talk **only** to the C# Web API; the API is the sole gateway
to the Python ML service.

```
mobile/   React Native + Expo client (iOS / Android / web)
   │  HTTPS + JWT
   ▼
src/      C# .NET 10 Web API  — modular monolith, clean architecture, the only gateway
   │  HTTP (internal)                         Postgres ◄─ EF Core
   ▼
server/   Python FastAPI ML worker — Basic Pitch / ONNX CPU inference (internal only)
```

- **API (`src/`)** — a headless modular monolith. The same image serves the mobile
  client today and a web client later, unchanged. Layers point inward:
  `Shared ← Core ← Application ← Infrastructure ← Api`.
- **Solfa engine (`src/NoteFusion.Core/Solfa`)** is the product's core IP: movable-do,
  la-based for minor, `doh` derived from the key. A key change re-labels the note list;
  it never re-transcribes.
- **ML worker (`server/`)** does audio → note events → MusicXML + solfa. It is reached
  only by the API — never by a client directly. Audio is deleted immediately after a job.
- **Mobile (`mobile/`)** — Expo SDK 52, TypeScript strict, JWT access/refresh, dark theme.
  See [mobile/README.md](mobile/README.md).

```
NoteFusion.slnx
└── src/
    ├── NoteFusion.Shared          Result/Error primitives, guards (no dependencies)
    ├── NoteFusion.Core            Entities, enums, the solfa engine (core IP) → Shared
    ├── NoteFusion.Application     Use cases, feature folders, DTOs, interfaces → Core
    ├── NoteFusion.Infrastructure  EF Core/Postgres, JWT, push, ML API client → Application
    └── NoteFusion.Api             Controllers, middleware, DI composition root, Swagger
tests/
    └── NoteFusion.Tests           xUnit; solfa engine, KeyParser, auth, library
```

## Run the whole backend (Docker)

```bash
docker compose up --build
```

Brings up three services — `db` (Postgres 16), `transcriber` (Python FastAPI), and
`api` (C# Web API) — wired together. Then:

- API: <http://localhost:5080> (Swagger UI at `/swagger` when `ASPNETCORE_ENVIRONMENT=Development`)
- Liveness: `GET /health`
- Point the mobile app at `http://10.0.2.2:5080` (Android emulator) or your machine's
  LAN IP (physical device) — see `mobile/app.json` → `expo.extra.apiBaseUrl`.

Dev credentials (override via environment / a gitignored `.env` for anything real):
- Postgres password: `notefusion_dev` (`POSTGRES_PASSWORD`)
- Seed admin: `admin@notefusion.app` / `ChangeMe!123` (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`)

For the production Heroku env vars left out of source — payment-provider keys, Google
sign-in, and Resend email — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The two web
front-ends (static marketing site, and the Next.js admin dashboard at
`web-admin-blue-two.vercel.app`) deploy to Vercel — see
[docs/DEPLOYMENT_WEB.md](docs/DEPLOYMENT_WEB.md).

## Build & test each tier

```bash
# C# API
dotnet build NoteFusion.slnx -c Release
dotnet test  NoteFusion.slnx                 # 59 tests, no database needed (SQLite in-memory)

# Python ML worker  (server/)
pip install -r server/requirements.txt
pip install --no-deps basic-pitch==0.4.0     # tensorflow pin has no 3.12 wheels; ONNX runtime is provided
cd server && python -m pytest -q

# Mobile  (mobile/)
cd mobile && npm ci && npm run lint          # tsc --noEmit (strict type-check)
```

CI runs all three on every push/PR — see [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Key conventions

- **Movable-do everywhere**: solfa syllables are derived from the key at render time.
  A key change is a re-labelling, never a re-transcription.
- **Result over exceptions** for expected failures (network, low confidence); guards
  throw only for programmer errors.
- **The note list is the source of truth**: staff and solfa both derive from it.
- **Honest confidence**: low-confidence audio surfaces a clear message rather than
  emitting garbage notation (PRD requirement).
