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
    """Inject APT PATH, pre-warm model, start worker, drain cleanly on shutdown."""
    _ensure_apt_path()
    _warmup_basic_pitch()
    queue = JobQueue(workers=settings.inference_workers)
    _app.state.queue = queue
    yield
    queue.shutdown()


app = FastAPI(
    title="NoteFusion Transcription API",
    version="0.1.0",
    description="Audio -> note events -> staff (MusicXML) + Tonic Solfa.",
    lifespan=lifespan,
)
app.include_router(router)


@app.get("/healthz", include_in_schema=False)
async def healthz() -> dict:
    return {"status": "ok"}
