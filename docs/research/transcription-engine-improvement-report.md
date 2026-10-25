# NoteFusion transcription engine improvement report

## Executive assessment

The repository’s current piano performance is credible because the Basic Pitch ONNX model, pyin refinement, posterior capture, adaptive amplitude filtering, melody-floor handling, and key ensemble are already substantially engineered. The remaining weakness is not best described as “pitch detection is generally inaccurate.” It is primarily **note-boundary segmentation under vibrato, portamento, re-attacks, accompaniment, and singing voice acoustics**. Those boundary errors create extra short events; once an extra event is assigned a neighbouring pitch class, the notation layer correctly prints an accidental that is musically unnecessary. In other words, many unwanted accidentals are downstream symptoms of ghost notes and pitch parking, not a spelling-only problem.

The current synthetic regression harness is useful for isolating mechanisms, but it is not evidence of real-world singing accuracy. `server/tests/accuracy/real/` contains a label specification and no recordings. The first serious accuracy milestone should therefore be a consented, labelled real-audio corpus, reported separately from synthetic results.

## What the code does today

The main path is `server/app/pipeline/transcriber.py:_transcribe_wav`, where Basic Pitch produces `model_output`, MIDI data, and note events. The frame-level `onset`, `note`, and `contour` matrices are now captured in `Posteriorgram`; the contour head is used selectively for melody-floor/polyphonic cases. The normal fallback path applies an adaptive amplitude floor, pyin pitch refinement, onset merging, duplicate removal, and melody-overlap resolution.

The most important structural limitation is in `_merge_onsets`: it only merges events that are adjacent in time and have a non-negative gap. Vibrato fragments often overlap or are separated by short posterior dropouts, so the merge stage cannot see them. Meanwhile `_segment_contour` derives boundaries from stable pitch/voicing and `_split_rearticulations` uses RMS valleys. RMS modulation caused by vocal vibrato is not a reliable boundary signal, so a sustained sung note can be split into several notes.

The existing measurements support retaining `settings.pyin_semitone`. In the project’s documented synthetic sweep it materially reduced semitone-neighbour and chromatic ghost errors. Replacing it with another f0 tracker before measuring human singing would risk removing one of the pipeline’s strongest protections.

## Priority recommendations

| Priority | Recommendation | Expected effect | Risk | First validation |
|---|---|---|---|---|
| P0 | Build a real labelled corpus and metrics for singing | Makes every later decision measurable | Low | 20–40 clips, real/synthetic reports kept separate |
| P1 | Fuse same-pitch fragments across contour-continuous gaps | Directly attacks vibrato/posterior-dropout over-segmentation | Medium | A/B flag; require guard cases to remain unchanged |
| P1 | Reuse the Basic Pitch model/session instead of passing the model path per job | Removes repeated model/session setup and improves warm latency | Low | Compare cold/warm latency, RSS, and byte-identical accuracy report |
| P1 | Add a bounded pro worker pool/queue after benchmarking | Reduces pro queue wait without changing inference quality | Medium | p50/p95 latency and CPU/RAM stress test |
| P2 | Add a singing/voice-aware segmentation strategy | Improves vibrato, portamento, breath noise, and soft re-attacks | Medium/high | Real singing bake-off against current strategy |
| P2 | Use onset posterior as a soft boundary feature, not a hard gate | Helps re-attacks while preserving legato notes | Medium | Precision/recall on soft legato and vibrato subsets |
| P3 | Conditional vocal/accompaniment separation | Helps songs with strong accompaniment or competing voices | High latency/cost | Only enable after real corpus proves accompaniment is a dominant failure mode |
| P3 | Compare a specialized singing model or segmentation model | Potential largest ceiling increase | High model size/ops cost | Head-to-head on held-out real recordings |

## P0: measure the material users actually submit

Add labelled WAV/sidecar pairs for at least the following categories: clean humming, sung melody with vibrato, portamento, breathy or noisy singing, voice over piano, voice over a dense song mix, reverberant phone capture, fast syllabic singing, and clips longer than 60 seconds. Keep clips within the engine’s supported register and duration initially so a miss is not confused with an unsupported input.

The report should expose the following metrics separately for each category: note F1 with offset, note precision and recall, onset mean absolute error, over-segmentation ratio (`estimated_notes / reference_notes`), ghost notes per minute, semitone-neighbour ghost rate, chromatic accidental false-positive rate, pitch error in cents/semitones, and real-time factor. For the pro tier also report queue wait, p50/p95 end-to-end latency, peak RSS, and worker CPU utilization. Do not quote the synthetic baseline as singing accuracy.

## P1: remove unnecessary accidentals at the source

### 1. Contour-continuity gap fusion

Implement the project’s already-documented next experiment as a feature flag beside `f0_merge` and `pyin_semitone`. After pyin refinement, retain the contour arrays already computed and merge two pitch-identical events across a gap when all of the following hold:

1. The gap is short enough to be a posterior dropout, but not bounded by an explicit re-attack.
2. The pyin contour remains voiced across the gap, using the existing voiced-probability threshold.
3. The contour stays within a narrow semitone band around the event pitch.
4. The events are not separated by a strong, independent onset posterior.
5. The combined duration and local rhythm remain plausible.

This is materially different from simply widening `MERGE_GAP_MELODY`. A wider time-only merge can swallow genuine repeated notes. The contour must provide evidence that the sound remained one note. Thread the contour from `_refine_pitches` into the merge stage rather than invoking pyin a second time. Add tests for continuous vibrato, a genuine semitone step, a genuine re-articulation, silence, and close polyphony.

### 2. Make onset evidence soft and pitch-aware

The onset head should be a feature in a boundary score, not a universal “must have onset” rule. The repository’s own experiment showed that disabling the melodia trick globally loses a leading melody note in a block-chord case, and strict local onset gating can reject soft legato attacks. A safer boundary score would combine onset posterior, contour discontinuity, voicing continuity, local energy change, pitch distance, event duration, and overlap fraction. Require stronger evidence to split a sustained note than to accept an event that begins after silence.

A practical rule is to suppress a candidate split when the contour is continuously voiced and stable, even if RMS has a local valley, unless the onset posterior is strong at the candidate boundary and the two sides have independently stable pitches. This specifically addresses the current `_split_rearticulations` vulnerability to vibrato amplitude modulation.

### 3. Treat accidentals as a final consistency check, not a blanket correction

Do not post-process all accidentals toward the key: genuine chromatic passing notes must survive. Instead, mark an accidental as suspicious when it is a short, low-duration, semitone-neighbour event between two same-pitch or contour-continuous fragments, has weak independent onset evidence, and has high-posterior neighbours on the diatonic pitch. Such a flag can feed the segmentation merge decision or a low-confidence annotation; it should not silently rewrite a musically independent note.

## P2: support singing as a distinct decoding mode

The current `mode` changes thresholds and stages, but it still relies on one general-purpose instrument AMT model plus pyin. Add an explicit `singing` or `voice_melody` strategy with different boundary assumptions:

- Use a wider minimum note duration for breath/noise rejection, but preserve short values when onset confidence and pitch stability both support them.
- Smooth continuous f0 in cents before quantizing to MIDI; use hysteresis so a vibrato crossing a semitone does not create a new notated pitch.
- Separate **continuous pitch motion** from **note identity**. A sung note’s f0 may move several semitones without becoming several notation events; a new event requires a stable pitch plateau or a strong re-attack plus a meaningful temporal gap.
- Preserve portamento as pitch-bend or a controlled transition internally, but quantize to one note only when the product’s notation rules require it.
- Use a confidence interval or posterior mass around the pitch rather than only `round(median_midi)`. If the median falls near a semitone boundary, prefer the pitch supported by the longest stable plateau and key-consistent evidence, while retaining uncertainty for review.

If “voices” means ordinary spoken speech rather than singing, this is a separate product problem. Basic Pitch is a musical note tracker; speech should use a speech/phoneme or voiced-f0 pipeline and should not be forced through the song-note decoder.

## P3: songs with accompaniment

The melody-floor and Basic Pitch contour path already address some competing-voice cases. For full songs, first classify whether accompaniment is materially interfering. Only then route difficult clips to source separation or a specialized singing transcription model. Running Demucs or another separator on every request would increase CPU/RAM usage and latency and could reduce quality on clean recordings.

The correct experiment is a held-out comparison:

`current pipeline` vs `current pipeline + separation` vs `specialized singing/segmentation model`,

with the same post-processing and Event contract. Adopt a candidate only if it improves real-audio note F1, ghost/accidental false positives, and onset error without unacceptable real-time-factor or memory cost. Preserve `bend_semitones`, `pyin_midi`, `voiced_prob`, and onset confidence so downstream confidence and notation do not regress.

## Pro-tier speed without sacrificing efficiency

### Fix model reuse first

`server/app/main.py` currently constructs `Model(ICASSP_2022_MODEL_PATH)` during warm-up but discards the instance. `_transcribe_wav` still calls `predict` with the path. This means warm-up may reduce first-call initialization noise, but it does not clearly guarantee that the request path uses the warmed model object. Introduce a process-local lazy accessor or model pool and pass the reusable model instance to `predict`, subject to Basic Pitch 0.4.0’s supported API. Protect initialization with a lock and add a startup health check. This should be accuracy-neutral and is the first throughput change to ship.

### Use bounded concurrency, not maximum concurrency

`server/app/jobs/queue.py` uses a `ThreadPoolExecutor`, defaulting to one worker. Increasing this blindly can make multiple pyin and ONNX jobs compete for CPU and memory, increasing p95 latency and possibly causing OOM. For Pro, use a separate bounded queue or worker deployment with a measured worker count. Keep free-tier capacity isolated so Pro bursts cannot starve free jobs. The worker count should be selected from a benchmark matrix, for example one, two, and four workers, measuring real-time factor, p50/p95 latency, peak RSS, and accuracy equivalence.

A good deployment shape is one process per inference worker or a small number of processes with an explicit CPU budget; do not mix unlimited threads with native BLAS/ONNX threading. Set ONNX/BLAS thread counts explicitly, then benchmark. If pyin is the dominant CPU stage, a worker pool sized to physical cores may still be too high because each job itself uses native numerical kernels.

### Preserve expensive accuracy stages

Do not speed up Pro by disabling `pyin_semitone`, reducing the accepted clip range, skipping the contour/voice-specific route, or using the coarse `pyin_resolution=0.5` setting. The committed measurements show that these are exactly the stages that protect against ghost accidentals and that coarse f0 grids can move the Viterbi path unpredictably. Optimize around them: model reuse, audio decode once, shared in-memory audio, bounded queueing, and conditional execution of expensive separation.

## Suggested implementation sequence

**Change 1:** Add a real-corpus harness and metrics for false accidentals, ghosts/minute, over-segmentation, and latency. Do not change model behavior yet.

**Change 2:** Implement the contour-continuity gap-fusion flag and its focused regression tests. Run synthetic guards and real singing clips. Ship only if real singing improves without harming genuine semitone steps or re-attacks.

**Change 3:** Replace discarded warm-up model construction with a reusable process-local Basic Pitch model/session. Verify accuracy report byte identity and measure warm/cold latency.

**Change 4:** Add a singing decoding strategy with contour hysteresis and boundary scoring. Keep the current melody/poly strategies unchanged and route only explicit singing/voice-melody jobs to it at first.

**Change 5:** Introduce Pro queue isolation and benchmarked worker limits. Publish p50/p95 latency, real-time factor, and memory budgets as operational gates.

**Change 6:** Evaluate separation and specialized singing models only after the real corpus identifies accompaniment as the dominant remaining error. Keep them behind a route flag and compare against the complete current pipeline, not against raw Basic Pitch.

## Acceptance gates

A change should not be accepted because an aggregate synthetic F1 rose. For accuracy, require no regression on genuine semitone-step, clean monophonic, polyphonic block-chord, close-voicing, and long-clip guards; require a reduction in false accidentals and over-segmentation on held-out real singing; and inspect at least a fixed sample of rendered notation. For speed, require equal or better note metrics, no increase in peak RSS beyond the deployment budget, no OOMs under the target Pro concurrency, and improved p95 queue-to-result latency. Keep all reports versioned with the model version, decoder flags, worker count, CPU type, and corpus fingerprint.

## Bottom line

The highest-confidence path is **not** a wholesale model replacement. First use the contour and pyin evidence already present to stop sustained sung notes from being fragmented, then make the Basic Pitch model genuinely reusable, and finally give Pro a separately benchmarked bounded worker capacity. A specialized singing model or source separation may become worthwhile, but only after real labelled recordings show that the current segmentation and voice-mixture paths—not notation spelling—are the limiting factors.
