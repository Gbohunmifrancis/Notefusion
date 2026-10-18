"""Range finder: the lowest and highest notes a singer held comfortably in a take.

The singer slides to the edge of their voice and holds the last note that still feels easy. The take is
tracked with the grader's own pyin front end (:mod:`app.pipeline.vocal`), and every *hold* in it is found: a
stretch of voiced frames whose pitch, averaged over a vibrato period, stays inside a narrow band for at least
``HOLD_MIN_SEC``. A slide passes through its notes too quickly to make a hold, a wobble or a crack breaks one,
and a held note's pitch is the median sung over it. The lowest and the highest hold are the range's ends.

Measured, not scored: nothing here is a mark. Pure numpy on top of ``vocal``; nothing touches the queue.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.pipeline import vocal

#: The shortest stretch that counts as a held note. The apps ask for three seconds; a second of it steady is
#: enough to say the voice sat there (an attack, a breath or a dropout costs the rest).
HOLD_MIN_SEC = 1.0
#: The widest the vibrato-averaged pitch may wander inside a hold (top to bottom, in semitones): a held
#: note's slow sag fits, a slide does not.
HOLD_SPREAD_SEMITONES = 0.6
#: Averaged over about one vibrato cycle (5–6 Hz), so a singer's vibrato is not read as wandering.
VIBRATO_WINDOW_SEC = 0.2


@dataclass(frozen=True)
class Hold:
    midi: int  # the note held, to the nearest semitone (A4 = 440 Hz)
    pitch: float  # the median sung pitch, fractional MIDI
    start_sec: float
    seconds: float

    @property
    def cents(self) -> float:
        """How far the hold sat from its note: positive is sharp."""
        return round((self.pitch - self.midi) * 100.0, 1)


@dataclass(frozen=True)
class RangeReading:
    holds: list[Hold]  # in the order they were sung
    lowest: Hold | None
    highest: Hold | None
    seconds_heard: float


def _runs(voiced: np.ndarray) -> list[tuple[int, int]]:
    """(start, end) of each voiced run, end exclusive."""
    edges = np.diff(np.concatenate([[0], voiced.astype(np.int8), [0]]))
    return list(zip(np.flatnonzero(edges == 1).tolist(), np.flatnonzero(edges == -1).tolist()))


def _averaged(midi: np.ndarray, width: int) -> np.ndarray:
    """A moving average of a voiced run, the window shrinking at its ends."""
    if width <= 1 or midi.size <= 1:
        return midi.astype(float)
    kernel = np.ones(width)
    total = np.convolve(midi, kernel, mode="same")
    count = np.convolve(np.ones(midi.size), kernel, mode="same")
    return total / count


def holds_in(contour: vocal.Contour) -> list[Hold]:
    """Every hold in a contour, left to right, none overlapping."""
    hop = float(contour.times[1] - contour.times[0]) if contour.times.size > 1 else vocal.HOP / vocal.SAMPLE_RATE
    min_frames = int(np.ceil(HOLD_MIN_SEC / hop))
    width = max(1, int(round(VIBRATO_WINDOW_SEC / hop)) | 1)
    found: list[Hold] = []
    for a, b in _runs(~np.isnan(contour.midi)):
        if b - a < min_frames:
            continue
        raw = contour.midi[a:b]
        steady = _averaged(raw, width)
        s = 0
        while s <= steady.size - min_frames:
            spread = np.maximum.accumulate(steady[s:]) - np.minimum.accumulate(steady[s:])
            beyond = np.flatnonzero(spread > HOLD_SPREAD_SEMITONES)
            length = int(beyond[0]) if beyond.size else steady.size - s
            if length >= min_frames:
                pitch = float(np.median(raw[s:s + length]))
                found.append(Hold(int(round(pitch)), round(pitch, 2), round(float(contour.times[a + s]), 3),
                                  round(length * hop, 2)))
                s += length
            else:
                s += 1
    return found


def read_range(y: np.ndarray, sr: int) -> RangeReading:
    """The holds in a take and the lowest and highest of them (None when nothing was held)."""
    seconds = float(len(y)) / sr if sr else 0.0
    if seconds < HOLD_MIN_SEC or not np.any(np.abs(y) > 1e-4):
        return RangeReading([], None, None, round(seconds, 2))
    y = vocal.condition(y, sr)
    holds = holds_in(vocal.smooth(vocal.track(y, sr)))
    lowest = min(holds, key=lambda h: h.pitch) if holds else None
    highest = max(holds, key=lambda h: h.pitch) if holds else None
    return RangeReading(holds, lowest, highest, round(seconds, 2))
