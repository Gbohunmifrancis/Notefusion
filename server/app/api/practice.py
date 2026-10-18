"""Practice endpoints beside ``/v1/grade``: synchronous, a short take each, answered in the threadpool.

    POST /v1/range          multipart audio -> the notes held, and the lowest and highest of them
    POST /v1/grade/run      multipart audio + target (GradeTargetDto) -> a full-speed run's shape and landing note
    POST /v1/grade/rhythm   multipart audio + target (RhythmTargetDto) -> each clap in time, close or missed

Like ``/v1/grade``: only the C# API calls these (it records the practice), every take is cut at its cap with ffmpeg
``-t`` whatever its header says, and the audio is deleted before the response is sent.
"""

from __future__ import annotations

import logging
import math
import tempfile
from dataclasses import asdict
from pathlib import Path

import librosa
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.api.routes import (
    _NOTES_INVALID, ACCEPTED_SUFFIXES, GRADE_MAX_LEAD_IN_SECONDS, GRADE_MAX_NOTES, GRADE_MAX_SECONDS,
    _notes_are_valid,
)
from app.api.schemas import ApiModel, GradeTargetDto
from app.config import TEMP_PREFIX, settings

router = APIRouter(prefix="/v1")
logger = logging.getLogger(__name__)

#: A range take is a slide and a hold or two; nothing past this is read.
RANGE_MAX_SECONDS = 30.0
#: A run is a few seconds and a rhythm a bar or two; the most of a take either reads.
PATTERN_MAX_SECONDS = 60.0
RHYTHM_MAX_CLAPS = 64


# ── Wire shapes ──────────────────────────────────────────────────────────────


class HoldDto(ApiModel):
    midi: int
    pitch: float
    cents: float
    start_sec: float
    seconds: float


class RangeResponse(ApiModel):
    holds: list[HoldDto]
    lowest: HoldDto | None = None
    highest: HoldDto | None = None
    seconds_heard: float


class RunNoteDto(ApiModel):
    index: int
    target_midi: int
    followed: bool
    status: str  # hit | wrong | missed


class TracePointDto(ApiModel):
    t: float  # seconds from beat one
    midi: float


class RunGradeResponse(ApiModel):
    score: int
    followed: int
    run_notes: int
    landing_status: str  # hit | near | wrong | missed
    landing_cents: float | None = None
    landing_midi: int
    offset_sec: float
    octave_shift: int
    summary: str
    notes: list[RunNoteDto]
    trace: list[TracePointDto]


class RhythmTargetDto(ApiModel):
    """The claps a take is judged against: each one's beat from beat one, the tempo, and the count-in."""

    beats: list[float]
    tempo_bpm: float
    lead_in_sec: float = 0.0
    max_sec: float | None = None


class ClapDto(ApiModel):
    index: int
    beat: float
    error_ms: float | None = None
    status: str  # hit | near | missed


class RhythmGradeResponse(ApiModel):
    score: int
    hits: int
    near: int
    missed: int
    extra: int
    offset_sec: float
    tempo_ratio: float
    summary: str
    claps: list[ClapDto]


# ── Routes ───────────────────────────────────────────────────────────────────


@router.post("/range", response_model=RangeResponse,
             summary="The notes a singer held in a take, and the lowest and highest of them")
async def read_range(audio: UploadFile = File(...)) -> RangeResponse:
    path = await _save(audio)
    try:
        reading = await run_in_threadpool(_range_file, path)
    finally:
        path.unlink(missing_ok=True)

    def hold(h):
        return None if h is None else HoldDto(midi=h.midi, pitch=h.pitch, cents=h.cents, start_sec=h.start_sec, seconds=h.seconds)

    return RangeResponse(holds=[hold(h) for h in reading.holds], lowest=hold(reading.lowest),
                         highest=hold(reading.highest), seconds_heard=reading.seconds_heard)


@router.post("/grade/run", response_model=RunGradeResponse,
             summary="Mark a full-speed run on its shape (the notes in order) and its landing note")
async def grade_run(audio: UploadFile = File(...), target: str = Form(...)) -> RunGradeResponse:
    spec = _parse(GradeTargetDto, target)
    if len(spec.notes) < 2:
        raise HTTPException(422, "A run has at least two notes: the run and the note it lands on.")
    if len(spec.notes) > GRADE_MAX_NOTES or not _notes_are_valid(spec.notes):
        raise HTTPException(422, _NOTES_INVALID)
    _check_timing(spec.tempo_bpm, spec.lead_in_sec, spec.max_sec)
    path = await _save(audio)
    try:
        result = await run_in_threadpool(_run_file, path, spec)
    finally:
        path.unlink(missing_ok=True)
    return RunGradeResponse(
        score=result.score, followed=result.followed, run_notes=result.run_notes, landing_status=result.landing_status,
        landing_cents=result.landing_cents, landing_midi=result.landing_midi, offset_sec=result.offset_sec,
        octave_shift=result.octave_shift, summary=result.summary, notes=[asdict(n) for n in result.notes],
        trace=[TracePointDto(t=t, midi=m) for t, m in result.trace],
    )


@router.post("/grade/rhythm", response_model=RhythmGradeResponse,
             summary="Mark a clapped (or tapped) take against a rhythm, clap by clap")
async def grade_rhythm(audio: UploadFile = File(...), target: str = Form(...)) -> RhythmGradeResponse:
    spec = _parse(RhythmTargetDto, target)
    if not spec.beats:
        raise HTTPException(422, "The rhythm has no claps.")
    if len(spec.beats) > RHYTHM_MAX_CLAPS or not all(math.isfinite(b) and 0 <= b <= 256 for b in spec.beats):
        raise HTTPException(422, f"A rhythm has at most {RHYTHM_MAX_CLAPS} claps, each at a beat from 0 to 256.")
    _check_timing(spec.tempo_bpm, spec.lead_in_sec, spec.max_sec)
    path = await _save(audio)
    try:
        result = await run_in_threadpool(_rhythm_file, path, spec)
    finally:
        path.unlink(missing_ok=True)
    return RhythmGradeResponse(
        score=result.score, hits=result.hits, near=result.near, missed=result.missed, extra=result.extra,
        offset_sec=result.offset_sec, tempo_ratio=result.tempo_ratio, summary=result.summary,
        claps=[asdict(c) for c in result.claps],
    )


# ── Helpers ──────────────────────────────────────────────────────────────────


def _parse(model, text: str):
    try:
        return model.model_validate_json(text)
    except Exception as ex:  # noqa: BLE001 - any parse failure is a client input error
        logger.info("Practice target refused: %s", type(ex).__name__)
        raise HTTPException(422, "The target could not be read.")


def _check_timing(tempo_bpm: float, lead_in_sec: float, max_sec: float | None) -> None:
    if not (math.isfinite(tempo_bpm) and 20 <= tempo_bpm <= 300):
        raise HTTPException(422, "tempoBpm must be between 20 and 300.")
    if not (math.isfinite(lead_in_sec) and 0 <= lead_in_sec <= GRADE_MAX_LEAD_IN_SECONDS):
        raise HTTPException(422, f"leadInSec must be between 0 and {GRADE_MAX_LEAD_IN_SECONDS:g}.")
    if max_sec is not None and not (math.isfinite(max_sec) and 1 <= max_sec <= PATTERN_MAX_SECONDS):
        raise HTTPException(422, f"maxSec must be between 1 and {PATTERN_MAX_SECONDS:g}.")


async def _save(audio: UploadFile) -> Path:
    """The upload on disk (refused past ``max_upload_bytes`` before the rest is read)."""
    suffix = Path(audio.filename or "take.wav").suffix.lower()
    if suffix not in ACCEPTED_SUFFIXES:
        raise HTTPException(415, f"Unsupported audio format '{suffix}'.")
    with tempfile.NamedTemporaryFile(prefix=TEMP_PREFIX, suffix=suffix, delete=False) as tmp:
        path = Path(tmp.name)
        written = 0
        while chunk := await audio.read(1024 * 1024):
            written += len(chunk)
            if written > settings.max_upload_bytes:
                tmp.close()
                path.unlink(missing_ok=True)
                raise HTTPException(413, "Upload exceeds the maximum allowed size.")
            tmp.write(chunk)
    if written == 0:
        path.unlink(missing_ok=True)
        raise HTTPException(422, "Empty audio upload.")
    return path


def _load(path: Path, cap: float):
    """At most ``cap`` seconds of the take at the pyin rate: (samples, rate)."""
    from app.pipeline import vocal
    from app.pipeline.transcriber import _ensure_wav_path

    wav, converted = path, False
    try:
        try:
            wav, converted = _ensure_wav_path(path, max_seconds=cap)
            return librosa.load(str(wav), sr=vocal.SAMPLE_RATE, mono=True, duration=cap)
        except Exception as ex:  # noqa: BLE001 - an undecodable take is a client input error
            logger.info("Practice take unreadable: %s", type(ex).__name__)
            raise HTTPException(422, "The take could not be read. Record it again and resend it.")
    finally:
        if converted:
            wav.unlink(missing_ok=True)


def _range_file(path: Path):
    from app.pipeline import voice_range

    y, sr = _load(path, RANGE_MAX_SECONDS)
    reading = voice_range.read_range(y, sr)
    logger.info("voice_range holds=%d seconds=%.1f", len(reading.holds), reading.seconds_heard)
    return reading


def _run_file(path: Path, spec: GradeTargetDto):
    from app.pipeline import runs
    from app.pipeline.grade import TargetNote

    y, sr = _load(path, spec.max_sec or min(PATTERN_MAX_SECONDS, GRADE_MAX_SECONDS))
    return runs.grade_run(y, sr, [TargetNote(n.pitch_midi, n.start_beat, n.dur_beats) for n in spec.notes],
                          spec.tempo_bpm, spec.lead_in_sec)


def _rhythm_file(path: Path, spec: RhythmTargetDto):
    from app.pipeline import onsets

    y, sr = _load(path, spec.max_sec or PATTERN_MAX_SECONDS)
    return onsets.grade_rhythm(y, sr, spec.beats, spec.tempo_bpm, spec.lead_in_sec)
