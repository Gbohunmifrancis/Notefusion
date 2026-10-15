# NoteFusion — monorepo

Transcribes live/recorded music into **Tonic Solfa** (movable-do) + **staff notation**.
Requirements: `docs/NoteFusion_PRD.docx` and `docs/NoteFusion_TRD.docx` (extract text
before reading; they are the source of truth for features and stack decisions).

## Architecture (three tiers)

Clients talk **only** to the C# Web API; the API is the single gateway to the Python ML
service. Reference coding patterns come from `Model-Carbon/SbzFarms`.

- **`src/` — C# .NET 10 Web API** (main backend): modular monolith, clean architecture,
  headless (same image serves mobile now, web later). Layers point inward:
  `Shared ← Core ← Application ← Infrastructure ← Api`. Postgres via EF Core; JWT access +
  rotating refresh tokens. Every outside HTTP client goes through `Infrastructure/Http/OutboundResilience`
  (total + per-attempt timeout, retry only GETs or Idempotency-Key sends, circuit breaker); an open breaker or
  timeout is the client's "unavailable" result, and batches ask `IProviderHealth` and stop for the run.
- **`server/` — Python FastAPI ML worker**: Basic Pitch / ONNX CPU inference, single-worker
  job queue. Internal only — never called by a client. Audio deleted after each job.
  It will not start without `NF_API_KEY` (`NF_ALLOW_NO_AUTH=1` for local runs only); `/docs` is off
  unless `NF_ENABLE_DOCS=1`. Every upload is cut to its cap with ffmpeg `-t` whatever its header says;
  pending jobs are capped (`NF_MAX_PENDING_JOBS`, 503 past it); completion webhooks go only to
  `NF_CALLBACK_HOSTS` (default `api,localhost,127.0.0.1`) and carry `X-Api-Key`, which the API requires.
  Melody mode (hummed/sung clips) is decoded by `app/pipeline/vocal.py` — pyin f0 contour,
  hysteresis note segmentation, noise spans dropped, then scale-fit notation (`write_in_scale`:
  a long take's steady drift, at most 1 st/min, is taken out first; `fit_scale_detail` finds the
  tuning offset and the major scale together, settling a quarter-tone singer's two readings on
  the simpler key signature and then roots within `SCALE_FIT_TIE_RATIO` of each other on the tonal
  profile; `snap_to_scale` writes each note as its scale tone unless it is heard as an
  accidental — within 25 cents of it at every offset that fits within 2%, held 0.15 s (or within
  8 cents, or a passing/neighbour tone) and steady; a la-based tune's se is spared the offset test) — with the Basic Pitch
  paths as fallback, which write their pyin medians the same way (`NF_VOCAL_ENGINE=0` restores
  the old decoder). That scale's root is the doh: `transcriber._detect_key` votes only between
  its major and relative minor, and the key confidence is the fit's `ScaleFit.confidence` (the
  cost margin over the runner-up scale, at most 1/k when k readings fit within 5% and an even
  chance beyond a 0.4 offset); without a fit the vote keeps to keys whose scale holds the notes as
  well as any does (`_scale_parsimony`). An unsure doh (confidence under `KEY_ALTERNATIVES_BELOW`) comes with
  `key_alternatives`: the fit's other roots within `SCALE_FIT_CROWD_RATIO`, each with the notes written in its scale
  (as a typed key is) and engraved; the clients ask "which doh is it?" and a choice swaps pitches and key together.
  The admin `GET /api/admin/key-corrections` reads saved sheets against their jobs' `ResultJson` (anonymised) for
  the doh correction rate and training rows. A key given at submit (`key_override`) re-writes the
  sung pitches in its scale (`vocal.write_in_root`; a key the voice fits worse than 1.5x its
  best only relabels, and a note sung within 25 cents of its own scale's pitch is never moved,
  so a wrong key can only relabel what was heard clearly); a song's backing chords are labelled but never move the doh (taking
  their key was measured wrong on real songs). A melody floor is not handed to a piano when pyin's line moves like a voice
  (`_stillness`). A sung note's confidence is how near its tuned pitch
  sits to the note written (`_pitch_confidence`), never loudness, and the sheet's overall
  confidence weighs the notes by length and by the doh confidence (the uncapped margin,
  `headline_confidence`, until the capped one is calibrated); users never see that number — the
  clients show a plain note only below "clear" (`web-site/assets/confidence.js`, mobile
  `lib/confidence.ts`), the admin console keeps it. Tempo level: every candidate
  is measured at its best nearby tempo and phase before the grid filter (`_level_residual`), and
  a tracked beat anchors beat 0 only within a quarter of a beat of the first note
  (`_beat_origin`). Accuracy is
  measured twice: the sung corpus, intended notes known, including untrained-singer styles
  (`python -m tests.accuracy.report --vocal`, baseline in `tests/accuracy/vocal_baseline.json`;
  `--slices` scores the long-drift, wide-detune, first-phrase and legato stress slices), and real
  singers (`python -m tests.accuracy.vocadito`, Vocadito downloaded on first run, scored against
  the committed `vocadito_frozen.json` so a change to the fit cannot move its own yardstick;
  `--rebuild-reference` re-derives it; the instrument corpus `python -m tests.accuracy.report`
  is the control). Linked songs
  (`POST /v1/transcribe/link`: YouTube, Spotify, Apple Music) are fetched by `app/ingest/links.py`
  (oEmbed metadata + yt-dlp), vocal-isolated by `app/pipeline/separate.py` (MDX-Net ONNX, model
  baked into the image at `NF_MDX_MODEL_PATH`; one pass needs ~1.6 GB and the process keeps ~320 MB of it,
  so the model runs in a child process that hands the memory back — `NF_SEPARATE_IN_PROCESS=1` restores
  the in-process run), then transcribed. Before submitting, clients ask `POST /v1/links/resolve` (via the C# `…/link/info`
  routes, which add the caller's allowance as `maxSeconds`) for the song's length and let the user pick the
  section; `/v1/transcribe/link` takes `start_seconds`/`end_seconds` and cuts that window. A job waiting for a worker reports `stage="queued"` with `queue_position` (jobs ahead); clients show
  the place in line rather than a stage that has not begun. The queue has two lanes:
  `priority=high` jobs (Pro) run first and skip Basic Pitch in melody mode. The queue is in memory, but
  with `NF_JOB_DIR` set (the prod compose's `job-data` volume) every submit is journaled first
  (`app/jobs/journal.py`) and `JobQueue.recover()` replays the journal at startup under the same job ids;
  a job started `NF_JOB_MAX_ATTEMPTS` times is failed with a plain message instead. A refused YouTube
  extraction or download is tried once more with the `tv_embedded` player client
  (`NF_YTDLP_FALLBACK_CLIENTS`); a nonexistent, private, live or over-long (`NF_LINK_MAX_VIDEO_SECONDS`)
  video is refused at `/v1/links/resolve` with a `LinkError.code` the C# `TranscriptionErrors.ForLink`
  turns into its own sentence, and the refusal is remembered so the submit is refused at once. Sections
  are cut as a copy (no `--force-keyframes-at-cuts`); ffmpeg cuts the exact window while decoding.
  `app/pipeline/harmony.py` writes SATB under the tune (Viterbi chord choice, rule-scored
  voicing, homorhythmic parts), returned as `parts` / `parts_musicxml` — only when asked:
  `harmony=true` on submit, or `POST /v1/harmonise` (notes + key) behind the Pro-only
  `POST /api/transcriptions/harmonise`; `PUT /api/library/{id}/parts` keeps them on a saved sheet.
  A transcription is the one voice that was heard; parts under it are an arrangement on request.
  `mode="choir"` is the exception: a choir singing in parts is decoded with every voice kept,
  `transcriber._assign_voices` splits each chord into S/A/T/B by pitch order, range and continuity,
  the top voice becomes the tune and the four come back as `parts` with `parts_source="heard"`;
  the choir's tuning (read off its first minute) comes out before Basic Pitch and is put back
  for the fit, every part is written in one scale fitted across all of them (`_choir_in_scale`;
  a key given is kept within 1.5x the best fit), and the key is voted on every part, the bass twice.
  `app/pipeline/grade.py` marks a sung take against a part (`POST /v1/grade`, synchronous:
  pyin contour, offset + octave alignment, per-note cents and hit/near/wrong/missed);
  the C# `POST /api/transcriptions/grade` forwards it for Pro accounts and stores nothing.
  `app/pipeline/chords.py` reads chords per beat (notes + chroma + bass, Viterbi, key from the chords) for
  `mode="chords"` (top line = melody) and for melody-mode songs off the backing; `keyboard_transpose` writes
  sounding pitch minus the keyboard's transpose (solfa unchanged). Bench: `python -m tests.accuracy.chords_bench`.
- **`mobile/` — React Native + Expo** (SDK 56, TypeScript strict): the cross-platform
  client. Night (dark) default with a runtime Day/Night switch (`src/lib/theme.tsx`; every
  stylesheet is a `makeStyles(palette)` factory), JWT refresh interceptor,
  the night redesign (`night`/`nightFonts` in `src/design/theme.ts`, primitives in
  `src/components/night/`; splash, onboarding and sign-in use it in either mode), a rating ask after the third saved sheet (`lib/ratingPolicy` decides when; the sheet in `lib/feedback` sends the stars to the API and offers Google Play to 4–5★),
  expo-notifications push. OTA via EAS Update (`production` channel) with the `fingerprint`
  runtime policy: any native change (a new Expo module, a permission, a plugin) gives a new
  runtime, so an update can only reach builds that have its native code — anything native
  needs a store build first.

> The old native `.NET 10 for Android` head was retired in the pivot; there is no
> `NoteFusion.App` project. Don't reintroduce Android-native or MAUI code.

## Rules that still hold

- Clean architecture: dependencies point inward; only `NoteFusion.Api` composes the app.
  Feature folders inside Application, `DependencyInjection.cs` per layer, `Result`/`Error`
  for expected failures, `Guard` for programmer errors.
- **Solfa engine (`src/NoteFusion.Core/Solfa`) is the product's core IP.** Movable-do: doh
  derives from the key (la-based for minor). Key change = re-label, never re-transcribe (a key
  given at submit is the worker's, which writes the sung pitches in it). The doh header is
  spelled as the key signature spells it ("Doh is Bb", not A#). Every change there needs unit
  tests. The Python worker, mobile `lib/solfa.ts` and web `assets/choir.js` mirror this engine —
  keep them in lock-step (see `server/app/pipeline` and its `_parse_key_override`).
- A free account gets 3 transcriptions, ever (`FreeTier`), counted per account and per device from
  `TranscriptionJob` rows (`TrialUsage`): charged when a job finishes, and a job still running holds its
  place until it settles, so starting several at once cannot pass the gate. The completion sweep
  (`TranscriptionCompletionWorker`, every 5 min) closes uncharged a job the worker answers 404 for
  (lost in a restart) and one still open past `TrialUsage.RunningFor`, and then emails a failed job's
  owner tips at most once a day (`EmailFailedTranscriptionTipsCommand`). Every metered submit (uploads,
  links, previews, the free harmony) runs count → worker submit → job row under a per-subject lock
  (`IQuotaGate`: `user:{id}`, or `device:`/`ip:` for previews); the in-process one assumes a single API
  instance — scaling out needs a Postgres advisory lock instead. The allowance is 3 plus every transcription
  bought one at a time (the one-song purchase, a `BillingInterval.Single` plan): fulfilment writes a
  `LedgerEntryReason.TranscriptionPurchase` ledger credit and nothing else (no subscription), the unique
  (transaction, reason) index makes it once per payment, and `TrialUsage.ReadAsync` counts those rows into the
  allowance (`TrialAllowance`: two pools, the free three per account and device, the bought ones per account
  only, so another account on the same phone never uses up a purchase; never expires, spent like a free one, a
  failed job costs nothing). A submit spends a free one while any is left, then a bought one, and marks the job
  `TranscriptionJob.PaidByCredit`. A bought transcription covers anything a free one does — a song upload with
  isolation included — and is the only thing that pays for a whole linked song on a free account (up to Pro's
  six minutes, normal lane, charged to the trial ledger and never as the one free preview).
  `SubscriptionDto` carries `boughtTranscriptionsRemaining`/`boughtTranscriptionsTotal`.
- Song credits (20 a month on Pro) are spent on completion by linked songs and by uploads with
  vocal isolation (`TranscriptionJobKind.Song`); hummed tunes cost nothing. A song still running holds its
  credit in the gate and in the displayed count (`SongCredits.CountHeldThisMonthAsync`), and an account may
  have at most 3 running at once (`SongCredits.ProMaxSongsInProgress`). Pro clients show the
  membership (plan name, period, credits) wherever a free account would see prices.
- The choir plan (`choir_*` codes, `Plan.ChoirSeats` = 25; same regions and `_regional` marker as Pro) is a
  director's purchase: `PaymentFulfillment` opens or stacks the director's `Choir` (its own period and
  `Version`, never their `Subscription`, so no time converts between the two). While it runs, the director and
  every `ChoirMember` (one choir per account, unique index; 25 seats; join with a revocable 8-character invite
  code, `POST /api/choirs/join`) are Pro through `ProStatus` — the one place every Pro check reads. Songs: the
  account's own Pro allowance first, then the choir's pool of `SongCredits.ChoirMonthlyPool` (60) a month, held
  like the own count (`TranscriptionJob.ChoirId` names the pool); still 3 running per person. A sheet shared
  with the choir (`Transcription.ChoirId`) is read by its members at `GET /api/choirs/mine/sheets[/{id}]`; it
  leaves the library when its owner leaves or is removed. Choir plans are listed only at
  `GET /api/billing/plans/choir` (shipped apps render every plan in the main list as Pro); the admin overview
  counts a choir as one paid member at its plan price and its singers apart.
- Saved transcriptions carry lyrics, the SATB parts (JSON column, solfa derived on read),
  the opening eight notes as `preview` on every read (list rows show them in solfa), an
  optional folder name (`PUT /api/library/{id}/folder`; a folder is just the name its sheets share) and
  an optional public share token (`GET /api/shared/{token}`, anonymous). A `FolderShare` is one public
  link for a whole folder (`GET /api/shared/folders/{token}`), which lists every sheet filed in it,
  opened through the folder link (`GET /api/shared/folders/{token}/sheets/{id}`, only while filed in it); a
  folder share never gives a sheet a token of its own. "Transpose for my
  choir" is the one edit that moves the notes: `Transcription.Transpose` shifts melody, parts
  and key and respells both scores with `Core/Notation/MusicXmlTransposer`.
- The website is the top of the funnel: `POST /api/preview` / `/api/preview/link` make an anonymous
  30-second preview (one per `X-Device-Id`, ever, none without one or on a device an account has used, and
  10 a day per address, via `PreviewJob` rows), polled at
  `GET /api/preview/jobs/{id}` (and settled by the worker's webhook and the completion sweep,
  `SettlePreviewJobCommand`, so a closed tab does not leave one running) and claimed by the account that signs up (`POST …/claim`). Users carry
  a `SignupSource` ("web"/"mobile"), sheets count `ShareViews`, and `GetAnalyticsOverviewQuery`
  turns those rows into the admin dashboard's web funnel. Page views, clicks and web-app actions
  are first-party: `web-site/assets/track.js` batches them to the anonymous `POST /api/web/events`
  (`WebEvent` rows, account-linked when a token is sent; `window.nfTrack("Saved sheet")` names an
  action) and the overview's `WebTraffic` section reads them back. No third-party analytics.
- Billing: naira plans are charged through Paystack, dollar plans through Bachs; currency routes the
  charge (`PaymentGatewayFactory.SelectForCurrency`). Every checkout is a one-off priced from the
  `Plan` row (`Recurring: false`): Bachs subscription checkouts need a card it can save and this
  account offers none for USD (`CHECKOUT_CANNOT_SAVE_PAYMENT_METHOD`), so no catalog product is
  needed and a price change is a new plan code in `BillingSeeder`. Nothing renews by itself: a member
  buys again to add a period, which stacks after the time left (`PaymentFulfillment`), on either plan;
  two payments landing at once both stack (`Subscription.Version` is a concurrency token and the save is
  retried). Plans are offered by the account's stored country (`PlanEligibility`), one set per known country:
  Nigeria gets naira; the lower-income markets in `PlanEligibility.RegionalCountries` (every African country but
  Nigeria, and IN PK BD LK NP ID PH VN MM KH LA) get the regional dollar set (codes carrying `_regional`: Pro
  $4.99/$39.99, one song $0.99); everyone else the standard dollar set; an unknown country sees naira and
  standard dollars, never the regional set. Checkout refuses a plan from another set
  (`BILLING_PLAN_NOT_AVAILABLE_IN_REGION`). Each set has a one-song purchase (₦1,500 / $1.99 / $0.99) listed
  beside Pro for free accounts only (served apart at `GET /api/billing/plans/single`, never in `/plans` or
  `public-plans`, which older clients label as Pro; hidden for Pro, refused at checkout with `BILLING_SINGLE_NOT_NEEDED`); the
  clients offer it first wherever the free limit is hit. It is revenue collected on the dashboard, never
  run-rate/MRR (those read memberships, and a single purchase starts none).
  `BillingReadiness` logs at startup if a plan on sale has no live provider. Provider and server
  error text never reaches a screen: the API returns plain sentences for checkout failures, and the
  web (`friendlyMessage`) and mobile (`toApiError`, `safeReason`) clients replace anything technical.
- Founder outreach (`Application/Outreach`, `Infrastructure/Outreach`): an hourly worker writes customer-research
  notes from the founder (email with Reply-To the founder + a one-line push when a device is registered) to four
  segments in priority order — unpaid checkout ≥3 days old (and ≥2 days after `RemindAbandonedCheckouts`, which in
  turn holds off a day after any outreach), active free user, tried once then quiet 5 days, never transcribed after
  2 days — once per segment per account ever, at most one a week, 09:00–19:00 WAT, `Outreach__BatchSize` per run.
  `OutreachMessage` rows are the claim (unique user+segment+channel) and the audit trail (`GET /api/admin/outreach`);
  a failed send is retried once. Email respects `EmailOptOut` (signed one-click `GET/POST /api/email/unsubscribe`);
  push respects the app's switch (it unregisters the device). Off unless `Outreach__Enabled` + `FounderName` +
  `ReplyTo` are set (prod defaults them on; the code default is off).
- Wire contract is **camelCase**; the C# `ApiError` envelope is `{code, message, details?}`.
  The mobile `src/api/types.ts` mirrors the C# DTOs exactly — change both together.
- Config is env-driven: nested keys use `__` (e.g. `Database__Host`, `TranscriptionApi__BaseUrl`).
  The same image runs in dev and compose with only env changes.

## Commands

```bash
# C# API — build & test (no DB needed; tests use SQLite in-memory)
dotnet build NoteFusion.slnx -c Release
dotnet test  NoteFusion.slnx

# Python ML worker
cd server && python -m pytest -q
cd server && python -m tests.accuracy.report --vocal   # sung/hummed corpus (slow, real inference)

# Mobile — strict type-check
cd mobile && npm run lint          # tsc --noEmit

# Web — the choir page's solfa mirror
node --test web-site/tests/*.test.mjs

# Whole backend stack
docker compose up --build          # api :5080, transcriber :8000, db :5432
```

---

## Working guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
