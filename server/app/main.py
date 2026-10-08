"""NoteFusion transcription API (TRD par. 3.3): FastAPI + Uvicorn, Dockerised,
CPU inference via Basic Pitch/ONNX. Run locally:

    uvicorn app.main:app --host 0.0.0.0 --port 8000
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router
from app.config import settings
from app.jobs.queue import JobQueue

logger = logging.getLogger(__name__)


def _configure_logging() -> None:
    """Configure structured logging via structlog."""
    from app.telemetry import configure_telemetry
    is_prod = os.environ.get("ASPNETCORE_ENVIRONMENT", "Development") != "Development"
    configure_telemetry(json_format=is_prod)


def _ensure_apt_path() -> None:
    """Inject Heroku APT bin dirs into PATH before any subprocess calls.

    heroku-buildpack-apt installs ffmpeg to /app/.apt/usr/bin at build time but
    does NOT persist that PATH addition into the runtime dyno environment, so
    shutil.which('ffmpeg') returns None unless we add it explicitly.
    """
    for apt_dir in ("/app/.apt/usr/bin", "/app/.apt/bin"):
        if apt_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = apt_dir + ":" + os.environ.get("PATH", "")


def _warmup_basic_pitch() -> None:
    """Load the ONNX model into memory at startup.

    basic_pitch lazy-loads the ONNX session on the first call to predict(),
    adding ~3-4 seconds to the first transcription request and logging noisy
    backend warnings at that point.  Loading here moves that cost to startup
    (before Heroku marks the dyno 'up') so every user request is fast.
    """
    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            from app.pipeline.transcriber import get_basic_pitch_model
            get_basic_pitch_model()
        logger.info("basic_pitch ONNX model pre-warmed OK")
    except Exception as exc:  # noqa: BLE001
        logger.warning("basic_pitch warmup skipped: %s", exc)


def _warmup_pipeline() -> None:
    """Run one short clip through the whole pipeline so the JIT work is paid before a user arrives.

    librosa's pyin and beat tracker are numba-compiled on first use, and the first
    transcription after a container starts paid for that: measured at 38 s against 9 s
    for the identical clip once warm, on a two-minute hummed tune. Every deploy restarts
    the container, so until now every deploy handed that bill to whoever uploaded next —
    on a small instance, close to a minute of "transcribing…" for a few bars.

    A synthetic three-second tune is enough to compile every path the melody pipeline
    takes (both lanes share the compiled functions), and the result is thrown away. Run on
    a daemon thread so the health check and the queue come up at once; a real job that
    lands during the warm-up simply shares the CPU with it for a few seconds.
    """
    import threading

    def run() -> None:
        import tempfile
        import time
        import warnings
        from pathlib import Path

        import numpy as np

        started = time.perf_counter()
        try:
            import soundfile as sf
            from app.pipeline.transcriber import transcribe

            sr = 22_050
            t = np.arange(int(3.0 * sr)) / sr
            # Three sung-ish notes with a little vibrato, so pyin has something to track
            # and the beat tracker has onsets to find.
            freqs = np.select([t < 1.0, t < 2.0], [261.63, 329.63], 392.0)
            phase = 2 * np.pi * np.cumsum(freqs * (1 + 0.004 * np.sin(2 * np.pi * 5.5 * t))) / sr
            env = np.minimum(1.0, (t % 1.0) / 0.03) * np.minimum(1.0, (1.0 - (t % 1.0)) / 0.05)
            y = (0.5 * env * np.sin(phase)).astype(np.float32)
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                path = Path(tmp.name)
            sf.write(path, y, sr)
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    transcribe(path, mode="melody")
            finally:
                path.unlink(missing_ok=True)
            logger.info("pipeline warm-up done in %.1fs", time.perf_counter() - started)
        except Exception as exc:  # noqa: BLE001 - warm-up is an optimisation, never a failure
            logger.warning("pipeline warm-up skipped: %s", exc)

    threading.Thread(target=run, name="nf-warmup", daemon=True).start()


class _HealthCheckFilter(logging.Filter):
    """Keeps the probe's ``GET /healthz`` out of the access log: one line every ten seconds
    buried every real one, and the last hour of the log said nothing at all."""

    def filter(self, record: logging.LogRecord) -> bool:
        return "/healthz" not in record.getMessage()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Configure logging, inject APT PATH, pre-warm model, start worker, drain on shutdown."""
    # First, so the two calls below can report what they did.
    _configure_logging()
    _ensure_apt_path()
    
    import structlog
    logger = structlog.get_logger("app.main")
    git_sha = os.environ.get("HEROKU_SLUG_COMMIT", "unknown")
    logger.info("app_startup", git_sha=git_sha, model_version="icassp_2022", worker_pid=os.getpid(), nf_contour_gap_merge=os.environ.get("NF_CONTOUR_GAP_MERGE"))
    
    _warmup_basic_pitch()
    if settings.pipeline_warmup:
        _warmup_pipeline()
    logging.getLogger("uvicorn.access").addFilter(_HealthCheckFilter())
    queue = JobQueue(workers=settings.inference_workers, pro_lane_workers=settings.pro_lane_workers,
                     job_dir=settings.job_dir or None)
    _app.state.queue = queue
    # The jobs a restart interrupted, from the journal; only this queue ever replays them.
    queue.recover()
    yield
    queue.shutdown()


import hmac
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


class ApiKeyAuthMiddleware(BaseHTTPMiddleware):
    """Protects internal transcription endpoints when NF_API_KEY is configured."""

    async def dispatch(self, request, call_next):
        expected_key = settings.api_key
        if not expected_key:
            return await call_next(request)

        # Allow liveness probe without authentication
        if request.url.path in ("/healthz", "/healthz/"):
            return await call_next(request)

        # Allow OpenAPI documentation if accessed
        if request.url.path in ("/docs", "/redoc", "/openapi.json"):
            return await call_next(request)

        provided_key = request.headers.get("x-api-key")
        if not provided_key and (auth_header := request.headers.get("authorization")):
            if auth_header.lower().startswith("bearer "):
                provided_key = auth_header[7:].strip()

        if not provided_key or not hmac.compare_digest(provided_key, expected_key):
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing API key."}
            )

        return await call_next(request)


app = FastAPI(
    title="NoteFusion Transcription API",
    version="0.1.0",
    description="Audio -> note events -> staff (MusicXML) + Tonic Solfa.",
    lifespan=lifespan,
)
app.add_middleware(ApiKeyAuthMiddleware)
app.include_router(router)


@app.get("/healthz", include_in_schema=False)
async def healthz() -> dict:
    return {"status": "ok"}
