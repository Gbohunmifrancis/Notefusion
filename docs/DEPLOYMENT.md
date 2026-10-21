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

> **Paystack, Bachs and Flutterwave have live adapters; `Squad` registers as a stub**
> regardless of config until its adapter is implemented. Bachs binds from a section of its
> own shape (§1.1), not from the generic table above, and Flutterwave needs its secret hash
> as well (§1.2).

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

**Squad (placeholder for when its adapter lands):**

```bash
heroku config:set Squad__SecretKey='...' Squad__BaseUrl='https://api-d.squadco.com' --app <your-heroku-app>
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

### 1.2 Flutterwave (ready for dollars, off until switched)

Flutterwave Standard (`FlutterwavePaymentGateway`): a hosted page on `POST /v3/payments`, checked with
`GET /v3/transactions/verify_by_reference?tx_ref=<our reference>`. **Live only with all three of
`Flutterwave__SecretKey`, `Flutterwave__BaseUrl` and `Flutterwave__WebhookSecret`**; the secret hash never
falls back to the key. Live, it still takes nothing until it is the default provider: Bachs is registered
first and keeps dollars, Paystack keeps naira.

| Secret (GitHub) | Value |
|-----------------|-------|
| `FLUTTERWAVE__SECRETKEY` | Dashboard › Settings › API keys, the live secret key (`FLWSECK-…-X`). A `FLWSECK_TEST-…` key runs the same host in test mode. |
| `FLUTTERWAVE__WEBHOOKSECRET` | A value you make up (letters and digits) and type into Dashboard › Settings › Webhooks › Secret hash. Flutterwave sends it back in `verif-hash`. |
| `FLUTTERWAVE__BASEURL` | Optional; defaults to `https://api.flutterwave.com` (no `/v3`: the adapter adds it). |
| `FLUTTERWAVE__SUPPORTEDCURRENCIES` | Optional; defaults to `USD`. Keep naira off it: Paystack takes NGN. |

In the dashboard: Webhook URL `https://api.notefusion.studio/api/billing/webhooks/flutterwave`, with
"charge.completed" events on, and USD collection (international cards) enabled on the account. Redeploy.

**The switch** is one more secret, `BILLING__DEFAULTPROVIDER=Flutterwave`, and a redeploy; deleting it (or
setting `Bachs`) switches back. Checkouts already open stay with the provider that opened them.

How the adapter reads Flutterwave's answers:

- `successful` is paid; the amount is read in the currency's own decimals and must cover the price.
- Nothing else is final. Flutterwave keeps the page open after a declined card for another try, so `failed`
  is recorded as a declined attempt (the console's "Why checkouts end unpaid") and the row stays open; a page
  opened and never paid answers "No transaction was found", which reads as not paid yet. The page lives a day
  (`session_duration` 1440, Flutterwave's maximum), and the stale sweep closes what is still unpaid after that.
- Looked up by Flutterwave's own id, a transaction carrying another `tx_ref` is refused.

Before switching, pay once in test mode with a card that declines and then one that passes on the same page,
and check the row completes: Flutterwave does not document how a retry on one page is recorded.

### 1.3 Google Play Billing (the Android app)

The Android app sells only through Google Play (Play's payments policy; the website keeps its own checkout). The app
buys on Google's sheet and hands the purchase token to `POST /api/billing/google-play/purchases`; Google's real-time
developer notifications reach `POST /api/billing/google-play/notifications`. Both only name a token: the server reads
what it is worth from Google (`GooglePlaySync`), records each charged order as a completed payment (order id as the
reference, Google's order total as the amount), makes Pro or the choir end exactly when Google's access does
(renewal, cancellation, grace period, account hold, refund), and acknowledges the purchase (consumes a one-song one),
without which Google refunds it after three days. `GooglePlaySyncWorker` (15 min) catches anything missed. Without a
service account every purchase answers "try again" and stays safe with Google, and the app does not offer Google Play
at all: until `GooglePlay__ServiceAccountJson` is set (`GET /api/billing/google-play/status`) and Play sells the
products, Android keeps the website's checkout (Paystack, Bachs).

**Play Console › Monetize › Products** (prices per country as on the website: ₦ in Nigeria, the regional $ set in the
regional markets, standard $ elsewhere):

| Product id | Kind | Base plans |
|------------|------|------------|
| `pro` | Subscription, auto-renewing | `monthly`, `yearly` |
| `choir` | Subscription, auto-renewing | `monthly`, `yearly` |
| `one_song` | In-app (one-time) product | — |

**The service account** (reads purchases): Google Cloud › IAM › Service accounts › create one and a JSON key; enable the
"Google Play Android Developer API" for that project; Play Console › Users and permissions › invite its email with
**View financial data** and **Manage orders and subscriptions** for the app.

**Notifications**: Google Cloud › Pub/Sub › a topic (e.g. `play-billing`), with
`google-play-developer-notifications@system.gserviceaccount.com` as a Publisher on it; Play Console › Monetization
setup › Real-time developer notifications › that topic. Then a **push** subscription on the topic to
`https://api.notefusion.studio/api/billing/google-play/notifications` with **authentication enabled**: a service
account (e.g. `play-push@<project>.iam.gserviceaccount.com`) and the audience left as the endpoint URL. Send a test
notification from the Play Console; the API answers 204.

| Secret (GitHub) | Value |
|-----------------|-------|
| `GOOGLEPLAY__SERVICEACCOUNTJSON` | The JSON key on one line: `base64 -w0 key.json`. |
| `GOOGLEPLAY__PUSHSERVICEACCOUNT` | The push subscription's service account email. Without it every notification is refused (401) and only the app's own call and the sweep apply purchases. |
| `GOOGLEPLAY__PUSHAUDIENCE` | Optional; defaults to the endpoint URL above. |

Testing: add testers under Play Console › License testing (their purchases are free and renew every few minutes) and
install from an internal testing track.

### 1.4 Region pricing (geolocation)

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
| `Email__DailyLimit` / `EMAIL__DAILYLIMIT` | optional | The plan's cap for the last 24 hours. Defaults to `100` (Resend free). `0` = no daily cap. |
| `Email__WeeklyLimit` / `EMAIL__WEEKLYLIMIT` | optional | Cap for the last 7 days. Unset by default (no weekly cap). |
| `Email__MonthlyLimit` / `EMAIL__MONTHLYLIMIT` | optional | Cap for the last 31 days (Resend does not say which day its month starts, so 31 rolling days hold under either). Defaults to `3000`. `0` = no monthly cap. |
| `Email__PostalAddress` / `EMAIL__POSTALADDRESS` | set in production | One line: the company's postal address, the legal footer every seasonal offer email carries ("NoteFusion · {this}", §3.3). `docker-compose.prod.yml` defaults it to `651 N Broad Street, Middletown, DE 19709, USA`; the variable replaces it. Where it is blank (local runs) the console's preview and test show "[the company's postal address]" and **Send is refused** (`OFFER_POSTAL_ADDRESS_MISSING`). Not a secret, and only the offer emails show it. |
| `Email__OptionalShare` / `EMAIL__OPTIONALSHARE` | optional | Optional mail (welcome, waitlist, checkout reminder, failed-transcription tips, outreach, seasonal offers) goes only while every capped window is under this share of its cap, counting all mail; the rest is kept for verification codes, resets, receipts and security notices, which always send. Defaults to `0.6`. Held batch mail stays due for a later run. Sends are counted in `email_sends`; System Health shows the usage. |

> **Rotate the Resend key that was shared during development before using it** — treat it
> as burned. Create a new key in the Resend dashboard and set only that value above.

### 3.1 Outreach (the founder's customer-research emails)

A background job (`OutreachWorker`, hourly) writes to customers on the founder's behalf, once per
segment per account, ever: an unpaid checkout ("what stopped you?"), an active free user (a
10-minute chat), someone who transcribed once and went quiet ("did the sheet come out right?") and
someone who never transcribed ("was something in the way?"). Each is an email from
"Francis from NoteFusion" with `Reply-To` the founder's address, plus a one-line push when the
account has a registered device. At most one message per account a week, only 09:00–19:00 West
Africa Time, at most `BatchSize` accounts per run. Every send is a row in `outreach_messages`
(admin: `GET /api/admin/outreach`, and the dashboard's recent activity). Each email carries a
one-click unsubscribe link (`/api/email/unsubscribe?token=…`, signed with a key derived from the
JWT signing key, so there is nothing extra to set).

**Production needs nothing set by hand.** On the EC2 stack the deploy writes these defaults into
`.env` and `docker-compose.prod.yml` repeats them, so outreach is on, from Francis, replying to
`hello@notefusion.studio`. Any of them can be overridden by a GitHub Actions **repository variable**
or **secret** of the name in the first column (a variable wins over a secret). The code default for
`Outreach__Enabled` is `false`, so a local run, compose in dev and the tests never send.

| GitHub var/secret | Container var | Production default | Notes |
|-------------------|---------------|--------------------|-------|
| `OUTREACH_ENABLED` | `Outreach__Enabled` | `true` | Set `false` to stop all outreach. The API logs one line at startup saying whether outreach is on, and why not when it is off. |
| `OUTREACH_FOUNDER_NAME` | `Outreach__FounderName` | `Francis` | Who the emails are from and signed by. Blank turns outreach off. |
| `OUTREACH_REPLY_TO` | `Outreach__ReplyTo` | `hello@notefusion.studio` | Where replies land. Blank turns outreach off. |
| `OUTREACH_BATCH_SIZE` | `Outreach__BatchSize` | `5` | Most accounts written to per run (hourly, 10 sending hours: at most 50 a day), so a backlog trickles out and leaves the email quota room. |
| `OUTREACH_INTERVAL_MINUTES` | `Outreach__IntervalMinutes` | `60` | Minutes between runs. |
| — | `Outreach__ApiBaseUrl` | `https://api.notefusion.studio` | Public API origin the unsubscribe link points at (code default; not passed by the deploy). |

On Heroku (or anywhere without the deploy's defaults) set them yourself:

```bash
heroku config:set Outreach__Enabled='true' Outreach__FounderName='Francis' \
  Outreach__ReplyTo='hello@notefusion.studio' --app <your-heroku-app>
```

Push goes out through Expo in production (`Push__UseExpo` defaults to `true` in the prod compose and
the deploy; set the `PUSH__USEEXPO` secret to `false` to only log). With it off, every notification,
outreach included, is only logged, and outreach pushes are still recorded as sent.

### 3.2 The blog (Gemini drafts, publishing from the admin console)

Blog posts live in the database and are written, drafted and published in the admin console's
**Blog** section (full story in `docs/BLOG.md`). Two outside services are involved, both optional —
without either, that half is off and the console says so:

- **Gemini** drafts posts (on "Generate with Gemini", and twice a week on its own). Never publishes.
- **GitHub** runs the website's deploy workflow (`deploy-web.yml`, `workflow_dispatch` on `main`) when a
  post is published, unpublished, archived, edited while live, or goes live on its schedule. The
  workflow builds the blog from `GET /api/blog/published` and deploys it to Vercel.

| GitHub secret/var | Container var | Default | Notes |
|-------------------|---------------|---------|-------|
| `GEMINI_API_KEY` (secret, **already exists** — the old PR drafter used it) | `Gemini__ApiKey` | — | From [Google AI Studio](https://aistudio.google.com/apikey). Without it drafting is off. |
| `GEMINI_MODEL` (variable, optional) | `Gemini__Model` | `gemini-3.8-flash` | A Pro model drafts better and costs more. |
| `GEMINI_FALLBACK_MODELS` (variable, optional) | `Gemini__FallbackModels` | `gemini-flash-latest,gemini-flash-lite-latest` | Tried in order (two tries each) when the chosen model stays overloaded (429/5xx after five tries, 15/30/60/60 s apart) or its id is gone (404). `none` turns fallback off. Never used for a refused key. |
| — | `Gemini__MaxOutputTokens` | `16384` | Thinking tokens count against it. |
| `GH_DEPLOY_TOKEN` (secret, **new**) | `GitHub__Token` | — | A **fine-grained personal access token**: Resource owner = the repository's owner, Repository access = *Only select repositories* → this repository, Permissions → **Actions: Read and write** (Metadata: read is added automatically). Nothing else. Without it, published posts reach the site only at the next deploy of `web-site/`. |
| — (the deploy passes `github.repository`) | `GitHub__Repo` | `Gbohunmifrancis/Notefusion` | `owner/name`. |
| — | `GitHub__Workflow`, `GitHub__Ref` | `deploy-web.yml`, `main` | |
| `BLOG_AUTODRAFT_ENABLED` (variable) | `Blog__AutoDraftEnabled` | `true` | The twice-weekly drafts. Set `false` to stop them. |
| `BLOG_AUTODRAFT_DAYS` (variable) | `Blog__AutoDraftDays` | `Mon,Thu` | Day names, comma-separated; `none` for no days. |
| `BLOG_AUTODRAFT_TIME_UTC` (variable) | `Blog__AutoDraftTimeUtc` | `05:30` | 06:30 in Lagos. |
| `BLOG_AUTODRAFT_COUNT` (variable) | `Blog__AutoDraftCount` | `1` | Drafts per slot (1–10). |
| — | `Blog__SiteUrl` | `https://notefusion.studio` | Where the API reads `/blog/catalogue.json` (the hymns and pages posts are checked against). |
| `BLOG_API_URL` (variable, read by `deploy-web.yml`) | — | `https://api.notefusion.studio` | Where the website's build reads the posts. |

The website's deploy fails (and the live site stays as it was) if it cannot read the posts from the
API within 15 minutes, so a site without its blog is never published.

On Heroku: `heroku config:set Gemini__ApiKey='…' GitHub__Token='github_pat_…' --app <your-heroku-app>`.

---

### 3.3 Seasonal offers (Operations › Offers)

An offer is a lower Pro price for a few days (Halloween, Christmas): 30% off Pro Monthly and Pro Yearly on the dollar
plans (standard and regional; never naira, choir or one song), rounded down, from its start until midnight at the end of
its last day in each person's own time zone (the UK's when unknown). The web app and the website's pricing read it at
`GET /api/offers/current`, and the checkout charges it when sent `offerKey` (the payment row keeps the offer's id). An
admin creates, switches on, previews, tests and sends it in the console (`/api/admin/offers`, Admins only, behind the
console lock; switching on and Send want a fresh unlock; every change is in the Audit Log). One enabled offer at a time.

The email is optional mail (`EmailKind.Offer`), so it waits on the same quota as outreach (§3, `Email__OptionalShare`):
Send queues everyone at once (`offer_emails`), and `OfferEmailWorker` sends every 5 minutes, 09:00–19:00 in each person's
own time, lapsed Pro first, then free accounts by last seen, then Pro members if ticked; nobody is sent it after their
own end, or after buying, becoming Pro or turning email off. On Resend's free plan (100 a day) that is about 57 a day:
move Resend to its paid plan and raise `Email__DailyLimit` (e.g. `1000`) and `Email__MonthlyLimit` (e.g. `50000`) before
sending to a large audience; the console reads the new limits at once. Unsubscribing uses the founder's notes' own
switch and link ("Notes and offers from NoteFusion").

| GitHub var/secret | Container var | Default | Notes |
|-------------------|---------------|---------|-------|
| `EMAIL__POSTALADDRESS` | `Email__PostalAddress` | `651 N Broad Street, Middletown, DE 19709, USA` (compose) | Set it only to change the address (see §3). |
| `OFFERS_ENABLED` | `Offers__Enabled` | `true` (compose and code) | `false` stops the offer email worker (queued emails wait); prices on the web still follow an enabled offer. The API logs a line at startup when it is off. |
| — | `Offers__BatchSize` | `200` | Most offer emails one run sends (code default). |
| — | `Offers__IntervalMinutes` | `5` | Minutes between runs (code default). |

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
"Sign in to confirm you're not a bot", rate limits them ("This content isn't available, try
again later"), withholds formats from clients that bring no proof-of-origin (PO) token, and
changes its player every few weeks so that an outdated yt-dlp stops working. Spotify and Apple
Music links are found on YouTube by title, artist and length, so when YouTube refuses, every
provider is affected. **The address is the root cause**, and no setting makes a datacenter
address look like a home connection; what follows makes the worker get through as often as it
can and fail plainly when it cannot.

**Terms.** Downloading from YouTube other than through its player is against YouTube's Terms of
Service, whatever tool or proxy does it. NoteFusion fetches only the section a user asks for,
audio only, and deletes it with the job; that limits what is taken but does not make it
permitted. The store-preview fallback (layer 6) is the licensed route.

The worker's layers, in order:

1. **Always-current yt-dlp.** Three ways, so no single cache or schedule can leave it stale:
   - every image build installs the newest stable yt-dlp in a layer of its own
     (`server/Dockerfile`; the deploy passes a new `YTDLP_REFRESH` build argument each run,
     because the `requirements.txt` layer is cached and used to keep an old yt-dlp for months);
   - **Deploy to EC2** also runs every Monday at 03:23 UTC (`schedule:` in `deploy.yml`), so the
     image is rebuilt at least weekly with no push;
   - the worker installs the newest **nightly** yt-dlp (the channel yt-dlp's README recommends,
     where YouTube fixes land first) beside the image's at startup and every 24 hours
     (`app/ingest/ytdlp_update.py`, into `/home/nf/.local/share/nf-ytdlp`, about 25 MB). An
     update is used only once it installs, starts and is newer; a failed one (no network, a bad
     release) is logged as `yt-dlp update failed (…); staying on …` and changes nothing. The log
     says which version is in use at startup and after each update.

   Knobs (`.env` on the server): `NF_YTDLP_UPDATE_CHANNEL=stable` if a nightly ever misbehaves;
   `NF_YTDLP_UPDATE_HOURS` (default 24; 0 = startup only); `NF_YTDLP_UPDATE_DIR=` (empty) turns
   self-update off.
2. **A JavaScript runtime.** The image ships Deno and `yt-dlp[default]` (which brings
   `yt-dlp-ejs`) so yt-dlp can solve YouTube's player challenges. Nothing to configure.
3. **Proof-of-origin tokens.** The `bgutil-provider` service in `docker-compose.prod.yml`
   (`brainicism/bgutil-ytdlp-pot-provider:2.0.2-deno`, the provider the yt-dlp wiki's PO Token
   Guide lists first; no published port, compose network only) mints the tokens, and the
   `bgutil-ytdlp-pot-provider` plugin in the image (pinned in `server/requirements.txt` to the
   same version — bump both together) fetches them from `NF_YTDLP_POT_URL`
   (`http://bgutil-provider:4416`, set in the compose file, apart from `NF_YTDLP_EXTRA_ARGS` so
   an override there can no longer drop the tokens). Memory: the sidecar's V8 heap is capped at
   160 MB (`NF_BGUTIL_HEAP_MB`) under a 320 MB container limit (`NF_BGUTIL_MEM_LIMIT`); it holds
   no state, so an out-of-memory restart only costs the tokens it had cached. Check it with
   `docker compose -f docker-compose.prod.yml logs bgutil-provider` and the **Check EC2 Status**
   workflow's `docker stats`. A token helps but does not get past an IP-based block by itself.
4. **Other player clients.** YouTube's bot check is given per player client. A refused
   extraction, and a refused download, is tried again with `NF_YTDLP_FALLBACK_CLIENTS` (default
   `mweb,android_vr,web_embedded`: `mweb` is the PO Token Guide's recommended client, with its
   token from the sidecar; `android_vr` and `web_embedded` need none; yt-dlp tries each within
   that one call). Empty switches the second try off. The old default, `tv_embedded`, no longer
   exists in yt-dlp, which skips a client it does not know — so that "second try" had quietly
   become a re-run of the defaults. Check the PO Token Guide when yt-dlp changes its clients.
5. **Cookies of a signed-in throwaway account** (see below). Optional.
6. **The store's 30-second preview.** When YouTube still refuses, a Spotify link uses the
   preview on its track page, an Apple Music link the one from the iTunes lookup, and a
   YouTube link the iTunes preview of the same title and artist. The job then comes back
   `truncated`, with `source.preview = true` and the notice "Only a 30-second preview was
   available for this song." That covers anonymous previews (30 s) and nearly covers free
   ones (60 s); Pro full songs still need YouTube. Store previews are licensed for promoting
   the song, so keep the song's store link visible next to a preview result. A private or
   removed YouTube video never falls back to someone else's recording.

A store link (Spotify, Apple Music) also tries the next-best YouTube upload (up to three clean
uploads of the right length, within four minutes) when the best one is gone, region-locked,
refused or turns out to be a live take; a later one starts on the rung the refusals reached.

How the worker tells failures apart (`links.classify`, from yt-dlp's ERROR lines): **blocked**
(bot check, rate limit, captcha, 403/429, missing PO token or formats, network) is worth
another rung and maps to the API's `refused` sentence; **unavailable** (private, removed,
members-only, region-locked) and **age-restricted** are never retried, because no client makes
a private video public.

### Watching the block rate

Every resolve that asks yt-dlp and every link job writes one line, with no URL, video id or
proxy in it:

```
link_attempt stage=fetch provider=spotify outcome=blocked route=clients ytdlp_calls=4 seconds=31.2 preview=yes totals=success:41,blocked:6,unavailable:2,other:0 block_rate=12%
```

`outcome` is `success`, `blocked`, `unavailable` or `other`; `route` is the rung that answered
(or refused last): `direct`, `clients` or `proxy`; `totals` and `block_rate` count since the
worker started, per stage. Filter Dozzle (`/logs`, transcriber) on `link_attempt`; the **Check
EC2 Status** workflow prints them with the other link lines and probes YouTube from inside the
worker with the yt-dlp in use. A block rate that jumps after a quiet spell usually means YouTube
changed something: wait for the daily update or run **Deploy to EC2**. If it stays high for
days, it is the address, and the proxy below is the lever left.

### A residential proxy (optional, a later step)

Not set up, and nothing needs one: with `YTDLP_PROXY` unset the ladder simply has no proxy rung.
It is the strongest lever there is, because it changes the one thing YouTube judges most — the
address — and it costs money, so it is kept for when the block rate says the free layers are
not enough.

- **What it does.** With the repository secret `YTDLP_PROXY` set to a proxy URL
  (`http://user:pass@host:port`, or `socks5://…`; URL-encode special characters in the
  password, and avoid `"` and `$`), the deploy writes it to `.env` as `NF_YTDLP_PROXY`. yt-dlp
  then goes through it **only after** YouTube refused this server directly and with the
  fallback clients, and only for YouTube: the stores' metadata, previews and everything else go
  out directly. A video whose details were read through the proxy is downloaded through it too
  (YouTube binds the media addresses to the address that asked). The proxy's password is
  masked in the worker's log.
- **What to buy.** A *residential* or *ISP* (static residential) proxy, not a datacenter one —
  a datacenter proxy is the same problem again. Residential proxies are billed per gigabyte,
  cheaper per GB on bigger plans and noticeably dearer on small pay-as-you-go ones; ISP proxies
  are usually billed per address per month. Compare current prices; they change often.
- **How much traffic.** Very little: audio only, and only the section asked for. A six-minute
  song is a few megabytes (about 5–6 MB of m4a at 128 kb/s) plus well under a megabyte of page
  and API calls, and the proxy carries only what was refused directly. A thousand proxied songs
  is on the order of 5–10 GB.
- **A free thing to try first**, if it ever comes to that: Cloudflare WARP run as a small SOCKS
  proxy sidecar (then `YTDLP_PROXY=socks5://warp:1080`) is reported to get past some blocks;
  its addresses are Cloudflare's, not residential, so expect it to help less, and for less long.
- **To switch it off**, delete the secret and redeploy.

### Cookies

Optional, and a trade: a signed-in session gets past the bot check more often, but YouTube can
flag or suspend an account used from a server, and cookies expire or are rotated within weeks.
**Use a throwaway Google account made for this, never a personal or company one.** When the
cookies stop working the worker says so in its log, at most every 15 minutes:
`ytdlp_cookies_rejected: YouTube says the cookies are no longer valid (rotated or expired)` (or
"asked for a sign-in although cookies were sent"). Export fresh ones then.

1. On a desktop browser signed in to the throwaway Google account, export
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
   afterwards; the mounted file is never written. The worker runs as the unprivileged `nf`
   user (uid 10001) and the file is `chmod 600`, so the image's entrypoint, while still root,
   copies it to `/run/nf/ytdlp-cookies.txt` (0600, owned by `nf`) and points
   `NF_YTDLP_COOKIES_FILE` there before dropping privileges.

### Links that are refused outright

The worker turns a link away when it is pasted, before any job exists, when it can never be a
song: a video id nothing is behind (oEmbed 400/404), a private or removed video, a live stream
or premiere, and a video longer than `NF_LINK_MAX_VIDEO_SECONDS` (default 7200, two hours; the
section picker is unusable on a ten-hour loop). The refusal is remembered for ten minutes, so
the submit of the same link is refused at once too. The worker names the reason by code and
the API answers in its own words (`TranscriptionErrors.ForLink`); the worker's sentence is
never shown.

### The job journal

The queue is in memory. With `NF_JOB_DIR` set (the compose file points it at the `job-data`
volume), every submitted job is journaled before it is queued — its options, an upload's audio
(moved onto the volume) and how many times it has been started — and the worker replays the
journal on startup under the same job ids, so the API's rows, the clients' polling and the
single song charge are untouched by a deploy or an out-of-memory kill. A job that was started
`NF_JOB_MAX_ATTEMPTS` (2) times without finishing is failed with a plain message instead, and
the API is told through the completion webhook, which is itself retried twice while the API
restarts. Audio is still deleted the moment the job ends, journal entry and all. The volume
predates the worker's non-root user, so the entrypoint creates `NF_JOB_DIR` if needed and
`chown -R`s it to `nf` on every start.

**Rotation.** Cookies expire, and YouTube rotates or revokes them (sooner when the account
is used from a server). When the log shows `ytdlp_cookies_rejected`, or link jobs start coming
back as previews, export a fresh file, replace the `YTDLP_COOKIES` secret and redeploy. Expect
to do this every few weeks. yt-dlp keeps itself current (layer 1 above).

## Logs (Dozzle at `/logs`)

Dozzle reads the Docker socket, so anyone who reaches `/logs` reaches what it can do with that
socket (its read-only mount does not limit the Docker API). Give it a sign-in:

1. Make a bcrypt hash of the password (it never leaves your machine in clear):
   `docker run --rm amir20/dozzle:v11.3.2 generate --password 'a-long-password' admin`
   prints a users file; copy the `password:` value (`$2a$…`). `htpasswd -nbBC 11 admin
   'a-long-password' | cut -d: -f2` gives an equivalent hash.
2. Set the repository secrets `DOZZLE_USER` (letters, digits, `.`, `_`, `-`) and
   `DOZZLE_PASSWORD_HASH` (the hash, not the password).
3. Redeploy. The deploy writes `/opt/notefusion/dozzle-users.yml` (0600), mounts it at
   `/data/users.yml` and starts Dozzle with `DOZZLE_AUTH_PROVIDER=simple`. With either secret
   unset or malformed, the deploy warns and stops Dozzle: `/logs` answers 502 until the secrets
   are set and the deploy is run again. It is never served without a sign-in.

The Dozzle image is pinned (`amir20/dozzle:v11.3.2` in `docker-compose.prod.yml`); bump the tag
deliberately to upgrade.

**Or at the proxy.** The Caddyfile lives only on the server. To guard `/logs` there as well
(or instead), put `basic_auth` in front of the Dozzle route and reload Caddy
(`docker compose -f docker-compose.prod.yml exec caddy caddy reload --config /etc/caddy/Caddyfile`):

```caddyfile
{$DOMAIN_NAME} {
	handle /logs* {
		basic_auth {
			# caddy hash-password: docker run --rm caddy:2-alpine caddy hash-password --plaintext 'a-long-password'
			admin $2a$14$REPLACE_WITH_THE_HASH
		}
		reverse_proxy dozzle:8080
	}
	# … the existing API routes stay as they are
}
```

Using both asks for two passwords; one is enough.

## Secret scanning (no deploy with a key in the code)

`.github/workflows/secret-scan.yml` runs [gitleaks](https://github.com/gitleaks/gitleaks) (its own rules plus the
allowances in `.gitleaks.toml`) on every pull request, on every push to main, and as the first job of all three deploys
(`deploy.yml`, `deploy-web.yml`, `deploy-admin.yml`), which wait for it. Any finding fails the check and nothing is
built or shipped. It scans the files as they are and the commits being added, so a key committed and then deleted in
the same push still stops it. Findings are printed redacted. Run it locally the same way:
`gitleaks dir . --config .gitleaks.toml --redact` and `gitleaks git . --config .gitleaks.toml --log-opts="origin/main..HEAD" --redact`.

**When it fires:** treat the key as public. Revoke it at the provider and make a new one, put the new one in the
repository's secrets, then take the key out of the code (the history keeps the old one, which is why revoking comes
first). Add an allowance to `.gitleaks.toml` only for a value that is public by design, with a description saying why.

**Also switch on, in the repository's settings** (Settings › Code security): *Secret Protection* and *Push protection*,
free for public repositories. GitHub then refuses a `git push` that carries a known key format before it reaches the
repository at all. GitGuardian already checks every pull request.

## Pinning the server's host key

The deploy and the server check reach the server over SSH and hand it every production secret, so they should refuse to
talk to anything but our server. Every action in the workflows is pinned to a commit (the version in the comment beside
it), and the SSH steps check the server's host key against the repository variable `EC2_HOST_FINGERPRINT`. Unset, the
key is not checked and the deploy says so in a warning.

The SSH client in those actions picks the server's **ECDSA** key, so that is the fingerprint to set, in the form
`SHA256:…`. Take it from a source an attacker cannot answer for: in the AWS console, the instance's *Actions › Monitor
and troubleshoot › Get system log* prints `BEGIN SSH HOST KEY FINGERPRINTS` at first boot; use the `(ECDSA)` line.
Or, on the server itself (an EC2 Instance Connect or Session Manager shell):
`ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub`. Put it in Settings › Secrets and variables › Actions › Variables as
`EC2_HOST_FINGERPRINT`, then run *Check EC2 Status* once to see it connect. A new instance has new host keys: set the
variable again after moving or rebuilding the server (not after a resize, which keeps the disk). Keep an Elastic IP on
the instance, so its address is never handed to someone else while a deploy still points at it.

## Error reports (Sentry)

Four places report errors to Sentry, one Sentry project each (all in the same organisation). Each is off until its
setting is there, and the release on every report is the commit that was deployed (the app's own version for the phone).

| Where | What is sent | Setting |
|---|---|---|
| API (`Program.cs`) | unhandled exceptions and `LogError` lines, Information lines before them as breadcrumbs; of the request only its method and path (no body, headers, cookies, query string or IP address), every email address masked (`Api/Common/SentryScrub.cs`) | repository secret or variable `SENTRY_DSN_API` → `Sentry__Dsn` |
| ML worker (`app/telemetry.py`) | 5xx responses and crashed jobs (`JobQueue._crashed`; an expected failure is a warning, not an event); of the request only its method and address, no local variables, every URL and email address masked | `SENTRY_DSN_WORKER` → `NF_SENTRY_DSN` |
| Web app `/app` (`assets/errors.js`) | uncaught errors from the site's own scripts; Sentry's bundle (`assets/vendor`) loads only after the first one; no IP address, user, cookies or query strings, emails masked, the browser's name kept | repository variable `SENTRY_DSN_WEB`, written into the deployed `app/index.html` by `deploy-web.yml` |
| Phone app (`mobile/App.tsx`) | crashes and errors with device, IP address, the account's id and screen recordings (10% of sessions, and every session with an error) that show the screen as it was except password fields and Admin (`src/lib/replayPrivacy.tsx`), as the privacy policy says | the DSN in `App.tsx`; source maps below |

To set it up: in Sentry create the projects (ASP.NET Core, FastAPI, Browser JavaScript; the phone's React Native
project already exists), copy each project's DSN (Project settings → Client Keys) into the repository's Actions
secrets or variables as above, and deploy (re-run `deploy.yml` and `deploy-web.yml`, or merge anything). A DSN is
not a password (every app that reports carries one) but keep the server ones as secrets anyway. The web app's
`Content-Security-Policy` (`web-site/vercel.json`, `/app`) allows only this organisation's ingest host,
`o4508111757770752.ingest.us.sentry.io`; a project in another organisation needs that line changed.

**Sessions in the console** (board k-sessions). The console's Sessions page (`/sessions`) lists the phone's
recordings, newest first with a session still recording on top, plays one (its MP4 pieces, fetched through the API
and kept nowhere) beside what happened in it, and lists every project's unresolved errors. It reads Sentry with a
read-only token: in Sentry, Settings → Developer Settings → Custom Integrations → Create New Integration → Internal
Integration, permissions Organization, Project and Issue & Event set to Read and nothing else; its token goes in the
repository secret `SENTRY_API_TOKEN` (→ `SentryApi__Token`), the organisation's slug in the variable `SENTRY_ORG`
(→ `SentryApi__Org`, `fransix` when unset). Without the token the page says how to connect it. Sentry tells us
nothing, so the lists are read again every 30 s while the page is open, and a session still recording every 15 s.

**Phone source maps.** Without them a phone crash is minified JavaScript. The EAS `production` environment
holds the three values the upload needs: `SENTRY_AUTH_TOKEN` (a Sentry organisation token, visibility
Sensitive so a command on your machine can read it), `SENTRY_ORG` (`fransix`) and `SENTRY_PROJECT`
(`notefusion-mobile`), the slugs in the project's address, `https://<org>.sentry.io/projects/<project>/`.
An OTA update carries new JavaScript, so its maps go up with it: publish from `mobile/` with
`eas env:exec production 'npm run update:production' --non-interactive` (`eas update`, then
`sentry-expo-upload-sourcemaps dist`, the three values read from EAS rather than your shell).
A store build uploads its own (`@sentry/react-native/expo` in `app.json`): the store build of 20 October 2026
dropped `SENTRY_DISABLE_AUTO_UPLOAD=true` from `eas.json`'s `production` and `store` profiles. `eas.json` is part
of the Android fingerprint, so that build began a new runtime, and an OTA published from this commit on reaches
only builds made from it. While phones still run the older store build (runtime `6c685cab…`), publish each OTA
twice: once as above, and once with the two lines put back in `eas.json` (uncommitted, then restored), which
recomputes the old runtime for the same JavaScript.

## Backups

The `backup` service (ops/backup) makes encrypted, provider-neutral backups into its own bucket: a
`pg_dump` every 6 hours, WAL-G point-in-time recovery to the minute, and the photos, JWT key and Caddyfile
daily; a weekly GitHub Actions drill restores them for real. It needs five settings
(`BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`,
`BACKUP_ENCRYPTION_PASSWORD`); without them it logs what is missing and waits. Setup, restores and a
zero-data-loss move to another provider: [BACKUP_AND_MIGRATION.md](BACKUP_AND_MIGRATION.md).
`Maintenance__ReadOnly=true` (repository variable `MAINTENANCE_READ_ONLY`) makes the API refuse writes
with a plain 503 while reads keep working, for that move.
