"""Does the instrument point the right way?  One test per defect the plan fixes.

A regression gate is only useful if the metric it gates moves in the *right*
direction when the pipeline gets better.  The first cut of this harness failed that
test four separate ways — the lead-in case scored 0.720 *because* defect 1 was
present, so landing the documented Phase 2 fix would have driven the gated metric to
0.000 and the gate would have demanded the fix be reverted.  Plausible numbers
pointing backwards are worse than no numbers, because they carry authority.

So for each defect, this module takes a reference phrase, builds the estimate the
*defective* pipeline produces and the estimate the *fixed* pipeline would produce,
and asserts the gated metric improves.  Nothing here touches ``app/`` and nothing
here runs inference: the direction of a metric is a property of ``metrics.py``, not
of Basic Pitch, so it can be proved on constructed note lists in milliseconds.

That is deliberate, and it is why this module carries **no ``accuracy`` marker**:
these run in the default ``python -m pytest -q`` on every commit, so the day someone
edits a metric the wrong way round, CI says so immediately instead of the damage
surfacing as a mysterious "improvement" three phases later.

Each test also asserts SPECIFICITY where it can — that the simulated fix does *not*
improve a case which never had the defect.  Without that half, a metric that simply
likes the transform (rather than measuring the defect) still passes.

Where a defect cannot be simulated honestly the test says so via ``pytest.skip``
rather than asserting something vacuous.  A test that cannot fail is worse than an
absent one: it reports safety it never checked.
"""

import inspect
from dataclasses import replace

import pytest
from app.pipeline import solfa
from app.pipeline.transcriber import (
    Event,
    TranscribedNote,
    _blend_confidence,
    _parse_key_override,
)
from tests.accuracy import metrics, runner
from tests.accuracy.synth import RefNote

# ── Fixture construction ──────────────────────────────────────────────────────

# One tempo for every fixture, and it is the *reference* tempo throughout.  96 BPM
# gives a 0.625 s beat, so the seconds-domain tolerance is 0.159 s — comfortably
# smaller than one beat, which is what makes a whole-beat shift detectable at all.
REF_BPM = 96
BEAT_SEC = 60.0 / REF_BPM

# An 11-note phrase over a C major scale, one beat each: the same shape as the
# corpus's diagnostic cases, so these numbers stay comparable with the real ones.
PHRASE = (60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67)

# Adjacent semitones on purpose (mi-fa and ti-doh).  This is the phrase a
# vibrato-tolerant merge must never collapse, so it is what proves the merge test
# is measuring fragmentation rather than just rewarding fewer notes.
SEMITONE_PHRASE = (64, 65, 64, 65, 71, 72, 71, 72, 64, 65, 71, 72)


def _refs(phrase=PHRASE, lead_in_sec: float = 0.0) -> list[RefNote]:
    """Ground truth for *phrase* as quarter notes from beat 0.

    ``onset_beat`` starts at 0.0 for the first sounding note however much silence
    precedes it, while ``onset_sec`` carries the lead-in — mirroring ``synth.render``
    exactly, because a fixture that disagreed with the real corpus would prove
    nothing about the real corpus.
    """
    return [
        RefNote(
            pitch_midi=pitch,
            onset_sec=lead_in_sec + i * BEAT_SEC,
            dur_sec=BEAT_SEC,
            onset_beat=float(i),
            dur_beats=1.0,
        )
        for i, pitch in enumerate(phrase)
    ]


def _labelled(events: list[tuple[int, float, float]], key_name: str) -> list[TranscribedNote]:
    """Label ``(pitch, start_beat, dur_beats)`` triples the way ``transcribe()`` does.

    One whole-clip ``reference_doh`` from the median of the pitch list, ascending
    syllable table — the same three calls as transcriber.py:779-788.  Going through
    the real solfa engine rather than hand-writing syllables means a fixture can
    never assert a labelling the product would not actually produce.
    """
    key_obj = _parse_key_override(key_name)
    doh_pc = solfa.doh_pitch_class(key_obj.tonic.pitchClass, key_obj.mode)
    ref_doh = solfa.reference_doh([pitch for pitch, _, _ in events], doh_pc)

    notes = []
    for pitch, start_beat, dur_beats in events:
        syllable, mark, degree = solfa.syllable(pitch, doh_pc, ref_doh)
        notes.append(
            TranscribedNote(
                pitch_midi=pitch,
                start_beat=start_beat,
                dur_beats=dur_beats,
                degree=degree,
                solfa=syllable,
                octave_mark=mark,
                conf=0.8,
            )
        )
    return notes


def _perfect(phrase=PHRASE, key_name: str = "C major") -> list[TranscribedNote]:
    """The estimate a fully fixed pipeline returns: right notes, anchored to beat 0."""
    return _labelled([(pitch, float(i), 1.0) for i, pitch in enumerate(phrase)], key_name)


def _shifted(notes: list[TranscribedNote], beats: float) -> list[TranscribedNote]:
    """The same notes pushed *beats* later — leading silence preserved as rests."""
    return [
        TranscribedNote(
            pitch_midi=n.pitch_midi,
            start_beat=n.start_beat + beats,
            dur_beats=n.dur_beats,
            degree=n.degree,
            solfa=n.solfa,
            octave_mark=n.octave_mark,
            conf=n.conf,
        )
        for n in notes
    ]


def _anchor_to_zero(notes: list[TranscribedNote]) -> list[TranscribedNote]:
    """The Phase 2b fix, simulated: re-anchor the first onset to beat 0."""
    if not notes:
        return []
    return _shifted(notes, -min(n.start_beat for n in notes))


# ── Defect 1 — beat phase discarded ───────────────────────────────────────────


def test_defect1_anchoring_to_beat_zero_improves_both_domains():
    """Phase 2b must raise the gated timing metrics, not lower them.

    This is the exact failure that made the first harness dangerous: scored against
    ``onset_sec`` (lead-in included) the defective estimate matched the reference and
    the *fix* scored 0.000.
    """
    refs = _refs(lead_in_sec=0.8)
    defective = _shifted(_perfect(), 1.5)  # 0.8 s of silence, quantized to 1.5 beats
    fixed = _anchor_to_zero(defective)

    before = metrics.note_metrics_seconds(refs, defective, REF_BPM, REF_BPM)
    after = metrics.note_metrics_seconds(refs, fixed, REF_BPM, REF_BPM)
    assert after["f1"] > before["f1"], (
        f"anchoring to beat 0 lowered notes.f1 ({before['f1']:.3f} -> {after['f1']:.3f}); "
        "the gate would demand the Phase 2b fix be reverted"
    )
    assert after["f1"] == pytest.approx(1.0)

    before_beats = metrics.onset_metrics_beats(refs, defective, REF_BPM, REF_BPM)
    after_beats = metrics.onset_metrics_beats(refs, fixed, REF_BPM, REF_BPM)
    assert after_beats["f1"] > before_beats["f1"]
    assert after_beats["f1"] == pytest.approx(1.0)


def test_defect1_signature_is_visible_while_the_defect_is_present():
    """A pure phase error must read as one: shift-invariant high, raw low.

    This pair is the whole reason the beat domain exists.  It is also what the
    unnormalised version could never show — a few percent of tempo error made the
    ref->est relation affine and the shift search returned 0.000 on the real lead-in
    case, bit-identical to its own control.
    """
    refs = _refs(lead_in_sec=0.8)
    defective = _shifted(_perfect(), 1.5)

    beats = metrics.onset_metrics_beats(refs, defective, REF_BPM, REF_BPM)
    assert beats["f1_shift_invariant"] > beats["f1"] + 0.5
    assert beats["best_shift_beats"] == pytest.approx(1.5), (
        "sign convention: best_shift_beats is how many beats LATER the estimate sits"
    )


def test_defect1_fix_is_specific_to_the_defect():
    """Re-anchoring must not flatter an estimate that was already correct.

    Without this, a metric that merely likes the transform passes the test above.
    """
    refs = _refs()
    already_right = _perfect()

    before = metrics.note_metrics_seconds(refs, already_right, REF_BPM, REF_BPM)
    after = metrics.note_metrics_seconds(refs, _anchor_to_zero(already_right), REF_BPM, REF_BPM)
    assert before["f1"] == pytest.approx(1.0)
    assert after["f1"] == pytest.approx(before["f1"])


# ── Defect 2 — tempo measured from the wrong file ──────────────────────────────


def test_defect2_correcting_the_tempo_cannot_lower_the_headline_metric():
    """Fixing the tempo must not read as a regression on ``notes.f1``.

    The trap: the seconds window used to be keyed to the tempo the pipeline
    *reported*, so over-reporting tempo shrank the pipeline's own quantization error
    in seconds and bought score.  Measured on the fast-sixteenth case, the same
    hearing scored 0.774 at its reported 345 BPM and 0.516 once the tempo was
    corrected — a 0.258 "regression" for landing a fix.
    """
    refs = _refs()
    est = _perfect()  # correct in beats; only the reported tempo is wrong

    wrong_tempo = metrics.note_metrics_seconds(refs, est, 172, REF_BPM)  # 2x over-reported
    right_tempo = metrics.note_metrics_seconds(refs, est, REF_BPM, REF_BPM)

    assert right_tempo["f1"] >= wrong_tempo["f1"], (
        f"over-reporting tempo scored {wrong_tempo['f1']:.3f} against {right_tempo['f1']:.3f} "
        "for the correct tempo — the estimate is buying its own tolerance"
    )
    assert right_tempo["f1"] == pytest.approx(1.0)

    tempo_before = metrics.tempo_metrics(REF_BPM, 172)
    tempo_after = metrics.tempo_metrics(REF_BPM, REF_BPM)
    assert tempo_after["rel_error"] < tempo_before["rel_error"]
    assert tempo_after["octave_error"] is False

    # A genuine doubling is 2 x 96, not the 172 above — 172 is 2x the corpus's 88 BPM
    # key cases, and at a 96 BPM reference it sits outside the +/-4 % window, so it is
    # simply wrong rather than metrically confused.  Both readings matter: the flag has
    # to fire on a real metrical slip and stay quiet on ordinary error.
    assert metrics.tempo_metrics(REF_BPM, 2 * REF_BPM)["octave_error"] is True
    assert metrics.tempo_metrics(REF_BPM, 172)["octave_error"] is False


@pytest.mark.parametrize("reported_bpm", [48, 96, 117, 172, 345])
def test_defect2_tolerance_is_keyed_to_the_reference_tempo_only(reported_bpm):
    """The window must be a property of the corpus, never of the number under test."""
    assert metrics._onset_tolerance_sec(REF_BPM) == metrics._onset_tolerance_sec(REF_BPM)
    # Scored with beats held correct, the best achievable score is at the true tempo:
    # no reported tempo can beat it, which is the invariant that keeps the metric honest.
    refs = _refs()
    est = _perfect()
    at_truth = metrics.note_metrics_seconds(refs, est, REF_BPM, REF_BPM)["f1"]
    reported = metrics.note_metrics_seconds(refs, est, reported_bpm, REF_BPM)["f1"]
    assert reported <= at_truth + 1e-9


# ── Defect 3 — key algorithm (and what it actually costs) ─────────────────────


def test_defect3_fixing_a_subdominant_error_improves_key_and_solfa_together():
    """The measured AardenEssen failure: C major heard as F major, its subdominant.

    ``plagal_fourth_c_major`` and ``triplets_eighth_c_major`` both do exactly this on
    the real corpus, and both score ``solfa.degree_accuracy`` 0.000 — a wrong tonic
    re-labels every syllable, which is why Phase 4 is the highest-leverage phase.
    """
    refs = _refs()
    wrong_key = _labelled([(p, float(i), 1.0) for i, p in enumerate(PHRASE)], "F major")
    right_key = _perfect(key_name="C major")

    before = metrics.solfa_metrics(refs, wrong_key, "C major", REF_BPM, REF_BPM)
    after = metrics.solfa_metrics(refs, right_key, "C major", REF_BPM, REF_BPM)
    assert after["syllable_accuracy"] > before["syllable_accuracy"]
    assert after["degree_accuracy"] > before["degree_accuracy"]
    assert after["syllable_accuracy"] == pytest.approx(1.0)

    key_before = metrics.key_metrics("C major", "F major")
    key_after = metrics.key_metrics("C major", "C major")
    assert key_after["weighted_score"] > key_before["weighted_score"]
    assert key_before["fifth_confusion"] is True  # subdominant counts as a fifth error
    assert key_after["exact"] is True


def test_relative_key_confusion_does_not_change_a_single_syllable():
    """Measured, and load-bearing for how Phase 4 should be prioritised.

    Movable-do is la-based for minor, so ``doh_pitch_class`` maps A minor to the same
    doh as C major (9 + 3 mod 12 = 0).  A relative-key confusion is therefore a wrong
    *label on the key* and a completely correct set of syllables, which is why
    ``relative_bait_c_major`` and ``fast_sixteenths_c_major`` score
    ``key.exact`` 0 with ``solfa.degree_accuracy`` 1.000 on the real corpus.

    This is asserted rather than merely commented so that nobody "fixes" relative
    confusion expecting the headline solfa number to move: it will not, and the
    subdominant error is where the product damage actually is.
    """
    refs = _refs()
    as_a_minor = _labelled([(p, float(i), 1.0) for i, p in enumerate(PHRASE)], "A minor")

    assert metrics.key_metrics("C major", "A minor")["exact"] is False
    assert metrics.key_metrics("C major", "A minor")["relative_confusion"] is True

    solfa_scores = metrics.solfa_metrics(refs, as_a_minor, "C major", REF_BPM, REF_BPM)
    assert solfa_scores["syllable_accuracy"] == pytest.approx(1.0)
    assert solfa_scores["degree_accuracy"] == pytest.approx(1.0)


# ── Defect 4 — key confidence is not calibrated ───────────────────────────────


def _outcome(name: str, *, exact: bool, confidence: float) -> runner.CaseOutcome:
    """A minimal scored outcome carrying just the two columns calibration reads."""
    return runner.CaseOutcome(
        name=name,
        tags=(),
        ok=True,
        error="",
        ref_key="C major",
        est_key="C major" if exact else "F major",
        ref_tempo=REF_BPM,
        est_tempo=REF_BPM,
        n_ref=len(PHRASE),
        n_est=len(PHRASE),
        metrics={"key.exact": exact, "key.confidence": confidence},
    )


def test_defect4_calibrating_confidence_raises_the_separation():
    """Phase 4b changes no key decision, so this is the only column that can move.

    The corpus measures ``key.confidence_separation`` at **-0.042** today: the mean
    confidence on a correct key sits *below* the most confident wrong answer, so no
    threshold exists and the mobile editable-key prompt cannot fire when it should.
    Negative separation is the defect; this asserts the metric rewards fixing it.
    """
    uncalibrated = [
        _outcome("right_a", exact=True, confidence=0.81),
        _outcome("right_b", exact=True, confidence=0.57),
        _outcome("wrong_a", exact=False, confidence=0.72),
    ]
    calibrated = [
        _outcome("right_a", exact=True, confidence=0.93),
        _outcome("right_b", exact=True, confidence=0.88),
        _outcome("wrong_a", exact=False, confidence=0.31),
    ]

    before = runner.aggregate(uncalibrated)["key.confidence_separation"]
    after = runner.aggregate(calibrated)["key.confidence_separation"]
    assert before < 0.0, "fixture should reproduce the measured anti-calibration"
    assert after > before
    assert after > 0.0


def test_confidence_separation_is_absent_rather_than_faked_when_undefined():
    """With no wrong answer the question has no answer, and a 0.0 would read as bad."""
    all_right = [
        _outcome("right_a", exact=True, confidence=0.9),
        _outcome("right_b", exact=True, confidence=0.8),
    ]
    assert "key.confidence_separation" not in runner.aggregate(all_right)


# ── Defect 5 — duration grid ──────────────────────────────────────────────────


def test_defect5_correct_durations_improve_the_only_duration_column():
    """``notes.f1_with_offset`` is the one metric that observes duration at all.

    Phase 2c changes the quantize divisors and the 0.25-beat duration floor.  Without
    a duration-sensitive column that change moves no number in either direction, so
    it could be neither justified nor protected.
    """
    refs = _refs()
    correct = _perfect()
    crushed = _labelled([(p, float(i), 0.5) for i, p in enumerate(PHRASE)], "C major")

    before = metrics.note_metrics_seconds(refs, crushed, REF_BPM, REF_BPM)
    after = metrics.note_metrics_seconds(refs, correct, REF_BPM, REF_BPM)

    assert after["f1_with_offset"] > before["f1_with_offset"]
    # Onsets and pitches are identical in both, so the onset-only F1 must NOT move:
    # the two columns measure different things and are not allowed to blur together.
    assert before["f1"] == pytest.approx(after["f1"])


# ── Defect 6 — vibrato fragmentation, and the guard against over-merging ──────


def _fragmented(phrase=PHRASE) -> list[TranscribedNote]:
    """Each note plus a semitone-neighbour sliver — a hand-built fragmentation model.

    What this module tests is that the METRICS punish fragmentation in the right
    direction, on note lists built here.  That still holds, so the assertions below
    are unchanged.  The *premise* in the name is no longer what the corpus does, and
    saying so here is cheaper than someone re-deriving it:

    ``vibrato_heavy`` returns 30 estimated notes for 11 reference ones at ``notes.f1``
    0.098 (this docstring said 0.049 before the phase 2-4 work moved it).  But its
    fragments are not one semitone wide.  Basic Pitch fires at BOTH neighbours of a
    wobbling pitch, so consecutive fragments sit TWO semitones apart — measured
    interval histogram {0: 12, 1: 5, 2: 43, 3: 2, 5: 1} over 63 adjacencies — and its
    label is outright wrong on 49 of 64 events.  The real defect there is
    MISLABELLING, not fragmentation, which is why the semitone-tolerant merge (phase
    3c) was struck; see the vibrato_heavy comment in corpus.py.

    So ``pitch + 1`` below is a deliberate synthetic stand-in for "a neighbouring
    ghost", not a claim about the corpus.  Do not use it as evidence for how wide a
    real merge tolerance should be.
    """
    events: list[tuple[int, float, float]] = []
    for i, pitch in enumerate(phrase):
        events.append((pitch, float(i), 0.5))
        events.append((pitch + 1, i + 0.5, 0.5))  # the sharp half of the vibrato swing
    return _labelled(events, "C major")


def test_defect6_merging_vibrato_fragments_improves_the_gated_metrics():
    refs = _refs()
    fragmented = _fragmented()
    merged = _perfect()

    before = metrics.note_metrics_seconds(refs, fragmented, REF_BPM, REF_BPM)
    after = metrics.note_metrics_seconds(refs, merged, REF_BPM, REF_BPM)
    assert after["f1"] > before["f1"]
    assert after["semitone_neighbour_ghosts"] < before["semitone_neighbour_ghosts"]

    solfa_before = metrics.solfa_metrics(refs, fragmented, "C major", REF_BPM, REF_BPM)
    solfa_after = metrics.solfa_metrics(refs, merged, "C major", REF_BPM, REF_BPM)
    assert solfa_after["ghost_count"] < solfa_before["ghost_count"]


def test_defect6_over_merging_a_genuine_semitone_step_is_punished():
    """That the METRIC punishes over-merging — which is only half an instrument.

    Phase 3c (the semitone-tolerant merge) was measured and struck, so nothing in the
    pipeline can over-merge today.  This stays because it pins the property any future
    attempt would need: drop half a genuine semitone phrase and recall must fall.

    Keep the other half in view if that day comes.  This test scores a hand-built note
    list, so it proves the metric responds.  It does NOT prove the corpus would catch a
    real over-merge — measured, it would not: a wrong cross-note merge on
    ``semitone_steps_c_major`` leaves its note count and pitch sequence byte-identical,
    because Basic Pitch emits two fragments per note and the melody overlap resolver
    truncates the survivor back.  See the corpus.py comment on that case.  The missing
    instrument is a unit test on the merge's own decisions, not a metric assertion.
    """
    refs = _refs(SEMITONE_PHRASE)
    honest = _perfect(SEMITONE_PHRASE)
    over_merged = _labelled(
        [(p, float(i), 1.0) for i, p in enumerate(SEMITONE_PHRASE) if i % 2 == 0],
        "C major",
    )

    kept = metrics.note_metrics_seconds(refs, honest, REF_BPM, REF_BPM)
    swallowed = metrics.note_metrics_seconds(refs, over_merged, REF_BPM, REF_BPM)

    assert kept["f1"] == pytest.approx(1.0)
    assert swallowed["recall"] < kept["recall"], (
        "dropping half a genuine semitone phrase must cost recall, or an "
        "over-aggressive vibrato merge would read as an improvement"
    )
    assert swallowed["f1"] < kept["f1"]


# ── Accidentals — the user-visible face of defect 6 ───────────────────────────

# A minor harmonic, whose raised 7th (G#) is a chromatic syllable under la-based minor:
# doh is C, so G# is 8 semitones above it, which the ascending table spells "se".  This
# phrase is the reason the accidentals column counts excess and not total.
HARMONIC_MINOR_PHRASE = (69, 71, 72, 74, 76, 77, 80, 81, 80, 77, 76)


def test_a_genuine_accidental_is_not_counted_against_the_pipeline():
    """The trap this column was designed around, pinned so it cannot be reintroduced.

    "Fewer accidentals is better" is the obvious reading of the complaint and it is
    wrong: la-based minor writes the harmonic minor's raised 7th with an accidental, so
    a perfect transcription of this phrase carries one and must score zero excess.  A
    column that counted totals would rank a pipeline that flattened the 7th — losing the
    key's defining note — above one that got it right.
    """
    refs = _refs(HARMONIC_MINOR_PHRASE)
    perfect = _perfect(HARMONIC_MINOR_PHRASE)
    scored = metrics.solfa_metrics(refs, perfect, "A minor", REF_BPM, REF_BPM)

    assert scored["ref_chromatic_count"] > 0, "fixture no longer contains an accidental"
    assert scored["chromatic_count"] == scored["ref_chromatic_count"]
    assert scored["chromatic_ghosts"] == 0
    assert scored["syllable_accuracy"] == pytest.approx(1.0)


def test_spurious_accidentals_are_counted():
    refs = _refs()
    fragmented = _fragmented()  # every note plus a sharp neighbour sliver
    perfect = _perfect()

    dirty = metrics.solfa_metrics(refs, fragmented, "C major", REF_BPM, REF_BPM)
    clean = metrics.solfa_metrics(refs, perfect, "C major", REF_BPM, REF_BPM)

    assert clean["ref_chromatic_count"] == 0, "C major scale fixture has no accidentals"
    assert clean["chromatic_ghosts"] == 0
    assert dirty["chromatic_ghosts"] > 0, (
        "sharp-neighbour ghosts are exactly the accidentals the bug report is about"
    )


def test_accidentals_are_counted_even_when_nothing_matches():
    """The no-pairs path, which is where accidentals are worst rather than absent.

    ``vibrato_heavy`` matches almost nothing, so a column computed only from matched
    pairs would report its accidentals as zero — reading a total failure as clean
    notation.  Hence the count sits ahead of the no-pairs return, and this pins it.

    Nothing matches here because the onsets are 50 beats away, not because the pitches
    are wrong: the matcher pairs on time with pitch as the tie-break only, precisely so
    that a wrong pitch shows up as a label error rather than as a non-match.
    """
    refs = _refs()
    unmatchable = _labelled(
        [(p + 6, 50.0 + i, 1.0) for i, p in enumerate(PHRASE)], "C major"
    )
    scored = metrics.solfa_metrics(refs, unmatchable, "C major", REF_BPM, REF_BPM)

    assert scored["matched"] == 0
    assert scored["chromatic_ghosts"] > 0


# ── Defect 7 — time signature (deferred by the plan) ──────────────────────────


def test_defect7_no_metric_depends_on_the_hardcoded_time_signature():
    """Deferred, so the only requirement is that landing it later cannot break the gate."""
    sources = inspect.getsource(metrics) + inspect.getsource(runner)
    assert "time_signature" not in sources, (
        "a metric started reading time_signature; defect 7 is deferred, so scoring "
        "must stay independent of it"
    )


# ── Confidence — a consensus number, not a loudness reading ───────────────────

# Three of the eleven notes come back a semitone sharp, and Basic Pitch is *more*
# confident about those than about the eight it got right.  That inversion is not
# invented for the fixture: it is what the corpus measures now that the amplitude floor
# deletes the easy ghosts amplitude used to separate, which is why conf.auc sits at
# 0.551 and conf.separation at -0.012 with bare amplitude.
_WRONG_INDICES = (2, 5, 8)
_AMP_CORRECT = 0.50
_AMP_WRONG = 0.62  # higher than the correct notes: the measured anti-correlation


def _events_for_confidence(*, pyin_sees_the_truth: bool) -> list[Event]:
    """One event per note of PHRASE, three of them a semitone sharp.

    ``pyin_sees_the_truth`` is the whole experiment.  True is the ordinary case: pyin
    tracked the sung pitch, so it contradicts the three wrong notes.  False is the
    drift case, where pyin followed the singer off-pitch and agrees with the error —
    there is no second opinion to be had, and the fix must not pretend otherwise.
    """
    events = []
    for i, true_pitch in enumerate(PHRASE):
        wrong = i in _WRONG_INDICES
        events.append(
            Event(
                start=i * BEAT_SEC,
                end=(i + 1) * BEAT_SEC,
                pitch=true_pitch + 1 if wrong else true_pitch,
                amp=_AMP_WRONG if wrong else _AMP_CORRECT,
                pyin_midi=(
                    float(true_pitch)
                    if pyin_sees_the_truth
                    else float(true_pitch + 1 if wrong else true_pitch)
                ),
                voiced_prob=0.95,
            )
        )
    return events


def _conf_metrics(events: list[Event], *, blended: bool) -> dict:
    """Score *events* through the real metric, with conf assigned either way.

    ``blended`` False is the shipped defect (``conf = evt.amp``); True is the fix.  The
    notes are otherwise identical, so nothing but the confidence column can move.
    """
    notes = [
        TranscribedNote(
            pitch_midi=evt.pitch,
            start_beat=float(i),
            dur_beats=1.0,
            degree=1,
            solfa="d",
            octave_mark="",
            conf=_blend_confidence(evt) if blended else evt.amp,
        )
        for i, evt in enumerate(events)
    ]
    return metrics.note_confidence_metrics(_refs(), notes, REF_BPM, REF_BPM)


def test_confidence_blend_ranks_right_notes_above_wrong_ones():
    """The gated columns are conf.auc and conf.separation, and both are broken today.

    Bare amplitude does not merely fail to rank here, it ranks *backwards*: every wrong
    note outscores every correct one, so auc is 0.0 and separation is negative.  Adding
    pyin's independent reading of the same spans is what makes the ordering recoverable
    at all — neither engine alone can tell which of the two disagreeing pitches is right,
    but disagreement itself is the signal.
    """
    events = _events_for_confidence(pyin_sees_the_truth=True)

    before = _conf_metrics(events, blended=False)
    after = _conf_metrics(events, blended=True)

    assert before["auc"] < 0.5, "fixture should reproduce the measured anti-correlation"
    assert before["separation"] < 0.0
    assert after["auc"] > before["auc"]
    assert after["separation"] > before["separation"]
    assert after["separation"] > 0.0


def test_confidence_blend_is_specific_to_having_a_second_opinion():
    """When pyin agrees with the error there is no consensus to read, and the blend
    must inherit amplitude's failure rather than manufacture a fix.

    This is the ``drift_1_semitone`` case, where the singer drifts and pyin drifts with
    them: measured, that case is the one place the blend *loses* ground (auc 0.960 ->
    0.760).  Uniform agreement makes the blend a monotone function of amplitude, so the
    rank statistic is unchanged — which is the honest outcome and worth pinning, because
    a formula that improved auc here would be scoring its own shape, not the evidence.
    """
    events = _events_for_confidence(pyin_sees_the_truth=False)

    before = _conf_metrics(events, blended=False)
    after = _conf_metrics(events, blended=True)

    assert after["auc"] == before["auc"]
    # Still strictly ordered the wrong way round: no accidental credit.
    assert after["separation"] < 0.0


def test_confidence_blend_changes_nothing_when_pyin_never_spoke():
    """Short clips and librosa failures leave every event without a pyin reading.

    The blend has to be a no-op there, not a rescaling: the client bands the number at
    fixed 0.5 and 0.75 cuts, so dragging a whole clip into a different band on no new
    evidence would be a regression the rank-based auc cannot see.
    """
    silent_pyin = [
        replace(evt, pyin_midi=None, voiced_prob=0.0)
        for evt in _events_for_confidence(pyin_sees_the_truth=True)
    ]

    assert _conf_metrics(silent_pyin, blended=True) == _conf_metrics(
        silent_pyin, blended=False
    )


# ── Meta: the gate's own wiring ────────────────────────────────────────────────


def test_every_recorded_metric_is_deliberately_classified():
    """An unclassified metric is silently gated higher-is-better, which may be wrong.

    ``_regressions`` treats anything absent from both registries as higher-is-better,
    so a newly added lower-is-better column would be gated backwards — the failure
    this whole module exists to prevent, one level up.
    """
    import json

    from tests.accuracy.test_accuracy import BASELINE_PATH, LOWER_IS_BETTER, NOT_A_GATE

    if not BASELINE_PATH.exists():
        pytest.skip("no baseline.json — nothing recorded to classify yet")

    recorded = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    higher_is_better = {
        "notes.precision", "notes.recall", "notes.f1",
        "beats.precision", "beats.recall", "beats.f1", "beats.f1_shift_invariant",
        "key.weighted_score", "key.exact", "key.confidence_separation",
        "key.confidence_auc",
        "solfa.degree_accuracy", "solfa.syllable_accuracy",
    }
    classified = LOWER_IS_BETTER | NOT_A_GATE | higher_is_better

    emitted = set()
    for case in recorded.get("cases", {}).values():
        emitted |= set(case.get("metrics", {}))
    emitted |= set(recorded.get("aggregate", {}))

    unclassified = sorted(emitted - classified)
    assert not unclassified, (
        "these metrics are gated higher-is-better by default; confirm that is right "
        f"and add them to a registry: {unclassified}"
    )


def test_flag_drift_reports_each_difference_and_nothing_else():
    """The provenance note has to be silent when nothing moved, or it is noise."""
    from tests.accuracy.report import _flag_drift

    flags = {"beat_align": True, "key_ensemble": True, "quantize_divisors": [2]}

    assert _flag_drift(flags, flags) == []
    assert _flag_drift(flags, {**flags, "key_ensemble": False}) == ["key_ensemble: False -> True"]
    assert _flag_drift(flags, {**flags, "quantize_divisors": [4]}) == [
        "quantize_divisors: [4] -> [2]"
    ]
    # A baseline written before flags were recorded has none.  Reporting that once beats
    # reporting every flag as a difference against a missing dict.
    assert _flag_drift(flags, None) == ["(baseline predates flag provenance - it records none)"]

    # Printed to a redirected stdout on Windows, which encodes cp1252 — the same reason
    # report.py's table is pure ASCII.
    every_line = "".join(_flag_drift(flags, None) + _flag_drift(flags, {**flags, "beat_align": False}))
    assert every_line.isascii()


def test_the_recorded_baseline_is_the_shipped_configuration():
    """A baseline recorded under non-default flags silently misattributes every delta.

    The corpus fingerprint already refuses a baseline measured on different *audio*.
    Flags are the other half: identical audio through a differently-configured pipeline
    produces numbers that look comparable and are not.  Re-recording while an
    ``NF_*`` override is exported is an easy mistake to make in a shell that has been
    A/Bing flags all afternoon, and it leaves no trace anywhere else.

    If this fails, either unset the overrides and re-record, or you meant to and the
    baseline is not the shipped configuration.
    """
    import json

    from tests.accuracy.report import _effective_flags, _flag_drift
    from tests.accuracy.test_accuracy import BASELINE_PATH

    if not BASELINE_PATH.exists():
        pytest.skip("no baseline.json - nothing recorded to attribute yet")

    recorded = json.loads(BASELINE_PATH.read_text(encoding="utf-8")).get("flags")
    assert recorded is not None, (
        "baseline.json carries no flags block, so what produced it is unknowable; "
        "re-record it with `python -m tests.accuracy.report --write-baseline`"
    )

    drift = _flag_drift(_effective_flags(), recorded)
    assert not drift, "baseline.json was recorded under non-default flags: " + ", ".join(drift)


def test_metrics_are_deterministic_under_reordering_of_tied_onsets():
    """Quantization collapses distinct onsets, so ties are routine.

    mir_eval's matcher maximises the number of pairs and is indifferent to which of
    two feasible candidates it picks, so before the pitch-first tie-break, listing a
    ghost ahead of the real note moved ``degree_accuracy`` from 1.000 to 0.909 — four
    times the gate's tolerance — with nothing about the transcription changed.
    """
    refs = _refs()
    est = _perfect()
    ghost = TranscribedNote(
        pitch_midi=PHRASE[0] + 2,  # whole-tone ghost sharing the first note's slot
        start_beat=0.0,
        dur_beats=1.0,
        degree=2,
        solfa="r",
        octave_mark="",
        conf=0.3,
    )

    ghost_last = est + [ghost]
    ghost_first = [ghost] + est

    for scorer in (
        lambda notes: metrics.note_metrics_seconds(refs, notes, REF_BPM, REF_BPM),
        lambda notes: metrics.onset_metrics_beats(refs, notes, REF_BPM, REF_BPM),
        lambda notes: metrics.solfa_metrics(refs, notes, "C major", REF_BPM, REF_BPM),
    ):
        assert scorer(ghost_last) == scorer(ghost_first)
