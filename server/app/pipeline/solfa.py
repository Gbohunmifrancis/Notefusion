"""Movable-do solfa engine (TRD par. 4) - mirrors NoteFusion.Core/Solfa in the client.

Keep the two implementations in sync: same syllable tables, la-based minor,
reference-doh octave marks. The client re-derives solfa locally on key override,
so any divergence shows up as user-visible inconsistency.
"""

from collections.abc import Sequence
from typing import Literal

import numpy as np

ASCENDING_SYLLABLES = ["d", "de", "r", "re", "m", "f", "fe", "s", "se", "l", "le", "t"]
DESCENDING_SYLLABLES = ["d", "ra", "r", "ma", "m", "f", "sa", "s", "la", "l", "ta", "t"]

# Diatonic degree for each semitone above doh (ascending/sharp convention)
SEMITONE_TO_DEGREE = [1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 7]

# The name a tonic solfa hymn book gives each semitone above doh when the note does not move on
# by a semitone (a leap, a tone, the last note): de, ma, fe, se, ta.  True is the sharpened name;
# the diatonic entries are unobservable.  de over ra: the raised doh of V/ii and of a minor key's
# major tonic.  ma over re: the flattened me of a chord borrowed from the minor and of a blue note
# (a raised re leading to me rises a semitone and is named by that).  fe over sa: the raised fah
# of V/V and the melodic minor, the commonest accidental in hymns.  se over la: the leading note
# of a minor key (to lah) and of V/vi.  ta over le: the flat seventh of V/IV.  Each default is
# also the name that keeps a tone step a step: ma-f, ta-d', de-t, fe-m.
DEFAULT_SHARP = [True, True, True, False, True, True, True, True, True, True, False, True]

# Doh names spelled as the key signature spells them: each major key takes its spelling with
# fewer accidentals, so a Bb sheet (two flats) reads "Doh is Bb", never "A#" (ten sharps).
# F# and Gb tie at six; F# is kept.
DOH_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
ChromaticSpelling = Literal["direction", "ascending", "descending"]


def doh_pitch_class(tonic_pc: int, mode: str) -> int:
    """Doh for the key; la-based minor uses the relative major's tonic (TRD par. 4.1)."""
    return tonic_pc if mode == "major" else (tonic_pc + 3) % 12


def reference_doh(pitches: Sequence[int], doh_pc: int, mode: str) -> int:
    """The unmarked doh - the register every octave mark is measured from.

    As a tonic solfa hymn book sets it: the doh at or below the melody's middle (median) note,
    so a tune sitting between doh and soh prints with no marks (Holy, Holy, Holy: d d m m s s)
    and only what lies under its doh takes a comma (Amazing Grace: s, d m d m r d l, s,).  In a
    la-based minor key the middle note is first raised a minor third - lah's distance below doh -
    so a minor tune centred on its lah keeps that lah under an unmarked doh (l, t, d) instead of
    pushing the doh up an octave.  An empty list is read as a middle note of middle C.  Mirrors
    SolfaMapper.ReferenceDoh, solfa.ts and choir.js ``referenceDoh``.
    """
    middle = float(np.median(pitches)) if len(pitches) else 60.0
    if mode != "major":  # as doh_pitch_class: anything not major is la-based
        middle += 3
    ref = int(np.floor((middle - doh_pc) / 12.0)) * 12 + doh_pc
    while ref > 127:
        ref -= 12
    while ref < 0:
        ref += 12
    return ref


def ascending_flags(pitches: Sequence[int], doh_pc: int) -> list[bool]:
    """Which chromatic table each note is spelled from - the tonic solfa hymn-book rule.

    A chromatic note is named for where it goes, not where it came from: one that rises a
    semitone to the next note is a sharpened degree (de re fe se le - it leads up into that
    note); one that falls a semitone is a flattened degree (ra ma sa la ta).  Anything else -
    a tone, a leap, the last note - takes the name hymn books print for that pitch in the key
    (``DEFAULT_SHARP``: de ma fe se ta).  So "d de r" and "r ra d", but a lower neighbour
    "r de r" and an upper one "d ra d"; and "l, se, l," keeps the leading note in a la-based
    minor whichever side it is reached from.

    *pitches* must be in melodic (time) order.  This is a statement about a note's
    position in the tune, not about the note in isolation, so the caller owns the
    ordering - the worker's stream is already in offset order, but a stored note list
    read back out of a database is not necessarily.

    Equal neighbours are one run and share a flag, read from the next *differing* pitch: a
    chromatic sung twice must not be spelled ``ra`` then ``de``.

    Only the five chromatic semitones {1, 3, 6, 8, 10} can be affected - the two tables
    agree on all seven diatonic degrees, so a diatonic note's flag is unobservable.
    Mirrors SolfaMapper.AscendingFlags, solfa.ts and choir.js ``ascendingFlags``.
    """
    n = len(pitches)
    flags = [True] * n
    start = 0
    while start < n:
        end = start  # last index of the run of pitches equal to pitches[start]
        while end + 1 < n and pitches[end + 1] == pitches[start]:
            end += 1
        step = pitches[end + 1] - pitches[start] if end + 1 < n else 0
        if step == 1:
            flag = True
        elif step == -1:
            flag = False
        else:
            flag = DEFAULT_SHARP[(pitches[start] - doh_pc) % 12]
        for i in range(start, end + 1):
            flags[i] = flag
        start = end + 1
    return flags


def resolve_ascending(flag: bool, spelling: ChromaticSpelling = "direction") -> bool:
    """Resolve the hymn-book flag through the configured chromatic convention."""
    if spelling == "ascending":
        return True
    if spelling == "descending":
        return False
    return flag


def syllable(pitch_midi: int, doh_pc: int, ref_doh_midi: int, ascending: bool = True) -> tuple[str, str, int]:
    """Returns (syllable, octave_mark, degree). Octave marks: ' above, , below."""
    semitones = (pitch_midi - doh_pc) % 12
    table = ASCENDING_SYLLABLES if ascending else DESCENDING_SYLLABLES
    shift = int(np.floor((pitch_midi - ref_doh_midi) / 12.0))
    mark = "'" * shift if shift > 0 else "," * -shift
    return table[semitones], mark, SEMITONE_TO_DEGREE[semitones]


def doh_header(doh_pc: int) -> str:
    return f"Doh is {DOH_NAMES[doh_pc]}"
