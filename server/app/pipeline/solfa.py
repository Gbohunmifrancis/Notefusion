"""Movable-do solfa engine (TRD par. 4) - mirrors NoteFusion.Core/Solfa in the client.

Keep the two implementations in sync: same syllable tables, la-based minor,
reference-doh octave marks. The client re-derives solfa locally on key override,
so any divergence shows up as user-visible inconsistency.
"""

from collections.abc import Sequence

import numpy as np

ASCENDING_SYLLABLES = ["d", "de", "r", "re", "m", "f", "fe", "s", "se", "l", "le", "t"]
DESCENDING_SYLLABLES = ["d", "ra", "r", "ma", "m", "f", "sa", "s", "la", "l", "ta", "t"]

# Diatonic degree for each semitone above doh (ascending/sharp convention)
SEMITONE_TO_DEGREE = [1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 7]

PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def doh_pitch_class(tonic_pc: int, mode: str) -> int:
    """Doh for the key; la-based minor uses the relative major's tonic (TRD par. 4.1)."""
    return tonic_pc if mode == "major" else (tonic_pc + 3) % 12


def reference_doh(pitches: list[int], doh_pc: int) -> int:
    """The doh octave nearest the melody's median - the unmarked register."""
    median = float(np.median(pitches))
    return min((p for p in range(128) if p % 12 == doh_pc), key=lambda p: abs(p - median))


def ascending_flags(pitches: Sequence[int]) -> list[bool]:
    """Which chromatic table each note is spelled from, decided by melodic direction.

    A rising chromatic is a sharpened degree (de re fe se le); a falling one is a
    flattened degree (ra ma sa la ta).  Direction is taken from the pitch the melody
    arrived from; on the opening run, where there is nothing to arrive from, it is taken
    from the pitch the melody leaves for instead; a clip holding one single pitch is
    ascending by convention.

    *pitches* must be in melodic (time) order.  This is a statement about a note's
    position in the tune, not about the note in isolation, so the caller owns the
    ordering — the worker's stream is already in offset order, but a stored note list
    read back out of a database is not necessarily.

    Equal neighbours are one run and share a flag, which is why the previous *differing*
    pitch is what counts rather than the literal previous note: a chromatic sung twice
    must not be spelled ``ra`` then ``de``.

    Only the five chromatic semitones {1, 3, 6, 8, 10} can be affected — the two tables
    agree on all seven diatonic degrees, so a diatonic note's flag is unobservable.
    """
    n = len(pitches)
    flags = [True] * n
    start = 0
    while start < n:
        end = start  # last index of the run of pitches equal to pitches[start]
        while end + 1 < n and pitches[end + 1] == pitches[start]:
            end += 1
        if start > 0:
            # The previous run's pitch, which differs from this one by construction.
            flag = pitches[start - 1] < pitches[start]
        elif end + 1 < n:
            flag = pitches[end + 1] > pitches[start]
        else:
            flag = True
        for i in range(start, end + 1):
            flags[i] = flag
        start = end + 1
    return flags


def syllable(pitch_midi: int, doh_pc: int, ref_doh_midi: int, ascending: bool = True) -> tuple[str, str, int]:
    """Returns (syllable, octave_mark, degree). Octave marks: ' above, , below."""
    semitones = (pitch_midi - doh_pc) % 12
    table = ASCENDING_SYLLABLES if ascending else DESCENDING_SYLLABLES
    shift = int(np.floor((pitch_midi - ref_doh_midi) / 12.0))
    mark = "'" * shift if shift > 0 else "," * -shift
    return table[semitones], mark, SEMITONE_TO_DEGREE[semitones]


def doh_header(doh_pc: int) -> str:
    return f"Doh is {PITCH_NAMES[doh_pc]}"
