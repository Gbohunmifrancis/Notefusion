# NoteFusion web preview implementation plan

## Scope of this branch

This branch implements the first production-safe vertical slice of the web conversion strategy:

1. A server-governed anonymous web-preview job contract.
2. Short audio validation and preview quota enforcement.
3. Persisted preview job state with expiry and safe result caching.
4. Conversion telemetry ingestion with bounded event metadata.
5. A static-site preview upload panel that polls the C# API and directs users to the mobile app for continued practice.
6. Unit coverage for preview limits, token ownership, expiry, event validation, and safe result projection.

The branch deliberately does **not** implement the full web notation editor, comments, public community, billing checkout, or a new mobile screen. Those are subsequent phases and would otherwise create duplicate product logic before the preview funnel is measured.

## Architectural constraints

The public site must call only the C# API. It must never call the Python worker directly. The C# API remains responsible for validation, quotas, job identity, retention, entitlement decisions, and telemetry. The Python service remains internal.

The existing authenticated `POST /api/transcriptions` route remains unchanged for mobile. The preview contract is separate so anonymous browser traffic cannot accidentally bypass the existing user/device free-tier rules.

Preview results are intentionally projected into a safe DTO. They include notation, Solfa, confidence, key, tempo, and meter, but do not expose unrestricted MusicXML, MIDI, or audio-preview base64 data to anonymous users.

## Preview policy defaults

The initial policy is configuration-backed and conservative:

| Policy | Initial value | Reason |
|---|---:|---|
| Maximum upload | 10 MiB | Enough for a short compressed clip while limiting abuse cost. |
| Maximum duration | 30 seconds | Matches the proof-first funnel used by comparable products without giving away full processing. |
| Preview allowance | 1 per device per 24 hours | Anonymous users must be able to judge quality, but repeated compute must be controlled. |
| Result retention | 24 hours | Allows a visitor to return without creating a permanent anonymous library. |
| Polling contract | Same job lifecycle as mobile | Reuses the worker contract and makes operations familiar. |
| Identity | Existing `X-Device-Id`, hashed by the API | Keeps raw browser identifiers out of persistence. Missing identity fails open for compatibility but is not eligible for repeated anonymous quota bypass prevention. |

These are launch defaults, not permanent product decisions. They must be measured and adjusted through configuration rather than source edits.

## API contract

```text
POST /api/web-preview/jobs
Content-Type: multipart/form-data
Fields: audio, mode, key?, tempo?, timeSignature?
Headers: optional X-Device-Id

202/200: {
  jobId,
  status: "pending",
  progress: 0,
  expiresAtUtc
}

GET /api/web-preview/jobs/{jobId}
Headers: X-Preview-Token

200: {
  jobId,
  status,
  progress,
  result: safe result projection when done,
  error,
  expiresAtUtc
}
```

The token is returned only at submission, stored hashed, and required for polling. A token must not be accepted for a different job. Expired jobs return a generic not-found/expired response without revealing whether a job existed.

## Telemetry contract

```text
POST /api/telemetry/events
Content-Type: application/json

{
  "event": "preview_ready",
  "anonymousId": "bounded client-generated identifier",
  "jobId": "optional server job id",
  "surface": "web",
  "experiment": "optional cohort",
  "metadata": {
    "source": "hero_preview",
    "mode": "melody"
  }
}
```

The API accepts only a fixed allow-list of event names and bounded string values. It must reject unknown events, oversized metadata, raw audio URLs, and arbitrary nested objects. The first branch stores append-only events for later admin aggregation; no raw audio or raw device identifier is persisted in telemetry.

## Persistence

Add two append-oriented tables:

- `web_preview_jobs`: ML job ID, hashed preview token, hashed device identity, lifecycle timestamps, expiry, result JSON, and optional failure reason.
- `product_events`: bounded funnel events with event name, timestamp, surface, pseudonymous anonymous ID, optional account/job references, and small JSON metadata.

Indexes target the two hot paths: preview lookup by ML job ID and retention/quota queries by device and creation time; event reporting by event name and timestamp.

## Acceptance gates

### Backend

- Anonymous preview cannot exceed configured size or duration.
- Quota is checked before the Python submit call.
- A failed worker job is not reported as a successful preview.
- Polling requires the exact token issued at submit.
- Expired jobs do not reveal result or existence.
- Safe result projection omits MusicXML, MIDI, and audio preview bytes.
- Telemetry accepts only allow-listed events and bounded metadata.
- Authenticated mobile transcription behavior remains unchanged.

### Web

- The public page contains a clearly labeled preview action.
- Upload state, processing state, completion state, failure state, and quota state are accessible without relying on color alone.
- The browser stores only the preview token and a bounded anonymous ID locally.
- The web page never calls the Python worker directly.
- The completed preview offers a mobile continuation CTA and does not imply full-song access.

### Operational rollout

- Apply the EF migration before enabling the public endpoint in production.
- Configure the API base URL for the deployed static site.
- Confirm CORS allows only the public site origins, not `*`.
- Enable structured logs and admin reporting before driving paid traffic.
- Start with a small percentage of traffic or an explicit preview feature flag.
- Review p50/p95 preview latency, completion rate, quota exhaustion, abuse blocks, and preview-to-account conversion before adding comments or a full editor.

## Deferred phases

### Phase 2: identity and retention

Connect verified accounts to preview jobs, preserve previews in the user library, add mobile deep-link consumption, and show remaining allowance from the same entitlement service.

### Phase 3: sharing

Add read-only share tokens, signed result links, audio/notation provenance, view telemetry, and permissioned recipient roles.

### Phase 4: review and collaboration

Add measure-level comments, teacher/band review links, correction suggestions, version history, and mobile notifications.

### Phase 5: monetization optimization

Add checkout attribution, plan experiments, longer jobs, export gates, priority processing, and cohort-based admin dashboards.

### Phase 6: web precision editor

Only after the mobile and sharing loops are measured should NoteFusion add a large-screen correction editor. It should consume the same result model and correction APIs as mobile rather than creating a second source of truth.

## Verification commands

```bash
dotnet build NoteFusion.slnx -c Release
dotnet test NoteFusion.slnx
cd server && python -m pytest -q
cd ../mobile && npm run lint
```

If the local environment lacks the .NET SDK, the branch must still receive C# syntax and diff checks, while the handoff must explicitly mark the required local CI validation as pending.
