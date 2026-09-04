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
import math
from dataclasses import replace

import pytest
from app.pipeline import solfa
from app.pipeline.transcriber import (
    Event,
    TranscribedNote,
    _blend_confidence,
    _parse_key_override,
    _resolve_melody_overlaps,
    _select_melody_path,
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

    One whole-clip ``reference_doh`` from the median of the pitch list, chromatic
    syllables chosen by melodic direction — the same calls as transcriber.py:779-788.
    Going through the real solfa engine rather than hand-writing syllables means a
    fixture can never assert a labelling the product would not actually produce, and
    that is why this function has to move whenever ``transcribe`` does.
    """
    key_obj = _parse_key_override(key_name)
    doh_pc = solfa.doh_pitch_class(key_obj.tonic.pitchClass, key_obj.mode)
    ref_doh = solfa.reference_doh([pitch for pitch, _, _ in events], doh_pc)
    spelling = solfa.ascending_flags([pitch for pitch, _, _ in events])

    notes = []
    for i, (pitch, start_beat, dur_beats) in enumerate(events):
        syllable, mark, degree = solfa.syllable(pitch, doh_pc, ref_doh, spelling[i])
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


# ── The wobble fuse — a unit test on the resolver's own decisions ──────────────

# The instrument the test above says is missing.  A corpus metric cannot tell "fused
# the right pair" from "fused nothing and got lucky", so the fuse rule is exercised
# here against its own inputs, at the two ends of the distribution its constants were
# read off.  Measured on the events entering stage 6, as a fraction of the shorter
# event's duration:
#
#   genuine legato steps   n=6    min 0.021  median 0.100  max 0.100
#   wobble slivers         n=38   min 0.091  median 0.800  max 1.000
#
# A step bleeds at its *edge*; a sliver sits *inside* its note.  The two fixtures below
# sit at 1.000 and 0.100 — the sliver extreme and the tightest genuine step — so
# widening ``WOBBLE_MIN_OVERLAP_FRACTION`` past the step population fails the second
# test and narrowing the pitch tolerance to nothing fails the first.

_SLIVER_SEC = 0.10  # comfortably above the 0.04 s final duration floor, on purpose


def _wobbling_events(phrase=PHRASE) -> list[Event]:
    """Each note with a semitone-neighbour sliver sitting wholly inside it.

    This is the population the accidentals complaint is made of: the sliver is a
    semitone off, so it is chromatic against the key by definition and prints a sharp.

    Two details are deliberate.  The sliver is *louder* than the note it belongs to,
    because amplitude demonstrably does not separate the two — with the fuse absent
    this pair reaches the truncate branch and both survive.  And every fragment is
    longer than the 0.04 s floor, so nothing here can be removed by the duration
    filter: if the slivers disappear, the fuse is what removed them.
    """
    events: list[Event] = []
    for i, pitch in enumerate(phrase):
        base = i * BEAT_SEC
        events.append(Event(start=base, end=base + 0.60, pitch=pitch, amp=0.6))
        events.append(
            Event(start=base + 0.25, end=base + 0.25 + _SLIVER_SEC, pitch=pitch + 1, amp=0.7)
        )
    return events


def _legato_events(phrase=SEMITONE_PHRASE) -> list[Event]:
    """Consecutive notes bleeding into each other at the boundary, one beat apart.

    ``0.694`` is chosen so the overlap is 0.100 of the shorter event — the widest
    genuine step measured on the corpus, i.e. the case the fuse comes closest to
    swallowing.  Equal amplitudes so the resolver takes its truncate branch.
    """
    return [
        Event(start=i * BEAT_SEC, end=i * BEAT_SEC + 0.694, pitch=pitch, amp=0.6)
        for i, pitch in enumerate(phrase)
    ]


def _as_notes(events: list[Event]) -> list[TranscribedNote]:
    """Label events in the beat domain, the way stages 7-8 eventually do."""
    return _labelled(
        [(e.pitch, e.start / BEAT_SEC, (e.end - e.start) / BEAT_SEC) for e in events],
        "C major",
    )


def test_the_wobble_fuse_removes_the_accidentals_it_was_built_for():
    """Fusing a contained sliver back into its note is what clears the ghost accidentals.

    "Before" is the resolver's input rather than a hand-built list: with no pitch test
    the resolver kept these slivers, which is the defect as shipped.  "After" is what
    the rule actually returns, so the assertion is on the real decision and not on a
    model of it.
    """
    refs = _refs()
    events = _wobbling_events()
    assert all(e.end - e.start >= 0.04 for e in events), (
        "a fragment short enough for the duration filter would make this vacuous"
    )

    survivors = _resolve_melody_overlaps(events)

    assert [e.pitch for e in survivors] == list(PHRASE), (
        "every sliver must be gone and every note must keep its own pitch"
    )

    before = metrics.solfa_metrics(refs, _as_notes(events), "C major", REF_BPM, REF_BPM)
    after = metrics.solfa_metrics(refs, _as_notes(survivors), "C major", REF_BPM, REF_BPM)

    assert before["chromatic_ghosts"] > 0, "fixture no longer reproduces the complaint"
    assert after["chromatic_ghosts"] == 0
    assert after["ghost_count"] < before["ghost_count"]


def test_the_wobble_fuse_leaves_a_genuine_legato_semitone_step_alone():
    """Specificity, and it is not hypothetical — a pitch-only rule failed exactly here.

    ``WOBBLE_SEMITONES = 1`` on its own fused real steps on six clean cases, one note
    each, taking ``notes.recall`` 0.935 → 0.889.  ``semitone_steps_c_major`` did not
    catch it, because its steps do not overlap; these do, which is the whole point.
    """
    refs = _refs(SEMITONE_PHRASE)
    events = _legato_events()

    survivors = _resolve_melody_overlaps(events)

    assert [e.pitch for e in survivors] == list(SEMITONE_PHRASE), (
        "a step that bleeds at its edge is two notes, not one wobbling note"
    )

    before = metrics.note_metrics_seconds(refs, _as_notes(events), REF_BPM, REF_BPM)
    after = metrics.note_metrics_seconds(refs, _as_notes(survivors), REF_BPM, REF_BPM)
    assert after["recall"] >= before["recall"]

    # And the fuse cannot take credit on the accidentals column here: this phrase is
    # diatonic, so there is nothing for it to clean and both readings must read zero.
    scored = metrics.solfa_metrics(refs, _as_notes(survivors), "C major", REF_BPM, REF_BPM)
    assert scored["chromatic_ghosts"] == 0


# ── Accidentals — the user-visible face of defect 6 ───────────────────────────

# A minor harmonic, whose raised 7th (G#) is a chromatic syllable under la-based minor:
# doh is C, so G# is 8 semitones above it — "se" rising, "la" falling.  It occurs twice
# here, once approached from below and once from above, which is what makes it the
# fixture for the directional-spelling trade recorded further down.  This phrase is also
# the reason the accidentals column counts excess and not total.
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


# ── Defect 7 — time signature (measured, and the detector STRUCK) ─────────────


def test_defect7_no_metric_depends_on_the_hardcoded_time_signature():
    """No longer deferred — measured, and this is now a guard rather than a placeholder.

    Both routes to a meter detector were measured and struck (the post-mortem is at
    the ``meter.TimeSignature`` site in ``app/pipeline/transcriber.py``): the acoustic
    ``tempogram_ratio`` cue is anti-correlated on this corpus and its sign flips on a
    3 BPM step, and the symbolic bar-length cue declines on 5 of 5 real cases while
    picking the wrong bar length on 0-of-38 4/4 cases by a *wider* margin than the two
    it gets right.

    What matters here is that the gate was never allowed to pretend otherwise.  With
    every corpus case at 4/4 and the pipeline returning the constant "4/4", a
    ``meter.exact`` column would have read 1.000 for an always-4/4 detector and 1.000
    for a perfect one — a metric that reads the perfect score and cannot move.  Adding
    a 3/4 and a 6/8 case lifts the honest headroom to a single case (0.025), and one of
    those two is laundered: the 6/8 clip's tempo comes back 45 against a true 132, so a
    correct "6/8" engraves a bar 2.9x too long and still scores exact=True.  So the
    requirement is unchanged and now load-bearing: scoring stays independent of the
    meter until something can actually be scored.
    """
    sources = inspect.getsource(metrics) + inspect.getsource(runner)
    assert "time_signature" not in sources, (
        "a metric started reading time_signature; the meter detector is struck, so "
        "scoring must stay independent of it — see the post-mortem in transcriber.py"
    )


def test_the_reference_metrical_level_is_distinguishable_from_no_level_at_all():
    """``metrical_factor`` must separate a perfect tempo from an incommensurate one.

    The defect: ``TEMPO_METRICAL_FACTORS`` omitted 1.0, so "the estimate is on the
    reference's own level" fell through to the 0.0 the docstring calls "none".
    Measured over the 38-case report that collapsed 10 exact tempi and 25
    incommensurate misses into one bucket — 35 of 38 cases reading the same value —
    which defeats the column's stated purpose of telling a metrical slip from noise.

    Directional: with 1.0 absent an exact reading is indistinguishable from a 1.219x
    miss; with it present they separate.
    """
    defective = tuple(f for f in metrics.TEMPO_METRICAL_FACTORS if f != 1.0)

    def factor(ref_bpm, est_bpm, factors):
        for f in factors:
            if abs(est_bpm - f * ref_bpm) <= metrics.TEMPO_OCTAVE_TOLERANCE * f * ref_bpm:
                return f
        return 0.0

    # 117 against 96 is the real signature of the eight residual cases: 1.219x, which
    # is not any known level.  88 against 88 is a perfect reading.
    assert factor(96, 96, defective) == factor(96, 117, defective) == 0.0, (
        "this test no longer reproduces the defect it exists to catch"
    )

    assert metrics.tempo_metrics(96, 96)["metrical_factor"] == 1.0
    assert metrics.tempo_metrics(96, 117)["metrical_factor"] == 0.0
    assert metrics.tempo_metrics(88, 86)["metrical_factor"] == 1.0, (
        "86 against 88 is inside MIREX's +/-4 %, so it is the reference level with a "
        "small error — abs_error carries the magnitude, not the level label"
    )


def test_naming_the_reference_level_does_not_disturb_the_gated_octave_flag():
    """Specificity: ``octave_error`` is the gated bool and must not move.

    It tests membership in (2.0, 0.5), and no estimate can sit within +/-4 % of both
    1.0 and 2.0, so adding 1.0 to the front of the tuple cannot steal a match from
    either.  Measured across the corpus: 0 octave errors before and after.
    """
    assert metrics.tempo_metrics(96, 192)["metrical_factor"] == 2.0
    assert metrics.tempo_metrics(96, 192)["octave_error"] is True
    assert metrics.tempo_metrics(96, 48)["octave_error"] is True
    assert metrics.tempo_metrics(96, 96)["octave_error"] is False
    assert metrics.tempo_metrics(96, 117)["octave_error"] is False

    # The clean multiples the corpus really contains still report as multiples.
    assert metrics.tempo_metrics(88, 345)["metrical_factor"] == 4.0
    assert metrics.tempo_metrics(96, 144)["metrical_factor"] == 1.5
    # And a missing tempo is still "no level", which stays true under the new reading.
    assert metrics.tempo_metrics(96, 0)["metrical_factor"] == 0.0


# ── Chromatic spelling — directional, and what that costs ─────────────────────

# A chromatic descent: E Eb D Db C.  Both Eb and Db are approached from above, so both
# take flat-side syllables.  Spelled from the ascending table the same clip reads
# "m re r de d" — the sharp names for pitches the music is falling through, which is the
# defect this section pins.
CHROMATIC_DESCENT = (64, 63, 62, 61, 60)

# The same shape rising, as the control.
CHROMATIC_ASCENT = (60, 61, 62, 63, 64)


def _syllables(notes: list[TranscribedNote]) -> list[str]:
    return [n.solfa for n in notes]


def test_a_falling_chromatic_is_spelled_from_the_flat_side():
    """The user-visible half: what the sheet actually prints for a descent."""
    assert _syllables(_perfect(CHROMATIC_DESCENT)) == ["m", "ma", "r", "ra", "d"]


def test_a_rising_chromatic_is_still_spelled_from_the_sharp_side():
    """Specificity: the fix must not simply have swapped one table for the other."""
    assert _syllables(_perfect(CHROMATIC_ASCENT)) == ["d", "de", "r", "re", "m"]


def test_ground_truth_moved_with_the_pipeline():
    """Without this, a *correct* descending spelling would have scored as an error.

    ``solfa_metrics`` built its reference labels from the ascending table always, so the
    moment ``transcribe`` started selecting the flat side, the metric would have read
    every correct flat syllable as wrong — a fix landing as a regression.  Both halves
    of that are asserted: the correct spelling scores 1.0, and the old spelling, fed in
    deliberately, now scores below it.
    """
    refs = _refs(CHROMATIC_DESCENT)
    correct = _perfect(CHROMATIC_DESCENT)
    scored = metrics.solfa_metrics(refs, correct, "C major", REF_BPM, REF_BPM)
    assert scored["matched"] == len(CHROMATIC_DESCENT)
    assert scored["syllable_accuracy"] == pytest.approx(1.0)

    # The pre-Phase-2 labelling, reconstructed by forcing the ascending table.
    doh_pc = solfa.doh_pitch_class(_parse_key_override("C major").tonic.pitchClass, "major")
    ref_doh = solfa.reference_doh(list(CHROMATIC_DESCENT), doh_pc)
    old = [
        replace(n, solfa=solfa.syllable(n.pitch_midi, doh_pc, ref_doh, True)[0])
        for n in correct
    ]
    old_scored = metrics.solfa_metrics(refs, old, "C major", REF_BPM, REF_BPM)
    assert old_scored["syllable_accuracy"] < scored["syllable_accuracy"]


def test_respelling_never_moves_a_degree():
    """``SEMITONE_TO_DEGREE`` is one shared table, so ``degree_accuracy`` cannot move.

    This is the whole reason Phase 2 is low-risk, and it is worth an assertion rather
    than an argument: the two syllable tables differ on five semitones and agree on the
    degree of all twelve.
    """
    for phrase in (CHROMATIC_DESCENT, CHROMATIC_ASCENT, HARMONIC_MINOR_PHRASE):
        refs = _refs(phrase)
        key = "A minor" if phrase is HARMONIC_MINOR_PHRASE else "C major"
        scored = metrics.solfa_metrics(refs, _perfect(phrase, key), key, REF_BPM, REF_BPM)
        assert scored["degree_accuracy"] == pytest.approx(1.0)


def test_accidental_counts_are_blind_to_which_table_was_used():
    """The gated accidentals column cannot be moved by re-spelling, in either direction.

    ``chromatic_ghosts`` is computed from pitch classes, not syllables, so a descent and
    an ascent through the same chromatic pitches must score identically.  Pinned because
    the alternative — a column that counted flat-side syllables as extra accidentals —
    would have made this phase look like a regression on the metric the original bug
    report was about.
    """
    down = metrics.solfa_metrics(
        _refs(CHROMATIC_DESCENT), _perfect(CHROMATIC_DESCENT), "C major", REF_BPM, REF_BPM
    )
    up = metrics.solfa_metrics(
        _refs(CHROMATIC_ASCENT), _perfect(CHROMATIC_ASCENT), "C major", REF_BPM, REF_BPM
    )
    assert down["chromatic_ghosts"] == up["chromatic_ghosts"] == 0
    assert down["chromatic_count"] == up["chromatic_count"] == 2
    assert down["ref_chromatic_count"] == up["ref_chromatic_count"] == 2


def test_the_harmonic_minor_leading_tone_is_respelled_on_a_descent():
    """The accepted cost of "directional, always", recorded rather than discovered later.

    In A minor the raised 7th G# is the leading tone, and conventional tonic sol-fa
    writes it ``se`` wherever it appears, because its *function* is a sharpened soh
    however the melody reaches it.  A purely directional rule cannot know that: the
    second G# in this phrase is approached from A above, so it prints ``la`` — the
    flattened-la name for the same pitch.  Both names are legitimate for the pitch class
    and neither moves the degree, so nothing measurable regresses, which is precisely why
    this needs an assertion to stay visible.

    The narrow exception ("semitone 8 above doh, in a minor key, is always se") is a
    one-line change to ``ascending_flags`` if the spelling is judged wrong in use.  It is
    not made here because it would need a mode argument in all three tiers, and
    "directional, always" was chosen deliberately.
    """
    labelled = _syllables(_perfect(HARMONIC_MINOR_PHRASE, "A minor"))
    rising_leading_tone = labelled[6]
    falling_leading_tone = labelled[8]

    assert rising_leading_tone == "se", "the rising leading tone must keep the conventional name"
    assert falling_leading_tone == "la", (
        "directional spelling renames the falling leading tone; if this fails the rule "
        "changed, and the trade recorded in this docstring changed with it"
    )
    # And it costs nothing the gate can see, which is the other half of the trade.
    scored = metrics.solfa_metrics(
        _refs(HARMONIC_MINOR_PHRASE),
        _perfect(HARMONIC_MINOR_PHRASE, "A minor"),
        "A minor",
        REF_BPM,
        REF_BPM,
    )
    assert scored["syllable_accuracy"] == pytest.approx(1.0)
    assert scored["chromatic_ghosts"] == 0


def test_direction_is_read_from_melodic_order_not_storage_order():
    """The one way this can go wrong across tiers, pinned in the tier that owns the rule.

    ``ascending_flags`` is positional: it takes a note's neighbours to be its neighbours
    in the list.  The worker's stream is in offset order so it can hand the list straight
    over, but the C# re-label reads an owned collection back out of Postgres in the
    database's order and the client re-labels whatever the API sent — so both sort by
    start beat and scatter the flags back (LibraryDtos.cs, solfa.ts ``deriveSolfa``).
    Shuffling the input here shows what those two are protecting against: the same music
    in a different list order gets different syllables.
    """
    in_order = solfa.ascending_flags(list(CHROMATIC_DESCENT))
    shuffled = solfa.ascending_flags([60, 61, 62, 63, 64])  # the same pitches, ascending
    assert in_order != shuffled


# ── Confidence — a consensus number, not a loudness reading ───────────────────

# Three of the eleven notes come back a semitone sharp, and Basic Pitch is *more*
# confident about those than about the eight it got right.  That inversion is not
# invented for the fixture: it is what the corpus measures now that the amplitude floor
# deletes the easy ghosts amplitude used to separate.
_WRONG_INDICES = (2, 5, 8)
_AMP_CORRECT = 0.50
_AMP_WRONG = 0.62  # higher than the correct notes: the measured anti-correlation
_ONSET_FIRED = 0.85
_ONSET_SILENT = 0.10


def _events_for_confidence(*, onset_agrees: bool) -> list[Event]:
    """One event per note of PHRASE, three of them a semitone sharp.

    ``onset_agrees`` is the whole experiment, and it names the two populations the corpus
    actually contains.

    True is the ordinary ghost: a note assembled from leftover frame energy, which by
    construction has frame support and no onset support — the Onsets & Frames rule, and the
    inversion their ablation measured at 18% relative note F1.  The onset head is silent
    where those three notes claim to start.

    False is the sustained-vibrato case, where the segmenter cuts one vibrato'd note into a
    staircase and every fragment is a real pitch excursion the onset head fires at just as
    hard.  There is no second opinion to be had, and the blend must not pretend otherwise.

    ``pyin_midi`` and ``voiced_prob`` are set on every event and are deliberately inert:
    the blend stopped reading them when the agreement term measured below chance (auc 0.448,
    voiced_prob 0.357).  Leaving them populated makes
    ``test_confidence_blend_changes_nothing_without_an_onset_reading`` a live guard that they
    are still being ignored, rather than a test of an empty struct.
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
                pyin_midi=float(true_pitch),
                voiced_prob=0.95,
                onset_post=(
                    _ONSET_FIRED if onset_agrees or not wrong else _ONSET_SILENT
                ),
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
    """The gated columns are conf.auc and conf.separation, and bare amplitude fails both.

    Amplitude does not merely fail to rank here, it ranks *backwards*: every wrong note
    outscores every correct one, so auc is 0.0 and separation is negative.  Asking Basic
    Pitch's onset head whether it fired where each note claims to start is what makes the
    ordering recoverable — a different question from "what pitch is sounding", which is the
    only question either decode path asks today.
    """
    events = _events_for_confidence(onset_agrees=False)

    before = _conf_metrics(events, blended=False)
    after = _conf_metrics(events, blended=True)

    assert before["auc"] < 0.5, "fixture should reproduce the measured anti-correlation"
    assert before["separation"] < 0.0
    assert after["auc"] > before["auc"]
    assert after["separation"] > before["separation"]
    assert after["separation"] > 0.0


def test_confidence_blend_is_specific_to_having_a_second_opinion():
    """When the onset head fires at the error too, the blend must inherit amplitude's
    failure rather than manufacture a fix.

    This is the sustained-vibrato case, and it is measured, not hypothetical: on
    ``vibrato_rate_k20`` the ghost's onset posterior is 0.926 while a correct note's is
    0.355, because the staircase fragments are genuinely in the audio.  A uniform onset
    reading makes the blend a monotone function of amplitude, so the rank statistic is
    unchanged — which is the honest outcome and worth pinning, because a formula that
    improved auc here would be scoring its own shape rather than the evidence.
    """
    events = _events_for_confidence(onset_agrees=True)

    before = _conf_metrics(events, blended=False)
    after = _conf_metrics(events, blended=True)

    assert after["auc"] == before["auc"]
    # Still strictly ordered the wrong way round: no accidental credit.
    assert after["separation"] < 0.0


def test_confidence_blend_changes_nothing_without_an_onset_reading():
    """``Posteriorgram.capture`` returns None on an unusable ``model_output``.

    The blend has to be a no-op there, not a rescaling: the client bands the number at fixed
    0.5 and 0.75 cuts, so dragging a whole clip into a different band on no new evidence
    would be a regression the rank-based auc cannot see.  The events still carry
    ``pyin_midi`` and ``voiced_prob``, so this also pins that neither is read.
    """
    no_onset = [
        replace(evt, onset_post=None)
        for evt in _events_for_confidence(onset_agrees=False)
    ]

    assert _conf_metrics(no_onset, blended=True) == _conf_metrics(
        no_onset, blended=False
    )


# ── Contour-first segmentation — the persistence rule, on its own inputs ───────

# The corpus proves the outcome; it cannot prove the reason.  ``vibrato_depth_2_0`` going
# 0.000 -> 0.400 is consistent with the persistence rule working and equally consistent with
# a lucky interaction downstream, so the rule is exercised here against contours built to
# sit at the two ends of the distribution its constants were read off.
#
# Both functions are pure array transforms, so no inference runs: pyin's job is to produce
# the contour, and whether a given contour is one note or two is a property of the rule.

_FRAME_SEC = 512 / 22050.0  # pyin hop at the pipeline's rate — 23.2 ms


def _contour(midi_per_frame: list[float], voiced: float = 0.9):
    """(times, midi, voiced_prob) as ``_contour_segments`` expects them."""
    import numpy as np

    midi = np.array(midi_per_frame, dtype=float)
    times = np.arange(midi.size) * _FRAME_SEC
    return times, midi, np.full(midi.size, voiced)


def _vibrato_contour(centre: float, depth: float, n_frames: int = 80):
    """A single note wobbling ``+-depth`` semitones at the corpus's 5.5 Hz.

    ``depth`` above ``CONTOUR_BAND_SEMITONES`` means most of these frames are out of band —
    which is the point.  A rule that cut on being outside would shred this into slivers;
    the rule under test cuts on *staying* outside, and by the sine geometry recorded at
    ``CONTOUR_PERSIST_FRAMES`` a 5.5 Hz wobble never stays out for four frames at any depth.
    """
    import numpy as np

    t = np.arange(n_frames) * _FRAME_SEC
    return [centre + depth * float(v) for v in np.sin(2 * np.pi * 5.5 * t)]


def test_a_wobble_is_one_note_across_the_whole_depth_range_the_corpus_covers():
    """Depth invariance, asserted rather than asserted-about — over the measured range.

    ``vibrato_depth_2_0`` is 2.67x the band, so at any fixed pitch tolerance this contour is
    out of band for most of its length.  That it comes back as one segment means the rule is
    reading persistence and not displacement, which is the whole thesis of contour-first.
    """
    from app.pipeline.transcriber import CONTOUR_BAND_SEMITONES, _contour_segments

    for depth in (0.8, 1.0, 1.5, 1.8, 2.0):
        times, midi, vprob = _contour(_vibrato_contour(60.0, depth))
        assert depth > CONTOUR_BAND_SEMITONES, "a depth inside the band proves nothing"

        segments = _contour_segments(times, midi, vprob)

        assert len(segments) == 1, f"depth {depth} shredded into {len(segments)} notes"
        assert round(segments[0][2]) == 60


def test_depth_invariance_has_a_measured_ceiling_and_this_is_where_it_is():
    """The bound the comment at ``CONTOUR_PERSIST_FRAMES`` states, pinned by measurement.

    Pure sine geometry says the out-run tends to half a period as depth grows — 3.91 frames
    at 5.5 Hz against a threshold of 4, so nominally *any* depth survives.  It does not, and
    the reason is the 9-frame median pre-smooth: the smoother lags, so a smoothed excursion
    stays out of band about a frame longer than the raw one, spending most of that 0.09-frame
    margin.  Measured out-runs and outcomes:

        depth 1.8 -> 2.84 frames, 1 segment      depth 2.5 -> 3.16 frames, 3 segments
        depth 2.0 -> 2.96 frames, 1 segment      depth 4.0 -> 3.45 frames, 5 segments

    This is not academic.  The two cases still below the notes.f1 gate are exactly
    ``vibrato_depth_1_8`` and ``vibrato_depth_2_0``, sitting 0.1 frames inside the cliff —
    so a test that claimed invariance at every depth would be hiding the live defect.
    """
    from app.pipeline.transcriber import _contour_segments

    times, midi, vprob = _contour(_vibrato_contour(60.0, 4.0))

    assert len(_contour_segments(times, midi, vprob)) > 1, (
        "if this now holds the smoother or the threshold changed — re-measure the cliff "
        "and move the bound rather than deleting the test"
    )


def test_a_genuine_step_is_two_notes_even_though_it_is_smaller_than_the_wobble():
    """Specificity, and it is the hard direction: one semitone < the 2.0 wobble above.

    A displacement rule ordered these backwards — it cut the wobble and kept the step.
    Persistence orders them correctly because a step *stays*, and that reordering is the
    entire reason the amplitude floor could be deleted.
    """
    from app.pipeline.transcriber import _contour_segments

    times, midi, vprob = _contour([60.0] * 40 + [61.0] * 40)

    segments = _contour_segments(times, midi, vprob)

    assert len(segments) == 2
    assert [round(s[2]) for s in segments] == [60, 61]


def test_the_cut_lands_on_the_step_and_not_where_the_count_completes():
    """Onset accuracy, which is what made the change-point rule unusable.

    ``CONTOUR_PERSIST_FRAMES`` frames of evidence are needed to *declare* the boundary, but
    the boundary is where the contour left — placing it where the count finished would cost
    every onset 4 frames, and the tolerance at 96 BPM is only ~6.
    """
    from app.pipeline.transcriber import CONTOUR_SMOOTH_FRAMES, _contour_segments

    times, midi, vprob = _contour([60.0] * 40 + [61.0] * 40)

    _first, second = _contour_segments(times, midi, vprob)

    # The median pre-smooth is allowed to lag by its own half-width and no more.
    assert abs(second[0] - 40) <= CONTOUR_SMOOTH_FRAMES // 2 + 1


def test_a_repeated_pitch_is_split_by_amplitude_because_pitch_cannot_see_it():
    """The division of labour, stated as a test: same pitch, so only the dip is evidence.

    This is the defect ``long_clip_over_pyin_cap`` was made of — 91 of 99 notes, the eight
    missing ones all at a phrase seam where the last note and the next first note share a
    pitch.  ``_contour_segments`` is *correct* to return one segment here; there is no pitch
    event to find.  What must not happen is the pipeline stopping there.
    """
    import numpy as np

    from app.pipeline.transcriber import _contour_segments, _split_rearticulations

    times, midi, vprob = _contour([60.0] * 60)
    segments = _contour_segments(times, midi, vprob)
    assert len(segments) == 1, "pitch alone cannot see a repeat — that is the premise"

    # Two strikes: full amplitude decaying into a deep valley, then struck again.
    half = np.concatenate([np.linspace(1.0, 0.15, 30)])
    rms = np.concatenate([half, half])

    split = _split_rearticulations(segments, rms, midi)

    assert len(split) == 2, "the amplitude valley is the only boundary evidence there is"
    assert [round(s[2]) for s in split] == [60, 60]


def test_a_shallow_dip_inside_one_note_is_not_a_repeat():
    """Specificity: tremolo and bow noise dip too, and must not become extra notes.

    ``CONTOUR_REARTICULATION_FRAC`` is where this line sits, and the measured limitation is
    recorded honestly at the function: repeated sixteenths dip only ~15% and therefore still
    fuse.  This test pins the safe side of that trade rather than pretending it is absent.
    """
    import numpy as np

    from app.pipeline.transcriber import (
        CONTOUR_REARTICULATION_FRAC,
        _contour_segments,
        _split_rearticulations,
    )

    times, midi, vprob = _contour([60.0] * 60)
    segments = _contour_segments(times, midi, vprob)

    t = np.arange(60) * _FRAME_SEC
    rms = 1.0 - 0.15 * np.abs(np.sin(2 * np.pi * 6.0 * t))  # 15% tremolo
    assert rms.min() > CONTOUR_REARTICULATION_FRAC, "a dip past the threshold proves nothing"

    assert _split_rearticulations(segments, rms, midi) == segments


def test_a_dip_between_two_different_pitches_is_left_to_the_pitch_rule():
    """The guard that made this stage safe, and it is not a threshold.

    Re-cutting a boundary the pitch rule already found only yields a sliver of the next
    note's attack.  Both halves must notate as the segment's own pitch or the split is
    abandoned whole — so a fixture whose halves disagree must come back untouched even
    though its valley is deep enough to qualify.
    """
    import numpy as np

    from app.pipeline.transcriber import _split_rearticulations

    midi = np.array([60.0] * 30 + [64.0] * 30)
    segment = (0, 60, 60.0, 0.9)
    half = np.linspace(1.0, 0.10, 30)
    rms = np.concatenate([half, half])

    assert _split_rearticulations([segment], rms, midi) == [segment]


# ── The reseed ratchet — why a deep wobble shatters, and what stops it ─────────

# The corpus can only show that ``vibrato_rate_k20`` went 0.667 -> 0.957.  It cannot show
# WHY, and here the why was a specific mechanical claim that had to be checked before the
# constant could be justified: on a cut, ``_contour_segments`` reseeds ``accepted`` from the
# excursion's own frames, so a deep wobble leaves the running centre on the wobble's PEAK.
# The opposite swing is then a whole peak-to-peak away, outside the band again, cutting again
# — a ratchet that feeds itself.  These two tests are the evidence for that claim and for the
# bound on the fix, both on the pure function with no inference in the way.


def _sine_contour(centre: float, depth: float, rate_hz: float, n_frames: int = 120):
    """A held note wobbling ``+-depth`` semitones at ``rate_hz``.

    Rate is a parameter here, unlike ``_vibrato_contour`` above, because the ratchet is
    rate-sensitive in a way the fixed 5.5 Hz cannot show: at 5.5 Hz a depth of 2.0 splits into
    2 segments, but at 4.0 Hz the same depth splits into 22.  A slower wobble spends more
    consecutive frames outside the band per swing, which is what completes the persistence
    count and springs the ratchet, so the slow case is the one that exhibits it.
    """
    import numpy as np

    times = np.arange(n_frames) * _FRAME_SEC
    midi = centre + depth * np.sin(2 * np.pi * rate_hz * times)
    return times, midi, np.full(n_frames, 0.9)


def test_the_reseed_ratchet_shatters_a_deep_wobble_and_the_lookahead_stops_it(monkeypatch):
    """One held note must stay one note, and without the lookahead it becomes 22.

    22 is the measurement that made the ratchet worth fixing rather than a theory about it:
    a single sustained pitch is being reported as twenty-two notes, which is not a tuning
    imprecision but a self-feeding failure.  The lookahead collapses it to 1 by declining the
    cut when the contour comes back to the centre it left, and — the load-bearing detail —
    by skipping to the return frame so ``accepted`` is never reseeded from the excursion at
    all.  Merely clearing the out-of-band counter would re-count the same swing every
    ``CONTOUR_PERSIST_FRAMES`` and the ratchet would survive.
    """
    from app.pipeline import transcriber as T

    times, midi, vp = _sine_contour(60.0, 2.0, 4.0)

    monkeypatch.setattr(T, "CONTOUR_RESEED_LOOKAHEAD_FRAMES", 0)
    shattered = T._contour_segments(times, midi, vp)

    monkeypatch.setattr(T, "CONTOUR_RESEED_LOOKAHEAD_FRAMES", 2)
    whole = T._contour_segments(times, midi, vp)

    assert len(shattered) >= 10, (
        f"the ratchet should shred this contour; got {len(shattered)} segments, so the "
        "fixture no longer exhibits the defect the lookahead exists to fix"
    )
    assert len(whole) == 1, f"expected one held note, got {len(whole)}"


def test_the_lookahead_keeps_a_genuine_six_frame_note_and_swallows_a_five_frame_one(
    monkeypatch,
):
    """The specificity bound, pinned at the value measured rather than the one predicted.

    The prediction was that any window under ``CONTOUR_MIN_SEGMENT_FRAMES`` (5) is safe,
    because a genuine note occupies at least that many frames and so cannot return to the
    previous pitch inside the window.  That is wrong, and this test is where it is wrong: the
    band test runs on a 9-frame median, which blurs a boundary across several frames, so a
    real note of exactly 5 frames DOES get swallowed at a window of 2.  Six frames and up
    survive.

    The 5-frame case is asserted, not merely mentioned, because it is a live exposure — a
    116 ms note a semitone and a half away can be absorbed into its neighbour — and pinning
    it means any future change that fixes it has to come here and say so.  It is also the
    direct explanation for the corpus behaviour recorded on the constant: widths of 3 and up
    cost ``fast_sixteenths_c_major`` 1.000 -> 0.929, because at those widths the merge starts
    reaching notes that are longer than five frames.
    """
    import numpy as np

    from app.pipeline import transcriber as T

    monkeypatch.setattr(T, "CONTOUR_RESEED_LOOKAHEAD_FRAMES", 2)

    def segments_for(hold_frames: int) -> int:
        midi = np.concatenate(
            [np.full(20, 60.0), np.full(hold_frames, 61.5), np.full(20, 60.0)]
        )
        times = np.arange(midi.size) * _FRAME_SEC
        return len(T._contour_segments(times, midi, np.full(midi.size, 0.9)))

    assert segments_for(6) == 3, "a genuine six-frame note must survive the lookahead"
    assert segments_for(12) == 3, "and so must a comfortably long one"
    assert segments_for(5) == 1, (
        "measured exposure: a genuine five-frame note IS absorbed at this width.  If this "
        "now fails, the exposure is gone — update CONTOUR_RESEED_LOOKAHEAD_FRAMES' comment, "
        "which cites it as the reason the safe ceiling is 2 and not 4"
    )


# ── The melody floor — which voice pyin is pointed at ──────────────────────────

# The corpus shows the outcome (poly_alberti_bass 0.000 -> 1.000) but not the mechanism, and
# here the mechanism is the whole risk: the floor is applied by RE-RUNNING pyin, so a gate
# that fires wrongly does not degrade a clip, it re-pitches or silences it.  These tests
# exercise the estimator on synthetic Basic Pitch events, where the right answer is a
# property of the rule rather than of any recording.
#
# Basic Pitch's tuples are ``(start, end, pitch, amp, bends)`` and only the first four are
# read, so these fixtures carry four.

_FLOOR_HOP = 512 / 22050.0


def _two_hand_events(*, melody=(60, 64, 67), melody_amp: float = 0.7,
                     accomp_amp: float = 0.6):
    """A three-note melody over a C3-E3-G3 left hand, as Basic Pitch would report it.

    Deliberately NOT amplitude-separated by hand: the accompaniment is nearly as loud as the
    melody, because that is the case the rule has to survive.  What separates the two is
    register and simultaneity, not level.
    """
    events = []
    for i, pitch in enumerate(melody):
        events.append((i * 0.5, i * 0.5 + 0.5, pitch, melody_amp))
    for i in range(3):
        for pitch in (48, 52, 55):
            events.append((i * 0.5, i * 0.5 + 0.5, pitch, accomp_amp))
    return events


def _flat_contour(midi_value: float, n_frames: int = 60):
    """pyin stuck on one pitch — what happens when it locks onto a sustained lower voice."""
    import numpy as np

    times = np.arange(n_frames) * _FLOOR_HOP
    return times, np.full(n_frames, midi_value)


def _contour_following(events, n_frames: int):
    """pyin tracking the given events, which is what a monophonic clip actually produces.

    ``_flat_contour`` cannot stand in for this: against a melody that moves, a held contour
    reports the melody's own range as disagreement, so it would test the gate on a signal no
    recording generates.  Frames past the last event stay NaN, as unvoiced frames do.
    """
    import numpy as np

    times = np.arange(n_frames) * _FLOOR_HOP
    midi = np.full(n_frames, np.nan)
    for start, end, pitch, *_ in events:
        midi[(times >= start) & (times < end)] = float(pitch)
    return times, midi


def test_the_floor_fires_when_pyin_is_an_octave_below_the_skyline():
    """The gate's positive case: pyin on the left hand, Basic Pitch seeing both.

    The returned floor has to clear the accompaniment's top note (G3, midi 55) or pyin can
    simply find it again, and stay at or below the melody's own lowest note (C4, midi 60) or
    the melody is what gets excluded.  That window is the entire specification.
    """
    from app.pipeline.transcriber import _melody_floor_hz

    times, midi = _flat_contour(48.0)  # pyin locked onto the C3 in the left hand

    floor_hz = _melody_floor_hz(_two_hand_events(), times, midi)

    assert floor_hz is not None, "the gate did not fire on a two-octave disagreement"
    floor_midi = 69.0 + 12.0 * math.log2(floor_hz / 440.0)
    assert 55 < floor_midi <= 60, f"floor at midi {floor_midi:.1f} is outside the window"


def test_the_floor_declines_a_monophonic_clip():
    """The gate's negative case, and the one that protects the 40 monophonic cases.

    Same melody, no left hand, and pyin tracking it — which is what every monophonic corpus
    case measured ([-0.09, +1.11] semitones).  Returning ``None`` here is what makes the
    change byte-identical on all of them.
    """
    from app.pipeline.transcriber import _melody_floor_hz

    melody_only = [e for e in _two_hand_events() if e[2] >= 60]
    times, midi = _contour_following(melody_only, 60)

    assert _melody_floor_hz(melody_only, times, midi) is None


def test_a_harmonic_ghost_does_not_fire_the_gate():
    """The failure mode the gate has to survive, at the amplitudes the corpus measures.

    A monophonic clip whose skyline were a persistent +12 self-ghost would disagree by an
    octave and have its floor put above its own fundamental — silencing the whole clip.
    ``overtone_heavy`` is the corpus's evidence this does not happen; this is the mechanism,
    and there are two of them, which is why the fixture carries ghosts at two amplitudes.

    Measured over 267 overlapping +12/+19 pairs: the ghost/parent ratio has a median of
    0.39-0.49 by case and a ceiling of 0.520.  So ``MELODY_FLOOR_TAU`` falls between the two
    — it rejects the bulk outright, and the handful above it reach the skyline and are
    absorbed by the median instead.  A fixture with only one of those amplitudes would leave
    half the defence untested.
    """
    from app.pipeline.transcriber import MELODY_FLOOR_TAU, _melody_floor_hz

    melody = [(i * 0.5, i * 0.5 + 0.5, p, 0.70) for i, p in enumerate((60, 64, 67, 69))]
    below_tau = [(s, e, p + 12, 0.70 * 0.49) for s, e, p, _a in melody]
    above_tau = [(melody[-1][0], melody[-1][1], melody[-1][2] + 12, 0.70 * 0.52)]
    times, midi = _contour_following(melody, 90)

    assert 0.49 < MELODY_FLOOR_TAU < 0.52, "both ghosts on one side of tau prove nothing"
    assert _melody_floor_hz(melody + below_tau + above_tau, times, midi) is None


def test_the_gate_is_what_declines_and_not_the_floor_estimate():
    """Specificity: the same events fire the gate once pyin drops to the lower voice.

    Without this, ``test_the_floor_declines_a_monophonic_clip`` would also pass for a rule
    that never fires at all, so it is this pair — one set of events, two contours — that
    shows the decision is being read off the disagreement.
    """
    from app.pipeline.transcriber import _melody_floor_hz

    events = _two_hand_events()
    times, on_the_melody = _flat_contour(60.0)
    _, on_the_left_hand = _flat_contour(48.0)

    assert _melody_floor_hz(events, times, on_the_melody) is None
    assert _melody_floor_hz(events, times, on_the_left_hand) is not None


def test_the_floor_is_read_from_the_melody_register_not_the_whole_skyline():
    """Why the estimate is a restricted minimum, and where the restriction runs out.

    The skyline drops to the accompaniment wherever the melody rests, so its unrestricted
    minimum is a left-hand pitch — measured 46 and 53 on the corpus against a left hand
    topping out at 55, i.e. useless as a floor.  ``MELODY_FLOOR_REGISTER_WIDTH`` discards
    those frames, and the first half asserts it does.

    The second half is the limit, and it is a real one rather than a hypothetical.  The window
    is centred on the skyline's MEDIAN and reaches ``WIDTH`` below it, so the rule holds only
    while the accompaniment's top note sits FURTHER than ``WIDTH`` below that median.  A
    close voicing — melody a fifth above the left hand rather than an octave and a half —
    puts the accompaniment inside the window and the floor lands under it.  Asserting that
    makes the boundary discoverable instead of a surprise, and names the condition to look for
    if a real recording ever transcribes its left hand despite the gate firing.

    On the corpus the limit is not reached: the polyphonic cases put the melody's median at 72
    against a left hand topping out at 55, seventeen semitones of separation.  Widening the
    window is not the fix — it admits the accompaniment sooner.  A clip that hits this needs a
    register anchor that is not the median, and the corpus has no case to measure one on;
    adding a close-voicing case is the prerequisite, not inventing the anchor here.
    """
    from app.pipeline.transcriber import MELODY_FLOOR_REGISTER_WIDTH, _melody_floor_hz

    rest = [(1.5, 1.7, p, 0.6) for p in (48, 52, 55)]  # left hand alone, melody resting

    def floor_midi(melody):
        events = _two_hand_events(melody=melody) + rest
        times, midi = _flat_contour(48.0, n_frames=75)  # pyin down on the left hand
        hz = _melody_floor_hz(events, times, midi)
        return None if hz is None else 69.0 + 12.0 * math.log2(hz / 440.0)

    separated = floor_midi((72, 76, 79))  # median 76, sixteen semitones clear of midi 55
    assert separated is not None and separated > 55, (
        f"floor at midi {separated} fell to the accompaniment sounding alone"
    )

    close = floor_midi((60, 64, 67))  # median 64, and 64 - 55 < WIDTH
    assert 64 - 55 < MELODY_FLOOR_REGISTER_WIDTH, "the close voicing is no longer close"
    assert close is not None and close <= 55, (
        "a median-centred window is documented as admitting an accompaniment nearer than "
        f"MELODY_FLOOR_REGISTER_WIDTH; the floor came out at midi {close}, so that limit "
        "has moved and the docstring above is now wrong"
    )


def test_a_degenerate_second_contour_hands_the_floor_to_the_inference_path(
    tmp_path, monkeypatch
):
    """Pointing pyin at the melody does not oblige pyin to find it.

    ``poly_block_chords`` was the case: the gate fires correctly, pyin re-runs from midi 60 —
    and comes back with 82 of 336 frames voiced, every one at midi 60.  One pitch, whole clip.
    Segmenting that yields two notes, and because contour events win outright they became the
    entire transcription, which is why that case scored beats.f1 0.308 and the wrong key while
    its two notes were individually correct.

    So ``_segment_contour`` has to be able to say "I found the register but not the line", and
    the floor has to survive its own path's failure — Basic Pitch could see this melody all
    along (11 of 11 reference pitches above the floor).

    Past tense for that case only.  A correct floor now feeds ``Posteriorgram.melody_track``
    rather than a second pyin pass, and it reads 11 EXACT pitches off the same clip, so
    ``poly_block_chords`` no longer reaches this branch.  The branch is still live on two
    routes — a posteriorgram capture failure, which restores exactly the second pass measured
    above, and a gated clip with no stable-pitch run above the floor — and the property is a
    property of a mixture rather than of pyin, so it is still worth pinning.  The test below
    is the other half: what the same starving pyin produces once the contour head is there.

    ``_pyin_contour`` is monkeypatched rather than driven through audio, and that is the point
    rather than a shortcut: the check is a property of the contour, and synthesising a clip
    that makes pyin return a CONSTANT contour above a raised floor is its own research problem
    — two equal sinusoids an octave apart, the obvious attempt, make pyin return *nothing*
    above the floor and quietly exercise the wrong branch instead.  Patching the seam names
    the three contours the branch has to distinguish and asserts on each.
    """
    import numpy as np

    from app.pipeline import transcriber as T

    wav = tmp_path / "unused.wav"
    wav.write_bytes(b"")  # never decoded: the RMS load is already try/except-guarded

    n = 60
    times = np.arange(n) * _FLOOR_HOP

    def contours(second: np.ndarray):
        """pyin on the accompaniment first, then whatever the raised floor produces."""

        def fake(_path, fmin: float = T.PYIN_FMIN_HZ):
            first = fmin == T.PYIN_FMIN_HZ
            midi = np.full(n, 48.0) if first else second
            return times, midi, np.full(n, 0.9)

        return fake

    # The melody is at 60 and pyin's first pass is at 48, so the gate fires: skyline 60 minus
    # contour 48 is a full octave, well past MELODY_FLOOR_DISAGREEMENT_SEMITONES.
    firing = [(0.0, 1.4, 60, 0.8)]

    monkeypatch.setattr(T, "_pyin_contour", contours(np.full(n, 60.0)))
    events, floor_midi = T._segment_contour(wav, firing)

    assert floor_midi is not None, "the gate did not fire, so this tests nothing"
    assert not events, (
        f"a contour of one distinct pitch produced {len(events)} notes; the degeneracy check "
        "is no longer reached and poly_block_chords will transcribe its left hand again"
    )
    # The point of the whole change: [] does NOT mean "no information".
    assert floor_midi > 48, (
        f"floor came back at midi {floor_midi}, at or below the voice it is meant to exclude"
    )

    # Specificity 1: the DEGENERACY is what declined, not the gate.  Same gate, same floor,
    # but a second contour that moves — alberti's situation, which must keep winning.
    moving = np.concatenate([np.full(20, 60.0), np.full(20, 62.0), np.full(20, 64.0)])
    monkeypatch.setattr(T, "_pyin_contour", contours(moving))
    events, floor_midi = T._segment_contour(wav, firing)

    assert floor_midi is not None and events, (
        "a moving contour above the floor was discarded; the check is meant to reject a "
        "constant contour, not every gated clip"
    )
    assert len({e.pitch for e in events}) > 1

    # Specificity 2: the check is scoped to the SECOND pass.  With pyin already on the melody
    # the gate declines, and a constant contour is then a clip of one sustained note — a real
    # transcription, which must survive.
    def agreeing(_path, fmin: float = T.PYIN_FMIN_HZ):
        return times, np.full(n, 60.0), np.full(n, 0.9)

    monkeypatch.setattr(T, "_pyin_contour", agreeing)
    events, floor_midi = T._segment_contour(wav, firing)

    assert floor_midi is None, "the gate fired without a register disagreement"
    assert events, (
        "a constant contour with no floor was discarded; one sustained note is a real "
        "transcription and the degeneracy check was scoped to the second pass only"
    )


def _posteriorgram_with(times, plan, garbage_midi=100.0, accomp_midi=48.0):
    """A ``Posteriorgram`` whose ``contour`` head holds exactly *plan*, on its own time grid.

    *plan* is ``[(midi, n_frames), ...]`` counted in *times* frames and must total
    ``times.size``, so that the fixture covers the destination grid exactly — a plan that
    overruns would be silently truncated by the slicing below and a plan that falls short
    would leave the tail untested.  A ``midi`` of ``None`` is a silent stretch, which is how
    ``CONTOUR_MIN_ACTIVATION`` gets exercised.

    Two distractors are written into every frame of the voiced stretches, because both masks
    in ``melody_track`` are load-bearing and a fixture without them would leave them untested:

    * *accomp_midi* is activated HARDER than the melody, which is the real situation — the
      accompaniment is the mixture's strongest component, which is the whole reason pyin
      follows it.  Without the floor mask ``argmax`` returns this.
    * *garbage_midi* is above ``CONTOUR_CEIL_MIDI``, where ``maximum_frequency`` constrains
      the note and onset heads and leaves this one alone.  Without the ceiling mask
      ``argmax`` returns this.

    The grid is twice as fine as *times* on purpose: this head runs at ~86 fps against pyin's
    ~45, so a fixture sharing pyin's grid would not exercise the resample at all.
    """
    import numpy as np

    from app.pipeline import transcriber as T

    total = sum(n for _midi, n in plan)
    assert total == times.size, (
        f"the plan covers {total} frames and the grid is {times.size}; size them the same or "
        "the part that does not overlap is not being tested"
    )

    src_times = np.arange(total * 2) * (float(times[1] - times[0]) / 2.0)
    contour = np.zeros((src_times.size, 264))

    def bin_of(midi: float) -> int:
        return int(round((midi - T.POSTERIOR_MIDI_LOW) * T.CONTOUR_BINS_PER_SEMITONE))

    f = 0
    for midi, n_frames in plan:
        span = slice(f, f + n_frames * 2)
        if midi is not None:
            contour[span, bin_of(midi)] = 0.7
            contour[span, bin_of(accomp_midi)] = 0.95
            contour[span, bin_of(garbage_midi)] = 0.99
        f += n_frames * 2

    onset = np.zeros((src_times.size, T.POSTERIOR_N_BINS))
    return T.Posteriorgram(
        onset=onset, note=onset.copy(), contour=contour, times=src_times
    )


def test_the_contour_head_recovers_a_melody_the_second_pyin_pass_cannot(
    tmp_path, monkeypatch
):
    """Pointing pyin at the melody can make things worse, and there is a tracker that fixes it.

    ``close_voicing_c_major`` is the case, and it is the opposite failure to the one above.
    The floor lands *correctly* — on the melody's own lowest note, one semitone clear of the
    whole left hand, the best placement available — and pyin then reports 4 events out of 336
    frames at voiced_prob 0.011-0.023.  Raising ``fmin`` took the mixture's strongest
    component out of pyin's search band without taking its energy out of the signal.  So the
    defect is not the floor's placement and no margin reaches it; the second pyin pass is the
    wrong consumer for a correct floor.

    Basic Pitch's ``contour`` head has no ``fmin`` band and no voiced/unvoiced decision, so it
    cannot fail that way.  Measured end to end: that case goes notes.f1 0.500 -> 1.000,
    ``poly_block_chords`` 11 EXACT where the second pass returned one pitch, and
    ``poly_alberti_bass`` unchanged at 1.000.

    Driven through a hand-built ``Posteriorgram`` for the reason the test above patches
    ``_pyin_contour``: the properties under test are properties of the two contours, and
    synthesising audio that produces a *specific* degenerate pyin pass above a raised floor is
    its own research problem.  The fixture writes in both distractors the masks exist to
    reject, so an unmasked implementation fails here rather than in the corpus.
    """
    import numpy as np

    from app.pipeline import transcriber as T

    wav = tmp_path / "unused.wav"
    wav.write_bytes(b"")  # never decoded: the RMS load is already try/except-guarded

    n = 60
    times = np.arange(n) * _FLOOR_HOP
    firing = [(0.0, 1.4, 60, 0.8)]

    def degenerate(_path, fmin: float = T.PYIN_FMIN_HZ):
        """First pass on the accompaniment; second pass above the floor stuck on one pitch."""
        first = fmin == T.PYIN_FMIN_HZ
        return times, np.full(n, 48.0 if first else 60.0), np.full(n, 0.9)

    monkeypatch.setattr(T, "_pyin_contour", degenerate)

    # Control: no posteriorgram, so the second pyin pass is all there is and the degeneracy
    # check declines — the pre-change behaviour, and still the capture-failure fallback.
    events, floor_midi = T._segment_contour(wav, firing, None)
    assert floor_midi is not None, "the gate did not fire, so this tests nothing"
    assert not events, "the fixture is not degenerate, so the comparison below is empty"

    # The change: same clip, same floor, same starving pyin — and the melody comes back.
    melody = [(60.0, 20), (64.0, 20), (67.0, 20)]
    events, floor_midi = T._segment_contour(wav, firing, _posteriorgram_with(times, melody))

    assert floor_midi is not None
    assert [e.pitch for e in events] == [60, 64, 67], (
        f"the contour head returned {[e.pitch for e in events]}; a melody pyin could not "
        "follow is exactly what melody_track exists to recover"
    )

    # Specificity 1: the floor mask is load-bearing.  The accompaniment at 48 is activated
    # harder than the melody in every frame, so an unmasked argmax returns the left hand —
    # which is the defect the whole melody floor exists to prevent.  Asserted against the
    # track rather than the events because the mask is driven by the argument, so there is no
    # constant to disable: dropping the argument is the mutation, and this is it.
    unmasked, _strength = _posteriorgram_with(times, melody).melody_track(None, times)
    assert 48 in {int(round(v)) for v in unmasked[~np.isnan(unmasked)]}, (
        "argmax without the floor mask did not return the accompaniment, so this fixture no "
        "longer poses the problem the floor mask solves and the assertion below is vacuous"
    )
    assert all(e.pitch >= floor_midi for e in events), (
        "an event landed below the melody floor, so the floor mask is not being applied and "
        "argmax is free to follow the accompaniment"
    )

    # Specificity 2: an above-ceiling bin activated harder than everything else cannot win.
    # maximum_frequency constrains the note and onset heads and leaves this one alone, so
    # without the mask these bins carry unconstrained garbage.  Its failure signature is an
    # EMPTY transcription rather than a high one — garbage wins every frame, the track holds
    # one distinct pitch, and MELODY_FLOOR_MIN_DISTINCT_PITCHES then declines the clip — so
    # the emptiness is asserted here too, otherwise this passes vacuously on [].
    assert events and all(e.pitch <= T.CONTOUR_CEIL_MIDI for e in events), (
        f"got {[e.pitch for e in events]}; without the ceiling mask the bins above "
        "CONTOUR_CEIL_MIDI — where the other two heads have no data at all — win every frame, "
        "and the degeneracy check then hands the whole clip to the inference path"
    )

    # Specificity 3: silence is not a note.  argmax returns a bin on a silent frame too, so
    # without an absolute activation floor a clip grows one spurious trailing note at the
    # bottom bin — which on poly_block_chords would turn notes.f1 1.000 into
    # 2*11/(11+12) = 0.957, trading a win for a loss.
    with_tail = [(60.0, 15), (64.0, 15), (67.0, 15), (None, 15)]
    tail_events, _ = T._segment_contour(wav, firing, _posteriorgram_with(times, with_tail))
    assert [e.pitch for e in tail_events] == [60, 64, 67], (
        f"a silent tail produced {[e.pitch for e in tail_events]}; CONTOUR_MIN_ACTIVATION is "
        "what stops argmax reading silence as a note"
    )


def test_the_contour_head_is_unreachable_on_a_clip_whose_floor_declined(
    tmp_path, monkeypatch
):
    """The gate is the floor, which is what makes the monophonic cases safe by construction.

    ``melody_track`` is not a better tracker in general and must not be reached where pyin is
    doing its job: ``drift_1_semitone`` reads a full semitone sharp under argmax while pyin is
    EXACT, and on the vibrato family argmax is wrong outright.  Its whole warrant is the
    mixture case.  Since the floor fires on 0 of the 40 monophonic corpus cases, tying the two
    together is what keeps those cases byte-identical without measuring them one by one — so
    that implication is worth an assertion rather than a comment.

    The fixture makes the wrong answer loud: the posteriorgram is handed a melody that shares
    no pitch with pyin's contour, so if it were consulted the returned pitches would change.
    """
    import numpy as np

    from app.pipeline import transcriber as T

    wav = tmp_path / "unused.wav"
    wav.write_bytes(b"")

    n = 60
    times = np.arange(n) * _FLOOR_HOP
    # pyin and the skyline agree about the register, so _melody_floor_hz declines.
    moving = np.concatenate([np.full(20, 60.0), np.full(20, 62.0), np.full(20, 64.0)])

    def agreeing(_path, fmin: float = T.PYIN_FMIN_HZ):
        return times, moving.copy(), np.full(n, 0.9)

    monkeypatch.setattr(T, "_pyin_contour", agreeing)

    declining = [(0.0, 1.4, 60, 0.8)]
    contradicting = _posteriorgram_with(times, [(72.0, 20), (74.0, 20), (76.0, 20)])

    events, floor_midi = T._segment_contour(wav, declining, contradicting)

    assert floor_midi is None, "the gate fired on an agreeing clip, so this tests nothing"
    assert [e.pitch for e in events] == [60, 62, 64], (
        f"an ungated clip came back as {[e.pitch for e in events]}, which is the "
        "posteriorgram's melody rather than pyin's; melody_track is being consulted where "
        "the floor declined and the 40 monophonic cases are no longer safe by construction"
    )


def test_melody_path_keeps_the_confident_voice_through_block_chord_candidates():
    """The fallback must follow one sustained line, not the last/highest overlap.

    These are the raised-floor Basic Pitch candidates from the block-chord texture,
    reduced to the notes that exercise the decision.  The true line is not the skyline:
    every opening C has an octave or harmonic above it, and the false notes around beats
    five and nine start late enough that a same-onset-only rule cannot reach them.
    """
    candidates = [
        Event(0.000, 0.592, 60, 0.654),
        Event(0.000, 0.580, 72, 0.582),
        Event(0.000, 0.430, 79, 0.288),
        Event(0.615, 1.231, 62, 0.544),
        Event(0.615, 1.196, 74, 0.297),
        Event(1.254, 1.858, 64, 0.599),
        Event(1.881, 2.497, 65, 0.802),
        Event(1.881, 2.451, 77, 0.464),
        Event(2.497, 3.113, 67, 0.602),
        Event(2.962, 3.612, 74, 0.277),
        Event(3.113, 3.763, 69, 0.777),
        Event(3.171, 3.647, 76, 0.267),
        Event(3.751, 4.368, 71, 0.754),
        Event(4.368, 5.041, 72, 0.732),
        Event(5.006, 5.633, 67, 0.604),
        Event(5.436, 5.564, 74, 0.297),
        Event(5.633, 6.273, 64, 0.683),
        Event(6.238, 7.527, 60, 0.664),
        Event(6.250, 7.481, 72, 0.567),
    ]

    selected = _select_melody_path(candidates)

    assert [event.pitch for event in selected] == [60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60]
    assert selected[0].pitch != max(event.pitch for event in candidates if event.start == 0.0)


def test_melody_path_leaves_a_non_competing_line_unchanged():
    """Genuine semitone steps with ordinary boundary bleed are not polyphony."""
    events = [
        Event(0.00, 0.64, 64, 0.72),
        Event(0.62, 1.26, 65, 0.70),
        Event(1.24, 1.88, 64, 0.71),
        Event(1.86, 2.50, 65, 0.69),
    ]

    selected = _select_melody_path(events)

    assert selected is events
    assert [event.pitch for event in selected] == [64, 65, 64, 65]


def test_melody_path_does_not_trade_a_line_for_one_long_harmonic():
    """A sustained harmonic cannot win merely by having a longer duration."""
    events = [
        Event(0.00, 0.50, 60, 0.70),
        Event(0.50, 1.00, 62, 0.70),
        Event(0.00, 1.00, 72, 0.90),
    ]

    selected = _select_melody_path(events)

    assert [event.pitch for event in selected] == [60, 62]


# ── Grid refinement — two single-sample biases, one bounded sweep ──────────────

# ``long_clip_over_pyin_cap`` segmented 99 of 99 notes at the right pitches and still scored
# notes.f1 0.232, because every note from the eleventh on was placed exactly half a beat
# late.  Neither estimator was wrong by enough to matter alone; together they swept the
# clip's distance-to-grid across a quantizer boundary.  Both are simulable exactly, which
# makes this the one place the defect can be reproduced without inference.

_TRUE_BPM = 96.0
_HOP_QUANTIZED_BPM = 60.0 / (round(60.0 / _TRUE_BPM / _FRAME_SEC) * _FRAME_SEC)

# The two latencies, both measured on ``long_clip_over_pyin_cap``.  The first onset comes in
# 0.093 s late because a pitch tracker needs voiced frames before it commits; every onset
# after it is ~0.020 s late, which is the tracker's steady-state lag.  ``_beat_origin`` nails
# beat 0 to the first onset when no tracked beat is near — so it copies the phase from the one
# sample in the clip that is least like the others.  That gap, 0.073 s, IS the phase bias.
_FIRST_ONSET_LATE_SEC = 0.093
_STEADY_LATENCY_SEC = 0.020


def _quarter_note_onsets(n: int, *, first_late: bool = True):
    """``n`` quarter notes at exactly 96 BPM, detected the way pyin detects them."""
    import numpy as np

    onsets = np.arange(n) * (60.0 / _TRUE_BPM) + _STEADY_LATENCY_SEC
    if first_late:
        onsets[0] = _FIRST_ONSET_LATE_SEC
    return onsets


def _mean_distance_to_grid(onsets, bpm: float, origin: float, divisor: int = 2) -> float:
    """Average distance from a grid line, in grid steps — the sweep's own objective."""
    import numpy as np

    steps = (onsets - origin) * (bpm / 60.0) * divisor
    return float(np.mean(np.abs(steps - np.round(steps))))


def _misplaced(onsets, bpm: float, origin: float, divisor: int = 2) -> int:
    """How many onsets quantize into a different cell than the true grid puts them in.

    Distance-to-grid is a proxy; this is the defect itself.  Measured relative to the first
    onset's cell, because an overall shift is what ``beats.f1_shift_invariant`` forgives and
    what a listener never hears — a note landing in the *wrong cell relative to its
    neighbours* is the half-beat error, and it is worth exactly 0.500 every time.
    """
    import numpy as np

    def cells(b: float, o: float):
        return np.round((onsets - o) * (b / 60.0) * divisor)

    truth = cells(_TRUE_BPM, _STEADY_LATENCY_SEC)
    got = cells(bpm, origin)
    return int(np.sum((got - got[0]) != (truth - truth[0])))


def test_the_hop_quantized_tempo_is_a_floor_and_not_a_tuning_miss():
    """96 BPM is unreachable from a single IOI, so no threshold change could have fixed this.

    ``_grid_bpm`` takes ``60/median(IOI)``, and an IOI is a difference of two onsets that can
    only land on frame boundaries.  A 0.625 s beat is 26.94 hops, so the nearest value one
    IOI can express is 27 hops — 95.70 BPM, 0.31% slow.  Asserting the arithmetic is what
    stops someone re-tuning a threshold to chase it.
    """
    assert _HOP_QUANTIZED_BPM != pytest.approx(_TRUE_BPM, abs=0.05)
    assert _HOP_QUANTIZED_BPM == pytest.approx(95.70, abs=0.01)


def test_the_phase_bias_is_harmless_alone_and_triples_the_tempo_bias_beside_it():
    """The compound failure, reproduced — and it is compounding, not co-triggering.

    Measured on this fixture, misplaced notes out of 99:

        phase bias alone        0     mean distance 0.231 steps
        tempo bias alone       18     mean distance 0.286
        both together          55     mean distance 0.343

    So the phase bias on its own moves nothing across a cell boundary, and the tempo bias on
    its own already costs 18 notes.  What the phase bias does is shift *which side* of the
    boundary each note falls on: the signed residue sweeps across zero over the clip, so the
    early notes round one way and the late notes the other.  That is why the fix had to move
    both, and why correcting the phase alone made the case worse rather than better.
    """
    onsets = _quarter_note_onsets(99)

    phase_only = _misplaced(onsets, _TRUE_BPM, _FIRST_ONSET_LATE_SEC)
    tempo_only = _misplaced(onsets, _HOP_QUANTIZED_BPM, _STEADY_LATENCY_SEC)
    both = _misplaced(onsets, _HOP_QUANTIZED_BPM, _FIRST_ONSET_LATE_SEC)

    assert phase_only == 0, "copying the phase from the first onset misplaces nothing alone"
    assert tempo_only > 0, "0.31% over 63 s is already enough on its own"
    assert both > 2 * tempo_only, "and the two together are far worse than their sum"


def test_refining_the_grid_recovers_the_tempo_and_repairs_every_placement():
    """The fix, on the real function: a bounded tempo sweep with a per-candidate origin.

    A least-squares refit could not do this.  It fits seconds against each onset's ASSIGNED
    cell, and once the residue has swept past the boundary the assignment is wrong —
    regressing on wrong cells reproduces the wrong tempo, a fixed point iteration cannot
    escape.  A sweep is not handed the assignment, so it can.
    """
    from app.pipeline.transcriber import _refine_grid

    onsets = _quarter_note_onsets(99)
    before = _misplaced(onsets, _HOP_QUANTIZED_BPM, _FIRST_ONSET_LATE_SEC)
    assert before > 0, "fixture no longer reproduces the defect"

    bpm, origin = _refine_grid(onsets, _HOP_QUANTIZED_BPM, _FIRST_ONSET_LATE_SEC, (2,))

    assert bpm == pytest.approx(_TRUE_BPM, abs=0.05), "1% of 95.70 reaches 96"
    assert origin == pytest.approx(_STEADY_LATENCY_SEC, abs=0.005), (
        "the origin should land on the steady-state latency, not the first onset"
    )
    assert _misplaced(onsets, bpm, origin) == 0
    assert _mean_distance_to_grid(onsets, bpm, origin) < 0.05


def test_refinement_cannot_return_a_worse_grid_fit_than_it_was_handed():
    """Why there is no accept/reject test: the incumbent is a member of its own search space.

    Both step counts are odd on purpose, so ``linspace`` lands exactly on the values handed
    in.  A clip already on the grid must therefore come back unmoved rather than nudged onto
    some other candidate that ties.
    """
    from app.pipeline.transcriber import _refine_grid

    onsets = _quarter_note_onsets(20, first_late=False)

    bpm, origin = _refine_grid(onsets, _TRUE_BPM, _STEADY_LATENCY_SEC, (2,))

    assert (bpm, origin) == (_TRUE_BPM, _STEADY_LATENCY_SEC)


def test_refinement_declines_a_sample_too_small_to_be_a_fit():
    """Below the floor the sweep is interpolating, not averaging the hop out.

    The leverage on the slope is the clip's length in beats; with three onsets there is
    nothing to average, and a 1% band would happily fit noise.  Matches ``_grid_bpm``'s floor.
    """
    from app.pipeline.transcriber import _refine_grid

    onsets = _quarter_note_onsets(3)
    handed = (_HOP_QUANTIZED_BPM, _FIRST_ONSET_LATE_SEC)

    assert _refine_grid(onsets, *handed, (2,)) == handed


def test_a_tap_in_tempo_override_keeps_its_bpm_and_still_gets_its_phase_fixed():
    """``band=0.0`` is the override path: the user said how fast, not where beat 0 is.

    The TRD makes a tap-in authoritative on tempo, so the sweep must not move it — but an
    override says nothing about phase, and phase is half the defect.  The objective is the
    MEAN distance, so this is asserted on the mean: a sweep that centres the whole clip can
    leave one outlier marginally further out, and here that outlier is the late first onset,
    which is the sample the refinement is right to stop trusting.
    """
    from app.pipeline.transcriber import _refine_grid

    onsets = _quarter_note_onsets(40)

    bpm, origin = _refine_grid(onsets, _TRUE_BPM, _FIRST_ONSET_LATE_SEC, (2,), band=0.0)

    assert bpm == _TRUE_BPM, "an override is authoritative on tempo"
    assert origin == pytest.approx(_STEADY_LATENCY_SEC, abs=0.005), "but not on phase"
    assert _mean_distance_to_grid(onsets, bpm, origin) < _mean_distance_to_grid(
        onsets, _TRUE_BPM, _FIRST_ONSET_LATE_SEC
    )


# ── Metrical level — the step filter's slow bias, and re-admitting the partner ──

# ``vibrato_heavy`` reported 48 BPM against a true 96 with every note otherwise correct
# (notes.f1 1.000).  The cause is structural rather than a threshold: the step filter in
# ``_grid_bpm`` asks "would rounding move these notes to another slot", which is genuinely a
# question about steps — but a fixed onset jitter is a smaller *fraction* of a step at a
# slower tempo, so of two readings of one performance the slower always measures better.
# Measured on that clip: 95.703 was rejected at 0.323 steps and 47.852 accepted at 0.162,
# with both at 0.1013 s.  Equal in seconds means one performance; the filter still split them.

# Onsets at 96 BPM with a repeating 0.11 s scatter on three of every four, which is the shape
# that reproduces the bias.  Its residual spectrum was searched for rather than guessed,
# because a simpler jitter is commensurate with too many grids: an alternating displacement
# lets 144 or 192 fit BETTER than 48, and then the choice under test never arises.  This one
# gives, at divisor 2 — 48: 0.122 steps / 0.0762 s (accepted); 96: 0.244 steps / 0.0762 s
# (rejected, and equal to the millisecond); 64: 0.228, 144: 0.327, 192: 0.205 (all rejected
# with margin).  So the decision really is between 48 and 96 and nothing else can win on fit.
_SCATTER_CYCLE_SEC = (0.0, 0.11, 0.11, 0.11)


def _scattered_beat_onsets(n: int = 13, bpm: float = 96.0):
    """``n`` beats at ``bpm``, each displaced by the measured-scale scatter cycle."""
    import numpy as np

    beat = 60.0 / bpm
    scatter = [_SCATTER_CYCLE_SEC[k % len(_SCATTER_CYCLE_SEC)] for k in range(n)]
    return np.arange(n) * beat + np.array(scatter)


def _events_at(onsets, pitch: int = 60):
    from app.pipeline.transcriber import Event

    return [Event(start=float(t), end=float(t) + 0.3, pitch=pitch, amp=0.6) for t in onsets]


def _with_admit_ratios(module, ratios, fn):
    """Call ``fn`` with ``_OCTAVE_ADMIT_RATIOS`` replaced; an empty tuple is the off switch."""
    saved = module._OCTAVE_ADMIT_RATIOS
    module._OCTAVE_ADMIT_RATIOS = ratios
    try:
        return fn()
    finally:
        module._OCTAVE_ADMIT_RATIOS = saved


def test_the_step_filter_prefers_the_slower_reading_of_the_same_performance():
    """The bias itself, before any repair — asserted on the filter's own two units.

    This is the premise every test below rests on, so it is measured here rather than
    assumed: the two readings are one performance (identical seconds, which is the only
    level-fair unit) and the filter still accepts one and rejects the other.
    """
    from app.pipeline.transcriber import _MAX_GRID_SLIP_STEPS, _grid_residual

    onsets = _scattered_beat_onsets()
    slow_steps, slow_sec = _grid_residual(onsets, 48.0, (2,))
    true_steps, true_sec = _grid_residual(onsets, 96.0, (2,))

    assert slow_sec == pytest.approx(true_sec, abs=1e-6), "same performance, same seconds"
    assert true_steps == pytest.approx(2.0 * slow_steps, rel=1e-6), "steps scale with level"
    assert slow_steps <= _MAX_GRID_SLIP_STEPS < true_steps, "and the filter splits them"


def test_the_true_level_is_recovered_from_a_reading_the_filter_rejected():
    """The repair: admitted as its partner, the faster reading wins on tappability.

    Both halves matter.  Without the admission the answer is the halved one, so the rule is
    load-bearing; with it the answer is the level the onsets were generated at, so the
    preference — not a re-tuned threshold — is what chose it.
    """
    from app.pipeline import transcriber

    events = _events_at(_scattered_beat_onsets())

    without = _with_admit_ratios(transcriber, (), lambda: transcriber._grid_bpm(events, 0.0, (2,)))
    with_it = transcriber._grid_bpm(events, 0.0, (2,))

    assert without == pytest.approx(48.0, abs=0.5), "the bias, reproduced end to end"
    assert with_it == pytest.approx(96.0, abs=0.5), "and corrected"


def test_an_admitted_reading_cannot_win_on_a_fit_it_was_never_credited_with():
    """The specificity that keeps the whole ``major_*`` family intact.

    An admitted candidate carries its partner's seconds, not its own.  It has to: on
    ``major_c`` the accepted 86.133 measures 0.0507 s and the rejected 172.266 measures
    0.0443 — 6 ms apart, half a frame hop, and enough to straddle a ranking bucket.  Credited
    with its own number the doubling would win on *fit* and the tempo would read 174; credited
    with its partner's it can only win on tappability, which it loses.

    The fixture is that shape, derived rather than searched: eighth notes at 172 BPM with
    alternate onsets 96 ms late.  At divisor 2 that puts 86 inside the filter at 0.129 steps
    and 172 outside it at 0.212, their seconds 8 ms apart — inside the admission band — and
    172's own seconds a whole bucket BETTER.  So the two crediting rules give different
    answers here, which is what makes the assertion mean something.
    """
    import numpy as np

    from app.pipeline import transcriber

    step = 60.0 / 86.0 / 2.0
    n = 17
    onsets = np.arange(n) * step + np.where(np.arange(n) % 2 == 1, 0.275 * step, 0.0)
    events = _events_at(onsets)

    slow_steps, slow_sec = transcriber._grid_residual(onsets, 86.0, (2,))
    fast_steps, fast_sec = transcriber._grid_residual(onsets, 172.0, (2,))
    assert slow_steps <= transcriber._MAX_GRID_SLIP_STEPS < fast_steps, "premise: filter splits"
    assert abs(slow_sec - fast_sec) <= transcriber._GRID_FIT_BAND_SEC, "premise: admissible"
    assert round(fast_sec / transcriber._GRID_FIT_BAND_SEC) < round(
        slow_sec / transcriber._GRID_FIT_BAND_SEC
    ), "premise: on its OWN seconds the doubling would win the ranking"

    assert transcriber._grid_bpm(events, 0.0, (2,)) == pytest.approx(86.0, abs=0.5)


def test_a_dotted_relationship_is_never_admitted():
    """1.5 is absent from the ratios on purpose, and its absence is what is asserted.

    Doubling a tempo renotates the same beats; taking one and a half times it changes which
    notes ARE beats, and the onsets carry no evidence for that.  ``triplets_eighth_c_major``
    is what happens when a 1.5 reading is the only one a half-beat grid can express, and it
    is a quantizer-divisor consequence rather than something the chooser should invent.
    """
    from app.pipeline import transcriber

    assert 1.5 not in transcriber._OCTAVE_ADMIT_RATIOS
    assert 2.0 / 3.0 not in transcriber._OCTAVE_ADMIT_RATIOS
    for ratio in transcriber._OCTAVE_ADMIT_RATIOS:
        assert ratio == pytest.approx(round(ratio)), "integer multiples only"


def test_admission_needs_the_fits_to_agree_and_not_merely_the_ratio():
    """A partner at the right ratio whose fit is genuinely worse stays rejected.

    The ratio says the two readings *could* be the same performance; the seconds say whether
    they are.  Without the seconds test this would admit any doubling of any survivor, which
    is the runaway ``_GRID_REFINE_BAND`` warns about — at a fine enough grid everything fits.

    Non-vacuous by construction: the premise asserts such a partner exists, so the ratio alone
    really would have let it in.
    """
    from app.pipeline import transcriber

    onsets = _scattered_beat_onsets()
    events = _events_at(onsets)

    accepted = 48.0
    partner = 96.0
    acc_sec = transcriber._grid_residual(onsets, accepted, (2,))[1]
    far_sec = transcriber._grid_residual(onsets, accepted * 4.0, (2,))[1]
    assert 4.0 in transcriber._OCTAVE_ADMIT_RATIOS, "premise: the ratio is one it accepts"
    assert (
        abs(far_sec - acc_sec) > transcriber._GRID_FIT_BAND_SEC
    ), "premise: and this partner's fit disagrees, so only the seconds test excludes it"

    assert transcriber._grid_bpm(events, 0.0, (2,)) == pytest.approx(partner, abs=0.5), (
        "the doubling is admitted on an equal fit; the quadrupling is not admitted at all"
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
