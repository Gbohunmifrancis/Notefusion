# Geo-split billing: NGN subscriptions on Paystack, USD subscriptions on Bachs

**Current model (October 2026).** Nigerian accounts subscribe to Pro in naira through Paystack
(₦7,500 a month, ₦60,000 a year). Everyone else subscribes in dollars through Bachs ($9.99 a
month, $79 a year), as a Bachs *catalog product* per plan (`Bachs__ProductMap__pro_monthly_usd`,
`Bachs__ProductMap__pro_yearly_usd`). Lifetime is no longer sold. Currency routes the charge
(`Paystack__SupportedCurrencies=NGN`, `Bachs__SupportedCurrencies=USD`), `PlanEligibility` shows a
Nigerian account only naira plans and everyone else only dollar plans, and `BillingReadiness` logs
at startup if a plan on sale has no live provider or no Bachs product. The one external
precondition is unchanged from the history below: the Bachs account must be able to bill USD cards
on a schedule, or the dollar checkouts render no payment method.

**Payment confirmation (October 2026).** What has to hold so Pro unlocks as soon as money moves and no
paid checkout is stranded:

- **Verify against the session, not the charge.** A dollar one-off is priced in the session (`amount`
  `"79.00"`, `currency` `"USD"`) and charged in naira by FX conversion (`charge.currency` `"NGN"`,
  `charge.amount` `"113421.48"`, `billing_currency` `"NGN"`). `BachsPaymentGateway.VerifyAsync` verifies the
  session's base price; the charge figure is cross-checked only when it is in the same currency. A
  different charge currency is logged as FX and accepted when the payment positively settled
  (`payment_status` succeeded/paid/overpaid/accepted, or `charge.status` succeeded/overpaid/accepted).
- **An open session is never a failure**, even after a declined attempt or with money still arriving:
  verify reports it as transient and the row stays Processing. `amount_remaining` (charge currency)
  fails only a settled session whose shortfall was not `accepted`.
- **The provider's word on settlement wins.** A Failed row the provider later confirms is reopened
  (`PaymentTransaction.Reopen`) and fulfilled — by webhook, `ReconcilePaymentCommand`, the admin console,
  the sweep (failed rows from the last 48 hours, every 30 minutes) or `POST /api/billing/confirm` (the
  caller's three newest in-flight checkouts, then any failed in the last two hours).
- **Nothing is failed on age alone.** The stale cleanup fails a Processing row only on the provider's own
  answer that it was not paid (a terminal one, or Paystack's never-final `abandoned` past the checkout
  lifetime); an unreachable provider leaves it Processing, where the admin payment alert counts it as stuck.
  The sweep asks about the newest stuck rows first, so a backlog cannot starve the one just paid.
- **Pending retries stay with their client.** A Pending row is replayed only by the client that started it
  (website keys end in `:web`): the return URL is part of the body the provider fingerprints the key against.
- **Timings.** Webhook retries back off (5 s, 30 s, 2 min, 10 min, 30 min…) over 8 attempts; the
  reconciliation sweep runs every 5 minutes on rows 3 minutes stale; an open checkout is handed back for 30
  minutes (`Billing__CheckoutReuseMinutes`), after which it is reconciled and replaced.
- **Return URL.** `Billing__CheckoutCallbackUrl` defaults to
  `https://api.notefusion.studio/api/billing/return` (a blank value keeps the default). A checkout started
  with `client: "web"` returns to `…/api/billing/return/web`, which sends the browser to
  `https://notefusion.studio/app?paid=1`. Startup logs a warning if the URL is not https or not that path.

The sections that follow are the plan as it was written when lifetime was the dollar tier; they are
kept for the reasoning and the Bachs findings.

Nigerian users buy Pro monthly or yearly in naira through Paystack. Everyone else used to buy Pro
once, for life, in dollars through Bachs.

The split is not only a pricing decision — it is the workaround for a defect diagnosed on
2026-08-19: Bachs subscriptions are card-only, this account's only card rail is `NGN_CARD`, and NGN
subscriptions are switched off (`NGN_SUBSCRIPTIONS_NOT_ENABLED`). Every recurring Bachs session
renders an empty payment-method list and cannot be paid. One-off sessions on the same account render
methods normally. A lifetime purchase is a one-off, so it sits on the mode that works.

## What already works — do not rebuild it

- **Provider routing.** `Billing__DefaultProvider=Bachs`, `Bachs__SupportedCurrencies=USD`. So
  `PaymentGatewayFactory.SelectForCurrency` sends USD to Bachs and, because Bachs does not list NGN,
  falls through to Paystack for NGN. No code change. Selection is server-side; the client never picks
  a provider.
- **The entitlement gate.** `Subscription.IsActiveAt` only asks `utcNow < CurrentPeriodEndUtc`.
  Lifetime is a far-future period end. Nothing about the gate changes.
- **No renewal machinery to exclude.** `Subscription.Renew` is called from exactly one place,
  `PaymentFulfillment`, and only when a new payment arrives. Nothing sweeps subscriptions to charge
  or expire them, so a lifetime row needs no special-casing in any worker.
- **Enum wire format.** `Program.cs:31` registers `JsonStringEnumConverter(CamelCase)`, so a new
  `BillingInterval.Lifetime` serialises as `"lifetime"` — already the shape `mobile/src/api/types.ts`
  expects. `Plan.Interval` persists as a string of max length 10; `"Lifetime"` is 8. No migration for
  width.
- **Price changes as new plan codes.** `BillingSeeder` documents this convention, so `pro_lifetime`
  and the NGN plans are additive rows, and historical charges stay traceable to the price actually
  agreed.

## Blocked on Bachs (external)

The Bachs account has no USD card rail. `GET /v1/payment-methods` lists `USD_CARD` with
`enabled_by_default: true`, but it never renders on this org's checkout pages, and that is **not**
geo-dependent — declaring `customer.country = "US"` and a full US billing address changed nothing.
An international buyer today can pay only by cryptocurrency or by having their card charged in naira.

Until `USD_CARD` is enabled the USD lifetime tier is technically shippable but commercially not worth
launching. Enabling it would also likely repair USD subscriptions, since subscriptions are card-only
and that would finally supply a card. Treat the support request as the critical path.

**Checked against the first live one-off session (2026-08-20, `checkout.bachs.io/c/lbRMbUUh_RjLvNU`).**
A real `pro_lifetime` checkout renders three methods — Bank Transfer, Cryptocurrency, Pay with Card —
so the empty list is specific to *subscription* mode and the one-off path does open a payable page.
What it will not do is quote dollars: the $79 purchase is presented as **NGN 113,421.48 + NGN 3,402.64
processing fee = NGN 116,824.12**, and the card option charges that naira figure. So the tier is
shippable and the price on the card is honest, but an international buyer is still asked for a Nigerian
bank transfer or a card charged in naira, which foreign issuers commonly decline or surcharge. The page
also takes upwards of twenty seconds to render its methods, since they wait on a `get-quote` call.
`USD_CARD` remains the critical path.

## Phases

### 1. Adapter: a genuine one-off path — the real code change

`BachsPaymentGateway` line 108 **always** sends `product_cart`, which always yields
`mode: "subscription"`. `request.Recurring` currently only toggles the method restriction on line 118.
So a lifetime plan routed through the adapter as it stands would go out as a subscription and be
unpayable — the exact bug being worked around.

- Branch the pricing source on `Recurring`: `product_cart` when true, `pricing: {amount, currency}`
  when false. They are mutually exclusive; sending both is a 400.
- `InitiateCheckoutCommand` line 122 hardcodes `Recurring: true`. Derive it from the plan
  (`plan.Interval != BillingInterval.Lifetime`).
- A one-off needs no catalog product, so `BachsOptions.ProductMap` is not consulted and
  `IsConfigured`'s "at least one product" requirement should not gate a lifetime-only deployment.

→ **verify:** a unit test asserting the serialised body carries `pricing` and no `product_cart` when
`Recurring: false`, and the reverse when true. Then one live session against the sandbox whose page
renders a non-empty method list.

### 2. `Lifetime` interval, without the silent trap

`PaymentFulfillment.cs:76` is a two-way ternary:

```csharp
=> interval == BillingInterval.Monthly ? from.AddMonths(1) : from.AddYears(1);
```

Adding `BillingInterval.Lifetime` makes a lifetime buyer silently receive **one year**. This would
ship green and surface a year later. Replace with an explicit `switch` over all three values, with
lifetime mapping to a sentinel far-future end (`DateTime.MaxValue`, or `9999-12-31`) and no default
fallthrough, so a future fourth value fails to compile rather than granting the wrong period.

Also in this phase:
- `Plan.Interval` gains `Lifetime = 3`.
- Line 60's early-renewal stacking must not corrupt a lifetime row — once lifetime, always lifetime,
  regardless of what the user previously held.
- The receipt (line 72) carries `renewsAtUtc`. A lifetime receipt must not read "renews 31 Dec 9999";
  the email and `GetMySubscriptionQuery` both need lifetime copy.

→ **verify:** tests that a lifetime fulfilment yields a subscription active far in the future; that a
monthly subscriber who buys lifetime ends up lifetime, not one year; and that no email renders a 9999
date.

### 3. Country on the user, resolved once

There is no country, IP, or geo code anywhere in `src/` today.

Resolve the country from the request IP **server-side** and persist it on the `User` row at
registration rather than re-deriving it per paywall view. Two reasons: the offer stays stable when a
user travels, and you keep a record of why a given user was shown a given price — which you will want
the first time someone disputes it.

- Prefer a local MaxMind GeoLite2 database over a lookup API: no per-request latency, no vendor rate
  limit on the checkout path, no runtime network dependency.
  **Deferred as implemented** — MaxMind needs an account, a license key and a ~9MB build artifact,
  while the country is resolved once per account and never on the checkout path. It sits behind the
  `IGeoIpLookup` seam, so swapping the HTTP lookup for a local database is one class.
  **What the HTTP route cost in practice:** ipapi.co, the obvious endpoint, answered the very first
  production lookup with HTTP 429 — its free tier is metered per calling address and a dyno shares
  one egress address with every other tenant on the host. The shipped default is geojs.io instead,
  which answers from shared cloud egress; the swap was one env var, which is the seam earning its
  keep.
- Heroku terminates TLS at its router, so the client IP is in `X-Forwarded-For`, not
  `RemoteIpAddress`. **Corrected as implemented:** the router *appends* the address it observed to
  whatever header arrived, so the **leftmost entry is the spoofable one** — a caller can prepend as
  many as it likes — and the trustworthy entry is counted from the RIGHT (`chain[^hops]`, one hop by
  default). Reading the first entry, the conventional "original client" reading, would hand the
  caller their own price.
- Existing users have no country. Backfilling by guess would mis-price real people; treat unknown as
  "show both" rather than forcing either tier.

→ **verify:** a test that a Nigerian IP resolves to NG, an unknown IP resolves to null, and that a
spoofed `X-Forwarded-For` from an untrusted hop cannot set the country.

### 4. Eligibility enforced at checkout, not just in the list

`GetPlansQuery` currently filters on nothing but `IsActive`, so it is the natural place to hide
ineligible plans. **Filtering the list is not sufficient.** `InitiateCheckoutCommand` takes a raw
`PlanId`, so a client can pass the id of a plan it was never shown. Eligibility must be re-checked in
the handler, after the `PlanNotFound` check on line 63.

How much this matters depends on the NGN prices. At ₦7,500/month the naira and dollar tiers are near
parity and the incentive is negligible; price NGN to local purchasing power and the gap becomes worth
exploiting. Enforce it regardless — it costs one predicate.

→ **verify:** an integration test that an international user posting the NGN plan id gets a refusal,
not a checkout.

### 5. Plans, mobile, and config

- Seed the USD lifetime plan (now `pro_lifetime_v2`, USD 200.00 — see "Price" below) and NGN
  monthly/yearly plans (₦7,500 / ₦75,000) in `BillingSeeder`.
- `mobile/src/api/types.ts:106` — add `"lifetime"` to the `BillingInterval` union. C# DTO and the
  mirror change together, per the wire-contract rule.
- Paywall copy differs per tier: recurring price versus one-time purchase. A "lifetime" card that
  still says "per month" is the obvious failure here.
- Set `Paystack__SupportedCurrencies=NGN`. It currently claims `USD,NGN`, which is untrue for this
  account — a latent trap that would silently route USD to a provider that cannot collect it if the
  Bachs config were ever removed.
- Retire the `test_ngn_monthly` plan once real NGN plans exist. **Also `pro_monthly` and `pro_yearly`,
  which the plan did not list and which matter more:** they are USD *subscriptions*, so they are
  unpayable for the same reason this whole split exists, and left active they would sit on an
  international paywall beside the lifetime tier as two checkouts that cannot complete. Retiring is a
  flag flip, never a delete — fulfilment and every receipt read the plan by id long afterwards.

→ **verify:** `dotnet test NoteFusion.slnx`, `cd mobile && npm run lint`, and the paywall rendering
both tiers correctly under a forced country.

## Decisions still open

1. **Fair use on lifetime.** Pro is unlimited — `SubmitTranscriptionCommand:53` is the only gate and
   there is no metering in the codebase. Selling unlimited ONNX inference forever for one payment is
   an unbounded liability against a real per-job CPU cost. Recommend a monthly ceiling set high
   enough that no honest user notices. Needs a counter that does not exist yet.
2. **Price — settled at $200.** Was recommended here as $79 standing, $49 for a launch cohort. Shipped
   at **$200** as `pro_lifetime_v2`, with `pro_lifetime` retired at its $79 rather than edited, so a
   past buyer's receipt keeps saying what they agreed to. The higher figure follows from decision 3
   going the other way: this is a one-off standing in for a subscription that cannot be billed on this
   rail at all, so it has to cover the whole relationship rather than a year and a half of it. The
   non-Nigerian free trial doubled to 10 generations alongside it — a longer look before a larger
   single payment (`FreeTier.TrialGenerationsFor`).
3. **Lifetime versus an annual one-off.** An annual one-off uses the identical working Bachs mode,
   carries no compute tail, and keeps revenue recurring, at the cost of manual re-purchase. It
   dominates lifetime on risk.
4. **Unknown-country users.** "Show both" is recommended above, which is a deliberate softening of
   the "forced" requirement for the pre-existing cohort only.
5. **An address is not a market.** The account this shipped against geolocates to **DE**, not NG, so
   production offered it the dollar lifetime tier — three independent lookup services agree on the
   country. Any Nigerian user behind a VPN, or on a carrier whose addresses are registered abroad, is
   therefore priced as international, and the same predicate that stops arbitrage also *refuses* them
   the naira tier at checkout. There is no appeal path and no manual override. Worth deciding before
   launch rather than after the first support ticket: candidates are an explicit "wrong country?"
   affordance, trusting a self-declared country for the cheaper tier only, or an admin override on the
   user row.

## Noted, not touched

`Subscription.MarkPastDue` and `Subscription.Expire` are defined but never called anywhere —
pre-existing dead code, unrelated to this work.
