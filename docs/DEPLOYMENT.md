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
  Paystack__SupportedCurrencies='USD,NGN' \
  --app <your-heroku-app>
# Optional, only if Paystack's webhook signing secret differs from the secret key:
# heroku config:set Paystack__WebhookSecret='whsec_xxx' --app <your-heroku-app>
```

**Flutterwave / Squad (placeholders for when each adapter lands):**

```bash
heroku config:set Flutterwave__SecretKey='...' Flutterwave__BaseUrl='https://api.flutterwave.com/v3' --app <your-heroku-app>
heroku config:set Squad__SecretKey='...'        Squad__BaseUrl='https://api-d.squadco.com'          --app <your-heroku-app>
```

### 1.1 Bachs

Bachs needs more than a key and a URL, so it has its own section and its own required set.
**All four of `SecretKey`, `BaseUrl`, `WebhookSecret` and at least one `ProductMap` entry
must be present or the adapter stays a stub** — a deployment missing the signing secret
could take payments it can never verify, and one missing the product map could open
checkouts that never become subscriptions.

| Var | Required? | Notes |
|-----|-----------|-------|
| `Bachs__SecretKey` | **yes** | `sk_sandbox_…` or `sk_live_…`. Sent as `Authorization: Bearer`. |
| `Bachs__BaseUrl` | **yes** | `https://sandbox-api.bachs.io` or `https://api.bachs.io`. There is no version header — going live is a key swap **and** a host swap. |
| `Bachs__WebhookSecret` | **yes** | The endpoint's `whsec_…` **signing secret**, which is a different credential from the API key and differs between sandbox and live. Copy it from the webhook endpoint in the Bachs dashboard; it is not retrievable via the API. Never set the API key here — a wrong key makes genuine and forged deliveries indistinguishable. |
| `Bachs__ProductMap__<plan_code>` | **yes, one per plan** | Our plan code → Bachs catalog product id. Recurrence comes from the product's `billing_cycle`, and that is immutable, so **monthly and yearly are two separate products**. Each product's catalog price must equal the plan price in `BillingSeeder` (`pro_monthly` = 4.99 USD, `pro_yearly` = 49.90 USD); a drift is caught at verification and blocks fulfilment rather than granting a subscription for the wrong money. |
| `Bachs__SupportedCurrencies` | optional | Comma-separated ISO-4217. Defaults to `USD`. |
| `Bachs__WebhookToleranceSeconds` | optional | Replay window for the signature timestamp, two-sided. Defaults to `300`. |
| `Bachs__CheckoutExpiryMinutes` | optional | 1–1440. Defaults to `60`, matching Bachs' own default. |

```bash
heroku config:set \
  Bachs__SecretKey='sk_live_xxx' \
  Bachs__BaseUrl='https://api.bachs.io' \
  Bachs__WebhookSecret='whsec_xxx' \
  Bachs__ProductMap__pro_monthly='prod_xxx' \
  Bachs__ProductMap__pro_yearly='prod_yyy' \
  Bachs__SupportedCurrencies='USD' \
  --app <your-heroku-app>
```

Configuring Bachs does **not** by itself route checkouts through it — both live providers
support USD, and the factory prefers `Billing__DefaultProvider`. To send USD traffic to
Bachs, set that too (see the table at the end of this section):

```bash
heroku config:set Billing__DefaultProvider='Bachs' --app <your-heroku-app>
```

In the Bachs dashboard also enable **subscriptions** for the account — a subscription
checkout is rejected with `SUBSCRIPTIONS_NOT_ENABLED` (403) otherwise — and subscribe the
webhook endpoint to `collection.succeeded` (the fulfilment signal) and `checkout.expired`
(so an abandoned session is closed out rather than left for the reconciliation worker).

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
| `Billing__CheckoutCallbackUrl` | `notefusion://billing/return` | Deep-link the provider returns the user to after hosted checkout. The real result still arrives via webhook. |

---

## 2. Google sign-in

The API only needs the OAuth **Client ID** (it validates Google ID tokens against it as
the expected audience — there is no client secret on the API side):

```bash
heroku config:set Google__ClientId='<google-oauth-client-id>.apps.googleusercontent.com' --app <your-heroku-app>
```

> The mobile app carries its own Google client id in `mobile/app.json` → `expo.extra`;
> that is a separate, client-side value and is not a Heroku secret.

---

## 3. Email (Resend)

Mail is logged (not sent) until `Email__UseResend=true`, so a deploy without a key is
safe. To turn on real delivery:

```bash
heroku config:set \
  Email__UseResend='true' \
  Email__ApiKey='<resend-api-key>' \
  Email__FromAddress='no-reply@notefusion.studio' \
  Email__AssetBaseUrl='https://<your-heroku-app>.herokuapp.com' \
  --app <your-heroku-app>
```

| Var | Required? | Notes |
|-----|-----------|-------|
| `Email__UseResend` | **yes** | `true` to send via Resend; anything else keeps mail in the log. |
| `Email__ApiKey` | **yes, when UseResend=true** | Resend API key. Env-only — a key in `appsettings.json` is a key in git history. |
| `Email__FromAddress` | **strongly recommended** | Default `onboarding@resend.dev` is Resend's sandbox and **only delivers to the address that owns the key**. Point at your verified domain (`no-reply@notefusion.studio`) before real users receive mail. |
| `Email__AssetBaseUrl` | recommended | Public origin the branded email fetches its logo from (`/email/logo.png`, served from the API's `wwwroot`). Set to the app's public URL. Unset simply drops the image; the live-text wordmark still brands the header. |
| `Email__FromName` | optional | Sender display name. Defaults to `NoteFusion`. |
| `Email__ReplyTo` | optional | Where replies land. Committed default is `hello@notefusion.studio`. |
| `Email__SupportEmail` | optional | Shown in the footer. Defaults to `hello@notefusion.studio`. |
| `Email__AppUrl` | optional | Marketing-site link in the footer/header. Defaults to `https://notefusion.studio`. |

> **Rotate the Resend key that was shared during development before using it** — treat it
> as burned. Create a new key in the Resend dashboard and set only that value above.

---

## 4. Already required (for reference — do not echo their values)

These are set as part of standing up the app and are listed so the checklist is complete;
they are not part of this task and should not be printed back:

- `DATABASE_URL` — provisioned by the Heroku Postgres add-on.
- `ASPNETCORE_ENVIRONMENT` — `Production` on Heroku.
- `Jwt__*`, `Cors__AllowedOrigins__0` (the admin dashboard origin), `TranscriptionApi__BaseUrl`
  (the internal ML worker), and the `Seed__*` admin bootstrap.

## Verify

```bash
heroku config --app <your-heroku-app>          # names only; review before/after
heroku logs --tail --app <your-heroku-app>      # watch the seeder + provider wiring on boot
```
