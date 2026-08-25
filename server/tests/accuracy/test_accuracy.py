"""Regression gate over the synthetic accuracy corpus.

Every test here is marked ``accuracy`` and excluded from ``python -m pytest -q`` by
``pytest.ini``, because each case runs real Basic Pitch inference.  Run them
deliberately with::

    python -m pytest -q tests/accuracy -m accuracy

This is a REGRESSION gate, not an absolute-target gate: there are no hardcoded
"f1 must beat 0.9" thresholds, because the synthetic corpus deliberately contains
cases the current pipeline fails (that is what phases 2-4 fix).  What it enforces is
that a change never makes a recorded number worse.  With no ``baseline.json`` the
numeric comparison is skipped and only "the pipeline did not raise" is asserted.

The whole corpus runs ONCE per session — inference dominates the runtime, so the
session-scoped fixture is what keeps this usable.

Accepted trades recorded in the current baseline
────────────────────────────────────────────────
This baseline is the shipped configuration.  Three numbers in it are *worse* than the
pre-plan pipeline scored, deliberately:

  vibrato_heavy / solfa.degree_accuracy  0.375 -> 0.000 -> REPAID, now 1.000
      Kept in full because the reasoning is what the repair has to be read against, and
      because the failure did not disappear so much as move to another case.

      This case was broken in every configuration, pre-plan included — 30 estimated notes
      for 11 real ones, notes.f1 0.098, 21 ghosts.  With 90% of the note list wrong, the
      duration-weighted pitch-class histogram every music21 profile reads is noise, and all
      five profiles voted for an unrelated key.  Pre-plan scored 0.375 by landing on Bb
      minor, which happens to share 3 of 8 degrees with the true C major — coincidental
      partial credit, not a working behaviour.  What the trade bought was honesty:
      key.confidence went 0.477 -> 0.023, so the estimate sat well under the mobile's 0.5
      cut and the editable-key prompt fired instead of a wrong key being presented as
      plausible.
      Three candidate fixes were built or scouted, measured, and STRUCK — the
      vibrato-tolerant merge (fired zero times), the pyin re-label (a fragmentation
      regression behind a gate that cannot see the bias it exists to catch), and the
      straddle collapse (the midpoint stops being the truth past ~1.6 semitones of
      depth, and this corpus holds one depth).  All three post-mortems are in the
      vibrato_heavy comment in corpus.py, with the corpus-breadth prerequisite they share.

      **None of those is what repaired it.**  Lifting ``pyin_max_seconds`` to 180 on a
      coarser ``pyin_resolution`` did, incidentally: F minor -> C major, degree 0.000 ->
      1.000, syllable 0.000 -> 0.889, notes.f1 0.429 -> 0.516.  The case is still badly
      over-segmented (20 estimated notes for 11) so this is not the fix those three were
      looking for — it is the key ensemble crossing back over a margin it was sitting just
      the wrong side of, which is precisely the marginality the struck post-mortems
      identified.  Read it as the defect being unstable rather than solved.
      The proof that it is unstable: ``vibrato_rate_k15`` made the opposite move over the
      same change (C major -> F minor, degree 1.000 -> 0.000), so ``key.exact`` is unmoved
      at 0.897 and the corpus simply holds a different broken case than it did.  The
      standing entry for that is below.  A real fix is a tiebreak on the key ensemble
      (ends-on-doh, diatonic parsimony), not another pass at the note list.

  vibrato_rate_k15 / solfa.degree_accuracy  1.000 -> 0.000
      The inherited half of the trade above, and the only per-case regression the cap lift
      cost.  C major -> F minor takes every syllable in the clip with it (syllable
      accuracy 1.000 -> 0.000) even though the note list barely moved (notes.f1 0.667 ->
      0.615, 13 -> 15 estimated for 11 real).
      Accepted for the same reason ``vibrato_heavy``'s version was, and on a better number:
      key.confidence falls 0.175 -> **0.035**, so the wrong key is reported as
      near-worthless and the mobile's editable-key prompt fires.  The corpus-wide picture
      is what makes this a trade rather than a loss — every one of the four wrong keys now
      sits under the mobile's 0.5 cut (0.035-0.343), and ``key.confidence_auc`` rises
      0.929 -> 0.964.  Tuning the pyin grid to protect this one case instead would be
      fitting to the corpus; the four hard vibrato cases trade places whenever the pitch
      evidence shifts, because their key decision is marginal by construction.

  conf.auc and conf.separation, corpus-wide and on four cases
      Both fall while every note metric on those same cases improves.  They are no
      longer gated; see the NOT_A_GATE note below for why that is structural rather
      than convenient.
      Largely repaid since, in two steps.  ``conf`` stopped being bare Basic Pitch amplitude
      and became a consensus of amplitude with pyin's independent reading of the same span
      (``_blend_confidence``): conf.auc 0.551 -> 0.676, conf.separation -0.012 -> 0.032,
      with every other aggregate bit-identical to +0.000 — which it must be, since conf is
      carried on notes and never used to select them.  Lifting the pyin cap then took it
      to conf.auc **0.745** and conf.separation **0.087**, for the mechanical reason that
      the consensus term now has a pyin reading to consult on long clips at all.
      It does NOT return to the pre-plan 0.868, and cannot.  That figure was measured
      over a wrong-note population dominated by quiet ghosts clustered at amplitude
      0.252-0.268, which is exactly the population ``ADAPTIVE_FACTOR`` 0.40 now deletes
      before anything is scored.  What remains to rank is the hard residue — wrong-pitch
      survivors at full amplitude — so 0.745 over this population is not the same
      question as 0.868 over that one, and treating the older number as a target would
      be asking the metric to re-acquire the errors the pipeline stopped making.  The
      POPULATION argument below is precisely this, and it is also why the family stays
      out of the gate even in the direction of improvement.

  notes.recall on four vibrato cases, and 0.024 corpus-wide
      The wobble fuse (``WOBBLE_SEMITONES`` / ``WOBBLE_MIN_OVERLAP_FRACTION`` in
      transcriber.py) absorbs a semitone-off sliver back into the note it came from.
      Under a heavy wobble two *real* notes a semitone apart can overlap enough to be
      fused as well, and this is what that costs:

          vibrato_heavy      recall 0.909 -> 0.545   n_est 35 -> 17   f1 0.435 -> 0.429
          vibrato_rate_k15   recall 1.000 -> 0.727   n_est 32 -> 13   f1 0.512 -> 0.667
          vibrato_rate_k155  recall 1.000 -> 0.727   n_est 29 -> 18   f1 0.550 -> 0.552
          vibrato_rate_7hz   recall 0.909 -> 0.727   n_est 47 -> 16   f1 0.345 -> 0.593

      Precision rises on all four (0.213-0.379 -> 0.353-0.615) and f1 rises or holds on
      all four, because the notes being given up are bought back several times over in
      ghosts: solfa.ghost_count on these four falls 24/21/18/36 -> 8/5/9/6.  Eleven real
      notes were being printed as 29-47, and are now printed as 13-18.

      This is the threshold's own trade and not a fixable side effect, which took two
      measurements to establish.  Sweeping it over the eight vibrato cases:

          t       recall  f1     n_est  ghost_count  chromatic_ghosts
          none    0.716   0.404  32.9   22.3         7.88
          0.70    0.739   0.436  30.8   20.3         5.88
          0.50    0.705   0.453  27.6   17.4         6.00
          0.20    0.602   0.496  20.4   10.9         6.25

      Recall is not monotonic in t, which pointed at the fused event's span extension
      (``end=max(prev.end, evt.end)``) rather than at the pitch test — a protruding
      sliver grows the note forward over whatever follows.  Pinning the end to the
      longer fragment instead recovers recall 0.602 -> 0.682 but gives back nearly all
      the clutter (n_est 20.4 -> 27.9, ghost_count 10.9 -> 17.6, f1 0.496 -> 0.435) and
      still does not reach the no-fuse 0.716.  So absorbing the span is what removes the
      ghosts; it is one trade with one knob, and 0.20 was chosen for the readable score.

      0.70 remains the option to revisit if breadth ever matters more than clutter: it
      scores BETTER than no fuse on recall and has the lowest accidental count of any
      setting.  What rules it out today is 30.8 printed notes for 11 real ones.

  beats.recall 0.990 -> 0.969, from the same change
      Recorded here because it is gated and 0.022 is just over tolerance, but it is the
      signature of the tempo estimate getting BETTER rather than worse.  beats.precision
      rises 0.858 -> 0.890 and beats.f1 0.890 -> 0.916 alongside it, and
      tempo.abs_error falls 21.263 -> 14.184: a tempo no longer inflated by ghost onsets
      predicts fewer beat instants, so it hits marginally fewer reference beats while
      emitting far fewer spurious ones.  Read the three columns together; recall alone on
      a predicted-instant count is maximised by predicting a beat everywhere.

The 31 -> 38 corpus expansion moved every aggregate down, and none of it is a regression
────────────────────────────────────────────────────────────────────────────────────────
This baseline was re-recorded when ``VIBRATO_BREADTH_CASES`` added a rate and depth
sweep around the single vibrato point (corpus.py) — six cases the pipeline fails and one
it transcribes perfectly.  Diffed against the previous baseline the aggregates fall
hard: solfa.degree_accuracy 0.935 -> 0.831, key.exact 0.903 -> 0.763, notes.f1
0.914 -> 0.786, notes.semitone_neighbour_ghosts 1.000 -> 4.289.  Every one of those is
the denominator growing, not the pipeline getting worse: all 31 pre-existing cases
scored identically, to +0.000 on notes.f1, which is the determinism proof that the new
RenderOptions values did not perturb the existing audio.

That is the trade KEY_HEADROOM_CASES was added under — a corpus holding only cases we
pass cannot gate a fix — and it is why cross-baseline aggregate deltas mean nothing
without the fingerprint.  The ``baseline`` fixture fails loudly on a fingerprint
mismatch rather than diffing across it, precisely so this expansion could not be read
as a 0.105 loss on the headline metric.

What the expansion bought immediately: it falsified a calibration property the pipeline
asserts.  ``KEY_MARGIN_FULL``'s comment claimed "every wrong key lands under 0.5" on the
31-case corpus; on 38 the wrong-key count is 9 spanning 0.023-0.631, and
``vibrato_rate_k155`` reads C major as E minor at 0.631 — above the mobile's cut, so the
editable-key prompt stays silent on a confidently wrong key.  That was a live defect, not
an accepted trade; the analysis and the rejected rescaling are recorded at the constant.
**It is no longer live.**  On this baseline all four wrong keys land at 0.035-0.343 and
``vibrato_rate_k155`` reads C major at 0.907, so the claim holds again on 39 cases and the
prompt fires on every wrong key.  It was not fixed by rescaling — the pyin cap lift below
moved the underlying evidence — so the constant's analysis stands and this property is
still a coincidence of the current numbers rather than something the code enforces.  Five
*correct* keys also sit under the cut (0.064-0.447), which is the safe direction for a
prompt but means the cut is not a wrong-key detector.

The 38 -> 39 expansion, and the cap lift that resolved it
────────────────────────────────────────────────────────────────────────────────────────
``LONG_CLIP_CASES`` added ``long_clip_over_pyin_cap``: ``DIAG_PHRASE`` repeated nine times
under ``vibrato_heavy``'s exact vibrato, 67.8 s, and at the time the only case in the corpus
that crossed ``settings.pyin_max_seconds`` (then 60).  Above that line ``_pyin_track``
returns empty arrays and ``pyin_semitone`` — the stage that suppresses spurious accidentals
at their source — goes dark.  The regime was 0% measured while ``max_clip_seconds`` accepted
180 s, so the aggregate fall on the 38 -> 39 re-record was the cliff finally being *inside*
the harness, not a pipeline regression:

    solfa.chromatic_ghosts            1.526 ->  3.846
    notes.semitone_neighbour_ghosts   1.632 ->  5.256
    solfa.ghost_count                 2.553 ->  6.179
    notes.f1                          0.882 ->  0.866
    tempo.abs_error                  14.184 -> 17.359
    conf.auc                          0.698 ->  0.624

That one case carried 92 of the 150 chromatic ghosts, 143 of 205 semitone-neighbour ghosts
and 138 of the 677 BPM of tempo error — a weighted average against a case with 9x the
reference notes.  Every pre-existing case was unchanged, +0.000 on notes.f1 across all 38.

**The cap is now 180, equal to ``max_clip_seconds``, and this baseline is the first recorded
with it.**  What paid for that is ``config.pyin_resolution``: pyin's Viterbi grid is coarser
than librosa's default (0.2 semitones against 0.1, 240 bins against 481, 2.39x cheaper),
which is affordable because ``_refine_pitches`` rounds to a whole semitone anyway.  Read
those two config docstrings together — they are one decision.  Corpus-wide, against the
60 s / 0.1-grid baseline:

    solfa.chromatic_ghosts            3.846 ->  2.846
    notes.semitone_neighbour_ghosts   5.256 ->  3.051
    solfa.ghost_count                 6.179 ->  4.821
    notes.n_est                      18.846 -> 17.462   (13.436 real)
    notes.f1                          0.866 ->  0.875   (recall 0.898 -> 0.913)
    solfa.degree_accuracy             0.934 ->  0.944
    solfa.syllable_accuracy           0.923 ->  0.933
    tempo.abs_error                  17.359 -> 15.641
    conf.auc                          0.624 ->  0.745
    key.confidence_auc                0.929 ->  0.964

No gated aggregate regressed.  The three negatives are all inside ``NOT_A_GATE`` or
tolerance: conf.mean_correct -0.032 and beats.best_shift_beats -0.024 are ungated, and
beats.f1/precision/recall move -0.002/-0.003/-0.001.

On the case itself: 226 -> 166 estimated notes for 99 real, notes.f1 0.240 -> 0.596,
solfa.degree_accuracy 0.707 -> 0.988, syllable_accuracy 0.476 -> 0.975, key.confidence
0.253 -> 0.804.  Over-segmentation is the whole mechanism — refinement collapses
semitone-adjacent fragments, which is why the ghost columns move furthest and why 60 fewer
printed notes buys 0.356 of f1.

Its pair is still ``vibrato_heavy``, differing in exactly one variable — length — so
normalise per reference note and the result is legible in a way the aggregates cannot show:

    per reference note        vibrato_heavy (7.8 s)   long_clip (67.8 s)
    ghost_count                    0.73 -> 1.00          1.45 -> 0.86
    chromatic_ghosts               0.55 -> 0.55          0.93 -> 0.52
    semitone_neighbour_ghosts      0.55 -> 0.55          1.44 -> 0.55

**Length has stopped costing anything on the accidental columns** — semitone-neighbour
ghosts per note are now identical on the pair, and chromatic ghosts are marginally *lower*
on the long clip.  What remains at ~0.55 per note is the vibrato, which both share and
which no cap change can touch.  ``ghost_count`` moving the other way on the short case is
the wobble fuse having less to fuse once refinement is available, and it is 3 notes.

Two results from the original expansion are worth keeping, because one is now closed and
the other reversed.  **The degree/syllable gap was the user-reported defect, isolated.**
0.707 against 0.476 was the largest in the corpus by 2.3x — 36 of 39 cases had no gap at
all — and a gap means the scale degree is right while the printed syllable carries an
accidental that is not in the music.  That is "adding accidentals where not needed", and
this case was the only place in the harness it registered.  It is now 0.988 against 0.975,
a gap of 0.013, so the harness's one witness to that defect has gone quiet.  Treat that as
the reason to populate ``tests/accuracy/real/`` rather than as the defect being solved:
a synthetic 5.5 Hz vibrato is not a human voice.  **And "length helps the key while hurting
everything else" no longer holds either** — it was true when the long clip read C major and
its 7.8 s pair read F minor, on the argument that 99 notes of duration-weighted histogram
outvote ghost classes that 11 notes cannot.  Both read C major now, so length is no longer
compensating for anything.

This case is STILL expected to score badly, in the way ``vibrato_heavy`` is: 166 printed
notes for 99 real is not a working transcription.  Read the pair together — they are now
close (notes.f1 0.596 against 0.516, degree 0.988 against 1.000), and a gap reopening means
refinement stopped reaching long clips, which is the one thing this case exists to catch.

The 39 -> 41 expansion: polyphony, and the aggregate fall that is the point of it
────────────────────────────────────────────────────────────────────────────────────────
``POLYPHONIC_CASES`` added ``poly_block_chords_c_major`` and ``poly_alberti_bass_c_major``
— ``DIAG_PHRASE`` under a sounding accompaniment that produces no reference notes, so the
ground truth is the melody and the scored behaviour is melody extraction.  Until this
baseline that behaviour was 0% measured on a corpus of 39 monophonic cases, while the
complaint the accuracy work exists to answer is a polyphonic piano recording.

All 39 pre-existing cases are byte-identical — 0 differences across every metric, key,
tempo and note count, not merely +0.000 on notes.f1 — which is the determinism proof that
adding the ``accompaniment`` parameter to ``synth.render`` moved no existing audio.  The
new cases are the entire delta:

    notes.f1                          0.954 ->  0.908   (precision 0.948 -> 0.901)
    notes.recall                      0.965 ->  0.918
    solfa.degree_accuracy             1.000 ->  0.984
    solfa.syllable_accuracy           0.982 ->  0.968
    solfa.octave_error_rate           0.002 ->  0.051
    solfa.ghost_count                 0.692 ->  0.878
    solfa.anchor_matches_reference    1.000 ->  0.951
    tempo.abs_error                  11.872 -> 13.415
    key.confidence_auc                0.947 ->  0.925

Both new cases score notes.f1 **0.000**, so they cannot regress and every future melody
extraction change has room to demonstrate a gain — the same trade KEY_HEADROOM_CASES was
added under, taken at full price on the headline metric because the regime is worth more
than the number.  ``key.exact`` actually *rises* 0.974 -> 0.976: both read C major, since
the accompaniment reinforces the key it accompanies.

**The aggregate that sees this defect is solfa.octave_error_rate, and it is the only one.**
It moves 25x while degree_accuracy loses 0.016, because the pipeline is transcribing the
LEFT HAND: eleven segments in the right places at pitches 12-24 semitones low, which a
diatonic accompaniment makes look like plausible degrees. ``notes.f1`` and the octave
column are the two to read on these cases; the degree columns are actively misleading here
and that is worth knowing about the degree columns generally.
"""

import json
from pathlib import Path

import pytest
from tests.accuracy.corpus import CASES, corpus_fingerprint

pytestmark = pytest.mark.accuracy

BASELINE_PATH = Path(__file__).parent / "baseline.json"

_NO_BASELINE = "no baseline.json — record one with `python -m tests.accuracy.report --write-baseline`"

# The pipeline is deterministic for a byte-identical wav (fixed thresholds, ONNX CPU
# inference), so this tolerance only has to absorb float round-tripping through JSON,
# not run-to-run variance.  Kept small so a genuine regression is never rounded away.
TOLERANCE = 0.02

# Metrics where a smaller number is better.  Everything not listed is higher-is-better.
LOWER_IS_BETTER = frozenset(
    {
        "tempo.abs_error",
        "tempo.rel_error",
        "tempo.octave_error",
        "key.relative_confusion",
        "key.fifth_confusion",
        "key.parallel_confusion",
        "solfa.octave_error_rate",
        "solfa.ghost_count",
        "solfa.chromatic_ghosts",
        "notes.semitone_neighbour_ghosts",
        "n_failed",
    }
)

# Descriptive columns rather than quality signals:
#   notes.n_ref            fixed by the corpus.
#   notes.n_est            no better/worse direction — more notes can be ghosts.
#   beats.best_shift_beats says *which* shift aligned best, not how well.
#   solfa.matched          the denominator of the solfa rates.  It moves whenever the
#                          matcher's reference frame moves, with no change in
#                          transcription quality, so gating it rejects fixes.
#   tempo.metrical_factor  a label ("4x"), not a score.
#   key.confidence         descriptive on its own; the gateable form is the aggregate
#                          key.confidence_separation.
#   conf.mean_correct / conf.mean_wrong / conf.auc / conf.separation
#                          the note-confidence family.  None of the four is gateable,
#                          for two different reasons, and it takes both to rule the
#                          whole family out.
#                          The means fail on RESCALING: halve every note's confidence
#                          and mean_wrong "improves" with nothing about the
#                          transcription changed.  auc (a rank statistic) and
#                          separation (a difference) both survive that.
#                          But all four fail on POPULATION, which is the reason the
#                          last two are listed here too.  "Wrong" is defined by the
#                          matcher, so fixing a class of error removes that class
#                          from the denominator — and the errors a fix reaches first
#                          are the quiet notes, which were the easy ones to separate.
#                          Measured on the pyin octave fix: diag_baseline's octave
#                          error rate went 0.455 -> 0.000 and notes.f1 0.462 -> 0.846
#                          while conf.separation fell 0.139, because the notes that
#                          became correct dragged mean_correct down with them.  Four
#                          cases show the same signature.  Gating these rejects fixes,
#                          exactly as it would for solfa.matched.
#                          Nothing here protects confidence from genuinely degrading;
#                          that is a real gap in this gate, stated rather than papered
#                          over.  Read the family next to solfa.octave_error_rate,
#                          and mean_wrong against the mobile's fixed 0.5 cut in
#                          theme.ts, which is why it is recorded at all.
#                          key.confidence_auc and key.confidence_separation ARE gated:
#                          their population is the 38 corpus cases and a fix migrates
#                          one or two, where a case's wrong-note pool is often 2-4
#                          notes and one migration swings the statistic by 0.1.
#   solfa.anchor_matches_reference
#                          a whole-clip notational choice, and reference_doh breaks an
#                          exact tie toward the lower doh, so it is a step function of
#                          the estimated pitch median that one note can flip.  Read it
#                          next to solfa.octave_error_rate; do not gate it.
#   notes.f1_with_offset   the only column that observes duration at all, and the one
#                          place the reported tempo still leaks in: the duration
#                          criterion is in seconds, so an over-reported tempo buys a
#                          finer duration grid.  Measured with the hearing held
#                          perfect and only the reported tempo varying, the triplet
#                          case scores 1.000 at 345 BPM and 0.692 at the correct 96,
#                          so gating it would reject a Phase-2 tempo fix by 0.308.
#                          It IS sensitive to duration at a fixed tempo (0.692 as
#                          quantized, 0.615 with every duration crushed to an eighth,
#                          0.000 at 1.0 beat), which is what Phase 2c needs — read it
#                          next to tempo.metrical_factor, not on its own.
#   solfa.chromatic_count / solfa.ref_chromatic_count
#                          how many accidentals the notation carries and how many the
#                          music actually contains.  Neither has a direction on its own:
#                          the harmonic minor cases genuinely need one (la-based minor
#                          writes the raised 7th as se), so fewer is not better and more
#                          is not worse.  They are here to make the gated
#                          solfa.chromatic_ghosts readable — an excess of 0 against a
#                          reference count of 2 means something different from 0
#                          against 0.
NOT_A_GATE = frozenset(
    {
        "notes.n_ref",
        "notes.n_est",
        "notes.f1_with_offset",
        "beats.best_shift_beats",
        "solfa.matched",
        "solfa.anchor_matches_reference",
        "solfa.chromatic_count",
        "solfa.ref_chromatic_count",
        "tempo.metrical_factor",
        "key.confidence",
        "conf.mean_correct",
        "conf.mean_wrong",
        "conf.auc",
        "conf.separation",
        "n_cases",
    }
)


def _regressions(current: dict, recorded: dict) -> list[str]:
    """Every metric that moved in the wrong direction by more than TOLERANCE."""
    lines: list[str] = []
    for name, base_value in sorted(recorded.items()):
        if name in NOT_A_GATE or not isinstance(base_value, (bool, int, float)):
            continue
        if name not in current:  # metric renamed or removed — a stale baseline, not a regression
            continue
        base = float(base_value)
        now = float(current[name])
        delta = now - base
        worse = delta > TOLERANCE if name in LOWER_IS_BETTER else delta < -TOLERANCE
        if worse:
            lines.append(f"{name}: baseline {base:.4f} -> current {now:.4f} (delta {delta:+.4f})")
    return lines


def _provenance(baseline: dict | None) -> str:
    """A suffix naming any flag difference, so a failing delta is attributable.

    A/Bing one flag against the baseline is what the flags are for, so a difference is
    not itself an error — but reading "regressed" without knowing an env var moved is
    how a flag change gets mistaken for a code regression.

    Imported lazily because ``report`` pulls in ``runner``, and this module
    deliberately costs nothing but ``corpus`` at collection time.
    """
    if baseline is None:
        return ""
    from tests.accuracy.report import _effective_flags, _flag_drift

    drift = _flag_drift(_effective_flags(), baseline.get("flags"))
    if not drift:
        return ""
    return (
        "\n  NOTE: this run's flags differ from the baseline's (" + ", ".join(drift) + ")"
        "\n  so the deltas above may be the flags and not the code."
    )


@pytest.fixture(scope="session")
def outcomes() -> dict:
    """The whole corpus, transcribed once, keyed by case name.

    ``runner`` is imported here rather than at module scope so that collecting this
    file costs nothing but ``corpus`` — CI's default run imports every test module
    even though ``-m "not accuracy"`` deselects all of these, and a collection-time
    import of the scoring stack would make that run depend on modules only the
    accuracy tests use.
    """
    from tests.accuracy import runner

    return {outcome.name: outcome for outcome in runner.run_all()}


@pytest.fixture(scope="session")
def baseline() -> dict | None:
    """The recorded baseline, or None — and it must describe the corpus on disk now.

    A baseline whose fingerprint does not match is worse than no baseline: every case
    name is still present, so the per-case "absent from baseline" skip never fires and
    the gate happily diffs today's numbers against numbers measured on different
    audio.  Failing loudly is the only safe reading.
    """
    if not BASELINE_PATH.exists():
        return None
    recorded = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    recorded_fingerprint = recorded.get("corpus", {}).get("fingerprint")
    current = corpus_fingerprint(CASES)
    if recorded_fingerprint != current:
        pytest.fail(
            f"baseline.json was recorded against corpus {recorded_fingerprint} but this "
            f"corpus is {current}; its numbers were measured on different audio. "
            "Re-record with `python -m tests.accuracy.report --write-baseline`."
        )
    return recorded


@pytest.mark.parametrize("case_name", [case.name for case in CASES])
def test_case_did_not_regress(case_name: str, outcomes: dict, baseline: dict | None) -> None:
    outcome = outcomes[case_name]
    assert outcome.ok, f"transcribe() raised for {case_name}: {outcome.error}"

    if baseline is None:
        pytest.skip(_NO_BASELINE)
    recorded = baseline.get("cases", {}).get(case_name)
    if recorded is None:
        pytest.skip(f"{case_name} is absent from baseline.json — re-record the baseline")

    regressions = _regressions(outcome.metrics, recorded.get("metrics", {}))
    assert not regressions, (
        f"{case_name} regressed (tolerance {TOLERANCE}):\n  "
        + "\n  ".join(regressions)
        + _provenance(baseline)
    )


def test_aggregate_did_not_regress(outcomes: dict, baseline: dict | None) -> None:
    """Corpus-wide means, so a change that trades one case for another still shows."""
    from tests.accuracy import runner

    current = runner.aggregate(list(outcomes.values()))

    if baseline is None:
        pytest.skip(_NO_BASELINE)

    regressions = _regressions(current, baseline.get("aggregate", {}))
    assert not regressions, (
        f"corpus aggregate regressed (tolerance {TOLERANCE}):\n  "
        + "\n  ".join(regressions)
        + _provenance(baseline)
    )
