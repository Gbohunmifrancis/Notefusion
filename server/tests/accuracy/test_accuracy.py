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
  semitone_steps_c_major / solfa.octave_error_rate  0.100 -> 0.167 (Phase 2 grid)
      The sixteenth grid recovers two reference notes that previously matched
      nothing (solfa.matched 10 -> 12, notes.recall 0.833 -> 1.000, ghosts 5 -> 3)
      and one of them carries a wrong octave mark, so the same underlying error
      moved from "missing note" to "note with a misplaced octave dot" — visible
      where it was invisible, and the smaller user-facing error of the two.
      degree_accuracy stayed 1.000 and the corpus-wide rate improved
      (0.121 -> 0.115).  A further rise here is a real regression; this step is not.
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
NOT_A_GATE = frozenset(
    {
        "notes.n_ref",
        "notes.n_est",
        "notes.f1_with_offset",
        "beats.best_shift_beats",
        "solfa.matched",
        "solfa.anchor_matches_reference",
        "tempo.metrical_factor",
        "key.confidence",
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
    assert not regressions, f"{case_name} regressed (tolerance {TOLERANCE}):\n  " + "\n  ".join(regressions)


def test_aggregate_did_not_regress(outcomes: dict, baseline: dict | None) -> None:
    """Corpus-wide means, so a change that trades one case for another still shows."""
    from tests.accuracy import runner

    current = runner.aggregate(list(outcomes.values()))

    if baseline is None:
        pytest.skip(_NO_BASELINE)

    regressions = _regressions(current, baseline.get("aggregate", {}))
    assert not regressions, f"corpus aggregate regressed (tolerance {TOLERANCE}):\n  " + "\n  ".join(regressions)
