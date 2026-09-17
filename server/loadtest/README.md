# NoteFusion Pro transcription load test

This directory contains a Locust workload for the asynchronous NoteFusion audio transcription API. It submits audio as a Pro-style request, polls `/v1/jobs/{job_id}` until completion, and reports HTTP plus custom transcription latency metrics.

## Install

Keep the load generator environment separate from the API runtime environment:

```bash
cd /home/ubuntu/Notefusion
python3 -m venv .loadtest-venv
. .loadtest-venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r server/loadtest/requirements.txt
```

The load-test environment does not need Basic Pitch. Basic Pitch must be installed and warmed in the server environment being tested.

## Fixture selection

Provide either one representative fixture:

```bash
export LOCUST_AUDIO_FILE=/absolute/path/to/voice-vibrato.wav
```

or a directory. Directory files are selected randomly by default:

```bash
export LOCUST_AUDIO_DIR=/absolute/path/to/locust-audio-fixtures
export LOCUST_AUDIO_SELECTION=random
```

Use `round_robin` when every virtual user should cycle through the same fixture set:

```bash
export LOCUST_AUDIO_SELECTION=round_robin
```

Use consented, representative recordings. Include clean vocals, vibrato, breathy vocals, and vocal-over-accompaniment clips. Do not use private recordings in a shared load-test environment without authorization.

## Pro request headers and options

The API does not currently enforce a Pro plan in the transcription route. If the deployment uses a plan header or gateway, configure it explicitly:

```bash
export LOCUST_PRO_HEADER_NAME=X-Subscription-Tier
export LOCUST_PRO_HEADER_VALUE=pro
```

For bearer authentication:

```bash
export LOCUST_AUTH_TOKEN='replace-with-a-load-test-token'
```

The token is sent only in the request header and is not printed by the script. Use a dedicated load-test account or gateway token with no production data access beyond the test endpoint.

Optional transcription fields:

```bash
export LOCUST_MODE=melody
export LOCUST_TIME_SIGNATURE=4/4
export LOCUST_TEMPO=100
```

## Run headless

The script path is `server/loadtest/locustfile.py`. Start with one user to establish a warm baseline:

```bash
locust -f server/loadtest/locustfile.py \
  --host http://127.0.0.1:8000 \
  --users 1 --spawn-rate 1 --run-time 3m --headless \
  --csv results/pro-warm-u1 --html results/pro-warm-u1.html
```

Then run the recommended concurrency matrix. Use the same fixture set, model version, worker count, CPU limits, and environment for every arm:

```bash
for users in 2 4 8 16; do
  locust -f server/loadtest/locustfile.py \
    --host http://127.0.0.1:8000 \
    --users "$users" --spawn-rate 2 --run-time 10m --headless \
    --csv "results/pro-warm-u${users}" \
    --html "results/pro-warm-u${users}.html"
done
```

Run each level at least three times. Discard the initial warm-up period or run it separately; do not mix cold worker startup with steady-state measurements. For multi-worker server tests, restart the API between configurations so every worker has the same startup warm-up behavior.

## In-flight behavior

By default each Locust user submits one job and waits for it to finish before submitting the next. To model a user with multiple concurrent Pro requests:

```bash
export LOCUST_INFLIGHT_PER_USER=2
```

Use this carefully. Increasing both Locust users and in-flight jobs multiplies pressure on the API queue. Record the effective request rate and do not compare runs with different in-flight settings as if they had the same workload.

Polling defaults are conservative:

```bash
export LOCUST_POLL_INTERVAL=0.25
export LOCUST_POLL_TIMEOUT=300
export LOCUST_HTTP_TIMEOUT=30
```

A shorter polling interval increases GET traffic and can distort server capacity. Keep it fixed across benchmark arms.

## Metrics

Locust’s standard statistics include:

- `POST /v1/transcribe (Pro submit)` response time and error rate.
- `GET /v1/jobs/{job_id} (Pro poll)` response time and error rate.

The script also emits custom `TRANSCRIPTION` entries:

| Name | Meaning |
|---|---|
| `submit_to_processing_observed` | Time from submit start until a poll first observes `processing`. It is bounded by polling interval and is not an exact server queue timestamp. |
| `submit_to_terminal` | Full client-observed time from before upload through `done` or `failed`. This is the primary user-perceived latency metric. |

Use the CSV files for p50, p95, and p99. Compare queue-observed, terminal, and submit HTTP latency together. A rising terminal latency with flat submit latency usually indicates queue or inference saturation. A rising poll latency indicates API or network pressure rather than model compute alone.

## Warmed-model benchmark protocol

For each server configuration, measure these conditions separately:

1. Cold first request after process startup.
2. Warm sequential requests with one Locust user.
3. Warm concurrency 2.
4. Warm concurrency 4.
5. Warm concurrency 8.
6. Warm concurrency 16, only if memory and error guardrails remain healthy.

Record server-side CPU, peak RSS, worker restarts, OOM events, and inference-worker count alongside Locust results. If using multiple processes, each process owns one warmed Basic Pitch model. More workers increase model memory approximately once per process.

Keep native thread settings fixed. A starting benchmark configuration is:

```bash
export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export MKL_NUM_THREADS=1
export NUMEXPR_NUM_THREADS=1
```

Tune only after measuring. Do not claim a Pro speed improvement if queue wait falls while inference time or memory pressure rises.

## Accuracy A/B pairing

Latency tests and accuracy tests should use the same fixture classes but separate runs. For the contour-gap A/B:

```bash
# Control
unset NF_CONTOUR_GAP_MERGE
# run Locust and save results/pro-control-*

# Treatment
export NF_CONTOUR_GAP_MERGE=1
# restart the API, verify warm-up, then run Locust and save results/pro-treatment-*
```

Do not mix the two arms in one server process unless the service records the flag per request. Save the effective environment, code revision, Basic Pitch version, server worker count, CPU type, fixture fingerprint, and Locust command with each result directory.

## Safety and interpretation

Run against staging or an explicitly authorized production slice. Avoid uncontrolled traffic against a public production endpoint. Use a dedicated load-test account, a fixed test bucket, and a time-bounded run.

The load test measures service performance. It does not measure false accidentals or ghost notes because the API response has no ground-truth label. Use the labelled corpus harness for accuracy, and use the telemetry plan in `docs/vocal-ab-test-accuracy-latency-telemetry-report.md` for production candidate-ghost monitoring.
