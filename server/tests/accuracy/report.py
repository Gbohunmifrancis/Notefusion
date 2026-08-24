"""``python -m tests.accuracy.report`` — run the corpus, print a table, write the JSON.

Run from ``server/``:

    python -m tests.accuracy.report                  # table + report.json
    python -m tests.accuracy.report --write-baseline  # also freeze baseline.json
    python -m tests.accuracy.report --filter vibrato  # only cases whose name matches

``report.json`` is always overwritten; ``baseline.json`` only on ``--write-baseline``,
because recording a baseline is a deliberate act a human commits.  Once a baseline
exists the table grows a delta column — that is the whole point of the artifact for
phases 2-4.

The JSON carries the metric namespaces, the case count and a fingerprint of the case
definitions, and a baseline whose fingerprint does not match the corpus now on disk
is called out above the table — its numbers were measured on different audio, so a
delta against them means nothing.  It deliberately holds no timestamp: the file
should only change when the corpus or the numbers change, so a no-op run produces a
no-op diff.
"""

import argparse
import json
from pathlib import Path

from tests.accuracy import synth
from tests.accuracy.corpus import CASES, corpus_fingerprint
from tests.accuracy.runner import METRIC_NAMESPACES, CaseOutcome, aggregate, run_all

from app.config import settings

REPORT_PATH = Path(__file__).parent / "report.json"
BASELINE_PATH = Path(__file__).parent / "baseline.json"

# Bumped only if the JSON layout changes in a way a reader must notice.
SCHEMA_VERSION = 1

# Aggregate keys that are run bookkeeping, not metrics — printed in the header line
# instead of the metric table.
_BOOKKEEPING = ("n_cases", "n_failed")


# ── Provenance ────────────────────────────────────────────────────────────────


def _effective_flags() -> dict:
    """The accuracy flags this run actually resolved.

    Without this the JSON is unattributable: two reports with different numbers and
    nothing to say whether the pipeline changed or only an env var did.  That is not a
    hypothetical — a baseline recorded under one flag set was diffed against runs made
    under another for long enough to produce a wrong conclusion about which phase
    helped, and the corpus fingerprint could not catch it because the audio was
    identical.  Provenance is the other half of what the fingerprint does.

    Read from ``settings`` rather than ``os.environ`` so what lands in the file is the
    value the pipeline resolved, defaults included, not whichever subset of variables
    happened to be exported.
    """
    return {
        "beat_align": settings.beat_align,
        "pyin_refine": settings.pyin_refine,
        "pyin_max_seconds": settings.pyin_max_seconds,
        # Recorded next to the cap because it is what pays for the cap: the two are one
        # decision, and a report that shows a lifted cap without the grid that made it
        # affordable is the misattribution this whole block exists to prevent.
        "pyin_resolution": settings.pyin_resolution,
        "pyin_semitone": settings.pyin_semitone,
        "contour_first": settings.contour_first,
        "key_ensemble": settings.key_ensemble,
        "tempo_grid": settings.tempo_grid,
        "grid_refine": settings.grid_refine,
        "f0_merge": settings.f0_merge,
        "quantize_divisors": list(settings.quantize_divisors),
    }


def _flag_drift(current: dict, recorded: dict | None) -> list[str]:
    """Human-readable "name: baseline -> current" for every flag that differs.

    A baseline written before flags were recorded has none, which is reported as such
    rather than as thirty spurious differences.
    """
    if recorded is None:
        return ["(baseline predates flag provenance - it records none)"]
    return [
        f"{name}: {recorded.get(name, '?')} -> {value}"
        for name, value in current.items()
        if recorded.get(name) != value
    ]


def _document(outcomes: list[CaseOutcome], name_filter: str) -> dict:
    return {
        "schema": SCHEMA_VERSION,
        "metric_namespaces": list(METRIC_NAMESPACES),
        "flags": _effective_flags(),
        "corpus": {
            "n_cases": len(CASES),
            "fingerprint": corpus_fingerprint(CASES),
            "sample_rate": synth.SAMPLE_RATE,
            # Non-empty means the run was partial and must not be trusted as a baseline.
            "filter": name_filter,
        },
        "aggregate": aggregate(outcomes),
        "cases": {
            outcome.name: {
                "ok": outcome.ok,
                "error": outcome.error,
                "tags": list(outcome.tags),
                "ref_key": outcome.ref_key,
                "est_key": outcome.est_key,
                "ref_tempo": outcome.ref_tempo,
                "est_tempo": outcome.est_tempo,
                "n_ref": outcome.n_ref,
                "n_est": outcome.n_est,
                "metrics": outcome.metrics,
            }
            for outcome in outcomes
        },
    }


# ── Table ─────────────────────────────────────────────────────────────────────

# Printed output is deliberately pure ASCII: a redirected stdout on Windows encodes
# with the locale code page (cp1252), which cannot represent box-drawing or arrows.

_HEADLINE = "notes.f1"  # the per-case delta column tracks this one

_ROW = "{name:<26} {counts:>8} {notes:>9} {beats:>9} {shift:>10} {key:>21} {tempo:>9} {solfa:>10}"


def _num(value: object) -> str:
    """One table cell: three decimals, or a dash when the metric is absent."""
    if isinstance(value, (bool, int, float)):  # bool is an int subclass — 1.000 / 0.000
        return f"{float(value):.3f}"
    return "-"


def _print_cases(outcomes: list[CaseOutcome], baseline: dict | None) -> None:
    header = _ROW.format(
        name="case",
        counts="ref/est",
        notes="notes.f1",
        beats="beats.f1",
        shift="shift-inv",
        key="key ref -> est",
        tempo="tempo",
        solfa="solfa.deg",
    )
    if baseline is not None:
        header += f"  d({_HEADLINE})"
    print(header)
    print("-" * len(header))

    base_cases = (baseline or {}).get("cases", {})
    for outcome in outcomes:
        if not outcome.ok:
            print(f"{outcome.name:<26} FAILED  {outcome.error}")
            continue

        row = _ROW.format(
            name=outcome.name,
            counts=f"{outcome.n_ref}/{outcome.n_est}",
            notes=_num(outcome.metrics.get(_HEADLINE)),
            beats=_num(outcome.metrics.get("beats.f1")),
            shift=_num(outcome.metrics.get("beats.f1_shift_invariant")),
            key=f"{outcome.ref_key} -> {outcome.est_key}",
            tempo=f"{outcome.ref_tempo}/{outcome.est_tempo}",
            solfa=_num(outcome.metrics.get("solfa.degree_accuracy")),
        )
        if baseline is not None:
            recorded = base_cases.get(outcome.name, {}).get("metrics", {}).get(_HEADLINE)
            current = outcome.metrics.get(_HEADLINE)
            if isinstance(recorded, (int, float)) and isinstance(current, (int, float)):
                row += f"  {float(current) - float(recorded):+8.3f}"
            else:
                row += f"  {'new':>8}"
        print(row)


def _print_aggregate(current: dict[str, float], baseline: dict | None) -> None:
    n_cases = int(current.get("n_cases", 0))
    n_failed = int(current.get("n_failed", 0))
    print()
    print(f"-- aggregate over {n_cases} case(s), {n_failed} failed --")

    base_aggregate = (baseline or {}).get("aggregate", {})
    print(f"{'metric':<34} {'current':>9} {'baseline':>9} {'delta':>9}")
    for name, value in current.items():
        if name in _BOOKKEEPING:
            continue
        recorded = base_aggregate.get(name)
        if isinstance(recorded, (int, float)):
            print(
                f"{name:<34} {_num(value):>9} {_num(recorded):>9} "
                f"{float(value) - float(recorded):>+9.3f}"
            )
        else:
            print(f"{name:<34} {_num(value):>9} {'-':>9} {'-':>9}")


# ── Entry point ───────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m tests.accuracy.report", description=__doc__)
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        help="also freeze the run into baseline.json (the regression gate reads it)",
    )
    parser.add_argument("--filter", default="", metavar="SUBSTR", help="only cases whose name contains SUBSTR")
    args = parser.parse_args(argv)

    cases = [case for case in CASES if args.filter in case.name]
    if not cases:
        parser.error(f"no case name contains {args.filter!r}")
    # A filtered baseline would silently drop every other case from the gate.
    if args.write_baseline and args.filter:
        parser.error("--write-baseline needs the full corpus; drop --filter")

    outcomes = run_all(cases)

    baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8")) if BASELINE_PATH.exists() else None
    document = _document(outcomes, args.filter)

    # transcribe() prints its own diagnostics as it goes, so the table comes last.
    print()
    recorded_fingerprint = (baseline or {}).get("corpus", {}).get("fingerprint")
    if baseline is not None and recorded_fingerprint != document["corpus"]["fingerprint"]:
        print(
            f"WARNING: baseline.json was recorded against corpus {recorded_fingerprint} "
            f"but this corpus is {document['corpus']['fingerprint']} — the delta column "
            "compares numbers measured on different audio.  Re-record the baseline."
        )
        print()
    if baseline is not None:
        # A flag difference is legitimate — A/Bing one flag against the baseline is what
        # these exist for — so this is a note, not a warning.  It is printed because the
        # alternative is reading a delta column without knowing what produced it.
        drift = _flag_drift(document["flags"], baseline.get("flags"))
        if drift:
            print("flags differ from baseline: " + ", ".join(drift))
            print()
    _print_cases(outcomes, baseline)
    _print_aggregate(document["aggregate"], baseline)

    REPORT_PATH.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    print(f"\nwrote {REPORT_PATH.name}")
    if args.write_baseline:
        BASELINE_PATH.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8")
        print(f"wrote {BASELINE_PATH.name}")

    failed = [outcome.name for outcome in outcomes if not outcome.ok]
    if failed:
        print(f"\n{len(failed)} case(s) raised: {', '.join(failed)}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
