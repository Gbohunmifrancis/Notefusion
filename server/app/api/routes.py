"""v1 endpoints (TRD par. 6):
    POST /v1/transcribe   multipart audio + options -> 202 { jobId }
    GET  /v1/jobs/{id}    -> { status, progress } | { status: done, result }
"""

import logging
import tempfile
from dataclasses import asdict
from pathlib import Path

import librosa
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status

from app.api.schemas import (
    GradeResponse, GradeTargetDto, HarmoniseRequest, HarmoniseResponse, JobResponse, ResultDto, SubmitResponse,
)
from app.config import settings
from app.jobs.queue import JobQueue

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

    if time_signature is not None:
        time_signature = time_signature.strip()
        if not time_signature or time_signature.lower() in ("auto", "null", "none"):
            time_signature = "4/4"
        else:
            import re
            if not re.match(r"^\d{1,2}/\d{1,2}$", time_signature):
                raise HTTPException(422, f"Invalid time signature format: {time_signature!r}. Expected e.g. '4/4', '3/4', '6/8'.")
    else:
        time_signature = "4/4"

    if key is not None:
        key = key.strip()
        if not key or key.lower() in ("auto", "null", "none"):
            key = None
        else:
            from app.pipeline.transcriber import _parse_key_override
            try:
                _parse_key_override(key)
            except Exception:  # noqa: BLE001 - any parse failure is a client input error
                raise HTTPException(422, f"Unparseable key override: {key!r}")

    suffix = Path(audio.filename or "clip.wav").suffix.lower()
    if suffix not in ACCEPTED_SUFFIXES:
        raise HTTPException(415, f"Unsupported audio format '{suffix}'. "
                                 f"Accepted: {', '.join(sorted(ACCEPTED_SUFFIXES))}")

    # Stream to a temp file with a hard size cap
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
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
        duration = _clip_duration_seconds(tmp_path)
    except Exception as ex:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(422, f"Could not read audio duration: {ex}")

    # A capped submission (the website's try-it-free preview) keeps only the head of the
    # clip, and so does a clip longer than the worker transcribes — a whole song uploaded
    # as a file is cut to its first three minutes the way a linked one is, not refused.
    # The result says how long the whole clip was and that it was cut; the byte limit
    # above still bounds what is accepted at all.
    song_seconds: float | None = None
    cap = settings.max_clip_seconds if max_seconds is None else max_seconds
    if duration > cap + 0.5:
        try:
            tmp_path = _trim_head(tmp_path, cap)
        except Exception as ex:  # noqa: BLE001 - a clip we cannot decode is a client input error
            tmp_path.unlink(missing_ok=True)
            logger.warning("Trimming a %.0fs upload failed: %s", duration, ex)
            raise HTTPException(422, "This audio file could not be read. Try saving it as an MP3 or WAV and upload it again.")
        song_seconds = duration

    queue = _get_queue(request)
    job_id = queue.submit(tmp_path, mode=mode, key=key, tempo=tempo,
                          time_signature=time_signature,
                          correlation_id=_correlation_id(request),
                          callback_url=callback_url, priority=priority,
                          song_seconds=song_seconds, separate=separate, audio_preview=audio_preview,
                          harmony=harmony, keyboard_transpose=keyboard_transpose)
    return SubmitResponse(job_id=job_id)


def _trim_head(path: Path, seconds: float) -> Path:
    """The first ``seconds`` of ``path`` as a new WAV; the original is deleted.

    At the source's own sample rate and channels: a song is trimmed before its vocal is
    isolated, and the isolation model reads 44.1 kHz stereo.  This used to write 22.05 kHz
    mono, which cost the preview of a song 0.02-0.10 solfa error per note and doubled its
    tempo errors (``tests.accuracy.songs``).  ffmpeg cuts without decoding the rest.
    """
    import shutil
    import subprocess

    import soundfile as sf

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as out:
        out_path = Path(out.name)
    try:
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg:
            subprocess.run(
                [ffmpeg, "-v", "error", "-nostdin", "-y", "-i", str(path), "-t", f"{seconds:.3f}",
                 "-vn", "-c:a", "pcm_s16le", str(out_path)],
                capture_output=True, timeout=120, check=True)
        else:
            y, sr = librosa.load(str(path), sr=None, mono=False, duration=seconds)
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


def _clean_time_signature(time_signature: str | None) -> str:
    if time_signature is None:
        return "4/4"
    time_signature = time_signature.strip()
    if not time_signature or time_signature.lower() in ("auto", "null", "none"):
        return "4/4"
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
        raise HTTPException(422, f"Unparseable key override: {key!r}")
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
) -> SubmitResponse:
    """Transcribe the lead vocal of a song behind a YouTube, Spotify or Apple Music link.

    The audio is fetched, its vocals isolated, and the result carries the song's title
    and artist for the acknowledgement line.  ``max_seconds`` is the caller's cap (a
    free preview, or the Pro allowance); it can only lower the worker's own limit.
    """
    from app.ingest.links import provider_of

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
    cap = settings.link_max_seconds
    if max_seconds is not None:
        if max_seconds < 10:
            raise HTTPException(422, "max_seconds must be at least 10.")
        cap = min(cap, float(max_seconds))

    queue = _get_queue(request)
    job_id = queue.submit_link(url, mode=mode, key=key, tempo=tempo,
                               time_signature=time_signature,
                               correlation_id=_correlation_id(request),
                               callback_url=callback_url, priority=priority,
                               max_seconds=cap, audio_preview=audio_preview, harmony=harmony,
                               keyboard_transpose=keyboard_transpose)
    return SubmitResponse(job_id=job_id)


# A six-minute song at 400 BPM is 2400 beats; the harmoniser's cost is beats × notes, so both
# are bounded here before any work starts (the C# validator refuses the same shapes earlier).
HARMONISE_MAX_BEATS = 2400.0
HARMONISE_MAX_NOTES = 5000


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
    for n in body.notes:
        if n.start_beat < 0 or n.dur_beats <= 0 or n.start_beat + n.dur_beats > HARMONISE_MAX_BEATS:
            raise HTTPException(422, f"Notes must start at or after beat 0, last longer than nothing and end by beat {HARMONISE_MAX_BEATS:g}.")
    time_signature = _clean_time_signature(body.time_signature)
    try:
        parts, parts_musicxml = harmonise_sheet(
            body.key, body.tempo_bpm, time_signature, [n.model_dump() for n in body.notes])
    except ValueError as ex:
        raise HTTPException(422, str(ex))
    return HarmoniseResponse(parts=parts, parts_musicxml=parts_musicxml)


GRADE_SUFFIXES = ACCEPTED_SUFFIXES
GRADE_MAX_SECONDS = 120.0


@router.post("/grade", response_model=GradeResponse,
             summary="Grade a sung take against a part — pitch per note, in tune or not")
async def grade_take(
    request: Request,
    audio: UploadFile = File(...),
    target: str = Form(..., description="GradeTargetDto as JSON: the part in beats, tempo, count-in"),
):
    """Synchronous: a take is a minute or two and pyin on it takes seconds, so it is
    answered in the request rather than queued like a transcription. The audio is
    deleted before the response is sent."""
    try:
        spec = GradeTargetDto.model_validate_json(target)
    except Exception as ex:  # noqa: BLE001 - any parse failure is a client input error
        raise HTTPException(422, f"Invalid target: {ex}")
    if not spec.notes:
        raise HTTPException(422, "The target has no notes.")
    if not 20 <= spec.tempo_bpm <= 300:
        raise HTTPException(422, "tempoBpm must be between 20 and 300.")

    suffix = Path(audio.filename or "take.wav").suffix.lower()
    if suffix not in GRADE_SUFFIXES:
        raise HTTPException(415, f"Unsupported audio format '{suffix}'.")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
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

    wav_path, converted = tmp_path, False
    try:
        from app.pipeline import grade as grading
        from app.pipeline.transcriber import _ensure_wav_path

        try:
            wav_path, converted = _ensure_wav_path(tmp_path)
            duration = _clip_duration_seconds(wav_path)
        except Exception as ex:
            raise HTTPException(422, f"Could not read the take: {ex}")
        if duration > GRADE_MAX_SECONDS:
            raise HTTPException(413, f"A take is at most {GRADE_MAX_SECONDS:.0f}s long.")
        y, sr = librosa.load(str(wav_path), sr=grading.vocal.SAMPLE_RATE, mono=True)
        result = grading.grade(
            y, sr,
            [grading.TargetNote(n.pitch_midi, n.start_beat, n.dur_beats) for n in spec.notes],
            spec.tempo_bpm, spec.lead_in_sec,
        )
    finally:
        tmp_path.unlink(missing_ok=True)
        if converted:
            wav_path.unlink(missing_ok=True)
    return GradeResponse(
        score=result.score, hits=result.hits, near=result.near, wrong=result.wrong, missed=result.missed,
        tuning_cents=result.tuning_cents, offset_sec=result.offset_sec, octave_shift=result.octave_shift,
        summary=result.summary, notes=[asdict(n) for n in result.notes],
    )


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
                raise HTTPException(422, f"Unparseable key override: {key!r}")

    suffix = Path(score.filename or "score.musicxml").suffix.lower()
    if suffix not in ACCEPTED_SCORE_SUFFIXES:
        raise HTTPException(415, f"Unsupported score format '{suffix}'. "
                                 f"Accepted: {', '.join(sorted(ACCEPTED_SCORE_SUFFIXES))}")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
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

    queue = _get_queue(request)
    job_id = queue.submit_score(tmp_path, key=key, tempo=tempo,
                                time_signature=time_signature,
                                correlation_id=_correlation_id(request),
                                callback_url=callback_url, priority=_priority(priority))
    return SubmitResponse(job_id=job_id)
