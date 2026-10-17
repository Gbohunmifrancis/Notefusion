# web-admin

The internal analytics dashboard. Next.js (App Router) + React + TypeScript + Tailwind +
shadcn/ui, deployed on Vercel from its own origin, talking to the C# Web API over CORS.

It is **not** bundled into the API image any more. Authentication is a bearer token in browser
storage, so nothing here can be server-rendered against the API — Next is used for routing,
layouts and the deploy, and every page is a server shell around a client view.

This is a separate app from `web-site/` on purpose. `web-site/` is public marketing with no
auth; this one is auth-gated, `noindex`, and shows personal data. Keeping them apart means a
mistake in the marketing build cannot expose the dashboard, and the dashboard's dependency
tree never ships to the public site.

## Running it

```bash
cd web-admin
npm install
cp .env.example .env.local   # then set NEXT_PUBLIC_API_URL to the port the API is actually on
npm run dev                  # http://localhost:3000
```

Port 3000 matters: it is the origin listed in the API's `Cors:AllowedOrigins`. If Next moves to
3001 because something else holds the port, the browser blocks every request with an opaque
CORS error, which is a bad afternoon.

You need an **admin** account. A non-admin can sign in successfully and is then told the
account lacks access, rather than being dropped onto a dashboard where every panel 403s.

```bash
npm run lint     # next typegen, then tsc --noEmit, strict
npm run build    # type-check then production build into .next/
```

## API side

Two endpoints, both behind `[Authorize(Policy = "Admin")]`:

- `GET /api/admin/analytics/overview?from=&to=` — counters, daily series, breakdowns, cohorts
- `GET /api/admin/analytics/users?page=&pageSize=&search=` — a page of accounts

CORS is configured in `src/NoteFusion.Api/Program.cs`. `http://localhost:3000` is added only in
Development — in production that origin is one an attacker controls, since anything on the
victim's machine can claim it. Compose runs Production, so it names the origin explicitly through
`ADMIN_DASHBOARD_ORIGIN`. The deployed Vercel origins are hard-coded in that file rather than
config, so a missing `Cors__AllowedOrigins` cannot take the live console offline; it does **not**
fail closed.

## Passkeys

Admins can sign in with a passkey as well as their password. **Settings → Passkeys** adds, renames
and removes them (`src/components/PasskeysPanel.tsx`); the sign-in page has a "Sign in with a
passkey" button and, where the browser supports conditional mediation, offers passkeys in the email
field's autofill (`autocomplete="username webauthn"`). `src/lib/webauthn.ts` converts the API's
WebAuthn JSON to and from what `navigator.credentials` takes, and turns every browser failure into a
plain sentence. The API side is `/api/auth/passkeys/*`: registration is Admin-only, and a passkey
sign-in returns the same token pair as the password, for an admin account only.

The relying party id is `notefusion.studio`, so passkeys work on admin.notefusion.studio but not on
Vercel preview hosts. Locally the API (Development) uses rpId `localhost` and accepts
`http://localhost:3000` — another reason the console must run on port 3000.

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

**The route gate is convenience, not security.** The `(console)` layout hides the UI from anyone
without an admin session; the server enforces the Admin policy on every request. Editing
localStorage to say "Admin" gets a 403.
