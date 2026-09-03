"""In-process job queue (TRD par. 3.3: in-process for MVP, Redis + workers at scale).

A 30 s clip transcribes in seconds on CPU; a single-worker executor serializes
inference so concurrent uploads queue instead of thrashing one VPS core.
Audio files are deleted the moment processing ends (TRD par. 9); only the
structured result lives in memory, and it expires after a TTL.
"""

import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from app.config import settings
from app.pipeline.transcriber import LowConfidenceError, TranscriptionResult, transcribe

logger = logging.getLogger(__name__)

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
    #: The C# API's id for the request that created this job, so the two services'
    #: logs describe one transcription under one name. Carried on the Job rather
    #: than in a contextvar because inference runs on a pool thread, and a
    #: contextvar set in the request does not propagate across executor.submit().
    correlation_id: str | None = None


class JobQueue:
    def __init__(self, workers: int = settings.inference_workers) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=workers,
                                            thread_name_prefix="nf-inference")

    def submit(self, audio_path: Path, mode: str,
               key: str | None, tempo: int | None,
               time_signature: str = "4/4",
               correlation_id: str | None = None) -> str:
        job = Job(id=uuid.uuid4().hex, correlation_id=correlation_id)
        with self._lock:
            self._purge_expired()
            self._jobs[job.id] = job
        logger.info("Job %s queued: mode=%s key=%s tempo=%s meter=%s%s",
                    job.id[:8], mode, key or "auto", tempo or "auto", time_signature, self._trail(job))
        self._executor.submit(self._run, job, audio_path, mode, key, tempo, time_signature)
        return job.id

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            self._purge_expired()
            return self._jobs.get(job_id)

    def _run(self, job: Job, audio_path: Path, mode: str,
             key: str | None, tempo: int | None,
             time_signature: str = "4/4") -> None:
        job.status = STATUS_PROCESSING
        try:
            try:
                job.result = transcribe(
                    audio_path, mode=mode, key_override=key, tempo_override=tempo,
                    time_signature=time_signature,
                    progress=lambda fraction: setattr(job, "progress", fraction))
            finally:
                # Stamped on every path out of transcribe() and before any terminal
                # status is written. _purge_expired ignores a job whose finished_at is
                # None, so a job that reports "done" while still unstamped can never be
                # purged in that window - which is exactly what a caller that polls for
                # a terminal status and then relies on the TTL observes. The window is
                # not theoretical: the logging call below writes to a stream handler,
                # which releases the GIL.
                job.finished_at = time.monotonic()
            job.status = STATUS_DONE
            job.progress = 1.0
            note_count = len(job.result.notes) if job.result else 0
            conf = job.result.overall_confidence if job.result else 0.0
            logger.info("Job %s DONE: %d notes, confidence=%.3f%s",
                        job.id[:8], note_count, conf, self._trail(job))
        except LowConfidenceError as ex:
            job.status = STATUS_FAILED
            job.error = str(ex)
            # Expected outcome, not a defect: the clip was too noisy to label honestly.
            logger.warning("Job %s LOW-CONFIDENCE: %s%s", job.id[:8], ex, self._trail(job))
        except Exception as ex:  # noqa: BLE001 - job boundary; error goes to the client
            job.status = STATUS_FAILED
            job.error = f"Transcription failed: {ex}"
            # exception(), so the traceback reaches the log drain: this is the line that
            # used to say only the exception type, leaving nothing to debug from.
            logger.exception("Job %s EXCEPTION: %s%s",
                             job.id[:8], type(ex).__name__, self._trail(job))
        finally:
            # Privacy by default: the recording never outlives its job (TRD par. 9)
            audio_path.unlink(missing_ok=True)

    def submit_score(self, score_path: Path,
                     key: str | None = None, tempo: int | None = None,
                     time_signature: str | None = None,
                     correlation_id: str | None = None) -> str:
        job = Job(id=uuid.uuid4().hex, correlation_id=correlation_id)
        with self._lock:
            self._purge_expired()
            self._jobs[job.id] = job
        logger.info("Score job %s queued: key=%s tempo=%s meter=%s%s",
                    job.id[:8], key or "auto", tempo or "auto", time_signature or "auto", self._trail(job))
        self._executor.submit(self._run_score, job, score_path, key, tempo, time_signature)
        return job.id

    def _run_score(self, job: Job, score_path: Path,
                   key: str | None, tempo: int | None,
                   time_signature: str | None) -> None:
        job.status = STATUS_PROCESSING
        try:
            try:
                from app.pipeline.score_transcriber import transcribe_score
                job.result = transcribe_score(
                    score_path, key_override=key, tempo_override=tempo,
                    time_signature_override=time_signature,
                )
            finally:
                score_path.unlink(missing_ok=True)
                job.finished_at = time.monotonic()
            job.status = STATUS_DONE
            job.progress = 1.0
            note_count = len(job.result.notes) if job.result else 0
            logger.info("Score job %s DONE: %d notes%s",
                        job.id[:8], note_count, self._trail(job))
        except LowConfidenceError as ex:
            job.status = STATUS_FAILED
            job.error = str(ex)
            logger.warning("Score job %s FAILED: %s%s", job.id[:8], ex, self._trail(job))
        except Exception as ex:  # noqa: BLE001
            job.status = STATUS_FAILED
            job.error = f"Score transcription failed: {ex}"
            logger.exception("Score job %s EXCEPTION: %s%s",
                             job.id[:8], type(ex).__name__, self._trail(job))
        finally:
            score_path.unlink(missing_ok=True)

    @staticmethod
    def _trail(job: Job) -> str:
        """The API's correlation id as a log suffix, or nothing when there is none."""
        return f" correlationId={job.correlation_id}" if job.correlation_id else ""

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
