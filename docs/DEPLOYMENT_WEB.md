# Deploying the web front-ends (Vercel)

Three static front-ends ship from this repo, all on Vercel:

| Front-end | Source | Vercel project | Live at |
|-----------|--------|----------------|---------|
| Marketing site | `web-site/` | `notefusion` | `notefusion.studio`, `www.notefusion.studio` |
| Legal / privacy pages | `docs/` | `notefusion-privacy` | `notefusion-privacy.vercel.app` |
| Admin dashboard | `web-admin/` | `web-admin` | `web-admin-blue-two.vercel.app` |

The API is separate — Heroku, see [DEPLOYMENT.md](DEPLOYMENT.md).

> **DNS lives at name.com**, not at Vercel: the zone's nameservers are `ns1psw`, `ns2dqx`,
> `ns3ckl`, `ns4cgs.name.com`. Vercel therefore cannot create records for you — every new
> hostname needs a record added by hand in the name.com dashboard. Existing records:
> the apex holds A records to Vercel's anycast IPs (`216.198.79.1`, `64.29.17.1`) and `www`
> is a CNAME to a `*.vercel-dns-017.com` target.

---

## Admin dashboard

The dashboard is a Vite SPA. It is **not** served from the API's `wwwroot`, so it runs on its
own origin and talks to Heroku cross-origin. Two things have to line up: the Vercel project and
the API's CORS allow-list.

### 1. Vercel project

`web-admin/` is linked to the `web-admin` project, whose production URL is
**`https://web-admin-blue-two.vercel.app`** — Vercel appended a random suffix because
`web-admin.vercel.app` was already taken globally. That suffix is stable for the life of the
project, and it is the origin the browser sends, so it is what the API must allow.

Deploy from inside `web-admin/` so the project root is that folder and `web-admin/vercel.json`
applies (SPA rewrites, `X-Robots-Tag: noindex`, immutable asset caching):

```bash
cd web-admin && vercel --prod
```

The build needs no dashboard configuration: `web-admin/.env.production` is committed and carries
`VITE_API_URL`. If the API ever moves, change that file rather than adding a Vercel env var, so a
clean clone keeps building a working bundle.

> - `vercel --prod` uploads the **working tree**, so uncommitted work ships.
> - `vercel link` writes a `web-admin/.gitignore` containing `.env*`. Narrow it if it comes back:
>   `.env.production` is committed on purpose. It also writes `.env.local` with a short-lived
>   OIDC token — the root `.gitignore` already covers that file.
> - The repo root also has a `vercel.json` pointing at `web-admin/dist`. It is a leftover from an
>   earlier attempt to deploy from the repo root and its build command cannot work (there is no
>   root `package.json`). Deploying from inside `web-admin` ignores it; it is safe to delete.

#### If the CLI reports a failed deploy

Deploys have come back `"readyState": "BLOCKED"`, or died mid-poll with `fetch failed` /
`terminated`, while `vercel ls` showed the deployment as `UNKNOWN` and `vercel inspect --logs`
returned no build logs at all. **No build log means no build error** — check the live URL before
believing the CLI. Two flags help: `--no-wait` returns as soon as the upload finishes instead of
holding a long-lived status stream, and `vercel build && vercel deploy --prebuilt --prod` moves
the build to your machine so the platform only has to accept files.

### 2. A custom subdomain (`admin.notefusion.studio`) — not live yet

`admin.notefusion.studio` is already assigned to the **`notefusion-web`** project (a second
project also rooted at `web-admin`, connected to `main`). It does not resolve: the zone has no
`admin` record, so the name is NXDOMAIN. To finish it, add one record at name.com to the
`notefusion.studio` zone — this is what Vercel asks for on this domain:

| Type | Host | Answer | TTL |
|------|------|--------|-----|
| A | `admin` | `76.76.21.21` | 300 |

Then confirm Vercel sees it:

```bash
cd web-admin && vercel domains inspect admin.notefusion.studio
```

Note the split before doing this: the domain is on `notefusion-web` while the live dashboard is
the `web-admin` project. Decide which project owns the dashboard and move the domain to it —
serving one app from two projects means two different bundles can go live independently.

### 3. API CORS

The API allows origins explicitly and **fails closed** — an origin that is not listed gets no
`Access-Control-Allow-Origin` header and the browser blocks the call. Each origin is in two
places:

- compiled into `src/NoteFusion.Api/Program.cs`, which needs an API redeploy to take effect;
- and as a Heroku config var, which takes effect on the dyno restart `config:set` performs —
  no image rebuild.

Currently set on `notefusion-api`: `Cors__AllowedOrigins__0` … `__5` = the two localhost dev
origins, `https://notefusion.studio`, `https://admin.notefusion.studio`,
`https://notefusion-web.vercel.app`, `https://web-admin-blue-two.vercel.app`. To add another,
use the next free index — never reuse one, and check first, because a gap leaves a null in the
bound array:

```bash
heroku config:get Cors__AllowedOrigins__6 --app notefusion-api
```

Do not run bare `heroku config` — it dumps every secret the app holds. Use `config:get` per key.

### Checks after going live

Confirm the bundle points at the API it should:

```bash
curl -s https://web-admin-blue-two.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

Confirm the API accepts the origin. A `204` **with** an `Access-Control-Allow-Origin` line is a
pass; a `204` with no such header is the failure mode, and it looks like a statusless network
error in the browser console:

```bash
curl -s -i -X OPTIONS https://notefusion-api-3c2513a1e974.herokuapp.com/api/auth/login -H 'Origin: https://web-admin-blue-two.vercel.app' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type'
```

Also worth checking, because CORS can pass while the route is wrong: the dashboard's real
analytics paths are `/api/admin/analytics/overview` and `/api/admin/analytics/users` (note the
`admin` segment). Unauthenticated they answer `401` with `WWW-Authenticate: Bearer`. A `404`
means the path is wrong, not that auth failed.

Finally, a deep link such as `https://web-admin-blue-two.vercel.app/users` must return `200`,
not `404` — that is the SPA rewrite doing its job.
