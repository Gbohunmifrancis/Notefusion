# Deploying the API on Heroku — environment variables

The backend image runs unchanged from dev to prod; only environment variables differ
(see [CLAUDE.md](../CLAUDE.md) → "Config is env-driven"). .NET reads nested keys with a
double underscore, so `Paystack:SecretKey` in `appsettings.json` becomes `Paystack__SecretKey`
as a Heroku config var. Heroku config-var names are case-sensitive — copy them **exactly**.

Set one with:

```bash
heroku config:set Paystack__SecretKey='sk_live_xxx' --app <your-heroku-app>
```

> **Secrets never live in git.** Everything below is deliberately left out of
> `appsettings.json` (the committed defaults are blank/false). Set the real values only
> through `heroku config:set`. Any key that was pasted into a chat, terminal history, or
> a screenshot is considered compromised — **rotate it in the provider dashboard and set
> the fresh value here.** All values shown are placeholders, not real credentials.

---

## 1. Payment providers

Four providers are wired in the code (`Paystack`, `Flutterwave`, `Squad`, `Bachs`). Each
binds from its own section, so the var prefix is the provider name:

| Var | Required? | Notes |
|-----|-----------|-------|
| `<Provider>__SecretKey` | **yes, to go live** | Server-side secret key. Also the webhook HMAC key unless overridden below. A provider with no secret key stays disabled — it cannot half-charge. |
| `<Provider>__BaseUrl` | **yes, to go live** | Provider REST base, e.g. `https://api.paystack.co`. |
| `<Provider>__WebhookSecret` | optional | Only if the provider signs webhooks with a value different from the secret key. Defaults to `SecretKey`. |
| `<Provider>__SupportedCurrencies` | optional | Comma-separated ISO-4217, e.g. `USD,NGN`. Defaults to `USD`. |

> **Paystack and Bachs have live adapters; `Flutterwave` and `Squad` register as stubs**
> regardless of config until their gateway adapters are implemented — setting their keys
> now is forward-looking and will not start charging through them yet. Bachs binds from a
> section of its own shape (§1.1), not from the generic table above.

**Paystack:**

```bash
heroku config:set \
  Paystack__SecretKey='sk_live_xxx' \
  Paystack__BaseUrl='https://api.paystack.co' \
  Paystack__SupportedCurrencies='NGN' \
  --app <your-heroku-app>
# Optional, only if Paystack's webhook signing secret differs from the secret key:
# heroku config:set Paystack__WebhookSecret='whsec_xxx' --app <your-heroku-app>
```

> **`NGN` only, deliberately.** This integration has never been enabled for USD, so declaring
> `USD,NGN` would advertise a currency it cannot collect. Nothing routes USD here today — Bachs
> takes it — but the factory falls back to any provider that claims the currency, so an
> over-broad list is a trap that springs only once the Bachs config is removed or expires.

**Flutterwave / Squad (placeholders for when each adapter lands):**

```bash
heroku config:set Flutterwave__SecretKey='...' Flutterwave__BaseUrl='https://api.flutterwave.com/v3' --app <your-heroku-app>
heroku config:set Squad__SecretKey='...'        Squad__BaseUrl='https://api-d.squadco.com'          --app <your-heroku-app>
```

### 1.1 Bachs

Bachs needs more than a key and a URL, so it has its own section and its own required set.
**All three of `SecretKey`, `BaseUrl` and `WebhookSecret` must be present or the adapter
stays a stub** — a deployment missing the signing secret could take payments it can never
verify. `ProductMap` is required only for *recurring* plans: a product exists to carry a
`billing_cycle`, and the lifetime tier is a one-off charge that never consults the map. So
a Bachs deployment selling only lifetime needs no map at all, which is why the adapter no
longer gates on one.

| Var | Required? | Notes |
|-----|-----------|-------|
| `Bachs__SecretKey` | **yes** | `sk_sandbox_…` or `sk_live_…`. Sent as `Authorization: Bearer`. |
| `Bachs__BaseUrl` | **yes** | `https://sandbox-api.bachs.io` or `https://api.bachs.io`. There is no version header — going live is a key swap **and** a host swap. |
| `Bachs__WebhookSecret` | **yes** | The endpoint's `whsec_…` **signing secret**, which is a different credential from the API key and differs between sandbox and live. Copy it from the webhook endpoint in the Bachs dashboard; it is not retrievable via the API. Never set the API key here — a wrong key makes genuine and forged deliveries indistinguishable. |
| `Bachs__ProductMap__<plan_code>` | **yes, for both USD plans** | Our plan code → Bachs catalog product id: `Bachs__ProductMap__pro_monthly_usd` and `Bachs__ProductMap__pro_yearly_usd` (a bare `pro_monthly` / `pro_yearly` key is honoured as a fallback). Recurrence comes from the product's `billing_cycle`, and that is immutable, so **monthly and yearly are two separate products**. Each product's catalog price must equal the plan price in `BillingSeeder` ($9.99 and $79, billed in USD); a drift is caught at verification and blocks fulfilment rather than granting a subscription for the wrong money. The API logs `Billing is not ready` at startup for any USD plan with no product mapped. |
| `Bachs__SupportedCurrencies` | optional | Comma-separated ISO-4217. Defaults to `USD`. |
| `Bachs__WebhookToleranceSeconds` | optional | Replay window for the signature timestamp, two-sided. Defaults to `300`. |
| `Bachs__CheckoutExpiryMinutes` | optional | 1–1440. Defaults to `60`, matching Bachs' own default. |

```bash
heroku config:set \
  Bachs__SecretKey='sk_live_xxx' \
  Bachs__BaseUrl='https://api.bachs.io' \
  Bachs__WebhookSecret='whsec_xxx' \
  Bachs__SupportedCurrencies='USD' \
  Bachs__ProductMap__pro_monthly_usd='prod_xxx' \
  Bachs__ProductMap__pro_yearly_usd='prod_yyy' \
  --app <your-heroku-app>
```

**The billing model.** Nigerian accounts subscribe in naira through Paystack
(`Paystack__SupportedCurrencies='NGN'`); everyone else subscribes in dollars through Bachs
(`Bachs__SupportedCurrencies='USD'`). Currency routes the charge, so the two lists must not
overlap; `Billing__DefaultProvider='Bachs'` only breaks a tie if they ever do. On the EC2
deploy these are written to `.env` by `.github/workflows/deploy.yml` from the GitHub secrets
of the same names, and `docker-compose.prod.yml` defaults the base URLs and currency lists so a
missing secret cannot silently turn a provider into a stub. Before the dollar tier goes on sale,
confirm in the Bachs dashboard that the account can bill **USD cards on a schedule**
(`USD_CARD` enabled): Bachs subscriptions are card-only, and the catalog products must be priced
in USD at $9.99 and $79.

Configuring Bachs does **not** by itself route checkouts through it if Paystack also lists USD —
the factory prefers `Billing__DefaultProvider`. To send USD traffic to Bachs, set that too (see
the table at the end of this section):

```bash
heroku config:set Billing__DefaultProvider='Bachs' --app <your-heroku-app>
```

**Creating the catalog products** — *only if a recurring USD plan is reinstated.* The shipped
USD tier is a lifetime one-off, which carries its amount on the checkout itself and needs no
catalog entry. For a recurring plan, `ProductMap` needs `prod_…` ids, and a fresh Bachs
account's catalog is empty, so the product has to exist before the map can point at it. Bachs
publishes no OpenAPI document and `docs.bachs.io` refuses unauthenticated fetches, so the
request shape is recorded here — `price` and `billing_cycle` are objects, not scalars, and
`interval` must be one of `day`, `week`, `month`, `year`:

```bash
curl -X POST https://api.bachs.io/v1/products \
  -H "Authorization: Bearer $BACHS_SECRET_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"NoteFusion Pro (Monthly)",
       "price":{"currency":"USD","amount":"4.99"},
       "billing_cycle":{"interval":"month","frequency":1}}'
```

The yearly product is the same call with `"amount":"49.90"` and `"interval":"year"`. Prices
are decimal strings in major units and **must** equal the `BillingSeeder` plan price, since
`BillingSeeder` is insert-only — it never revisits a plan row, so changing a price there
does nothing to an existing deployment and the drift surfaces only as a blocked
fulfilment. Omitting `price.amount` is rejected (`amount is required for a fixed price`)
rather than defaulting to zero, so a malformed call cannot create a free product.

In the Bachs dashboard subscribe the webhook endpoint to `collection.succeeded` (the
fulfilment signal) and `checkout.expired` (so an abandoned session is closed out rather than
left for the reconciliation worker). **Subscriptions** need enabling there only for a
recurring plan — a subscription checkout is otherwise rejected with `SUBSCRIPTIONS_NOT_ENABLED`
(403), which is exactly the wall the lifetime tier exists to route around
(`docs/geo-billing-plan.md`).

> Two known gaps, both fail-safe rather than fail-open:
>
> - **`collection.failed` is not worth subscribing yet.** A declined payment leaves the
>   session `open`, which is not a terminal Bachs state, so the event has no verified
>   outcome to record: it would retry and park as `Failed` in the inbox. Nothing is
>   fulfilled either way, and the reconciliation worker closes the transaction out.
> - **Subscription renewals (`invoice.paid`) are not fulfilled yet.** That event carries no
>   reference of any kind and can only be correlated by subscription id, which the webhook
>   handler does not do. Renewals will park as `Failed` in the inbox. First-cycle checkouts
>   are unaffected.
>
> A log line reading `disagrees with its own charge about the amount` (or `the currency`)
> means the checkout session and the charge inside it reported two different figures. Bachs'
> own API docs show that pair disagreeing, so the adapter refuses to pick one: verification
> is treated as unresolved, the transaction stays `Processing`, and nothing is fulfilled.
> Check the session in the Bachs dashboard and reconcile it by hand — retrying will not
> clear it, because the provider will keep returning the same two numbers.

**Point each provider's webhook at** `POST https://api.notefusion.studio/api/billing/webhooks/<provider>`
(e.g. `.../api/billing/webhooks/paystack`). The endpoint is anonymous by design —
providers authenticate by signature, not JWT.

**Non-secret billing knobs** (safe to commit; override only if the defaults don't fit):

| Var | Default | Notes |
|-----|---------|-------|
| `Billing__DefaultProvider` | `Paystack` | Provider chosen when a currency has more than one candidate. |
| `Billing__CheckoutCallbackUrl` | `https://api.notefusion.studio/api/billing/return` | Where the provider returns the browser after checkout: the API's own bridge page, which hands off to the app's deep link (website checkouts use the same path plus `/web`, which returns to `notefusion.studio/app?paid=1`). Must be an absolute https URL; Bachs refuses anything else. Blank, or a retired `herokuapp.com` host, falls back to the default. The real result still arrives via webhook, and the clients also ask `POST /api/billing/confirm`. |

### 1.2 Region pricing (geolocation)

Which tier a user is offered follows the country stored on their row, resolved once from the
forwarded request address at sign-up — or on the next sign-in, for an account created before
countries existed. [docs/geo-billing-plan.md](geo-billing-plan.md) explains why the split exists.

| Var | Default | Notes |
|-----|---------|-------|
| `Geo__LookupUrl` | `https://get.geojs.io/v1/ip/country/{ip}` | Must answer with the bare two-letter country code as **plain text**; `{ip}` is substituted. An empty string switches resolution off — then nobody has a country and everybody is offered every tier. |
| `Geo__TrustedProxyHops` | `1` | How many proxies append to `X-Forwarded-For`. One is correct behind Heroku's router. |

> **Do not point this at ipapi.co, even though its `/{ip}/country/` fits the contract exactly.**
> Its free tier is metered per calling address, and a dyno shares one egress address with every
> other tenant on the host — so it answered this app's very first production lookup with HTTP 429.
> Nothing breaks when a lookup fails (the user keeps a null country and is offered every tier),
> which is exactly why a provider change should be followed by a look for
> `Geo lookup for … returned` in the log rather than by waiting for someone to complain about
> their price.

> **Setting `TrustedProxyHops` too high is the dangerous direction.** Heroku's router *appends*
> the address it observed, so the trustworthy entry is counted from the right-hand end of the
> chain. Raising the count walks the read leftwards into the part of the header the caller wrote,
> which lets a caller pick the country — and therefore the price — they are quoted.

---

## 2. Google sign-in

The API only needs the OAuth **Client ID** (it validates Google ID tokens against it as
the expected audience — there is no client secret on the API side):

```bash
heroku config:set Google__ClientId='<google-oauth-client-id>.apps.googleusercontent.com' --app <your-heroku-app>
```

Use the **web** client ID here. The Android app deliberately asks Google for a token
audienced to the server rather than to itself, so the web client is the audience on
Android. Add a second variable only once the app ships on iOS, whose SDK audiences to
the iOS client instead:

```bash
heroku config:set Google__IosClientId='<ios-oauth-client-id>.apps.googleusercontent.com' --app <your-heroku-app>
```

Both are accepted when both are set; an unset one is simply not a valid audience.

> The mobile app carries its own Google client id in `mobile/app.json` → `expo.extra`;
> that is a separate, client-side value and is not a Heroku secret.
>
> Google sign-in is native-SDK based and therefore **cannot work in Expo Go** — the
> buttons hide themselves there. Use a development or production build.

**The Android OAuth client must list two SHA-1 fingerprints, not one.** Google matches an
Android client by package name plus signing certificate, and this app is enrolled in Play App
Signing — so the certificate depends on how the app was installed:

| Install route | Certificate presented | Where to find its SHA-1 |
|---|---|---|
| Sideload (any EAS `.apk`, `expo run:android`) | your **upload** key | Play Console → Test and release → Setup → App signing → *Upload key certificate* |
| Google Play | Google's **app signing** key | the *App signing key certificate* block on the same page |

Register **both** on the same Android OAuth client. Registering only the upload key is the
trap: sign-in then works on every build you test by hand and fails with `DEVELOPER_ERROR`
(code 10) for every user who installs from the store. A local debug keystore needs its own
entry too — `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey
-storepass android`.

> **Check which GCP project you are in.** An OAuth client id is prefixed with the project
> *number* that owns it, so `21738378819-…` means those clients live in project `21738378819`.
> Register the fingerprints there. Adding them to a different project is silent: nothing
> errors, sign-in just keeps failing. The Play publishing service account
> ([DEPLOYMENT_MOBILE.md](DEPLOYMENT_MOBILE.md)) should live in this same project, so that
> auth and releases share one identity boundary.


---

## 3. Email (Resend)

One secret is the whole setup: the repository's existing **`RESEND__APIKEY`** GitHub Actions
secret (or a new `RESEND_API_KEY`) is written into the container as `Email__ApiKey`, and the next
deploy delivers mail as `NoteFusion <no-reply@notefusion.studio>` (or as `RESEND__FROM` when that
secret is set).
Without a key, mail is logged, not sent, so a deploy without one is safe. The API logs one line
at startup saying which of the two it is doing (`EmailReadiness`).

The domain must be verified in Resend (Domains → notefusion.studio, with its DNS records) for
mail to reach anyone; a key alone with an unverified domain is refused by Resend on every send,
and the refusal is in the API log as a warning.

| Var | Required? | Notes |
|-----|-----------|-------|
| `RESEND__APIKEY` / `RESEND_API_KEY` | **yes** | Resend API key; the deploy writes either as `Email__ApiKey`, and the app also reads `Resend__ApiKey`. Env-only — a key in `appsettings.json` is a key in git history. |
| `RESEND__FROM` | optional | Sender address override, read when `Email__FromAddress` is unset. |
| `Email__UseResend` | optional | Delivery turns on by itself when a key is present; set `false` to keep a keyed environment in the log. |
| `Email__FromAddress` | optional | Defaults to `no-reply@notefusion.studio`. Resend's sandbox `onboarding@resend.dev` needs no DNS but **only delivers to the address that owns the key** (dev only). |
| `Email__AssetBaseUrl` | recommended | Public origin the branded email fetches its logo from (`/email/logo.png`). **Point this at the marketing site, `https://notefusion.studio`** — the file lives in `web-site/email/`. It used to be the API's own URL, back when the API served the dashboard bundle out of `wwwroot`; nothing lands in `wwwroot` any more, so a Heroku URL here now yields a broken image. Unset falls back to a raw GitHub URL for the mobile icon. |
| `Email__FromName` | optional | Sender display name. Defaults to `NoteFusion`. |
| `Email__ReplyTo` | optional | Where replies land. Committed default is `hello@notefusion.studio`. |
| `Email__SupportEmail` | optional | Shown in the footer. Defaults to `hello@notefusion.studio`. |
| `Email__AppUrl` | optional | Marketing-site link in the footer/header. Defaults to `https://notefusion.studio`. |

> **Rotate the Resend key that was shared during development before using it** — treat it
> as burned. Create a new key in the Resend dashboard and set only that value above.

---

## 4. Profile pictures (Cloudflare R2)

Avatar uploads are proxied through the API — `POST /api/me/picture` — so the signing secret
stays on the server and never ships inside the app binary. Until `R2__UseR2=true` *and* every
value below is set, uploads are refused: the endpoint answers 400 `USER_PICTURE_STORAGE_UNAVAILABLE` (a plain sentence the apps show as is)
("Photo uploads aren't available right now. Please try again later.") and the user's existing
photo, a Google one included, is left as it was. A deploy without a bucket is safe. The API logs
one line at startup saying where photos go, or warning that uploads are off (`MediaReadiness`).

On the EC2 stack the deploy workflow writes the `R2__*` values into `.env` and
`docker-compose.prod.yml` passes them to the `api` service (`R2__UseR2` defaults to `false` there).
Before that pass-through existed the API never saw them, and uploads were "saved" as dead
`https://images.invalid/...` URLs; the `RepairDeadProfilePictures` migration clears those, and a
Google account gets its Google photo back on its next sign-in.

```bash
heroku config:set \
  R2__UseR2='true' \
  R2__AccountId='<cloudflare-account-id>' \
  R2__AccessKeyId='<r2-access-key-id>' \
  R2__SecretAccessKey='<r2-secret-access-key>' \
  R2__BucketName='<bucket>' \
  R2__PublicBaseUrl='https://<your-custom-domain>' \
  --app <your-heroku-app>
```

| Var | Required? | Notes |
|-----|-----------|-------|
| `R2__UseR2` | **yes** | `true` (or `1` / `yes`, any case) to store uploads; anything else, blank included, turns uploads off. Read by hand, so a blank or misspelled value can never stop the API from starting. A half-configured deployment (flag on, value missing) also turns uploads off rather than failing each one against a bucket it cannot reach. |
| `R2__AccountId` | **yes, when UseR2=true** | Cloudflare account id. Also the S3 endpoint host: `https://<account-id>.r2.cloudflarestorage.com`. |
| `R2__AccessKeyId` | **yes, when UseR2=true** | From an R2 API token. Scope it **Object Read & Write** on this bucket only — nothing wider. |
| `R2__SecretAccessKey` | **yes, when UseR2=true** | The token secret, shown once at creation. Env-only — a key in `appsettings.json` is a key in git history. |
| `R2__BucketName` | **yes, when UseR2=true** | The bucket. |
| `R2__PublicBaseUrl` | **yes, when UseR2=true** | Origin the bucket is served from, no trailing slash. Required, not optional: without it the API would store the object and persist a URL nobody can fetch, which is worse than refusing the upload. |
| `R2__KeyPrefix` | optional | Key prefix. Defaults to `avatars`. |

**Making the bucket readable.** R2 buckets are private by default, and the API returns URLs the
app fetches directly, so the bucket needs public read access. Connect a **custom domain** under
the bucket's Settings → Public access; its zone must already be in the same Cloudflare account.
Two traps:

- Cloudflare documents the alternative `r2.dev` URL as rate-limited and "should only be used for
  development purposes" — it gets no caching and no WAF. Don't ship it.
- If you enable `r2.dev` *and* a custom domain, requests can reach the bucket by the `r2.dev`
  hostname and **bypass** the WAF and Access rules on your custom domain. Turn `r2.dev` off.

> Uploads are capped at 5 MB and limited to JPEG/PNG/WebP at the controller, then turned upright
> by their EXIF orientation, centre-cropped and re-encoded server-side (transparency on white) to a
> single 512×512 JPEG per user, so replacing a photo overwrites
> the old one instead of accumulating orphans. R2 has no cache purge, so the persisted URL carries
> a `?v=<timestamp>` stamp — that, not invalidation, is what makes a replacement appear at once.
> Face-aware cropping does not exist in R2; the client crops square before uploading instead.

---

## 5. Already required (for reference — do not echo their values)

These are set as part of standing up the app and are listed so the checklist is complete;
they are not part of this task and should not be printed back:

- `DATABASE_URL` — provisioned by the Heroku Postgres add-on.
- `ASPNETCORE_ENVIRONMENT` — `Production` on Heroku.
- `Jwt__*`, `Cors__AllowedOrigins__0` (the admin dashboard origin), `TranscriptionApi__BaseUrl`
  (the internal ML worker), and the `Seed__*` admin bootstrap.

## 6. The transcriber service — `WEB_CONCURRENCY=1` is not optional

The Python ML worker is a **separate service** from the API. It runs on **Heroku**
(`notefusion-transcriber`), and it needs exactly one web process:

```bash
heroku config:set WEB_CONCURRENCY=1 --app notefusion-transcriber
```

On Railway, which the worker was briefly pointed at and which still stands by with the same
code, the same setting is:

```bash
railway variable set WEB_CONCURRENCY=1 --service notefusion-transcriber
```

`JobQueue` keeps its jobs in a plain in-process dict (`server/app/jobs/queue.py`), so each
uvicorn worker process has its own. `POST /v1/transcribe` lands the job in whichever process
the router picked, and the client's `GET /v1/jobs/{id}` polls are spread across all of them —
so with *N* workers, (N−1)/N of the polls hit a process that has never heard of that job and
answer **404**. Heroku's default `WEB_CONCURRENCY` is derived from dyno memory rather than
from anything this app knows, which is how the setting goes missing: it looks like a
performance knob and is actually a correctness one. Measured on the deployed app before it
was set, roughly 70% of polls 404'd and a transcription that had in fact succeeded looked to
the mobile client like a job that vanished.

Parallelism inside the one process is `NF_INFERENCE_WORKERS` (default 1, deliberately — see
`pyin_max_seconds` in `server/app/config.py` for the latency budget that assumes it). That is
the knob to reach for, not `WEB_CONCURRENCY`.

On Railway the same constraint is pinned as `numReplicas = 1` in `server/railway.toml`, and
scaling replicas there is a one-click change in the dashboard — which is exactly how this
regresses. Raising it needs `JobQueue` moved to a shared store (Redis/Postgres) first.

### Deploying the transcriber to Heroku

`notefusion-transcriber` is a **buildpack** app on `heroku-24` — `heroku/python` behind
`heroku-buildpack-apt`, which installs `server/Aptfile` (ffmpeg, libsndfile1, libpulse0). It
does **not** build `server/Dockerfile`, and the root `heroku.yml` names the *API's* Dockerfile,
so a plain `git push heroku HEAD:main` would build the wrong image into it. Push the `server/`
subtree instead, so `requirements.txt`, `runtime.txt`, `Procfile` and `Aptfile` land at the root
of what Heroku sees:

```bash
git push heroku "$(git subtree split --prefix=server HEAD)":main
```

The split is deterministic, so the SHA it prints doubles as the check on whether a deploy is
needed at all: if it already matches the current release's `Deploy <sha>`, the worker is current.

> `deploy-heroku.ps1` drives this same app through the Docker registry instead
> (`heroku stack:set container` + `container:release`). That route works too, but it switches the
> app's stack — so the two are not interchangeable mid-flight. Pick one and stay on it.

### Deploying the transcriber to Railway (standby)

The Railway service builds from `server/Dockerfile`. Railway's CLI has no `--root-directory`
flag, so the deploy is driven from inside `server/` rather than from a GitHub connection — which
also means **pushing to GitHub does not deploy it**; this command does:

```bash
cd server && railway up --ci --service notefusion-transcriber
```

Root Directory is only settable in the dashboard. Set it to `server/` there if you want
push-to-deploy, which is what the `watchPatterns = ["server/**"]` in `railway.toml` is for.

> Watch the output for `no changes detected in watch paths, build will skip`. Run from inside
> `server/`, the upload root *is* `server`, so files arrive as `app/…` and `watchPatterns =
> ["server/**"]` matches nothing — the deploy exits 0 having built nothing. Upload from a parent
> directory that still contains `server/`, or clear the watch paths.

Current wiring, which is what makes the worker reachable at all — clients never call it
directly, so only the C# API needs its URL:

| | |
|---|---|
| Transcriber (Heroku) | `https://notefusion-transcriber-ef80c63d506f.herokuapp.com` |
| Transcriber (Railway, standby) | `https://notefusion-transcriber-production-76ad.up.railway.app` |
| C# API (Heroku) | `https://notefusion-api-3c2513a1e974.herokuapp.com` |
| The link | `TranscriptionApi__BaseUrl` on the API, set to the Heroku URL above |

```bash
heroku config:set TranscriptionApi__BaseUrl=https://notefusion-transcriber-ef80c63d506f.herokuapp.com -a notefusion-api
```

## Verify

```bash
heroku config --app <your-heroku-app>          # names only; review before/after
heroku logs --tail --app <your-heroku-app>      # watch the seeder + provider wiring on boot
```


## YouTube links ("YouTube is refusing automated downloads")

YouTube blocks anonymous downloads from datacenter addresses — every EC2 instance — with
"Sign in to confirm you're not a bot", often after only a handful of requests. Spotify and
Apple Music links are found on YouTube by title, artist and length, so when YouTube refuses,
every provider is affected. The worker has four layers against that, in order:

1. **A JavaScript runtime.** The image ships Deno and `yt-dlp[default]` (which brings
   `yt-dlp-ejs`) so yt-dlp can solve YouTube's player challenges. Nothing to configure.
2. **Proof-of-origin tokens.** The `bgutil-provider` service in `docker-compose.prod.yml`
   (`brainicism/bgutil-ytdlp-pot-provider`, no published port) mints the tokens YouTube asks
   datacenter clients for, and the `bgutil-ytdlp-pot-provider` plugin in the image fetches
   them. The transcriber's `NF_YTDLP_EXTRA_ARGS` defaults to
   `--extractor-args "youtubepot-bgutilhttp:base_url=http://bgutil-provider:4416"`. Keep the
   sidecar image tag and the plugin pin in `server/requirements.txt` on the same version.
   Setting `NF_YTDLP_EXTRA_ARGS` in `.env` *replaces* that default, so an override (a
   residential proxy: `--proxy http://user:pass@host:port`, the paid last resort) must
   repeat the `--extractor-args …` part to keep the tokens. Check the sidecar with
   `docker compose -f docker-compose.prod.yml logs bgutil-provider`. A token helps but does
   not guarantee getting past a bot check.
3. **Cookies of a signed-in account** (see below).
4. **The store's 30-second preview.** When YouTube still refuses, a Spotify link uses the
   preview on its track page, an Apple Music link the one from the iTunes lookup, and a
   YouTube link the iTunes preview of the same title and artist. The job then comes back
   `truncated`, with `source.preview = true` and the notice "Only a 30-second preview was
   available for this song." That covers anonymous previews (30 s) and nearly covers free
   ones (60 s); Pro full songs still need YouTube. Store previews are licensed for promoting
   the song, so keep the song's store link visible next to a preview result. A private or
   removed YouTube video never falls back to someone else's recording.

### Cookies

1. On a desktop browser signed in to a Google account (a throwaway one is sensible), export
   the YouTube cookies in Netscape `cookies.txt` format — the "Get cookies.txt LOCALLY"
   extension, or `yt-dlp --cookies-from-browser chrome --cookies cookies.txt
   "https://www.youtube.com/watch?v=dQw4w9WgXcQ"` on that machine, which writes the file.
   Export from a private window you then close, so the browser does not rotate the session
   the file holds.
2. Paste the file's contents into the repository secret `YTDLP_COOKIES`.
3. Redeploy (push to `main`, or run **Deploy to EC2** from the Actions tab). The deploy
   writes `/opt/notefusion/ytdlp-cookies.txt`, the compose file mounts it read-only into the
   transcriber, and `NF_YTDLP_COOKIES_FILE` points the worker at it. yt-dlp writes its
   cookie jar back on exit, so the worker hands each job a private copy and deletes it
   afterwards; the mounted file is never written.

**Rotation.** Cookies expire, and YouTube rotates or revokes them (sooner when the account
is used from a server). When link jobs start coming back as previews or with "This song
could not be fetched right now", export a fresh file, replace the `YTDLP_COOKIES` secret
and redeploy. Expect to do this every few weeks. Keep yt-dlp current too
(`server/requirements.txt` pins a minimum; the image is rebuilt on every deploy, so a
redeploy picks up a newer release).
