"""v1 endpoints (TRD par. 6):
    POST /v1/transcribe   multipart audio + options -> 202 { jobId }
    GET  /v1/jobs/{id}    -> { status, progress } | { status: done, result }
"""

import tempfile
from dataclasses import asdict
from pathlib import Path

import librosa
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status

from app.api.schemas import JobResponse, ResultDto, SubmitResponse
from app.config import settings
from app.jobs.queue import JobQueue

router = APIRouter(prefix="/v1")

ACCEPTED_SUFFIXES = {".wav", ".flac", ".ogg", ".opus", ".mp3", ".m4a"}

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
) -> SubmitResponse:
    if mode not in ("melody", "poly"):
        raise HTTPException(422, "mode must be 'melody' or 'poly'")

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

    if duration > settings.max_clip_seconds:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(413, f"Clip length {duration:.1f}s exceeds the maximum "
                                 f"of {settings.max_clip_seconds:.0f}s.")

    queue = _get_queue(request)
    job_id = queue.submit(tmp_path, mode=mode, key=key, tempo=tempo,
                          time_signature=time_signature,
                          correlation_id=_correlation_id(request))
    return SubmitResponse(job_id=job_id)


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

    return JobResponse(status=job.status, progress=job.progress,
                       result=result, error=job.error)


ACCEPTED_SCORE_SUFFIXES = {".musicxml", ".xml", ".mxl", ".mid", ".midi", ".abc"}


@router.post("/transcribe/score", status_code=status.HTTP_202_ACCEPTED,
             response_model=SubmitResponse)
async def submit_score_transcription(
    request: Request,
    score: UploadFile = File(...),
    key: str | None = Form(None),
    tempo: int | None = Form(None),
    time_signature: str | None = Form(None),
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
                                correlation_id=_correlation_id(request))
    return SubmitResponse(job_id=job_id)
