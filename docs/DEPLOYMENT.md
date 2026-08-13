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

> **Today only Paystack has a live adapter.** `Flutterwave`, `Squad`, and `Bachs`
> register as stubs regardless of config until their gateway adapters are implemented —
> setting their keys now is forward-looking and will not start charging through them yet.

**Paystack (the live one):**

```bash
heroku config:set \
  Paystack__SecretKey='sk_live_xxx' \
  Paystack__BaseUrl='https://api.paystack.co' \
  Paystack__SupportedCurrencies='USD,NGN' \
  --app <your-heroku-app>
# Optional, only if Paystack's webhook signing secret differs from the secret key:
# heroku config:set Paystack__WebhookSecret='whsec_xxx' --app <your-heroku-app>
```

**Flutterwave / Squad / Bachs (placeholders for when each adapter lands):**

```bash
heroku config:set Flutterwave__SecretKey='...' Flutterwave__BaseUrl='https://api.flutterwave.com/v3' --app <your-heroku-app>
heroku config:set Squad__SecretKey='...'        Squad__BaseUrl='https://api-d.squadco.com'          --app <your-heroku-app>
heroku config:set Bachs__SecretKey='...'        Bachs__BaseUrl='https://<bachs-api-host>'            --app <your-heroku-app>
```

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
