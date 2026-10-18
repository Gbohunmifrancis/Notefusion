"""Clap it back: how closely a clapped (or tapped) take kept to a rhythm.

Claps have no pitch, so the pitch grader cannot hear them. This module finds each clap's onset — the sharp rise of a
broadband transient's loudness, read every few milliseconds after the hum and rumble under 150 Hz are filtered off —
and then lines the claps up with the pattern: a time offset (a phone's recording latency, a singer coming in a
touch late) and a tempo within ``TEMPO_RANGE`` of the one given (a rhythm clapped a little quick is still that
rhythm), chosen to put the most claps nearest their beats. Each of the pattern's claps is then in time (within
``IN_TIME_SEC``), close (within ``CLOSE_SEC``) or missed; a clap that matches none is extra and costs half a clap.

Pure numpy and scipy; nothing touches the queue.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

SAMPLE_RATE = 22_050
#: The envelope: 256-sample windows every 64 samples (2.9 ms).
FRAME = 256
HOP = 64
HIGHPASS_HZ = 150.0
#: A clap's loudness jumps this much (dB) within ``RISE_FRAMES`` of envelope...
RISE_DB = 12.0
RISE_FRAMES = 10
#: ...and peaks no more than this far under the loudest clap of the take.
FLOOR_DB = 30.0
#: One clap, one onset: a second rise this soon after is its echo.
MIN_GAP_SEC = 0.09
#: The verdicts' windows either side of the beat.
IN_TIME_SEC = 0.070
CLOSE_SEC = 0.140
#: The alignment's search: offsets (seconds, latency is usually late) and tempo ratios.
OFFSET_RANGE = (-0.35, 0.6)
OFFSET_STEP = 0.005
TEMPO_RANGE = (0.88, 1.12)
TEMPO_STEP = 0.01
#: Before the pattern's first clap, onsets are the count-in's clicks, not the singer: none counts before this much
#: of a beat (or ``CLOSE_SEC`` more than the earliest offset searched, whichever is less).
COUNT_IN_GUARD_BEATS = 0.75
#: After the last clap, an extra clap counts within this many beats.
TAIL_BEATS = 1.0


@dataclass(frozen=True)
class ClapMark:
    index: int
    beat: float  # where it is due, in beats from beat one
    error_ms: float | None  # heard minus due (after the alignment); None when missed
    status: str  # "hit" (in time) | "near" (close) | "missed"


@dataclass(frozen=True)
class RhythmGrade:
    score: int
    hits: int
    near: int
    missed: int
    extra: int
    offset_sec: float
    tempo_ratio: float  # the tempo clapped over the tempo given: above 1 is quicker
    summary: str
    claps: list[ClapMark]


def detect_onsets(y: np.ndarray, sr: int) -> np.ndarray:
    """Seconds at which a clap (a sharp, loud, broadband rise) starts."""
    from scipy import signal

    y = np.asarray(y, dtype=np.float64)
    if y.size < FRAME or not np.any(np.abs(y) > 1e-5):
        return np.zeros(0)
    sos = signal.butter(4, HIGHPASS_HZ / (0.5 * sr), btype="high", output="sos")
    y = signal.sosfilt(sos, y - float(np.mean(y)))
    frames = np.lib.stride_tricks.sliding_window_view(np.pad(y, (FRAME // 2, FRAME // 2)), FRAME)[::HOP]
    db = 20.0 * np.log10(np.sqrt(np.mean(frames ** 2, axis=1)) + 1e-9)
    top = float(np.max(db))
    # The quietest of the RISE_FRAMES before each frame.
    before = np.lib.stride_tricks.sliding_window_view(np.concatenate([np.full(RISE_FRAMES, db[0]), db]), RISE_FRAMES)
    rise = db - before[:db.size].min(axis=1)
    gap = max(1, int(round(MIN_GAP_SEC * sr / HOP)))
    onsets: list[float] = []
    last = -gap
    i = 0
    while i < db.size:
        if rise[i] >= RISE_DB and db[i] >= top - FLOOR_DB and i - last >= gap:
            # The onset is the steepest step of this rise, looked for back to where it began.
            start = max(1, i - RISE_FRAMES)
            peak = min(db.size, i + RISE_FRAMES)
            steps = np.diff(db[start - 1:peak])
            at = start + int(np.argmax(steps))
            onsets.append(at * HOP / sr)
            last = i
            i += gap
            continue
        i += 1
    return np.asarray(onsets)


def _nearest(heard: np.ndarray, due: np.ndarray) -> np.ndarray:
    """For each due time (any shape), the signed distance to the nearest heard onset."""
    idx = np.clip(np.searchsorted(heard, due), 1, heard.size - 1) if heard.size > 1 else np.zeros(due.shape, dtype=int)
    left = heard[idx - 1] if heard.size > 1 else heard[idx]
    right = heard[idx]
    return np.where(np.abs(due - left) <= np.abs(due - right), left - due, right - due)


def grade_onsets(heard: np.ndarray, beats: list[float], tempo_bpm: float, lead_in_sec: float = 0.0) -> RhythmGrade:
    """Judge the onsets heard (seconds into the take) against the pattern's claps (beats from beat one)."""
    if not beats:
        return RhythmGrade(0, 0, 0, 0, 0, 0.0, 1.0, "There is nothing to clap.", [])
    beat = 60.0 / max(float(tempo_bpm), 20.0)
    due_beats = np.asarray(sorted(beats), dtype=float)
    guard = min(COUNT_IN_GUARD_BEATS * beat, CLOSE_SEC - OFFSET_RANGE[0])
    heard = np.sort(np.asarray(heard, dtype=float))
    heard = heard[heard >= lead_in_sec + due_beats[0] * beat - guard]
    n = due_beats.size
    if heard.size == 0:
        claps = [ClapMark(i, float(b), None, "missed") for i, b in enumerate(due_beats)]
        return RhythmGrade(0, 0, 0, n, 0, 0.0, 1.0, _summary(0, 0, n, 0, 1.0), claps)

    offsets = np.arange(OFFSET_RANGE[0], OFFSET_RANGE[1] + 1e-9, OFFSET_STEP)
    ratios = np.arange(TEMPO_RANGE[0], TEMPO_RANGE[1] + 1e-9, TEMPO_STEP)
    # A tempo ratio r claps each beat r times as fast: due = lead-in + offset + (beat from the first clap) / r.
    rel = (due_beats - due_beats[0]) * beat
    due = (lead_in_sec + due_beats[0] * beat + offsets[:, None, None] + rel[None, None, :] / ratios[None, :, None])
    err = np.abs(_nearest(heard, due))
    # The most claps within reach of their beats, then the least total distance (the median's fit, so one clap off
    # the beat is not pulled in by moving all the others), then no shift and the tempo given.
    close = err <= CLOSE_SEC
    value = (close.sum(axis=2) - 0.1 * np.where(close, err, 0.0).sum(axis=2)
             - 1e-4 * np.abs(offsets)[:, None] - 1e-4 * np.abs(ratios - 1.0)[None, :])
    o, r = np.unravel_index(int(np.argmax(value)), value.shape)
    offset, ratio = float(offsets[o]), float(ratios[r])
    best_due = due[o, r]

    used: set[int] = set()
    claps: list[ClapMark] = []
    for i, t in enumerate(best_due):
        j = int(np.argmin(np.abs(heard - t)))
        e = float(heard[j] - t)
        if abs(e) <= CLOSE_SEC and j not in used:
            used.add(j)
            claps.append(ClapMark(i, float(due_beats[i]), round(e * 1000.0, 1), "hit" if abs(e) <= IN_TIME_SEC else "near"))
        else:
            claps.append(ClapMark(i, float(due_beats[i]), None, "missed"))
    window = (heard >= best_due[0] - min(0.5 * beat, guard)) & (heard <= best_due[-1] + TAIL_BEATS * beat)
    extra = int(sum(1 for j in np.flatnonzero(window) if int(j) not in used))
    hits = sum(c.status == "hit" for c in claps)
    near = sum(c.status == "near" for c in claps)
    missed = n - hits - near
    score = int(round(100.0 * max(0.0, hits + 0.5 * near - 0.5 * extra) / n))
    return RhythmGrade(score, hits, near, missed, extra, round(offset, 3), round(ratio, 2),
                       _summary(hits, near, missed, extra, ratio), claps)


def grade_rhythm(y: np.ndarray, sr: int, beats: list[float], tempo_bpm: float, lead_in_sec: float = 0.0) -> RhythmGrade:
    """Find the claps in a take and judge them against the pattern (each clap's beat from beat one)."""
    return grade_onsets(detect_onsets(y, sr), beats, tempo_bpm, lead_in_sec)


def _summary(hits: int, near: int, missed: int, extra: int, ratio: float) -> str:
    total = hits + near + missed
    if hits + near == 0:
        return "No claps were heard in time. Clap closer to the microphone and try again."
    parts = [f"{hits} of {total} claps in time" if near == 0 else f"{hits} of {total} claps in time, {near} close"]
    if missed:
        parts.append(f"{missed} missed")
    if extra:
        parts.append(f"{extra} extra" if extra > 1 else "1 extra")
    lean = ""
    if ratio >= 1.05:
        lean = " You sped up a little — keep the beat steady."
    elif ratio <= 0.95:
        lean = " You slowed down a little — keep the beat moving."
    return ", ".join(parts) + "." + lean
