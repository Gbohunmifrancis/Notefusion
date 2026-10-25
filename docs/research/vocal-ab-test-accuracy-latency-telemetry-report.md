# Vocal transcription A/B evaluation, warmed-model benchmark, and telemetry plan

## Executive conclusion

The requested labelled vocal accuracy comparison could not be executed in this checkout because the labelled dataset is not present. `server/tests/accuracy/real/` contains only `README.md`; it contains **zero WAV files and zero `.truth.json` sidecars**. The repository’s evaluation command correctly refused to produce a misleading zero-case report:

```text
python -m tests.accuracy.report --real
error: no real cases found
```

A production-like Basic Pitch latency benchmark also could not be run because the `basic_pitch` runtime package is not installed in the sandbox. The warmed accessor implementation was statically verified and its reuse behavior is covered by a passing unit test, but no inference latency number should be reported until the actual model runtime and representative audio are available. A stub-model or synthetic timing result would measure Python dispatch overhead rather than transcription performance and would be misleading.

The implementation is ready for the A/B run once the audio/label fixtures and Basic Pitch runtime are mounted. This report records the exact run protocol, the current blocked status, the benchmark design, and a telemetry plan that can be deployed without logging raw audio or user-identifying data.

## Current execution status

| Measurement | Result | Interpretation |
|---|---:|---|
| Labelled vocal WAV fixtures | 0 | Accuracy comparison not measurable |
| Label sidecars | 0 | Accuracy comparison not measurable |
| Baseline real-corpus run | Not executed | Harness rejected empty fixture directory |
| `NF_CONTOUR_GAP_MERGE=1` real-corpus run | Not executed | Same missing-fixture blocker |
| Basic Pitch import | unavailable | Production-like inference benchmark blocked |
| Python compilation and diff checks | Passed | Modified code is syntactically valid |
| Transcription helper tests | 218 passed | Fusion and warmed-accessor unit coverage passes |
| Earlier full server suite | 485 passed, 44 deselected | No observed regression in available suite |

The absence of a score is intentional. It is not evidence that the feature improved or degraded accuracy.

## Required A/B evaluation

Place consented, monophonic vocal recordings and matching sidecars in `server/tests/accuracy/real/` using the pinned format:

```text
server/tests/accuracy/real/
  humming_c_major_01.wav
  humming_c_major_01.truth.json
```

Each sidecar must contain `key`, `tempo_bpm`, and ordered sounding notes with `pitch_midi`, `onset_sec`, and `dur_sec`. The existing README requires recordings to be approximately 3–15 seconds, below MIDI 84, with notes near or above 120 ms. Labels must be taken from the audio rather than copied from the intended score.

Install the repository’s full inference dependencies, including the pinned Basic Pitch package from `server/requirements.txt`, then run the two arms from `server/` in separate clean processes:

```bash
# Control arm
unset NF_CONTOUR_GAP_MERGE
python -m tests.accuracy.report --real > /tmp/notefusion-vocal-control.txt
cp tests/accuracy/real_report.json tests/accuracy/real_report.control.json

# Treatment arm
export NF_CONTOUR_GAP_MERGE=1
python -m tests.accuracy.report --real > /tmp/notefusion-vocal-contour-gap.txt
cp tests/accuracy/real_report.json tests/accuracy/real_report.contour-gap.json
```

The two runs must use the same code revision, model version, environment, audio files, and label sidecars. Compare at least `notes.f1`, precision, recall, `f1_with_offset`, `n_est`, `semitone_neighbour_ghosts`, key accuracy, and tempo error. The key A/B measures for this feature are **over-segmentation** and **false chromatic events**, because a sustained vocal note can otherwise be split into short neighbouring-pitch events that render unnecessary accidentals.

For every case, retain the control and treatment values and calculate:

```text
n_est_delta = treatment.n_est - control.n_est
f1_delta = treatment.notes.f1 - control.notes.f1
neighbour_ghost_delta = treatment.semitone_neighbour_ghosts - control.semitone_neighbour_ghosts
```

Do not enable the treatment globally based on an aggregate F1 increase alone. Require no regression on genuine semitone steps, re-attacks, and short rests. Inspect rendered notation for at least every case that changes `n_est` or accidental count.

## Warmed-model concurrency benchmark

The accessor now loads Basic Pitch once per process and returns the same model object to subsequent requests. The unit test proves reuse of an already-warmed instance. The production benchmark still needs the actual Basic Pitch runtime and representative audio.

Use a fixed set of representative clips from the labelled corpus, including clean humming, vibrato, breathy vocals, and voice over accompaniment. Run each condition in a fresh worker process so cold-start and warmed behavior are not mixed. The benchmark should compare:

| Condition | Purpose |
|---|---|
| Cold, first request | Measures model construction and first inference overhead |
| Warm, sequential | Measures steady-state single-request latency |
| Warm, concurrency 2 | Measures the first Pro burst level |
| Warm, concurrency 4 | Measures a higher Pro burst level |
| Warm, concurrency 8 | Finds saturation, queueing, or memory pressure |

For each condition, run enough requests to report p50, p95, and p99 end-to-end latency. Separate queue wait, audio decode, Basic Pitch inference, pyin refinement, post-processing, and score assembly. Also record real-time factor, peak resident memory, CPU utilization, errors, and timeouts. Repeat each condition at least three times and report the median run together with the run-to-run range.

The benchmark must not use unbounded concurrency. Basic Pitch, ONNX, BLAS, and pyin may each use native threads. Record and control their thread counts so a concurrency-4 result is reproducible. A Pro worker count should be selected only where p95 latency improves without an unacceptable increase in peak memory or an accuracy change. Keep Pro capacity isolated from free-tier workers so a burst cannot starve other traffic.

A minimum acceptance gate is:

1. Warm p95 is lower than cold p95 by removing repeated model initialization.
2. Accuracy metrics are unchanged between cold and warm runs.
3. Increasing concurrency does not create OOMs or timeout spikes.
4. The chosen Pro concurrency improves queue-to-result p95 under the target load.
5. The warmed model object remains one instance per worker process rather than one unsafe shared object across processes.

## Production telemetry plan for the A/B test

### Assignment and privacy

Assign each eligible transcription request to `control` or `contour_gap` using a stable random assignment at the request level. Store the assignment, code revision, model version, and effective configuration snapshot with the transcription result. Do not log audio, filenames, raw note sequences, user names, email addresses, or free-form metadata. Use a salted short-lived request hash only for joining stage timings and outcome events.

The A/B assignment should remain sticky for a user or project during the experiment so a single performer does not receive mixed behavior across repeated requests. Exclude requests that fail decoding or violate clip limits from accuracy denominators, but track them in a separate operational failure metric.

### Event-level telemetry

Emit one event per final estimated note and one aggregate event per transcription. The event must contain only bounded numerical and categorical fields:

| Field | Purpose |
|---|---|
| `experiment_arm` | `control` or `contour_gap` |
| `model_version` and `code_revision` | Reproducibility |
| `mode` | Melody, polyphonic, or other decoder mode |
| `duration_bucket` | Avoids exact audio-duration leakage |
| `pitch_midi_bucket` | Register analysis without raw audio |
| `estimated_note_count` | Over-segmentation signal |
| `reference_available` | Separates offline labelled evaluation from production inference |
| `onset_post_bucket` | Confidence analysis without raw posterior arrays |
| `voiced_prob_bucket` | pyin quality analysis |
| `merged_by_contour_gap` | Direct treatment exposure signal |
| `merge_gap_bucket` | Measures how aggressively the treatment acts |
| `note_duration_bucket` | Ghost-note duration analysis |
| `pitch_change_from_previous` | Identifies semitone-neighbour fragments |
| `processing_stage_ms` | Latency attribution |

For production requests without labels, do not claim a note is false. Instead, record **candidate ghost indicators**. A candidate is a short event with weak independent onset evidence, a semitone-neighbour relationship to surrounding events, and either a contour-continuous predecessor/successor or a same-pitch event that would have been merged by the treatment. These indicators are suitable for monitoring treatment behavior, not for calculating ground-truth precision.

### Offline labelled metrics

For the consented labelled corpus, compute exact false-accidental and ghost metrics from the reference notes. At minimum, report per arm:

- Note precision, recall, and F1.
- Note count and over-segmentation ratio.
- Semitone-neighbour ghosts per clip and per minute.
- Chromatic false-positive events per clip and per minute.
- Median and p95 onset error.
- Key accuracy and tempo error.
- Treatment merge rate.

Use bootstrap confidence intervals over clips, not over individual notes only. Notes within a recording are correlated. Establish a minimum sample size before making a rollout decision, and report the number of clips and singers represented in every dashboard tile.

### Dashboards and alerts

Create four dashboard panels. The first shows the A/B accuracy metrics from labelled evaluation, with control and treatment confidence intervals. The second shows candidate ghost and accidental rates in unlabeled production traffic, segmented by arm, mode, register, and duration bucket. The third shows merge behavior: treatment merge rate, average number of events removed per merge, and the fraction of merges vetoed by onset evidence. The fourth shows latency and reliability: queue wait, warm-model inference time, end-to-end p50/p95/p99, error rate, timeout rate, and peak-memory samples.

Alert on relative rather than absolute changes where traffic is heterogeneous. Recommended initial guardrails are a treatment increase of more than 10% in labelled semitone-neighbour ghosts, a treatment F1 drop greater than 0.02, a p95 latency increase greater than 15%, an error-rate increase greater than 0.5 percentage points, or any worker OOM. These are rollout safeguards and should be tuned after the first stable week of traffic.

### Rollback and retention

Keep `NF_CONTOUR_GAP_MERGE` remotely configurable or deploy it behind the existing settings mechanism. Roll back by assigning all new requests to `control`; do not delete treatment telemetry because it is needed to investigate already-produced scores. Retain aggregate metrics and short-lived request hashes according to the project’s privacy policy. Delete any temporary evaluation recordings after the approved offline analysis window.

## Decision rule

Enable the treatment for a broader Pro cohort only when the labelled corpus shows fewer false chromatic events and ghost notes without a material loss in note recall or key accuracy, and the warmed benchmark shows a stable p95 latency improvement or no regression under the chosen concurrency. If the treatment reduces ghost notes but lowers recall on re-attacks, narrow the contour gap or increase the onset veto rather than enabling it globally.

## References

[1]: server/tests/accuracy/real/README.md "NoteFusion labelled real-recording format and evaluation requirements"
[2]: server/tests/accuracy/real_loader.py "NoteFusion real-corpus loader and validation rules"
[3]: server/tests/accuracy/metrics.py "NoteFusion note-level accuracy and ghost-note metrics"
[4]: server/app/pipeline/transcriber.py "NoteFusion transcription pipeline and warmed Basic Pitch accessor"
[5]: server/tests/test_transcriber_helpers.py "NoteFusion transcription helper and model-reuse regression tests"
