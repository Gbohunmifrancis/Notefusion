# NoteFusion Basic Pitch runtime and warmed-model setup

## 1. Use a clean Python environment

The repository was validated against the pinned server dependencies. From the repository root:

```bash
cd /home/ubuntu/Notefusion
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
```

On Ubuntu, install the native audio libraries before Python packages:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg libsndfile1
```

`ffmpeg` is required for format conversion paths. `libsndfile1` supports WAV decoding through `soundfile`.

## 2. Install the pinned server dependencies

The repository intentionally does not install Basic Pitch with its normal dependency resolver because Basic Pitch 0.4.0 pulls TensorFlow from PyPI. NoteFusion uses the ONNX backend instead.

From the `server/` directory:

```bash
cd /home/ubuntu/Notefusion/server
python -m pip install -r requirements.txt
python -m pip install --no-deps basic-pitch==0.4.0
```

The important pinned pieces are:

| Package | Version | Role |
|---|---:|---|
| `basic-pitch` | `0.4.0` | Note event model and inference API |
| `onnxruntime` | `1.27.0` | CPU ONNX inference backend |
| `numpy` | `2.4.6` | Numerical runtime |
| `librosa` | `0.11.0` | Audio loading and pyin refinement |
| `soundfile` | `0.14.0` | WAV decoding |
| `music21` | `10.5.0` | Score and notation output |
| `mir_eval` | `0.8.2` | Basic Pitch note-creation dependency and evaluation metrics |
| `mido` | `1.3.3` | MIDI support |

Do not run `pip install basic-pitch==0.4.0` without `--no-deps` in this service environment unless you intentionally want the TensorFlow dependency tree.

## 3. Verify the runtime before starting the API

Run this from `server/` while the virtual environment is active:

```bash
python - <<'PY'
from basic_pitch import ICASSP_2022_MODEL_PATH
from basic_pitch.inference import Model
import onnxruntime

print("model_path:", ICASSP_2022_MODEL_PATH)
print("onnxruntime:", onnxruntime.__version__)
model = Model(ICASSP_2022_MODEL_PATH)
print("basic_pitch_model_load: OK")
PY
```

The model load should complete without a TensorFlow import requirement. If it fails, inspect the exception before starting Uvicorn. Common causes are a missing `onnxruntime`, incompatible NumPy wheels, or a Python version unsupported by one of the pinned packages.

## 4. How the warmed accessor works

The implementation is in `server/app/pipeline/transcriber.py`:

```python
_BASIC_PITCH_MODEL = None
_BASIC_PITCH_MODEL_LOCK = threading.Lock()


def get_basic_pitch_model():
    global _BASIC_PITCH_MODEL
    if _BASIC_PITCH_MODEL is None:
        with _BASIC_PITCH_MODEL_LOCK:
            if _BASIC_PITCH_MODEL is None:
                _BASIC_PITCH_MODEL = Model(ICASSP_2022_MODEL_PATH)
    return _BASIC_PITCH_MODEL
```

The lock protects only first initialization. After the first successful load, requests receive the same process-local model object. The transcription path passes that object to Basic Pitch `predict()` instead of passing the model path on every request.

The FastAPI lifespan in `server/app/main.py` calls the accessor during application startup. Therefore the first user request does not pay the normal model initialization cost. Each OS process has its own model instance; a four-worker deployment consumes approximately four model copies and must be sized for available memory.

Do not create a second model in route code, a queue job, or a request handler. Always call:

```python
from app.pipeline.transcriber import get_basic_pitch_model
model = get_basic_pitch_model()
```

## 5. Start the API with startup warm-up

From `server/`:

```bash
. /home/ubuntu/Notefusion/.venv/bin/activate
cd /home/ubuntu/Notefusion/server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

A successful startup should contain a log line similar to:

```text
basic_pitch ONNX model pre-warmed OK
```

If startup logs `basic_pitch warmup skipped`, the service still starts by design, but the first transcription will attempt lazy initialization and should be treated as an operational warning. Fix the dependency or model-load failure rather than accepting that state in production.

For a multi-process deployment, warm-up runs once per worker. For example:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
```

Begin with one worker and benchmark two or four workers before increasing capacity. Do not assume that more workers reduce p95 latency: each worker may also start native ONNX, BLAS, and pyin threads.

## 6. Verify warm-up through the application

Run the helper and server tests:

```bash
cd /home/ubuntu/Notefusion/server
python -m pytest -q tests/test_transcriber_helpers.py
python -m pytest -q
```

The warmed accessor regression test verifies that an already-loaded model object is returned unchanged. A production smoke test should then submit the same short WAV twice and record both durations. The first request should not contain model construction because startup already performed it. The two requests should produce the same transcription result under the same flags.

## 7. Recommended ONNX and worker settings for Pro benchmarking

Do not change thread settings blindly. Benchmark a controlled matrix and record the values with every result. A starting point for a single CPU worker is:

```bash
export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export MKL_NUM_THREADS=1
export NUMEXPR_NUM_THREADS=1
```

Then benchmark one, two, and four API workers or queue workers. The correct setting depends on the host CPU and memory. Compare p50, p95, and p99 queue-to-result latency, peak RSS, CPU utilization, timeout rate, and transcription metrics. Keep Pro capacity separate from free-tier capacity so a Pro burst cannot starve other requests.

The accuracy experiment can be enabled independently:

```bash
export NF_CONTOUR_GAP_MERGE=1
```

This flag is intentionally disabled by default until it has been evaluated on labelled vocal recordings. Model warm-up does not depend on this flag.

## 8. Troubleshooting

### `ModuleNotFoundError: basic_pitch`

Confirm the virtual environment is active and run:

```bash
python -m pip show basic-pitch
python -m pip install --no-deps basic-pitch==0.4.0
```

### TensorFlow is being installed or imported

Remove the accidentally resolved Basic Pitch dependency tree from the environment and reinstall the repository requirements followed by:

```bash
python -m pip install --no-deps basic-pitch==0.4.0
```

The service is intended to use ONNX Runtime, not TensorFlow.

### ONNX Runtime cannot load the model

Verify:

```bash
python -c 'import onnxruntime; print(onnxruntime.__version__)'
python -c 'from basic_pitch import ICASSP_2022_MODEL_PATH; from basic_pitch.inference import Model; Model(ICASSP_2022_MODEL_PATH); print("OK")'
```

Check that the host architecture has a compatible wheel and that no conflicting NumPy or ONNX packages were installed outside the virtual environment.

### Warm-up succeeds but the first request is still slow

Confirm that the running process is using the current `app.main` and that only one deployment copy is being measured. Check for worker restarts, health-check failures, container CPU throttling, and audio conversion overhead. The accessor removes model construction from the request path; it does not remove WAV decoding, pyin refinement, score assembly, or queue wait.

## 9. Rollback

To disable the experimental segmentation behavior without changing warm-up:

```bash
unset NF_CONTOUR_GAP_MERGE
```

To roll back the warmed accessor, revert the application changes to `server/app/pipeline/transcriber.py` and `server/app/main.py`, but do not make this the normal operational response. A warm model is the safer baseline once its accuracy-equivalence and memory behavior have been verified.
