"""In-process job queue (TRD par. 3.3: in-process for MVP, Redis + workers at scale).

A 30 s clip transcribes in seconds on CPU; a small pool of worker threads serialises
inference so concurrent uploads queue instead of thrashing one VPS core.  Audio files
are deleted the moment processing ends (TRD par. 9); only the structured result lives
in memory, and it expires after a TTL.

Two lanes.  Every job carries a priority, and the general workers always take the
highest priority waiting job first: a Pro user's clip never waits behind a free user's
four-minute song that is still *queued*.  Within a lane, first come first served.

That ordering says nothing about a job that is already *running*, and with one general
worker that is where the Pro lane used to stall: a free three-minute upload, or a linked
song in its vocal-separation stage (minutes on CPU), held the only worker and a Pro
upload sat behind it however high its priority.  So the Pro lane has a worker of its own
(``settings.pro_lane_workers``) that only ever takes high-priority jobs.  It idles while
there are none; when one arrives it starts at once, beside whatever the general workers
are doing.  Two jobs then share the CPU, which slows both a little — the Pro one is
never stopped dead, which is the promise the lane makes.

Nothing is lost to a restart.  With ``NF_JOB_DIR`` set the submit is journaled
(``app.jobs.journal``) before it is queued and ``recover()`` re-queues the journal after a
restart under the same job ids; a job that has already been started ``job_max_attempts``
times is failed with a plain message instead, and the API is told through the webhook.
"""

import heapq
import itertools
import logging
import shutil
import tempfile
import threading
import time
import urllib.parse
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import httpx

from app.config import settings
from app.jobs.journal import JobJournal
from app.jobs.progress import ProgressReporter
from app.pipeline.transcriber import LowConfidenceError, TranscriptionResult, transcribe

logger = logging.getLogger(__name__)

STATUS_PENDING = "pending"
STATUS_PROCESSING = "processing"
STATUS_DONE = "done"
STATUS_FAILED = "failed"

PRIORITY_HIGH = "high"
PRIORITY_NORMAL = "normal"
_PRIORITY_RANK = {PRIORITY_HIGH: 0, PRIORITY_NORMAL: 1}

STAGE_QUEUED = "queued"
STAGE_FETCHING = "fetching"
STAGE_SEPARATING = "separating"
STAGE_TRANSCRIBING = "transcribing"

_GENERIC_ERROR = "An unexpected error occurred during transcription. Please try recording again."
#: A journaled job the worker could not finish across its restarts, or whose audio is gone.
_LOST_ERROR = ("The transcription service had to restart while working on this and could not finish it. "
               "Nothing was charged — please submit it again.")


class QueueFull(Exception):
    """More jobs are waiting than ``settings.max_pending_jobs``; the route answers 503."""


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
    #: Which part of the job is running: ``queued`` while it waits for a worker, then
    #: ``fetching`` / ``separating`` / ``transcribing``; None once it has ended.
    stage: str | None = None
    #: Where the job sits in the heap while it waits, so its place in line can be counted.
    rank: int = 0
    seq: int = 0
    #: Where a failed job stopped (``links.STAGES``: resolve … decode for a link's way in, then
    #: separation, transcription) and why, as one word (``links.failure_code``): for the API's log and
    #: the console, never shown as they are.
    failure_stage: str | None = None
    failure_code: str | None = None
    #: Title/artist of a linked song, known as soon as the link resolves — before the
    #: result exists — so a client can show what is being transcribed while it waits.
    source: dict | None = None
    #: When the completion webhook was answered 2xx: the API has banked the result by then,
    #: so this job's audio fields are the first to go when results outgrow their budget.
    delivered_at: float | None = None
    #: Told whenever a field a watching client sees changes (``_REPORTED``): the queue's
    #: progress reporter, which posts it on to the API. Set once the job is built.
    on_change: Callable[["Job"], None] | None = field(default=None, repr=False, compare=False)

    def __setattr__(self, name, value) -> None:
        object.__setattr__(self, name, value)
        if name in _REPORTED:
            hook = self.__dict__.get("on_change")
            if hook is not None:
                hook(self)


#: The fields of a job that a client watching it is shown while it runs.
_REPORTED = frozenset({"status", "stage", "progress", "source"})


#: Rank of the shutdown sentinel: below every real job, so a draining worker of either
#: lane picks it up ahead of anything still queued.
_RANK_STOP = -1

#: Seconds before each delivery attempt of the completion webhook: at once, then after
#: five and twenty seconds, which covers the API's own restart in a deploy.
_WEBHOOK_DELAYS = (0.0, 5.0, 20.0)

#: A delivered result keeps its audio at least this long whatever the budget says: the
#: client that was pushed "done" fetches it within seconds.
_RESULT_AUDIO_GRACE_SECONDS = 120.0
#: The result fields that hold audio as base64: the bulk of a finished job's memory.
_AUDIO_FIELDS = ("audio_preview_base64", "backing_audio_base64")


def _webhook_headers() -> dict:
    """The key the API sends this service, so the API can tell a webhook came from here."""
    return {"X-Api-Key": settings.api_key} if settings.api_key else {}


def _progress_url(job: "Job") -> str | None:
    """Where a job's progress goes: beside its completion webhook, on an allowed host only."""
    if not job.callback_url or not _callback_allowed(job.callback_url):
        return None
    return job.callback_url.rstrip("/") + "/progress"


def _callback_allowed(url: str) -> bool:
    """Only http(s) to a host in ``settings.callback_hosts``: the URL comes in on the submit,
    and the worker must not be made to POST results (or its API key) anywhere else."""
    try:
        parsed = urllib.parse.urlsplit(url)
        host = (parsed.hostname or "").lower()
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and host in settings.callback_hosts


class JobQueue:
    def __init__(self, workers: int = settings.inference_workers,
                 pro_lane_workers: int = settings.pro_lane_workers,
                 job_dir: str | None = None) -> None:
        self._jobs: dict[str, Job] = {}
        # The journal every submit is written to, or None (tests, the module-level fallback
        # queue): jobs then live in memory only. Only ``recover()`` reads it back.
        self._journal = JobJournal(job_dir) if job_dir else None
        self._lock = threading.Lock()
        # (rank, seq, fn) heap guarded by a condition: a worker waits until an entry it
        # may take is at the top. A high job always sorts above a normal one, so "is the
        # top entry high?" is the whole of the Pro-lane worker's test.
        self._pending: list[tuple[int, int, object]] = []
        self._cv = threading.Condition()
        self._seq = itertools.count()
        # Live progress for the API (app.jobs.progress); NF_PROGRESS_PUSH=0 turns it off.
        self._progress = ProgressReporter(self._progress_body, _progress_url, _webhook_headers)
        self._threads = [
            threading.Thread(target=self._worker, args=(False,), name=f"nf-inference-{i}", daemon=True)
            for i in range(max(1, workers))
        ] + [
            threading.Thread(target=self._worker, args=(True,), name=f"nf-pro-lane-{i}", daemon=True)
            for i in range(max(0, pro_lane_workers))
        ]
        for t in self._threads:
            t.start()

    # ── Submission ────────────────────────────────────────────────────────────

    def submit(self, audio_path: Path, mode: str,
               key: str | None, tempo: int | None,
               time_signature: str | None = None,
               correlation_id: str | None = None,
               callback_url: str | None = None,
               priority: str = PRIORITY_NORMAL,
               song_seconds: float | None = None,
               separate: bool = False,
               audio_preview: bool = True,
               harmony: bool = False,
               keyboard_transpose: int = 0,
               no_voice_as_chords: bool = False) -> str:
        job = self._new_job(correlation_id, callback_url, priority)
        if self._journal is not None:
            audio_path = self._journal.keep(job.id, audio_path)
        self._journal_write(job, kind="upload", audio=str(audio_path), mode=mode, key=key, tempo=tempo,
                            time_signature=time_signature, song_seconds=song_seconds, separate=separate,
                            audio_preview=audio_preview, harmony=harmony, keyboard_transpose=keyboard_transpose,
                            no_voice_as_chords=no_voice_as_chords)
        logger.info("Job %s queued: mode=%s key=%s tempo=%s meter=%s priority=%s separate=%s harmony=%s transpose=%d%s%s",
                    job.id[:8], mode, key or "auto", tempo or "auto", time_signature or "auto",
                    job.priority, separate, harmony, keyboard_transpose,
                    " no-voice-as-chords" if no_voice_as_chords else "", self._trail(job))
        self._enqueue(job, lambda: self._run(job, audio_path, mode, key, tempo, time_signature, song_seconds, separate,
                                             audio_preview, harmony, keyboard_transpose, no_voice_as_chords))
        return job.id

    def submit_link(self, url: str, mode: str,
                    key: str | None, tempo: int | None,
                    time_signature: str | None = None,
                    correlation_id: str | None = None,
                    callback_url: str | None = None,
                    priority: str = PRIORITY_NORMAL,
                    max_seconds: float | None = None,
                    audio_preview: bool = True,
                    harmony: bool = False,
                    keyboard_transpose: int = 0,
                    start_seconds: float = 0.0,
                    end_seconds: float | None = None) -> str:
        job = self._new_job(correlation_id, callback_url, priority)
        cap = float(max_seconds or settings.link_max_seconds)
        self._journal_write(job, kind="link", url=url, mode=mode, key=key, tempo=tempo, time_signature=time_signature,
                            max_seconds=cap, audio_preview=audio_preview, harmony=harmony,
                            keyboard_transpose=keyboard_transpose, start_seconds=start_seconds, end_seconds=end_seconds)
        logger.info("Link job %s queued: mode=%s cap=%.0fs section=%.0f-%s priority=%s harmony=%s%s",
                    job.id[:8], mode, cap, start_seconds, "end" if end_seconds is None else f"{end_seconds:.0f}",
                    job.priority, harmony, self._trail(job))
        self._enqueue(job, lambda: self._run_link(job, url, mode, key, tempo, time_signature, cap, audio_preview, harmony,
                                                  keyboard_transpose, start_seconds, end_seconds))
        return job.id

    def submit_score(self, score_path: Path,
                     key: str | None = None, tempo: int | None = None,
                     time_signature: str | None = None,
                     correlation_id: str | None = None,
                     callback_url: str | None = None,
                     priority: str = PRIORITY_NORMAL) -> str:
        job = self._new_job(correlation_id, callback_url, priority)
        if self._journal is not None:
            score_path = self._journal.keep(job.id, score_path)
        self._journal_write(job, kind="score", score=str(score_path), key=key, tempo=tempo, time_signature=time_signature)
        logger.info("Score job %s queued: key=%s tempo=%s meter=%s%s",
                    job.id[:8], key or "auto", tempo or "auto", time_signature or "auto", self._trail(job))
        self._enqueue(job, lambda: self._run_score(job, score_path, key, tempo, time_signature))
        return job.id

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            self._purge_expired()
            return self._jobs.get(job_id)

    # ── Internals ─────────────────────────────────────────────────────────────

    def is_full(self) -> bool:
        """Whether ``settings.max_pending_jobs`` jobs are already waiting for a worker."""
        with self._lock:
            return self._pending_count() >= settings.max_pending_jobs

    def _pending_count(self) -> int:
        return sum(1 for j in self._jobs.values() if j.status == STATUS_PENDING)

    def _new_job(self, correlation_id: str | None, callback_url: str | None, priority: str,
                 job_id: str | None = None, recovered: bool = False) -> Job:
        """A new pending job; raises ``QueueFull`` when the line is full, except for a job the
        journal hands back after a restart, which was accepted once already."""
        job_id = job_id or uuid.uuid4().hex
        if callback_url:
            callback_url = callback_url.replace("{job_id}", job_id)
        if priority not in _PRIORITY_RANK:
            priority = PRIORITY_NORMAL
        job = Job(id=job_id, correlation_id=correlation_id, callback_url=callback_url, priority=priority)
        if settings.progress_push and callback_url:
            job.on_change = self._progress.mark
        with self._lock:
            self._purge_expired()
            if not recovered and self._pending_count() >= settings.max_pending_jobs:
                raise QueueFull()
            self._jobs[job.id] = job
        return job

    def _enqueue(self, job: Job, fn) -> None:
        job.stage = STAGE_QUEUED
        job.rank, job.seq = self._push(_PRIORITY_RANK[job.priority], fn)
        self._line_moved()

    # ── The journal ───────────────────────────────────────────────────────────

    def _journal_write(self, job: Job, **spec) -> None:
        if self._journal is not None:
            self._journal.write(job.id, {"id": job.id, "created": time.time(), "attempts": 0, "priority": job.priority,
                                         "correlation_id": job.correlation_id, "callback_url": job.callback_url, **spec})

    def _journal_started(self, job: Job) -> None:
        if self._journal is not None:
            self._journal.started(job.id)

    def _journal_delete(self, job: Job) -> None:
        if self._journal is not None:
            self._journal.delete(job.id)

    def recover(self) -> int:
        """Re-queue the jobs the journal holds from before a restart, under their own ids;
        the number re-queued.  A job started ``settings.job_max_attempts`` times already, or
        whose audio is gone, is failed with a plain message instead, and the API is told.
        Called once, from the application's startup — never from a second queue."""
        if self._journal is None:
            return 0
        requeued = failed = 0
        entries = self._journal.entries()
        # Audio whose entry never got written (a crash between the two), and half-written entries.
        self._journal.sweep({str(r["id"]) for r in entries})
        for record in entries:
            job = self._new_job(record.get("correlation_id"), record.get("callback_url"),
                                record.get("priority") or PRIORITY_NORMAL, job_id=str(record["id"]), recovered=True)
            attempts = int(record.get("attempts") or 0)
            fn = self._replay(job, record)
            if fn is None or attempts >= settings.job_max_attempts:
                reason = f"started {attempts} times without finishing" if fn is not None else "its audio is gone"
                logger.warning("Job %s from the journal failed: %s%s", job.id[:8], reason, self._trail(job))
                job.status, job.error, job.stage = STATUS_FAILED, _LOST_ERROR, None
                job.finished_at = time.monotonic()
                self._journal.delete(job.id)
                self._trigger_webhook(job)
                failed += 1
                continue
            logger.info("Job %s from the journal re-queued (%s, started %d times before)%s",
                        job.id[:8], record.get("kind"), attempts, self._trail(job))
            self._enqueue(job, fn)
            requeued += 1
        if requeued or failed:
            logger.info("Journal: %d jobs re-queued, %d failed", requeued, failed)
        return requeued

    def _replay(self, job: Job, record: dict):
        """The job's body from its journal entry, or None when the entry cannot be run."""
        kind = record.get("kind")
        if kind == "link":
            return lambda: self._run_link(
                job, str(record.get("url") or ""), record.get("mode") or "melody", record.get("key"), record.get("tempo"),
                record.get("time_signature") or None, float(record.get("max_seconds") or settings.link_max_seconds),
                bool(record.get("audio_preview", True)), bool(record.get("harmony", False)),
                int(record.get("keyboard_transpose") or 0), float(record.get("start_seconds") or 0.0),
                record.get("end_seconds"))
        if kind == "upload":
            audio = Path(str(record.get("audio") or ""))
            if not audio.is_file():
                return None
            return lambda: self._run(
                job, audio, record.get("mode") or "melody", record.get("key"), record.get("tempo"),
                record.get("time_signature") or None, record.get("song_seconds"), bool(record.get("separate", False)),
                bool(record.get("audio_preview", True)), bool(record.get("harmony", False)),
                int(record.get("keyboard_transpose") or 0), bool(record.get("no_voice_as_chords", False)))
        if kind == "score":
            score = Path(str(record.get("score") or ""))
            if not score.is_file():
                return None
            return lambda: self._run_score(job, score, record.get("key"), record.get("tempo"), record.get("time_signature"))
        return None

    def _push(self, rank: int, fn) -> tuple[int, int]:
        with self._cv:
            seq = next(self._seq)
            heapq.heappush(self._pending, (rank, seq, fn))
            self._cv.notify_all()
            return rank, seq

    def queue_position(self, job_id: str) -> int | None:
        """How many jobs run before this one; None once it has started or ended.

        Counted from the heap, so a Pro job that jumped the line is reflected at once.
        """
        with self._cv:
            job = self._jobs.get(job_id)
            if job is None or job.status != STATUS_PENDING:
                return None
            return sum(1 for rank, seq, _fn in self._pending if (rank, seq) < (job.rank, job.seq))

    def _take(self, pro_lane: bool):
        """Block until there is an entry this worker may run, and pop it.

        A general worker takes whatever is on top. The Pro-lane worker takes the top
        entry only when it is a high-priority job (or the stop sentinel), and otherwise
        keeps waiting — a normal job is never its business, however long it has queued.
        """
        with self._cv:
            while True:
                if self._pending:
                    rank = self._pending[0][0]
                    if not pro_lane or rank <= _PRIORITY_RANK[PRIORITY_HIGH]:
                        taken = heapq.heappop(self._pending)
                        self._line_moved()
                        return taken
                self._cv.wait()

    def _line_moved(self) -> None:
        """Everyone still waiting has a new place in line (one left it, or one jumped it)."""
        for job in list(self._jobs.values()):
            if job.status == STATUS_PENDING and job.on_change is not None:
                job.on_change(job)

    def _progress_body(self, job: Job) -> dict | None:
        """What a client watching the job is shown while it runs; None once it has ended."""
        if job.status not in (STATUS_PENDING, STATUS_PROCESSING):
            return None
        from app.api.schemas import JobResponse

        return JobResponse(status=job.status, progress=job.progress, stage=job.stage,
                           queue_position=self.queue_position(job.id),
                           source=job.source).model_dump(by_alias=True, exclude_none=True)

    def _worker(self, pro_lane: bool = False) -> None:
        while True:
            _rank, _seq, fn = self._take(pro_lane)
            if fn is None:
                return
            try:
                fn()
            except Exception:  # noqa: BLE001 - a job body already reports; never kill the worker
                logger.exception("Unhandled error in queue worker")

    def _run(self, job: Job, audio_path: Path, mode: str,
             key: str | None, tempo: int | None,
             time_signature: str | None = None, song_seconds: float | None = None,
             separate_vocals: bool = False, audio_preview: bool = True,
             harmony: bool = False, keyboard_transpose: int = 0, no_voice_as_chords: bool = False) -> None:
        # The attempt is on disk before the job is seen as processing, so anyone who sees it running
        # (a poll, a test) also sees the attempt counted.
        self._journal_started(job)
        job.status = STATUS_PROCESSING
        job.stage = STAGE_TRANSCRIBING  # listening for a band is part of the work, not the wait
        work_dir: Path | None = None
        try:
            try:
                # Not asked to isolate, but a band can be heard: a song uploaded as a
                # tune is isolated all the same (the account is not charged a song for it).
                heard_band = not separate_vocals and _sounds_like_a_song(job, audio_path, mode)
                if separate_vocals or heard_band:
                    # A song with a band behind the voice, uploaded as a file: the same
                    # road a linked song takes — isolate the vocal, read the beat from the
                    # mix, keep the instrumental for rehearsal.
                    work_dir = Path(tempfile.mkdtemp(prefix="nf-upload-"))
                    job.result = self._separate_and_transcribe(
                        job, audio_path, work_dir, mode, key, tempo, time_signature, progress_from=0.0,
                        audio_preview=audio_preview, harmony=harmony, keyboard_transpose=keyboard_transpose,
                        no_voice_as_chords=no_voice_as_chords)
                else:
                    job.stage = STAGE_TRANSCRIBING
                    job.result = transcribe(
                        audio_path, mode=mode, key_override=key, tempo_override=tempo,
                        time_signature=time_signature,
                        progress=lambda fraction: setattr(job, "progress", fraction),
                        fast=job.priority == PRIORITY_HIGH,
                        audio_preview=audio_preview, harmony=harmony, keyboard_transpose=keyboard_transpose)
                if song_seconds is not None:
                    # The route kept only the head of a longer clip (a preview).
                    job.result.song_duration_sec = round(song_seconds, 1)
                    job.result.truncated = True
                _offer_hymn(job, "chords" if job.result.read_as_chords else mode)
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
            if work_dir is not None:
                shutil.rmtree(work_dir, ignore_errors=True)
            self._journal_delete(job)
            self._trigger_webhook(job)

    def _separate_and_transcribe(self, job: Job, wav: Path, work_dir: Path, mode: str,
                                 key: str | None, tempo: int | None, time_signature: str | None,
                                 progress_from: float, audio_preview: bool = True,
                                 harmony: bool = False, keyboard_transpose: int = 0,
                                 song_start: bool = True, no_voice_as_chords: bool = False) -> TranscriptionResult:
        """Isolate the vocal, transcribe it with the beat read from the mix, keep the backing.

        Shared by uploaded songs and linked ones. ``progress_from`` is where the job's
        progress bar already stands (a link job has spent some of it fetching); separation
        takes the bar to 0.55 and transcription the rest. Without a separation model the
        mixture is transcribed as it is, which is what the old upload path always did.
        So is a vocal stem with no voice in it (``separate.voice_share_db``): instruments
        recorded on their own, whether the queue heard them as a band or the user called
        them "a song with instruments" — their tune is in the mixture, and the empty stem
        used to come back as one or two notes. The mixture is then read on the normal lane,
        whose Basic Pitch melody floor keeps the tune above the chords. In melody mode the
        chords are read from the instrumental, or from the mix when there is no instrumental.

        ``no_voice_as_chords`` (a Listen from anywhere take, caught with no idea what it is): when
        the take holds no voice, the mixture is read in chords mode instead (chords per beat, the
        top line as the tune), since a melody read of strummed or comped chords is only the
        highest note of each chord. ``result.read_as_chords`` then says so.

        Polyphonic and chords mode want the instruments, so they are read from the mixture and the
        vocals are never isolated: the vocal stem kept only the singer, so a saxophone or a piano
        went out with the backing, and a section the singer was silent in came back with notes
        only where the voice was.
        """
        from app.pipeline import separate

        span = 0.55 - progress_from
        # What the mixture is read as when the vocal stem is not used: the job's own mode, or chords
        # for a melody take that asked for it (see ``no_voice_as_chords`` above).
        mixture_mode = "chords" if no_voice_as_chords and mode == "melody" else mode
        if mode in _MIXTURE_MODES:
            vocals, separated = wav, False
        elif separate.available():
            job.stage = STAGE_SEPARATING
            try:
                vocals = separate.separate_file(
                    wav, work_dir / "vocals.wav",
                    progress=lambda f: setattr(job, "progress", progress_from + span * f),
                    backing_path=work_dir / "backing.wav")
                separated = True
                share = separate.voice_share_db(vocals, work_dir / "backing.wav")
                if share < separate.VOICE_MIN_SHARE_DB:
                    logger.info("Job %s: no voice in the vocal stem (%.0f dB); transcribing the mixture%s",
                                job.id[:8], share, " as chords" if mixture_mode != mode else "")
                    vocals, separated = wav, False
            except (MemoryError, separate.SeparationFailed) as ex:
                # Better a sheet read from the mixture than no sheet: the worker stays up
                # and the job finishes, with ``separated`` false so the client can say so.
                logger.warning("Job %s: %s; transcribing the mixture", job.id[:8],
                               "out of memory separating vocals" if isinstance(ex, MemoryError) else ex)
                vocals, separated = wav, False
        else:
            logger.warning("Job %s: no separation model at %s; transcribing the mixture",
                           job.id[:8], separate.model_path())
            vocals, separated = wav, False

        job.stage = STAGE_TRANSCRIBING
        backing = work_dir / "backing.wav"

        def read(path: Path, stem: bool) -> TranscriptionResult:
            read_mode = mode if stem else mixture_mode
            chord_source = None
            if read_mode == "melody":
                chord_source = backing if stem and backing.is_file() else wav
            result = transcribe(
                path, mode=read_mode, key_override=key, tempo_override=tempo,
                time_signature=time_signature,
                progress=lambda fraction: setattr(job, "progress", 0.55 + 0.45 * fraction),
                # The fast lane drops the mixture guard, which a mixture with a band in it needs.
                fast=job.priority == PRIORITY_HIGH and stem,
                tempo_source=wav if stem else None,
                audio_preview=audio_preview, harmony=harmony,
                keyboard_transpose=keyboard_transpose, chord_source=chord_source, song_start=song_start)
            result.read_as_chords = read_mode == "chords" and mode != "chords"
            return result

        if not separated:
            result = read(wav, False)
        else:
            # A stem can pass the voice check on a burst the model took for a voice (a
            # strummed chord) and still hold no tune: one or two notes, which is the sheet
            # an instrument recording used to get. Then the mixture is read as well, and the
            # sheet with more notes kept.
            try:
                result = read(vocals, True)
            except LowConfidenceError:
                result = None
            if result is None or len(result.notes) < _stem_min_notes(wav):
                found = 0 if result is None else len(result.notes)
                logger.info("Job %s: %d notes from the vocal stem; reading the mixture as well", job.id[:8], found)
                try:
                    mixture = read(wav, False)
                except LowConfidenceError:
                    if result is None:
                        raise
                    mixture = None
                if mixture is not None and (result is None or len(mixture.notes) > found):
                    result, separated = mixture, False
        result.separated = separated
        if separated:
            result.backing_audio_base64 = _encode_backing(backing)
        if not result.backing_audio_base64:
            # The beat map is for playing the sheet over the backing (``_beat_map``); a sheet
            # read from the mixture, or a backing ffmpeg could not encode, has none to play.
            result.beat_times_sec = None
        return result

    def _run_link(self, job: Job, url: str, mode: str,
                  key: str | None, tempo: int | None,
                  time_signature: str | None, max_seconds: float, audio_preview: bool = True,
                  harmony: bool = False, keyboard_transpose: int = 0,
                  start_seconds: float = 0.0, end_seconds: float | None = None) -> None:
        from app.ingest.links import PREVIEW_NOTICE, LinkError, fetch_audio, resolve_source

        self._journal_started(job)
        job.status = STATUS_PROCESSING
        work_dir: Path | None = None
        try:
            try:
                job.stage = STAGE_FETCHING
                job.progress = 0.02
                source = resolve_source(url)
                job.source = _source_dict(source)
                fetched = fetch_audio(source, max_seconds, start_seconds=start_seconds, end_seconds=end_seconds)
                wav, song_seconds = fetched.path, fetched.song_seconds
                work_dir = wav.parent
                # The section that was kept, and the whole song's length now that it is known.
                job.source = {**job.source, "duration_seconds": song_seconds or job.source.get("duration_seconds"),
                              "start_seconds": fetched.start_seconds, "end_seconds": fetched.end_seconds}
                if fetched.preview:
                    # YouTube refused the song; the store's 30-second preview stood in.
                    job.source = {**job.source, "preview": True, "notice": PREVIEW_NOTICE}
                job.progress = 0.10

                job.result = self._separate_and_transcribe(
                    job, wav, work_dir, mode, key, tempo, time_signature, progress_from=0.10,
                    audio_preview=audio_preview, harmony=harmony, keyboard_transpose=keyboard_transpose,
                    # A section from inside the song, or the store's preview, starts mid-bar.
                    song_start=not fetched.preview and not fetched.start_seconds)
                job.result.source = job.source
                job.result.song_duration_sec = round(song_seconds, 1)
                job.result.truncated = fetched.truncated
                _offer_hymn(job, mode)
            finally:
                # The fetched audio goes before the job reports done, not after: a client that
                # sees "done" and looks must find nothing of the song left on disk.
                if work_dir is not None:
                    shutil.rmtree(work_dir, ignore_errors=True)
                job.finished_at = time.monotonic()
            self._done(job, "Link job")
        except (LowConfidenceError, LinkError) as ex:
            self._failed(job, str(ex), "Link job", ex)
        except Exception as ex:  # noqa: BLE001
            self._crashed(job, "Link job", ex)
        finally:
            if work_dir is not None:
                shutil.rmtree(work_dir, ignore_errors=True)
            self._journal_delete(job)
            self._trigger_webhook(job)

    def _run_score(self, job: Job, score_path: Path,
                   key: str | None, tempo: int | None,
                   time_signature: str | None) -> None:
        self._journal_started(job)
        job.status = STATUS_PROCESSING
        job.stage = STAGE_TRANSCRIBING
        work: Path | None = None
        try:
            try:
                from app.pipeline.score_transcriber import transcribe_score
                from app.pipeline.sheet_reader import PAGE_WORDS, READ_CONFIDENCE, SHEET_SUFFIXES, read_sheet
                score = score_path
                if score_path.suffix.lower() in SHEET_SUFFIXES:
                    # A photo or PDF of printed music: its tune is read into a score first.
                    work = Path(tempfile.mkdtemp(prefix="nf_sheet_"))
                    score = read_sheet(score_path, work)
                job.result = transcribe_score(
                    score, key_override=key, tempo_override=tempo,
                    time_signature_override=time_signature,
                )
                if work is not None:
                    job.result.overall_confidence = READ_CONFIDENCE
                    # A photographed hymn page is offered its hymnbook version, as a sung one is: homr writes no
                    # ties and misreads lengths on old scans, which the published score has right. The words
                    # printed on it name which hymn sung to that tune it is.
                    words = work / PAGE_WORDS
                    _offer_hymn(job, "melody", words.read_text(encoding="utf-8") if words.exists() else "")
            finally:
                score_path.unlink(missing_ok=True)
                if work is not None:
                    shutil.rmtree(work, ignore_errors=True)
                job.finished_at = time.monotonic()
            self._done(job, "Score job")
        except LowConfidenceError as ex:
            self._failed(job, str(ex), "Score job", ex)
        except Exception as ex:  # noqa: BLE001
            self._note_failure(job, ex)
            job.status = STATUS_FAILED
            job.error = "An unexpected error occurred during score transcription. Please try uploading again."
            logger.exception("Score job %s EXCEPTION: %s%s",
                             job.id[:8], type(ex).__name__, self._trail(job))
        finally:
            score_path.unlink(missing_ok=True)
            self._journal_delete(job)
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
        self._note_failure(job, ex)
        job.status = STATUS_FAILED
        job.error = message
        job.stage = None
        # Expected outcome, not a defect: the clip was too noisy, or the link unusable.
        logger.warning("%s %s FAILED: %s%s", label, job.id[:8], ex, self._trail(job))

    @staticmethod
    def _note_failure(job: Job, ex: Exception) -> None:
        """Where the job stopped and why (``Job.failure_stage``/``failure_code``), read before ``stage`` is cleared:
        a link's refusal names its own step; otherwise the part that was running."""
        from app.ingest.links import LinkError, failure_code

        if isinstance(ex, LinkError):
            job.failure_stage = ex.stage or "download"
            job.failure_code = failure_code(ex)
            return
        job.failure_stage = {STAGE_FETCHING: "download", STAGE_SEPARATING: "separation"}.get(job.stage, "transcription")
        job.failure_code = "low_confidence" if isinstance(ex, LowConfidenceError) else "internal"

    def _crashed(self, job: Job, label: str, ex: Exception) -> None:
        self._note_failure(job, ex)
        job.status = STATUS_FAILED
        job.error = _GENERIC_ERROR
        job.stage = None
        # exception(), so the traceback reaches the log drain: this is the line that
        # used to say only the exception type, leaving nothing to debug from.
        logger.exception("%s %s EXCEPTION: %s%s", label, job.id[:8], type(ex).__name__, self._trail(job))

    def _trigger_webhook(self, job: Job) -> None:
        if not job.callback_url:
            return
        if not _callback_allowed(job.callback_url):
            logger.warning("Webhook for job %s not sent: callback host is not in NF_CALLBACK_HOSTS%s",
                           job.id[:8], self._trail(job))
            return

        from dataclasses import asdict

        from app.api.schemas import JobResponse, ResultDto

        result_payload = None
        if job.result is not None:
            p = asdict(job.result)
            p["notes"] = p.pop("notes")  # match get_job behavior if any
            result_payload = ResultDto.model_validate(p)

        jr = JobResponse(status=job.status, progress=job.progress, stage=job.stage,
                         source=job.source, result=result_payload, error=job.error,
                         failure_stage=job.failure_stage, failure_code=job.failure_code)

        payload = jr.model_dump(by_alias=True, exclude_none=True)
        headers = _webhook_headers()

        def fire():
            # An API that is restarting (a deploy swaps it after the worker) is tried again
            # twice; one that answered 4xx has made up its mind and is not.
            for attempt, delay in enumerate(_WEBHOOK_DELAYS, 1):
                if delay:
                    time.sleep(delay)
                try:
                    with httpx.Client(timeout=10.0) as client:
                        resp = client.post(job.callback_url, json=payload, headers=headers)
                        resp.raise_for_status()
                    job.delivered_at = time.monotonic()
                    logger.info("Webhook for job %s delivered to %s", job.id[:8], job.callback_url)
                    return
                except Exception as e:  # noqa: BLE001 - delivery is best effort; the API's sweep is the net
                    answered = isinstance(e, httpx.HTTPStatusError) and e.response.status_code < 500
                    if answered or attempt == len(_WEBHOOK_DELAYS):
                        logger.warning("Failed to deliver webhook for job %s to %s: %s", job.id[:8], job.callback_url, e)
                        return
                    logger.info("Webhook for job %s not delivered (%s); trying again in %.0fs",
                                job.id[:8], e, _WEBHOOK_DELAYS[attempt])

        # Fire in a separate thread so we don't block the executor pool if the webhook is slow
        threading.Thread(target=fire, name=f"webhook-{job.id[:8]}", daemon=True).start()

    @staticmethod
    def _trail(job: Job) -> str:
        """The API's correlation id as a log suffix, or nothing when there is none."""
        return f" correlationId={job.correlation_id}" if job.correlation_id else ""

    def shutdown(self, wait: bool = True, timeout: float | None = None) -> None:
        """Drain the workers and drop all job state."""
        for _ in self._threads:
            self._push(_RANK_STOP, None)
        if wait:
            for t in self._threads:
                t.join(timeout)

    def _purge_expired(self) -> None:
        now = time.monotonic()
        expired = [jid for jid, j in self._jobs.items()
                   if j.finished_at and now - j.finished_at > settings.job_ttl_seconds]
        for jid in expired:
            del self._jobs[jid]
        self._shed_result_audio(now)

    def _shed_result_audio(self, now: float) -> None:
        """Keep the audio held by finished results within ``settings.result_audio_budget_mb``.

        Over budget, the oldest results whose webhook the API answered (it banks the result
        then) more than ``_RESULT_AUDIO_GRACE_SECONDS`` ago lose their audio fields, one at a
        time until the rest fit; their notes, scores and key stay until the TTL. A result the
        API has not banked — a website preview, a webhook that failed — is never touched, so a
        poll can still fetch everything. The API never banked the audio anyway
        (``TranscriptionResultCache`` drops both fields), and clients synthesise their own
        playback from the notes.
        """
        held = [j for j in self._jobs.values() if j.result is not None]
        total = sum(len(getattr(j.result, f, "") or "") for j in held for f in _AUDIO_FIELDS)
        budget = settings.result_audio_budget_mb * 1024 * 1024
        if total <= budget:
            return
        sheddable = sorted((j for j in held if j.delivered_at is not None
                            and now - j.delivered_at > _RESULT_AUDIO_GRACE_SECONDS),
                           key=lambda j: j.delivered_at)
        for job in sheddable:
            for f in _AUDIO_FIELDS:
                value = getattr(job.result, f, "") or ""
                if value:
                    total -= len(value)
                    setattr(job.result, f, "")
            logger.info("Job %s: audio dropped from its delivered result to keep memory in budget", job.id[:8])
            if total <= budget:
                return


# Fewer notes than this from a vocal stem is no tune: at least four, and one per three seconds of
# the clip (a sung line runs at one to three a second). Measured on instruments recorded alone
# as a browser sends them: a strummed guitar's stem passed the voice check on a two-second
# burst and gave one note, where the mixture gives 14 of 16. An orchestra caught from a video
# (a Listen from anywhere take) passes it too: MDX takes a flute or the strings for a voice, and
# the stem gave 9 and 11 notes in a minute (0.15-0.18 a second), the rest gated away as bleed,
# where the mixture reads hundreds. The sparsest stem a real voice left across the whole song
# bench (127 songs) gave 0.70 notes a second, so one per three seconds (0.33) parts them with
# room on both sides; under it the mixture is read as well and the fuller sheet kept.
_STEM_MIN_NOTES = 4
_STEM_SECONDS_PER_NOTE = 3.0


def _offer_hymn(job: Job, mode: str, page_words: str = "") -> None:
    """Attach ``hymn_match`` when a melody's tune clearly matches a hymn we hold.

    Once, at the end of a melody (or song) transcription, or of a photo or PDF of printed music: a choir's parts, chords mode and an
    arrangement written under the tune are read against their own beats, which the hymnbook
    version would not keep, so they are never offered one. Recognition is an extra on top of the
    sheet: any failure leaves the result as it was.
    """
    if mode != "melody" or job.result is None or job.result.parts or not settings.hymn_match:
        return
    from app.pipeline import hymn_match

    try:
        found = hymn_match.offer(job.result, page_words=page_words)
    except Exception as ex:  # noqa: BLE001 - the offer is optional; the sheet is not
        logger.warning("Job %s: hymn matching skipped: %r", job.id[:8], ex)
        return
    job.result.hymn_match = found
    if found:
        # One line per offer, for counting how often it fires; the hymn is public, the take is not named.
        logger.info("hymn_match job=%s hymn=%s kind=%s confidence=%.3f chosen=%s",
                    job.id[:8], found["slug"], found["kind"], found["confidence"], found.get("chosen") or "-")


#: Modes that transcribe every instrument, so a song in them is read whole, never its vocal stem.
_MIXTURE_MODES = ("poly", "chords")


def _stem_min_notes(wav: Path) -> int:
    import soundfile as sf

    try:
        seconds = float(sf.info(str(wav)).duration)
    except Exception:  # noqa: BLE001 - our own WAV; the floor still holds
        seconds = 0.0
    return max(_STEM_MIN_NOTES, int(seconds / _STEM_SECONDS_PER_NOTE))


def _sounds_like_a_song(job: Job, audio_path: Path, mode: str) -> bool:
    """A melody upload with a band behind the voice (``separate.has_accompaniment``)."""
    from app.pipeline import separate

    if mode != "melody" or not separate.available():
        return False
    try:
        peaks = separate.accompaniment(audio_path)
    except Exception as exc:  # noqa: BLE001 - an unreadable clip fails in transcribe(), with its own message
        logger.warning("Job %s: accompaniment check failed (%s); not isolating", job.id[:8], exc)
        return False
    band = peaks >= separate.ACCOMPANIMENT_MIN_PEAKS
    logger.info("Job %s: accompaniment check %.1f tonal peaks per frame -> %s", job.id[:8], peaks,
                "band heard, isolating the vocal" if band else "solo, no isolation")
    return band


# The instrumental is sent to the client as a mono MP3 at this bit rate: a six-minute song
# is about 2 MB, against 24 MB as the 16-bit WAV. Rehearsal playback does not need more.
_BACKING_BITRATE = "48k"


def _encode_backing(wav_path: Path) -> str:
    """The instrumental WAV as a base64 mono MP3, or "" when ffmpeg is not available.

    An empty string is a feature quietly missing rather than a failed job: the sheet and
    the piano playback are still there, and a client that sees no backing simply does not
    offer to play over the song.

    Written to a file, not a pipe: ffmpeg writes the MP3's Xing/LAME header, which says how
    many samples of encoder delay lead the audio (1105, 50 ms at 22.05 kHz) and pad its end,
    only when it can seek back to the start.  Piped, the header was missing, and every player
    started the instrumental 52 ms late against the notes it is played under; with it, a
    decoder that reads the header (ffmpeg does) cuts the delay and the clicks of a test track
    decode where they were (``tests/test_queue.py``).  One that ignores it is no worse off.
    """
    import base64
    import subprocess

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg or not wav_path.is_file():
        return ""
    mp3 = wav_path.with_name(wav_path.stem + "-backing.mp3")
    try:
        subprocess.run(
            [ffmpeg, "-v", "error", "-nostdin", "-y", "-i", str(wav_path), "-ac", "1", "-ar", "22050",
             "-codec:a", "libmp3lame", "-b:a", _BACKING_BITRATE, "-f", "mp3", str(mp3)],
            capture_output=True, timeout=120, check=True)
        data = mp3.read_bytes()
    except Exception as exc:  # noqa: BLE001 - the backing is a nicety; the sheet is the job
        logger.warning("Backing track not encoded: %s", exc)
        return ""
    finally:
        mp3.unlink(missing_ok=True)
    return base64.b64encode(data).decode("ascii")


def _source_dict(source) -> dict:
    return {
        "provider": source.provider,
        "url": source.url,
        "title": source.title,
        "artist": source.artist,
        "thumbnail_url": source.thumbnail_url,
        "duration_seconds": source.duration,
    }


def _default_queue() -> JobQueue:
    return JobQueue(workers=settings.inference_workers, pro_lane_workers=settings.pro_lane_workers)


job_queue = _default_queue()
