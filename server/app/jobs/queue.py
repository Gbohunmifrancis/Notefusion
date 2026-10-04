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
"""

import heapq
import itertools
import logging
import shutil
import tempfile
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

STAGE_QUEUED = "queued"
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
    #: Which part of the job is running: ``queued`` while it waits for a worker, then
    #: ``fetching`` / ``separating`` / ``transcribing``; None once it has ended.
    stage: str | None = None
    #: Where the job sits in the heap while it waits, so its place in line can be counted.
    rank: int = 0
    seq: int = 0
    #: Title/artist of a linked song, known as soon as the link resolves — before the
    #: result exists — so a client can show what is being transcribed while it waits.
    source: dict | None = None


#: Rank of the shutdown sentinel: below every real job, so a draining worker of either
#: lane picks it up ahead of anything still queued.
_RANK_STOP = -1


class JobQueue:
    def __init__(self, workers: int = settings.inference_workers,
                 pro_lane_workers: int = settings.pro_lane_workers) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        # (rank, seq, fn) heap guarded by a condition: a worker waits until an entry it
        # may take is at the top. A high job always sorts above a normal one, so "is the
        # top entry high?" is the whole of the Pro-lane worker's test.
        self._pending: list[tuple[int, int, object]] = []
        self._cv = threading.Condition()
        self._seq = itertools.count()
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
               time_signature: str = "4/4",
               correlation_id: str | None = None,
               callback_url: str | None = None,
               priority: str = PRIORITY_NORMAL,
               song_seconds: float | None = None,
               separate: bool = False,
               audio_preview: bool = True,
               harmony: bool = False,
               keyboard_transpose: int = 0) -> str:
        job = self._new_job(correlation_id, callback_url, priority)
        logger.info("Job %s queued: mode=%s key=%s tempo=%s meter=%s priority=%s separate=%s harmony=%s transpose=%d%s",
                    job.id[:8], mode, key or "auto", tempo or "auto", time_signature,
                    job.priority, separate, harmony, keyboard_transpose, self._trail(job))
        self._enqueue(job, lambda: self._run(job, audio_path, mode, key, tempo, time_signature, song_seconds, separate,
                                             audio_preview, harmony, keyboard_transpose))
        return job.id

    def submit_link(self, url: str, mode: str,
                    key: str | None, tempo: int | None,
                    time_signature: str = "4/4",
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
        job.stage = STAGE_QUEUED
        job.rank, job.seq = self._push(_PRIORITY_RANK[job.priority], fn)

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
                        return heapq.heappop(self._pending)
                self._cv.wait()

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
             time_signature: str = "4/4", song_seconds: float | None = None,
             separate_vocals: bool = False, audio_preview: bool = True,
             harmony: bool = False, keyboard_transpose: int = 0) -> None:
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
                        require_voice=heard_band)
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
            self._trigger_webhook(job)

    def _separate_and_transcribe(self, job: Job, wav: Path, work_dir: Path, mode: str,
                                 key: str | None, tempo: int | None, time_signature: str,
                                 progress_from: float, audio_preview: bool = True,
                                 harmony: bool = False, keyboard_transpose: int = 0,
                                 require_voice: bool = False) -> TranscriptionResult:
        """Isolate the vocal, transcribe it with the beat read from the mix, keep the backing.

        Shared by uploaded songs and linked ones. ``progress_from`` is where the job's
        progress bar already stands (a link job has spent some of it fetching); separation
        takes the bar to 0.55 and transcription the rest. Without a separation model the
        mixture is transcribed as it is, which is what the old upload path always did.
        ``require_voice`` does the same when the vocal stem comes back empty (the band the
        queue heard was playing on its own). In melody mode the chords are read from the
        instrumental, or from the mix when there is no instrumental.
        """
        from app.pipeline import separate

        span = 0.55 - progress_from
        if separate.available():
            job.stage = STAGE_SEPARATING
            try:
                vocals = separate.separate_file(
                    wav, work_dir / "vocals.wav",
                    progress=lambda f: setattr(job, "progress", progress_from + span * f),
                    backing_path=work_dir / "backing.wav")
                separated = True
                share = separate.voice_share_db(vocals, work_dir / "backing.wav") if require_voice else 0.0
                if share < separate.VOICE_MIN_SHARE_DB:
                    logger.info("Job %s: no voice in the vocal stem (%.0f dB); transcribing the mixture",
                                job.id[:8], share)
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
        chord_source = None
        if mode == "melody":
            chord_source = backing if separated and backing.is_file() else wav
        result = transcribe(
            vocals, mode=mode, key_override=key, tempo_override=tempo,
            time_signature=time_signature,
            progress=lambda fraction: setattr(job, "progress", 0.55 + 0.45 * fraction),
            fast=job.priority == PRIORITY_HIGH,
            tempo_source=wav if separated else None,
            audio_preview=audio_preview, harmony=harmony,
            keyboard_transpose=keyboard_transpose, chord_source=chord_source)
        result.separated = separated
        if separated:
            result.backing_audio_base64 = _encode_backing(backing)
        return result

    def _run_link(self, job: Job, url: str, mode: str,
                  key: str | None, tempo: int | None,
                  time_signature: str, max_seconds: float, audio_preview: bool = True,
                  harmony: bool = False, keyboard_transpose: int = 0,
                  start_seconds: float = 0.0, end_seconds: float | None = None) -> None:
        from app.ingest.links import PREVIEW_NOTICE, LinkError, fetch_audio, resolve_source

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
                    audio_preview=audio_preview, harmony=harmony, keyboard_transpose=keyboard_transpose)
                job.result.source = job.source
                job.result.song_duration_sec = round(song_seconds, 1)
                job.result.truncated = fetched.truncated
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
        job.stage = STAGE_TRANSCRIBING
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
    """
    import base64
    import subprocess

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg or not wav_path.is_file():
        return ""
    try:
        done = subprocess.run(
            [ffmpeg, "-v", "error", "-nostdin", "-i", str(wav_path), "-ac", "1", "-ar", "22050",
             "-codec:a", "libmp3lame", "-b:a", _BACKING_BITRATE, "-f", "mp3", "pipe:1"],
            capture_output=True, timeout=120, check=True)
    except Exception as exc:  # noqa: BLE001 - the backing is a nicety; the sheet is the job
        logger.warning("Backing track not encoded: %s", exc)
        return ""
    return base64.b64encode(done.stdout).decode("ascii")


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
