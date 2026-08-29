# Note detection, audio→solfa, and the market — research findings and plan

Sources read: Omnizart docs + VOCANO (its vocal module's upstream), Spotify Basic Pitch
(`note_creation.py`, `inference.py`, `constants.py`, v0.4.0 `predict` signature), Magenta
Onsets & Frames (full paper, ar5iv), Solfa-Ai (`lib/tonic-solfa/*`,
`lib/music-analysis/estimateKey.ts`, `lib/music-simplification/simplifyMelody.ts`), sol2snd.

Measured baseline read from `server/tests/accuracy/report.json` (41 synthetic cases, run
2026-08-25). Every number below marked *measured* is from that file; everything else is
either quoted from a source or labelled a prediction.

---

## 0. The headline

**We are already the most accurate audio→tonic-sol-fa engine of the three products, by a
wide margin, and the thing holding note detection back is not tuning — it is that we throw
away two thirds of what Basic Pitch already computes for us, on every single job, for free.**

`server/app/pipeline/transcriber.py:3031`:

```python
_, midi_data, note_events = predict(...)
```

That discarded first element is a dict of three aligned matrices — `note`, `onset`,
`contour` — at 86 fps. We paid the ONNX inference cost to produce them and then dropped
them on the floor. The `onset` matrix in particular is a *trained note-onset detector*, and
`_segment_contour`'s own docstring says the quiet part out loud:

> "Notes read off the pyin contour, **with Basic Pitch not asked where they are**."

That is, verbatim, the configuration Onsets & Frames measured as their worst ablation.

---

## 1. What each source actually is, and the one thing worth taking

### 1.1 Onsets & Frames (Magenta, 2018) — the highest-value finding in this whole review

Archived Jan 2026, TF1, MAESTRO-trained piano model. Not portable. **But its central result
is a decoding rule, not a model, and decoding rules are free to copy.**

The rule (§4 of the paper): *"An activation from the frame detector is only allowed to start
a note if the onset detector agrees"* that an onset occupies that frame. Threshold 0.5 on
both heads. Stated effect: frame activations lasting only a few frames, and **notes that
briefly re-trigger while already sounding**, get discarded when no matching onset is
predicted.

Their ablation table is the evidence, and it is unusually clean:

| Configuration | Frame F1 | Note F1 | Note w/ offset F1 |
|---|---|---|---|
| Onsets and Frames (full) | 78.30 | **82.29** | **50.22** |
| (b) **no onset gate at inference** | 78.37 | **67.44** | **34.15** |
| (a) frame-only LSTM (no onset stack) | 76.12 | 62.71 | 27.89 |

Removing *only the inference-time gate* costs **18% relative note F1** and **32% relative
note-with-offset F1** — and frame F1 goes *up* (78.37 vs 78.30). That inversion is the
whole lesson: **a frame-only decoder optimises coverage and destroys note-level
correctness.** The authors add that the ungated version "sounds significantly worse" despite
the better frame score.

Also worth taking: their frame loss weights the onset span by `c = 5.0` and decays as
`c/(t − t₂)` afterwards; onset labels are 32 ms wide (≈2 frames) because labelling the
single true-start frame scored *worse* — audio/label misalignment is real, so onset targets
should be a short window, never a point. Useful when we label real recordings (§5).

Their MAPS config-2 numbers for context: note F1 82.29, note-with-offset 50.22, on real
Disklavier piano audio.

### 1.2 Basic Pitch — we use ~30% of it

Constants: `AUDIO_SAMPLE_RATE` 22050, `FFT_HOP` 256, `ANNOTATIONS_FPS` **86**,
`ANNOT_N_FRAMES` 172, 88 note bins, **`CONTOURS_BINS_PER_SEMITONE` 3** →
`N_FREQ_BINS_CONTOURS` 264, base 27.5 Hz.

`predict()` in v0.4.0 (the version we pin) accepts and we **do not pass**:

| Parameter | Default | We pass | Consequence |
|---|---|---|---|
| `minimum_frequency` | `None` | **no** | bass bins stay live through the whole decode |
| `melodia_trick` | `True` | **no (so: on)** | notes invented from leftover energy, no onset evidence |
| `multiple_pitch_bends` | `False` | no | — |
| `midi_tempo` | `120` | no | exported `.mid` always claims 120 BPM |

We pass `onset_threshold`, `frame_threshold`, `minimum_note_length`, `maximum_frequency=1050`.

Two mechanics from `note_creation.py` matter a great deal:

**`constrain_frequency()` runs first**, before onset peak-picking and before the melodia
trick — it zeroes `onsets[:, :min_freq_idx]` and `frames[:, :min_freq_idx]`. Our melody
floor (`transcriber.py:3072`) filters `note_events` *after* the entire decode. So we let the
decoder build left-hand notes and then delete them, instead of never building them. Worse,
the melodia trick's `remaining_energy` budget gets spent harvesting bass energy that we were
always going to discard.

**The melodia trick is an onset-free note generator.** Verbatim structure: while any leftover
frame energy exceeds `frame_thresh`, seed at the global argmax, grow forward and backward
while fewer than `energy_tol = 11` consecutive frames fall below threshold, and emit a note.
No reference to the onset matrix anywhere in that loop. For polyphonic piano recovery that is
a sensible heuristic. For a monophonic hummed line it is a ghost-note factory, and it is
**on by default in every job we run**.

**The `contour` head is a polyphony-tolerant f0 tracker we already compute.** 3 bins per
semitone, 88 semitones, 86 fps, trained on polyphonic audio, frame-aligned with `note` and
`onset`. We instead run **pyin**, which is monophonic by construction — the documented root
cause of the wrong-hand bug — and then run it a *second* time when the melody floor fires
(`_segment_contour`, two `_pyin_contour` calls).

`model_output_to_notes` is pure numpy/scipy. **One inference can feed many decodes**, at
milliseconds each. That single fact makes most of §4 cheap.

### 1.3 Omnizart — the product lesson, not the code

TensorFlow, seven modules: `music` (multi-instrument), `drum`, `chord`, `vocal`,
`vocal-contour`, `beat`, `patch-cnn`. No benchmark numbers on the docs site. Not portable
(TF + per-module checkpoints).

The transferable point is architectural and it is aimed straight at us: **Omnizart ships a
separate model for singing than for instruments.** We ship one instrument-agnostic model and
distinguish "melody" from "poly" by four constants:

```python
onset_thresh = 0.35 if mode == "melody" else 0.45
frame_thresh = 0.25 if mode == "melody" else 0.30
min_note_ms  = 100  if mode == "melody" else 80
max_freq_hz  = 1050.0
```

That is one engine with a knob, not two engines. The mode should select a *decoding
strategy*, and §4 makes that concrete without adding a model.

### 1.4 VOCANO (Omnizart's `vocal` module upstream) — independent confirmation of §1.1

ISMIR 2021, Hsu & Su. Singing voice transcription split explicitly into **pitch extraction**
(a pre-trained Patch-CNN) then **note segmentation** (PyramidNet-110 + ShakeDrop, trained
semi-supervised). Segmentation is trained on *monophonic* data, so the README tells you to
run Demucs first on polyphonic input. PyTorch + CUDA 10.1 + apex — not portable.

What matters: **two independent state-of-the-art systems, from different labs, on different
tasks, both separate pitch tracking from note segmentation and both treat segmentation as an
onset-aware problem in its own right.** Our pipeline conflates them — `_contour_segments`
derives note boundaries from pitch stability and voicing, and `_split_rearticulations` then
guesses re-attacks from **RMS**. RMS rises on vibrato amplitude modulation, which is exactly
the "sustained/vibrato notes shredded by the reseed ratchet" bug. The onset posteriorgram is
the signal actually trained for that decision, and we already have it in memory.

### 1.5 Solfa-Ai — nearest competitor, and behind us on music theory

Next.js 16 / React 19 / Supabase / Vercel. Pipeline: upload → Basic Pitch → keep-highest-note
simplification → MusicXML → OpenSheetMusicDisplay → solfa → GPT-5-mini lesson. 5 commits, 0
stars, roadmap entirely unstarted, repeated references to "judges" — a hackathon prototype.

Read against their source, their solfa engine has four defects we do not have:

| | Solfa-Ai | NoteFusion |
|---|---|---|
| Minor mode | **do-based** (`['do','di','re','me','mi',…]`, slot 0 = `do`) | **la-based** (`doh_pitch_class` = `(tonic+3) % 12`) |
| Octave marks | `floor(midi/12) − 1`, absolute, anchored on **C** — so in A major the mark changes partway up the scale | anchored to `reference_doh`, the doh octave nearest the melody's median |
| Descending chromatics | no flat-side table at all; `ra`/`ma` absent, tritone always `fi` | `DESCENDING_SYLLABLES` + `ascending_flags` direction rule |
| Rhythm | **none** — `durationSeconds` is never read. No bars, rests, ties, or beats. Output is phrase groups capped at 8 tokens | `solfa_render.render_lines` on a real rhythm grid with bar lines, holds `-`, rests `_`, simultaneity `+` |

La-based minor is not a preference — it is what tonic sol-fa *is* in the Curwen tradition
these hymnals and choirs use. Their syllable set (`do/di/re/ri/mi`) is American solfège, not
tonic sol-fa; ours (`d/de/r/re/m`) is the notation actually printed in the target market's
hymn books.

Their key detection (`estimateKey.ts`): duration×confidence-weighted pitch-class histogram,
dotted against Krumhansl–Schmuckler profiles **without mean-centering or normalisation** —
so not a K-S correlation, just a weighted sum, with the classic relative-major/minor bias
that centering exists to mitigate. Confidence is computed and then **discarded**; the
function returns a string. Ours: ensemble with z-scores, cadence tiebreak,
`_is_fifth_or_parallel` guard, `_diatonic_fraction` — *measured* key.exact **0.976**,
fifth_confusion **0.000**, confidence_auc **0.95**.

Their melody simplification is 40 ms onset grouping + highest-note-wins + 0.12 s same-pitch
merge. Ours is a contour-first path with a melody floor, skyline, rearticulation splitting
and overlap resolution.

**Where they are genuinely ahead of us:** MusicXML export served as a file, in-browser
engraving via OpenSheetMusicDisplay, MIDI download, and AI-generated practice lessons with a
deterministic fallback so an LLM outage never becomes a user-facing error. That fallback
pattern is worth copying outright.

### 1.6 sol2snd — the incumbent, and it cannot hear

Live since 2014. Type pseudo-sol-fa as plain text → formatted sol-fa sheets, staff notation,
MIDI, and **song books**. Imports **ABC, MusicXML and MIDI**. Aikin shape notes. Per-part
instrument choice. Accounts and remote storage. Third-party: Midi.js, Deck.js, Abcweb,
CLEditor.

**There is no audio input anywhere in the product.** MIDI import is symbolic. Its users are
people who already know the notes and want clean sheets — choirs, hymnody, congregational
music.

So it owns solfa *typesetting* and the choral workflow, and has a twelve-year head start
there. It has no path to audio at all.

### 1.7 The market gap, stated plainly

- **sol2snd:** symbolic → solfa, mature, no ears.
- **Solfa-Ai:** audio → solfa, theory-incorrect, no rhythm, prototype.
- **NoteFusion:** audio → solfa, correct theory, rhythm-gridded — and **no symbolic import at
  all**, which is the one thing the incumbent's entire user base already has files for.

Nobody does accurate audio → *rhythmically notated* tonic sol-fa. That is the moat, it is
already half-built, and §6 is about closing the flank.

---

## 2. Where we actually stand (measured, 41 synthetic cases)

| Metric | Value | Read |
|---|---|---|
| `notes.f1` | **0.965** | saturated |
| `notes.f1_with_offset` | 0.953 | saturated |
| `notes.semitone_neighbour_ghosts` | 0.293 /case | ghosts remain |
| `solfa.degree_accuracy` | **1.000** | saturated — cannot improve |
| `solfa.syllable_accuracy` | 0.988 | saturated |
| `solfa.ghost_count` | 0.488 /case | ghosts remain |
| `solfa.chromatic_ghosts` | 0.268 /case | ghosts remain |
| `key.exact` | **0.976** | 1 case wrong, and it is a relative |
| `key.fifth_confusion` | **0.000** | the old plan's Phase 3 is already done |
| `key.confidence_auc` | 0.95 | good |
| `beats.f1` | 0.974 | good |
| `tempo.abs_error` | **10.66 BPM** | **worst headline metric** |
| `tempo.metrical_factor` | 0.951 | 2 cases off by a metrical factor |
| **`conf.auc`** | 0.615 → **0.876** | **fixed in W5** (by removing terms) |
| **`conf.separation`** | 0.012 → **0.138** | improved; 0.30 shown unreachable — see W5 |
| `tests/accuracy/real/` | **README.md only** | **zero labelled real recordings** |

Two conclusions, and they set the whole sequence:

1. **The synthetic corpus is saturated and can no longer discriminate.** `degree_accuracy`
   is 1.000. `notes.f1` is 0.965. Most changes in §4 are *unmeasurable* against it. Corpus
   work is therefore a **prerequisite, not a follow-up** — this is the single most important
   sequencing statement in this document.
2. **Every number above describes synthesized audio.** Absolute accuracy on human singing is
   unmeasured. The loader now works (fixed in `e2dc16d`); the fixtures directory is empty.

Also confirmed broken as the earlier plan said: `conf`. `Event` already carries `pyin_midi`
and `voiced_prob`, and `_blend_confidence` exists — the plumbing landed, the number is still
noise. And it scales preview velocity, so it degrades the *sound* too.

---

## 3. What we are NOT doing, and why

- **Porting VOCANO, Omnizart, or Onsets & Frames models.** PyTorch/TF, per-module
  checkpoints, CUDA-era toolchains. Railway removed the 500 MB slug ceiling, so this is no
  longer *impossible* — but `WEB_CONCURRENCY=1` is a correctness constraint (in-process
  `JobQueue`), so any added CPU latency is fully serialised into user-visible wait. We take
  their decoding rules, which are free.
- **`audio-separator` in the request path.** It requires torch even for ONNX MDX models
  (`torch, onnx, onnxruntime, numpy, librosa, requests, six, tqdm, pydub`). ~2 GB image and
  CPU separation measured in multiples of real time, on a single-worker service. If §6 shows
  accompaniment is the dominant real-world error source, it goes on a **second Railway
  service** as a paid tier — never inline.
- **Essentia.** A cp312 manylinux wheel does exist (`2.1b6.dev1389`), so `PredominantPitchMelodia`
  / `KeyExtractor` / `RhythmExtractor2013` are reachable. Parked deliberately: our key
  detection is already at 0.976 exact / 0.000 fifth-confusion, so Essentia's key extractor
  has nothing to win, and its melody tracker competes with the `contour` head we already pay
  for. Revisit only if §4.4 fails.
- **Retuning against the current synthetic corpus.** Saturated. See §5.

---

## 4. The accuracy plan

Ordered by (evidence × cheapness). W1 is a one-line change that unlocks W2–W5.

### W1 — Stop discarding `model_output` *(one line, zero added compute)*

```python
model_output, midi_data, note_events = predict(...)   # was: _, midi_data, note_events
```

Gives, all frame-aligned at 86 fps:
- `model_output["onset"]` — (T, 88) trained onset posteriors
- `model_output["note"]`  — (T, 88) frame posteriors
- `model_output["contour"]` — (T, 264) f0 contour at 3 bins/semitone

Frame index → seconds is `i / 86` (mind `model_frames_to_time`'s window correction and its
`MAGIC_ALIGNMENT_OFFSET = 0.0018` if we need sub-frame alignment).

*Verify:* log the three shapes on one corpus case; assert `note.shape[0] == contour.shape[0]`
and that inference wall-clock is unchanged.

### W2 — Onset gating on every note start *(the O&F rule)*

No note may begin unless `onset[frame, pitch_bin]` is a local maximum over ±2 frames and
clears `onset_thresh`. Apply at **both** decode sites:

1. **Inference path** — re-run `model_output_to_notes` ourselves from `model_output` with
   `melodia_trick=False` for `mode == "melody"`, and keep it on for `poly`. Monophonic humming
   has no leftover-energy voices worth recovering; polyphonic piano does.
2. **Contour path** — replace `_split_rearticulations`' RMS heuristic with the onset matrix.
   Split a stable-pitch run only where an onset peak exists at that pitch.

Evidence: O&F ablation (b), note F1 82.29 → 67.44 without the gate. Onset targets there are
32 ms ≈ 2 frames wide, which is why the ±2-frame local-max window rather than an exact hit.

*Predicted:* `solfa.ghost_count` 0.488 and `notes.semitone_neighbour_ghosts` 0.293 fall
sharply; sustained and vibrato notes stop being shredded, because a re-trigger with no onset
peak is refused — the paper's stated behaviour.
*Gate:* `notes.precision` ≥ 0.961 **and** `notes.recall` ≥ 0.971 — the gate must not buy
precision with recall. `notes.f1_with_offset` ≥ 0.953.
*Risk:* a genuinely soft legato re-attack has a weak onset peak and gets merged. This is why
`onset_thresh` for the gate must be swept, not assumed, and why the real corpus (§5) has to
exist first — synthetic attacks are cleaner than sung ones.

### W3 — Melody floor at the source, via a second cheap decode

`constrain_frequency()` zeroes bins *before* peak-picking and before the melodia trick. Our
floor filters *after* the whole decode.

Because `model_output_to_notes` is pure numpy, we do **one inference and two decodes**:

1. decode once, unconstrained → hand `note_events` to `_melody_floor_hz` as today;
2. if the floor fires, **re-decode from the same `model_output`** with `min_freq` set.

The left hand is then never built, and the melodia trick's energy budget is never spent on
bass. Cost: milliseconds, not a second ONNX pass. This also deletes the second
`_pyin_contour` call in `_segment_contour` if W4 lands.

*Gate:* the two polyphonic cases hold or improve; all 39 monophonic cases bit-identical (the
floor cannot fire on an ungated clip, so this must be true by construction — assert it).

### W4 — Use the `contour` head as the melody tracker; keep pyin as the second opinion

pyin is monophonic — the root cause of the wrong-hand bug and of the melody floor's
close-voicing blind spot. The `contour` head is polyphony-trained, 3 bins/semitone, already
computed, and frame-aligned with `onset` so W2 composes with it directly.

Keep pyin, but demote it from *the* tracker to one of two independent voters. Where they
agree, confidence is high; where they disagree, that disagreement is signal (W5), and the
existing `_pyin_contour` machinery, `pyin_midi` and `voiced_prob` fields all survive intact.

*Gate:* `notes.f1` ≥ 0.965 on the 39 monophonic cases; both polyphonic cases improve. The
close-voicing case named in the earlier plan is the real target and **must be authored first**
— per the existing discipline, the fix does not get invented without a case that fails.

### W5 — Real consensus confidence — **DONE, and the premise above was wrong**

*Shipped: `conf.auc` 0.615 → **0.876**, `conf.separation` 0.012 → **0.138**, all 35 other
aggregates `+0.000`. Achieved by **removing** terms, not blending them.*

The table below is what this section originally proposed, kept because the measurement that
refuted it is the useful part. Each term was scored on its own, per case, by Mann-Whitney auc
over the only 5 corpus cases that contain both a correct and a wrong note
(`vibrato_rate_k20`, `vibrato_depth_1_8`, `vibrato_depth_2_0`, `relative_bait_c_major`,
`drift_1_semitone` — `note_confidence_metrics` returns `{}` for the rest):

| Signal | Source | Independent of | **measured auc** |
|---|---|---|---|
| amplitude | Basic Pitch posterior | — | **0.765** |
| onset posterior at note start | `model_output["onset"]` | frame energy, pyin | **0.629** |
| frame posterior, mean over span | `model_output["note"]` | onset head, pyin | 0.451 |
| pyin agreement `1 − min(1, \|pyin_midi − pitch\|)` | pyin | Basic Pitch entirely | 0.448 |
| pyin reliability | `voiced_prob` | Basic Pitch entirely | 0.357 |

**Three of the four proposed additions are at or below chance**, and the 4-term blend scored
*worse* (0.611) than amplitude alone (0.765). "Independent" was doing no work as an argument:

- **pyin agreement is not two measurements.** On the contour path `pitch = round(pyin_midi)`
  by construction, so the agreement term is comparing a number with itself.
- **the frame term was duration-biased — my bug, not the corpus's.** Mean-over-span makes a
  long note average in its own decay tail, so it *rewards* short notes (on
  `vibrato_depth_2_0`: 0.5 beat → 0.215, 1.0 → 0.205, 2.5 → 0.160). The ghosts here are
  systematically the short notes, so the statistic systematically preferred them. Four
  formulations were tried — mean-over-span 0.451, mean-over-first-8-frames 0.292,
  max-over-span 0.365, fraction-above-0.25 0.454. **Do not re-add a frame-posterior
  confidence term without new evidence.**

Removing both is a **strict dominance**, not a trade-off — auc *and* separation improve at
each step: 4-term 0.611/0.012 → drop frame 0.731/0.101 → drop agree too 0.843/0.173.

Shipped as `conf = (2.0·amp + 1.5·onset) / 3.5`. The onset weight sits on a broad plateau —
0.25→0.881, 0.5→0.888, 0.75→0.891, 1.0→0.888, **1.5→0.876**, 2.0→0.859 — and a 6× range all
clears the gate, which is the argument that the pick is structural rather than fitted to 5
cases. 1.5 rather than the 0.891 peak because the fraction of wrong notes still reading
"High confidence" collapses 0.960 → 0.640 past it, for 0.015 auc.

**Two corrections to the gate as written:**

1. **`separation ≥ 0.30` is unreachable on this corpus and should not have been a gate.** The
   0.332 it came from predates `ADAPTIVE_FACTOR` 0.25→0.40, which deleted exactly the loud
   easy ghosts amplitude separated by a wide margin. What is left is the hard population, so
   the achievable margin is structurally smaller: across the whole weight sweep separation
   never exceeds 0.196, and it peaks where auc has collapsed to 0.790. Chasing 0.30 means
   rescaling, which is precisely what auc was chosen to refuse credit for. **auc is the gate;
   separation is a diagnostic.**
2. **The residual deficit is segmentation, not scoring.** `conf.aggregate` averages 5 cases:
   `relative_bait_c_major` 1.000 and `drift_1_semitone` 1.000 are already perfect, and the
   three vibrato cases carry the entire remainder. There, 11 reference notes come back as
   12/15/18 estimates in an overshoot/undershoot staircase — and **those wrong notes are
   physically in the audio**, so the onset head fires genuinely at each. No confidence
   weighting can rank them away. This made **vibrato-aware segmentation** (a regular ±2
   semitone oscillation is ONE note at the mean of the excursion, not a staircase) outrank
   the remaining W items on paper: it attacks `notes.f1` directly and would dissolve this
   deficit as a side-effect. It was then measured and demoted — the mechanism is confirmed but
   every cheap fix for it is exhausted, and the case is past real singing. See
   "Why 2b was demoted rather than done" in §7.

**A separate defect this surfaced, not yet fixed.** `bad_low` — the fraction of wrong notes
falling under the client's `conf < 0.5` review cut — is **0.000 for every blend measured**,
including amplitude alone. Every term lives in 0.6–1.0, so no weighted mean of them can reach
0.5, and the review list at `ResultScreen.tsx:192` therefore never flags a wrong note. That is
a *calibration* problem invisible to a rank statistic, and it needs either a moved client cut
or corpus calibration — not a reweighting. (Note the 0.75 cut in `theme.ts:452` is only
colour and label; 0.5 is the operative one.)

Velocity map narrowing to `0.55 + 0.35·conf` remains outstanding, in Phase 0's synth work.

### W6 — Tempo: use the onset posteriorgram as the onset envelope

`tempo.abs_error` **10.66 BPM** is our worst headline number, and `tempo.metrical_factor`
0.951 means two cases are off by a metrical factor.

`onset.sum(axis=1)` is a note-onset envelope produced by a network *trained to detect note
onsets* — strictly better-suited than spectral flux for this. librosa's beat tracker accepts
it directly:

```python
librosa.beat.beat_track(onset_envelope=onset.sum(axis=1), sr=22050, hop_length=256)
```

Feed it into `_onset_bpm` / `_grid_bpm` / `_estimate_tempo_and_beats` as an additional
candidate and let the existing grid-residual cost function choose — it already picks between
candidates, so this is a new voter, not a replacement.

Then meter: ~~`librosa.feature.tempogram_ratio` (installed, unused) reports energy at 13
metrical factors, so duple-vs-triple is readable with no new dependency.~~ **Struck — already
tried and measured.** The post-mortem at `transcriber.py` (the meter-detection comment block)
records that `tempogram_ratio` was implemented and came out *anti-correlated* with the true
meter on this corpus, and it closes "do not re-attempt either without new evidence." That
post-mortem also names the real upstream defect, which is the thing to fix instead:
`_transcribe_wav` is never told which metrical level `bpm` is on, so a detector downstream of
it is guessing on top of a guess.

`time_signature` is **already on the wire** and `StaffNotation.tsx` **already renders and
groups bars from it** — the client half is done, and it is waiting on a detector that has no
working input yet.

*Gate (tempo only):* `tempo.abs_error` < 8.0 BPM, `tempo.metrical_factor` ≥ 0.951,
`beats.f1` ≥ 0.974.

### W7 — Mode selects a decoding strategy, not four constants

After W2–W4, `melody` and `poly` differ structurally: melody = contour head + onset-gated
segmentation + `melodia_trick=False` + melody floor; poly = full polyphonic decode +
`melodia_trick=True` + no floor. That is Omnizart's separation-of-models lesson delivered
without a second model.

### W8 — Free correctness fixes found while reading

- `midi_tempo=120` is never passed, so every exported `.mid` claims 120 BPM regardless of
  the tempo we detected. Pass the estimate.
- `mobile/src/screens/RecordScreen.tsx:572` still pings the retired Heroku transcriber for
  warm-up. Point it at the Railway host or drop it.
- `chromaticSpelling` is on the Python wire but not mirrored into
  `TranscriptionApiContracts.cs` or `mobile/src/api/types.ts` — the outstanding half of
  `3705bc2`, per CLAUDE.md's lock-step rule.

---

## 5. The corpus is the bottleneck — this gates everything above

`solfa.degree_accuracy` is **1.000** and `notes.f1` is **0.965** on 41 synthetic cases.
There is no room left to measure in. `tests/accuracy/real/` contains only a README.

**5a. Label the two real recordings.** The loader works (`e2dc16d`); the fixtures are the
only missing piece. Two cases is not a corpus, but it converts every claim in §4 from
"unmeasured on humans" to "measured on two humans", which is a categorical change.

**5b. Generate a repertoire corpus from MusicXML (this is nearly free, see §6.1).** Once
symbolic import lands, any MusicXML score gives an exact note list; render it through our own
`_synthesize_audio_preview` and we have perfectly-labelled audio from *real hymn repertoire*
rather than hand-built scale patterns. Our 41 cases are synthetic **patterns**; this makes
them synthetic **music**. It does not replace 5a — it is still synthesis — but it attacks
saturation directly and at scale.

**5c. The cases §4 specifically needs authored before its fix:**
- a close-voicing case (the melody floor's known blind spot) — for W4
- a soft-legato-re-attack case — the failure mode W2's gate can cause
- a sustained-note-with-vibrato case — what W2 is supposed to stop shredding
- 3/4 and 6/8 cases + `meter_metrics()` — for W6

**5d. Label onsets as ~32 ms windows, not points.** Straight from the O&F paper: labelling
the single true-start frame scored *worse* than a 2-frame window, because audio/label
misalignment is real. This is a labelling-convention decision that is expensive to change
later — get it right in 5a.

---

## 6. The product plan: upload, and the feature that justifies the price

### 6.1 Ship symbolic import first — it is nearly free, perfectly accurate, and it is the incumbent's own moat

We already depend on `music21==10.5.0`, which reads **MusicXML, MIDI, ABC** via
`converter.parse()`. Our solfa engine is measurably better than both competitors'. So:

**MusicXML / MIDI / ABC upload → tonic sol-fa + staff, with no ML in the path at all.**

Why this goes first, ahead of audio upload:
- **Zero transcription error.** There is no note detection step, so accuracy is exactly the
  input's accuracy. It is the only feature in this document that ships at 100%.
- It is **sol2snd's core capability** ("ABC, MusicXML and MIDI supported"), and their entire
  user base already has files in those formats.
- It de-risks the whole upload feature: the file-size, long-input, multi-part, meter and
  bar-grouping problems all get solved once, against inputs where any bug is unambiguously
  ours rather than the transcriber's.
- It generates the repertoire corpus in §5b.
- Solfa-Ai has no import path at all.

Then audio upload, on the foundation §4 builds: onset-gated decode, contour-head tracking,
source-level melody floor, real confidence, detected meter.

### 6.2 The feature: **Parts & Practice**

The buyer in this market is the choir master — church, school, community — in West Africa and
the diaspora, who has to teach four voice parts to people who read tonic sol-fa and not
staff. Both competitors miss them from opposite sides: sol2snd can typeset the parts but
cannot hear a recording; Solfa-Ai can hear a recording but produces one unrhythmed line with
do-based minor.

**Parts & Practice:** from a recording *or* a MusicXML/MIDI score, produce each voice part
separately — as rhythm-gridded tonic sol-fa **and** staff — and give each part its own
practice track: your line foregrounded, the other parts soft, tempo adjustable, loopable by
bar range. Plus a printable/shareable part sheet, and the collection bundled as a book.

Why it is the right feature:
- **It is what "learn my part" actually means.** It sells to one buyer who brings 20–60
  singers, which is the pricing story: per-choir, not per-hobbyist.
- **It is built almost entirely out of §4 and §6.1.** Multi-voice separation from a *score* is
  free (music21 already exposes parts). Per-part practice audio is our existing synth with a
  per-part gain — the soft-piano work in `206e0a7` is the same code path. The rhythm grid
  exists (`solfa_render.render_lines`). Meter comes from W6.
- **Neither competitor can follow quickly.** sol2snd would need to build ears. Solfa-Ai would
  need to fix la-based minor, octave anchoring, descending chromatics, and add rhythm — i.e.
  rebuild the engine we already have, and their repo has five commits.
- **The audio-only path degrades honestly.** From a recording, part separation is genuinely
  hard, so ship score-derived parts first (exact) and audio-derived parts second, clearly
  labelled — and *that* is where the paid separation tier (§3, second Railway service) earns
  its keep rather than being a cost centre.

**Tiering that falls out of this naturally:** free = record a melody, get solfa + staff.
Paid = file upload, multi-part scores, per-part practice tracks, books, exports (MusicXML /
MIDI / PDF). Separation-assisted parts from audio as the top tier, since it has a real
marginal compute cost.

### 6.3 Two things to copy outright from Solfa-Ai

- **The deterministic lesson fallback.** Their lesson generator has a fixed output shape on
  both the LLM and offline paths, so "an AI outage" never becomes a user-facing error. That
  is the right pattern for any LLM feature we add, and it costs nothing to adopt up front.
- **Serving MusicXML as a downloadable file and engraving it in-browser.** We already produce
  `musicxml` on the wire and never expose it as a file. OpenSheetMusicDisplay is the obvious
  renderer for the web client.

---

## 7. Sequence

| # | Work | Gate | State |
|---|---|---|---|
| 0 | W1 (capture `model_output`), W8 (free fixes) | shapes logged, inference time unchanged | **done** |
| 1 | **5a** label the two real recordings; **5c** author the four cases | `real_report.json` non-empty; new cases fail for the stated reason | |
| 2 | W5 confidence | ~~`separation` ≥ 0.30~~ → `conf.auc` ≥ 0.85, all else identical | **done — 0.876, +0.000 elsewhere** |
| 2b | ~~**vibrato-aware segmentation**~~ — promoted by W5, then **demoted by measurement**: the centre-estimator family is exhausted and what remains needs an adaptive band, on a case already past real singing | ~~`notes.f1` > 0.965~~ | **measured, not attempted — see below** |
| 3 | W2 onset gating | `notes.precision` ≥ 0.961 **and** `recall` ≥ 0.971; ghosts down | **next** |
| 4 | W3 source-level floor + W4 contour head | poly cases up; 39 mono cases identical (W3) / `notes.f1` ≥ 0.965 (W4) | |
| 5 | W6 **tempo only** (meter struck, see W6) | `tempo.abs_error` < 8.0; `beats.f1` ≥ 0.974 | |
| 6 | W7 mode as strategy | no metric moves; structural only | |
| 7 | **6.1** symbolic import → solfa + staff; **5b** repertoire corpus | round-trips a real hymn score exactly | |
| 8 | **6.2** Parts & Practice, score-derived first | per-part solfa + practice track from a MusicXML anthem | |

Step 1 is not optional and does not come later. Steps 2b–6 are mostly unmeasurable without it
— W5 landed ahead of it only because it is provably metric-neutral by construction (`conf` is
carried on notes, never used to select them), which is not true of anything below it.

### Why 2b was demoted rather than done

W5's finding pointed here: the residual `conf.auc` deficit is a segmentation defect, because the
three vibrato cases emit 12/15/18 notes for 11 references and the extra notes are physically
present in the audio. That diagnosis stands. What changed is the estimate of what fixing it
costs.

The defect was instrumented cut by cut on `vibrato_depth_2_0`. The spurious cuts are a ratchet
whose period is exactly one note: at each cut `_contour_segments` refills its running centre
from the excursion's own frames — the transition plus the peak that tripped persistence — so the
new centre sits 0.8–1.6 semitones high and the note's own trough then falls out of band. The bias
survives because the band is centred on the estimate, so only frames that confirm a high centre
are admitted to it. A biased centre is self-confirming.

Four independent ways to remove that bias were measured (centred window, warm-up, trailing
period, and a median over every frame rather than the in-band ones). Every one of them lands the
deepest case at **16 notes for 11**, and every one pays somewhere in the guards — `triplets` 13→8,
`fast_sixteenths` 15→9, `drift` 11→9, `long_clip` 99→108 depending on the variant. Four estimators
with different failure modes agreeing on 16 is the result: with centre bias removed entirely, ~5
of the cuts were never about the centre. They are genuine band violations, and at 2.0 semitones
**peak** the swing is 4.0 peak-to-peak, so holding it together needs a band over 2 semitones while
seeing a semitone step needs one under 1. No fixed band is both.

So what is actually left is an *adaptive* band keyed on periodic modulation — a new feature, not a
constant. Two things argue against spending it now: 2.0 semitones peak is past real singing
(operatic vibrato is ±0.5–1.0, and the corpus documents this case as deliberately above the
measured ceiling), and the estimator table is recorded in
`transcriber.py` under `CONTOUR_RESEED_LOOKAHEAD_FRAMES` so the ground does not have to be
re-covered. One correction landed from it: the "wide contour for the band comparison" that file
previously named as the only remaining idea is refuted in principle, not merely unhelpful — an
estimator centred on the current frame tracks a sustained step too, so it cuts nothing and
collapses every case, `diag_baseline` included, to 1–3 notes.

## 8. Honest limits of this document

- No accuracy numbers exist for Omnizart or VOCANO in the sources I could reach; the Omnizart
  docs site publishes none, and VOCANO's README points to the paper. Their contribution here
  is architectural, not benchmarked.
- The O&F numbers are **MAPS piano**, not sung melody. The 18%/32% relative gains from the
  onset gate are strong evidence that a frame-only decoder is the wrong shape; they are not a
  prediction of our deltas.
- Every NoteFusion number in §2 is synthesized audio, 41 cases. §5 exists because of that.
- W2's risk (soft legato re-attacks merged) is real and is the one change in §4 that could
  make a user-visible thing worse. It must not ship on synthetic evidence alone.
- I did not run any experiment for this document. Every §4 "predicted" is a hypothesis with a
  stated gate, not a result.
