"""``python -m tests.accuracy.report`` — run the corpus, print a table, write the JSON.

Run from ``server/``:

    python -m tests.accuracy.report                  # table + report.json
    python -m tests.accuracy.report --write-baseline  # also freeze baseline.json
    python -m tests.accuracy.report --filter vibrato  # only cases whose name matches
    python -m tests.accuracy.report --vocal           # the sung corpus
    python -m tests.accuracy.report --vocal --slices  # its stress slices, one line each
    python -m tests.accuracy.report --hymns --jobs 4  # the published hymn tunes: meter, bars, rhythm
    python -m tests.accuracy.report --hymns --split test  # only the held-out half
    python -m tests.accuracy.report --songs --jobs 4  # studio songs through the linked-song path
    python -m tests.accuracy.report --songs --split test  # ...the held-out half

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
from tests.accuracy.real_loader import load_real_cases, real_corpus_fingerprint
from tests.accuracy.runner import METRIC_NAMESPACES, CaseOutcome, aggregate, run_all
from tests.accuracy.runner import run_real, run_vocal
from tests.accuracy.vocal_corpus import CASES as VOCAL_CASES, SLICE_CASES, SLICES, vocal_corpus_fingerprint

from app.config import settings

REPORT_PATH = Path(__file__).parent / "report.json"
REAL_REPORT_PATH = Path(__file__).parent / "real_report.json"
VOCAL_REPORT_PATH = Path(__file__).parent / "vocal_report.json"
VOCAL_BASELINE_PATH = Path(__file__).parent / "vocal_baseline.json"
VOCAL_SLICES_REPORT_PATH = Path(__file__).parent / "vocal_slices_report.json"
VOCAL_SLICES_BASELINE_PATH = Path(__file__).parent / "vocal_slices_baseline.json"
BASELINE_PATH = Path(__file__).parent / "baseline.json"
HYMN_REPORT_PATH = Path(__file__).parent / "hymn_report.json"
HYMN_BASELINE_PATH = Path(__file__).parent / "hymn_baseline.json"
SONG_REPORT_PATH = Path(__file__).parent / "song_report.json"
SONG_BASELINE_PATH = Path(__file__).parent / "song_baseline.json"
# The Afrobeats set (``afro_songs``) is kept apart: its own report and baseline, so the studio songs'
# baseline is unchanged by it.
AFRO_REPORT_PATH = Path(__file__).parent / "afro_report.json"
AFRO_BASELINE_PATH = Path(__file__).parent / "afro_baseline.json"

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
        "tempo_plain_level": settings.tempo_plain_level,
        "meter_detect": settings.meter_detect,
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


def _real_document(
    outcomes: list[CaseOutcome],
    cases: tuple,
    name_filter: str,
) -> dict:
    return {
        "schema": SCHEMA_VERSION,
        "metric_namespaces": list(METRIC_NAMESPACES),
        "flags": _effective_flags(),
        "corpus": {
            "kind": "real",
            "n_cases": len(cases),
            "fingerprint": real_corpus_fingerprint(cases),
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


_SLICE_COLUMNS = ("key.exact", "solfa.syllable_accuracy", "solfa.chromatic_ghosts", "seq.syllable_error_rate", "notes.f1")


def _print_slices(outcomes: list[CaseOutcome]) -> None:
    """One line per slice: each is a different weakness, so their pooled mean says little."""
    print()
    print(f"{'slice':<13} {'n':>3} " + " ".join(f"{column:>24}" for column in _SLICE_COLUMNS))
    for name in SLICES:
        mine = [outcome for outcome in outcomes if outcome.tags[1] == name]
        if mine:
            means = aggregate(mine)
            print(f"{name:<13} {len(mine):>3} " + " ".join(f"{_num(means.get(column)):>24}" for column in _SLICE_COLUMNS))


# ── Entry point ───────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m tests.accuracy.report", description=__doc__)
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        help="also freeze the run into baseline.json (the regression gate reads it)",
    )
    parser.add_argument(
        "--real",
        action="store_true",
        help="score labelled recordings in tests/accuracy/real/ into real_report.json",
    )
    parser.add_argument(
        "--vocal",
        action="store_true",
        help="score the sung/hummed vocal corpus into vocal_report.json (baseline: vocal_baseline.json)",
    )
    parser.add_argument(
        "--slices",
        action="store_true",
        help="with --vocal: score the stress slices instead (vocal_slices_report.json / vocal_slices_baseline.json)",
    )
    parser.add_argument(
        "--hymns",
        action="store_true",
        help="score the published hymn tunes, played and sung, against their scores: meter, bar lines, "
        "pickup, rhythm and tempo level as well as the notes (hymn_report.json / hymn_baseline.json)",
    )
    parser.add_argument(
        "--songs",
        action="store_true",
        help="score the studio songs (the hymn tunes produced as songs) through the linked-song path: "
        "vocal separation, the beat from the mix, chords from the instrumental (song_report.json / song_baseline.json)",
    )
    parser.add_argument(
        "--split",
        default="",
        choices=("", "dev", "test"),
        help="with --hymns or --songs: only the dev half (tune on it) or the held-out test half",
    )
    parser.add_argument("--jobs", type=int, default=1, help="with --hymns or --songs: processes to run cases in")
    parser.add_argument("--set", default="both", choices=("both", "csd", "hymns", "afro"), dest="song_set",
                        help="with --songs: the real studio takes (csd), the synthetic singer's hymns, both, or the "
                        "Afrobeats songs (afro: afro_report.json / afro_baseline.json)")
    parser.add_argument("--stem", default="auto", choices=("auto", "mdx", "sim"),
                        help="with --songs: the MDX model's vocal stem, a simulated one (no model needed), or "
                        "auto (the model's for the real takes, simulated for the synthetic singer)")
    parser.add_argument("--lane", default="pro", choices=("pro", "normal"),
                        help="with --songs: the Pro lane (fast=True, as Pro links run) or the normal lane")
    parser.add_argument("--data", type=Path, default=None, help="with --songs: where rendered songs and stems are cached")
    parser.add_argument("--filter", default="", metavar="SUBSTR", help="only cases whose name contains SUBSTR")
    args = parser.parse_args(argv)

    if args.real and args.write_baseline:
        parser.error("--write-baseline is only supported for the synthetic corpus")
    if args.slices and not args.vocal:
        parser.error("--slices goes with --vocal")
    if (args.split or args.jobs != 1) and not (args.hymns or args.songs):
        parser.error("--split and --jobs go with --hymns or --songs")

    if args.songs:
        return _main_songs(args, parser)
    if args.hymns:
        return _main_hymns(args, parser)
    if args.vocal:
        return _main_vocal(args, parser)

    if args.real:
        real_cases = load_real_cases()
        cases = tuple(case for case in real_cases if args.filter in case.name)
        if not cases:
            parser.error("no real cases found" if not real_cases else f"no case name contains {args.filter!r}")
        outcomes = run_real(cases)
        document = _real_document(outcomes, cases, args.filter)
        _print_cases(outcomes, None)
        _print_aggregate(document["aggregate"], None)
        REAL_REPORT_PATH.write_text(
            json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8"
        )
        print(f"\nwrote {REAL_REPORT_PATH.name}")
        failed = [outcome.name for outcome in outcomes if not outcome.ok]
        if failed:
            print(f"\n{len(failed)} case(s) raised: {', '.join(failed)}")
            return 1
        return 0

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


def _main_vocal(args, parser) -> int:
    corpus = SLICE_CASES if args.slices else VOCAL_CASES
    report_path = VOCAL_SLICES_REPORT_PATH if args.slices else VOCAL_REPORT_PATH
    baseline_path = VOCAL_SLICES_BASELINE_PATH if args.slices else VOCAL_BASELINE_PATH
    cases = tuple(case for case in corpus if args.filter in case.name)
    if not cases:
        parser.error(f"no vocal case name contains {args.filter!r}")
    if args.write_baseline and args.filter:
        parser.error("--write-baseline needs the full corpus; drop --filter")

    outcomes = run_vocal(cases)
    document = {
        "schema": SCHEMA_VERSION,
        "metric_namespaces": list(METRIC_NAMESPACES),
        "flags": _effective_flags(),
        "corpus": {
            "kind": "vocal_slices" if args.slices else "vocal",
            "n_cases": len(cases),
            "fingerprint": vocal_corpus_fingerprint(corpus),
            "sample_rate": synth.SAMPLE_RATE,
            "filter": args.filter,
        },
        "aggregate": aggregate(outcomes),
        "cases": _document(outcomes, args.filter)["cases"],
    }
    baseline = json.loads(baseline_path.read_text(encoding="utf-8")) if baseline_path.exists() else None
    print()
    if baseline is not None and baseline.get("corpus", {}).get("fingerprint") != document["corpus"]["fingerprint"]:
        print(f"WARNING: {baseline_path.name} was recorded against a different vocal corpus; re-record it.")
        print()
    _print_cases(outcomes, baseline)
    _print_aggregate(document["aggregate"], baseline)
    if args.slices:
        _print_slices(outcomes)
    report_path.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    print(f"\nwrote {report_path.name}")
    if args.write_baseline:
        baseline_path.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8")
        print(f"wrote {baseline_path.name}")
    failed = [outcome.name for outcome in outcomes if not outcome.ok]
    if failed:
        print(f"\n{len(failed)} case(s) raised: {', '.join(failed)}")
        return 1
    return 0


# ── The hymn corpus ───────────────────────────────────────────────────────────

# The columns of the hymn tables: the sheet's (meter, bars, pickup, rhythm, tempo level) and,
# for comparison with the other corpora, the notes'.
_HYMN_COLUMNS = (
    "meter.exact", "meter.bar_length", "pickup.exact", "bars.in_right_bar", "bars.placed_exact", "bars.all_right",
    "rhythm.ioi_exact", "rhythm.ioi_proportional", "tempo.level_right", "notes.f1", "key.exact",
    "seq.syllable_error_rate",
)


_HYMN_SHORT = {
    "meter.exact": "meter", "meter.bar_length": "barlen", "pickup.exact": "pickup", "bars.in_right_bar": "in_bar",
    "bars.placed_exact": "placed", "bars.all_right": "allbars", "rhythm.ioi_exact": "ioi", "rhythm.ioi_proportional": "ioi_prop",
    "tempo.level_right": "level", "notes.f1": "notes.f1", "key.exact": "key", "seq.syllable_error_rate": "syl_err",
}


def _meter_group(time_signature: str) -> str:
    return {"4/4": "4/4", "2/2": "2/2+2/4", "2/4": "2/2+2/4", "3/4": "3/4", "3/2": "3/2+6/4", "6/4": "3/2+6/4",
            "6/8": "6/8+9/8", "9/8": "6/8+9/8"}.get(time_signature, "other")


def _hymn_groups(outcomes: list[CaseOutcome]) -> dict[str, dict[str, float]]:
    """Aggregates over the splits, the two renders, and the published meters."""
    groups: dict[str, list[CaseOutcome]] = {"all": list(outcomes)}
    for o in outcomes:
        split, render, time_signature, start = o.tags[1], o.tags[2], o.tags[3], o.tags[4]
        for name in (split, f"{split}/{render}", f"{split}/meter {_meter_group(time_signature)}", f"{split}/{start}"):
            groups.setdefault(name, []).append(o)
    return {name: aggregate(members) for name, members in sorted(groups.items())}


def _print_hymn_groups(groups: dict[str, dict[str, float]], baseline: dict | None) -> None:
    base = (baseline or {}).get("groups", {})
    short = [_HYMN_SHORT[c] for c in _HYMN_COLUMNS]
    print(f"{'group':<26} {'n':>4} " + " ".join(f"{s:>9}" for s in short))
    for name, means in groups.items():
        print(f"{name:<26} {int(means.get('n_cases', 0)):>4} " + " ".join(f"{_num(means.get(c)):>9}" for c in _HYMN_COLUMNS))
        recorded = base.get(name)
        if recorded:
            deltas = []
            for c in _HYMN_COLUMNS:
                a, b = means.get(c), recorded.get(c)
                deltas.append(f"{float(a) - float(b):>+9.3f}" if isinstance(a, (int, float)) and isinstance(b, (int, float)) else f"{'-':>9}")
            print(f"{'  vs baseline':<26} {'':>4} " + " ".join(deltas))


def _main_hymns(args, parser) -> int:
    from tests.accuracy.hymn_corpus import CASES as HYMN_CASES, hymn_corpus_fingerprint
    from tests.accuracy.runner import HYMN_METRIC_NAMESPACES, run_hymns

    cases = tuple(c for c in HYMN_CASES if args.filter in c.name and (not args.split or c.split == args.split))
    if not cases:
        parser.error("no hymn case matches" if HYMN_CASES else "no hymns found (content/hymns is not beside server/)")
    if args.write_baseline and (args.filter or args.split):
        parser.error("--write-baseline needs the full corpus; drop --filter and --split")

    outcomes = run_hymns(cases, jobs=max(1, args.jobs))
    groups = _hymn_groups(outcomes)
    document = {
        "schema": SCHEMA_VERSION,
        "metric_namespaces": list(HYMN_METRIC_NAMESPACES),
        "flags": _effective_flags(),
        "corpus": {
            "kind": "hymns",
            "n_cases": len(cases),
            "fingerprint": hymn_corpus_fingerprint(cases),
            "sample_rate": synth.SAMPLE_RATE,
            "filter": args.filter,
            "split": args.split,
        },
        "groups": groups,
        "cases": {
            o.name: {
                "ok": o.ok, "error": o.error, "tags": list(o.tags), "ref_key": o.ref_key, "est_key": o.est_key,
                "ref_tempo": o.ref_tempo, "est_tempo": o.est_tempo, "n_ref": o.n_ref, "n_est": o.n_est,
                "metrics": o.metrics,
            }
            for o in outcomes
        },
    }
    baseline = json.loads(HYMN_BASELINE_PATH.read_text(encoding="utf-8")) if HYMN_BASELINE_PATH.exists() else None
    print()
    if baseline is not None and not args.filter and not args.split and (
            baseline.get("corpus", {}).get("fingerprint") != document["corpus"]["fingerprint"]):
        print(f"WARNING: {HYMN_BASELINE_PATH.name} was recorded against a different hymn corpus; re-record it.")
        print()
    if baseline is not None:
        drift = _flag_drift(document["flags"], baseline.get("flags"))
        if drift:
            print("flags differ from baseline: " + ", ".join(drift))
            print()
    print(f"{'case':<44} {'time ref/est':>13} {'tempo':>8} {'bars':>6} {'ioi':>6} {'notes':>6}")
    for o in outcomes:
        if not o.ok:
            print(f"{o.name:<44} FAILED  {o.error}")
            continue
        est_time = next((t[4:] for t in o.tags if t.startswith("est:")), "?")
        print(f"{o.name:<44} {o.tags[3] + '>' + est_time:>13} {f'{o.ref_tempo}/{o.est_tempo}':>8} "
              f"{_num(o.metrics.get('bars.in_right_bar')):>6} {_num(o.metrics.get('rhythm.ioi_exact')):>6} "
              f"{_num(o.metrics.get('notes.f1')):>6}")
    print()
    _print_hymn_groups(groups, baseline)
    HYMN_REPORT_PATH.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    print(f"\nwrote {HYMN_REPORT_PATH.name}")
    if args.write_baseline:
        HYMN_BASELINE_PATH.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8")
        print(f"wrote {HYMN_BASELINE_PATH.name}")
    failed = [o.name for o in outcomes if not o.ok]
    if failed:
        print(f"\n{len(failed)} case(s) raised: {', '.join(failed)}")
        return 1
    return 0


# ── The studio songs ──────────────────────────────────────────────────────────


def _main_songs(args, parser) -> int:
    from tests.accuracy import studio_songs as ss

    data = args.data or ss.DEFAULT_DATA
    sets = ss.SETS if args.song_set == "both" else (args.song_set,)
    afro = args.song_set == "afro"
    report_path, baseline_path, full_set = (
        (AFRO_REPORT_PATH, AFRO_BASELINE_PATH, "afro") if afro else (SONG_REPORT_PATH, SONG_BASELINE_PATH, "both"))
    cases = ss.select(args.split, args.filter, sets=sets, data=data)
    if not cases:
        parser.error("no song case matches")
    if args.write_baseline and (args.filter or args.split or args.song_set != full_set or args.stem != "auto"
                                or args.lane != "pro"):
        parser.error("--write-baseline needs both sets (or the afro set) in full, stems on auto and the Pro lane")
    outcomes = ss.run(cases, data=data, stem=args.stem, fast=args.lane == "pro", jobs=max(1, args.jobs))
    groups = ss.groups(outcomes)
    document = {
        "schema": SCHEMA_VERSION,
        # The song path's own switches beside the shared ones (``settings.song_doh``/``song_scoops``/
        # ``band_bars``/``song_bleed``).
        "flags": {**_effective_flags(), "song_doh": settings.song_doh, "song_scoops": settings.song_scoops,
                  "band_bars": settings.band_bars, "song_bleed": settings.song_bleed},
        "corpus": {
            "kind": "studio_songs",
            "n_cases": len(cases),
            "fingerprint": ss.corpus_fingerprint(cases),
            "filter": args.filter,
            "split": args.split,
            "sets": list(sets),
            "stem": args.stem,
            "lane": args.lane,
        },
        "groups": groups,
        "cases": {
            o.name: {
                "ok": o.ok, "error": o.error, "tags": list(o.tags), "ref_key": o.ref_key, "est_key": o.est_key,
                "ref_tempo": o.ref_tempo, "est_tempo": o.est_tempo, "est_time": o.est_time, "n_ref": o.n_ref,
                "n_est": o.n_est, "read": o.read, "metrics": o.metrics,
            }
            for o in outcomes
        },
    }
    baseline = json.loads(baseline_path.read_text(encoding="utf-8")) if baseline_path.exists() else None
    print()
    if baseline is not None and not args.filter and not args.split and args.song_set == full_set and (
            baseline.get("corpus", {}).get("fingerprint") != document["corpus"]["fingerprint"]):
        print(f"WARNING: {baseline_path.name} was recorded against different songs; re-record it.")
        print()
    print(f"{'case':<44} {'key ref -> est':>22} {'tempo':>8} {'time':>9} {'n':>7} {'notes':>6} {'read':>6}")
    for o in outcomes:
        if not o.ok:
            print(f"{o.name:<44} FAILED  {o.error}")
            continue
        print(f"{o.name:<44} {o.ref_key + ' -> ' + o.est_key:>22} {f'{o.ref_tempo}/{o.est_tempo}':>8} "
              f"{o.tags[3] + '>' + o.est_time:>9} {f'{o.n_ref}/{o.n_est}':>7} {_num(o.metrics.get('notes.f1')):>6} "
              f"{_num(o.metrics.get('solfa.read_error_rate')):>6}")
    print()
    base = (baseline or {}).get("groups", {})
    print(f"{'group':<34} {'n':>4} " + " ".join(f"{ss.SHORT[c]:>8}" for c in ss.COLUMNS))
    for name, means in groups.items():
        if name.count("/") > (1 if not args.split else 2):
            continue  # the breakdown by production is in the JSON; the table keeps to the sets and halves
        print(f"{name:<34} {int(means.get('n_cases', 0)):>4} " + " ".join(f"{_num(means.get(c)):>8}" for c in ss.COLUMNS))
        recorded = base.get(name)
        if recorded:
            deltas = []
            for c in ss.COLUMNS:
                a, b = means.get(c), recorded.get(c)
                ok = isinstance(a, (int, float)) and isinstance(b, (int, float))
                deltas.append(f"{float(a) - float(b):>+8.3f}" if ok else f"{'-':>8}")
            print(f"{'  vs baseline':<34} {'':>4} " + " ".join(deltas))
    report_path.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    print(f"\nwrote {report_path.name}")
    if args.write_baseline:
        baseline_path.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8")
        print(f"wrote {baseline_path.name}")
    failed = [o.name for o in outcomes if not o.ok]
    if failed:
        print(f"\n{len(failed)} case(s) raised: {', '.join(failed)}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
