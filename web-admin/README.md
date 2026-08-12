# web-admin

The internal analytics dashboard. Vite + React + TypeScript + Tailwind, served from its own
origin, talking to the C# Web API over CORS.

This is a separate app from `web-site/` on purpose. `web-site/` is public marketing with no
auth; this one is auth-gated, `noindex`, and shows personal data. Keeping them apart means a
mistake in the marketing build cannot expose the dashboard, and the dashboard's dependency
tree never ships to the public site.

## Running it

```bash
cd web-admin
npm install
cp .env.example .env.local   # then set VITE_API_URL to the port the API is actually on
npm run dev                  # http://localhost:5173
```

Port 5173 is fixed (`strictPort`) because it is the origin listed in the API's
`Cors:AllowedOrigins`. If Vite silently moved to 5174 the browser would block every request
with an opaque CORS error, which is a bad afternoon.

You need an **admin** account. A non-admin can sign in successfully and is then told the
account lacks access, rather than being dropped onto a dashboard where every panel 403s.

```bash
npm run lint     # tsc --noEmit, strict
npm run build    # type-check then production build into dist/
```

## API side

Two endpoints, both behind `[Authorize(Policy = "Admin")]`:

- `GET /api/admin/analytics/overview?from=&to=` — counters, daily series, breakdowns, cohorts
- `GET /api/admin/analytics/users?page=&pageSize=&search=` — a page of accounts

CORS is configured in `src/NoteFusion.Api/Program.cs` and fails closed: with no origins set,
nothing is allowed. Dev origins live in `appsettings.Development.json`; compose reads
`ADMIN_DASHBOARD_ORIGIN`.

## Things in here that are load-bearing

**Dates are formatted the way the server bucketed them.** The API groups days in West Africa
Time and echoes the offset as `reportingOffsetMinutes`. Calendar-date strings (`"2026-07-12"`)
are formatted from their string parts, never through `new Date`, which would parse them as UTC
midnight and slide the whole chart a day left in any negative-offset browser. Instants are
shifted by the reported offset. See `src/lib/format.ts`.

**Null is not zero.** `successRate`, `averageConfidence` and `retentionRate` are nullable, and
null means the rate is undefined (no terminal outcomes, empty cohort). Those render as an em
dash in muted type, never as 0%.

**Absent metrics say they are absent.** There are no subscribed / paid / free-tier cards,
because no subscription, plan or payment entity exists in the schema. The "Not measured yet"
panel on the overview names them and says why, so nobody reads a missing feature as a zero.
They arrive with the billing model, not before.

**The metric labels are the honest ones.** "Google-linked accounts", not "Verified" — the
schema has no verification flag. "Weekly cohorts / ever returned", not D1/D7/D30 — only the
latest sign-in is stored, so a day-N curve is not computable.

**Refresh is serialised.** A page that fires several requests on mount would otherwise send
several refreshes, and since refresh tokens are single-use and rotating, all but one would fail
and sign the admin out mid-load. `src/api/client.ts` funnels them through one promise.

**The route gate is convenience, not security.** `RequireAdmin` hides the UI; the server
enforces the Admin policy on every request. Editing localStorage to say "Admin" gets a 403.
