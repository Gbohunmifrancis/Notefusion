"""NoteFusion transcription API (TRD par. 3.3): FastAPI + Uvicorn, Dockerised,
CPU inference via Basic Pitch/ONNX. Run locally:

    uvicorn app.main:app --host 0.0.0.0 --port 8000
"""

import logging
import os
import shutil
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from app.api.practice import router as practice_router
from app.api.routes import router
from app.config import TEMP_PREFIX, TEMP_PREFIXES, settings
from app.jobs.queue import JobQueue

logger = logging.getLogger(__name__)

#: When this process began: a temp file older than this was left by an earlier one.
_PROCESS_STARTED = time.time()


def _require_api_key() -> None:
    """Refuse to start without ``NF_API_KEY`` unless ``NF_ALLOW_NO_AUTH=1`` says so: an empty
    key used to turn auth off without a word, so a deploy that lost its secret served anyone."""
    if not settings.api_key and not settings.allow_no_auth:
        raise RuntimeError("NF_API_KEY is empty. Set it (the C# API sends the same key), "
                           "or set NF_ALLOW_NO_AUTH=1 to run without authentication.")


def _sweep_stale_temp_files(directory: str | os.PathLike | None = None, before: float | None = None) -> int:
    """Remove the temp files and directories an earlier process left (an out-of-memory kill
    skips every ``finally``): only this app's prefixes, and only ones older than this process,
    so nothing a running job is using goes. The number removed."""
    root = Path(directory or tempfile.gettempdir())
    cutoff = _PROCESS_STARTED if before is None else before
    removed = 0
    try:
        candidates = [p for p in root.iterdir() if p.name.startswith(TEMP_PREFIXES)]
    except OSError:
        return 0
    for path in candidates:
        try:
            if path.lstat().st_mtime >= cutoff:
                continue
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink(missing_ok=True)
            removed += 1
        except OSError:
            continue
    if removed:
        logger.info("Removed %d temp files left by an earlier process", removed)
    return removed


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
            with tempfile.NamedTemporaryFile(prefix=TEMP_PREFIX, suffix=".wav", delete=False) as tmp:
                path = Path(tmp.name)
            sf.write(path, y, sr)
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    transcribe(path, mode="melody")
            finally:
                path.unlink(missing_ok=True)
            # The hymn index too, which the first look-up (``/v1/identify``) would otherwise load.
            from app.pipeline import hymn_match
            hymn_match.default_index()
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
    _require_api_key()
    _ensure_apt_path()
    _sweep_stale_temp_files()
    # yt-dlp goes stale within weeks of a YouTube change: the newest release is installed beside
    # the image's in the background (app.ingest.ytdlp_update), so startup does not wait for it.
    from app.ingest import ytdlp_update
    ytdlp_update.start_background()

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
    """Protects internal transcription endpoints with NF_API_KEY (absent only under
    NF_ALLOW_NO_AUTH, which ``_require_api_key`` insists on)."""

    async def dispatch(self, request, call_next):
        expected_key = settings.api_key
        if not expected_key:
            return await call_next(request)

        # Allow liveness probe without authentication
        if request.url.path in ("/healthz", "/healthz/"):
            return await call_next(request)

        # The documentation, when it is served at all (NF_ENABLE_DOCS)
        if _DOCS_ENABLED and request.url.path in ("/docs", "/redoc", "/openapi.json"):
            return await call_next(request)

        provided_key = request.headers.get("x-api-key")
        if not provided_key and (auth_header := request.headers.get("authorization")):
            if auth_header.lower().startswith("bearer "):
                provided_key = auth_header[7:].strip()

        # As bytes: compare_digest refuses a str with non-ASCII in it, and a header decoded
        # as latin-1 can carry any byte, which made a stray header a 500 instead of a 401.
        if not provided_key or not hmac.compare_digest(provided_key.encode(), expected_key.encode()):
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing API key."}
            )

        return await call_next(request)


#: Read once: the routes below are fixed when the app is built.
_DOCS_ENABLED = settings.enable_docs

# Crashes to Sentry when NF_SENTRY_DSN is set (app.telemetry); before the app is made, so it is seen.
from app.telemetry import configure_error_reporting  # noqa: E402

configure_error_reporting()

app = FastAPI(
    title="NoteFusion Transcription API",
    version="0.1.0",
    description="Audio -> note events -> staff (MusicXML) + Tonic Solfa.",
    lifespan=lifespan,
    docs_url="/docs" if _DOCS_ENABLED else None,
    redoc_url="/redoc" if _DOCS_ENABLED else None,
    openapi_url="/openapi.json" if _DOCS_ENABLED else None,
)
app.add_middleware(ApiKeyAuthMiddleware)
app.include_router(router)
app.include_router(practice_router)


@app.get("/healthz", include_in_schema=False)
async def healthz() -> dict:
    return {"status": "ok"}
