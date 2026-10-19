"""v1 endpoints (TRD par. 6):
    POST /v1/transcribe   multipart audio + options -> 202 { jobId }
    GET  /v1/jobs/{id}    -> { status, progress } | { status: done, result }
    POST /v1/identify     multipart audio (a hummed clip) -> { match | null, notesHeard, tooShort, secondsHeard }
"""

import logging
import math
import re
import tempfile
import threading
from dataclasses import asdict
from pathlib import Path

import librosa
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from starlette.concurrency import run_in_threadpool

from app.api.schemas import (
    GradeResponse, GradeTargetDto, HarmoniseRequest, HarmoniseResponse, IdentifiedHymnDto, IdentifyResponse, JobResponse,
    LinkInfoRequest, LinkInfoResponse, ResultDto, SubmitResponse,
)
from app.config import TEMP_PREFIX, settings
from app.pipeline.ffmpeg_input import INPUT_GUARD
from app.jobs.queue import JobQueue, QueueFull

router = APIRouter(prefix="/v1")
logger = logging.getLogger(__name__)

# What a phone or a browser produces, as well as what a desktop exports. ``.webm`` is what
# MediaRecorder gives in Chrome and Firefox, ``.mp4`` in Safari; both decode through ffmpeg.
ACCEPTED_SUFFIXES = {".wav", ".flac", ".ogg", ".opus", ".mp3", ".m4a", ".aac", ".webm", ".mp4", ".caf", ".weba"}

#: Long enough for a GUID or the C# API's own id, short enough that a caller cannot
#: pad the log file with one header.
_MAX_CORRELATION_ID = 64


def _correlation_id(request: Request) -> str | None:
    """The caller's ``X-Correlation-ID`` if it is safe to repeat, otherwise None.

    Mirrors CorrelationIdMiddleware.Sanitised on the C# side, including its choice to
    refuse rather than strip: this value is written into log lines, where an embedded
    newline forges a whole fabricated entry, and a silently edited id no longer matches
    the one the API recorded. Only the API is meant to send this, but the transcriber
    trusts nothing about who reached it.
    """
    candidate = (request.headers.get("x-correlation-id") or "").strip()
    if not candidate or len(candidate) > _MAX_CORRELATION_ID:
        return None
    if not all(c.isascii() and (c.isalnum() or c in "-_") for c in candidate):
        return None
    return candidate


def _refused_link(error: Exception) -> HTTPException:
    """The 422 for a link the worker will not use: its detail is the plain sentence, or — when
    the reason has a code the C# API has words of its own for — an object carrying both."""
    code = getattr(error, "code", None)
    if code is None:
        return HTTPException(422, str(error))
    detail: dict = {"message": str(error), "code": code}
    if getattr(error, "limit_seconds", None) is not None:
        detail["limit_seconds"] = error.limit_seconds
    return HTTPException(422, detail)


#: Seconds a caller turned away by a full queue is told to wait (``Retry-After``).
QUEUE_FULL_RETRY_SECONDS = 30
QUEUE_FULL_MESSAGE = "The transcription service is busy right now. Please try again in a minute."


def _queue_full() -> HTTPException:
    return HTTPException(503, QUEUE_FULL_MESSAGE, headers={"Retry-After": str(QUEUE_FULL_RETRY_SECONDS)})


def _refuse_when_full(queue: JobQueue) -> None:
    """Turn a submit away before its upload is read when the line is already full; the
    queue checks again when the job is added, which is the check that counts."""
    if queue.is_full():
        raise _queue_full()


def _get_queue(request: Request) -> JobQueue:
    """Prefer the lifespan-managed queue; fall back to module-level for tests."""
    return getattr(request.app.state, "queue", None) or _import_fallback_queue()


def _import_fallback_queue() -> JobQueue:
    from app.jobs.queue import job_queue
    return job_queue


def _clip_duration_seconds(path: Path) -> float:
    """Return audio duration; uses librosa, soundfile, or size estimation fallback."""
    try:
        return float(librosa.get_duration(path=str(path)))
    except Exception:
        pass

    try:
        import soundfile as sf
        info = sf.info(str(path))
        return float(info.duration)
    except Exception:
        pass

    try:
        size_bytes = path.stat().st_size
        if size_bytes > 0:
            # Fallback estimate for m4a/aac containers when ffmpeg bindings are absent
            return max(1.0, float(size_bytes) / 16000.0)
    except Exception:
        pass

    return 5.0


@router.post("/transcribe", status_code=status.HTTP_202_ACCEPTED,
             response_model=SubmitResponse)
async def submit_transcription(
    request: Request,
    audio: UploadFile = File(...),
    mode: str = Form("melody"),
    key: str | None = Form(None),
    tempo: int | None = Form(None),
    time_signature: str | None = Form(None),
    callback_url: str | None = Form(None),
    priority: str = Form("normal"),
    max_seconds: float | None = Form(None, description="Transcribe only the first N seconds (an anonymous preview)"),
    separate: bool = Form(False, description="The upload is a full song: isolate the lead vocal first and read the beat from the mix"),
    audio_preview: bool = Form(True, description="Synthesise the piano preview WAV; a client that renders its own playback sends false"),
    harmony: bool = Form(False, description="Also write alto, tenor and bass under the tune (off: one voice is transcribed as one voice)"),
    keyboard_transpose: int = Form(0, description="The transpose setting on the player's keyboard, -11..11; the sheet is written in the key they play in"),
) -> SubmitResponse:
    mode = _mode(mode)
    keyboard_transpose = _keyboard_transpose(keyboard_transpose)
    priority = _priority(priority)
    if max_seconds is not None and not 1.0 <= max_seconds <= settings.max_clip_seconds:
        raise HTTPException(422, f"max_seconds must be between 1 and {settings.max_clip_seconds:.0f}.")

    if tempo is not None and not (20 <= tempo <= 400):
        raise HTTPException(422, "tempo must be between 20 and 400 BPM.")

    time_signature = _clean_time_signature(time_signature)

    if key is not None:
        key = key.strip()
        if not key or key.lower() in ("auto", "null", "none"):
            key = None
        else:
            from app.pipeline.transcriber import _parse_key_override
            try:
                _parse_key_override(key)
            except Exception:  # noqa: BLE001 - any parse failure is a client input error
                raise HTTPException(422, f"Unparseable key override: {key[:32]!r}")

    suffix = Path(audio.filename or "clip.wav").suffix.lower()
    if suffix not in ACCEPTED_SUFFIXES:
        raise HTTPException(415, f"Unsupported audio format '{suffix}'. "
                                 f"Accepted: {', '.join(sorted(ACCEPTED_SUFFIXES))}")
    queue = _get_queue(request)
    _refuse_when_full(queue)

    # Stream to a temp file with a hard size cap
    with tempfile.NamedTemporaryFile(prefix=TEMP_PREFIX, suffix=suffix, delete=False) as tmp:
        tmp_path = Path(tmp.name)
        written = 0
        while chunk := await audio.read(1024 * 1024):
            written += len(chunk)
            if written > settings.max_upload_bytes:
                tmp.close()
                tmp_path.unlink(missing_ok=True)
                raise HTTPException(413, "Upload exceeds the maximum allowed size.")
            tmp.write(chunk)

    if written == 0:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(422, "Empty audio upload.")

    # Decoding is CPU and a subprocess: off the event loop, so other requests (the API's
    # polls, the health check) are answered meanwhile.
    cap = settings.max_clip_seconds if max_seconds is None else max_seconds
    tmp_path, song_seconds = await run_in_threadpool(_working_audio, tmp_path, cap)

    try:
        job_id = queue.submit(tmp_path, mode=mode, key=key, tempo=tempo,
                              time_signature=time_signature,
                              correlation_id=_correlation_id(request),
                              callback_url=callback_url, priority=priority,
                              song_seconds=song_seconds, separate=separate, audio_preview=audio_preview,
                              harmony=harmony, keyboard_transpose=keyboard_transpose)
    except QueueFull:
        tmp_path.unlink(missing_ok=True)
        raise _queue_full()
    return SubmitResponse(job_id=job_id)


def _working_audio(path: Path, cap: float) -> tuple[Path, float | None]:
    """The upload as the WAV the job reads — never more than ``cap`` seconds of it — and the
    whole clip's length when it was cut (None when it was not); the upload is deleted.

    A capped submission (the website's try-it-free preview) keeps only the head of the
    clip, and so does a clip longer than the worker transcribes — a whole song uploaded as a
    file is cut to its first three minutes the way a linked one is, not refused. The cut is
    made whatever the measured length says: a browser's streamed WebM/Opus carries no length
    in its header and measured 0 s, so it used to pass uncut, however long it was. When the
    length is unknown and the cut came out at the cap, the clip is reported as cut at that
    length (it was at least that long). The byte limit still bounds what is accepted at all.
    """
    duration = 0.0
    try:
        duration = _clip_duration_seconds(path)
    except Exception:  # noqa: BLE001 - the length is only for the report; the cut below is what counts
        pass
    try:
        out = _trim_head(path, cap)
    except Exception as ex:  # noqa: BLE001 - a clip we cannot decode is a client input error
        path.unlink(missing_ok=True)
        logger.warning("Decoding a %.0fs upload failed: %s", duration, ex)
        raise HTTPException(422, "This audio file could not be read. Try saving it as an MP3 or WAV and upload it again.")
    if duration > cap + 0.5:
        return out, duration
    try:
        import soundfile as sf
        kept = float(sf.info(str(out)).duration)
    except Exception:  # noqa: BLE001 - our own WAV; unreadable only if the disk failed
        kept = 0.0
    # The measurement said less than was actually there (0 s for a streamed WebM, or the
    # size estimate), so it is no evidence the clip ended within the cap.
    if kept >= cap - 0.05 and duration < kept - 0.5:
        return out, kept
    return out, None


MAX_TRIM_RATE = 48000
# Mono and stereo, and the usual rates, pass through untouched; ffmpeg folds anything else to
# the nearest of them (more channels to stereo, a faster rate to 48 kHz).
_TRIM_FORMAT = ("aformat=sample_rates=8000|11025|12000|16000|22050|24000|32000|44100|48000"
                ":channel_layouts=mono|stereo")


def _trim_head(path: Path, seconds: float) -> Path:
    """The first ``seconds`` of ``path`` as a new WAV; the original is deleted.

    At the source's own sample rate and channels: a song is trimmed before its vocal is
    isolated, and the isolation model reads 44.1 kHz stereo.  This used to write 22.05 kHz
    mono, which cost the preview of a song 0.02-0.10 solfa error per note and doubled its
    tempo errors (``tests.accuracy.songs``).  ffmpeg cuts without decoding the rest.

    Up to stereo and ``MAX_TRIM_RATE`` only (``_TRIM_FORMAT``): a few hundred KB of silent
    655 kHz eight-channel FLAC trimmed as it came would be ~2 GB on disk and ~4 GB once
    loaded, enough to kill the worker; anything wider or faster is folded to stereo at 48 kHz.
    """
    import shutil
    import subprocess

    import soundfile as sf

    with tempfile.NamedTemporaryFile(prefix=TEMP_PREFIX, suffix=".wav", delete=False) as out:
        out_path = Path(out.name)
    try:
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg:
            subprocess.run(
                [ffmpeg, "-v", "error", "-nostdin", "-y", *INPUT_GUARD, "-i", str(path),
                 "-t", f"{seconds:.3f}", "-vn", "-af", _TRIM_FORMAT, "-c:a", "pcm_s16le", str(out_path)],
                capture_output=True, timeout=120, check=True)
        else:
            y, sr = librosa.load(str(path), sr=None, mono=False, duration=seconds)
            if y.ndim > 1 and y.shape[0] > 2:
                y = y.mean(axis=0)
            if sr > MAX_TRIM_RATE:
                y, sr = librosa.resample(y, orig_sr=sr, target_sr=MAX_TRIM_RATE), MAX_TRIM_RATE
            sf.write(str(out_path), y.T, sr)
    except Exception:
        out_path.unlink(missing_ok=True)
        raise
    path.unlink(missing_ok=True)
    return out_path


MODES = ("melody", "poly", "choir", "chords")


def _mode(value: str) -> str:
    if value not in MODES:
        raise HTTPException(422, "mode must be 'melody', 'poly', 'choir' or 'chords'")
    return value


def _keyboard_transpose(value: int) -> int:
    if not -11 <= value <= 11:
        raise HTTPException(422, "keyboard_transpose must be between -11 and 11.")
    return value


def _priority(value: str) -> str:
    value = (value or "normal").strip().lower()
    if value not in ("normal", "high"):
        raise HTTPException(422, "priority must be 'normal' or 'high'")
    return value


def _clean_time_signature(time_signature: str | None) -> str | None:
    """The meter the caller gave, or None for none ("auto"): the worker then reads it off the notes."""
    if time_signature is None:
        return None
    time_signature = time_signature.strip()
    if not time_signature or time_signature.lower() in ("auto", "null", "none"):
        return None
    import re
    if not re.match(r"^\d{1,2}/\d{1,2}$", time_signature):
        raise HTTPException(422, f"Invalid time signature format: {time_signature!r}. Expected e.g. '4/4', '3/4', '6/8'.")
    return time_signature


def _clean_key(key: str | None) -> str | None:
    if key is None:
        return None
    key = key.strip()
    if not key or key.lower() in ("auto", "null", "none"):
        return None
    from app.pipeline.transcriber import _parse_key_override
    try:
        _parse_key_override(key)
    except Exception:  # noqa: BLE001 - any parse failure is a client input error
        raise HTTPException(422, f"Unparseable key override: {key[:32]!r}")
    return key


@router.post("/transcribe/link", status_code=status.HTTP_202_ACCEPTED,
             response_model=SubmitResponse)
async def submit_link_transcription(
    request: Request,
    url: str = Form(...),
    mode: str = Form("melody"),
    key: str | None = Form(None),
    tempo: int | None = Form(None),
    time_signature: str | None = Form(None),
    callback_url: str | None = Form(None),
    priority: str = Form("normal"),
    max_seconds: float | None = Form(None),
    audio_preview: bool = Form(True),
    harmony: bool = Form(False),
    keyboard_transpose: int = Form(0),
    start_seconds: float = Form(0.0, description="Transcribe from this point in the song (seconds)"),
    end_seconds: float | None = Form(None, description="...up to this point (seconds); the song's end when absent"),
) -> SubmitResponse:
    """Transcribe the lead vocal of a song behind a YouTube, Spotify or Apple Music link.

    The audio is fetched, its vocals isolated, and the result carries the song's title
    and artist for the acknowledgement line.  ``max_seconds`` is the caller's cap (a
    free preview, or the Pro allowance); it can only lower the worker's own limit.
    ``start_seconds``/``end_seconds`` pick the section of the song; the cap still bounds
    how much of it is transcribed.
    """
    from app.ingest.links import cached_refusal, provider_of

    mode = _mode(mode)
    keyboard_transpose = _keyboard_transpose(keyboard_transpose)
    if tempo is not None and not (20 <= tempo <= 400):
        raise HTTPException(422, "tempo must be between 20 and 400 BPM.")
    priority = _priority(priority)
    time_signature = _clean_time_signature(time_signature)
    key = _clean_key(key)
    url = (url or "").strip()
    if len(url) > 2048 or provider_of(url) is None:
        raise HTTPException(422, "url must be a YouTube video, Spotify track or Apple Music song link.")
    # A link the resolve already turned away (a live stream, a video over the cap) is
    # refused here and now rather than queued for a job that would only fail.
    refusal = cached_refusal(url)
    if refusal is not None:
        raise _refused_link(refusal)
    cap = settings.link_max_seconds
    if max_seconds is not None:
        if max_seconds < 10:
            raise HTTPException(422, "max_seconds must be at least 10.")
        cap = min(cap, float(max_seconds))
    # A form field parses "nan" and "inf" as floats; neither is a place in a song.
    if not math.isfinite(start_seconds) or start_seconds < 0:
        raise HTTPException(422, "start_seconds must be 0 or more.")
    if end_seconds is not None and (not math.isfinite(end_seconds) or end_seconds <= start_seconds):
        raise HTTPException(422, "end_seconds must be later than start_seconds.")

    queue = _get_queue(request)
    try:
        job_id = queue.submit_link(url, mode=mode, key=key, tempo=tempo,
                                   time_signature=time_signature,
                                   correlation_id=_correlation_id(request),
                                   callback_url=callback_url, priority=priority,
                                   max_seconds=cap, audio_preview=audio_preview, harmony=harmony,
                                   keyboard_transpose=keyboard_transpose,
                                   start_seconds=start_seconds, end_seconds=end_seconds)
    except QueueFull:
        raise _queue_full()
    return SubmitResponse(job_id=job_id)


@router.post("/links/resolve", response_model=LinkInfoResponse,
             summary="What a pasted link points at: title, artist, artwork and length")
def resolve_link_info(body: LinkInfoRequest) -> LinkInfoResponse:
    """Synchronous, in the threadpool (a plain ``def``): the stores' metadata endpoints and,
    for a YouTube video, one bounded yt-dlp call answer within seconds, and the answer is
    remembered so the job that follows asks for none of it again.  An unusable link is a
    422 whose detail is the plain sentence to show."""
    from app.ingest.links import LinkError, provider_of, resolve_link

    url = (body.url or "").strip()
    if len(url) > 2048 or provider_of(url) is None:
        raise HTTPException(422, "url must be a YouTube video, Spotify track or Apple Music song link.")
    try:
        source = resolve_link(url)
    except LinkError as ex:
        raise _refused_link(ex)
    return LinkInfoResponse(provider=source.provider, url=source.url, title=source.title, artist=source.artist,
                            thumbnail_url=source.thumbnail_url, duration_seconds=source.duration)


# A six-minute song at 400 BPM is 2400 beats; the harmoniser's cost is beats × notes, so both
# are bounded here before any work starts (the C# validator refuses the same shapes earlier).
HARMONISE_MAX_BEATS = 2400.0
HARMONISE_MAX_NOTES = 5000
#: The shortest note either endpoint takes: a sixty-fourth note, in quarter-note beats.
MIN_NOTE_BEATS = 1.0 / 16.0

#: The plain sentences a malformed note list is answered with. Fixed text, never an
#: exception's: a parser's message echoes the input and names the internals.
_NOTES_INVALID = ("Every note needs a pitch from 0 to 127, a start at or after beat 0, a length of at "
                  f"least 1/16 of a beat, and must end by beat {HARMONISE_MAX_BEATS:g}.")


def _notes_are_valid(notes) -> bool:
    """Finite numbers in range for every note (JSON lets NaN and Infinity through as floats)."""
    for n in notes:
        start, dur = float(n.start_beat), float(n.dur_beats)
        if not (math.isfinite(start) and math.isfinite(dur)):
            return False
        if not 0 <= n.pitch_midi <= 127 or start < 0 or dur < MIN_NOTE_BEATS:
            return False
        if start + dur > HARMONISE_MAX_BEATS:
            return False
        conf = getattr(n, "conf", None)
        if conf is not None and not math.isfinite(float(conf)):
            return False
    return True


@router.post("/harmonise", response_model=HarmoniseResponse, response_model_exclude_none=True,
             summary="Write alto, tenor and bass under a transcribed melody")
def harmonise(body: HarmoniseRequest) -> HarmoniseResponse:
    """Synchronous, in the threadpool (a plain ``def``): chord choice is fast but the four-part
    MusicXML takes music21 a second or three for a whole song, and that must not stall the
    event loop. The arrangement is the user's to ask for; a transcription never carries it
    unasked."""
    from app.pipeline.transcriber import harmonise_sheet

    if not body.notes:
        raise HTTPException(422, "The melody has no notes.")
    if len(body.notes) > HARMONISE_MAX_NOTES:
        raise HTTPException(422, f"At most {HARMONISE_MAX_NOTES} notes can be harmonised at once.")
    if not 20 <= body.tempo_bpm <= 400:
        raise HTTPException(422, "tempoBpm must be between 20 and 400.")
    if not _notes_are_valid(body.notes):
        raise HTTPException(422, _NOTES_INVALID)
    time_signature = _clean_time_signature(body.time_signature) or "4/4"
    try:
        parts, parts_musicxml = harmonise_sheet(
            body.key, body.tempo_bpm, time_signature, [n.model_dump() for n in body.notes])
    except ValueError as ex:
        logger.info("Harmonise refused: %s", ex)
        raise HTTPException(422, "The key could not be read. Send one such as 'C major' or 'A minor'.")
    return HarmoniseResponse(parts=parts, parts_musicxml=parts_musicxml)


GRADE_SUFFIXES = ACCEPTED_SUFFIXES
GRADE_MAX_SECONDS = 120.0
GRADE_MAX_NOTES = 2000
#: The longest count-in a take may start with.
GRADE_MAX_LEAD_IN_SECONDS = 30.0
#: The widest alignment search a target may ask for: the grader's own (``grade.OFFSET_SEARCH_SEC``).
GRADE_MAX_OFFSET_SEARCH = 1.5


@router.post("/grade", response_model=GradeResponse,
             summary="Grade a sung take against a part — pitch per note, in tune or not")
async def grade_take(
    request: Request,
    audio: UploadFile = File(...),
    target: str = Form(..., description="GradeTargetDto as JSON: the part in beats, tempo, count-in"),
):
    """Synchronous: a take is a minute or two and pyin on it takes seconds, so it is
    answered in the request rather than queued like a transcription — but in the threadpool
    (``_grade_file``), so the event loop keeps answering everyone else meanwhile. The audio
    is deleted before the response is sent."""
    try:
        spec = GradeTargetDto.model_validate_json(target)
    except Exception as ex:  # noqa: BLE001 - any parse failure is a client input error
        logger.info("Grade target refused: %s", type(ex).__name__)
        raise HTTPException(422, "The target part could not be read.")
    if not spec.notes:
        raise HTTPException(422, "The target has no notes.")
    if len(spec.notes) > GRADE_MAX_NOTES:
        raise HTTPException(422, f"A target part has at most {GRADE_MAX_NOTES} notes.")
    if not 20 <= spec.tempo_bpm <= 300:
        raise HTTPException(422, "tempoBpm must be between 20 and 300.")
    if not (math.isfinite(spec.lead_in_sec) and 0 <= spec.lead_in_sec <= GRADE_MAX_LEAD_IN_SECONDS):
        raise HTTPException(422, f"leadInSec must be between 0 and {GRADE_MAX_LEAD_IN_SECONDS:g}.")
    if not _notes_are_valid(spec.notes):
        raise HTTPException(422, _NOTES_INVALID)
    if spec.max_sec is not None and not (math.isfinite(spec.max_sec) and 1 <= spec.max_sec <= GRADE_MAX_SECONDS):
        raise HTTPException(422, f"maxSec must be between 1 and {GRADE_MAX_SECONDS:g}.")
    if spec.offset_search_sec is not None and not (
            math.isfinite(spec.offset_search_sec) and 0 <= spec.offset_search_sec <= GRADE_MAX_OFFSET_SEARCH):
        raise HTTPException(422, f"offsetSearchSec must be between 0 and {GRADE_MAX_OFFSET_SEARCH:g}.")

    suffix = Path(audio.filename or "take.wav").suffix.lower()
    if suffix not in GRADE_SUFFIXES:
        raise HTTPException(415, f"Unsupported audio format '{suffix}'.")
    with tempfile.NamedTemporaryFile(prefix=TEMP_PREFIX, suffix=suffix, delete=False) as tmp:
        tmp_path = Path(tmp.name)
        written = 0
        while chunk := await audio.read(1024 * 1024):
            written += len(chunk)
            if written > settings.max_upload_bytes:
                tmp.close()
                tmp_path.unlink(missing_ok=True)
                raise HTTPException(413, "Upload exceeds the maximum allowed size.")
            tmp.write(chunk)
    if written == 0:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(422, "Empty audio upload.")

    try:
        result = await run_in_threadpool(_grade_file, tmp_path, spec)
    finally:
        tmp_path.unlink(missing_ok=True)
    return GradeResponse(
        score=result.score, hits=result.hits, near=result.near, wrong=result.wrong, missed=result.missed,
        tuning_cents=result.tuning_cents, offset_sec=result.offset_sec, octave_shift=result.octave_shift,
        summary=result.summary, notes=[asdict(n) for n in result.notes],
    )


def _grade_file(path: Path, spec: GradeTargetDto):
    """Decode a take (at most a second past ``GRADE_MAX_SECONDS`` of it, so a take too long
    is told so without the rest ever being read) and grade it against ``spec``. A target with
    ``max_sec`` (a practice drill) has its take cut there instead: nothing past it is read."""
    from app.pipeline import grade as grading
    from app.pipeline.transcriber import _ensure_wav_path

    cut = spec.max_sec is not None
    bound = float(spec.max_sec) if cut else GRADE_MAX_SECONDS + 1.0
    wav_path, converted = path, False
    try:
        try:
            wav_path, converted = _ensure_wav_path(path, max_seconds=bound)
            duration = _clip_duration_seconds(wav_path)
        except Exception as ex:  # noqa: BLE001 - an undecodable take is a client input error
            logger.info("Grade take unreadable: %s", ex)
            raise HTTPException(422, "The take could not be read. Record it again and resend it.")
        if not cut and duration > GRADE_MAX_SECONDS:
            raise HTTPException(413, f"A take is at most {GRADE_MAX_SECONDS:.0f}s long.")
        y, sr = librosa.load(str(wav_path), sr=grading.vocal.SAMPLE_RATE, mono=True, duration=bound)
        return grading.grade(
            y, sr,
            [grading.TargetNote(n.pitch_midi, n.start_beat, n.dur_beats) for n in spec.notes],
            spec.tempo_bpm, spec.lead_in_sec,
            grading.OFFSET_SEARCH_SEC if spec.offset_search_sec is None else spec.offset_search_sec,
        )
    finally:
        if converted:
            wav_path.unlink(missing_ok=True)


#: A hummed clip of twenty seconds is well under a megabyte in any format a browser records; this
#: bounds a WAV of it with room to spare, and refuses anything else before it is written to disk.
IDENTIFY_MAX_UPLOAD_BYTES = 12 * 1024 * 1024
IDENTIFY_BUSY_MESSAGE = "The hymn finder is busy right now. Please try again in a few seconds."
IDENTIFY_BUSY_RETRY_SECONDS = 5

#: Look-ups decoding at once (``settings.identify_concurrency``). A thread semaphore, taken in the
#: threadpool, so it serves every event loop alike (the tests run several).
_identify_slots = threading.BoundedSemaphore(settings.identify_concurrency)


class _IdentifyBusy(Exception):
    pass


@router.post("/identify", response_model=IdentifyResponse,
             summary="Name the hymn a hummed or sung clip is (at most NF_IDENTIFY_MAX_SECONDS of it)")
async def identify_hymn(audio: UploadFile = File(...)) -> IdentifyResponse:
    """Synchronous, like ``/grade``: the melody decoder alone (pyin, no Basic Pitch, no separation)
    on at most ``identify_max_seconds`` of the clip — cut with ffmpeg ``-t`` whatever its header
    says — and then ``hymn_match.match``, whose thresholds are the transcriptions' own. About a
    second of one core for a 15 s hum, in the threadpool and never in the job queue; at most
    ``identify_concurrency`` at once, and a look-up that cannot get a slot within
    ``identify_wait_seconds`` is a 503. The audio is deleted before the response is sent."""
    suffix = Path(audio.filename or "hum.webm").suffix.lower()
    if suffix not in ACCEPTED_SUFFIXES:
        raise HTTPException(415, f"Unsupported audio format '{suffix}'.")
    with tempfile.NamedTemporaryFile(prefix=TEMP_PREFIX, suffix=suffix, delete=False) as tmp:
        tmp_path = Path(tmp.name)
        written = 0
        while chunk := await audio.read(1024 * 1024):
            written += len(chunk)
            if written > IDENTIFY_MAX_UPLOAD_BYTES:
                tmp.close()
                tmp_path.unlink(missing_ok=True)
                raise HTTPException(413, "That recording is too large. Hum for up to 20 seconds.")
            tmp.write(chunk)
    if written == 0:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(422, "Empty audio upload.")
    try:
        return await run_in_threadpool(_identify_file, tmp_path)
    except _IdentifyBusy:
        raise HTTPException(503, IDENTIFY_BUSY_MESSAGE, headers={"Retry-After": str(IDENTIFY_BUSY_RETRY_SECONDS)})
    finally:
        tmp_path.unlink(missing_ok=True)


def _identify_file(path: Path) -> IdentifyResponse:
    import time

    if not _identify_slots.acquire(timeout=settings.identify_wait_seconds):
        logger.warning("hymn_identify outcome=busy")
        raise _IdentifyBusy()
    started = time.perf_counter()
    try:
        cap = settings.identify_max_seconds
        try:
            wav = _trim_head(path, cap)  # deletes ``path``
        except Exception as ex:  # noqa: BLE001 - a clip we cannot decode is a client input error
            logger.info("hymn_identify unreadable: %s", type(ex).__name__)
            raise HTTPException(422, "This recording could not be read. Record it again and resend it.")
        try:
            notes, seconds = _hummed_notes(wav, cap)
        finally:
            wav.unlink(missing_ok=True)
        result = _identify_notes(notes, seconds)
        logger.info(
            "hymn_identify outcome=%s notes=%d seconds=%.1f elapsed=%.2f%s",
            "found" if result.match else "too_short" if result.too_short else "none",
            result.notes_heard, seconds, time.perf_counter() - started,
            f" slug={result.match.slug}" if result.match else "")
        return result
    finally:
        _identify_slots.release()


def _hummed_notes(wav: Path, cap: float) -> tuple[list[tuple[int, float, float]], float]:
    """The notes (pitch, start s, length s) the melody decoder hears in at most ``cap`` seconds."""
    from app.pipeline import vocal

    try:
        y, sr = librosa.load(str(wav), sr=vocal.SAMPLE_RATE, mono=True, duration=cap)
    except Exception as ex:  # noqa: BLE001 - our own WAV; unreadable only if ffmpeg wrote nothing usable
        logger.info("hymn_identify unreadable WAV: %s", type(ex).__name__)
        raise HTTPException(422, "This recording could not be read. Record it again and resend it.")
    seconds = float(len(y)) / sr if sr else 0.0
    if seconds < 0.5 or not np.any(np.abs(y) > 1e-4):
        return [], seconds
    try:
        analysis = vocal.analyse(y, sr)
    except Exception as ex:  # noqa: BLE001 - a clip pyin cannot follow is simply one with no tune heard
        logger.info("hymn_identify decode failed: %s", ex)
        return [], seconds
    return [(n.pitch, n.start, n.end - n.start) for n in analysis.notes if 0 <= n.pitch <= 127], seconds


def _identify_notes(notes: list[tuple[int, float, float]], seconds: float) -> IdentifyResponse:
    from app.pipeline import hymn_match

    heard = len(notes)
    if hymn_match.too_short(notes):
        return IdentifyResponse(match=None, notes_heard=heard, too_short=True, seconds_heard=round(seconds, 2))
    m = hymn_match.match(notes, seconds_per_unit=1.0)
    found = None
    if m is not None:
        e = m.entry
        kind = "incipit" if e.kind == "incipit" else "tune" if "/hymns/tunes/" in e.url else "hymn"
        found = IdentifiedHymnDto(slug=e.slug, title=e.title, tune=e.tune, url=e.url, kind=kind,
                                  confidence=m.confidence, first_line=_first_line(e.lyrics))
    return IdentifyResponse(match=found, notes_heard=heard, too_short=False, seconds_heard=round(seconds, 2))


def _first_line(lyrics: str) -> str | None:
    """The opening words of an entry's underlay ("A-maz-ing grace! how sweet the sound" → "Amazing grace!
    how sweet the sound"): syllables joined, melisma marks dropped, up to the first line's punctuation."""
    text = re.sub(r"(?<=\w)[-‑]+(?=\w)", "", lyrics or "")
    text = re.sub(r"[_‑]+", "", text)
    words = text.split()
    if not words:
        return None
    line: list[str] = []
    for w in words:
        line.append(w)
        if len(line) >= 4 and re.search(r"[,;:.!?]$", w) or len(line) >= 10:
            break
    return " ".join(line).rstrip(",;:")


@router.get("/jobs/{job_id}", response_model=JobResponse,
            response_model_exclude_none=True)
async def get_job(request: Request, job_id: str) -> JobResponse:
    queue = _get_queue(request)
    job = queue.get(job_id)
    if job is None:
        raise HTTPException(404, "Unknown or expired job id.")

    result = None
    if job.result is not None:
        payload = asdict(job.result)
        payload["notes"] = payload.pop("notes")
        result = ResultDto.model_validate(payload)

    return JobResponse(status=job.status, progress=job.progress, stage=job.stage,
                       queue_position=queue.queue_position(job_id),
                       source=job.source, result=result, error=job.error)


ACCEPTED_SCORE_SUFFIXES = {".musicxml", ".xml", ".mxl", ".mid", ".midi", ".abc"}


@router.post("/transcribe/score", status_code=status.HTTP_202_ACCEPTED,
             response_model=SubmitResponse)
async def submit_score_transcription(
    request: Request,
    score: UploadFile = File(...),
    key: str | None = Form(None),
    tempo: int | None = Form(None),
    time_signature: str | None = Form(None),
    callback_url: str | None = Form(None),
    priority: str = Form("normal"),
) -> SubmitResponse:
    if tempo is not None and not (20 <= tempo <= 400):
        raise HTTPException(422, "tempo must be between 20 and 400 BPM.")

    if time_signature is not None:
        time_signature = time_signature.strip()
        if not time_signature or time_signature.lower() in ("auto", "null", "none"):
            time_signature = None
        else:
            import re
            if not re.match(r"^\d{1,2}/\d{1,2}$", time_signature):
                raise HTTPException(422, f"Invalid time signature format: {time_signature!r}.")

    if key is not None:
        key = key.strip()
        if not key or key.lower() in ("auto", "null", "none"):
            key = None
        else:
            from app.pipeline.transcriber import _parse_key_override
            try:
                _parse_key_override(key)
            except Exception:
                raise HTTPException(422, f"Unparseable key override: {key[:32]!r}")

    suffix = Path(score.filename or "score.musicxml").suffix.lower()
    if suffix not in ACCEPTED_SCORE_SUFFIXES:
        raise HTTPException(415, f"Unsupported score format '{suffix}'. "
                                 f"Accepted: {', '.join(sorted(ACCEPTED_SCORE_SUFFIXES))}")

    queue = _get_queue(request)
    _refuse_when_full(queue)
    with tempfile.NamedTemporaryFile(prefix=TEMP_PREFIX, suffix=suffix, delete=False) as tmp:
        tmp_path = Path(tmp.name)
        written = 0
        while chunk := await score.read(1024 * 1024):
            written += len(chunk)
            if written > settings.max_upload_bytes:
                tmp.close()
                tmp_path.unlink(missing_ok=True)
                raise HTTPException(413, "Upload exceeds the maximum allowed size.")
            tmp.write(chunk)

    if written == 0:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(422, "Empty score upload.")

    try:
        job_id = queue.submit_score(tmp_path, key=key, tempo=tempo,
                                    time_signature=time_signature,
                                    correlation_id=_correlation_id(request),
                                    callback_url=callback_url, priority=_priority(priority))
    except QueueFull:
        tmp_path.unlink(missing_ok=True)
        raise _queue_full()
    return SubmitResponse(job_id=job_id)
