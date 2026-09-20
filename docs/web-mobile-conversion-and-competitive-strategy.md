# NoteFusion web–mobile conversion and competitive strategy

## Executive recommendation

**Yes: NoteFusion should expose a carefully limited transcription experience on the web.** The web should be the acquisition and proof surface: a visitor lands from search or a shared result, uploads a short rights-cleared clip, sees a useful transcription preview, and then chooses whether to create an account, continue on mobile, share the result, or upgrade.

The web should **not** become a complete replacement for the mobile app in the first phase. Mobile should remain the strongest surface for recording, importing from the device, reviewing confidence, correcting notes, playing and looping the result, receiving completion notifications, maintaining a personal library, and practising repeatedly.

The product loop to build is:

> **Public web discovery → safe free preview → account or mobile handoff → mobile correction and practice → permissioned sharing → collaborator or teacher return → paid upgrade when the user needs more usage, exports, or collaboration.**

This is more defensible than copying a generic browser recorder. It combines NoteFusion’s existing **movable-do Tonic Solfa plus staff notation**, mobile-first capture, confidence-aware correction, and a permissioned review loop.

## What the repository already has

The codebase is closer to this strategy than the current public website suggests.

| Area | Current capability | Strategic significance |
|---|---|---|
| Public web | `web-site/` is a static, unauthenticated landing site with a hero sample, feature explanation, FAQ, location-aware pricing, waitlist CTA, legal pages, and app-download links. It does not currently call the transcription API. | The public site can become a low-friction acquisition and preview shell without disturbing the mobile client. |
| Mobile capture | `RecordScreen` supports native recording, audio import, melody/poly modes, key and tempo inputs, recording-level guidance, a 180-second cap, job polling, and push-notification permission at the moment of submission. | Recording and “capture now, practise later” are natural mobile advantages. |
| Mobile results | `ResultScreen` supports staff and solfa views, confidence badges, note-level correction, guided review, key/tempo/meter changes, playback, MusicXML/MIDI/Solfa exports, and saving to the library. | This is the retention and paid-value core. It should remain mobile-first while web provides a read-only or lightweight review companion. |
| Mobile retention | The authenticated shell has Home, Library, Record, Piano, Profile, Result, Settings, Help, Upgrade, notifications, and practice reminders. | There is already a repeat-use loop to deepen rather than replace. |
| Python engine | The asynchronous FastAPI service accepts multipart audio, returns a job ID, supports melody/poly modes, and exposes job status/result polling. The recent branch adds contour-aware gap fusion and a warmed Basic Pitch model accessor. | Web can reuse the existing asynchronous job contract instead of creating a second inference engine. |
| .NET business API | `TranscriptionsController` is authorized, receives multipart audio, creates jobs, and exposes job polling. `WaitlistController` is anonymous. Billing and plan eligibility already exist. | A web preview needs a separate, explicitly limited anonymous/verified policy rather than weakening the existing authenticated endpoint. |
| Free controls | The domain includes free allowance enforcement, idempotent `ConsumeTrial`, `TrialDevice`/job-fingerprint work, and a `BILLING_FREE_TIER_LIMIT` error. | The existing quota model can be extended for web preview accounting, but browser requests must not bypass server-side enforcement. |
| Admin | The admin dashboard already has analytics overview, user pages, payments, webhooks, audit support, and transcription aggregates. Current overview includes users, saved transcriptions, success/failure, confidence, retention, keys, signup methods, devices, and recent activity. | Conversion and abuse reporting can be added as a first-class funnel rather than inventing a separate admin system. |
| Current gap | Analytics is account/transcription-centric. It does not yet represent anonymous preview start, preview completion, mobile handoff, share opens, quota exhaustion, abuse decisions, or paid conversion attribution. | The first web feature should ship with event and funnel instrumentation, not as an unmeasured marketing experiment. |

The public-site README explicitly states that the current site is unauthenticated and does not talk to the API, and that the Record, result, and Library screens are not yet represented on the site. That is a useful boundary: add a deliberate preview route or small web app rather than quietly turning the marketing site into an ungoverned client.

## Recommended web versus mobile allocation

| Priority | Capability | Lead surface | Keep on the other surface |
|---:|---|---|---|
| 1 | Landing pages, use-case pages, SEO content, sample results, waitlist, and plan comparison | Web | Link directly into mobile capture and practice. |
| 2 | Short, safe transcription preview | Web | Continue the same job in mobile after account verification. |
| 3 | Recording, microphone permissions, device-file import, upload progress, and push completion alerts | Mobile | Web may accept a file upload, but should not compete with the mobile capture experience. |
| 4 | Full result review, confidence highlighting, note correction, playback, looping, tempo/key changes, and practice history | Mobile | Web can offer a read-only viewer and later a precision editor. |
| 5 | Shareable result viewer with audio excerpt and notation | Web-led | Mobile creates the link and chooses permissions. |
| 6 | Fast correction | Mobile quick-fix | Web precision editor with keyboard shortcuts and a larger timeline later. |
| 7 | Library, job history, quota, billing, invoices, and export centre | Web-led | Mobile must still reopen saved work and show quota state. |
| 8 | Teacher/band review links, comments, and version history | Web-led | Mobile receives notifications and supports quick replies. |
| 9 | Billing policy, trial-device/job controls, support tools, and operational analytics | Admin web only | Never rely on client-side plan enforcement. |
| 10 | Developer/API distribution | Developer web console | Keep mobile as a client of the same entitlement and provenance system. |

### Capabilities that should remain distinctly mobile

The mobile bundle should be **capture, full-result immersion, practice, and personal continuity**. It should include one-tap recording, device import, upload status, background completion notification, synchronized score/audio playback, looping, tempo and key changes, quick note correction, offline project caching where feasible, the personal songbook, and daily practice reminders.

This is the reason to install the app after a visitor has already seen the web proof. The install CTA should say **“Practise this on mobile”** or **“Keep this transcription in your library,”** not only **“Download the app.”**

### Capabilities that should be web-led

The web should own **discovery, preview, sharing, account creation, billing, history, large-screen review, collaboration entry points, and admin operations**. It should also host search-oriented pages for singers, choir directors, worship teams, music teachers, instrumentalists, and arrangers.

Do not promise multi-instrument accuracy, full-song quality, or supported instruments that have not been measured on representative audio. The web should show supported-input guidance and confidence rather than implying perfect transcription.

## The free web transcription funnel

This design is a recommendation to test, not a permanent quota decision.

### Step 1: intent-first landing

Give visitors three clear choices:

- **Transcribe a recording**.
- **Record a melody**.
- **See a sample result**.

Use a rights-cleared NoteFusion sample that shows the original audio, staff notation, movable-do Solfa, confidence highlighting, and a corrected note. Avoid using commercial recordings as marketing samples without permission.

### Step 2: anonymous preview

Allow one short preview per risk-scored device/session. A reasonable starting point is the first **20–30 seconds** or one detected section. Klangio exposes a no-login 20-second demo and AnthemScore Web exposes 30-second previews [5] [8]. These are competitive patterns, not proof that NoteFusion should use exactly those limits.

The preview should be:

- Useful enough to demonstrate quality.
- Watermarked or limited in export.
- Private by default.
- Deleted automatically after a short retention period unless saved.
- Explicit about what is locked: full duration, editable exports, history, advanced correction, and practice tools.

### Step 3: show proof, not a spinner

The preview result should show:

- Staff notation and movable-do Solfa.
- A synchronized audio cursor or waveform.
- Confidence highlighting for uncertain notes.
- A short playback control.
- A visible “Continue in mobile” action.
- A visible “Save this result” action.

A result page that only says “processing complete” is a missed conversion opportunity. The user needs to understand the distinctive value before being asked for an account or payment.

### Step 4: convert to an account without destroying momentum

Require email verification to save the preview, reopen it later, or submit a substantial second job. Preserve the preview across signup. Then deep-link to the mobile app or show the store link with a web fallback.

Do not force an app install before the visitor can judge quality. That adds friction before the product has earned trust.

### Step 5: verified free allowance

After verification, offer a small, explicit allowance. For example:

- One short full job per month.
- A small number of previews.
- A short maximum duration.
- PDF or read-only result access.

The exact allowance should be chosen from cost and conversion data. The interface must clearly show remaining allowance and state that deleting a job does not restore it. Moises uses an explicit five-upload monthly gate [2] [3]; NoteFusion should adopt the clarity, not necessarily the number.

### Step 6: paid conversion

Gate the features that correspond to recurring value:

- Longer clips.
- More monthly jobs.
- Priority processing.
- Full editable exports.
- Saved versions and collaboration.
- Higher-fidelity or advanced instrument workflows after validation.

Start with one consumer Pro path if multiple plans would confuse first-time users. NoteFusion already has regional pricing logic and a waitlist; use that policy consistently across web and mobile rather than hard-coding separate plans in JavaScript.

### Step 7: mobile continuation

The strongest post-preview CTA is **“Practise this transcription on mobile.”** The mobile app should reopen the same job, preserve its notes, and take the user to the next useful action: correct, loop, slow down, transpose, save, or share.

## Efficient admin tracking and anti-abuse design

The current `TrialDevice`, job-fingerprint, and idempotent trial-consumption work is a good foundation. The web layer should add a separate preview policy rather than weakening authenticated transcription.

| Control | Recommended implementation | Admin view |
|---|---|---|
| Job identity | Server-side job ID plus signed upload token. Store source type, duration, codec, model/version, preview/full status, retention deadline, and deletion status. | Lifecycle: created, uploaded, queued, processing, preview-ready, completed, failed, deleted. |
| Quota | Count successful or intentionally submitted work against account/device policy. Do not restore quota on deletion. Exclude infrastructure failures from user allowance where appropriate. | Account, device-risk bucket, source, arm, quota used, and override reason. |
| Duplicate suppression | HMAC-keyed hash of normalized file content within the relevant privacy scope. Do not expose the hash. Cache only where policy allows. | Duplicate clusters, compute saved, false-positive appeals. |
| Device and job identity | Use rotating, HMAC-derived identifiers and multiple signals. Never treat one browser or network signal as proof of identity. | Risk score, signal categories, last-seen time, manual allow/deny, reason. |
| Rate/concurrency | Rate-limit anonymous requests by risk/network bucket; cap upload size, duration, concurrency, and queue priority. Use CAPTCHA only when risk is elevated. | Requests, throttles, challenges, queue wait, compute per completed job. |
| Upload safety | Validate MIME and codec, scan media, isolate decoders, cap duration/size, and protect public-URL import against SSRF. | Rejection reason, scanner outcome, source category, operator audit. |
| Rights attestation | Before processing, require confirmation that the user owns or is authorized to use the recording and understands sharing/export implications. | Versioned consent text, timestamp, locale, account/job ID. |
| Retention | Delete anonymous inputs/previews automatically. Give account users deletion controls. Keep only minimum billing, abuse, and audit records required by policy. | Retention sweeps, deletion success, exceptions, access logs. |
| Review | Use a reversible review state instead of irreversible bans. Provide an appeal path. | Review queue, decision time, overturn rate, operator identity. |

### Funnel events to add

Use a stable event taxonomy across web and mobile:

```text
landing_view
intent_selected
upload_started
upload_rejected
job_created
preview_ready
preview_played
account_verified
mobile_opened
job_reopened
practice_started
comment_created
share_created
share_opened
quota_hit
upgrade_viewed
checkout_started
subscription_started
job_deleted
rights_reported
abuse_blocked
appeal_resolved
```

Attach only bounded metadata such as pseudonymous account ID, job ID, surface, model version, entitlement state, and experiment cohort. Do not attach raw audio, full URLs, raw device fingerprints, or user-identifying free-form text to analytics events.

### Admin dashboard additions

Add a **Conversion** section to the existing admin dashboard with:

- Landing view → upload start → preview ready.
- Preview ready → account verified.
- Verified account → mobile open.
- Mobile open → first practice.
- Completed job → share created.
- Verified user → paid conversion.
- Funnel by source, campaign, role, country, device platform, and experiment arm.
- p50/p95 transcription time and failure rate.
- Quota exhaustion and anonymous abuse blocks.
- Compute cost per completed job.
- Rights-attestation coverage.
- Deletion completion and appeal outcomes.

This is more useful than adding a generic page-view counter to the current analytics overview.

## Features that can start conversations

These are proposed features, not current repository capabilities.

1. **Shareable transcription cards.** A read-only web result with a short audio excerpt, synchronized notation, Solfa, confidence summary, provenance, and permission label.
2. **“Fix this bar” comments.** A recipient comments on a measure or time range; the owner accepts or rejects the suggestion.
3. **Before/after correction clips.** Share model output beside the human-corrected version. This makes accuracy visible and creates a natural conversation around the music.
4. **Teacher or band review links.** Role-limited links for review, comment, or suggestion. Do not grant edit/delete rights by default.
5. **Transcription challenges.** Rights-cleared prompts such as “transcribe this riff,” with a comparison view and optional leaderboard. Do not base the feature on unlicensed commercial tracks.
6. **Practice handoff.** A recipient selects a passage on the web and sends the exact bar, tempo, and loop range to mobile.
7. **Version timeline.** Show who changed a note, when, and why. Let collaborators share a version without overwriting one another.
8. **Choir, worship, or lesson packs.** Bundle several jobs into a private setlist or lesson and share a view-only link. This aligns with the project’s stated choir and worship-team audience and with Moises setlists [1].
9. **Questions on a result.** “Is this rhythm right?” or “What fingering do you use?” attached to a measure or note.
10. **Credits and provenance.** Show uploader, recording source, processing date/model, edits, and permissions so collaborative correction remains trustworthy.

## Competitive landscape and lessons

### Moises

Moises combines stem separation with chords, lyrics, key/BPM detection, pitch and tempo changes, metronome, looping, recording, setlists, collaboration, and exports [1] [2]. Its free funnel is deliberately constrained: five uploads per calendar month, short free files, first-minute limits for some tools, and preset-only free stems [2] [3].

**Lesson:** users understand a product faster when the first free action is real but the recurring workflow is clearly paid. NoteFusion should focus on a narrower, more coherent transcription-to-practice promise rather than copying the entire stem-production suite.

### Melody Scanner

Melody Scanner offers browser, iOS, and Android notation workflows with Arrangement, Lead Sheet, and Universal modes. It uses free YouTube and microphone paths while gating personal file upload, full sheets, editing, and richer exports [4]. Users can see a generated result before upgrading.

**Lesson:** web discovery and URL/microphone entry can reduce acquisition friction. NoteFusion should differentiate with better continuity between web proof and mobile practice, not simply with another browser upload box.

### ScoreCloud

ScoreCloud spans desktop notation, Songwriter lead sheets, mobile Express capture, cloud sync, and browser-playable shared scores [6] [7]. Its free tier is meaningful but gates song count, watermarked output, polyphonic capture, audio import, local saving, and interchange formats [6].

**Lesson:** the transcription result becomes more valuable when it remains synchronized to audio and can be shared. NoteFusion’s web viewer should be a distribution surface, not merely a download page.

### Klangio, Piano2Notes, and Sing2Notes

Klangio’s specialist products are the clearest preview-first precedent: repeated no-login 20-second demos, PDF preview, and a paid path to full duration, Edit Mode, MIDI, MusicXML, and larger quotas [5]. Piano2Notes and Sing2Notes also show the value of focused instrument/voice positioning.

**Lesson:** a short preview can prove quality before signup. NoteFusion can pair this with its distinctive movable-do Solfa and mobile practice continuation.

### AnthemScore

AnthemScore emphasizes offline desktop transcription and manual cleanup, with PDF/MIDI/MusicXML/ASDT exports, playback, looping, and speed controls. Its desktop and web trials use 30-second previews [8]. There is no documented native mobile app, social layer, or public API in the reviewed material.

**Lesson:** offline desktop correction is a competitor strength, but mobile continuity, links, permissions, and practice remain open differentiation space for NoteFusion.

### Flat.io

Flat is the strongest adjacent precedent for browser collaboration. It offers real-time co-editing, comments, version history, public/view-only links, community publishing, mobile apps, and API/OMR products [9] [10]. Its free tier is useful, while score count, advanced presentation/export, premium instruments, and PDF/photo import allowances drive upgrades.

**Lesson:** sharing and collaboration can be acquisition channels, not only paid features. NoteFusion should build permissioned review and practice handoff before attempting a broad public community.

## Defensible edges NoteFusion can build

These are opportunities that become defensible only through execution and measurement.

### 1. Movable-do Solfa plus staff notation for voice-led users

Competitors commonly emphasize chords, tabs, piano notation, stems, or generic staff output. NoteFusion’s existing product promise combines **movable-do Tonic Solfa with staff notation**, which is especially relevant to choir directors, worship teams, music teachers, and singers. Make this the web SEO wedge and the mobile practice identity.

Potential proof page examples:

- “Turn a sung melody into Tonic Solfa.”
- “Learn a choir line from a recording.”
- “Convert a worship melody into movable-do Solfa and staff.”
- “Check uncertain notes before rehearsal.”

Do not imply that the engine is always accurate. Show confidence and correction.

### 2. Web proof to mobile practice

Competitors have previews, apps, browser editors, or practice controls. The opportunity is to make all four steps one stateful loop: preview a real result on the web, open the same job on mobile, practise the exact passage, and share the corrected result.

The deep link should include only a signed job reference. It should not put audio or personal data in the URL.

### 3. Confidence-aware human correction

The existing mobile result view already highlights low-confidence notes, supports note-level correction, guided review, key/tempo/meter changes, and playback. Extend this into a product identity: **the app tells the musician what to review next**.

A future web viewer can display the same confidence map without pretending that an automatic score is authoritative. A correction history can later show whether a user repeatedly fixes the same failure mode, which should inform model evaluation and product education without silently training on private data.

### 4. Conversation as a musical workflow

A transcription should become a shared musical object. Comments, review links, version history, and exact practice handoff create reasons for a teacher, bandmate, choir member, or student to return. This is more defensible than a generic social feed because every conversation is anchored to a measure, note, or audio moment.

### 5. Privacy and provenance by design

Default-private projects, explicit rights attestation, short anonymous retention, permissioned sharing, source provenance, deletion controls, and a transparent audit trail can distinguish NoteFusion from products that simply ask users to upload media into an opaque cloud. This will matter most for voice recordings, worship sessions, classroom work, and copyrighted material.

### 6. Transparent conversion economics

Competitor pages often have changing, regional, or inconsistent prices and limits [4] [5] [6] [9]. NoteFusion already has regional pricing logic; use one server-side entitlement policy and render web/mobile/admin messaging from it. Show remaining quota, job status, and the exact reason for an upgrade prompt.

### 7. Operational trust

Fast failure recovery, resumable uploads, clear job states, model/version provenance, predictable deletion, and responsive support can become a practical advantage. A transcription product is judged not only by its best result but by what happens when the file is noisy, too long, unsupported, or still processing.

## Risks and constraints

### Copyright and derivative use

Uploading or transcribing a commercial recording can create rights obligations even if the user owns the file. Public URL ingestion increases that risk. Require an ownership/authorization attestation, keep results private by default, make public sharing affirmative, provide takedown/reporting, and get jurisdiction-specific legal advice before launching public challenges or a public score library.

### Voice and performance privacy

A vocal recording may identify a person. Encrypt in transit and at rest, minimize retention, restrict operator access, provide deletion, and keep model-improvement use opt-in and separate from ordinary service use.

### Fingerprinting fairness

A device or network fingerprint is an anti-abuse signal, not identity proof. Use rotating HMAC-derived identifiers, multiple signals, retention limits, an appeal path, and reversible review states. Shared networks, schools, families, and privacy tools will create false positives.

### Media processing security

Validate file type and codec, isolate decoders, cap size/duration/concurrency, scan media, and protect any public-URL fetcher against SSRF and private-network access. Make retries idempotent and log admin interventions.

### Accuracy expectations

Competitors themselves document input-dependent accuracy limitations. Melody Scanner warns that simultaneous instruments produce poor results [4]. ScoreCloud recommends clean, steady, mainly single-note input [6]. AnthemScore documents that lyrics and chords are not automatically detected [8]. Klangio says output is not guaranteed to be perfect [5]. NoteFusion should expose supported-input guidance, confidence, and corrections rather than marketing perfect transcription.

### Platform parity

Competitor sources contain inconsistent pricing, feature entitlements, and mobile/web availability [4] [5] [6] [9]. NoteFusion should avoid hard-coded limits in the landing site and mobile client. Checkout and the entitlement service must be authoritative.

## Ninety-day roadmap

| Period | Deliverables | Metrics and decision gates |
|---|---|---|
| **Days 0–30: instrument and prove** | Add use-case/SEO pages, event taxonomy, anonymous short preview, signed jobs, MIME validation, duration/size caps, quota ledger, HMAC-derived risk signals, retention sweeps, basic admin funnel, email verification, and mobile deep link. | Establish baseline for upload start, preview ready, p50/p95 latency, failure rate, preview-to-signup, duplicate rate, and abuse blocks. A reasonable first target is at least 70% preview completion with preview p95 under 60 seconds. Fix reliability before adding more gates. |
| **Days 31–60: connect proof to retention** | Add account songbook, explicit verified free allowance, mobile reopen/practice handoff, read-only web result links, comments, entitlement display, and completion push. Add rights attestation and deletion controls. | Track preview-to-verified account, verified account-to-mobile open, first practice, share rate, and seven-day return. Use these as the primary product validation signals rather than page views. |
| **Days 61–90: monetize and create conversation** | Add measure comments, correction/version history, private teacher/band links, saved practice loops, quota/upgrade experiments, cohort reporting, and appeal review. | Compare paid conversion, second-job completion, retained practice, cost per job, failure rate, abuse compute, and deletion SLA. Select the winning conversion gate based on retained value and contribution margin, not checkout conversion alone. |

### Suggested initial targets

These are proposed operating targets, not competitor benchmarks:

- 10–15% preview-to-verified-account.
- At least 30% verified-account-to-mobile-open.
- At least 15% share rate among completed jobs.
- At least 25% seven-day return among users who complete a first job.
- 3–5% paid conversion from verified transcribers within 30 days.
- At least 35% of paid users complete a second job.
- Less than 10% seven-day job failure/retry rate.
- Abuse-related compute below 5% of total compute.
- At least 80% of deletion requests completed within the published window.

Treat these as experiment thresholds. Replace them with observed cohort baselines as soon as traffic is available.

## Concrete engineering implications

A first web preview should not call the Python service directly from the browser. Add a .NET application endpoint with a narrow policy, for example:

```text
POST /api/web-preview/jobs
GET  /api/web-preview/jobs/{jobId}
POST /api/web-preview/jobs/{jobId}/save
POST /api/web-preview/jobs/{jobId}/share
GET  /api/shared/transcriptions/{shareToken}
POST /api/analytics/events
```

The endpoint should:

- Accept only short, supported audio.
- Issue a signed job/upload reference.
- Apply anonymous/account/device quota before the Python call.
- Create a server-side job record with preview/full classification.
- Preserve the existing authenticated transcription route for mobile.
- Return bounded results and omit unrestricted raw exports from anonymous previews.
- Delete preview audio and temporary artifacts according to policy.
- Emit funnel events without raw audio or identifying metadata.
- Use the same billing/entitlement service as mobile.

The web viewer should be read-only by default. A full editor should be a later project after the preview, sharing, and practice loop are measured. A separate web editor would otherwise create a second correction implementation and increase parity risk.

## Final decision

Build the web as a **conversion and collaboration layer**, not as a second full mobile app.

The first web experience should let a visitor:

1. Understand NoteFusion’s distinctive Solfa/staff promise.
2. Upload or record a short authorized clip.
3. See and hear a safe preview.
4. Create an account to keep it.
5. Open the same result in the mobile app.
6. Practise, correct, and save it.
7. Share a permissioned result link.
8. Upgrade when longer jobs, exports, history, or collaboration become valuable.

The mobile app should remain the place where the user repeatedly **captures, reviews, practises, and builds a library**. The admin surface should make every step measurable, auditable, privacy-preserving, and reversible.

## References

[1]: https://moises.ai/ "Moises official homepage"
[2]: https://help.moises.ai/hc/en-us/articles/8583454469276-How-to-Upload-and-Edit-your-track-using-Moises "Moises upload and edit guide"
[3]: https://help.moises.ai/hc/en-us/articles/360010972039-I-m-a-Free-user-and-I-can-t-upload-more-than-5-songs "Moises Free upload limit help article"
[4]: https://melodyscanner.com/ "Melody Scanner official product site"
[5]: https://klang.io/help/difference-demo-full/ "Klangio demo versus full transcription help article"
[6]: https://scorecloud.com/plans-comparison-chart/ "ScoreCloud official plans comparison chart"
[7]: https://scorecloud.com/learn/interactive-sheet-music/ "ScoreCloud interactive sheet music and browser player"
[8]: https://lunaverus.com/ "AnthemScore official site"
[9]: https://flat.io/ "Flat official homepage"
[10]: https://flat.io/developers "Flat developer products and APIs"
[11]: https://github.com/Gbohunmifrancis/Notefusion/tree/feat/transcription-accuracy-pro-loadtest "NoteFusion repository feature branch reviewed for this strategy"
