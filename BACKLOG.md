# Backlog

Deferred decisions and known placeholders for the current architecture — three tiers:
C# Web API (`src/`), Python ML worker (`server/`), RN/Expo mobile client (`mobile/`).
Items from the old native-Android backlog were superseded by the pivot (see git history).

## ML pipeline (server/)
- [ ] Record ~20 real phone clips in target environments, drop in `spike/recordings/`,
      rerun, and grade per the rubric in `spike/README.md` → go/no-go decision.
- [ ] Tune post-processing thresholds (extra split notes cost precision on all 3 test
      clips); consider onset merging for repeated same-pitch fragments.
- [ ] Key detection on short clips is the weak spot (Happy Birthday in G detected as
      D major at 0.68 certainty — solfa relabelled wrongly). Confirms the PRD mitigation:
      prominent editable key + 'set Doh before recording'. Evaluate an Essentia
      cross-check server-side.

## Mobile (mobile/)
- [x] Push: `Push__UseExpo` is off by default; flip to `true` and pass an Expo access
      token once the API is deployed behind a public URL.
- [ ] Audio compression before upload: Opus/FLAC. Raw PCM is ~10× too big for the data
      budget (≤ ~1 MB per 30 s clip); MVP uploads raw PCM for simplicity.
- [x] Reference-doh selection heuristic (doh nearest the melody's median) when rendering
      solfa — mirrors `solfa.py` and `SolfaMapper.cs`.
- [x] Playback: MIDI → synthesized audio with moving cursor (F-06).
- [x] Editing: tap-to-correct notes; transpose; key/tempo/meter override wired to the library
      endpoints (`/api/library/{id}/key`, `/tempo`, `/time-signature`).
- [x] Multi-format export suite: Curwen/grid Solfa text sheet, MIDI, MusicXML + share sheet (F-09).

## Web client (future)
- [ ] The API is headless by design — the same image serves a web client unchanged.
      First slice: auth + library browse + result rendering (no capture yet).

## Cross-cutting / later
- [x] Chromatic syllable set setting (descending sa/la variants differ regionally, TRD §4.2).
- [ ] CI: add a Docker image build + publish job (compose stack currently tested as unit
      tests only; `docker compose up --build` is smoke-tested locally).
- [x] Multi-part SATB choral score extraction (`server/app/pipeline/score_transcriber.py`).
- [x] Formal Curwen solfa layout and punctuation engine (`server/app/pipeline/solfa_render.py` + `mobile/src/lib/solfa.ts`).
- [ ] v1.x: offline mode via ONNX Runtime + quantized Basic Pitch.
