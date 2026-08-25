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
| `Bachs__ProductMap__<plan_code>` | **only for recurring plans** | Our plan code → Bachs catalog product id. Recurrence comes from the product's `billing_cycle`, and that is immutable, so **monthly and yearly are two separate products**. Each product's catalog price must equal the plan price in `BillingSeeder`; a drift is caught at verification and blocks fulfilment rather than granting a subscription for the wrong money. The shipped USD tier (`pro_lifetime_v2`) is a one-off, so it needs no entry — leave the map empty unless USD subscriptions are reinstated. |
| `Bachs__SupportedCurrencies` | optional | Comma-separated ISO-4217. Defaults to `USD`. |
| `Bachs__WebhookToleranceSeconds` | optional | Replay window for the signature timestamp, two-sided. Defaults to `300`. |
| `Bachs__CheckoutExpiryMinutes` | optional | 1–1440. Defaults to `60`, matching Bachs' own default. |

```bash
heroku config:set \
  Bachs__SecretKey='sk_live_xxx' \
  Bachs__BaseUrl='https://api.bachs.io' \
  Bachs__WebhookSecret='whsec_xxx' \
  Bachs__SupportedCurrencies='USD' \
  --app <your-heroku-app>
# Only if a recurring USD plan is reinstated — the lifetime tier needs no product:
# heroku config:set Bachs__ProductMap__pro_monthly='prod_xxx' --app <your-heroku-app>
```

Configuring Bachs does **not** by itself route checkouts through it — both live providers
support USD, and the factory prefers `Billing__DefaultProvider`. To send USD traffic to
Bachs, set that too (see the table at the end of this section):

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

**Point each provider's webhook at** `POST https://<your-heroku-app>.herokuapp.com/api/billing/webhooks/<provider>`
(e.g. `.../api/billing/webhooks/paystack`). The endpoint is anonymous by design —
providers authenticate by signature, not JWT.

**Non-secret billing knobs** (safe to commit; override only if the defaults don't fit):

| Var | Default | Notes |
|-----|---------|-------|
| `Billing__DefaultProvider` | `Paystack` | Provider chosen when a currency has more than one candidate. |
| `Billing__CheckoutCallbackUrl` | `notefusion://billing/return` | **Must be set for Bachs.** Where the provider returns the browser after checkout. Bachs rejects a non-http(s) `success_url` outright (`VALIDATION_ERROR success_url must use http:// or https:// scheme`), so the committed deep-link default fails every Bachs checkout — loudly, before anyone is charged. Point it at the API's own bridge page, which hands off to the app's deep link: `https://<your-heroku-app>.herokuapp.com/api/billing/return`. The real result still arrives via webhook. |

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

Mail is logged (not sent) until `Email__UseResend=true`, so a deploy without a key is
safe. To turn on real delivery:

```bash
heroku config:set \
  Email__UseResend='true' \
  Email__ApiKey='<resend-api-key>' \
  Email__FromAddress='no-reply@notefusion.studio' \
  Email__AssetBaseUrl='https://notefusion.studio' \
  --app <your-heroku-app>
```

| Var | Required? | Notes |
|-----|-----------|-------|
| `Email__UseResend` | **yes** | `true` to send via Resend; anything else keeps mail in the log. |
| `Email__ApiKey` | **yes, when UseResend=true** | Resend API key. Env-only — a key in `appsettings.json` is a key in git history. |
| `Email__FromAddress` | **strongly recommended** | Default `onboarding@resend.dev` is Resend's sandbox and **only delivers to the address that owns the key**. Point at your verified domain (`no-reply@notefusion.studio`) before real users receive mail. |
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
value below is set, uploads are logged rather than stored and the endpoint returns a placeholder
URL that does not resolve, so a deploy without a bucket is safe.

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
| `R2__UseR2` | **yes** | `true` to store uploads; anything else logs them and stores nothing. A half-configured deployment (flag on, value missing) also falls back to logging rather than failing every upload. |
| `R2__AccountId` | **yes, when UseR2=true** | Cloudflare account id. Also the S3 endpoint host: `https://<account-id>.r2.cloudflarestorage.com`. |
| `R2__AccessKeyId` | **yes, when UseR2=true** | From an R2 API token. Scope it **Object Read & Write** on this bucket only — nothing wider. |
| `R2__SecretAccessKey` | **yes, when UseR2=true** | The token secret, shown once at creation. Env-only — a key in `appsettings.json` is a key in git history. |
| `R2__BucketName` | **yes, when UseR2=true** | The bucket. |
| `R2__PublicBaseUrl` | **yes, when UseR2=true** | Origin the bucket is served from, no trailing slash. Required, not optional: without it the API would store the object and persist a URL nobody can fetch, which is worse than the logging fallback. |
| `R2__KeyPrefix` | optional | Key prefix. Defaults to `avatars`. |

**Making the bucket readable.** R2 buckets are private by default, and the API returns URLs the
app fetches directly, so the bucket needs public read access. Connect a **custom domain** under
the bucket's Settings → Public access; its zone must already be in the same Cloudflare account.
Two traps:

- Cloudflare documents the alternative `r2.dev` URL as rate-limited and "should only be used for
  development purposes" — it gets no caching and no WAF. Don't ship it.
- If you enable `r2.dev` *and* a custom domain, requests can reach the bucket by the `r2.dev`
  hostname and **bypass** the WAF and Access rules on your custom domain. Turn `r2.dev` off.

> Uploads are capped at 5 MB and limited to JPEG/PNG/WebP at the controller, then centre-cropped
> and re-encoded server-side to a single 512×512 JPEG per user, so replacing a photo overwrites
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

The Python ML worker is a **separate service** from the API. It runs on **Railway**, and it
needs exactly one web process:

```bash
railway variable set WEB_CONCURRENCY=1 --service notefusion-transcriber
```

On Heroku, where it ran previously and where `deploy-heroku.ps1` still targets it, the same
setting is:

```bash
heroku config:set WEB_CONCURRENCY=1 --app <your-transcriber-app>
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

### Deploying the transcriber to Railway

The service builds from `server/Dockerfile`. Railway's CLI has no `--root-directory` flag, so
the deploy is driven from inside `server/` rather than from a GitHub connection — which also
means **pushing to GitHub does not deploy it**; this command does:

```bash
cd server && railway up --ci --service notefusion-transcriber
```

Root Directory is only settable in the dashboard. Set it to `server/` there if you want
push-to-deploy, which is what the `watchPatterns = ["server/**"]` in `railway.toml` is for.

Current wiring, which is what makes the worker reachable at all — clients never call it
directly, so only the C# API needs its URL:

| | |
|---|---|
| Transcriber (Railway) | `https://notefusion-transcriber-production-76ad.up.railway.app` |
| C# API (Heroku) | `https://notefusion-api-3c2513a1e974.herokuapp.com` |
| The link | `TranscriptionApi__BaseUrl` on the API, set to the Railway URL above |

```bash
heroku config:set TranscriptionApi__BaseUrl=https://notefusion-transcriber-production-76ad.up.railway.app -a notefusion-api
```

## Verify

```bash
heroku config --app <your-heroku-app>          # names only; review before/after
heroku logs --tail --app <your-heroku-app>      # watch the seeder + provider wiring on boot
```
