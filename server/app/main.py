"""NoteFusion transcription API (TRD par. 3.3): FastAPI + Uvicorn, Dockerised,
CPU inference via Basic Pitch/ONNX. Run locally:

    uvicorn app.main:app --host 0.0.0.0 --port 8000
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router
from app.config import settings
from app.jobs.queue import JobQueue


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Start a single inference worker on boot and drain it cleanly on shutdown."""
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
