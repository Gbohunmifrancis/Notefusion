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
    """Attach a handler to the root logger so this service's own logs are emitted.

    Uvicorn configures the ``uvicorn*`` loggers and nothing else, so every
    ``logger.info`` in ``app.*`` was being dropped by the root logger's default
    WARNING level with no handler beneath it. That is why the job queue reached for
    ``print`` - it was the only thing that came out - and why a failed transcription
    left no traceback to read. basicConfig is a no-op if root already has handlers,
    so a host that configures logging itself (pytest's caplog, gunicorn) still wins.
    """
    logging.basicConfig(
        level=os.environ.get("NF_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


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
            from basic_pitch import ICASSP_2022_MODEL_PATH  # noqa: F401
            from basic_pitch.inference import Model
            Model(ICASSP_2022_MODEL_PATH)
        logger.info("basic_pitch ONNX model pre-warmed OK")
    except Exception as exc:  # noqa: BLE001
        logger.warning("basic_pitch warmup skipped: %s", exc)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Configure logging, inject APT PATH, pre-warm model, start worker, drain on shutdown."""
    # First, so the two calls below can report what they did.
    _configure_logging()
    _ensure_apt_path()
    _warmup_basic_pitch()
    queue = JobQueue(workers=settings.inference_workers)
    _app.state.queue = queue
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
