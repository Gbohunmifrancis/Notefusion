# NoteFusion transcription agent handoff instructions

## Mission

Continue the transcription-engine accuracy and Pro-performance work on branch `feat/transcription-accuracy-pro-loadtest`. Do not merge or enable the experimental contour-gap behavior globally until the labelled vocal evaluation and concurrency benchmarks satisfy the acceptance gates below.

The latest pushed commit is:

```text
7713211 Improve transcription accuracy and add Pro load testing
```

Remote branch:

```text
origin/feat/transcription-accuracy-pro-loadtest
```

## Work already completed

### 1. Contour-aware vocal note fusion

The transcription pipeline now contains a conservative contour-gap fusion stage for sustained vocal notes. It is intended to join same-pitch fragments created by vibrato, breath, or short posterior dropouts that would otherwise appear as unnecessary accidentals.

The fusion logic is guarded by conditions that reject likely rests, re-attacks, pitch discontinuities, and weak or malformed contours. The pyin contour is reused between pitch refinement and contour-gap fusion so the pipeline does not perform duplicate pyin work.

The feature flag is:

```bash
NF_CONTOUR_GAP_MERGE=1
```

The feature remains disabled by default. Do not change the production default until real vocal data confirms that it improves accuracy without harming genuine note changes.

### 2. Basic Pitch model reuse and warm-up

`server/app/pipeline/transcriber.py` now exposes a process-local `get_basic_pitch_model()` accessor. It lazily creates one Basic Pitch model per worker process and protects first initialization with a lock.

`server/app/main.py` calls this accessor during FastAPI startup. Successful startup should log:

```text
basic_pitch ONNX model pre-warmed OK
```

The same model instance is passed to Basic Pitch inference. Do not instantiate another model in route, queue, or request code. Each OS worker has its own model copy, so increasing worker count increases memory consumption.

### 3. Regression coverage

Added tests cover contour-gap fusion and warmed-model reuse. The last validation results were:

- Helper tests: **218 passed**.
- Earlier full server suite: **485 passed, 44 deselected**.
- Python compilation passed.
- `git diff --check` passed.

Re-run all tests after any further code changes. Do not treat earlier results as validation of later modifications.

### 4. Locust Pro load test

Added:

```text
server/loadtest/locustfile.py
server/loadtest/README.md
server/loadtest/requirements.txt
```

The workload submits audio to `POST /v1/transcribe`, polls `GET /v1/jobs/{job_id}`, supports Pro headers and authentication, and reports:

- Submit HTTP latency.
- Poll HTTP latency.
- `TRANSCRIPTION / submit_to_processing_observed`.
- `TRANSCRIPTION / submit_to_terminal`.
- Job failures and timeouts.

`submit_to_processing_observed` is only a client-observed, polling-granularity-bounded signal. It is not an exact server queue timestamp.

### 5. Documentation already added

Review these files before extending the work:

```text
docs/basic-pitch-runtime-and-warmup-guide.md
docs/transcription-engine-improvement-report.md
docs/vocal-ab-test-accuracy-latency-telemetry-report.md
docs/vocal-ab-test-evaluation-status.json
server/loadtest/README.md
```

## Mandatory remaining work

## A. Install and verify the pinned Basic Pitch runtime locally or in staging

Use an isolated environment. Do not alter the system Python installation:

```bash
cd /path/to/Notefusion
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
```

Install native audio packages on Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg libsndfile1
```

Install the pinned server dependencies:

```bash
cd server
python -m pip install -r requirements.txt
python -m pip install --no-deps basic-pitch==0.4.0
```

The `--no-deps` flag is required because the normal Basic Pitch resolver pulls TensorFlow. NoteFusion is intended to use ONNX Runtime.

Verify the exact runtime and model load:

```bash
python - <<'PY'
from basic_pitch import ICASSP_2022_MODEL_PATH
from basic_pitch.inference import Model
import onnxruntime

print("model_path:", ICASSP_2022_MODEL_PATH)
print("onnxruntime:", onnxruntime.__version__)
Model(ICASSP_2022_MODEL_PATH)
print("basic_pitch_model_load: OK")
PY
```

If this fails, stop and fix the environment. Do not proceed to performance conclusions with a stub model or an alternative unpinned runtime.

## B. Add the labelled vocal test corpus

The previous checkout contained no real vocal fixtures. Add consented recordings and labels under:

```text
server/tests/accuracy/real/
```

Each case requires:

```text
case_name.wav
case_name.truth.json
```

The sidecar must contain:

```json
{
  "key": "C major",
  "tempo_bpm": 100,
  "notes": [
    {"pitch_midi": 60, "onset_sec": 0.42, "dur_sec": 0.55}
  ]
}
```

Use labels measured from the audio, not from the intended score. Include cases that expose the target failure modes:

- Sustained vowels with vibrato.
- Legato phrases.
- Breath and short unvoiced gaps.
- Genuine re-attacks at the same pitch.
- Genuine adjacent semitone changes.
- Portamento or pitch drift.
- Voice over accompaniment.
- Different registers and singers.

Respect the repository constraints: monophonic melody cases, approximately 3–15 seconds, pitch at or below MIDI 84, notes approximately 120 ms or longer, and no more than the API clip limits.

Do not commit private recordings or labels without explicit consent. Keep the fixtures in the local/staging evaluation environment unless the project owner authorizes repository storage.

## C. Run the accuracy A/B test

Run from `server/` in separate clean processes. Use the same code revision, model version, environment, fixtures, and labels in both arms.

Control arm:

```bash
unset NF_CONTOUR_GAP_MERGE
python -m tests.accuracy.report --real
cp tests/accuracy/real_report.json tests/accuracy/real_report.control.json
```

Treatment arm:

```bash
export NF_CONTOUR_GAP_MERGE=1
python -m tests.accuracy.report --real
cp tests/accuracy/real_report.json tests/accuracy/real_report.contour-gap.json
```

Produce a comparison table by case and aggregate. At minimum calculate:

```text
f1_delta = treatment.notes.f1 - control.notes.f1
n_est_delta = treatment.n_est - control.n_est
neighbour_ghost_delta = treatment.semitone_neighbour_ghosts - control.semitone_neighbour_ghosts
```

Report:

- Note precision, recall, and F1.
- F1 with offset.
- Note count and over-segmentation ratio.
- Semitone-neighbour ghosts per case and per minute.
- Chromatic false positives.
- Key accuracy.
- Tempo error.
- Onset error.
- Which cases were changed by contour fusion.
- Number of events removed per fusion.

Inspect every case whose event count or accidental count changes. Pay special attention to genuine semitone steps and same-pitch re-attacks, because incorrectly merging these is a false improvement.

Do not report a score if the harness has zero cases, malformed sidecars, missing audio, or failed inference. Fix the dataset or report the run as blocked.

## D. Run the warmed-model concurrency benchmark

Start the API with the actual Basic Pitch runtime and confirm the warm-up log:

```bash
cd server
. ../.venv/bin/activate

export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export MKL_NUM_THREADS=1
export NUMEXPR_NUM_THREADS=1

uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

Install the separate Locust environment:

```bash
cd /path/to/Notefusion
python3 -m venv .loadtest-venv
. .loadtest-venv/bin/activate
python -m pip install -r server/loadtest/requirements.txt
```

Configure representative, consented audio:

```bash
export LOCUST_AUDIO_DIR=/absolute/path/to/vocal-fixtures
export LOCUST_PRO_HEADER_NAME=X-Subscription-Tier
export LOCUST_PRO_HEADER_VALUE=pro
export LOCUST_POLL_INTERVAL=0.25
export LOCUST_POLL_TIMEOUT=300
```

Run a one-user warm baseline first:

```bash
locust -f server/loadtest/locustfile.py \
  --host http://127.0.0.1:8000 \
  --users 1 --spawn-rate 1 --run-time 3m --headless \
  --csv results/pro-warm-u1 \
  --html results/pro-warm-u1.html
```

Then run users 2, 4, 8, and 16. Run each condition at least three times. Keep the fixture set, model version, code revision, worker count, native thread settings, polling interval, and host limits constant.

Measure separately:

1. Cold first request after a process restart.
2. Warm sequential requests.
3. Warm concurrency 2.
4. Warm concurrency 4.
5. Warm concurrency 8.
6. Warm concurrency 16, only if memory and error rates remain safe.

Record p50, p95, p99, throughput, queue-observed latency, terminal latency, peak RSS, CPU, timeout rate, HTTP errors, worker restarts, and OOM events.

Repeat with `LOCUST_INFLIGHT_PER_USER=2` only as a separate workload. Do not compare it directly with one in-flight job per user without recording the changed offered load.

For each run save:

- Locust CSV and HTML output.
- Exact command line.
- Environment variable snapshot excluding secrets.
- Git commit SHA.
- Basic Pitch and ONNX Runtime versions.
- Worker count.
- CPU and memory limits.
- Audio fixture fingerprint.

## E. Implement production telemetry

The documentation currently describes the telemetry plan, but the production event emission and dashboards are still incomplete. Implement them before broad A/B exposure.

At minimum add:

- Stable experiment assignment: `control` or `contour_gap`.
- Code revision and model version tags.
- Effective feature-flag value per request.
- Mode and bounded clip-duration bucket.
- Estimated note count.
- Treatment merge count and merge-gap buckets.
- Candidate ghost-note count.
- Candidate accidental count.
- Stage timings for queue, inference, pyin, post-processing, and total request time.
- Error and timeout classification.

Do not log raw audio, raw note sequences, user identity, filenames, or free-form private metadata. Candidate ghost and accidental indicators in unlabeled traffic are operational signals, not ground-truth accuracy metrics.

For labelled offline runs, report exact precision, recall, F1, ghost rates, and false chromatic events with clip-level confidence intervals.

Create dashboard panels for:

- Labelled A/B accuracy.
- Candidate ghost and accidental rates by arm.
- Contour merge behavior.
- p50/p95/p99 latency and error rate.
- Worker memory and restart health.

## Acceptance gates before merge or rollout

Do not merge a production-default change or enable the treatment globally unless all of the following are true:

1. The labelled corpus contains multiple consented vocal cases and at least more than one singer or recording condition.
2. Both control and treatment runs complete successfully on the same corpus.
3. Treatment reduces semitone-neighbour ghosts or false chromatic events without a material recall regression.
4. Genuine semitone steps and same-pitch re-attacks are not incorrectly fused.
5. Key accuracy does not regress.
6. Warm and cold runs produce equivalent transcription results.
7. Warm p95 latency is measured with the real Basic Pitch runtime.
8. Chosen Pro concurrency does not produce unacceptable p95 latency, OOMs, timeout spikes, or worker starvation.
9. Telemetry identifies the experiment arm and treatment behavior without exposing private audio or user data.
10. Rollback is tested by assigning new requests to control or setting `NF_CONTOUR_GAP_MERGE=0`.

Suggested initial rollback guardrails are:

- Treatment F1 decrease greater than 0.02.
- Labelled semitone-neighbour ghost increase greater than 10%.
- p95 latency increase greater than 15%.
- Error-rate increase greater than 0.5 percentage points.
- Any worker OOM or repeated timeout spike.

Tune thresholds only after collecting enough stable traffic and documenting the decision.

## Required final deliverables from the agent

After completing the remaining work, produce:

1. A control-versus-treatment accuracy report with per-case and aggregate metrics.
2. A concurrency latency report with p50, p95, p99, throughput, memory, and errors.
3. A telemetry implementation summary and dashboard/alert references.
4. The exact environment and commands used.
5. A statement of any blocked measurements or untested deployment conditions.
6. Updated tests and a clean `git diff --check` result.

Do not claim the vocal fix improved accuracy until the labelled real-corpus comparison supports that conclusion.
