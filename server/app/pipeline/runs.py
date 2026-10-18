"""Full-speed runs: did the voice go through the run's notes, in order, and land on its last one?

A run at full speed has notes of a quarter of a second or less: too few pitch frames to judge each one's tuning
the way :mod:`app.pipeline.grade` judges a held note (practice keeps every note it marks one by one at 0.3 s or
more). So a run is marked on its shape. The take is tracked with the grader's pyin front end and lined up with the
run as the grader lines up a part (a residual offset, and an octave); then the frames from the run's first note to
its landing note are aligned to the notes in order by dynamic time warping, each note getting a stretch of frames.
A note was *followed* when the voice spent long enough within ``FOLLOW_SEMITONES`` of it inside its stretch; the
landing note — held, the one the ear remembers — is judged exactly as the grader judges a note (median pitch,
cents, in tune / close / wrong / not sung).

Score: ``FOLLOW_WEIGHT`` of it is the share of the run's notes followed, the rest the landing (in tune counts in
full, close half). No per-note cents: at this speed they would be guesses.

Pure numpy on top of ``vocal`` and ``grade``; nothing touches the queue.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.pipeline import grade as grading
from app.pipeline import vocal
from app.pipeline.grade import TargetNote

#: A frame is on a note when it is within this of it (after the octave and offset are taken out).
FOLLOW_SEMITONES = 0.5
#: A note was followed when at least this share of its due length (and at least ``FOLLOW_MIN_FRAMES``) was on it.
FOLLOW_SHARE = 0.25
FOLLOW_MIN_FRAMES = 2
#: Frame cost in the warping: distance to the note, capped; an unvoiced frame costs this much too.
COST_CAP_SEMITONES = 3.0
#: The window warped: from a little before the run's first note to a little into the landing note.
WINDOW_BEFORE_SEC = 0.2
WINDOW_INTO_LANDING_SEC = 0.35
#: The score's share that is the run followed; the rest is the landing note.
FOLLOW_WEIGHT = 0.6
#: The most points of the take's pitch line returned for drawing.
TRACE_POINTS = 160


@dataclass(frozen=True)
class RunNote:
    index: int
    target_midi: int
    followed: bool
    status: str  # "hit" (followed) | "wrong" (sung, not this note) | "missed" (nothing sung while it was due)


@dataclass(frozen=True)
class RunGrade:
    score: int  # 0–100
    followed: int  # run notes followed (the landing note not counted)
    run_notes: int
    landing_status: str  # "hit" | "near" | "wrong" | "missed"
    landing_cents: float | None
    landing_midi: int
    offset_sec: float
    octave_shift: int
    summary: str
    notes: list[RunNote]
    trace: list[tuple[float, float]]  # (seconds from beat one, octave-normalised MIDI), for drawing over the pattern


def _judge(times: np.ndarray, sung: np.ndarray, start: float, end: float, target: int) -> tuple[str, float | None]:
    """A held note judged as :func:`app.pipeline.grade.grade` judges one: (status, cents)."""
    length = end - start
    inside = (times >= start + grading.NOTE_SKIP_HEAD * length) & (times < end - grading.NOTE_SKIP_TAIL * length)
    if inside.sum() == 0:
        inside = (times >= start) & (times < end)
    voiced = inside & ~np.isnan(sung)
    if inside.sum() == 0 or voiced.sum() < grading.MIN_VOICED_FRACTION * inside.sum():
        return "missed", None
    cents = (float(np.median(sung[voiced])) - target) * 100.0
    status = "hit" if abs(cents) <= grading.HIT_CENTS else "near" if abs(cents) <= grading.NEAR_CENTS else "wrong"
    return status, round(cents, 1)


def _warp(sung: np.ndarray, pitches: list[int]) -> list[np.ndarray]:
    """Each note's frame indices (into ``sung``) when the frames are warped onto the notes in order."""
    n, k = sung.size, len(pitches)
    if n < k:
        return [np.arange(0) for _ in pitches]
    cost = np.minimum(np.abs(sung[:, None] - np.asarray(pitches, dtype=float)[None, :]), COST_CAP_SEMITONES)
    cost[np.isnan(sung)] = COST_CAP_SEMITONES
    total = np.full((n, k), np.inf)
    came_from_previous = np.zeros((n, k), dtype=bool)
    total[0, 0] = cost[0, 0]
    for i in range(1, n):
        stay = total[i - 1]
        advance = np.concatenate([[np.inf], total[i - 1, :-1]])
        came_from_previous[i] = advance < stay
        total[i] = np.minimum(stay, advance) + cost[i]
    # Back from the last frame on the last note.
    owner = np.empty(n, dtype=int)
    note = k - 1
    for i in range(n - 1, -1, -1):
        owner[i] = note
        if i > 0 and came_from_previous[i, note]:
            note -= 1
    return [np.flatnonzero(owner == j) for j in range(k)]


def grade_contour(contour: vocal.Contour, targets: list[TargetNote], tempo_bpm: float,
                  lead_in_sec: float = 0.0) -> RunGrade:
    """Judge a run (its last note the landing) on a tracked take."""
    targets = sorted((t for t in targets if t.dur_beats > 0), key=lambda t: t.start_beat)
    if len(targets) < 2:
        return RunGrade(0, 0, 0, "missed", None, targets[0].pitch_midi if targets else 0, 0.0, 0,
                        "There is no run to sing.", [], [])
    beat = 60.0 / max(float(tempo_bpm), 20.0)
    run, landing = targets[:-1], targets[-1]
    offset, octave = grading.align(contour, targets, beat, lead_in_sec)
    times = contour.times - offset
    sung = contour.midi - octave
    hop = float(contour.times[1] - contour.times[0]) if contour.times.size > 1 else vocal.HOP / vocal.SAMPLE_RATE

    land_start = lead_in_sec + landing.start_beat * beat
    land_end = land_start + landing.dur_beats * beat
    landing_status, landing_cents = _judge(times, sung, land_start, land_end, landing.pitch_midi)

    run_start = lead_in_sec + run[0].start_beat * beat
    window = (times >= run_start - WINDOW_BEFORE_SEC) & (times < land_start + min(WINDOW_INTO_LANDING_SEC, land_end - land_start))
    frames = np.flatnonzero(window)
    pitches = [t.pitch_midi for t in targets]
    owned = _warp(sung[frames], pitches) if frames.size else [np.arange(0) for _ in pitches]

    notes: list[RunNote] = []
    for i, t in enumerate(run):
        mine = sung[frames[owned[i]]] if owned[i].size else np.array([])
        due_frames = t.dur_beats * beat / hop
        need = max(FOLLOW_MIN_FRAMES, int(np.ceil(FOLLOW_SHARE * due_frames)))
        on = int(np.sum(np.abs(mine[~np.isnan(mine)] - t.pitch_midi) <= FOLLOW_SEMITONES)) if mine.size else 0
        # "missed": nothing voiced anywhere near when the note was due, not merely a short stretch.
        due_start = lead_in_sec + t.start_beat * beat
        near_due = (times >= due_start - 0.15) & (times < due_start + t.dur_beats * beat + 0.15)
        heard = bool(np.any(near_due & ~np.isnan(sung)))
        followed = on >= need
        notes.append(RunNote(i, t.pitch_midi, followed, "hit" if followed else "wrong" if heard else "missed"))

    followed = sum(n.followed for n in notes)
    landed = 1.0 if landing_status == "hit" else 0.5 if landing_status == "near" else 0.0
    score = int(round(100.0 * (FOLLOW_WEIGHT * followed / len(run) + (1.0 - FOLLOW_WEIGHT) * landed)))
    if all(n.status == "missed" for n in notes) and landing_status == "missed":
        score = 0
    return RunGrade(score, followed, len(run), landing_status, landing_cents, landing.pitch_midi, round(offset, 3), octave,
                    _summary(notes, landing_status, landing_cents), notes,
                    _trace(times, sung, run_start - WINDOW_BEFORE_SEC, land_end, lead_in_sec))


def grade_run(y: np.ndarray, sr: int, targets: list[TargetNote], tempo_bpm: float, lead_in_sec: float = 0.0) -> RunGrade:
    """Judge a sung run against its notes (in beats); ``lead_in_sec`` is the count-in before beat one."""
    y = vocal.condition(y, sr)
    return grade_contour(vocal.smooth(vocal.track(y, sr)), targets, tempo_bpm, lead_in_sec)


def _trace(times: np.ndarray, sung: np.ndarray, start: float, end: float, lead_in_sec: float) -> list[tuple[float, float]]:
    keep = np.flatnonzero((times >= start) & (times < end) & ~np.isnan(sung))
    if keep.size > TRACE_POINTS:
        keep = keep[np.linspace(0, keep.size - 1, TRACE_POINTS).round().astype(int)]
    return [(round(float(times[i] - lead_in_sec), 3), round(float(sung[i]), 2)) for i in keep]


def _summary(notes: list[RunNote], landing: str, cents: float | None) -> str:
    total = len(notes)
    if landing == "missed" and all(n.status == "missed" for n in notes):
        return "Nothing was heard. Sing closer to the microphone and try again."
    followed = sum(n.followed for n in notes)
    first = "You followed the run" if followed == total else f"You followed {followed} of the run's {total} notes"
    if landing == "hit":
        second = "and landed in tune."
    elif landing == "near":
        second = f"and landed a little {'sharp' if (cents or 0) > 0 else 'flat'}."
    elif landing == "wrong":
        second = "but landed on the wrong note."
    else:
        second = "but the last note wasn't held."
    tip = "" if followed == total else " Slow it down a step and find the notes you skipped."
    return f"{first} {second}{tip}"
