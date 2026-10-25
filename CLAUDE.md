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
  Admin-console passkeys (WebAuthn, Fido2NetLib `Fido2` pinned; `/api/auth/passkeys/*`, `Passkey` rows): only an
  Admin registers one, and a passkey sign-in returns the password login's token pair to an Admin only; challenges are
  single-use, 5 min, in memory (`InMemoryPasskeyChallengeStore`, single instance). RP: `Passkeys__RpId`
  (`notefusion.studio`; `localhost` in Development) and `Passkeys__Origins` (`https://admin.notefusion.studio`).
  The console has the phone's lock (board i-console-lock): every admin route wants an open `X-Admin-Session` pass from
  any non-app token (`AdminPhoneLock__EnforceConsole`, default on; the phone's own is `__Enforce`); a console sign-in
  hands an Admin the first pass in that header (CORS-exposed), and `/api/admin/console-lock` opens a fresh one with one
  of the admin's own passkeys (challenge kind `Unlock`, bound to them) or the password (the sign-in lockout's count).
  web-admin `lib/adminLock` keeps the pass in memory only, locks after an hour idle (the server's pass: an hour idle, an hour at most), and confirms Suspend, End
  subscription, Revoke Pro, Change role, flags and adding/removing a passkey (`[FreshPhoneUnlock]`).
  A remembered browser does not ask again: after an unlock or a sign-in the console keeps a token (`AdminTrustedBrowser`, its hash
  only, 30 days, ten per admin; `lib/consoleTrust`, `POST …/console-lock/trust`) and trades it for a pass whenever it finds itself
  locked (`…/trusted`; a reload, a new tab, the hour, an API restart). That pass is never fresh, so the confirmations above still
  ask; sign-out forgets the browser, and Settings › Remembered browsers lists and forgets them.
  Web push (the web app with its tab closed): `WebPushSubscription` rows (unique endpoint, known push services only,
  `/api/push/web/key|subscriptions`), sent beside the Expo push by `NotifyTranscriptionReadyCommand` via `WebPushSender`
  (Lib.Net.Http.WebPush over `OutboundResilience.WebPush`, a breaker per push service; 404/410 deletes the row, 5 refusals
  drop it). VAPID pair from `WebPush__PublicKey`/`__PrivateKey`, else derived from the JWT signing key (`VapidKeys`, no
  setup); `WebPush__Enabled=false` turns it off. `web-site/sw.js` (scope `/app/`, push only) shows it under the tab's
  `nf-job-<id>` tag and a click opens `/app?job=<id>`.
  The admin console has its own web push (`WebPushSubscription.Audience` "console", `/api/admin/push/subscriptions|test`,
  web-admin `public/sw.js` + `lib/consolePush`, Settings › Notifications): a payment (beside the phone alert, first try only),
  and from `AdminConsoleAlertWorker` (1 min, cooldown memory per key) failed payment attempts, a wave of accounts, one inbox
  making several, and transcription floods per account, per phone and in all (`AdminConsoleAlerts__*`, admins/internal left out).
  Expo push: a ticket only says Expo took a push; `PushReceiptWorker` (2 min) reads each ticket's receipt
  (`PushTicketLog`, in memory), drops DeviceNotRegistered tokens, logs a key problem (InvalidCredentials = no FCM V1
  key on Expo, MismatchSenderId, a 401 wanting `Push__ExpoAccessToken`) as an error at most hourly, and System Health's
  Push panel says how many were not delivered and why (`PushProblems`); the admin test alert waits ≤8 s for its own
  receipt and answers with the reason. Admin phones also get "someone signed up / is transcribing"
  (`SendAdminActivityAlertsCommand`, `AdminActivityAlertWorker` every 30 s over an in-memory window; admins' own left
  out; Android channel `admin-activity`; quiet hours, mute and names as the payment alerts; `AdminActivityAlerts__Enabled=false` off).
  The ready and failed pushes go at FCM high priority (`PushTimeToLiveSeconds`, a day's TTL).
  Clients are told, not polling (the 2–2.5 s job polls and the phone's always-open SignalR socket are gone; the hub stays
  for older builds): a watched job has an event stream, `GET /api/transcriptions/jobs/{id}/events` (previews
  `/api/preview/jobs/{id}/events`; `Api/Realtime/JobEventStream`: `ready` → the client GETs once, `job` progress, `ended` →
  one GET, ping 20 s, closed after 10 min) over the in-memory `IJobEvents` (8 streams per account or address, 2000 in all).
  The worker posts each job's stage/progress/place in line to `<callback>/progress` (`app/jobs/progress.py`, ≤1/s per job,
  `NF_PROGRESS_PUSH=0` off), read only when someone watches. A stream that heard `ended` means no push (they are looking
  at it), as a poll that saw a job done used to; a hidden tab's `?away=true` stream hears it but still lets the push go.
  Phone `lib/jobStream` (XHR, shared per job, closed in the background), web `assets/app.js` (fetch stream + `sse.js`);
  both fall back to a GET every 15 s (phone; 30 on data saver) / 10 s (web) after 3 failed opens, and read once after 90 s
  quiet. A job settled 15 min ago is answered from `ResultJson` without asking the worker.
  Server loops that work saved rows are rung, not on short timers: `WorkSignalInterceptor` (EF, after the commit) rings
  `WorkSignals` for a new `WebhookEvent` (`PaymentWebhookWorker`, sweep `Billing__WebhookPollSeconds` 30), an
  `AdminPaymentAlert` (`PaymentAlertWorker`, 60 s) or a `BlogGenerationRun` (`BlogDraftWorker`, 60 s), and tells the
  console's live notices (`AdminLiveFeed`, stream `GET /api/admin/analytics/live/events`; web-admin `lib/liveFeed`) of a new
  account, job, preview or payment and of someone coming online (`LastSeenMiddleware`): the console fetches `live` then,
  hidden tabs included, instead of every 15 s. One stream per tab: the Users page follows the same `changed` (and looks every 2 min for
  those who left), and a drafting batch's every move is its `blog` event (Recent drafting, a batch's progress).
- **`server/` — Python FastAPI ML worker**: Basic Pitch / ONNX CPU inference, single-worker
  job queue. Internal only — never called by a client. Audio deleted after each job.
  It will not start without `NF_API_KEY` (`NF_ALLOW_NO_AUTH=1` for local runs only); `/docs` is off
  unless `NF_ENABLE_DOCS=1`. Every upload is cut to its cap with ffmpeg `-t` whatever its header says (six minutes, `NF_MAX_CLIP_SECONDS`
  360, for Pro and a bought song; the API sends a free account's three, `FreeTier.UploadSeconds`), and read only as the containers people send
  (`app/pipeline/ffmpeg_input.INPUT_GUARD`: `-protocol_whitelist file -format_whitelist …` on every ffmpeg/ffprobe of an
  outside file, and audioread's ffmpeg wrapped the same way), so a DASH/HLS manifest sent as a recording fetches nothing;
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
  so a wrong key can only relabel what was heard clearly); a song's backing chords never override a sure voice (taking
  their key was measured wrong on real songs), but settle an unsure one: on a song's separated vocal, a doh under
  `KEY_ALTERNATIVES_BELOW` gives way to the band's when that is one of the fit's own `alternatives` (`_doh_from_band`, step
  7c; the backing re-read for its key when its chords are too unclear to show; `NF_SONG_DOH=0` off). A melody floor is not handed to a piano when pyin's line moves like a voice
  (`_stillness`). A sung note's confidence is how near its tuned pitch
  sits to the note written (`_pitch_confidence`), never loudness, and the sheet's overall
  confidence weighs the notes by length and by the doh confidence (the uncapped margin,
  `headline_confidence`, until the capped one is calibrated); users never see that number — the
  clients show a plain note only below "clear" (`web-site/assets/confidence.js`, mobile
  `lib/confidence.ts`), the admin console keeps it. Tempo level: every candidate
  is measured at its best nearby tempo and phase before the grid filter (`_level_residual`), and
  a tracked beat anchors beat 0 only within a quarter of a beat of the first note
  (`_beat_origin`); of readings that fit alike the one nearest 100 BPM wins, unless it writes the
  commonest note dotted and one a dotted ratio away writes it plain (`_PLAIN_NOTE_BEATS`). Bars
  (melody mode, `_meter_and_pickup`): a time signature given always wins (the API passes None for
  "auto"); otherwise 3/4 only when a three-beat bar puts clearly more of the held length on its
  downbeats than four does (`TRIPLE_LIFT`), else 4/4 — never 2, 6 or compound — and the first bar
  line is placed by the same durational accent, so an upbeat is written as a pickup
  (`TranscriptionResult.pickup_beats`, not on the wire; `beat_origin_sec` moves with it). A separated song's
  band decides both instead when it marks its downbeats plainly (`app/pipeline/downbeats.py`: onsets under 180 Hz,
  chord and bass changes, z-scored per half beat; clear = salience 1.0 and 3 standard errors over chance; 3/4 when
  three-beat downbeats stand out more; a bar line where the music starts when the clip starts at the song's start,
  `transcribe(song_start=…)`, false for a link's section or the store's preview; `NF_BAND_BARS=0` off). Accuracy is
  measured four times: the sung corpus, intended notes known, including untrained-singer styles
  (`python -m tests.accuracy.report --vocal`, baseline in `tests/accuracy/vocal_baseline.json`;
  `--slices` scores the long-drift, wide-detune, first-phrase and legato stress slices), and real
  singers (`python -m tests.accuracy.vocadito`, Vocadito downloaded on first run, scored against
  the committed `vocadito_frozen.json` so a change to the fit cannot move its own yardstick;
  `--rebuild-reference` re-derives it; the instrument corpus `python -m tests.accuracy.report`
  is the control), and the bars: the hymn corpus (`python -m tests.accuracy.report --hymns`, the
  published tunes of the website's hymn pages, `content/hymns`, each played and sung at a varied
  tempo and key and scored against its own score — meter, notes in the right bar, pickup, written
  rhythm, tempo level as well as the notes; tune on `--split dev`, report the held-out
  `--split test`; baseline `hymn_baseline.json`, five tunes in pytest), and the song path: studio songs
  (`python -m tests.accuracy.report --songs`, `tests/accuracy/studio_songs.py`: 47 real takes of the Children's Song
  Dataset — one studio singer, notes annotated, CC BY-NC-SA, fetched by range requests on first run, never committed —
  under a rendered band, through the MDX model; and 80 hymn tunes sung by a synthetic singer on simulated stems, which the
  model would hand to the piano; scored on the audio clock, syllables as read in each side's key; dev/test halves;
  baseline `song_baseline.json`, three openings in pytest). Linked songs
  (`POST /v1/transcribe/link`: YouTube, Spotify, Apple Music) are fetched by `app/ingest/links.py`
  (oEmbed metadata + yt-dlp), vocal-isolated by `app/pipeline/separate.py` (MDX-Net ONNX, model
  baked into the image at `NF_MDX_MODEL_PATH`; one pass needs ~1.6 GB and the process keeps ~320 MB of it,
  so the model runs in a child process that hands the memory back — `NF_SEPARATE_IN_PROCESS=1` restores
  the in-process run), then transcribed; a song's separated vocal (the queue passes the mix as `tempo_source` only
  then) also has its singer's slides folded into the notes they reach (`vocal.absorb_scoops`: a span of at most 0.35 s
  that starts a syllable and runs, unre-struck, up at most 2.5 st into a note 1.5x as long; `NF_SONG_SCOOPS=0` off),
  and the band leaking into that stem silenced before any pitch is read (`transcriber._gate_bleed`: frames
  `BLEED_BELOW_DB` 14 under the song's vocal-to-instrumental level where the instrumental sounds; the intro's
  leaked notes used to start the sheet before the singer; `NF_SONG_BLEED=0` off).
  Every separation (a link, `separate=true`, or a band the queue heard in a
  melody upload) checks the stem for a voice (`separate.voice_share_db`): a stem with none gives way to the mixture, and
  one whose sheet has fewer than max(4, seconds/10) notes to the mixture's sheet when that has more; a mixture is
  read on the normal lane (the fast lane has no melody floor). Instruments recorded alone used to come back as
  one or two notes. Before submitting, clients ask `POST /v1/links/resolve` (via the C# `…/link/info`
  routes, which add the caller's allowance as `maxSeconds`) for the song's length and let the user pick the
  section; `/v1/transcribe/link` takes `start_seconds`/`end_seconds` and cuts that window. A job waiting for a worker reports `stage="queued"` with `queue_position` (jobs ahead); clients show
  the place in line rather than a stage that has not begun. The queue has two lanes:
  `priority=high` jobs (Pro) run first and skip Basic Pitch in melody mode. The queue is in memory, but
  with `NF_JOB_DIR` set (the prod compose's `job-data` volume) every submit is journaled first
  (`app/jobs/journal.py`) and `JobQueue.recover()` replays the journal at startup under the same job ids;
  a job started `NF_JOB_MAX_ATTEMPTS` times is failed with a plain message instead. Every yt-dlp call climbs
  a ladder, one rung per refusal (`links._routes`; `links.classify` reads yt-dlp's ERROR lines as
  blocked/unavailable/age_restricted/other, and only "blocked" climbs): yt-dlp's default clients with
  proof-of-origin tokens from the `bgutil-provider` sidecar (`NF_YTDLP_POT_URL`; plugin pin = sidecar tag),
  then `NF_YTDLP_FALLBACK_CLIENTS` (`mweb,android_vr,web_embedded`; `tv_embedded` is gone from yt-dlp), then
  `NF_YTDLP_PROXY` — optional and off, YouTube only, from the `YTDLP_PROXY` secret; a download keeps the rung
  its details were read on. A store link tries up to three clean search matches. yt-dlp stays current three
  ways: a cache-busted Dockerfile layer every build, a weekly scheduled deploy, and the worker installing the
  newest nightly beside the image's at startup and daily (`app/ingest/ytdlp_update.py`, `NF_YTDLP_UPDATE_*`).
  Each resolve that asks yt-dlp and each link job logs one `link_attempt` line (outcome, rung, running
  totals, block rate; no URL), and expired cookies log `ytdlp_cookies_rejected`. A nonexistent, private,
  live or over-long (`NF_LINK_MAX_VIDEO_SECONDS`)
  video is refused at `/v1/links/resolve` with a `LinkError.code` the C# `TranscriptionErrors.ForLink`
  turns into its own sentence, and the refusal is remembered so the submit is refused at once. Sections
  are cut as a copy (no `--force-keyframes-at-cuts`); ffmpeg cuts the exact window while decoding.
  `app/pipeline/harmony.py` writes SATB under the tune (Viterbi chord choice, then Viterbi over each
  note's voicings so the inner parts move as lines — steps, light passing notes off the beat, no parallels —
  homorhythmic parts; bench against CCEH's own harmonisations: `python -m tests.accuracy.harmony_bench`,
  fixture `harmony_book.json`), returned as `parts` / `parts_musicxml` — only when asked:
  `harmony=true` on submit, or `POST /v1/harmonise` (notes + key) behind the Pro-only
  `POST /api/transcriptions/harmonise`; `PUT /api/library/{id}/parts` keeps them on a saved sheet.
  A transcription is the one voice that was heard; parts under it are an arrangement on request,
  written as a hymn book prints them: the soprano is the tune moved by whole octaves so its middle note sits
  nearest the middle of `SOPRANO_RANGE` (C4–E5; `harmony.soprano_octave_shift` — a man's tune goes up an octave),
  the transcription itself is never moved, and the players sound that soprano as the tune.
  `mode="choir"` is the exception: a choir singing in parts is decoded with every voice kept,
  `transcriber._assign_voices` splits each chord into S/A/T/B by pitch order, range and continuity,
  the top voice becomes the tune and the four come back as `parts` with `parts_source="heard"`;
  the choir's tuning (read off its first minute) comes out before Basic Pitch and is put back
  for the fit, every part is written in one scale fitted across all of them (`_choir_in_scale`;
  a key given is kept within 1.5x the best fit), and the key is voted on every part, the bass twice.
  `app/pipeline/grade.py` marks a sung take against a part (`POST /v1/grade`, synchronous:
  pyin contour, offset + octave alignment, per-note cents and hit/near/wrong/missed);
  the C# `POST /api/transcriptions/grade` forwards it for Pro accounts and stores nothing.
  "Learn my part" (web `assets/practice.js`, mobile `lib/practice.ts` + `result/PracticeView`, mirrored): the part remembered
  per device, mine loud (others 0.25) / alone / equal, two tapped bars looped, 50–100% (synth plays slower); free with the parts.
  Its Pro "Sing it back" grades the looped bars only (sliced, from beat 0, beats ÷ speed), count-in then the singer alone.
  `app/pipeline/chords.py` reads chords per beat (notes + chroma + bass, Viterbi, key from the chords) for
  `mode="chords"` (top line = melody) and for melody-mode songs off the backing; `keyboard_transpose` writes
  sounding pitch minus the keyboard's transpose (solfa unchanged). Bench: `python -m tests.accuracy.chords_bench`.
  `app/pipeline/hymn_match.py` recognises a hymn we hold once a melody (or song) job finishes (`queue._offer_hymn`;
  never choir/chords mode or a sheet with parts; `NF_HYMN_MATCH=0` turns it off): interval-trigram prefilter (cosine,
  so it holds at 10k entries), Smith-Waterman on intervals then on pitch classes under the likeliest transpositions,
  offered only past `MIN_MATCHED`/density/coverage and a margin over the best *other* tune (more for a short match),
  or for a note-for-note take (`NEAR_EXACT`) when every related tune within the margin is clearly less exact on the same notes.
  The result's `hymn_match` carries the published score (notes, rhythm, meter, pickup, first verse) in the key that
  was sung, at the book's octave (moved at most a tritone, so a man's take is offered the hymn page's pitch); the clients ask "Use the hymnbook version?" (`web-site/assets/hymnbook.js`, mobile `lib/hymnbook.ts`) and
  a save with `hymnSlug` keeps the hymn's credit, read from the job's own result. The index
  `server/app/data/hymn_index.json` is generated by `tools/blog/build.mjs` from the published hymns (staleness checked
  by `check.mjs`); `kind:"incipit"` entries (`content/hymns/incipits/`) are recognition only — named and linked, never swapped.
  "Hum to find a hymn" (`/hymns/identify`, built by `tools/blog/lib/render-identify.mjs`, `assets/hymn-identify.js`): the anonymous
  `POST /api/hymns/identify` (per address and per `X-Device-Id`, 5/min and 20/day: `HymnIdentifyLimiter`; spends no preview or allowance,
  stores nothing) forwards to the synchronous `POST /v1/identify` — pyin alone on ≤`NF_IDENTIFY_MAX_SECONDS` (20, ffmpeg `-t`), then
  `hymn_match.match` with its thresholds untouched; ≤`NF_IDENTIFY_CONCURRENCY` (2) at once in the threadpool, else 503 → `HYMN_FINDER_BUSY`.
- **`mobile/` — React Native + Expo** (SDK 56, TypeScript strict): the cross-platform
  client. Night (dark) default with a runtime Day/Night switch (`src/lib/theme.tsx`; every
  stylesheet is a `makeStyles(palette)` factory), JWT refresh interceptor,
  the night redesign (`night`/`nightFonts` in `src/design/theme.ts`, primitives in
  `src/components/night/`; splash, onboarding and sign-in use it in either mode), one popup: every dialog is the
  bottom sheet (`showDialog` → `components/AppDialog` on `components/Sheet`; `lib/sheetKind` reads confirm,
  destructive, info, options, offer or celebrate off the options) and good news is a toast (`lib/toast` `showToast`); a tap that waits says so: its button's `loading` spinner, or the
  "Sharing…" card over a veil that takes taps (`lib/busy` `withBusy`, shown after 250 ms; `now` paints it before work that holds
  the thread), and no screen waits for the piano: the player is handed a recipe (`lib/melodySource` `VoicesSource`) that
  `lib/melodyAudio` makes in slices (synth `voicesWav`, byte-identical to `synthesizeVoicesWavBase64`, the screen drawn
  between them) and keeps in the cache's `nf-audio` (newest 30; bump `SOUND_VERSION` when the synth's sound changes),
  and every player's status is `lib/playerStatus` (never expo's `useAudioPlayerStatus`: Android says "loaded" once, and a
  player that loaded before its listener was attached left the play button grey for good),
  one `components/Button` (primary · secondary · text · destructive, md 48 / sm 40, `block` for a flow's last action;
  red only as a destructive word and the live REC dot, problems an amber icon: `ProblemNote`),
  one icon family, no icon font: `components/Icon` (react-native-svg, typed `IconName`) draws `design/iconGlyphs.ts`,
  generated by `npm run build:icons` (`scripts/build-icons.mjs`: Lucide 1.48 for the generic icons plus our music glyphs
  in `assets/icons-src/notefusion`, only the names used, 1.75 stroke; `lib/iconSet.test.ts` fails when stale), ink at rest
  on neutral tiles, blue only active/selected (the tab: line + 20% wash), amber only the alert sign, mint only the
  tick, gold only Pro's crown, violet the choir, orange Playful and the live streak, never a red icon;
  five labelled tabs Home · Library · Record (centre) · Practice · Hymns (`lib/navTargets`, which also maps a push's
  `data.screen`), every tab's header its name left and the avatar right (`TabHeader`/`HeaderAvatar`, Pro's gold ring)
  pushing Profile (plan, choir, Notifications, Settings, help, feedback; an Admin's Admin row in a group of its own,
  see the phone admin below); no side drawer and no Profile tab.
  Settings and Notifications are grouped rows (`components/settings`); Notifications holds push, sound, the reminder
  and its hour 8–21 (`ReminderTimeSheet`) and the founder-notes email switch (`GET/PUT /api/me/email-preferences`, the
  `EmailOptOut` row). The record button's halo and Home's mic share one breath (`lib/breath`). A saved sheet's actions
  (share a link or with the choir, rename, folder, keep offline, delete with one confirm) are one implementation
  (`lib/sheetActions`, `components/library/useSheetActions`) for the Library's selection bar, Home's recent rows (⋯ or a
  long press opens `SheetActionsSheet`; a deleted row folds away) and the Result screen. Splash: cover only until
  the fonts load, the 1.6 s intro on the first launch (`nf.hasLaunched`), 0.6 s on every later cold start. A rating ask after the third saved sheet (`lib/ratingPolicy` decides when, again at most every 90 days): Google's in-app review card (`lib/rating`, expo-store-review, loaded lazily so an older store build skips it), never a question of ours before it; Profile's Rate opens the listing,
  expo-notifications push. OTA via EAS Update (`production` channel) with the `fingerprint`
  runtime policy: any native change (a new Expo module, a permission, a plugin) gives a new
  runtime, so an update can only reach builds that have its native code — anything native
  needs a store build first.
  Offline, JS only (no netinfo): opened/saved sheets are kept per account in `documents/offline/` (`lib/offlineLibrary`, pure `sheetCache`; pins exempt from the 8 MB cap; wiped on sign-out) and used on NETWORK_* errors. No take is lost (board 13): every one (never a link) is written ahead into `lib/outbox` (pure `sendQueue`) before its upload — audio moved to app storage beside a synchronous `<id>.json` record, a mic take `held` from the moment it stops while it is asked what it is — sent at once under an `Idempotency-Key` (`sendKey`: the take's id, a new suffix per job it left behind) and followed on the Record screen by `lib/useTakeSend` ("Kept on this phone" card when the connection drops, "Sending it again" card when the job is lost; no dialogs), and in "On its way" (`components/library/OnItsWay`: the Library above its sheets, Home above Recent, so a Listen take sent with the app closed is in sight on the screen it opens on); the audio stays until the job is done. A job lost (`errorCode: "JOB_LOST"`; the old sentences only as a fallback) or unanswered 4.5 h after sending is re-sent at once, a 5xx on the backoff, at most twice; the network is waited out however long; the recording's failures and refusals wait for Try again/Delete.
  Android pays through Google Play (board h-play; a store build, expo-iap pinned) once `sellsOnPlay`: the server can
  confirm Play purchases (`GET /api/billing/google-play/status`, its service account set) and Play sells the products;
  until then it keeps the website's checkout (Paystack, Bachs) exactly as before. `lib/playStore` (connect, Play
  offers, Google's sheet with the user id as obfuscated account id, hand-over to the server, restore) on the pure
  `lib/playBilling` (plan ↔ product/base plan, Play's own prices, labels, member states renewing/cancelled/grace/hold,
  the Google Play manage link); UpgradeScreen shows only what Play sells at Play's price, "Subscribe"/"Buy this song",
  Restore purchases, and for a Play member Manage/Resubscribe/Fix in Google Play (never Add time or Cancel on Android);
  SubscriptionProvider hands over unacknowledged purchases at sign-in and on every foreground.
  The Hymns screen reads `web-site/hymns/pack.json` (built by `tools/blog/lib/hymn-pack.mjs`, version in `pack-version.json`, checked by `check.mjs`).
  Data saver (default off, `lib/dataSaver`/`dataPolicy`): 32 kbps AAC uploads (`recordingPreset`, measured), no avatars/artwork, slower polls, hymn updates only on tap.
  Every practice take is that 32 kbps AAC whatever the switch (`PRACTICE_PROFILE`: the same marks as 128 kbps at a third of
  the upload, the wait before a mark on a slow connection); claps (rhythm, `useModeTake({ claps: true })`) keep the standard rate.
  **Listen from anywhere** (Android, boards r-listen; `modules/notefusion-listen`, beside "Find the key"): a take recorded
  over any other app and sent as a Record-screen take. Three ways in: the floating button (`OverlayUi`, plain Android
  views in `TYPE_APPLICATION_OVERLAY` windows, docked half off an edge, dragged, hidden on the ×; tapped it is the pill
  with the REC dot, the clock, the account's line and a ring on the level), the quiet notification's Listen, and the
  Listen tile (`ListenTakeTileService`, tapped again = stop and send). `ListenOverlayService` is the foreground service
  (`specialUse` while it waits, `microphone` / `mediaProjection` for the take: Play needs the specialUse declaration);
  `TakeRecorder` writes AAC at 22,050 Hz mono, 128 or data saver's 32 kbps, from the mic ("The room") or, Android 10+,
  playback capture ("This phone's sound": Android's consent each time; an app that opts out comes through as silence
  while music plays, and the take goes on from the room, said so). Android 14+ starts a microphone service only from
  the front: the notification action is its own exemption, the overlay counts while the button is on screen, and the
  tile and the consent go through `ListenTakeActivity`, a translucent activity in front for the moment the recording
  starts (the button's fallback too). Stop (or the cap: 3:00 free, 6:00 Pro, `listenAnywhere.ts`; under 3 s is not
  sent) hands the file to `ListenTakeHeadlessService` → `AppRegistry.registerHeadlessTask` (index.ts) →
  `lib/listenAnywhereBridge.listenTakeTask`: `bindOutbox` the cached account, `enqueueTake` as a melody take, `sendTakeNow`;
  the ready push is unchanged; a file the task never got is swept in at sign-in (`drainPendingTakes`, files older
  than 15 min). The allowance the overlay shows (`ListenPrefs`, written by `SubscriptionProvider` through
  `syncListenAllowance`: the pill's "Free: 2 of 3 left this week · up to 3:00", the "none left" card whose Buy one song
  opens `notefusion://upgrade`) fails open until the server has answered; the server still decides. Settings › Listen
  from anywhere (Android only): Floating button (a setup sheet, `ListenAnywhereSheet`: microphone, notifications,
  "Display over other apps" on Android's own page, in order, the one button naming the next), Listen in notifications,
  Quick Settings tile (Add), Listen to. Native code: a store build, not an OTA.
  The floating button and the Listen notification are Pro's (`ListenPrefs.proActive`: the allowance known and Pro, a
  choir seat included; Settings shows them as Pro rows opening Upgrade; the switches keep their place through a lapse);
  the tile is everyone's. Nothing runs to wait: the notification alone is a plain swipeable one (`ListenNotice`, its
  Hide and swipe-away to `ListenNoticeReceiver`; swiped, it is back when the app next opens), and the service runs only
  for the button on screen, a take, or a take on its way to JS (then on the `listen_button` MIN channel unless the notice
  rides on it). During a take the notification's clock is the system chronometer; the tile and stored clock move every
  5 s. A take that runs on: "Still listening" at 2:00 and "One minute left" before the cap (`listen_reminders`, heads-up,
  Stop & send / Cancel); nothing above −52 dBFS in the first minute ends it unsent, 45 s quiet after 10 s heard ends it
  sent, the cap ends it sent, and under 2 s heard is never sent (`TakeRecorder.Listener.onQuiet`); a take that ended by itself
  leaves a note in the shade. "Listen for" (`ListenPrefs.kind`: Singing = melody, Instrument = poly, Chords; Settings'
  row, the pill's chip and the take notification's "For: …" step through them; the kind rides in the take's file name
  for a swept take) is what a take is sent as; a Singing take also carries `noVoiceAsChords`, so the worker reads one
  whose separated stem holds no voice as chords (`queue._separate_and_transcribe`, `no_voice_as_chords`, on the mixture
  only; `result.read_as_chords`, never offered a hymn). Every step is logged on the phone (`ListenPrefs.logEvent`, `listen_*` names, flat
  `key=value` details, at most 300 kept) and sent by `lib/appEvents` (with Settings' own `listen_setting`/`listen_pro_lock`
  and `listen_take_queued`, which names the job) to `POST /api/app/events` (signed in, `AppEvent` rows, 50 a call,
  purged with the website's events and with the account); the console's Listen anywhere page (`/listen`,
  `GET /api/admin/analytics/listen`, `GetListenAnalyticsQuery`) reads takes by way in and source, what they became,
  endings, reminders, refusals, settings as last left and Pro-lock taps with the upgrades that followed.
  **Phone admin** (`screens/admin`, `components/admin`, boards f-admin): Profile › Admin (row and route for an Admin only;
  every admin endpoint re-reads the role from the database) is its own section with its own bar, Overview · Payments
  (Webhooks and Ledger as tabs, a payment's sheet, "Needs a look" + Reconcile) · Users (an account and its actions) ·
  Health (the Push panel, `SystemHealthDto.Push`) · More (Growth, Feature flags, Payment alerts; every other row opens
  `admin.notefusion.studio/<path>`, whose `/payments` and `/payments/{id}` are the same Payments). Admin palette
  `adminDark`/`adminLight`; red only as a status pill or a destructive word. The lock (pure `lib/adminLock`,
  `lib/adminLockRuntime`): expo-local-authentication (biometrics or the phone's PIN; a phone with no screen lock types the
  account password, `POST /api/admin/lock/password`) on the way in, again after an hour away or idle or a sign-out, and again
  before Suspend, End subscription, Revoke Pro, Change role or any flag change; expo-screen-capture keeps Admin out of
  screenshots and Recents; what Admin reads stays in memory (`lib/adminCache`) and is dropped when it locks.
  **Payment alerts**: `PaymentFulfillment` stages an `AdminPaymentAlert` (unique per payment) beside the ledger credit;
  `PaymentAlertWorker` (rung as the claim is saved, else a 60 s sweep) claims before it sends (at most once; a recorded failure is retried up to 3 tries) and
  pushes Admin phones only (`AdminAlertDevices`: role and active re-read, `DeviceToken.PaymentAlerts`, a token no other
  account holds) at high priority with an hour's TTL, category `payment` (View · Mute 1 hour). One payment is
  `PaymentPushCopy.Single` ("₦7,500 · Pro Monthly" / "Ada Obi just paid. Pro until Wed 18 Nov.", title ≤ 40, line ≤ 90,
  amounts in the currency paid and never added, no pronouns); several in one run are one summary. `data.screen`
  `AdminPayment` + `paymentId`, which `lib/navTargets` resolves for admins only. Per phone (`/api/admin/alerts/device`,
  `…/device/mute`, `…/test`; More › Payment alerts): sound chime / phone / none, vibrate, quiet 22–07 on
  `users.TimeZone` (off by default), names left out ("Tap to see who paid."), problems. An Android channel's sound is
  fixed, so each choice is its own channel (`payments-v1` for the chime with vibration, else
  `payments-v1-{sound}[-still]`; quiet hours and Mute use `payments-v1-none-still`; problems
  `payment-problems`, `NotifyAdminsOfPaymentIssuesCommand`); the chime is `assets/sounds/payment.wav` (expo-notifications
  `sounds`: a store build).

- **`ops/backup/` — backups** (`docs/BACKUP_AND_MIGRATION.md`): the compose `backup` service (pinned image on the db's
  own postgres:16-alpine) puts encrypted copies in a bucket of their own: restic (`pg_dump` every 6 h with a row-count
  manifest, read back and SHA-checked; photos, JWT key, Caddyfile daily) and WAL-G (daily base + WAL from the db's
  `wal-spool`, ~1 min PITR). It writes `backup_runs` via the INSERT-only `notefusion_backup` role → System Health card +
  `BackupAlertWorker`; `backup-restore-drill.yml` restores weekly. `Maintenance__ReadOnly` 503s every write for a move.
  The API connects as `notefusion_app` (`ops/db/app-role.sql`: owns the app's tables so migrations run, no superuser,
  password derived from the database's), which every deploy sets up and hands every table to; if that fails, that deploy
  keeps the superuser rather than start an API that cannot connect.

> The old native `.NET 10 for Android` head was retired in the pivot; there is no
> `NoteFusion.App` project. Don't reintroduce Android-native or MAUI code.

## Rules that still hold

- **Commits are the owner's alone.** Every commit is authored as `Gbohunmi Francis <120693899+Gbohunmifrancis@users.noreply.github.com>`
  (set `git config user.name`/`user.email` before the first commit of a session) and carries no `Co-Authored-By`,
  `Claude-Session` or other AI trailer, whatever a tool or harness suggests; PRs are squash-merged with a written message
  so no other author reaches `main`. No AI assistant is ever to appear among the repository's contributors.
- Clean architecture: dependencies point inward; only `NoteFusion.Api` composes the app.
  Feature folders inside Application, `DependencyInjection.cs` per layer, `Result`/`Error`
  for expected failures, `Guard` for programmer errors.
- **Solfa engine (`src/NoteFusion.Core/Solfa`) is the product's core IP.** Movable-do: doh
  derives from the key (la-based for minor). Key change = re-label, never re-transcribe (a key
  given at submit is the worker's, which writes the sung pitches in it). The doh header is
  spelled as the key signature spells it ("Doh is Bb", not A#). It follows tonic solfa hymn-book
  conventions: a chromatic is named for where it goes (a semitone up de re fe se le, a semitone
  down ra ma sa la ta, anything else de ma fe se ta), and the unmarked octave starts at the doh at
  or below the tune's middle note (a minor third higher for la-based minor; parts are marked from
  the soprano's doh — the tune as the parts write it, so it reads exactly as the tune does — or the
  melody's when there is no soprano: `SolfaLabels.LabelParts`, choir.js and mobile `partReference`). Every change there needs unit
  tests. The Python worker, mobile `lib/solfa.ts` and web `assets/choir.js` mirror this engine —
  keep them in lock-step (see `server/app/pipeline` and its `_parse_key_override`; the shared
  table is `HymnBookSolfaTests` and its copies in each language's tests).
- A free account gets 3 hummed or recorded transcriptions a week (`FreeTier`): plain uploads and mic takes, any mode
  (melody, chords, choir), never a link or an upload with vocal isolation; a file is read for its first three minutes
  (`FreeTier.UploadSeconds`), Pro's (and a bought song's) for six, as a linked song. The week turns every Friday 18:00 West Africa
  Time (17:00 UTC, for everyone; `FreeTier.WeekStart`/`NextReset`, the one place for the maths), and a job counts in
  the week it was submitted. Counted per account, per inbox and per device from `TranscriptionJob` rows
  (`TrialUsage`); old rows simply fall out of the window, nothing to migrate. The inbox is `users.CanonicalEmail` (`Core/ValueObjects/Mailbox`:
  lowercase, `+tag` dropped, and for gmail/googlemail dots dropped too; non-unique, filled at startup for old
  rows): every account on one inbox, like every account on one phone, shares the week's free three and the one
  link preview (still once ever) — never bought ones. Aliases still sign up and sign in; they just find the free ones gone. Password
  sign-up refuses throwaway-inbox domains (`AUTH_DISPOSABLE_EMAIL`, list in
  `Application/Auth/Services/disposable_email_domains.txt`); Google sign-in and existing accounts are untouched.
  A job is charged when it finishes, and a job still running holds its
  place (on the account, the inbox and the device) until it settles, so starting several at once cannot pass the gate.
  The completion sweep (`TranscriptionCompletionWorker`, every 5 min) closes uncharged a job the worker answers
  404 for (lost in a restart), one with no answer past `TrialUsage.RunningFor`, and one the worker still reports
  queued/running past `TrialUsage.HeldFor` (hours: a busy queue is not a lost job, and closing it early made its
  result free), and then emails a failed job's
  owner tips at most once a week (`EmailFailedTranscriptionTipsCommand`). Every metered submit (uploads,
  links, previews, the free harmony) runs count → worker submit → job row under a per-subject lock
  (`IQuotaGate`: `user:{id}` plus `device:` and `mailbox:` for a free account, or `device:`/`ip:` for previews); the in-process one assumes a single API
  instance — scaling out needs a Postgres advisory lock instead. The allowance is the week's 3 plus every transcription
  bought one at a time (the one-song purchase, a `BillingInterval.Single` plan): fulfilment writes a
  `LedgerEntryReason.TranscriptionPurchase` ledger credit and nothing else (no subscription), the unique
  (transaction, reason) index makes it once per payment, and `TrialUsage.ReadAsync` counts those rows into the
  allowance (`TrialAllowance`: two pools, the week's free three per account, inbox and device, the bought ones per account
  only, so another account on the same phone never uses up a purchase; never expires, spent like a free one, a
  failed job costs nothing). A submit spends a free one while any is left, then a bought one, and marks the job
  `TranscriptionJob.PaidByCredit`. A bought transcription covers anything a free one does and is the only thing that
  pays for a song on a free account: an upload with isolation (else `BILLING_SONG_NOT_FREE`) or a whole linked song
  (up to Pro's six minutes, normal lane, charged to the trial ledger and never as the one free preview). The refusal
  says when in the account's own time zone ("back on Friday at 1pm"; "Friday at 17:00 UTC" when none is known,
  `FreeTier.ResetWhen`), never in West Africa Time; `SubscriptionDto` carries `freeTranscriptionsRemaining`/
  `freeTranscriptionsPerWeek`/`freeResetsAtUtc` (clients show it in local time: `web-site/assets/freeweek.js`,
  mobile `lib/freeWeek.ts`) beside `boughtTranscriptionsRemaining`/`boughtTranscriptionsTotal`, and keeps
  `trialGenerations*` (week's free + bought) for shipped apps. `public-plans` carries the region's one-song `single`.
- Song credits (20 a month on Pro) are spent on completion by linked songs and by uploads with
  vocal isolation (`TranscriptionJobKind.Song`); hummed tunes cost nothing. A failed job costs nothing, and neither
  does a link whose song YouTube refused, where the store's 30-second preview stood in (`source.preview`): no song
  credit, bought transcription or free link preview (`JobCharge`, the one charge rule both finish paths use;
  `StandInChargeRefund` handed back those charged before, at startup). The clients re-read the count after a failure. A song still running holds its
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
- Practice is gamified, transcription is not (`Application/Practice`, numbers in `PracticeRules`): every graded take
  (the free lesson path `POST /api/practice/drills/grade`, 10/day, Pro 20; Pro `…/transcriptions/grade`) is a server-written
  `PracticeSession` on the singer's day (`X-Time-Zone`, else Lagos); XP, levels, streaks (1 freeze/ISO week), badges are
  read off those rows, never client-reported. Drills: `DrillCatalogue`/`DrillSyllabus`, labelled by the solfa engine: ten
  grades × 5 units drawn from ABRSM, Trinity, Kodály and Curwen (`docs/PRACTICE_CURRICULUM.md`). It is a path, not a drill
  of the day (`PracticePath`, replayed from the session rows; `GET …/drills/next`, `/today` its alias): 80+ moves on, under
  that the drill once more then an easier variant, two 90+ skip a drill, two under 50 step back; unit and grade milestones
  are derived, each once. Mobile `PracticeScreen`.
  Modes beside the path (`Application/Practice/Modes`; Focused lists all six, Playful warm-up, pitch match, intervals and
  rhythm): warm-up (`GET …/warm-up`, synth guides, never marked) ending in the range finder (`POST …/range`, a
  low or high take → worker `/v1/range`, holds ≥1 s; kept as `users.VoiceRange{Low,High}Midi`, said as notes, solfa on doh C
  and a part by harmony.py's ranges; `GET …/range`), pitch match (8 held notes after their tones, one take, `/v1/grade` with
  `offsetSearchSec` 0.35 so the tones cannot stand in), intervals (doh then the note, RCM order), harmony (a third above or
  under a played tune), runs (60–100 %: note by note while every note lasts 0.3 s, else `/v1/grade/run`, DTW shape + landing
  note) and rhythm (`/v1/grade/rhythm`: clap onsets, offset + tempo fit, ±70/±140 ms). `GET …/modes/{mode}` lists a mode's
  `ModeCatalogue` exercises (keyed per singer per day; id `mode:code@doh[~speed]`); `POST …/modes/grade` marks a take: a
  `PracticeSession` of the mode's kind, one of the day's marked drills, drill XP, never the path (it reads Drill rows).
  Progress carries `modes`, live per track; `PracticeModes__<Mode>=false` switches one off without an app update.
  Screens (boards c-practice/6a–6d), mirrored: the hub keeps the path card first, streak + level one line, the live
  `modes` as one list (Playful "More ways to play"), the stat cards under "Your progress"; mobile `screens/practice/*`
  (route `PracticeMode`, `lib/useModeTake`, clips from `lib/modeAudio` on `lib/synth`), web `assets/practice-mode-view.js`
  + `practice-modes.css` + `pitch-track.js`, loaded on a mode's first open; pure `lib/practiceModes.ts` ↔
  `assets/practice-modes.js` (same tests). Pitch match: a live needle on the web only (`pitch-track.js`, YIN on the mic,
  the grader's 35/80 cents, reports nothing); phones hold and mark until a store build adds a pitch stream. Harmony plays
  the tune under a take only with headphones on. Wrong notes are grey. The range card's two switches are not built yet.
  Quick games (board s-practice-fun/s3; `Application/Practice/Games`, phone and web): Which note? (doh then a note,
  tapped on the modulator), Staff to solfa (Playful "Note race": a note on the treble stave, its syllable, 60 s) and Name
  that hymn (`HymnOpenings`: 49 well-known hymns' openings cut from the pack by `Cut`, a test checks them against
  `pack.json`). `GET /api/practice/games/{game}` deals rounds rebuilt from the deal id (`game:p|f:seed`, mulberry32) with
  their answers, so the phone tells a tap at once; `POST …/games/grade` marks the answers against the server's deal, once
  per deal, and records a `PracticeKind.Game` session (`GameXp` 5, +3 at 80; `GamesPerDay` 6 count, the rest are for fun;
  no drill allowance, never the path, never "Spot on"). Mobile `screens/practice/PracticeGameScreen`, pure `lib/practiceGames`;
  web the Practice view's Quick games row, `assets/practice-game-view.js` + `practice-games.css` (on first open), pure
  `assets/practice-games.js` (same tests), the rehearsal piano for sound.
  The tab (board s1): the strip card (flame + days · level emblem + XP · week ring, opens `PracticeProgress`:
  `components/practice/ProgressCards`, stat cards, week, badges), the drill card (Playful's Doh inside it, no bubble row),
  the season card as one compact row, Quick games, and the modes as a two-column grid (`ModeList grid`; "Sing more",
  Playful "More ways to play"). The marking moment (board s2):
  "Listening back…" while the take uploads, "Checking each note…", "Still marking — slow connection" after 8 s; then
  `useMarkReveal` lands the marks 120 ms apart (in tune pops with a light buzz and plays as a run, sound on), counts the
  score up, and the reward toast and confetti wait for it; Reduce Motion shows it at once.
- Practice reminders are server pushes to phones only (`Application/Practice/Reminders`, `PracticeReminderWorker` every
  10 min, `PracticeReminders__Enabled`): never web push. The singer's clock is `users.TimeZone` (written by
  `ClientTimeZoneMiddleware` when `X-Time-Zone` changes; null = Lagos). `PracticeReminderRules`: at their hour (8–21, default
  19) on an unpractised day while a streak lives (the freeze day says so), a 21:30 "last chance" for a streak ≥3 the day
  would end (≥90 min after the first), then 1/2/3/5/7/14/30 days after a lapse and one "we'll stop reminding you" at 45;
  ≤2 a local day, never 22:00–08:00; a marked take resets it. On by default once practised or a track is chosen
  (`GET`/`PUT /api/practice/reminders`: enabled, hour, sound). Claim row first (`PracticeReminder`, unique user+local
  date+slot), one retry; `GET /api/admin/practice-reminders`. Words: `PracticeReminderCopy` (Doh's voice; Focused plain;
  title ≤50, body ≤120, tested). Sent only to `DeviceToken.ServerReminders` devices (the OTA code says so on register — the
  native `AppBuild` cannot), on the `reminders` channel with iOS "default" sound, or `reminders-quiet` when the app's sound
  is off. Mobile `lib/practiceReminder` reads/writes it, cancels its old local schedule (kept only as the fallback when
  the server has never answered on that install) and hands the server the old local switch/time once (a "no" stays no).
  Web: the `/app` Practice view (`?view=practice`, a nav entry and the home streak/XP chip) mirrors it — `assets/practice-view.js`
  + `.css` and the pure `practice-progress.js` / `practice-track.js` (mobile `lib/practiceProgress.ts`/`take.ts`/`practiceTrack.ts`,
  tracks included), loaded only when opened; the web app sends `X-Time-Zone` on every API call.
  Tracks, chosen by style never age (`users.PracticeTrack`, null until picked; `PUT /api/practice/track`): Playful (Grades
  1–7, three units each, gentle patterns, slower, id `…~gentle`; stars, stickers, confetti) and Focused (two grades ahead,
  on into Advanced 1–2: wide leaps and 8–16-note sight-singing; exact score, cents, replay). Each track keeps its own place
  on the path. XP and every rule are the same on both.
  Art (our own SVG): `design/practice-art/build.mjs` draws it into `web-site/assets/practice-art/` and mobile `components/practice/art/svgs.ts`
  (a `-blink` twin for each open-eyed pose Doh idles in), and no gold (Pro's alone). Doh beyond Practice (mobile `components/doh`) is
  only: one Home card (`lib/dohSuggestion`; a sheet saved in the last 24 h → Practise this tune, i.e. Learn my part, else Rehearse;
  after 18:00 a 2+-day streak no freeze covers, today unsung → today's drill; the account's first week (`/api/me` `createdAt`) while it can
  transcribe → hello; never two, a card's key on Home one day only, × hides it for good; Settings' "Doh's suggestions", per device, turns
  it off), the result's first-open toast (route `fresh`, once per job, in the player dock's place) and the empty Library (tap for a tip,
  `lib/dohTips`). Never on errors, payments, sign-in or decisions; one Doh on screen; moves `lib/dohMotion` (hop 480, blink 140, tilt 240,
  cheer 520, tap 300 ms; idle stops after 30 s; Reduce Motion: a 150 ms fade, still poses).
  Console: `GET /api/admin/analytics/practice` (`GetPracticeAnalyticsQuery`, web-admin `/practice`; takes and reminders on the singer's
  day, paths replayed through `PracticePath.Read`'s observer, streak breaks from `PracticeMath.StreakBreaks`) and `…/analytics/growth`
  (`GetGrowthQuery`, `/growth`: renewals rebuilt from membership charges, free-to-paid by price set via the shared `FreeLimitReach`, failures by kind, phones by build).
- The season flag (`Core/Entities/FeatureFlag`, `Application/Flags`): a `feature_flags` row per key (`christmas`, `halloween`), off until an
  admin turns it on in the console (Operations › Feature flags, `GET/PUT /api/admin/features[/{key}]`, every change in the audit
  log as `SetFeatureFlag`). On for everyone while enabled and before its switch-off (the midnight WAT after its last day, the
  next 6 Jan by default; one that switched itself off stays off until turned on again); an admin also sees it while
  `AdminPreview` is on (the role confirmed in the database, not the token). Every surface reads the anonymous `GET /api/app/season`
  (`{christmas, halloween}`, a minute's Cache-Control: public, private with a token); nothing carries a date of its own. Pushes read it for
  everyone only, never the preview: Doh's festive lines join the reminder rotation (`PracticeReminderCopy.ChristmasPlayful/Plain`,
  `{carol}` the singer's next carol) and the ready push, phone and web, says `ReadyPushCopy`'s (same timing and limits). Practice:
  the six-drill `CarolPath` (each a run of its carol's notes in `web-site/hymns/pack.json`, a test checks; Silent Night's alto
  labelled from the tune's doh) is served while the season is on for the caller (progress `season`, `GET /api/practice/carols`),
  graded by `drills/grade` like any drill and never moving the main path; all six passed in season earn `carol_singer`, kept for
  good. The carols carry `occasions: ["Christmas"]` in `content/hymns`, and the hymn pack carries `occasions`.
  Clients (board d-christmas), nothing at all while off: tints only (pine #2E8A66 Night / #1F6B50 Day, candle #F3DFB4 for
  small Night labels, holly on the cap alone, never Pro gold). Mobile: `lib/seasonStore` reads the flag at start, on
  foreground and on an account change and keeps it per device (`nf.season`), so `lib/appReady` dresses the splash before
  the network: once a season (`nf.seasonIntro`, keyed by the year it starts) the full intro with the cap dropping on,
  ~14 flakes gone by 6 s and "Joy to the world" (d' t l s, `lib/seasonChime` on `lib/synth`, never with the app's sound
  off), after that the cap alone; pure rules (snow, cap placement, chime notes, the carols view) in `lib/season.ts`. The cap
  (`components/season/Cap`, art `season-cap`) sits on the brand mark (splash, Home's header; never a control) and on Doh
  in Practice only. Home asks "What are we singing this Christmas?" with a pine Carols chip and one session's flakes;
  Hymns shows "Carols for Christmas" (`hymnPack.carols`, each card its opening solfa; search finds occasions, "carol"
  for Christmas); Practice's pine card opens `screens/practice/CarolsScreen` (graded like any drill, the tune under a part
  only with headphones; the Carol singer sheet with snowflake confetti and the whole line). Web: `assets/season.js` on
  every page (one fetch; on, `data-season` and `season.css`: the header's cap, the hero's pine line to
  `/hymns/occasions/christmas`, the Silent Night sample from `<template id="season-sheet">` (render-home.mjs), flakes in
  `[data-season-snow]`; the site never chimes); /app's question and "Sing the carols · n of 6"; the Practice view's card
  and `assets/practice-carols.js` (+ .css, on first open; the line plays after the sixth take, with sounds on).
  Halloween (`halloween`, board j-halloween) is the second season on the same pieces: one season at a time (turning one on
  switches the other off, in the trail; Christmas wins an admin's double preview), its default last day 1 Nov, All Saints' Day
  (`FeatureFlags.DefaultLastDay(key, …)`). A season's practice path is a `SeasonPath` (`CarolPath`; `HalloweenPath`, the
  Midnight path: six drills from the songs for Halloween, the last Chopin's Funeral March, `midnight-` codes, `GET /api/practice/seasons/{season}` beside
  `/carols`); progress, badges (`carol_singer`, `night_singer`), the recorder and grading read the season on (`string? season`);
  `PracticeReminderCopy.HalloweenPlayful/Plain` (`{song}`) plus `HalloweenLastNight` on the path's last day for a singer who
  started it; `ReadyPushCopy.ForSeason`. The songs carry `occasions: ["Halloween"]` (the All Saints tunes `["All Saints",
  "Halloween"]`; page `/hymns/occasions/halloween`, written for US/UK readers after spooky songs to sing and play: its own
  title, heading and description, the best known first and the All Saints hymns last, `first`/`last` in `collections.mjs`
  OCCASIONS, the app's Halloween shelf in the same order, `lib/hymnPack` `HALLOWEEN_ORDER`). Clients: the witch hat (`season-hat`; its purple #5B3A9E on the hat only)
  on the mark and Doh, Boo (`boo*`, on the Midnight path only, always beside Doh), bats (`bat` in currentColor,
  `confetti-bat`), pumpkin tints only (#F28A3A Night / #B4531C Day, never an icon or flame; moon #EDE6CF labels), the Mountain
  King chime (`l, t, d r m d m`) once a season; mobile `components/season/Costume|Bats|Crescent`, `lib/season.ts` per season,
  `screens/practice/SeasonPathScreen`; web `season.js` (`data-season`, `[data-season-sky]`, `#season-sheet-halloween` from
  `render-home.mjs`), `practice-carols.js` for either season; the console's `FlagsView` both seasons with a switch confirmation.
- Saved transcriptions carry lyrics, the SATB parts (JSON column, solfa derived on read),
  the opening eight notes as `preview` on every read (list rows show them in solfa), an
  optional folder name (`PUT /api/library/{id}/folder`; a folder is just the name its sheets share) and
  an optional public share token (`GET /api/shared/{token}`, anonymous). A `FolderShare` is one public
  link for a whole folder (`GET /api/shared/folders/{token}`), which lists every sheet filed in it,
  opened through the folder link (`GET /api/shared/folders/{token}/sheets/{id}`, only while filed in it); a
  folder share never gives a sheet a token of its own. "Transpose for my
  choir" is the one edit that moves the notes: `Transcription.Transpose` shifts melody, parts
  and key and respells both scores with `Core/Notation/MusicXmlTransposer`, and counts `TransposedBy` (0 = as heard).
  Song backing (board o-backing): filing keeps `BeatOriginSec`/`BeatTimesSec` (written out at the heard tempo when a sheet
  with a backing has none, so tempo edits never move it) and, for the owner's own upload only (never
  `FromLink`), the separated instrumental (`IBackingStorage`: R2 photo bucket, unguessable `BackingKey`, not backed up;
  Save moves it), owner-only at `GET /api/library/{id}/backing`; jobs say `hasBacking`, take `?backing=false`, serve
  `…/jobs/{id}/backing` while held; `BackingCleanupInterceptor` deletes it with the sheet or the account.
  The worker's `beat_times_sec` (separated songs with a backing only; `transcriber._beat_map`, bench
  `python -m tests.accuracy.song_clock`) is notation beat i's time in the recording, so a band that drifts stays in
  step (the rounded `tempo` alone drifts by beats); clients map a beat through it (`lib/backingClock.ts` ↔
  `assets/backing-clock.js`, same tests), play the backing pitch-kept under the solfa with a Solfa↔Backing balance (the
  backing its share and the solfa the rest, never adding up past full: two at full clipped on every loud beat; the web's
  backing goes through the piano's soft limiter), move it while both play only for a drift that holds (`watchDrift`: past
  80 ms for 400 ms, a small one at most every 3 s; a silent 40 ms placement before it starts; the phone reads the backing
  between two reads of the solfa and compares only a pair within 40 ms, `solfaAtBackingRead`: each native read waits on
  the main thread, and while the balance was dragged or four parts drawn the wait read as a drift and moved the band), and
  sit it out while `transposedBy` ≠ 0 (Save sends `transposedBy` for a client-side transpose).
  Every finished transcription is filed in its owner's library the moment its job is settled Done (option A,
  board 12: `Library/LibraryFiling`, from `GetTranscriptionJobQuery` and `NotifyTranscriptionReadyCommand` under the
  save lock, one sheet per job, a deleted one stays deleted; `AutoSaveFinishedTranscriptionsCommand` is the fallback):
  named after the hymn it recognised, else "Recording · Sun 17:10" in `users.TimeZone`, gated by `ProGate.ForFree` for
  a free owner, `SavedAutomatically` and unopened until `POST /api/library/{id}/opened` or a rename (only then
  counted as kept: `KeptSheets`); the job DTO carries `savedId`/`savedTitle`, so the phone's Result opens it saved
  (Rename for Save, "Saved to your Library" toast, edits saved as made) and the Library marks it with a blue dot.
  A job closed as lost keeps `FailureCode = "JOB_LOST"` on its row, so the code is answered for as long as anyone asks;
  `POST /api/transcriptions` takes an `Idempotency-Key`, unique per account on `TranscriptionJob`, and a repeat is
  handed the first job (never a second job or charge). The web app's Save still replaces the filed copy.
- The website is the top of the funnel: `POST /api/preview` / `/api/preview/link` make an anonymous
  30-second preview (one per `X-Device-Id`, ever — one running or succeeded; a failed one, a link YouTube refused,
  is not it — none without one or on a device an account has used, and 10 attempts a day per address, via
  `PreviewJob` rows), polled at
  `GET /api/preview/jobs/{id}` (and settled by the worker's webhook and the completion sweep,
  `SettlePreviewJobCommand`, so a closed tab does not leave one running) and claimed by the account that signs up (`POST …/claim`). Users carry
  a `SignupSource` ("web"/"mobile"), sheets count `ShareViews`, and `GetAnalyticsOverviewQuery`
  turns those rows into the admin dashboard's web funnel. Page views, clicks and web-app actions
  are first-party: `web-site/assets/track.js` batches them to the anonymous `POST /api/web/events`
  (`WebEvent` rows, account-linked when a token is sent; `window.nfTrack("Saved sheet")` names an
  action) and the overview's `WebTraffic` section reads them back; the queue is kept in localStorage (`nf.web.events`, ids
  per event, removed only after a 2xx, retried, a week at most) and a hidden or left page's batches go by `sendBeacon` to
  `POST /api/web/events/beacon` (text/plain JSON, device id and, signed in, the token in the body). A page load's first page
  view also carries its link's campaign tags (`utm_*`, `?ref=`/`?via=`, `campaignFrom`); the API keeps the browser and system
  families (`Web/UserAgentFamily`, never the user agent; a bot's batch is dropped) and the country (geo lookup cached 12 h
  per address, never the address) on every `WebEvent`. Blog, hymn, free tool and comparison pages add
  `assets/blog-track.js` (`blog_view` with source/UTM, `blog_read` = ≥50% of the article AND ≥30 s visible,
  `blog_read_complete`, `blog_engagement`, `blog_cta_click`, `blog_share`, `hymn_play`; details `k=v;…` with a `pv`
  page-load id), read by the console's Blog analytics (`GetBlogAnalyticsQuery`, `GET /api/admin/analytics/blog`; kinds
  post/hymn/tool/compare/index, and a tool page's converter tries: the try box's "Preview started" actions on it):
  first touch, 30 days, over browsers whose first blog page is in the window; a browser is tied to an account by its
  token-carrying events or its device id on a job/preview (floors: the phone app and other devices are missed).
  No third-party analytics.
- Free tools and comparisons (`tools/blog/lib/render-tools.mjs`, built with the hymns; `/tools`, `/tools/<tool>`,
  `/compare/<app>-alternative`): one page per search people make that NoteFusion answers (convert a song to Tonic Solfa,
  hum to sheet music, YouTube to sheet music, sheet music to solfa, the solfa of worship songs), each the home page's own
  try box (same ids, its assets at the home page's versions in `ASSET_VERSION`: bump both together) and real sample
  sheet. A comparison says of the other app only what its own listing or website says, names that source and date, never
  its price or ratings. No AdSense on the home page or these pages (`page({ ads: false })`); the blog and hymn pages keep
  it. Every post's and hymn's CTA box points to the converter. The Play listing's words live in `docs/STORE_LISTING.md`.
- The blog (`docs/BLOG.md`): posts live in the database (`BlogPost`; `Application/Blog`), written, checked and
  published in the admin console's Blog section — no post files in the repo. Publishing, unpublishing, archiving,
  a live edit or a scheduled post going live stages a `BlogSiteRebuild`; the `BlogSiteWorker` coalesces them into
  one GitHub `workflow_dispatch` of `deploy-web.yml` (20 s quiet, at most one per 2 min; `GitHub__Token`), whose
  `tools/blog/build.mjs --api` renders the live posts from the public `GET /api/blog/published` at deploy time
  (the committed `web-site/` is built from `content/` alone; the deploy fails rather than ship without the blog).
  `BlogChecks` mirror the build (links read as the browser reads them, character references decoded, in both `safeUrl` and
  `BlogChecks.AsBrowserReadsIt`; a cover address that could end its attribute is refused): blockers (what would break it, incl. ```solfa blocks checked against the site's
  `/blog/catalogue.json`) stop publishing; advice is the old drafter's quality checks. Gemini (`Gemini__ApiKey`,
  through `OutboundResilience`) drafts from the `BlogTopic` queue on demand (1–10, a `BlogGenerationRun` the
  `BlogDraftWorker` writes) and Mon/Thu 05:30 UTC, one revision round, tokens recorded; a draft that passes every check publishes itself (`Blog__AutoPublishDrafts`,
  default on; one with problems stays a Draft). A 429/5xx
  or dropped call is tried 5 times (15/30/60/60 s, `Retry-After` wins), then `Gemini__FallbackModels`
  (`gemini-flash-latest`, `gemini-flash-lite-latest`, 2 tries each; never on 401/403 or a block); the revision uses
  the model that wrote the draft. The prompt spells out bars only for hand-made hymns (catalogue `imported: false`)
  and hymns the topic must link to; every hymn page stays linkable.
- The X build journal (`docs/SOCIAL.md`, `tools/social`): `x-build-journal.yml` (Mon/Wed/Fri) posts one merged PR
  or `backlog.json` angle with a phone screenshot of the built site against demo fixtures (mocked API, never the
  admin console), drafted by Gemini in `voice.md`'s voice and checked in code; history on the `x-journal-state`
  branch, never main; a dry run (artifact only) unless `X_POSTING_ENABLED=true` and the four `X_*` secrets are set.
- Billing: naira plans are charged through Paystack, dollar plans through Bachs; currency routes the
  charge (`PaymentGatewayFactory.SelectForCurrency`). Flutterwave Standard is built for dollars beside Bachs
  (live with key + secret hash; each adapter is handed its own options, never one from the container) and
  takes them only once `Billing__DefaultProvider=Flutterwave` (docs/DEPLOYMENT.md §1.2). The Android app pays through
  Google Play Billing alone (§1.3; web unchanged): products `pro`/`choir` (auto-renewing, base plans `monthly`/`yearly`)
  and `one_song`; the app's token (`POST /api/billing/google-play/purchases`) and Google's Pub/Sub notifications (OIDC,
  `…/notifications`) only name a token — `Billing/GooglePlay/GooglePlaySync` reads Google, ties the token to one account
  (`GooglePlayPurchase`, unique token; obfuscated account id = user id, but only the account's own app call ties a new token, never a notification alone), records each charged order once
  (`PaymentProvider.GooglePlay`, order id as reference, Google's order total) through `PaymentFulfillment`, makes the
  membership follow Google's expiry (`FollowStore`: renewals, grace, hold, cancel, refund), and acknowledges/consumes;
  `GooglePlaySyncWorker` backstops. A Play membership renews by itself, so the website's checkout and cancel refuse it
  (`BILLING_MANAGED_BY_GOOGLE_PLAY`), it gets no expiry email, and `SubscriptionDto` says `billedThrough`/`autoRenews`/
  `paymentIssue`. Every web checkout is a one-off priced from the
  `Plan` row (`Recurring: false`): Bachs subscription checkouts need a card it can save and this
  account offers none for USD (`CHECKOUT_CANNOT_SAVE_PAYMENT_METHOD`), so no catalog product is
  needed and a price change is a new plan code in `BillingSeeder`. Nothing renews by itself: a member
  buys again to add a period, which stacks after the time left (`PaymentFulfillment`), on either plan;
  two payments landing at once both stack (`Subscription.Version` is a concurrency token and the save is
  retried). Plans are offered by the account's stored country (`PlanEligibility`), one set per known country:
  Nigeria gets naira; the lower-income markets in `PlanEligibility.RegionalCountries` (every African country but
  Nigeria, and IN PK BD LK NP ID PH VN MM KH LA) get the regional dollar set (codes carrying `_regional`: Pro
  $4.99/$39.99, one song $1.00: Bachs refuses a checkout under 1 USD); everyone else the standard dollar set; an unknown country sees naira and
  standard dollars, never the regional set. Checkout refuses a plan from another set
  (`BILLING_PLAN_NOT_AVAILABLE_IN_REGION`). Each set has a one-song purchase (₦1,500 / $1.99 / $1.00) listed
  beside Pro for free accounts only (served apart at `GET /api/billing/plans/single`, never in `/plans` or
  `public-plans`, which older clients label as Pro; hidden for Pro, refused at checkout with `BILLING_SINGLE_NOT_NEEDED`); the
  clients offer it first wherever the free limit is hit. It is revenue collected on the dashboard, never
  run-rate/MRR (those read memberships, and a single purchase starts none).
  `BillingReadiness` logs at startup if a plan on sale has no live provider. Provider and server
  error text never reaches a screen: the API returns plain sentences for checkout failures, and the
  web (`friendlyMessage`) and mobile (`toApiError`, `safeReason`) clients replace anything technical.
  A checkout that comes back unpaid is asked "What stopped you?" once (mobile `CheckoutExitSheet` + `lib/checkoutExit`,
  web `assets/checkout-exit.js` + `checkout-why.js`): `POST /api/billing/checkouts/{reference}/exit` re-verifies, records the
  return and seconds open and the one-tap answer on a `CheckoutExit` row (goes with the account), and asks only on the
  provider's fresh word; every verification keeps the page's strongest signal (`PaymentTransaction.ProviderAttempt`, never
  read by fulfilment) for Growth's "Why checkouts end unpaid" (anonymous counts) and the console's Unpaid checkouts page
  (`/checkouts`, `GET /api/admin/analytics/unpaid-checkouts`, `GetUnpaidCheckoutsQuery`: every checkout opened and not paid, one
  row each with the account, what the page saw, the answer and whether they paid later). A same-currency Bachs charge above
  the session's price (the processing fee passed to the payer) verifies at the session's price; one below it is escalated.
- Founder outreach (`Application/Outreach`, `Infrastructure/Outreach`): an hourly worker writes customer-research
  notes from the founder (email with Reply-To the founder + a one-line push when a device is registered) to four
  segments in priority order — unpaid checkout ≥3 days old (and ≥2 days after `RemindAbandonedCheckouts`, which in
  turn holds off a day after any outreach), active free user, tried once then quiet 5 days, never transcribed after
  2 days — once per segment per account ever, at most one a week, 09:00–19:00 in the account's own `users.TimeZone` (WAT when unknown), `Outreach__BatchSize` (5) per run.
  `OutreachMessage` rows are the claim (unique user+segment+channel) and the audit trail (`GET /api/admin/outreach`);
  a failed send is retried once. Email respects `EmailOptOut` (signed one-click `GET/POST /api/email/unsubscribe`, or the
  app's "Notes from the founder" switch, `GET/PUT /api/me/email-preferences`);
  push respects the app's switch (it unregisters the device). Off unless `Outreach__Enabled` + `FounderName` +
  `ReplyTo` are set (prod defaults them on; the code default is off).
- Seasonal offers (board p-halloween-offer; `Application/Offers`, `Infrastructure/Offers`): an `Offer` row (template
  `halloween`/`christmas`, percent, Pro Monthly/Yearly, `StartsAtUtc`, `LastDay`, the email's words with `{pct}`) is a lower
  Pro price on the web only — dollar plans (standard and regional), never naira, choir, one song or Google Play.
  `OfferPricing` rounds down to the plan's own ending ($9.99→$6.99, $79→$55); `OfferWindow` ends it at midnight after
  `LastDay` in each person's own zone (`users.TimeZone`, a visitor's `X-Time-Zone`, else London; capped at UTC−12), one
  enabled offer at a time, and only while its season flag (the template's key) is on for everyone (`OfferSeason`: off, it
  shows nowhere, checkout charges the usual price, its email waits and a link says it has ended; the console says why). `GET /api/offers/current` (anonymous too) is what the clients read; checkout takes `offerKey`
  and stamps `PaymentTransaction.OfferId` (refused `BILLING_OFFER_ENDED`; a session opened before the end is handed back
  for the reuse window, and a payment is verified against its own amount). Web: `assets/offer.js`/`.css`, loaded only
  while one runs: /app's Home strip with the countdown for free accounts, `?offer=&m=` (click → `POST /api/offers/click`,
  then the plans), offer tags and struck prices in the plans, and the website's Pro cards. Console Operations › Offers
  (`web-admin/src/app/(console)/offers`; `/api/admin/offers`: create from a template, preview, test, audience, send and
  switch on behind a fresh unlock, pause, progress). Send snapshots `OfferEmail` rows (free and lapsed Pro by default;
  "Pro now" a tick; never naira, no country, opted out, store/choir Pro, or an outreach email in the last 7 days), and
  `OfferEmailWorker` sends them as optional mail (`EmailKind.Offer`, held by the quota) 09:00–19:00 in each person's time,
  lapsed first, skipping anyone who bought or ended. The email (`BrandedEmailTemplate.Offer`, header
  `web-site/email/season-*.png`) needs `Email__PostalAddress` (the footer's postal address, "NoteFusion · {it}"; production's compose default is
  651 N Broad Street, Middletown, DE 19709, USA; Send is refused while it is blank) and its unsubscribe is the founder-notes `EmailOptOut`, shown as "Notes and offers from NoteFusion".
  Opens, clicks and purchases are counted: a sent email (never a preview or test) carries a 1×1 GIF,
  `GET /api/offers/o/{token}` (`RecordOfferOpenCommand`, first load only, `OfferEmail.OpenedAtUtc`; a click counts as an open).
- Email quota (`Application/Common/EmailBudget`, `Infrastructure/Email/EmailQuota`): every email Resend accepts is an
  `email_sends` row (kind + time); optional mail (welcome, waitlist, checkout reminder, failed-job tips, outreach) goes only
  while each capped window — last 24 h `Email__DailyLimit` (100), 7 days `Email__WeeklyLimit` (none), 31 days
  `Email__MonthlyLimit` (3000) — is under `Email__OptionalShare` (0.6) of its cap, counting every kind; codes, resets,
  receipts, security, expiry, admin and backup mail always send. Batches ask `IEmailQuota` before claiming, so held mail
  stays due (outreach holds both channels); inline welcome/waitlist is skipped. Usage on System Health.
  The console's Mail (`/inbox`): Inbox (Resend inbound) and Sent (`?box=sent`, Resend's own sent log read by
  `ResendSentMailService`, `GET /api/admin/inbox/sent[/{id}]`, each with its latest event): a code in a subject is masked and
  the body of a code, password reset or deletion-confirmation email is never sent (`SentMailPrivacy`, whose subjects the templates use).
- The activity log (board-less; `Core/Entities/UserActivity`, `Application/Activity`): what accounts do, recorded where it
  happens so no client can lose it. `TokenIssuer.IssueForSignIn` writes every fresh sign-in (`sign_in`, method + client;
  a refresh or password change issues tokens but is not one; sign-ups `sign_up`), and `Api/Common/UserActivityFilter`
  (global) writes every successful signed-in POST/PUT/PATCH/DELETE as `controller.action` with its route ids — never the
  body — plus GETs marked `[RecordActivity]` (opening a sheet); admin routes (their own audit log) and `[NoActivity]`
  ones (already recorded elsewhere: submits, saves, sign-ins, events, device heartbeats) are left out; `POST /api/billing/confirm`,
  asked on every return to the app, writes "Came back from a checkout" itself only for a checkout in flight, once per
  checkout, naming its plan (`ConfirmPaymentCommandHandler.RecordReturnAsync`). Readable lines in
  `ActivityNames` (a name without one shows as itself). The phone sends every action first-party too
  (`lib/appEvents`: each `logAnalyticsEvent`, screen views, record/play/save/share/export, checkout, settings, errors
  shown; ids per event, written to the phone 600 ms after the tap (one write for the taps of a moment, at once on going to the background), kept until a 2xx, retried, cleared after a sign-out flush), and the website's `track.js` keeps its
  queue in storage with ids and retries (a page-leave beacon carries the token, validated by `WebEventsController`).
  `AppEvent`/`WebEvent.ClientId` make a resent event count once; web `ageMs` is believed up to a week; the web-events
  limit is 300 a minute per address. The Activity feed (`GetActivityFeedQuery`: kinds signup, login = every sign-in,
  transcription, saved, payment, activity, app, action), the overview's Recent activity and an account's journey read it
  all (phone events the server also records, `ActivityNames.ServerTwinAppEvents`, are left out of the feeds). Kept
  `UserActivity.RetentionDays` (730); deleting an account deletes its rows and leaves one nameless `account_deleted`.
  The migration backfilled past sign-ins from refresh tokens that replaced none.
- Error reports go to Sentry (docs/DEPLOYMENT.md, "Error reports"), one project per surface, each off until its DSN is
  set: the API (`Sentry__Dsn` from `SENTRY_DSN_API`; unhandled exceptions and `LogError` lines, SendDefaultPii off, every
  email address masked by `Api/Common/SentryScrub`; the SDK's own background transport is the one outside client not
  behind OutboundResilience), the worker (`NF_SENTRY_DSN`, `app.telemetry`: crashed jobs and 5xx only, no bodies or
  locals, URLs and emails masked), `/app` only on the web (`assets/errors.js`: nothing loads until the site's own code
  throws, then the self-hosted `assets/vendor` bundle; `deploy-web.yml` writes `SENTRY_DSN_WEB` into the deployed page)
  and the phone (`App.tsx`, IP address, the account's id (`Sentry.setUser`, nothing else) and recordings of 1 in 20
  sessions and 1 in 10 with an error (a sampled session is screenshotted every second from its start, which taps felt) that show the screen as it was except password fields and Admin, its sheets
  included (`lib/replayPrivacy`: `SecretField`, `PrivateArea`, `MaskIfPrivate` on `Sentry.Mask`; a build without the native
  mask view keeps masking everything), as the privacy policy says; source maps from the
  `@sentry/react-native/expo` plugin on store builds and `eas env:exec production 'npm run update:production'`
  for OTA, which reads `SENTRY_AUTH_TOKEN`/`ORG`/`PROJECT` from EAS; the store build of 20 Oct 2026 dropped `eas.json`'s
  `SENTRY_DISABLE_AUTO_UPLOAD`, and as `eas.json` is part of the Android fingerprint that began a new runtime: while
  phones still run the older store build (runtime `6c685cab`), an OTA is also published with that line put back). Never the public pages. The console's Sessions page (board k-sessions, `/sessions`,
  `GET /api/admin/sessions/recordings|errors…`, `Application/Admin/Sessions`, `Infrastructure/ErrorReports` over
  `OutboundResilience.SentryApi`) reads the recordings and every project's errors with a read-only token
  (`SentryApi__Token`/`__Org` from `SENTRY_API_TOKEN`/`SENTRY_ORG`), plays a recording's MP4 pieces through the API (kept
  nowhere) and links each account; Admins only, behind the console lock; read again every 30 s while open.
- Live support (`Application/Support`, `SupportController` + `AdminSupportController`): one thread per account (`SupportConversation`,
  `UserId` unique) or per website visitor (`X-Support-Key`, a random key the browser keeps; only its SHA-256), `SupportMessage`s of at
  most 2000 characters, 15 a customer in 5 minutes (and the `support` rate limit per address). Each message is told live on the
  `IJobEvents` key `support:{id}` (the customer's `GET /api/support/events`) and to the console (`AdminLiveFeed` "support": the
  Support page and its nav badge); a customer's run of messages pushes the admins' consoles and phones once (again after 2 minutes
  or once read), an answer pushes the customer's phone (`data.screen` "SupportChat") and web app (`/app?support=1`) only when their
  chat is not open. The website and /app carry `assets/support.js` (the button inline, the chat and `support.css` on the first tap;
  above the tab bar and the mini player); web-admin `/support`. Threads go with their account.
  The phone: `screens/SupportChatScreen` (route `SupportChat`, its stream by XHR while in front, a read every 15 s otherwise),
  the one floating `components/SupportBubble` on Home only (a dot for an unread answer, `lib/supportSeen`), and "Chat with us" in
  Profile and Help; pushes `SupportChat` (the customer) and `AdminSupport` (an admin: the console's Support page).
  Home's one-time `components/WhatsNew` sheet (Android, never the first session or over another sheet, `lib/whatsNew`) shows
  transcribing from any app (Listen tile / floating button) and Find the key.
- Wire contract is **camelCase**; the C# `ApiError` envelope is `{code, message, details?}`.
  The mobile `src/api/types.ts` mirrors the C# DTOs exactly — change both together.
- No secret ever in the repository: `.github/workflows/secret-scan.yml` (gitleaks, `.gitleaks.toml`) fails pull requests,
  main and the first job of every deploy on a finding (docs/DEPLOYMENT.md, "Secret scanning").
  **Never commit or push an `appsettings*.json`** (`appsettings.json`, `appsettings.Development.json`, any project's):
  they are in `.gitignore`, never `git add -f` one, and secret-scan's first step fails a change that tracks one; their
  keys belong in the environment.
  Every workflow action is pinned to a commit SHA (version in a comment), and the SSH steps check the server's ECDSA
  host key against the variable `EC2_HOST_FINGERPRINT` (docs/DEPLOYMENT.md, "Pinning the server's host key").
- Config is env-driven: nested keys use `__` (e.g. `Database__Host`, `TranscriptionApi__BaseUrl`).
  The same image runs in dev and compose with only env changes.
- **Mobile first, always**: most users arrive on phones. Design, layout and performance are judged at 360–414 px on a
  mid-range Android over 3G/4G first (Lighthouse mobile; budget and how to measure in `web-site/README.md`), desktop
  second. CSS base styles are the phone's, `min-width` queries go upward; tap targets ≥ 44 px, inputs ≥ 16 px, no
  horizontal scroll, dialogs fit `100dvh`; images sized for phones (AVIF/WebP `srcset`), fonts self-hosted
  (`assets/fonts/`), heavy libraries (OSMD, jsPDF, the piano) loaded only when needed; a changed CSS/JS file gets a new `?v=`.

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
