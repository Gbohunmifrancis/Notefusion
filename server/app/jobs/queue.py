"""In-process job queue (TRD par. 3.3: in-process for MVP, Redis + workers at scale).

A 30 s clip transcribes in seconds on CPU; a single-worker executor serializes
inference so concurrent uploads queue instead of thrashing one VPS core.
Audio files are deleted the moment processing ends (TRD par. 9); only the
structured result lives in memory, and it expires after a TTL.
"""

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from app.config import settings
from app.pipeline.transcriber import LowConfidenceError, TranscriptionResult, transcribe

STATUS_PENDING = "pending"
STATUS_PROCESSING = "processing"
STATUS_DONE = "done"
STATUS_FAILED = "failed"


@dataclass
class Job:
    id: str
    status: str = STATUS_PENDING
    progress: float = 0.0
    result: TranscriptionResult | None = None
    error: str | None = None
    finished_at: float | None = None


class JobQueue:
    def __init__(self, workers: int = settings.inference_workers) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=workers,
                                            thread_name_prefix="nf-inference")

    def submit(self, audio_path: Path, mode: str,
               key: str | None, tempo: int | None) -> str:
        job = Job(id=uuid.uuid4().hex)
        with self._lock:
            self._purge_expired()
            self._jobs[job.id] = job
        self._executor.submit(self._run, job, audio_path, mode, key, tempo)
        return job.id

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            self._purge_expired()
            return self._jobs.get(job_id)

    def _run(self, job: Job, audio_path: Path, mode: str,
             key: str | None, tempo: int | None) -> None:
        job.status = STATUS_PROCESSING
        try:
            job.result = transcribe(
                audio_path, mode=mode, key_override=key, tempo_override=tempo,
                progress=lambda fraction: setattr(job, "progress", fraction))
            job.status = STATUS_DONE
            job.progress = 1.0
        except LowConfidenceError as ex:
            job.status = STATUS_FAILED
            job.error = str(ex)
        except Exception as ex:  # noqa: BLE001 - job boundary; error goes to the client
            job.status = STATUS_FAILED
            job.error = f"Transcription failed: {ex}"
        finally:
            job.finished_at = time.monotonic()
            # Privacy by default: the recording never outlives its job (TRD par. 9)
            audio_path.unlink(missing_ok=True)

    def shutdown(self, wait: bool = True, timeout: float | None = None) -> None:
        """Drain the inference executor and drop all job state."""
        self._executor.shutdown(wait=wait, cancel_futures=not wait)

    def _purge_expired(self) -> None:
        now = time.monotonic()
        expired = [jid for jid, j in self._jobs.items()
                   if j.finished_at and now - j.finished_at > settings.job_ttl_seconds]
        for jid in expired:
            del self._jobs[jid]


def _default_queue() -> JobQueue:
    return JobQueue(workers=settings.inference_workers)


job_queue = _default_queue()
