"""Sing-along grading: how close a sung take came to a part.

The chorister hears a bar of their starting note, a bar of clicks, and then sings
the part while the phone records.  This module tracks the pitch of the take with the
same pyin front end the melody engine uses, lines it up with the part (a residual
time offset and an octave — a bass singing the tune sings it down an octave, and
that is not a mistake), and then judges every note by the median pitch sung while
it was due: in tune, nearly, wrong, or not sung at all.

Pure numpy on top of :mod:`app.pipeline.vocal`; nothing here touches the queue.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.pipeline import vocal

#: Residual alignment search, either side of where the count-in says the part starts.
OFFSET_SEARCH_SEC = 1.5
OFFSET_STEP_SEC = 0.02
#: A frame "matches" when the sung pitch class is within this of the part's.
MATCH_SEMITONES = 1.0
#: Fewer matched frames than this fraction of the voiced ones means the search found
#: nothing to trust, and the count-in's timing is kept.
MIN_MATCH_FRACTION = 0.10
#: The slice of each note that is judged: skip the attack, stop before the release.
NOTE_SKIP_HEAD = 0.15
NOTE_SKIP_TAIL = 0.10
#: Below this fraction of voiced frames inside a note, it was not sung.
MIN_VOICED_FRACTION = 0.25
HIT_CENTS = 35.0
NEAR_CENTS = 80.0


@dataclass(frozen=True)
class TargetNote:
    pitch_midi: int
    start_beat: float
    dur_beats: float
    #: How far the note is meant to sit off ``pitch_midi``: a maqam's quarter tone is -50. Marked against that pitch.
    cents: float = 0.0

    @property
    def pitch(self) -> float:
        return self.pitch_midi + self.cents / 100.0


@dataclass(frozen=True)
class NoteGrade:
    index: int
    target_midi: int
    sung_midi: float | None  # median sung pitch, octave-normalised; None when missed
    cents: float | None  # sung minus target
    status: str  # "hit" | "near" | "wrong" | "missed"


@dataclass(frozen=True)
class Grade:
    score: int  # 0–100
    hits: int
    near: int
    wrong: int
    missed: int
    tuning_cents: float  # the take's overall lean: positive is sharp
    offset_sec: float  # how late the singer came in relative to the count-in
    octave_shift: int  # semitones the take sits above the part (±12, 0 ...)
    summary: str
    notes: list[NoteGrade]


def _target_track(times: np.ndarray, targets: list[TargetNote], beat_sec: float, lead_in: float) -> np.ndarray:
    """The part's pitch at each frame time, NaN in rests."""
    out = np.full(times.shape, np.nan)
    for t in targets:
        s = lead_in + t.start_beat * beat_sec
        e = s + max(t.dur_beats, 0.0) * beat_sec
        out[(times >= s) & (times < e)] = t.pitch
    return out


def _pc_distance(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    d = np.mod(a - b + 6.0, 12.0) - 6.0
    return np.abs(d)


def align(contour: vocal.Contour, targets: list[TargetNote], beat_sec: float, lead_in: float,
          search_sec: float = OFFSET_SEARCH_SEC) -> tuple[float, int]:
    """(offset seconds, octave shift semitones) that best lines the take up with the part, searching
    ``search_sec`` either side of the count-in's timing."""
    sung = contour.midi
    voiced = ~np.isnan(sung)
    if voiced.sum() == 0:
        return 0.0, 0
    best_offset, best_count = 0.0, -1
    for offset in np.arange(-search_sec, search_sec + 1e-9, OFFSET_STEP_SEC):
        target = _target_track(contour.times - offset, targets, beat_sec, lead_in)
        both = voiced & ~np.isnan(target)
        count = int(np.sum(_pc_distance(sung[both], target[both]) < MATCH_SEMITONES))
        if count > best_count:
            best_offset, best_count = float(offset), count
    if best_count < MIN_MATCH_FRACTION * voiced.sum():
        best_offset = 0.0
    target = _target_track(contour.times - best_offset, targets, beat_sec, lead_in)
    both = voiced & ~np.isnan(target)
    matched = both & (_pc_distance(sung, np.nan_to_num(target)) < MATCH_SEMITONES)
    if matched.sum() == 0:
        return best_offset, 0
    octave = int(round(float(np.median(sung[matched] - target[matched])) / 12.0)) * 12
    return best_offset, octave


def grade(y: np.ndarray, sr: int, targets: list[TargetNote], tempo_bpm: float, lead_in_sec: float = 0.0,
          offset_search_sec: float = OFFSET_SEARCH_SEC) -> Grade:
    """Judge a take against a part. ``targets`` is in beats; ``lead_in_sec`` is the count-in.
    ``offset_search_sec`` narrows the alignment for a take with reference tones played between its notes
    (pitch match), which a wide search could line up with the notes instead of the singer."""
    targets = [t for t in targets if t.dur_beats > 0]
    if not targets:
        return Grade(0, 0, 0, 0, 0, 0.0, 0.0, 0, "There is nothing to sing.", [])
    beat_sec = 60.0 / max(float(tempo_bpm), 30.0)
    y = vocal.condition(y, sr)
    contour = vocal.smooth(vocal.track(y, sr))
    offset, octave = align(contour, targets, beat_sec, lead_in_sec, offset_search_sec)

    times = contour.times - offset
    sung = contour.midi - octave
    notes: list[NoteGrade] = []
    residuals: list[float] = []
    for i, t in enumerate(targets):
        s = lead_in_sec + t.start_beat * beat_sec
        e = s + t.dur_beats * beat_sec
        length = e - s
        a, b = s + NOTE_SKIP_HEAD * length, e - NOTE_SKIP_TAIL * length
        inside = (times >= a) & (times < b)
        if inside.sum() == 0:
            inside = (times >= s) & (times < e)
        voiced = inside & ~np.isnan(sung)
        if inside.sum() == 0 or voiced.sum() < MIN_VOICED_FRACTION * inside.sum():
            notes.append(NoteGrade(i, t.pitch_midi, None, None, "missed"))
            continue
        median = float(np.median(sung[voiced]))
        cents = (median - t.pitch) * 100.0
        status = "hit" if abs(cents) <= HIT_CENTS else "near" if abs(cents) <= NEAR_CENTS else "wrong"
        if status != "wrong":
            residuals.append(cents)
        notes.append(NoteGrade(i, t.pitch_midi, round(median, 2), round(cents, 1), status))

    hits = sum(n.status == "hit" for n in notes)
    near = sum(n.status == "near" for n in notes)
    wrong = sum(n.status == "wrong" for n in notes)
    missed = sum(n.status == "missed" for n in notes)
    score = int(round(100.0 * (hits + 0.5 * near) / len(notes)))
    tuning = float(np.median(residuals)) if residuals else 0.0
    return Grade(score, hits, near, wrong, missed, round(tuning, 1), round(offset, 3), octave,
                 _summary(len(notes), hits, near, wrong, missed, tuning), notes)


def _summary(total: int, hits: int, near: int, wrong: int, missed: int, tuning: float) -> str:
    if missed == total:
        return "Nothing was heard. Sing closer to the microphone and try again."
    parts = [f"{hits + near} of {total} notes in tune" if near == 0 else f"{hits} of {total} notes spot on, {near} close"]
    if wrong:
        parts.append(f"{wrong} on the wrong note")
    if missed:
        parts.append(f"{missed} not sung")
    lean = ""
    if tuning >= 20:
        lean = " You lean sharp — ease the pitch down a touch."
    elif tuning <= -20:
        lean = " You lean flat — think of the note a little higher."
    return ", ".join(parts) + "." + lean
