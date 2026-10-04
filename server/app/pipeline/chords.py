"""Chord reading: the chords a recording plays, one label per beat, merged into spans.

Two sources of evidence are read on the transcriber's own beat grid, so a chord's
``start_beat`` lines up with the melody's:

* **the audio** — a semitone spectrogram (constant-Q, tuning-corrected, median-filtered
  over time so drums do not smear it), each note's overtones taken off the notes above it,
  folded to twelve pitch classes, plus the lowest salient semitone below C4 as the bass;
* **the notes** Basic Pitch heard, when there are any — each note's amplitude times how
  long it sounds inside the beat, which is free of the overtones a spectrum folds onto
  the fifth and the third of every note; the lowest of them is the bass.

Every beat scores the 84 chords (twelve roots x maj, min, 7, maj7, min7, dim, sus4) and
"no chord" by cosine against a template, with a bonus when the bass is the root (a
smaller one when it is another chord tone). Viterbi then chooses the sequence: staying on
a chord is free and changing costs ``CHANGE_COST``, so one stray beat cannot flip a chord
that the beats around it hold; chords of the key cost nothing extra, a secondary dominant
a little, anything else more — strong evidence still wins.  Each span's seventh is then
settled over the whole span, from the notes struck at its start as well as what was held.

The key comes from the chord spans themselves (how much of the piece sits on chords of
the key, how long the tonic chord holds, whether the piece starts and ends on it) and from
the pitch-class histogram, and the chords are then read a second time with that key's
prior. Doh follows the solfa engine: the tonic for major, the relative major's for minor.

All of this works in *sounding* pitch. ``transpose`` moves the spans when the player's
keyboard was set to transpose, and ``label`` spells them in the written key: symbols use
the key's letters (flats in flat keys), a chromatic root is a flattened degree (ta, ma,
la, ra, sa) unless the chord is diminished, when it is the sharpened one below (fe, de,
re, se, le) — the leading-tone chord it almost always is.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from typing import Iterable, Sequence

import numpy as np

from app.pipeline import solfa

# ── Vocabulary ────────────────────────────────────────────────────────────────

QUALITIES: dict[str, tuple[int, ...]] = {
    "maj": (0, 4, 7),
    "min": (0, 3, 7),
    "7": (0, 4, 7, 10),
    "maj7": (0, 4, 7, 11),
    "min7": (0, 3, 7, 10),
    "dim": (0, 3, 6),
    "sus4": (0, 5, 7),
}
QUALITY_SUFFIX = {"maj": "", "min": "m", "7": "7", "maj7": "maj7", "min7": "m7", "dim": "dim", "sus4": "sus4"}
# MusicXML <kind> values for each quality.
QUALITY_KIND = {
    "maj": "major", "min": "minor", "7": "dominant", "maj7": "major-seventh",
    "min7": "minor-seventh", "dim": "diminished", "sus4": "suspended-fourth",
}
_STATES: list[tuple[int, str]] = [(root, q) for q in QUALITIES for root in range(12)]
_NO_CHORD = len(_STATES)

# A four-note chord holds a triad, so on a triad with one passing note it scores nearly
# as well as the triad does; this keeps the triad unless the seventh is really there.
SEVENTH_DISCOUNT = 0.94
# Cosine is in [0, 1]; this scales it to log-likelihood units, against which the costs
# below are set.
EVIDENCE_SCALE = 12.0
BASS_ROOT_BONUS = 1.6
BASS_TONE_BONUS = 0.6
CHANGE_COST = 3.0
# Key prior, in the same units: chords of the key are free, a secondary dominant (the
# major chord or dominant seventh a fifth above a diatonic chord) pays a little, and any
# other chord pays the full amount.
OUT_OF_KEY_COST = 1.4
SECONDARY_DOMINANT_COST = 0.5
# "No chord" for a beat this far below the loudest beats.
SILENCE_DB = -35.0
NO_CHORD_SCORE = 0.35

# A bass is written as a slash chord only when it stands apart from the chord: a left-hand
# note this many semitones below the next voice, or anything below C3.  A close-position
# inversion played by one hand (F A D for D minor) is still just "Dm".
SLASH_GAP_SEMITONES = 7
SLASH_BELOW_MIDI = 48

_HOP = 512
_MIDI_LO = 24  # C1
_N_SEMITONES = 72  # C1 .. B6


@dataclass(frozen=True)
class ChordSpan:
    """One chord over a run of beats, in pitch classes (no spelling yet)."""

    start_beat: float
    dur_beats: float
    root: int
    quality: str
    bass: int | None = None


@dataclass(frozen=True)
class Chord:
    """A chord as the wire carries it: ``bass`` only for a slash chord, root and bass as
    pitch classes, ``symbol`` spelled in the key and ``solfa`` the root's syllable."""

    start_beat: float
    dur_beats: float
    root: int
    quality: str
    bass: int | None
    symbol: str
    solfa: str


@dataclass
class BeatEvidence:
    """Per-beat evidence: ``chroma`` and ``bass`` are (beats, 12), each row summing to 1
    or all zero; ``separated`` says whether the beat's bass stands apart from the chord.
    ``struck`` is the notes *played* in the beat, each at its loudness however soon it
    faded (zero without notes): see ``_refine_seventh``."""

    chroma: np.ndarray
    bass: np.ndarray
    separated: np.ndarray
    silent: np.ndarray
    struck: np.ndarray


# ── Evidence ──────────────────────────────────────────────────────────────────


def _normalise_rows(m: np.ndarray) -> np.ndarray:
    total = m.sum(axis=1, keepdims=True)
    return np.divide(m, total, out=np.zeros_like(m), where=total > 1e-12)


def _semitone_spectrogram(y: np.ndarray, sr: int) -> np.ndarray:
    """(72 semitones from C1, frames) magnitude, tuning-corrected, drums filtered out."""
    import warnings

    import librosa
    from scipy.ndimage import median_filter

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        tuning = float(librosa.estimate_tuning(y=y, sr=sr))
        # Three bins a semitone, the middle one on the semitone: the outer two catch a
        # note that is a little sharp or flat of the tuning without smearing it.
        fmin = librosa.note_to_hz("C1") * 2.0 ** ((tuning - 1.0 / 3.0) / 12.0)
        c = np.abs(librosa.cqt(
            y, sr=sr, hop_length=_HOP, fmin=fmin, n_bins=_N_SEMITONES * 3, bins_per_octave=36))
    semis = c.reshape(_N_SEMITONES, 3, -1).max(axis=1)
    # A drum hit is a column a frame or two wide; a held note is a row.  A median along
    # time keeps the rows and drops the columns, the cheap half of a harmonic/percussive
    # split (librosa's full HPSS costs 13 s on a four-minute song, this a fraction of one).
    return median_filter(semis, size=(1, 9), mode="nearest")


# Overtones of a note that land on other semitones: 2nd, 3rd, 4th and 5th partials, and
# how much of the note's own level is taken off each as its overtone.
_PARTIALS = ((12, 0.6), (19, 0.4), (24, 0.3), (28, 0.2))


def _suppress_harmonics(s: np.ndarray) -> np.ndarray:
    """A semitone spectrum with each note's overtones taken off the notes above it.

    Folded to pitch classes, a lone A also scores E (its third partial) and C# (its fifth),
    which turns a D chord over an A bass into A sus4.  Working up from the lowest semitone,
    each note's estimated partials are subtracted from the semitones they fall on.
    """
    out = s.astype(float).copy()
    for m in range(len(out)):
        for step, share in _PARTIALS:
            if m + step < len(out):
                out[m + step] = max(0.0, out[m + step] - share * out[m])
    return out


def _beat_bounds(n_beats: int, bpm: float, beat_origin: float) -> np.ndarray:
    return beat_origin + np.arange(n_beats + 1) * 60.0 / bpm


def beat_evidence(
    y: np.ndarray, sr: int, bpm: float, beat_origin: float, notes: Sequence | None = None,
) -> BeatEvidence:
    """Evidence for every whole beat from ``beat_origin`` to the end of the audio.

    ``notes`` are objects with ``start``, ``end`` (seconds), ``pitch`` (MIDI) and ``amp``.
    """
    duration = len(y) / float(sr)
    n_beats = max(0, int(np.ceil((duration - beat_origin) * bpm / 60.0 - 0.25)))
    bounds = _beat_bounds(n_beats, bpm, beat_origin)
    empty = np.zeros((n_beats, 12))
    if n_beats == 0:
        return BeatEvidence(empty, empty.copy(), np.zeros(0, bool), np.zeros(0, bool), empty.copy())

    import librosa

    spec = _semitone_spectrogram(y, sr)
    frame_t = (np.arange(spec.shape[1]) * _HOP) / float(sr)
    rms = librosa.feature.rms(y=y, hop_length=_HOP)[0]
    frame_rms = rms[np.minimum(np.arange(spec.shape[1]), len(rms) - 1)]

    chroma = np.zeros((n_beats, 12))
    bass = np.zeros((n_beats, 12))
    separated = np.zeros(n_beats, bool)
    level = np.zeros(n_beats)
    pcs = (np.arange(_N_SEMITONES) + _MIDI_LO) % 12
    for b in range(n_beats):
        sel = (frame_t >= bounds[b]) & (frame_t < bounds[b + 1])
        if not sel.any():
            continue
        s = _suppress_harmonics(spec[:, sel].mean(axis=1))
        level[b] = float(frame_rms[sel].mean())
        # Log compression so a loud bass note does not drown the chord above it.
        comp = np.log1p(100.0 * s / (s.max() + 1e-12))
        upper = comp.copy()
        upper[:12] = 0.0  # C1..B1 is bass, not harmony
        np.add.at(chroma[b], pcs, upper)
        low = s[: 36]  # C1..B3
        # Salient against the whole spectrum as well as the low register, so a faint
        # rumble under a chord with no bass is not taken for one.
        salient = np.flatnonzero(low >= max(0.35 * low.max(), 0.2 * s.max()))
        if salient.size:
            lowest = int(salient[0])
            bass[b, (lowest + _MIDI_LO) % 12] = 1.0
            above = salient[salient >= lowest + 1]
            gap = int(above[0] - lowest) if above.size else 99
            separated[b] = lowest + _MIDI_LO < SLASH_BELOW_MIDI or gap >= SLASH_GAP_SEMITONES

    chroma = _normalise_rows(chroma ** 2)
    loud = np.percentile(level[level > 0], 90) if (level > 0).any() else 0.0
    silent = level < loud * 10.0 ** (SILENCE_DB / 20.0)

    struck = np.zeros((n_beats, 12))
    if notes:
        note_pc, note_bass, note_sep, heard, struck = _note_evidence(notes, bounds)
        both = heard[:, None]
        # Where the notes speak they are the cleaner evidence; the audio still counts, and
        # it alone speaks where Basic Pitch heard nothing.
        chroma = np.where(both, 0.4 * chroma + 0.6 * note_pc, chroma)
        bass = np.where(both, 0.3 * bass + 0.7 * note_bass, bass)
        separated = np.where(heard, note_sep, separated)
    chroma[silent] = 0.0
    bass[silent] = 0.0
    return BeatEvidence(chroma, bass, separated, silent, struck)


def _note_evidence(notes: Sequence, bounds: np.ndarray):
    n_beats = len(bounds) - 1
    pc = np.zeros((n_beats, 12))
    bass = np.zeros((n_beats, 12))
    separated = np.zeros(n_beats, bool)
    heard = np.zeros(n_beats, bool)
    beat_len = float(bounds[1] - bounds[0])
    struck = np.zeros((n_beats, 12))
    per_beat: list[list[tuple[int, float]]] = [[] for _ in range(n_beats)]
    for n in notes:
        first = max(0, int(np.searchsorted(bounds, n.start, side="right")) - 1)
        # A chord played a hair early belongs to the beat it anticipates.
        played = int(np.searchsorted(bounds, n.start + min(0.07, 0.2 * beat_len), side="right")) - 1
        if 0 <= played < n_beats:
            struck[played, n.pitch % 12] += float(n.amp)
        for b in range(first, n_beats):
            if bounds[b] >= n.end:
                break
            overlap = min(n.end, bounds[b + 1]) - max(n.start, bounds[b])
            if overlap <= 0.0:
                continue
            w = float(n.amp) * overlap
            pc[b, n.pitch % 12] += w
            if overlap >= 0.25 * beat_len:
                per_beat[b].append((int(n.pitch), w))
    for b, held in enumerate(per_beat):
        if not held:
            continue
        heard[b] = True
        pitches = sorted({p for p, _ in held})
        lowest = pitches[0]
        for p, w in held:
            # The lowest held note, and less so anything just above it.
            bass[b, p % 12] += w * np.exp(-(p - lowest) / 2.0)
        gap = pitches[1] - lowest if len(pitches) > 1 else 0
        separated[b] = len(pitches) > 1 and (lowest < SLASH_BELOW_MIDI or gap >= SLASH_GAP_SEMITONES)
    return _normalise_rows(pc), _normalise_rows(bass), separated, heard, struck


# ── Scoring and decoding ──────────────────────────────────────────────────────


def _templates() -> np.ndarray:
    t = np.zeros((len(_STATES), 12))
    for i, (root, quality) in enumerate(_STATES):
        for iv in QUALITIES[quality]:
            t[i, (root + iv) % 12] = 1.0
    return t / np.linalg.norm(t, axis=1, keepdims=True)


_TEMPLATES = _templates()
_DISCOUNT = np.array([SEVENTH_DISCOUNT if len(QUALITIES[q]) == 4 else 1.0 for _, q in _STATES])


def _bass_tones() -> np.ndarray:
    """Which pitch classes earn a chord the inversion bonus in the bass: its tones other
    than the root, except a sus4's fourth.  F G C over an F bass is F with an added
    ninth, the way a pianist plays it, not C sus4 over its fourth."""
    t = np.zeros((len(_STATES), 12))
    for i, (root, quality) in enumerate(_STATES):
        for iv in QUALITIES[quality]:
            if iv != 0 and not (quality == "sus4" and iv == 5):
                t[i, (root + iv) % 12] = 1.0
    return t


_BASS_TONES = _bass_tones()


def _emissions(ev: BeatEvidence) -> np.ndarray:
    """(beats, 85) log-scores: 84 chords then "no chord"."""
    n = ev.chroma.shape[0]
    norm = np.linalg.norm(ev.chroma, axis=1, keepdims=True)
    unit = np.divide(ev.chroma, norm, out=np.zeros_like(ev.chroma), where=norm > 1e-12)
    cos = (unit @ _TEMPLATES.T) * _DISCOUNT
    roots = np.array([r for r, _ in _STATES])
    bass_root = ev.bass[:, roots]
    bass_tone = ev.bass @ _BASS_TONES.T
    out = np.empty((n, len(_STATES) + 1))
    out[:, :_NO_CHORD] = EVIDENCE_SCALE * cos + BASS_ROOT_BONUS * bass_root + BASS_TONE_BONUS * bass_tone
    out[:, _NO_CHORD] = EVIDENCE_SCALE * NO_CHORD_SCORE
    out[ev.silent, :_NO_CHORD] = 0.0
    out[ev.silent, _NO_CHORD] = EVIDENCE_SCALE
    return out


def diatonic_chords(tonic: int, mode: str) -> set[tuple[int, str]]:
    """The chords that belong to a key, as (root pitch class, quality).

    Minor is natural minor plus the harmonic minor's dominant and leading-tone chord: E
    major and G# diminished are as much A minor as A minor is.
    """
    if mode == "major":
        table = {0: ("maj", "maj7", "sus4"), 2: ("min", "min7", "sus4"), 4: ("min", "min7"),
                 5: ("maj", "maj7"), 7: ("maj", "7", "sus4"), 9: ("min", "min7", "sus4"), 11: ("dim",)}
    else:
        table = {0: ("min", "min7", "sus4"), 2: ("dim",), 3: ("maj", "maj7"), 5: ("min", "min7", "sus4"),
                 7: ("min", "maj", "7", "sus4"), 8: ("maj", "maj7"), 10: ("maj", "7", "sus4"), 11: ("dim",)}
    return {((tonic + deg) % 12, q) for deg, qs in table.items() for q in qs}


def _key_prior(key: tuple[int, str] | None) -> np.ndarray:
    prior = np.zeros(len(_STATES) + 1)
    if key is None:
        return prior
    diatonic = diatonic_chords(*key)
    dominants = {((root + 7) % 12) for root, q in diatonic if q in ("maj", "min")}
    for i, state in enumerate(_STATES):
        if state in diatonic:
            continue
        root, quality = state
        if quality in ("maj", "7") and root in dominants:
            prior[i] = -SECONDARY_DOMINANT_COST
        else:
            prior[i] = -OUT_OF_KEY_COST
    return prior


def _viterbi(scores: np.ndarray) -> np.ndarray:
    n, k = scores.shape
    best = scores[0].copy()
    back = np.zeros((n, k), dtype=int)
    for t in range(1, n):
        leader = int(np.argmax(best))
        switch = best[leader] - CHANGE_COST
        stay = best >= switch
        back[t] = np.where(stay, np.arange(k), leader)
        best = np.where(stay, best, switch) + scores[t]
    path = np.empty(n, dtype=int)
    path[-1] = int(np.argmax(best))
    for t in range(n - 1, 0, -1):
        path[t - 1] = back[t, path[t]]
    return path


def _spans(path: np.ndarray, ev: BeatEvidence) -> list[ChordSpan]:
    spans: list[ChordSpan] = []
    start = 0
    for t in range(1, len(path) + 1):
        if t < len(path) and path[t] == path[start]:
            continue
        state = int(path[start])
        if state != _NO_CHORD:
            root, quality = _STATES[state]
            quality = _refine_seventh(root, quality, ev, start, t)
            spans.append(ChordSpan(float(start), float(t - start), root, quality,
                                   _slash_bass(root, quality, ev, start, t)))
        start = t
    return spans


# The qualities a span may move between once its root is settled: only the seventh is in
# question, never the third.
_SEVENTH_FAMILY = {"maj": ("maj", "7", "maj7"), "7": ("maj", "7", "maj7"), "maj7": ("maj", "7", "maj7"),
                   "min": ("min", "min7"), "min7": ("min", "min7")}


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-12 else v


def _refine_seventh(root: int, quality: str, ev: BeatEvidence, start: int, end: int) -> str:
    """Decide the seventh over the whole span, from what was held and what was struck.

    Per beat a seventh is easy to lose: a chord struck once and held fades, its top note
    soonest, and by the third beat the evidence is a triad that the switching cost then
    keeps for the whole span.  The notes struck at the chord's start still say what was
    played, so the span is judged on its held evidence and its struck notes together.
    """
    family = _SEVENTH_FAMILY.get(quality)
    if family is None:
        return quality
    struck = ev.struck[start:end].sum(axis=0)
    v = _unit(_unit(ev.chroma[start:end].sum(axis=0)) + _unit(struck))
    # Audio alone folds every note's overtones onto its fifth and third, which can pass for
    # a seventh; without struck notes to vouch for it the seventh keeps its discount.
    discount = _DISCOUNT if struck.sum() <= 0.0 else np.ones_like(_DISCOUNT)
    best, best_score = quality, -1.0
    for q in family:
        i = _STATES.index((root, q))
        score = float(_TEMPLATES[i] @ v) * discount[i]
        if score > best_score:
            best, best_score = q, score
    return best


def _slash_bass(root: int, quality: str, ev: BeatEvidence, start: int, end: int) -> int | None:
    """The bass pitch class when the span is an inversion over a bass that stands apart."""
    if ev.separated[start:end].mean() < 0.5:
        return None
    total = ev.bass[start:end].sum(axis=0)
    if total.sum() <= 0.0:
        return None
    pc = int(np.argmax(total))
    tones = {(root + iv) % 12 for iv in QUALITIES[quality]}
    if pc == root or pc not in tones or total[pc] < 0.4 * total.sum():
        return None
    return pc


def decode(ev: BeatEvidence, key: tuple[int, str] | None = None) -> list[ChordSpan]:
    """The chord spans for per-beat evidence, under an optional key prior."""
    if ev.chroma.shape[0] == 0:
        return []
    return _spans(_viterbi(_emissions(ev) + _key_prior(key)), ev)


# ── Key ───────────────────────────────────────────────────────────────────────

# Krumhansl-Kessler probe-tone profiles, tonic first.
_KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def key_scores(spans: Sequence[ChordSpan], histogram: np.ndarray | None = None) -> dict[tuple[int, str], float]:
    """How well each of the 24 keys explains the chord spans and a pitch-class histogram.

    Chords outweigh the histogram: a profile cannot tell F major from C major when the
    tune leans on C, but a piece that rests on F, starts on F and ends on F can.
    """
    total = sum(s.dur_beats for s in spans)
    scores: dict[tuple[int, str], float] = {}
    for tonic in range(12):
        for mode in ("major", "minor"):
            k = (tonic, mode)
            score = 0.0
            if total > 0:
                diatonic = diatonic_chords(tonic, mode)
                tonic_q = ("maj", "maj7", "sus4") if mode == "major" else ("min", "min7")
                is_tonic = [s.root == tonic and s.quality in tonic_q for s in spans]
                fit = sum(s.dur_beats for s in spans if (s.root, s.quality) in diatonic) / total
                rest = sum(s.dur_beats for s, t in zip(spans, is_tonic) if t) / total
                dominant = sum(s.dur_beats for s in spans
                               if s.root == (tonic + 7) % 12 and s.quality in ("maj", "7")) / total
                score += 3.0 * fit + 1.5 * rest + 0.4 * dominant
                score += 0.4 * is_tonic[0] + 0.8 * is_tonic[-1]
            if histogram is not None and histogram.sum() > 0:
                profile = np.roll(_KK_MAJOR if mode == "major" else _KK_MINOR, tonic)
                r = float(np.corrcoef(profile, histogram)[0, 1])
                score += 0.8 * (0.0 if np.isnan(r) else r)
            scores[k] = score
    return scores


# Tonic spellings with the fewest accidentals, in music21's form: a keyboard player reads
# Db major (five flats) and G# minor (five sharps), not C# major or Ab minor (seven each).
_MAJOR_TONIC = ["C", "D-", "D", "E-", "E", "F", "F#", "G", "A-", "A", "B-", "B"]
_MINOR_TONIC = ["C", "C#", "D", "E-", "E", "F", "F#", "G", "G#", "A", "B-", "B"]


def tonic_name(tonic: int, mode: str) -> str:
    return (_MAJOR_TONIC if mode == "major" else _MINOR_TONIC)[tonic % 12]


def estimate_key(spans: Sequence[ChordSpan], histogram: np.ndarray | None = None) -> tuple[tuple[int, str], float]:
    """(key, confidence): the best key and its lead over the best key with another doh.

    A relative major and minor share a doh and so every syllable; their margin is not
    what the confidence is about.
    """
    ranked = sorted(key_scores(spans, histogram).items(), key=lambda kv: kv[1], reverse=True)
    best, best_score = ranked[0]
    doh = solfa.doh_pitch_class(*best)
    rival = next((s for k, s in ranked[1:] if solfa.doh_pitch_class(*k) != doh), best_score)
    return best, float(max(0.0, min(1.0, (best_score - rival) / 1.5)))


# ── The whole read ────────────────────────────────────────────────────────────


def read_chords(
    y: np.ndarray, sr: int, bpm: float, beat_origin: float,
    notes: Sequence | None = None, key: tuple[int, str] | None = None,
) -> tuple[list[ChordSpan], tuple[int, str] | None, float]:
    """(spans, key, key confidence) for audio on a beat grid, in sounding pitch.

    With ``key`` the chords are read under that key and it comes back with confidence 1.
    Without, a first pass reads the chords with no prior, the key is estimated from them,
    and the chords are read again under it. The key is None when there is no chord at all.
    """
    ev = beat_evidence(y, sr, bpm, beat_origin, notes)
    if key is not None:
        return decode(ev, key), key, 1.0
    first = decode(ev)
    if not first:
        return [], None, 0.0
    histogram = ev.chroma.sum(axis=0)
    estimated, _ = estimate_key(first, histogram)
    spans = decode(ev, estimated)
    estimated, confidence = estimate_key(spans, histogram)
    return spans, estimated, confidence


def transpose(spans: Iterable[ChordSpan], semitones: int) -> list[ChordSpan]:
    return [
        replace(s, root=(s.root + semitones) % 12, bass=None if s.bass is None else (s.bass + semitones) % 12)
        for s in spans
    ]


# ── Spelling and solfa ────────────────────────────────────────────────────────

_LETTERS = "CDEFGAB"
_LETTER_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
# For each semitone above doh: the scale degree (0-6) whose letter names it, flat-side and
# sharp-side.  Diatonic semitones name the same degree both ways.
_FLAT_DEGREE = {0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 4, 8: 5, 9: 5, 10: 6, 11: 6}
_SHARP_DEGREE = {0: 0, 1: 0, 2: 1, 3: 1, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 5, 10: 5, 11: 6}
_PLAIN = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
_PLAIN_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _name(letter: str, pc: int) -> str | None:
    """``letter`` altered to sound as ``pc``, or None if that needs a double accidental."""
    alter = (pc - _LETTER_PC[letter] + 6) % 12 - 6
    if abs(alter) > 1:
        return None
    return letter + ("#" if alter == 1 else "b" if alter == -1 else "")


def spell_root(pc: int, doh: int, doh_name: str, sharp: bool) -> str:
    """Letter name for a root ``pc`` in the key whose doh is ``doh_name``.

    The letter is the scale degree's: diatonic roots take the key's own spelling (Bb in
    F major, F# in A major), a chromatic one the degree above lowered or, ``sharp``, the
    degree below raised.  A spelling that would need a double accidental falls back to
    the plain name, flats in a flat key.
    """
    semis = (pc - doh) % 12
    degree = (_SHARP_DEGREE if sharp else _FLAT_DEGREE)[semis]
    letter = _LETTERS[(_LETTERS.index(doh_name[0]) + degree) % 7]
    named = _name(letter, pc)
    if named is not None:
        return named
    flat_key = "b" in doh_name[1:] or doh_name == "F"
    return (_PLAIN if flat_key else _PLAIN_SHARP)[pc]


def _spell_tone(root_name: str, pc: int, interval: int) -> str:
    """A chord tone spelled from the root's letter: a third is two letters up, and so on."""
    steps = {3: 2, 4: 2, 5: 3, 6: 4, 7: 4, 10: 6, 11: 6}.get(interval)
    if steps is not None:
        named = _name(_LETTERS[(_LETTERS.index(root_name[0]) + steps) % 7], pc)
        if named is not None:
            return named
    return _PLAIN[pc] if "b" in root_name[1:] else _PLAIN_SHARP[pc]


def _key_pitch_class(tonic_name: str) -> int:
    """"Bb", "B-", "F#" -> pitch class."""
    tonic_name = tonic_name.replace("-", "b")
    return (_LETTER_PC[tonic_name[0].upper()] + tonic_name.count("#") - tonic_name[1:].count("b")) % 12


def _doh_name(tonic_pc: int, mode: str) -> str:
    """Doh's letter name for a key: the tonic's fewest-accidentals spelling for major, and for
    minor the relative major's tonic, spelled from that tonic's letter.

    From the pitch class alone, never from how the key happened to be spelled, because C#'s
    ``ChordSpeller.DohName`` names a saved sheet's chords the same way: a key the melody
    pipeline spells "C# major" or "Ab minor" still gets its chords in Db and B.
    """
    tonic = tonic_name(tonic_pc, mode).replace("-", "b")
    if mode == "major":
        return tonic
    letter = _LETTERS[(_LETTERS.index(tonic[0]) + 2) % 7]
    return _name(letter, (tonic_pc + 3) % 12) or _PLAIN[(tonic_pc + 3) % 12]


def label(spans: Iterable[ChordSpan], tonic_name: str, mode: str) -> list[Chord]:
    """Spell and name every span in the key ``tonic_name`` (e.g. "Bb", "F#", "E-") ``mode``."""
    doh_name = _doh_name(_key_pitch_class(tonic_name), mode)
    doh = _key_pitch_class(doh_name)
    out: list[Chord] = []
    for s in spans:
        semis = (s.root - doh) % 12
        sharp = s.quality == "dim"
        root_name = spell_root(s.root, doh, doh_name, sharp)
        symbol = root_name + QUALITY_SUFFIX[s.quality]
        if s.bass is not None:
            symbol += "/" + _spell_tone(root_name, s.bass, (s.bass - s.root) % 12)
        table = solfa.ASCENDING_SYLLABLES if sharp else solfa.DESCENDING_SYLLABLES
        out.append(Chord(
            start_beat=round(float(s.start_beat), 4), dur_beats=round(float(s.dur_beats), 4),
            root=s.root, quality=s.quality, bass=s.bass, symbol=symbol, solfa=table[semis]))
    return out


# ── MusicXML ──────────────────────────────────────────────────────────────────

_SYMBOL_ROOT = re.compile(r"^([A-G])([#b]?)")


def _xml_pitch(parent, tag: str, name: str) -> None:
    import xml.etree.ElementTree as ET

    m = _SYMBOL_ROOT.match(name)
    ET.SubElement(parent, f"{tag}-step").text = m.group(1)
    if m.group(2):
        ET.SubElement(parent, f"{tag}-alter").text = "1" if m.group(2) == "#" else "-1"


def _harmony_element(chord: Chord, offset_divisions: int):
    import xml.etree.ElementTree as ET

    h = ET.Element("harmony", {"print-frame": "no"})
    root_name, _, bass_name = chord.symbol.partition("/")
    _xml_pitch(ET.SubElement(h, "root"), "root", root_name)
    ET.SubElement(h, "kind", {"text": QUALITY_SUFFIX[chord.quality]}).text = QUALITY_KIND[chord.quality]
    if bass_name:
        _xml_pitch(ET.SubElement(h, "bass"), "bass", bass_name)
    if offset_divisions:
        ET.SubElement(h, "offset").text = str(offset_divisions)
    return h


def add_harmony(musicxml: str, chords: Sequence[Chord]) -> str:
    """``musicxml`` with a <harmony> element for every chord, in the first part's measures.

    Written into the exported XML rather than added to the music21 stream: music21 pads a
    measure with hidden rests around a chord symbol that falls inside a held note, which
    makes the measure overfull. Here each <harmony> goes before the note sounding at its
    beat, with an <offset> when it starts part-way through that note. A chord after the
    last measure is left out of the score (the chord list still has it).
    """
    import xml.etree.ElementTree as ET

    if not chords:
        return musicxml
    head, sep, body = musicxml.partition("<score-partwise")
    if not sep:
        return musicxml
    root = ET.fromstring(sep + body)
    part = root.find("part")
    if part is None:
        return musicxml

    divisions = 1
    measure_start = 0.0  # in quarter notes
    pending = sorted(chords, key=lambda c: c.start_beat)
    i = 0
    for measure in part.findall("measure"):
        attrs = measure.find("attributes")
        if attrs is not None and attrs.find("divisions") is not None:
            divisions = int(attrs.find("divisions").text)
        # Where every note starts, in divisions from the measure's start.
        pos, length, starts = 0, 0, []
        for child in list(measure):
            if child.tag == "note":
                dur = child.find("duration")
                d = int(dur.text) if dur is not None else 0
                if child.find("chord") is not None or child.find("grace") is not None:
                    continue
                starts.append((pos, child))
                pos += d
            elif child.tag == "backup":
                pos -= int(child.find("duration").text)
            elif child.tag == "forward":
                pos += int(child.find("duration").text)
            length = max(length, pos)
        measure_end = measure_start + length / divisions
        while i < len(pending) and pending[i].start_beat < measure_end - 1e-6:
            chord = pending[i]
            i += 1
            target = int(round((max(chord.start_beat, measure_start) - measure_start) * divisions))
            at, anchor = 0, None
            for start, note in starts:
                if start <= target:
                    at, anchor = start, note
            index = list(measure).index(anchor) if anchor is not None else len(measure)
            measure.insert(index, _harmony_element(chord, target - at))
        measure_start = measure_end
    return head + ET.tostring(root, encoding="unicode")


# ── Chords-mode melody ────────────────────────────────────────────────────────

_SKYLINE_FRAME_SEC = 0.02
_SKYLINE_MIN_SEC = 0.08
_HARMONIC_INTERVALS = (12, 19, 24)


def top_line(events: Sequence) -> list:
    """The highest sounding note at every moment, as a single line of notes.

    ``events`` are transcriber Events (start, end, pitch, amp).  An upper octave, twelfth
    or double octave quieter than the note under it is that note's overtone, not a voice,
    and is skipped.  The top pitch is followed frame by frame; it becomes a new note
    whenever a different event takes the top, so a repeated chord repeats its top note.
    Fragments shorter than ``_SKYLINE_MIN_SEC`` are dropped.
    """
    if not events:
        return []
    events = sorted(events, key=lambda e: e.start)
    longest = max(e.end - e.start for e in events)
    starts = [e.start for e in events]
    voiced = []
    for e in events:
        # Only events that can overlap ``e`` are compared: those starting within the
        # longest note's length before it, up to its end.
        lo = int(np.searchsorted(starts, e.start - longest, side="left"))
        hi = int(np.searchsorted(starts, e.end, side="left"))
        ghost = any(
            (e.pitch - f.pitch) in _HARMONIC_INTERVALS and f.amp >= e.amp
            and min(e.end, f.end) - max(e.start, f.start) >= 0.5 * (e.end - e.start)
            for f in events[lo:hi] if f is not e
        )
        if not ghost:
            voiced.append(e)
    t0 = min(e.start for e in voiced)
    t1 = max(e.end for e in voiced)
    n = int(np.ceil((t1 - t0) / _SKYLINE_FRAME_SEC)) + 1
    top = np.full(n, -1)
    for idx, e in enumerate(voiced):
        a = int(round((e.start - t0) / _SKYLINE_FRAME_SEC))
        b = max(a + 1, int(round((e.end - t0) / _SKYLINE_FRAME_SEC)))
        seg = top[a:b]
        current = np.array([voiced[j].pitch if j >= 0 else -1 for j in seg])
        # Ties go to the note that started later: it is the one just played.
        take = e.pitch >= current
        seg[take] = idx
    line = []
    start = 0
    for f in range(1, n + 1):
        if f < n and top[f] == top[start]:
            continue
        idx = int(top[start])
        if idx >= 0 and (f - start) * _SKYLINE_FRAME_SEC >= _SKYLINE_MIN_SEC:
            e = voiced[idx]
            line.append(replace(e, start=max(e.start, t0 + start * _SKYLINE_FRAME_SEC),
                                end=min(e.end, t0 + f * _SKYLINE_FRAME_SEC)))
        start = f
    return line
