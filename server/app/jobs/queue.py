"""In-process job queue (TRD par. 3.3: in-process for MVP, Redis + workers at scale).

A 30 s clip transcribes in seconds on CPU; a small pool of worker threads serialises
inference so concurrent uploads queue instead of thrashing one VPS core.  Audio files
are deleted the moment processing ends (TRD par. 9); only the structured result lives
in memory, and it expires after a TTL.

Two lanes.  Every job carries a priority, and the workers always take the highest
priority waiting job first: a Pro user's clip never waits behind a free user's
four-minute song.  Within a lane, first come first served.
"""

import itertools
import logging
import queue as queue_mod
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from app.config import settings
from app.pipeline.transcriber import LowConfidenceError, TranscriptionResult, transcribe

logger = logging.getLogger(__name__)

STATUS_PENDING = "pending"
STATUS_PROCESSING = "processing"
STATUS_DONE = "done"
STATUS_FAILED = "failed"

PRIORITY_HIGH = "high"
PRIORITY_NORMAL = "normal"
_PRIORITY_RANK = {PRIORITY_HIGH: 0, PRIORITY_NORMAL: 1}

STAGE_FETCHING = "fetching"
STAGE_SEPARATING = "separating"
STAGE_TRANSCRIBING = "transcribing"

_GENERIC_ERROR = "An unexpected error occurred during transcription. Please try recording again."


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
    callback_url: str | None = None
    priority: str = PRIORITY_NORMAL
    #: Which part of a multi-step job is running (link jobs only); None for an upload.
    stage: str | None = None
    #: Title/artist of a linked song, known as soon as the link resolves — before the
    #: result exists — so a client can show what is being transcribed while it waits.
    source: dict | None = None


class JobQueue:
    def __init__(self, workers: int = settings.inference_workers) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._queue: queue_mod.PriorityQueue = queue_mod.PriorityQueue()
        self._seq = itertools.count()
        self._threads = [
            threading.Thread(target=self._worker, name=f"nf-inference-{i}", daemon=True)
            for i in range(max(1, workers))
        ]
        for t in self._threads:
            t.start()

    # ── Submission ────────────────────────────────────────────────────────────

    def submit(self, audio_path: Path, mode: str,
               key: str | None, tempo: int | None,
               time_signature: str = "4/4",
               correlation_id: str | None = None,
               callback_url: str | None = None,
               priority: str = PRIORITY_NORMAL) -> str:
        job = self._new_job(correlation_id, callback_url, priority)
        logger.info("Job %s queued: mode=%s key=%s tempo=%s meter=%s priority=%s%s",
                    job.id[:8], mode, key or "auto", tempo or "auto", time_signature,
                    job.priority, self._trail(job))
        self._enqueue(job, lambda: self._run(job, audio_path, mode, key, tempo, time_signature))
        return job.id

    def submit_link(self, url: str, mode: str,
                    key: str | None, tempo: int | None,
                    time_signature: str = "4/4",
                    correlation_id: str | None = None,
                    callback_url: str | None = None,
                    priority: str = PRIORITY_NORMAL,
                    max_seconds: float | None = None) -> str:
        job = self._new_job(correlation_id, callback_url, priority)
        job.stage = STAGE_FETCHING
        cap = float(max_seconds or settings.link_max_seconds)
        logger.info("Link job %s queued: mode=%s cap=%.0fs priority=%s%s",
                    job.id[:8], mode, cap, job.priority, self._trail(job))
        self._enqueue(job, lambda: self._run_link(job, url, mode, key, tempo, time_signature, cap))
        return job.id

    def submit_score(self, score_path: Path,
                     key: str | None = None, tempo: int | None = None,
                     time_signature: str | None = None,
                     correlation_id: str | None = None,
                     callback_url: str | None = None,
                     priority: str = PRIORITY_NORMAL) -> str:
        job = self._new_job(correlation_id, callback_url, priority)
        logger.info("Score job %s queued: key=%s tempo=%s meter=%s%s",
                    job.id[:8], key or "auto", tempo or "auto", time_signature or "auto", self._trail(job))
        self._enqueue(job, lambda: self._run_score(job, score_path, key, tempo, time_signature))
        return job.id

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            self._purge_expired()
            return self._jobs.get(job_id)

    # ── Internals ─────────────────────────────────────────────────────────────

    def _new_job(self, correlation_id: str | None, callback_url: str | None, priority: str) -> Job:
        job_id = uuid.uuid4().hex
        if callback_url:
            callback_url = callback_url.replace("{job_id}", job_id)
        if priority not in _PRIORITY_RANK:
            priority = PRIORITY_NORMAL
        job = Job(id=job_id, correlation_id=correlation_id, callback_url=callback_url, priority=priority)
        with self._lock:
            self._purge_expired()
            self._jobs[job.id] = job
        return job

    def _enqueue(self, job: Job, fn) -> None:
        self._queue.put((_PRIORITY_RANK[job.priority], next(self._seq), fn))

    def _worker(self) -> None:
        while True:
            _rank, _seq, fn = self._queue.get()
            if fn is None:
                self._queue.task_done()
                return
            try:
                fn()
            except Exception:  # noqa: BLE001 - a job body already reports; never kill the worker
                logger.exception("Unhandled error in queue worker")
            finally:
                self._queue.task_done()

    def _run(self, job: Job, audio_path: Path, mode: str,
             key: str | None, tempo: int | None,
             time_signature: str = "4/4") -> None:
        job.status = STATUS_PROCESSING
        try:
            try:
                job.result = transcribe(
                    audio_path, mode=mode, key_override=key, tempo_override=tempo,
                    time_signature=time_signature,
                    progress=lambda fraction: setattr(job, "progress", fraction),
                    fast=job.priority == PRIORITY_HIGH)
            finally:
                # Stamped on every path out of transcribe() and before any terminal
                # status is written. _purge_expired ignores a job whose finished_at is
                # None, so a job that reports "done" while still unstamped can never be
                # purged in that window - which is exactly what a caller that polls for
                # a terminal status and then relies on the TTL observes. The window is
                # not theoretical: the logging call below writes to a stream handler,
                # which releases the GIL.
                job.finished_at = time.monotonic()
            self._done(job, "Job")
        except LowConfidenceError as ex:
            self._failed(job, str(ex), "Job", ex)
        except Exception as ex:  # noqa: BLE001 - job boundary; error goes to the client
            self._crashed(job, "Job", ex)
        finally:
            # Privacy by default: the recording never outlives its job (TRD par. 9)
            audio_path.unlink(missing_ok=True)
            self._trigger_webhook(job)

    def _run_link(self, job: Job, url: str, mode: str,
                  key: str | None, tempo: int | None,
                  time_signature: str, max_seconds: float) -> None:
        from app.ingest.links import LinkError, fetch_audio, resolve_source
        from app.pipeline import separate

        job.status = STATUS_PROCESSING
        work_dir: Path | None = None
        try:
            try:
                job.stage = STAGE_FETCHING
                job.progress = 0.02
                source = resolve_source(url)
                job.source = _source_dict(source)
                wav, song_seconds = fetch_audio(source, max_seconds)
                work_dir = wav.parent
                job.progress = 0.10

                if separate.available():
                    job.stage = STAGE_SEPARATING
                    vocals = separate.separate_file(
                        wav, work_dir / "vocals.wav",
                        progress=lambda f: setattr(job, "progress", 0.10 + 0.45 * f))
                    separated = True
                else:
                    logger.warning("Link job %s: no separation model at %s; transcribing the mixture",
                                   job.id[:8], separate.model_path())
                    vocals, separated = wav, False

                job.stage = STAGE_TRANSCRIBING
                job.result = transcribe(
                    vocals, mode=mode, key_override=key, tempo_override=tempo,
                    time_signature=time_signature,
                    progress=lambda fraction: setattr(job, "progress", 0.55 + 0.45 * fraction),
                    fast=job.priority == PRIORITY_HIGH)
                job.result.source = job.source
                job.result.song_duration_sec = round(song_seconds, 1)
                job.result.truncated = song_seconds > max_seconds + 0.5
                job.result.separated = separated
            finally:
                job.finished_at = time.monotonic()
            self._done(job, "Link job")
        except (LowConfidenceError, LinkError) as ex:
            self._failed(job, str(ex), "Link job", ex)
        except Exception as ex:  # noqa: BLE001
            self._crashed(job, "Link job", ex)
        finally:
            if work_dir is not None:
                shutil.rmtree(work_dir, ignore_errors=True)
            self._trigger_webhook(job)

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
            self._done(job, "Score job")
        except LowConfidenceError as ex:
            self._failed(job, str(ex), "Score job", ex)
        except Exception as ex:  # noqa: BLE001
            job.status = STATUS_FAILED
            job.error = "An unexpected error occurred during score transcription. Please try uploading again."
            logger.exception("Score job %s EXCEPTION: %s%s",
                             job.id[:8], type(ex).__name__, self._trail(job))
        finally:
            score_path.unlink(missing_ok=True)
            self._trigger_webhook(job)

    def _done(self, job: Job, label: str) -> None:
        job.status = STATUS_DONE
        job.progress = 1.0
        job.stage = None
        note_count = len(job.result.notes) if job.result else 0
        conf = job.result.overall_confidence if job.result else 0.0
        logger.info("%s %s DONE: %d notes, confidence=%.3f%s",
                    label, job.id[:8], note_count, conf, self._trail(job))

    def _failed(self, job: Job, message: str, label: str, ex: Exception) -> None:
        job.status = STATUS_FAILED
        job.error = message
        job.stage = None
        # Expected outcome, not a defect: the clip was too noisy, or the link unusable.
        logger.warning("%s %s FAILED: %s%s", label, job.id[:8], ex, self._trail(job))

    def _crashed(self, job: Job, label: str, ex: Exception) -> None:
        job.status = STATUS_FAILED
        job.error = _GENERIC_ERROR
        job.stage = None
        # exception(), so the traceback reaches the log drain: this is the line that
        # used to say only the exception type, leaving nothing to debug from.
        logger.exception("%s %s EXCEPTION: %s%s", label, job.id[:8], type(ex).__name__, self._trail(job))

    def _trigger_webhook(self, job: Job) -> None:
        if not job.callback_url:
            return

        from dataclasses import asdict

        from app.api.schemas import JobResponse, ResultDto

        result_payload = None
        if job.result is not None:
            p = asdict(job.result)
            p["notes"] = p.pop("notes")  # match get_job behavior if any
            result_payload = ResultDto.model_validate(p)

        jr = JobResponse(status=job.status, progress=job.progress, stage=job.stage,
                         source=job.source, result=result_payload, error=job.error)

        payload = jr.model_dump(by_alias=True, exclude_none=True)

        def fire():
            try:
                with httpx.Client(timeout=10.0) as client:
                    resp = client.post(job.callback_url, json=payload)
                    resp.raise_for_status()
                logger.info("Webhook for job %s delivered to %s", job.id[:8], job.callback_url)
            except Exception as e:
                logger.warning("Failed to deliver webhook for job %s to %s: %s", job.id[:8], job.callback_url, e)

        # Fire in a separate thread so we don't block the executor pool if the webhook is slow
        threading.Thread(target=fire, name=f"webhook-{job.id[:8]}", daemon=True).start()

    @staticmethod
    def _trail(job: Job) -> str:
        """The API's correlation id as a log suffix, or nothing when there is none."""
        return f" correlationId={job.correlation_id}" if job.correlation_id else ""

    def shutdown(self, wait: bool = True, timeout: float | None = None) -> None:
        """Drain the workers and drop all job state."""
        for _ in self._threads:
            self._queue.put((99, next(self._seq), None))
        if wait:
            for t in self._threads:
                t.join(timeout)

    def _purge_expired(self) -> None:
        now = time.monotonic()
        expired = [jid for jid, j in self._jobs.items()
                   if j.finished_at and now - j.finished_at > settings.job_ttl_seconds]
        for jid in expired:
            del self._jobs[jid]


def _source_dict(source) -> dict:
    return {
        "provider": source.provider,
        "url": source.url,
        "title": source.title,
        "artist": source.artist,
        "thumbnail_url": source.thumbnail_url,
    }


def _default_queue() -> JobQueue:
    return JobQueue(workers=settings.inference_workers)


job_queue = _default_queue()
