"""Four-part (SATB) harmonisation of a transcribed melody, hymn style.

The melody is the soprano, in a soprano's octave as a hymn book prints the tune: a man
sings it an octave lower and the transcription keeps what he sang, but the parts are
written against the tune moved by whole octaves to where a soprano sings it
(``soprano_octave_shift``), so alto, tenor and bass have their own ranges to sit in and
the solfa reads as the hymn book's.  Underneath it this module writes alto, tenor and bass in
the way a choir arranger does for a hymn or a worship song: one chord per beat drawn
from the key's own triads, chosen for how well it fits the tune and how naturally it
follows the chord before it, then voiced so each lower part is a line a singer wants —
mostly steps, an occasional passing note, not one note held for a verse — that keeps
the voices in range, in order, without parallel fifths or octaves, and with the chord
complete.  Deterministic and quick — tens of milliseconds for a verse — because the
whole point is a part sheet the moment the melody exists.  ``tests/accuracy/harmony_bench.py``
measures the parts against CCEH's own four-part hymn harmonisations.

Two passes:

1. **Chords.**  The tune is cut into beat-long slots.  Each slot may hold any diatonic
   triad (plus V7); the cost of a chord is how much of the slot's melody is NOT a chord
   tone (a short note between two chord tones is a passing note and costs less), and
   the cost of a chord *change* is read from a progression table of what hymns actually
   do (IV→V→I cheap, V→IV dear).  Phrase ends — a long note, or a note before a rest —
   want a cadence on I or V, and the last slot wants I.  Viterbi over the slots picks
   the cheapest chord sequence; runs of the same chord merge into one span.

2. **Voices.**  Every melody note (clipped to its chord span) is a sonority, and the lower
   three voices sing one note each under it, in the tune's rhythm.  A sonority's voicings
   are every in-range combination of chord tones that keeps bass ≤ tenor ≤ alto ≤ soprano
   and the usual spacing, scored for completeness (a missing third is wrong, a missing
   fifth tolerable), doubling (the root, then the fifth, never the leading note) and the
   bass's inversion (``_voicings``); off the beat of the bar, the alto or the tenor may
   instead take a scale note outside the chord, as a passing or neighbour note.  Viterbi
   over the sonorities (``_voice_lines``) then picks the whole line at once, each move
   scored by ``_transition``: a step is cheap and a leap dear, a voice sitting on its note
   while the tune moves on costs something (so the tenor has a shape), a passing note is
   reached and left by step, and parallel fifths and octaves, hidden ones on the outer
   voices, and overlap are penalised.

Everything that reaches the client is the same ``TranscribedNote`` shape as the melody,
so the solfa, the staff and the player handle a part exactly as they handle the tune.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from itertools import product

import numpy as np

from app.pipeline import solfa, solfa_render

# ── Chord vocabulary ──────────────────────────────────────────────────────────

_MAJ = (0, 4, 7)
_MIN = (0, 3, 7)
_DIM = (0, 3, 6)
_DOM7 = (0, 4, 7, 10)


@dataclass(frozen=True)
class Chord:
    name: str
    root: int  # semitones above the tonic
    intervals: tuple[int, ...]

    def pitch_classes(self, tonic_pc: int) -> tuple[int, ...]:
        return tuple((tonic_pc + self.root + i) % 12 for i in self.intervals)


MAJOR_CHORDS = (
    Chord("I", 0, _MAJ), Chord("ii", 2, _MIN), Chord("iii", 4, _MIN), Chord("IV", 5, _MAJ),
    Chord("V", 7, _MAJ), Chord("V7", 7, _DOM7), Chord("vi", 9, _MIN), Chord("vii°", 11, _DIM),
)
MINOR_CHORDS = (
    Chord("i", 0, _MIN), Chord("ii°", 2, _DIM), Chord("III", 3, _MAJ), Chord("iv", 5, _MIN),
    Chord("V", 7, _MAJ), Chord("V7", 7, _DOM7), Chord("VI", 8, _MAJ), Chord("VII", 10, _MAJ),
)

# Cost of moving from one chord to the next.  Unlisted pairs cost ``_WEAK``.
_WEAK = 1.0
_MAJOR_PROGRESSION: dict[str, dict[str, float]] = {
    "I":    {"I": 0.3, "ii": 0.25, "iii": 0.6, "IV": 0.1, "V": 0.1, "V7": 0.15, "vi": 0.3, "vii°": 0.8},
    "ii":   {"V": 0.0, "V7": 0.0, "vii°": 0.4, "ii": 0.4, "IV": 0.8, "I": 0.6, "vi": 0.8},
    "iii":  {"vi": 0.1, "IV": 0.2, "ii": 0.5, "I": 0.6, "iii": 0.4},
    "IV":   {"V": 0.0, "V7": 0.0, "I": 0.2, "ii": 0.2, "vii°": 0.5, "IV": 0.3, "vi": 0.6},
    "V":    {"I": 0.0, "vi": 0.2, "V": 0.3, "V7": 0.2, "IV": 0.9, "ii": 0.9, "iii": 0.8},
    "V7":   {"I": 0.0, "vi": 0.3, "V7": 0.3, "V": 0.4, "IV": 0.9, "ii": 0.9},
    "vi":   {"ii": 0.1, "IV": 0.1, "V": 0.3, "V7": 0.3, "I": 0.5, "iii": 0.6, "vi": 0.3},
    "vii°": {"I": 0.0, "iii": 0.4, "vii°": 0.5, "vi": 0.6},
}
_MINOR_PROGRESSION: dict[str, dict[str, float]] = {
    "i":    {"i": 0.3, "iv": 0.1, "V": 0.1, "V7": 0.15, "VI": 0.3, "ii°": 0.3, "III": 0.4, "VII": 0.4},
    "ii°":  {"V": 0.0, "V7": 0.0, "ii°": 0.4, "i": 0.6},
    "III":  {"VI": 0.1, "iv": 0.2, "VII": 0.3, "III": 0.4, "i": 0.5},
    "iv":   {"V": 0.0, "V7": 0.0, "i": 0.2, "ii°": 0.3, "iv": 0.3, "VI": 0.5, "VII": 0.5},
    "V":    {"i": 0.0, "VI": 0.2, "V": 0.3, "V7": 0.2, "iv": 0.9},
    "V7":   {"i": 0.0, "VI": 0.3, "V7": 0.3, "V": 0.4, "iv": 0.9},
    "VI":   {"ii°": 0.1, "iv": 0.1, "V": 0.3, "V7": 0.3, "III": 0.3, "i": 0.5, "VI": 0.3},
    "VII":  {"III": 0.0, "i": 0.3, "VI": 0.4, "VII": 0.4, "V": 0.6},
}
_TONIC = {"major": "I", "minor": "i"}
_MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
_MINOR_SCALE = (0, 2, 3, 5, 7, 8, 11)  # harmonic minor: the leading note the V chord has
_DOMINANTS = {"V", "V7"}

# ── Costs ─────────────────────────────────────────────────────────────────────

MELODY_FIT_WEIGHT = 3.0  # non-chord-tone duration, as a fraction of the slot
PASSING_TONE_RELIEF = 0.5  # a short non-chord note between chord tones costs this fraction
CHANGE_COST = 0.15  # a chord change inside a bar; favours holding a chord through a beat
CADENCE_PENALTY = 1.0  # a phrase ending on anything but I or V
FINAL_PENALTY = 2.5  # the last slot on anything but I
PHRASE_END_BEATS = 2.0  # a melody note at least this long ends a phrase

# Voice ranges (MIDI, inclusive) for a mixed choir.
SOPRANO_RANGE = (60, 76)  # C4 – E5: where a hymn book's tune sits; the tune is moved to its middle
BASS_RANGE = (40, 60)   # E2 – C4
TENOR_RANGE = (48, 67)  # C3 – G4
ALTO_RANGE = (53, 74)   # F3 – D5
MAX_UPPER_SPACING = 12  # soprano–alto and alto–tenor no wider than an octave
MAX_LOWER_SPACING = 24  # tenor–bass up to two octaves

PARALLEL_PENALTY = 3.0
MISSING_THIRD_PENALTY = 2.0
MISSING_FIFTH_PENALTY = 0.4
DOUBLED_LEADING_PENALTY = 1.5
DOUBLED_THIRD_PENALTY = 0.6
DOUBLED_FIFTH_PENALTY = 0.3
BASS_INVERSION_PENALTY = {0: 0.0, 1: 0.45, 2: 0.7}  # root / first / second inversion
BASS_MOVE_WEIGHT = 0.35
CADENCE_ROOT_WEIGHT = 6.0  # a cadence chord in inversion costs this much more than usual
INNER_STEP_COST = 0.25  # per semitone of an alto or tenor step (a tone costs 1.0)
INNER_SKIP_COST = 0.5  # per semitone past a tone, up to a fourth
INNER_LEAP_COST = 1.0  # per semitone past a fourth
REPEAT_SAME_CHORD = 1.3  # an inner voice repeating its note while the tune moves on the same chord
REPEAT_COMMON_TONE = 0.5  # an inner voice holding a common tone across a chord change
BASS_REPEAT_COST = 0.5  # the bass repeating its note into a new chord
BASS_REPEAT_SAME_CHORD = 0.6  # the bass repeating its note while the tune moves on the same chord
HIDDEN_PENALTY = 1.0  # similar motion into a fifth or octave on the outer voices, the soprano leaping
OVERLAP_PENALTY = 0.5  # a voice moving past where its neighbour just was
VOICING_BEAM = 40  # chord voicings per sonority the line search keeps
PASSING_BEAM = 24  # and voicings with a passing note
NCT_COST = 0.5  # an inner voice on a passing or neighbour note
NCT_RULE_PENALTY = 20.0  # a passing note reached or left by leap, or two in a row in one voice
NEIGHBOUR_COST = 0.5  # and more for a neighbour note (stepping back) than a passing one
_NCT_ALTO = 1
_NCT_TENOR = 2
_NCT_UP = 4  # the passing note is reached from below (from above without it)

PART_NAMES = ("soprano", "alto", "tenor", "bass")


# ── Types ─────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class MelodyNote:
    pitch: int
    start: float  # beats
    dur: float  # beats
    conf: float = 1.0


@dataclass
class Harmonisation:
    """Parts in the client's note shape, their solfa lines, and the four-part MusicXML."""

    parts: dict[str, list]  # part name -> list[TranscribedNote]
    solfa_lines: dict[str, list[str]]
    chords: list[tuple[float, float, str]]  # (start_beat, dur_beats, chord name)
    musicxml: str = ""
    extra: dict = field(default_factory=dict)


# ── 1. Chords ─────────────────────────────────────────────────────────────────


def _slots(melody: list[MelodyNote]) -> list[tuple[float, float]]:
    """Beat-long slots from 0 to the end of the tune."""
    end = max((n.start + n.dur) for n in melody)
    slots = []
    t = 0.0
    while t < end - 1e-9:
        slots.append((t, 1.0))
        t += 1.0
    return slots


def _notes_in(melody: list[MelodyNote], start: float, dur: float) -> list[tuple[MelodyNote, float, float]]:
    """(note, overlap start, overlap dur) for every melody note sounding in the slot."""
    out = []
    for n in melody:
        lo, hi = max(start, n.start), min(start + dur, n.start + n.dur)
        if hi - lo > 1e-6:
            out.append((n, lo, hi - lo))
    return out


def _fit_cost(chord_pcs: tuple[int, ...], notes: list[tuple[MelodyNote, float, float]], slot_dur: float) -> float:
    if not notes:
        return 0.0
    bad = 0.0
    for i, (n, _lo, overlap) in enumerate(notes):
        if n.pitch % 12 in chord_pcs:
            continue
        # A short note between two chord tones is a passing note.
        passing = (
            n.dur < 0.75
            and 0 < i < len(notes) - 1
            and notes[i - 1][0].pitch % 12 in chord_pcs
            and notes[i + 1][0].pitch % 12 in chord_pcs
        )
        bad += overlap * (PASSING_TONE_RELIEF if passing else 1.0)
    return bad / slot_dur


def choose_chords(
    melody: list[MelodyNote], tonic_pc: int, mode: str, beats_per_bar: float = 4.0
) -> list[tuple[float, float, Chord]]:
    """Viterbi over beat slots; returns merged ``(start, dur, chord)`` spans.

    A change on the first beat of a bar is free — that is where hymns change chord —
    and inside the bar it costs ``CHANGE_COST``, so a chord is held through a beat
    unless the tune asks for another.
    """
    chords = MAJOR_CHORDS if mode == "major" else MINOR_CHORDS
    table = _MAJOR_PROGRESSION if mode == "major" else _MINOR_PROGRESSION
    tonic = _TONIC["major" if mode == "major" else "minor"]
    slots = _slots(melody)
    n = len(slots)
    if n == 0:
        return []

    # Which slots end a phrase: a long note ends in them, or a rest follows.
    phrase_end = [False] * n
    sounding = [bool(_notes_in(melody, s, d)) for s, d in slots]
    for i, (s, d) in enumerate(slots):
        for note, _lo, _ov in _notes_in(melody, s, d):
            ends_here = s <= note.start + note.dur - 1e-6 <= s + d + 1e-6
            if ends_here and (note.dur >= PHRASE_END_BEATS or (i + 1 < n and not sounding[i + 1])):
                phrase_end[i] = True
    phrase_end[-1] = True

    big = float("inf")
    cost = [[big] * len(chords) for _ in range(n)]
    back = [[-1] * len(chords) for _ in range(n)]
    for i, (s, d) in enumerate(slots):
        notes = _notes_in(melody, s, d)
        for c, chord in enumerate(chords):
            local = MELODY_FIT_WEIGHT * _fit_cost(chord.pitch_classes(tonic_pc), notes, d)
            if not notes:
                local = 0.0  # a rest: keep whatever chord is cheapest to carry
            if phrase_end[i] and notes:
                if chord.name == tonic:
                    pass
                elif chord.name in _DOMINANTS:
                    local += 0.3
                else:
                    local += CADENCE_PENALTY
                if i == n - 1 and chord.name != tonic:
                    local += FINAL_PENALTY
            if i == 0:
                cost[i][c] = local + (0.0 if chord.name == tonic else 0.4)
                continue
            best, arg = big, -1
            bar_start = abs((s / beats_per_bar) - round(s / beats_per_bar)) < 1e-6
            change = 0.0 if bar_start else CHANGE_COST
            for p, prev in enumerate(chords):
                if cost[i - 1][p] >= big:
                    continue
                step = 0.0 if prev.name == chord.name else table.get(prev.name, {}).get(chord.name, _WEAK) + change
                total = cost[i - 1][p] + step
                if total < best:
                    best, arg = total, p
            cost[i][c] = best + local
            back[i][c] = arg

    # Trace back.
    c = min(range(len(chords)), key=lambda k: cost[n - 1][k])
    picked = [None] * n
    for i in range(n - 1, -1, -1):
        picked[i] = chords[c]
        c = back[i][c] if i > 0 else c

    spans: list[tuple[float, float, Chord]] = []
    for (s, d), chord in zip(slots, picked):
        if spans and spans[-1][2].name == chord.name and abs(spans[-1][0] + spans[-1][1] - s) < 1e-6:
            spans[-1] = (spans[-1][0], spans[-1][1] + d, chord)
        else:
            spans.append((s, d, chord))
    return spans


# ── 2. Voices ─────────────────────────────────────────────────────────────────


def soprano_octave_shift(pitches: list[int]) -> int:
    """Whole octaves (in semitones) that put a tune where a soprano sings it.

    The shift that brings the tune's middle (median) note nearest the middle of
    ``SOPRANO_RANGE`` (G#4), no shift on a tie: a man's tune (middle note under D4) goes up
    an octave, one whistled far above the staff comes down, and a tune a woman sang, even
    in a low key, stays where it is.
    """
    if not pitches:
        return 0
    ordered = sorted(pitches)
    n = len(ordered)
    middle = (ordered[(n - 1) // 2] + ordered[n // 2]) / 2.0
    target = (SOPRANO_RANGE[0] + SOPRANO_RANGE[1]) / 2.0
    return 12 * min(range(-4, 5), key=lambda k: (abs(middle + 12 * k - target), abs(k)))


def _candidates(pcs: tuple[int, ...], lo: int, hi: int) -> list[int]:
    return [p for p in range(lo, hi + 1) if p % 12 in pcs]


def _parallel(prev: tuple[int, int], cur: tuple[int, int]) -> bool:
    """Parallel fifths or octaves between one pair of voices across two chords."""
    a0, b0 = prev
    a1, b1 = cur
    if a0 == a1 or b0 == b1:
        return False
    if (a1 - a0) * (b1 - b0) <= 0:
        return False  # contrary or oblique motion
    before, after = (a0 - b0) % 12, (a1 - b1) % 12
    return before == after and after in (0, 7)


def _voicings(
    chord: Chord, tonic_pc: int, soprano: int, cadence: bool = False, passing: tuple[int, ...] = ()
) -> list[tuple[float, tuple[int, int, int], int]]:
    """Every (alto, tenor, bass) of ``chord`` under ``soprano`` that keeps the voices in range,
    in order and spaced, with what the chord alone makes of it: the bass's inversion (a
    cadence wants the root), a missing third or fifth, and doublings.  Cheapest first.

    ``passing`` are the scale's pitch classes outside the chord that the alto or the tenor
    (one of them) may sing here as a passing or neighbour note, for ``NCT_COST`` more and
    never a semitone from another voice; the third item says which voice does
    (``_NCT_ALTO`` / ``_NCT_TENOR``, 0 for a chord voicing), so ``_transition`` can hold it
    to a step on either side.
    """
    pcs = chord.pitch_classes(tonic_pc)
    root_pc = (tonic_pc + chord.root) % 12
    third_pc = pcs[1]
    fifth_pc = pcs[2]
    leading_pc = (tonic_pc + 11) % 12
    is_seventh = len(pcs) == 4
    inner = tuple(pcs) + tuple(passing)

    altos = [p for p in _candidates(inner, *ALTO_RANGE) if p <= soprano and soprano - p <= MAX_UPPER_SPACING]
    tenors = _candidates(inner, *TENOR_RANGE)
    basses = _candidates(pcs, *BASS_RANGE)
    out: list[tuple[float, tuple[int, int, int], int]] = []
    for a, t, b in product(altos, tenors, basses):
        if not (b <= t <= a):
            continue
        if a - t > MAX_UPPER_SPACING or t - b > MAX_LOWER_SPACING:
            continue
        mask = (_NCT_ALTO if a % 12 not in pcs else 0) | (_NCT_TENOR if t % 12 not in pcs else 0)
        if mask == _NCT_ALTO | _NCT_TENOR:
            continue
        score = 0.0
        if mask:
            x, others = (a, (soprano, t, b)) if mask == _NCT_ALTO else (t, (soprano, a, b))
            if any((x - o) % 12 in (1, 11) or x == o for o in others):
                continue  # a passing note a semitone from another voice, or doubling one
            score += NCT_COST
        inversion = 0 if b % 12 == root_pc else 1 if b % 12 == third_pc else 2
        if chord.intervals == _DIM:
            inversion = {1: 0, 0: 1, 2: 2}[inversion]  # a diminished triad sits best in first inversion
        score += BASS_INVERSION_PENALTY[inversion] * (CADENCE_ROOT_WEIGHT if cadence else 1.0)

        chord_tones = [soprano, b] + ([a] if not mask & _NCT_ALTO else []) + ([t] if not mask & _NCT_TENOR else [])
        present = {p % 12 for p in chord_tones}
        if third_pc not in present:
            score += MISSING_THIRD_PENALTY
        if fifth_pc not in present and not is_seventh:
            score += MISSING_FIFTH_PENALTY
        if is_seventh and pcs[3] not in present:
            score += 0.5
        counts: dict[int, int] = {}
        for p in chord_tones:
            counts[p % 12] = counts.get(p % 12, 0) + 1
        for pc, k in counts.items():
            if k < 2:
                continue
            if pc == leading_pc and chord.name in _DOMINANTS | {"vii°", "ii°"}:
                score += DOUBLED_LEADING_PENALTY * (k - 1)
            elif pc == third_pc:
                score += DOUBLED_THIRD_PENALTY * (k - 1)
            elif pc == fifth_pc:
                score += DOUBLED_FIFTH_PENALTY * (k - 1)
        out.append((score, (a, t, b), mask))
        if mask:
            out.append((score, (a, t, b), mask | _NCT_UP))  # the same note, reached from below
    out.sort(key=lambda x: (x[0], x[1], x[2]))
    return out


def _inner_step(d: int) -> float:
    """What an alto or tenor interval costs: a step is the line a singer wants, a third or
    fourth is fine, a leap past a fourth is rare and dearer the wider it is."""
    d = abs(d)
    if d <= 2:
        return INNER_STEP_COST * d
    if d <= 5:
        return INNER_STEP_COST * 2 + INNER_SKIP_COST * (d - 2)
    return INNER_STEP_COST * 2 + INNER_SKIP_COST * 3 + INNER_LEAP_COST * (d - 5)


def _bass_step(d: int) -> float:
    """A bass interval: steps, fourths, fifths and octaves are all the bass's own; a tritone
    or a seventh is not."""
    d = abs(d)
    if d in (6, 10, 11) or d > 12:
        return BASS_MOVE_WEIGHT * d / 2.0 + 1.0
    return BASS_MOVE_WEIGHT * min(d, 5) / 2.0


def _transition(
    prev: tuple[int, int, int, int],
    cur: tuple[int, int, int, int],
    same_chord: bool,
    prev_mask: int = 0,
    cur_mask: int = 0,
) -> float:
    """The cost of moving from one sonority (S, A, T, B) to the next: how each lower voice
    moves, a voice sitting on one note while the music moves past it, parallel fifths and
    octaves between any two voices, hidden ones on the outer voices, and overlap.  A passing
    or neighbour note (``prev_mask`` / ``cur_mask``) is reached and left by step, or not at all."""
    ps, pa, pt, pb = prev
    s, a, t, b = cur
    score = _inner_step(a - pa) + _inner_step(t - pt) + _bass_step(b - pb)
    for bit, d in ((_NCT_ALTO, a - pa), (_NCT_TENOR, t - pt)):
        if (prev_mask | cur_mask) & bit and not 1 <= abs(d) <= 2:
            score += NCT_RULE_PENALTY
        if prev_mask & cur_mask & bit:
            score += NCT_RULE_PENALTY
        if cur_mask & bit and (d > 0) != bool(cur_mask & _NCT_UP):
            score += NCT_RULE_PENALTY  # reached from the other side than this state says
        if prev_mask & bit and (d > 0) != bool(prev_mask & _NCT_UP):
            score += NEIGHBOUR_COST  # back where it came from: a neighbour note, not a passing one
    # Nothing moved in the tune and the chord is the same: the parts may simply repeat.
    still = same_chord and s == ps
    if not still:
        repeat = REPEAT_SAME_CHORD if same_chord else REPEAT_COMMON_TONE
        score += repeat * ((a == pa) + (t == pt)) + (BASS_REPEAT_SAME_CHORD if same_chord else BASS_REPEAT_COST) * (b == pb)
    for i in range(4):
        for j in range(i + 1, 4):
            if _parallel((prev[i], prev[j]), (cur[i], cur[j])):
                score += PARALLEL_PENALTY
    # Hidden fifths and octaves on the outer voices: similar motion into one with the soprano leaping.
    ds, db = s - ps, b - pb
    if ds * db > 0 and abs(ds) > 2 and (s - b) % 12 in (0, 7) and (ps - pb) % 12 != (s - b) % 12:
        score += HIDDEN_PENALTY
    # Overlap: a voice moving past where its neighbour just was.
    score += OVERLAP_PENALTY * ((a > ps) + (t > pa) + (b > pt) + (a < pt) + (t < pb))
    return score


def voice_span(
    chord: Chord,
    tonic_pc: int,
    soprano: int,
    prev: tuple[int, int, int, int] | None,
    cadence: bool = False,
    same_chord: bool = False,
) -> tuple[int, int, int]:
    """(alto, tenor, bass) for one chord under ``soprano``, given the previous (S, A, T, B).

    One sonority on its own, the cheapest by ``_voicings`` and ``_transition``;
    ``harmonise`` chooses the whole line at once (``_voice_lines``).  ``cadence`` is a
    phrase-ending chord, where the bass takes the root: a cadence in inversion is what
    makes a hymn sound unfinished.
    """
    options = _voicings(chord, tonic_pc, soprano, cadence)
    if not options:
        return _fallback(chord, tonic_pc, soprano)
    if prev is None:
        return options[0][1]
    return min(options, key=lambda o: (o[0] + _transition(prev, (soprano, *o[1]), same_chord), o[1]))[1]


def _fallback(chord: Chord, tonic_pc: int, soprano: int) -> tuple[int, int, int]:
    """Nothing fits the constraints (an unusually high or low melody): the nearest chord
    tones below the soprano without the spacing rules."""
    pcs = chord.pitch_classes(tonic_pc)
    root_pc = (tonic_pc + chord.root) % 12
    a = max([p for p in _candidates(pcs, 36, 96) if p <= soprano] or [soprano])
    t = max([p for p in _candidates(pcs, 36, 96) if p <= a - 3] or [a])
    b = max([p for p in _candidates((root_pc,), 28, 72) if p <= t] or [t])
    return a, t, b


@dataclass(frozen=True)
class _Sonority:
    start: float
    dur: float
    soprano: int
    chord: Chord
    cadence: bool
    passing: tuple[int, ...] = ()  # scale pitch classes an inner voice may pass through here


def _transition_matrix(
    ps: int, s: int, prev: np.ndarray, prev_mask: np.ndarray, cur: np.ndarray, cur_mask: np.ndarray, same_chord: bool
) -> np.ndarray:
    """``_transition`` from every previous voicing (rows of ``prev``, (alto, tenor, bass))
    to every current one at once: the same costs, as a (len(prev), len(cur)) array."""
    pa, pt, pb = (prev[:, k][:, None] for k in range(3))
    a, t, b = (cur[:, k][None, :] for k in range(3))
    pm, cm = prev_mask[:, None], cur_mask[None, :]

    def inner(d: np.ndarray) -> np.ndarray:
        d = np.abs(d)
        return np.where(
            d <= 2, INNER_STEP_COST * d,
            np.where(d <= 5, INNER_STEP_COST * 2 + INNER_SKIP_COST * (d - 2),
                     INNER_STEP_COST * 2 + INNER_SKIP_COST * 3 + INNER_LEAP_COST * (d - 5)))

    db_abs = np.abs(b - pb)
    awkward = np.isin(db_abs, (6, 10, 11)) | (db_abs > 12)
    bass = np.where(awkward, BASS_MOVE_WEIGHT * db_abs / 2.0 + 1.0, BASS_MOVE_WEIGHT * np.minimum(db_abs, 5) / 2.0)
    score = inner(a - pa) + inner(t - pt) + bass
    for bit, d in ((_NCT_ALTO, a - pa), (_NCT_TENOR, t - pt)):
        either = ((pm | cm) & bit) != 0
        step = (np.abs(d) >= 1) & (np.abs(d) <= 2)
        score = score + NCT_RULE_PENALTY * ((either & ~step).astype(float) + (((pm & cm) & bit) != 0))
        rising = d > 0
        score = score + NCT_RULE_PENALTY * (((cm & bit) != 0) & (rising != ((cm & _NCT_UP) != 0)))
        score = score + NEIGHBOUR_COST * (((pm & bit) != 0) & (rising != ((pm & _NCT_UP) != 0)))
    if not (same_chord and s == ps):
        repeat = REPEAT_SAME_CHORD if same_chord else REPEAT_COMMON_TONE
        bass_repeat = BASS_REPEAT_SAME_CHORD if same_chord else BASS_REPEAT_COST
        score = score + repeat * ((a == pa).astype(float) + (t == pt)) + bass_repeat * (b == pb)
    voices_prev = (np.full_like(pa, ps), pa, pt, pb)
    voices_cur = (np.full_like(a, s), a, t, b)
    for i in range(4):
        for j in range(i + 1, 4):
            a0, b0, a1, b1 = voices_prev[i], voices_prev[j], voices_cur[i], voices_cur[j]
            moving = (a0 != a1) & (b0 != b1) & ((a1 - a0) * (b1 - b0) > 0)
            before, after = (a0 - b0) % 12, (a1 - b1) % 12
            score = score + PARALLEL_PENALTY * (moving & (before == after) & ((after == 0) | (after == 7)))
    ds, db = s - ps, b - pb
    if abs(ds) > 2:
        outer = (s - b) % 12
        hidden = (ds * db > 0) & ((outer == 0) | (outer == 7)) & (((ps - pb) % 12) != outer)
        score = score + HIDDEN_PENALTY * hidden
    score = score + OVERLAP_PENALTY * (
        (a > ps).astype(float) + (t > pa) + (b > pt) + (a < pt) + (t < pb))
    return score


def _voice_lines(sonorities: list[_Sonority], tonic_pc: int) -> list[tuple[int, int, int]]:
    """(alto, tenor, bass) for every sonority, chosen together: Viterbi over each one's
    voicings (``_voicings``, the cheapest ``VOICING_BEAM`` kept) joined by ``_transition``,
    so a line is shaped by where it goes next as well as where it came from."""
    if not sonorities:
        return []
    layers: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []  # (local costs, voicings, masks)
    seen: dict[tuple, tuple[np.ndarray, np.ndarray, np.ndarray]] = {}  # a tune repeats its sonorities
    for son in sonorities:
        key = (son.chord, son.soprano, son.cadence, son.passing)
        if key not in seen:
            options = _voicings(son.chord, tonic_pc, son.soprano, son.cadence, son.passing)
            chosen = [o for o in options if not o[2]][:VOICING_BEAM] + [o for o in options if o[2]][:PASSING_BEAM]
            if not chosen:
                chosen = [(0.0, _fallback(son.chord, tonic_pc, son.soprano), 0)]
            seen[key] = (
                np.array([c for c, _v, _m in chosen], dtype=float),
                np.array([v for _c, v, _m in chosen], dtype=int).reshape(-1, 3),
                np.array([m for _c, _v, m in chosen], dtype=int),
            )
        layers.append(seen[key])
    cost = layers[0][0]
    back: list[np.ndarray] = []
    for i in range(1, len(sonorities)):
        prev_son, son = sonorities[i - 1], sonorities[i]
        _pl, pv, pm = layers[i - 1]
        local, v, m = layers[i]
        total = cost[:, None] + _transition_matrix(
            prev_son.soprano, son.soprano, pv, pm, v, m, prev_son.chord.name == son.chord.name)
        k = np.argmin(total, axis=0)
        cost = total[k, np.arange(len(k))] + local
        back.append(k)
    k = int(np.argmin(cost))
    out: list[tuple[int, int, int]] = [tuple(int(x) for x in layers[-1][1][k])]
    for i in range(len(sonorities) - 1, 0, -1):
        k = int(back[i - 1][k])
        out.append(tuple(int(x) for x in layers[i - 1][1][k]))
    return out[::-1]


# ── Assembly ──────────────────────────────────────────────────────────────────


def harmonise(
    melody_notes: list,
    tonic_pc: int,
    mode: str,
    doh_pc: int,
    ref_doh: int,
    time_signature: str = "4/4",
    tempo_bpm: int = 100,
    chromatic_spelling: str = "direction",
    divisions_per_beat: int = 2,
) -> Harmonisation | None:
    """SATB from a list of ``TranscribedNote``-shaped melody notes.  None for an empty tune.

    The soprano is the tune moved into a soprano's octave (``soprano_octave_shift``), and
    every part is marked from the soprano's doh: ``ref_doh`` (the tune's) moved the same
    whole octaves, so the soprano's solfa reads exactly as the tune's.
    """
    from app.pipeline.transcriber import TranscribedNote

    melody = [
        MelodyNote(int(n.pitch_midi), float(n.start_beat), float(n.dur_beats), float(getattr(n, "conf", 1.0)))
        for n in melody_notes
        if float(n.dur_beats) > 0
    ]
    if not melody:
        return None
    shift = soprano_octave_shift([n.pitch for n in melody])
    if shift:
        melody = [MelodyNote(n.pitch + shift, n.start, n.dur, n.conf) for n in melody]
        ref_doh += shift
    mode = "minor" if mode == "minor" else "major"
    beats_per_bar = solfa_render._beats_per_bar(time_signature)
    spans = choose_chords(melody, tonic_pc, mode, beats_per_bar)
    scale = tuple((tonic_pc + d) % 12 for d in (_MAJOR_SCALE if mode == "major" else _MINOR_SCALE))

    # Hymn parts are homorhythmic: every voice sings the tune's rhythm, so each melody note
    # (clipped to its chord span) is one sonority, and the lower voices get one note each.
    sonorities: list[_Sonority] = []
    tune_end = max(n.start + n.dur for n in melody)
    for start, dur, chord in spans:
        sounding = _notes_in(melody, start, dur)
        if not sounding:
            continue  # the choir rests with the tune
        # A phrase ends here when the tune does, or when a rest follows the span.
        span_end = start + dur
        cadence = span_end >= tune_end - 1e-6 or not _notes_in(melody, span_end, 1.0)
        pcs = chord.pitch_classes(tonic_pc)
        passing = tuple(pc for pc in scale if pc not in pcs)
        for n, lo, ov in sounding:
            # A passing note goes off the beat of the bar and away from a cadence.
            downbeat = abs(lo / beats_per_bar - round(lo / beats_per_bar)) < 1e-6
            sonorities.append(_Sonority(lo, ov, n.pitch, chord, cadence, () if downbeat or cadence else passing))
    # ...and between two notes it steps from and to, so never first, last, or beside a rest.
    for i, son in enumerate(sonorities):
        joined_before = i > 0 and abs(sonorities[i - 1].start + sonorities[i - 1].dur - son.start) < 1e-6
        joined_after = i + 1 < len(sonorities) and abs(son.start + son.dur - sonorities[i + 1].start) < 1e-6
        if son.passing and not (joined_before and joined_after):
            sonorities[i] = replace(son, passing=())
    lower: dict[str, list[tuple[int, float, float]]] = {"alto": [], "tenor": [], "bass": []}
    for son, (a, t, b) in zip(sonorities, _voice_lines(sonorities, tonic_pc)):
        lower["alto"].append((a, son.start, son.dur))
        lower["tenor"].append((t, son.start, son.dur))
        lower["bass"].append((b, son.start, son.dur))

    def to_notes(raw: list[tuple[int, float, float]], confs: list[float] | None = None) -> list[TranscribedNote]:
        ordered = sorted(raw, key=lambda x: x[1])
        flags = [solfa.resolve_ascending(f, chromatic_spelling) for f in solfa.ascending_flags([p for p, _s, _d in ordered], doh_pc)]
        out = []
        for i, (p, s, d) in enumerate(ordered):
            syl, mark, degree = solfa.syllable(p, doh_pc, ref_doh, flags[i])
            out.append(TranscribedNote(
                pitch_midi=p, start_beat=round(s, 4), dur_beats=round(d, 4), degree=degree,
                solfa=syl, octave_mark=mark, conf=round(confs[i], 3) if confs and i < len(confs) else 1.0,
            ))
        return out

    parts: dict[str, list[TranscribedNote]] = {
        "soprano": to_notes([(n.pitch, n.start, n.dur) for n in melody], [n.conf for n in melody]),
        "alto": to_notes(lower["alto"]),
        "tenor": to_notes(lower["tenor"]),
        "bass": to_notes(lower["bass"]),
    }
    header = solfa.doh_header(doh_pc)
    lines = {
        name: solfa_render.render_lines(notes, f"{header} · {name.capitalize()}", time_signature=time_signature,
                                        divisions_per_beat=divisions_per_beat)
        for name, notes in parts.items()
    }
    chords_out = [(s, d, c.name) for s, d, c in spans]
    result = Harmonisation(parts=parts, solfa_lines=lines, chords=chords_out, extra={"octave_shift": shift})
    try:
        result.musicxml = build_musicxml(parts, tonic_pc, mode, time_signature, tempo_bpm)
    except Exception as exc:  # noqa: BLE001 - the parts are still useful without the engraving
        print(f"[notefusion] four-part MusicXML skipped: {exc!r}", flush=True)
    return result


def build_musicxml(parts: dict[str, list], tonic_pc: int, mode: str, time_signature: str, tempo_bpm: int) -> str:
    """A four-part score: S and A in treble, T in treble-8vb, B in bass clef."""
    from music21 import clef, instrument, key as m21key, meter, note as m21note, stream, tempo as m21tempo

    from app.pipeline.transcriber import _key_from_identity, _respell_to_key, export_musicxml

    k = _key_from_identity(tonic_pc, mode)
    score = stream.Score()
    clefs = {
        "soprano": clef.TrebleClef(), "alto": clef.TrebleClef(),
        "tenor": clef.Treble8vbClef(), "bass": clef.BassClef(),
    }
    for name in PART_NAMES:
        part = stream.Part(id=name)
        part.partName = name.capitalize()
        inst = instrument.Vocalist()
        inst.partName = name.capitalize()
        part.insert(0, inst)
        part.insert(0, m21tempo.MetronomeMark(number=int(tempo_bpm)))
        part.insert(0, meter.TimeSignature(time_signature))
        part.insert(0, m21key.Key(k.tonic.name, k.mode))
        part.insert(0, clefs[name])
        for n in parts.get(name, []):
            note = m21note.Note(int(n.pitch_midi))
            note.duration.quarterLength = max(float(n.dur_beats), 0.25)
            part.insert(float(n.start_beat), note)
        _respell_to_key(part, k)
        measured = part.makeMeasures()
        measured.makeAccidentals(inPlace=True, alteredPitches=k.alteredPitches)
        measured.id = name
        measured.partName = name.capitalize()
        score.insert(0, measured)
    return export_musicxml(score)
