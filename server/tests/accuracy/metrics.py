"""Scoring for the accuracy harness — reference notes vs what the pipeline returned.

Every function here is **total**: degenerate input (no reference notes, no estimated
notes, a tempo of 0, an unparseable key) returns zeros rather than raising, because a
metric that throws turns one bad case into an aborted corpus run.  Each returns a flat
``dict`` that ``runner.py`` prefixes with its namespace, and those dotted names are the
keys ``baseline.json`` is stored under — renaming one invalidates every recorded
baseline, so they are a wire contract.

Why two time domains
────────────────────
``note_metrics_seconds`` and ``onset_metrics_beats`` measure the same onsets in
different clocks, and the *pair* is the diagnostic.  Both take their reference from
``RefNote.onset_beat`` at the *reference* tempo — beats counted from the first
sounding note, lead-in excluded — so a pipeline that got everything right scores
1.0 in both:

  seconds  Estimated beats are converted back with the tempo the pipeline itself
           reported, which recovers the absolute position in the file.  A pipeline
           that preserves leading silence therefore sits ``lead_in_sec`` late
           against a lead-in-relative reference.  This domain answers "did it hear
           the right notes, and did the eighth grid keep them apart?"

  beats    Estimated beats are rescaled onto the reference grid
           (``start_beat * ref_bpm / est_bpm``) first, so what is left is a pure
           shift and the search can isolate it: a large ``best_shift_beats`` with
           ``f1_shift_invariant`` far above raw ``f1`` is defect 1 and nothing else.

Do NOT remove that rescale.  ``start_beat`` counts beats at the *estimated* tempo
and the reference counts beats at the reference tempo, so without it the two lists
are related by a scale *and* a shift; no constant shift can align them, and a tempo
error of a few percent erases the defect-1 signature entirely (measured: the
lead-in case reported ``best_shift_beats`` 0.000, bit-identical to its own control,
because the tempo came back 117 against a reference 96).  ``tempo_metrics`` is the
column that measures the tempo — the beat domain is not.

Tolerances, and why they are not mir_eval's defaults
───────────────────────────────────────────────────
The pipeline quantizes with ``s.quantize((2,))`` — an eighth-note grid — so every
onset it can emit is a multiple of 0.5 beat, about 310 ms at the corpus's tempi.
mir_eval's 50 ms default would therefore measure the quantizer and report ~0 for any
input, however well the model heard it.  Both windows are half of one grid step,
i.e. "the pipeline put this onset in the right slot".  (The old ``spike/`` script did
use 50 ms, but it scored Basic Pitch's *raw* note events, before quantization; those
numbers are not comparable with these.)

The seconds window is half a grid step at the **reference** tempo, never at the
reported one.  The grid is 30/bpm seconds wide, so a window keyed off the reported
tempo would make the score a function of the number under test: an over-reported
tempo buys a finer grid and hides its own quantization damage.  Measured on the
fast-sixteenth case, whose tempo comes back 3.92x high — keyed to the reported
tempo the same hearing scored 0.774 as reported but 0.516 once the tempo was
corrected, so fixing the tempo would have read as a 0.258 regression on the
harness's headline metric.  Keyed to the reference tempo both score 0.968.

Only the pinned deps are used: numpy and mir_eval (which arrives with basic-pitch).
Nothing here imports anything from ``app/`` except the read-only solfa engine and the
key parser the pipeline itself uses, so ground truth is labelled by the same code
under test rather than by a second implementation that could drift.
"""

from collections.abc import Sequence

import numpy as np
from mir_eval import key as mir_key
from mir_eval import onset as mir_onset
from mir_eval import transcription as mir_transcription
from mir_eval import util as mir_util

from app.pipeline import solfa
from app.pipeline.transcriber import TranscribedNote, _parse_key_override
from tests.accuracy.synth import RefNote

# ── Tolerances ────────────────────────────────────────────────────────────────

# Half an eighth note, in beats.  The pipeline's quantization grid is a whole
# eighth, so anything tighter cannot be met by construction; anything looser starts
# crediting a note placed in the neighbouring slot, which is a whole step away.
# Tempo-independent, which is why the beat domain is the stable one to compare
# across cases with different tempi.
ONSET_TOLERANCE_BEATS = 0.25

# A 2 % skirt on the seconds window only.  A reference onset exactly half a grid
# step from its slot — every odd sixteenth in the fast case is exactly that —
# otherwise lands on the boundary, where the match is decided by float rounding
# rather than by the pipeline.  Far too small to reach the neighbouring slot.
_SECONDS_TOLERANCE_MARGIN = 1.02

# A quarter tone.  Both sides are integer MIDI, so this is exact MIDI equality — it
# is expressed in cents only because that is the unit mir_eval takes.
PITCH_TOLERANCE_CENTS = 50.0

# Duration criterion for ``notes.f1_with_offset``: mir_eval's default 20 % of the
# reference duration, floored at half a grid step so the eighth grid alone cannot
# fail a note.
OFFSET_RATIO = 0.2

# MIREX's +/-4 % tempo window, applied around each metrical multiple below.
TEMPO_OCTAVE_TOLERANCE = 0.04

# The metrical levels a beat tracker actually slips between, tried in this order.
# Half and double are not enough: measured on this corpus the fast-sixteenth case
# comes back at 3.92x the reference (it read sixteenths as beats), which a
# half/double-only test reports as a bare 257 BPM error, i.e. as noise rather than
# as the clean 4x it is.
#
# 1.0 leads the tuple, and leaving it out was a defect rather than a shorthand.
# Without it "the estimate is on the reference's own level" fell through to the 0.0
# the docstring calls "none", so metrical_factor could not distinguish a perfect
# reading from a wildly wrong one: measured over the 38-case report, 0.0 covered 10
# exact tempi AND 25 incommensurate misses — 35 of 38 cases in one unreadable
# bucket, which defeats the column's whole stated purpose.  With 1.0 present, 27 of
# 38 cases report it (every case inside MIREX's +/-4 %, which IS the reference
# level — abs_error still carries the magnitude), 3 report their clean multiple, and
# 0.0 falls to the 8 cases that genuinely sit between levels.  Those 8 are worth the
# column: all 8 report 117 BPM, librosa's own prior, and 7 of them have onset
# detection destroyed by vibrato (n_est 20-47 against n_ref 11, notes.f1
# 0.000-0.645), so their tempo is a fallback rather than a measurement.  The eighth,
# major_c_sharp, is 11/11 notes at f1 1.000 yet reads 117 against a true 88 — an
# isolated beat-tracking failure the old tuple hid among 35 identical zeros.
# ``octave_error`` is unaffected: it tests membership in (2.0, 0.5), and no case can
# be within 4 % of both 1.0 and 2.0.  Measured 0 before and after.
TEMPO_METRICAL_FACTORS = (1.0, 2.0, 0.5, 4.0, 0.25, 3.0, 1.0 / 3.0, 1.5, 2.0 / 3.0)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _onset_tolerance_sec(ref_tempo_bpm: float) -> float:
    """Half a quantization step in seconds, at the REFERENCE tempo.

    Keyed to the reference and never to ``result.tempo`` — see the module docstring.
    The estimate must not be allowed to choose the window it is measured with.
    """
    return ONSET_TOLERANCE_BEATS * _SECONDS_TOLERANCE_MARGIN * 60.0 / float(ref_tempo_bpm)


def _midi_to_hz(pitch_midi: float) -> float:
    """mir_eval's transcription metrics take pitches in Hz, not MIDI numbers."""
    return 440.0 * 2.0 ** ((float(pitch_midi) - 69.0) / 12.0)


def _intervals(starts: np.ndarray, ends: np.ndarray, pitches: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Pack onset/offset pairs for mir_eval, dropping non-positive durations.

    ``validate_intervals`` rejects a zero-length interval outright.  The pipeline's
    0.5-beat duration floor means that never happens in practice, but a metric that
    raises on a degenerate note would take the whole run down with it.
    """
    keep = ends > starts
    intervals = np.column_stack((starts[keep], ends[keep]))
    return intervals, pitches[keep]


# ── Note-level accuracy, seconds domain ───────────────────────────────────────


def note_metrics_seconds(
    ref: Sequence[RefNote],
    est: Sequence[TranscribedNote],
    est_tempo_bpm: float,
    ref_tempo_bpm: float,
) -> dict:
    """Pitch + onset note accuracy in seconds (mir_eval's note transcription metric).

    Estimated beats are converted with ``est_tempo_bpm`` — the tempo the pipeline
    reported — because that is the tempo its own beat numbers are expressed in, and
    the round trip recovers the absolute position in the file.

    The reference side is ``RefNote.onset_beat`` at ``ref_tempo_bpm``, i.e. seconds
    from the first *sounding* note, NOT ``onset_sec`` (which includes the lead-in).
    ``onset_sec`` would make the pipeline's habit of preserving leading silence the
    ground truth: the estimate's absolute position cancels the reference's lead-in
    only while the defect is present, so fixing defect 1 drove this metric from
    0.720 to 0.000 on the very case built to measure the fix.

    ``offset_ratio=None`` for the headline numbers scores onset and pitch only.
    ``f1_with_offset`` repeats the scoring with a duration criterion, because
    nothing else in this module reads ``dur_beats`` at all — without it a change to
    the duration grid or to the 0.25-beat duration floor moves no number in either
    direction.  It is the one column the reported tempo still reaches, though: the
    duration criterion is in seconds, so an over-reported tempo buys a finer
    duration grid (measured with the hearing held perfect: the triplet case scores
    1.000 at a reported 345 BPM and 0.692 at the correct 96).  It is therefore
    recorded but NOT gated — see ``NOT_A_GATE`` in ``test_accuracy.py``.
    """
    # Independent of tempo and of matching: it asks only whether the pipeline
    # invented a pitch within a semitone of a real one, which is what a vibrato note
    # fragmented across pitch bins looks like and what a +12 harmonic ghost is not.
    # ``ghost_count`` cannot tell those two apart.
    ref_pitch_set = {r.pitch_midi for r in ref}
    neighbour_ghosts = sum(
        1
        for n in est
        if n.pitch_midi not in ref_pitch_set
        and any(abs(n.pitch_midi - pitch) <= 1 for pitch in ref_pitch_set)
    )
    zeros = {
        "precision": 0.0,
        "recall": 0.0,
        "f1": 0.0,
        "f1_with_offset": 0.0,
        "semitone_neighbour_ghosts": neighbour_ghosts,
        "n_ref": len(ref),
        "n_est": len(est),
    }
    if not ref or not est or est_tempo_bpm <= 0 or ref_tempo_bpm <= 0:
        return zeros

    est_beat_sec = 60.0 / float(est_tempo_bpm)
    ref_beat_sec = 60.0 / float(ref_tempo_bpm)
    ref_starts = np.array([r.onset_beat * ref_beat_sec for r in ref], dtype=float)
    ref_ends = np.array([(r.onset_beat + r.dur_beats) * ref_beat_sec for r in ref], dtype=float)
    est_starts = np.array([n.start_beat * est_beat_sec for n in est], dtype=float)
    est_ends = np.array([(n.start_beat + n.dur_beats) * est_beat_sec for n in est], dtype=float)

    ref_intervals, ref_pitches = _intervals(
        ref_starts, ref_ends, np.array([_midi_to_hz(r.pitch_midi) for r in ref], dtype=float)
    )
    est_intervals, est_pitches = _intervals(
        est_starts, est_ends, np.array([_midi_to_hz(n.pitch_midi) for n in est], dtype=float)
    )
    # Counts describe what was actually scored, so precision/recall and their
    # denominators can never disagree.
    zeros = {**zeros, "n_ref": len(ref_intervals), "n_est": len(est_intervals)}
    if not len(ref_intervals) or not len(est_intervals):
        return zeros

    onset_tolerance = _onset_tolerance_sec(ref_tempo_bpm)
    try:
        precision, recall, f_measure, _ = mir_transcription.precision_recall_f1_overlap(
            ref_intervals,
            ref_pitches,
            est_intervals,
            est_pitches,
            onset_tolerance=onset_tolerance,
            pitch_tolerance=PITCH_TOLERANCE_CENTS,
            offset_ratio=None,
        )
        _, _, f_with_offset, _ = mir_transcription.precision_recall_f1_overlap(
            ref_intervals,
            ref_pitches,
            est_intervals,
            est_pitches,
            onset_tolerance=onset_tolerance,
            pitch_tolerance=PITCH_TOLERANCE_CENTS,
            offset_ratio=OFFSET_RATIO,
            offset_min_tolerance=onset_tolerance,
        )
    except ValueError:
        return zeros

    return {
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f_measure),
        "f1_with_offset": float(f_with_offset),
        "semitone_neighbour_ghosts": neighbour_ghosts,
        "n_ref": len(ref_intervals),
        "n_est": len(est_intervals),
    }


# ── Onset accuracy, beats domain ──────────────────────────────────────────────


def onset_metrics_beats(
    ref: Sequence[RefNote],
    est: Sequence[TranscribedNote],
    est_tempo_bpm: float,
    ref_tempo_bpm: float,
) -> dict:
    """Onset-only accuracy in beats, raw and after the best whole-clip shift.

    Estimated beats are rescaled onto the reference grid before anything is
    compared — ``start_beat * ref_bpm / est_bpm`` — because ``start_beat`` counts
    beats at the tempo the pipeline reported.  Without that, the ref→est relation is
    affine and the shift search below is searching for something that is not there.

    ``best_shift_beats`` is how many beats *later* the estimate sits than the
    reference (positive = the pipeline pushed everything back, which is what leading
    silence preserved as rests looks like).  Candidate shifts are the pairwise
    differences of the two onset lists — the optimal alignment always lies on one of
    them — plus 0.0, searched in order of increasing magnitude so a tie resolves to
    the smallest shift and an already-aligned case reports exactly 0.0.

    Pitch is deliberately ignored here: this is the timing half of the diagnostic,
    and ``note_metrics_seconds`` is the half that requires the right note.
    """
    zeros = {
        "precision": 0.0,
        "recall": 0.0,
        "f1": 0.0,
        "best_shift_beats": 0.0,
        "f1_shift_invariant": 0.0,
    }
    if not ref or not est or est_tempo_bpm <= 0 or ref_tempo_bpm <= 0:
        return zeros

    # mir_eval rejects a non-monotonic event list.  Estimated notes are non-decreasing
    # in start_beat but ties are common (quantization collapses distinct onsets), and
    # sorting is a no-op that makes that safe.
    beat_scale = float(ref_tempo_bpm) / float(est_tempo_bpm)
    ref_beats = np.sort(np.array([r.onset_beat for r in ref], dtype=float))
    est_beats = np.sort(np.array([n.start_beat * beat_scale for n in est], dtype=float))

    f_measure, precision, recall = mir_onset.f_measure(
        ref_beats, est_beats, window=ONSET_TOLERANCE_BEATS
    )

    candidates = sorted(
        {0.0} | {round(float(e - r), 6) for e in est_beats for r in ref_beats},
        key=lambda shift: (abs(shift), shift),
    )
    best_shift, best_f1 = 0.0, float(f_measure)
    for shift in candidates:
        shifted_f1, _, _ = mir_onset.f_measure(
            ref_beats, est_beats - shift, window=ONSET_TOLERANCE_BEATS
        )
        # Strict improvement only, so the smallest shift that achieves the maximum is
        # the one reported.
        if float(shifted_f1) > best_f1:
            best_shift, best_f1 = shift, float(shifted_f1)

    return {
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f_measure),
        "best_shift_beats": float(best_shift),
        "f1_shift_invariant": best_f1,
    }


# ── Key accuracy ──────────────────────────────────────────────────────────────


def key_metrics(ref_key: str, est_key: str) -> dict:
    """mir_eval's weighted key score plus the three confusions we expect to see.

    ``exact`` compares pitch class and mode, not strings: the pipeline spells a key
    however music21 does ("C# major" for pitch class 1), and an enharmonic respelling
    is not a key error.  A string comparison would read False forever and hide real
    regressions behind a known one.

    The confusion flags are computed directly rather than inferred from the weighted
    score, so they stay readable — and note ``fifth_confusion`` counts a fifth in
    *either* direction (dominant and subdominant are the classic Krumhansl-Schmuckler
    slips), while mir_eval only awards its 0.5 to a fifth above.  A subdominant
    confusion therefore reads ``fifth_confusion=True`` with ``weighted_score=0.0``.

    **The three confusions are not equally expensive, and one of them is free.**  Read
    against ``solfa.degree_accuracy`` rather than on their own:

    - ``relative_confusion`` costs **nothing**, and not approximately — exactly nothing,
      by construction.  Solfa is movable-do with la-based minor, so
      ``solfa.doh_pitch_class`` maps a minor key to ``(tonic + 3) % 12``: A minor and C
      major both return doh = C.  Identical doh means identical syllables, identical
      degrees, and relatives share a key signature, so the staff render is identical
      too.  Only the displayed key *string* is wrong.  Measured:
      ``relative_bait_c_major`` reads C major as A minor and still scores
      ``degree_accuracy`` 1.000.  Anything that trades solfa accuracy to push this
      column down is trading something for nothing.
    - ``fifth_confusion`` is the fatal one.  A subdominant slip moves doh by five
      semitones and every degree in the clip with it: ``plagal_fourth_c_major`` reads C
      major as F major and scores ``degree_accuracy`` 0.000 on ``notes.f1`` 0.846 — the
      notes are heard correctly and mislabelled wholesale.  This is where the leverage
      is, and it is the confusion ``KEY_PROFILE_NAMES`` was assembled to cancel.
    - ``parallel_confusion`` moves doh by three semitones, so it is expensive too; it is
      0.000 over the corpus and has never been the failure mode here.
    """
    zeros = {
        "weighted_score": 0.0,
        "exact": False,
        "relative_confusion": False,
        "fifth_confusion": False,
        "parallel_confusion": False,
    }
    try:
        # mir_eval's vocabulary is 12 semitones with common enharmonics; a key it
        # cannot spell (an empty estimate from a failed case, or a "Cb"/"Fb" music21
        # can emit but mir_eval cannot parse) scores as zeros rather than raising.
        score = float(mir_key.weighted_score(ref_key, est_key))
        ref_pc, ref_mode = mir_key.split_key_string(ref_key)
        est_pc, est_mode = mir_key.split_key_string(est_key)
    except (ValueError, KeyError, AttributeError):
        return zeros
    if ref_pc is None or est_pc is None:  # "X" — uncategorized, no relationship to report
        return {**zeros, "weighted_score": score}

    interval = (est_pc - ref_pc) % 12
    same_mode = est_mode == ref_mode
    relative = (ref_mode == "major" and interval == 9) or (ref_mode == "minor" and interval == 3)

    return {
        "weighted_score": score,
        "exact": bool(same_mode and interval == 0),
        "relative_confusion": bool(not same_mode and relative),
        "fifth_confusion": bool(same_mode and interval in (7, 5)),
        "parallel_confusion": bool(not same_mode and interval == 0),
    }


# ── Tempo accuracy ────────────────────────────────────────────────────────────


def tempo_metrics(ref_bpm: float, est_bpm: float) -> dict:
    """Absolute and relative tempo error, plus which metrical level was reported.

    Read this column before trusting anything in the beat domain, and before reading
    a tempo error as a measurement at all: ``transcriber.py`` falls back to a
    hard-coded 100 BPM when beat tracking fails, so a reported tempo is not
    necessarily something it measured.

    ``metrical_factor`` is the multiple of the reference the estimate landed on, so a
    beat tracker that read sixteenths as beats reads "4.0" instead of "257 BPM off",
    and one that read the reference's own level reads "1.0".  0.0 means *none of the
    known levels* — the estimate sits between them — which is a stronger statement
    than a large ``abs_error`` and the one worth reading first.  ``octave_error``
    keeps its literal meaning — half or double time only — and is the gated bool; the
    factor is the label.
    """
    if ref_bpm <= 0 or est_bpm <= 0:
        # The WORST value, not the best.  abs_error and rel_error are gated
        # lower-is-better, so a missing tempo must never read as an exact one.
        return {
            "abs_error": max(float(ref_bpm), 0.0),
            "rel_error": 1.0,
            "octave_error": False,
            "metrical_factor": 0.0,
        }

    abs_error = abs(float(est_bpm) - float(ref_bpm))
    metrical_factor = 0.0
    for factor in TEMPO_METRICAL_FACTORS:
        if abs(float(est_bpm) - factor * float(ref_bpm)) <= (
            TEMPO_OCTAVE_TOLERANCE * factor * float(ref_bpm)
        ):
            metrical_factor = factor
            break

    return {
        "abs_error": abs_error,
        "rel_error": abs_error / float(ref_bpm),
        "octave_error": metrical_factor in (2.0, 0.5),
        "metrical_factor": metrical_factor,
    }


# ── Solfa accuracy ────────────────────────────────────────────────────────────


def _match_by_pitch_then_time(
    ref_sec: np.ndarray,
    est_sec: np.ndarray,
    ref_pitches: np.ndarray,
    est_pitches: np.ndarray,
    window: float,
) -> list[tuple[int, int]]:
    """Pair reference notes with estimated notes on time, breaking ties on pitch.

    mir_eval's matcher maximises the *number* of pairs and is indifferent to which of
    two equally feasible candidates it picks, so on the eighth grid — where a real
    note and a ghost routinely land in the same slot — the pairing is decided by the
    order music21 happened to emit them in, which the pipeline does not define.
    Measured: with a whole-tone ghost sharing the first note's slot, listing it
    before the real note instead of after moved ``degree_accuracy`` from 1.000 to
    0.909, four times the gate's tolerance, with nothing about the transcription
    changed.

    So: match pairs whose MIDI numbers agree first (still mir_eval's maximum
    matching, just restricted to those pairs), then run the ordinary time-only
    matcher over what is left.  A wrong pitch therefore still matches and still
    counts as a label error — that is the point of the metric — but a *right* pitch
    is never passed over in favour of a ghost sharing its slot.
    """

    def same_pitch_distance(ref_times: np.ndarray, est_times: np.ndarray) -> np.ndarray:
        distance = np.abs(np.subtract.outer(ref_times, est_times))
        # inf is never <= window, so a differing pitch is simply not a feasible pair
        # in this pass.
        return np.where(np.equal.outer(ref_pitches, est_pitches), distance, np.inf)

    pairs = mir_util.match_events(ref_sec, est_sec, window, distance=same_pitch_distance)
    matched_ref = {ref_idx for ref_idx, _ in pairs}
    matched_est = {est_idx for _, est_idx in pairs}

    ref_left = [i for i in range(len(ref_sec)) if i not in matched_ref]
    est_left = [j for j in range(len(est_sec)) if j not in matched_est]
    if ref_left and est_left:
        leftovers = mir_util.match_events(ref_sec[ref_left], est_sec[est_left], window)
        pairs += [(ref_left[i], est_left[j]) for i, j in leftovers]
    return sorted(pairs)


# The five semitones above doh that fall outside the diatonic scale, so a note on one of
# them is written with an accidental: indices 1, 3, 6, 8 and 10 — de/re/fe/se/le rising,
# ra/ma/sa/la/ta falling.  Which of the two a note gets is a function of where the
# melody goes next (``solfa.ascending_flags``), not of the note alone, so the ground truth below has
# to derive it the same way the pipeline does; the two tables are identical on the seven
# diatonic degrees, so nothing outside this set can be affected either way.
CHROMATIC_SEMITONES = frozenset({1, 3, 6, 8, 10})


def _is_chromatic(pitch_midi: int, doh_pc: int) -> bool:
    """Would this pitch be written with an accidental, in the key whose doh is *doh_pc*?"""
    return (pitch_midi - doh_pc) % 12 in CHROMATIC_SEMITONES


def solfa_metrics(
    ref: Sequence[RefNote],
    est: Sequence[TranscribedNote],
    ref_key: str,
    est_tempo_bpm: float,
    ref_tempo_bpm: float,
) -> dict:
    """Solfa labelling accuracy against ground truth derived from the reference key.

    Notes are matched in the seconds domain on time, with pitch only as the
    tie-break (see ``_match_by_pitch_then_time``), so that a wrong pitch *or* a wrong
    key both surface as a label error — which is the point.  Solfa is a function of
    the key, so a correctly heard pitch under a mis-detected key is still a wrong
    syllable, and that is a real user-visible defect.

    ``matched`` is the denominator of the three rates and has to be read with them:
    they are accuracy *given detection*, so a pipeline that finds one note and labels
    it correctly scores 1.0 on a single sample.  ``ghost_count`` is the estimated
    notes that matched nothing.

    ``degree_accuracy`` and ``syllable_accuracy`` compare the labels the pipeline
    actually emitted.  ``octave_error_rate`` cannot: the octave mark is relative to a
    whole-clip ``reference_doh`` derived from the pitch median, and the two sides
    derive that anchor independently, so one octave substitution that drags the
    estimated median across a doh tie point flips the mark on every correctly heard
    note (measured 0.818 where the real per-note rate was 0.182, and 0.909 on every
    major case from a single wrong note).  The marks are therefore re-derived for
    both sides under the *reference* anchor, which makes the column per-note, and the
    anchor disagreement is reported separately as ``anchor_matches_reference``.

    Ground truth is built exactly the way ``transcribe()`` builds its own labels
    (transcriber.py:779-788) — one ``reference_doh`` for the whole clip from the
    median of the pitch list, chromatic syllables chosen by melodic direction — except
    that both the pitch list and the direction are the *reference* ones.  Deriving
    either from the estimate would make it agree by construction.

    ``chromatic_ghosts`` is the accidentals column, and it counts the *excess* rather
    than the total on purpose.  Lower-is-better on the total would be plainly wrong:
    under la-based minor the harmonic minor's raised 7th is ``se``, a chromatic
    syllable, so ``minor_harmonic_a`` legitimately needs one and driving that column to
    zero would be a regression wearing a fix's clothes.  So an estimated note counts
    here only when it carries an accidental *and* the reference note it matched does
    not — or it matched nothing at all.  Zero is therefore both achievable and correct
    for every case in the corpus, which is what makes it gateable.

    All three chromatic columns are computed under the *reference* key, for the same
    reason the octave marks are: a mis-detected key shifts both sides together, so a key
    error cannot inflate them.  The consequence is that they undercount what the user
    actually sees — the pipeline notates under the key it detected, so a wrong key adds
    accidentals this column cannot see.  ``key.exact`` is where that shows up; read the
    two together rather than reading this one as the whole of the complaint.
    """
    zeros = {
        "degree_accuracy": 0.0,
        "syllable_accuracy": 0.0,
        "octave_error_rate": 0.0,
        "anchor_matches_reference": False,
        "ghost_count": len(est),
        "matched": 0,
        # Not knowable without a parseable key, which is what the paths returning this
        # either lack or have just failed on.  A case that reached here produced no
        # comparable notes at all and is already fully flagged by notes.f1.
        "chromatic_ghosts": 0,
        "chromatic_count": 0,
        "ref_chromatic_count": 0,
    }
    if not ref or not est or est_tempo_bpm <= 0 or ref_tempo_bpm <= 0:
        return zeros

    try:
        key_obj = _parse_key_override(ref_key)
        doh_pc = solfa.doh_pitch_class(key_obj.tonic.pitchClass, key_obj.mode)
        # reference_doh takes the median of the whole list, so it must never be handed
        # an empty one: np.median([]) is nan and every comparison in it silently fails.
        ref_doh = solfa.reference_doh([r.pitch_midi for r in ref], doh_pc, key_obj.mode)
        # Same pitch class, estimated pitch list: this is the anchor the pipeline's own
        # marks are relative to, and the only thing that differs is the median.  Both
        # sides use the reference doh pitch class so a key error cannot leak in here.
        est_doh = solfa.reference_doh([n.pitch_midi for n in est], doh_pc, key_obj.mode)
    except (ValueError, AttributeError, IndexError):
        return zeros

    est_beat_sec = 60.0 / float(est_tempo_bpm)
    ref_beat_sec = 60.0 / float(ref_tempo_bpm)
    # Reference times are lead-in relative and estimated times are absolute file
    # positions, exactly as in note_metrics_seconds — same reason.
    ref_sec = np.array([r.onset_beat * ref_beat_sec for r in ref], dtype=float)
    est_sec = np.array([n.start_beat * est_beat_sec for n in est], dtype=float)
    pairs = _match_by_pitch_then_time(
        ref_sec,
        est_sec,
        np.array([r.pitch_midi for r in ref], dtype=int),
        np.array([n.pitch_midi for n in est], dtype=int),
        _onset_tolerance_sec(ref_tempo_bpm),
    )

    # Deliberately ahead of the no-pairs return: a clip whose notes all failed to match
    # is exactly the case where spurious accidentals are worst, so it has to be counted
    # rather than reported as zero.  With no pairs every accidental is unmatched, which
    # the loop below already handles.
    ref_for_est = {est_idx: ref_idx for ref_idx, est_idx in pairs}
    chromatic = {
        "chromatic_ghosts": sum(
            _is_chromatic(note.pitch_midi, doh_pc)
            and not (
                i in ref_for_est
                and _is_chromatic(ref[ref_for_est[i]].pitch_midi, doh_pc)
            )
            for i, note in enumerate(est)
        ),
        "chromatic_count": sum(_is_chromatic(n.pitch_midi, doh_pc) for n in est),
        "ref_chromatic_count": sum(_is_chromatic(r.pitch_midi, doh_pc) for r in ref),
    }
    if not pairs:
        return {**zeros, "anchor_matches_reference": est_doh == ref_doh, **chromatic}

    degree_hits = syllable_hits = octave_misses = 0
    # Chromatic spelling is a function of where the melody goes next, so ground truth
    # needs the *reference* melody's next notes — the only non-circular choice, since
    # deriving it from the estimate would make the spelling agree by construction.  The
    # consequence is stated rather than hidden: if the pipeline drops a note, the
    # surviving neighbour can move on to a different pitch than it does in the
    # reference, and a chromatic note there is then spelled from the other table and
    # scored wrong.  That is the same conflation ``degree_accuracy`` already makes for a
    # mis-detected key — the syllable the user sees is wrong for the music, and the
    # detection failure is what made it wrong.  Bounded to chromatic notes only.
    ref_spelling = solfa.ascending_flags([r.pitch_midi for r in ref], doh_pc)
    for ref_idx, est_idx in pairs:
        gt_syllable, gt_mark, gt_degree = solfa.syllable(
            ref[ref_idx].pitch_midi, doh_pc, ref_doh, ref_spelling[ref_idx]
        )
        note = est[est_idx]
        degree_hits += note.degree == gt_degree
        syllable_hits += note.solfa == gt_syllable
        # The mark this note WOULD carry under the reference anchor, so the comparison
        # is "is this note in the right octave band" and not "did the two clips agree
        # on which doh to count octaves from".  No spelling is passed because the mark
        # falls out of the octave shift alone — the two syllable tables cannot move it.
        _, est_mark, _ = solfa.syllable(note.pitch_midi, doh_pc, ref_doh)
        octave_misses += est_mark != gt_mark

    matched = len(pairs)
    return {
        "degree_accuracy": degree_hits / matched,
        "syllable_accuracy": syllable_hits / matched,
        "octave_error_rate": octave_misses / matched,
        "anchor_matches_reference": est_doh == ref_doh,
        "ghost_count": len(est) - matched,
        "matched": matched,
        **chromatic,
    }


# ── Per-note confidence calibration ───────────────────────────────────────────


def note_confidence_metrics(
    ref: Sequence[RefNote],
    est: Sequence[TranscribedNote],
    est_tempo_bpm: float,
    ref_tempo_bpm: float,
) -> dict:
    """Does ``TranscribedNote.conf`` actually discriminate right notes from wrong ones?

    ``conf`` is user-visible: the mobile client colours a note and prints "High/Medium/
    Low confidence" from it (``mobile/src/design/theme.ts``), and counts the notes under
    0.5 as the ones worth re-recording.  So the question that matters is not whether the
    number is large but whether it *ranks* — whether a note the pipeline got right tends
    to carry a higher ``conf`` than one it got wrong.

    ``auc`` answers exactly that: the probability that a randomly chosen correct note
    outscores a randomly chosen wrong one, ties counted as half.  0.5 is a coin flip, so
    a ``conf`` that is really just loudness lands near it; 1.0 is a value that could be
    thresholded.  Being a rank statistic it is immune to the thing a mean cannot see —
    rescaling every note's confidence upward changes the mean and the UI banding but
    tells the user nothing new, and must not be allowed to look like an improvement.

    "Correct" is the same notion ``solfa_metrics`` uses, and deliberately so: an
    estimated note counts as correct when the shared matcher pairs it with a reference
    note *and* the MIDI numbers agree.  A ghost and a wrong-pitch match are both wrong.

    Undefined — and therefore absent from the returned dict, following
    ``_confidence_separation`` — unless the case produced at least one note of each
    kind, which is precisely when the question has an answer.  ``mean_correct`` and
    ``mean_wrong`` come back whenever their population is non-empty, as description.
    """
    if not ref or not est or est_tempo_bpm <= 0 or ref_tempo_bpm <= 0:
        return {}

    est_beat_sec = 60.0 / float(est_tempo_bpm)
    ref_beat_sec = 60.0 / float(ref_tempo_bpm)
    ref_sec = np.array([r.onset_beat * ref_beat_sec for r in ref], dtype=float)
    est_sec = np.array([n.start_beat * est_beat_sec for n in est], dtype=float)
    ref_pitches = np.array([r.pitch_midi for r in ref], dtype=int)
    est_pitches = np.array([n.pitch_midi for n in est], dtype=int)
    pairs = _match_by_pitch_then_time(
        ref_sec, est_sec, ref_pitches, est_pitches, _onset_tolerance_sec(ref_tempo_bpm)
    )

    right_pitch = {
        est_idx for ref_idx, est_idx in pairs if ref_pitches[ref_idx] == est_pitches[est_idx]
    }
    correct = np.array(
        [float(n.conf) for i, n in enumerate(est) if i in right_pitch], dtype=float
    )
    wrong = np.array(
        [float(n.conf) for i, n in enumerate(est) if i not in right_pitch], dtype=float
    )

    out: dict[str, float] = {}
    if correct.size:
        out["mean_correct"] = float(correct.mean())
    if wrong.size:
        out["mean_wrong"] = float(wrong.mean())
    if correct.size and wrong.size:
        # Mann-Whitney U over the outer comparison: wins plus half the ties, divided by
        # the number of pairs.  The corpus has at most a few dozen notes per case, so the
        # O(n*m) form is cheaper than sorting and ranking, and exact on ties.
        wins = float((correct[:, None] > wrong[None, :]).sum())
        ties = float((correct[:, None] == wrong[None, :]).sum())
        out["auc"] = (wins + 0.5 * ties) / (correct.size * wrong.size)
        out["separation"] = float(correct.mean() - wrong.mean())
    return out


# ── Solfa sequence accuracy ───────────────────────────────────────────────────


def _edit_distance(a: Sequence[object], b: Sequence[object]) -> int:
    """Levenshtein distance between two label sequences."""
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, start=1):
        current = [i]
        for j, y in enumerate(b, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x != y)))
        previous = current
    return previous[-1]


def sequence_metrics(ref: Sequence[RefNote], est: Sequence[TranscribedNote], ref_key: str) -> dict:
    """How far the solfa *text* is from the truth, ignoring timing altogether.

    The matched-note metrics above score each note where it was heard; this one scores
    what the user reads.  A spurious ``fe`` between ``m`` and ``s`` costs one insertion
    whatever its duration, and a missed note costs one deletion — which is how a choir
    leader counts the mistakes on the page.  Reported as an error rate over the
    reference length so a longer tune does not look worse for being longer.

    Labels are derived under the reference key for both sides, so a key error cannot
    inflate the count — ``key.exact`` reports that separately.  ``syllable_error_rate``
    includes the octave mark, ``degree_error_rate`` only the scale degree.
    """
    zeros = {"syllable_error_rate": 1.0, "degree_error_rate": 1.0, "exact": False}
    if not ref:
        return zeros
    try:
        key_obj = _parse_key_override(ref_key)
    except ValueError:
        return zeros
    doh_pc = solfa.doh_pitch_class(key_obj.tonic.pitchClass, key_obj.mode)
    ref_doh = solfa.reference_doh([r.pitch_midi for r in ref], doh_pc, key_obj.mode)

    def labels(pitches: Sequence[int]) -> tuple[list[str], list[int]]:
        flags = solfa.ascending_flags(list(pitches), doh_pc)
        syllables, degrees = [], []
        for pitch, flag in zip(pitches, flags):
            syl, mark, degree = solfa.syllable(pitch, doh_pc, ref_doh, flag)
            syllables.append(syl + mark)
            degrees.append(degree)
        return syllables, degrees

    ref_syl, ref_deg = labels([r.pitch_midi for r in ref])
    est_syl, est_deg = labels([n.pitch_midi for n in sorted(est, key=lambda n: n.start_beat)])
    return {
        "syllable_error_rate": _edit_distance(ref_syl, est_syl) / len(ref),
        "degree_error_rate": _edit_distance(ref_deg, est_deg) / len(ref),
        "exact": ref_syl == est_syl,
    }


# ── Meter, bars and rhythm (the hymn corpus) ──────────────────────────────────
#
# The metrics above anchor both sides at the first sounding note and never read the time
# signature, which is right for what they measure (did it hear the notes) and blind to what a
# published score adds: the bar lines.  ``sheet_metrics`` reads the sheet as written.  Every
# position is in quarter beats on the written bar grid — bar k starts at k * bpb — on both
# sides: the reference's from the published tune (its first note at ``ref_offset``, the
# pickup's place in bar 0), the estimate's straight from ``start_beat`` and its time signature.
#
# Notes are paired by pitch and audio time (``_pair_notes``), not by written position, so a
# note in the wrong bar is still the same note: the question is where the sheet put it.

# How far apart in the audio two notes of the same pitch may be and still be one note: half a
# second, plus 1 % of the way in for a tempo reported to the whole BPM.
_PAIR_WINDOW_SEC = 0.5
_PAIR_DRIFT = 0.01

# ``rhythm.ioi_proportional``'s tolerance, in reference beats: half a semiquaver, so a note
# a semiquaver off (or written a dotted level away, where an eighth lands between two) is wrong.
_IOI_TOLERANCE_BEATS = 0.125


def bar_length(time_signature: str) -> float:
    """Quarter beats in a bar of ``time_signature`` ("6/8" -> 3.0); 4.0 when unreadable."""
    try:
        n, d = (int(x) for x in str(time_signature).split("/"))
    except ValueError:
        return 4.0
    return n * 4.0 / d if n > 0 and d > 0 else 4.0


def _pair_notes(
    ref_sec: Sequence[float], ref_pitch: Sequence[int], est_sec: Sequence[float], est_pitch: Sequence[int]
) -> list[tuple[int, int]]:
    """The most same-pitch (ref, est) index pairs in order, ties to the least total time apart;
    each pair within ``_PAIR_WINDOW_SEC`` (+ ``_PAIR_DRIFT`` of the elapsed time) in the audio."""
    n, m = len(ref_sec), len(est_sec)
    score = [[(0, 0.0)] * (m + 1) for _ in range(n + 1)]  # (pairs, -distance) over ref[:i], est[:j]
    move = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            best, how = score[i - 1][j], 1
            if score[i][j - 1] > best:
                best, how = score[i][j - 1], 2
            gap = abs(ref_sec[i - 1] - est_sec[j - 1])
            if ref_pitch[i - 1] == est_pitch[j - 1] and gap <= _PAIR_WINDOW_SEC + _PAIR_DRIFT * ref_sec[i - 1]:
                candidate = (score[i - 1][j - 1][0] + 1, score[i - 1][j - 1][1] - gap)
                if candidate > best:
                    best, how = candidate, 3
            score[i][j], move[i][j] = best, how
    pairs, i, j = [], n, m
    while i and j:
        if move[i][j] == 3:
            pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif move[i][j] == 1:
            i -= 1
        else:
            j -= 1
    return pairs[::-1]


def sheet_metrics(
    ref: Sequence[RefNote],
    ref_written: Sequence[float],
    ref_time: str,
    ref_offset: float,
    ref_tempo_bpm: float,
    est: Sequence[TranscribedNote],
    est_time: str,
    est_tempo_bpm: float,
    est_origin_sec: float,
) -> dict:
    """Meter, bar lines, pickup and written rhythm of the sheet against the published score.

    ``meter.exact``          the time signature written is the published one
    ``meter.bar_length``     a bar holds as many quarter beats (2/2 for 4/4 counts, and so
                             does 6/8 for 3/4, which no bar-length cue can tell apart)
    ``bars.in_right_bar``    reference notes written in the bar the score has them in,
                             allowing one whole-sheet renumbering (a pickup counted as bar 1
                             rather than bar 0); a note the transcription missed is wrong
    ``bars.placed_exact``    ... and on the same beat of that bar in written quarter beats:
                             the note is where the hymn page has it
    ``bars.all_right``       every note found is in its right bar: the bar lines are the score's
    ``bars.found``           share of reference notes paired at all (the denominator's loss)
    ``pickup.exact``         the sheet's first note sits in its bar where the score's does
    ``rhythm.ioi_exact``     consecutive reference notes, both found, written the published
                             distance apart (the note value a reader sees)
    ``rhythm.ioi_proportional``  ... the published distance at whatever tempo level the
                             sheet chose (right rhythm, maybe in halved or doubled values)
    ``rhythm.dur_exact``     found notes written with the published length

    Pairing (``_pair_notes``) uses the audio clock each side states: the reference's
    ``onset_sec``, the estimate's ``est_origin_sec + start_beat * 60 / est_tempo_bpm``.
    """
    est_sorted = sorted(est, key=lambda e: e.start_beat)
    ref_bpb, est_bpb = bar_length(ref_time), bar_length(est_time)
    out = {
        "meter.exact": est_time == ref_time,
        "meter.bar_length": abs(ref_bpb - est_bpb) < 1e-9,
        "bars.in_right_bar": 0.0,
        "bars.placed_exact": 0.0,
        "bars.all_right": False,
        "bars.found": 0.0,
        "pickup.exact": False,
        "rhythm.ioi_exact": 0.0,
        "rhythm.ioi_proportional": 0.0,
        "rhythm.dur_exact": 0.0,
    }
    if not ref or not est_sorted or est_tempo_bpm <= 0 or ref_tempo_bpm <= 0:
        return out
    eps = 1e-6
    est_beat_sec = 60.0 / float(est_tempo_bpm)
    ref_beat_sec = 60.0 / float(ref_tempo_bpm)
    out["pickup.exact"] = abs(est_sorted[0].start_beat % est_bpb - ref_offset % ref_bpb) < eps
    pairs = _pair_notes(
        [r.onset_sec for r in ref], [r.pitch_midi for r in ref],
        [est_origin_sec + e.start_beat * est_beat_sec for e in est_sorted], [e.pitch_midi for e in est_sorted],
    )
    out["bars.found"] = len(pairs) / len(ref)
    if not pairs:
        return out

    ref_grid = [ref_offset + r.onset_beat for r in ref]
    shifts = [
        int((est_sorted[j].start_beat + eps) // est_bpb) - int((ref_grid[i] + eps) // ref_bpb) for i, j in pairs
    ]
    modal = max(set(shifts), key=lambda s: (shifts.count(s), -abs(s)))
    right = [s == modal for s in shifts]
    placed = [
        ok and abs(est_sorted[j].start_beat % est_bpb - ref_grid[i] % ref_bpb) < eps
        for ok, (i, j) in zip(right, pairs)
    ]
    out["bars.in_right_bar"] = sum(right) / len(ref)
    out["bars.placed_exact"] = sum(placed) / len(ref)
    out["bars.all_right"] = all(right)
    out["rhythm.dur_exact"] = sum(abs(est_sorted[j].dur_beats - ref_written[i]) < eps for i, j in pairs) / len(pairs)

    exact = proportional = steps = 0
    for (i0, j0), (i1, j1) in zip(pairs, pairs[1:]):
        if i1 != i0 + 1:
            continue
        ref_ioi = ref_grid[i1] - ref_grid[i0]
        est_ioi = est_sorted[j1].start_beat - est_sorted[j0].start_beat
        steps += 1
        exact += abs(est_ioi - ref_ioi) < eps
        proportional += abs(est_ioi * est_beat_sec - ref_ioi * ref_beat_sec) <= _IOI_TOLERANCE_BEATS * ref_beat_sec
    if steps:
        out["rhythm.ioi_exact"] = exact / steps
        out["rhythm.ioi_proportional"] = proportional / steps
    return out
