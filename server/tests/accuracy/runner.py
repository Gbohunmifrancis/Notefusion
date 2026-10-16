"""Drives the synthetic corpus through the real pipeline and scores every case.

Phase 1 is measurement only — nothing here touches ``app/``.  Each case is rendered
to a temp wav, handed to ``transcribe()`` exactly as ``app/jobs/queue.py`` does, and
scored into a flat, dotted metric dict that ``report.py`` writes to ``baseline.json``
and later phases diff against.

Three details come straight from how the pipeline actually behaves:

  Temp file ownership    ``transcribe()`` deletes only the temporary wav it creates
                         *itself* when converting a non-wav input; a ``.wav`` path is
                         handed back untouched by ``_ensure_wav_path``, and the
                         privacy unlink lives in ``JobQueue._run``.  A direct caller
                         therefore owns the file it wrote, so cleanup happens here in
                         a ``finally`` with ``missing_ok=True`` — correct whichever
                         component ends up deleting it.

  Failure is a datum     A near-silent or degenerate clip can legitimately raise
                         ``LowConfidenceError``, and the music21 section of the
                         pipeline has no ``try`` at all, so arbitrary exceptions are
                         reachable.  Both become ``ok=False`` rows carrying the
                         exception type, never an aborted corpus run.

  No overrides           ``key_override`` skips key detection entirely and hard-sets
                         ``key_confidence`` to 1.0, and ``tempo_override`` is echoed
                         back verbatim as ``tempo``.  Passing the ground truth in
                         would make the key and tempo metrics measure nothing, so the
                         baseline always runs with both unset.
"""

import os
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from app.pipeline.transcriber import TranscriptionResult, transcribe
from tests.accuracy import metrics, synth, vocal_synth
from tests.accuracy.corpus import CASES, Case
from tests.accuracy.hymn_corpus import HymnCase
from tests.accuracy.real_loader import RealCase, load_real_cases
from tests.accuracy.vocal_corpus import CASES as VOCAL_CASES, VocalCase

# The metric groups, in the order they appear in a row.  These prefixes are the
# keys ``baseline.json`` is stored under — renaming one silently invalidates every
# recorded baseline, so they are treated as a wire contract.
METRIC_NAMESPACES = ("notes", "beats", "key", "tempo", "solfa", "conf", "seq")


# ── Outcome type ──────────────────────────────────────────────────────────────


@dataclass
class CaseOutcome:
    name: str
    tags: tuple[str, ...]
    ok: bool  # False if transcribe() raised
    error: str  # "" when ok
    ref_key: str
    est_key: str
    ref_tempo: int
    est_tempo: int
    n_ref: int
    n_est: int
    metrics: dict[str, float]  # namespace-flattened, e.g. "notes.f1", "key.exact"


# ── Scoring ───────────────────────────────────────────────────────────────────


def _prefixed(namespace: str, values: dict) -> dict[str, float]:
    """Flatten one metric group under its dotted namespace."""
    return {f"{namespace}.{name}": value for name, value in values.items()}


def _score(case: Case, ref: list[synth.RefNote], result: TranscriptionResult) -> dict[str, float]:
    """Every metric group for one case, flattened into a single dict.

    Both tempi go into the timing metrics.  The *estimated* tempo converts estimated
    beats to seconds, because that is the tempo the pipeline's own beat numbers are
    expressed in; the *reference* tempo sets the tolerance window and the reference's
    own clock, so the score can never become a function of the tempo under test.
    ``metrics`` has the full argument.
    """
    flat: dict[str, float] = {}
    flat.update(
        _prefixed(
            "notes",
            metrics.note_metrics_seconds(ref, result.notes, result.tempo, case.tempo_bpm),
        )
    )
    flat.update(
        _prefixed(
            "beats",
            metrics.onset_metrics_beats(ref, result.notes, result.tempo, case.tempo_bpm),
        )
    )
    flat.update(_prefixed("key", metrics.key_metrics(case.key, result.key)))
    flat.update(_prefixed("tempo", metrics.tempo_metrics(case.tempo_bpm, result.tempo)))
    flat.update(
        _prefixed(
            "solfa",
            metrics.solfa_metrics(ref, result.notes, case.key, result.tempo, case.tempo_bpm),
        )
    )
    # Phase 3b replaces amplitude-as-confidence, and no other column can see that: conf
    # is carried on the notes rather than used to select them, so every metric above is
    # identical whatever value it holds.  Its keys are absent on cases that got every
    # note right (nothing to discriminate against) — see note_confidence_metrics.
    flat.update(
        _prefixed(
            "conf",
            metrics.note_confidence_metrics(
                ref, result.notes, result.tempo, case.tempo_bpm
            ),
        )
    )
    # Descriptive, and the only handle Phase 4b has: replacing the raw correlation
    # coefficient with a margin cannot change the key DECISION, so without this column
    # every key metric is byte-identical before and after that change.  aggregate()
    # turns it into key.confidence_separation, which is the gateable form.
    flat["key.confidence"] = float(result.key_confidence)
    return flat


# ── Case runner ───────────────────────────────────────────────────────────────


def run_case(case: Case) -> CaseOutcome:
    """Render *case*, transcribe it, score it.  Never raises on a pipeline failure."""
    audio, ref = synth.render(
        case.notes, case.tempo_bpm, case.options, accompaniment=case.accompaniment
    )

    # mkstemp so parallel invocations cannot collide on a name; the descriptor is
    # closed immediately because soundfile opens the path itself.
    handle, raw_path = tempfile.mkstemp(prefix=f"nf_acc_{case.name}_", suffix=".wav")
    os.close(handle)
    wav_path = Path(raw_path)

    result: TranscriptionResult | None = None
    error = ""
    try:
        synth.write_wav(wav_path, audio)
        result = transcribe(wav_path, mode="melody")
    except Exception as exc:  # noqa: BLE001 — LowConfidenceError and anything music21 throws
        error = f"{type(exc).__name__}: {exc}"
    finally:
        # The harness wrote this file, so the harness deletes it.  transcribe() leaves
        # a .wav input alone; missing_ok keeps this correct if that ever changes.
        wav_path.unlink(missing_ok=True)

    if result is None:
        return CaseOutcome(
            name=case.name,
            tags=case.tags,
            ok=False,
            error=error,
            ref_key=case.key,
            est_key="",
            ref_tempo=case.tempo_bpm,
            est_tempo=0,
            n_ref=len(ref),
            n_est=0,
            metrics={},
        )

    return CaseOutcome(
        name=case.name,
        tags=case.tags,
        ok=True,
        error="",
        ref_key=case.key,
        est_key=result.key,
        ref_tempo=case.tempo_bpm,
        est_tempo=result.tempo,
        n_ref=len(ref),
        n_est=len(result.notes),
        metrics=_score(case, ref, result),
    )


def run_all(cases: Sequence[Case] | None = None) -> list[CaseOutcome]:
    """Run every case in order.  Defaults to the whole corpus."""
    return [run_case(case) for case in (CASES if cases is None else cases)]


def run_real_case(case: RealCase) -> CaseOutcome:
    """Transcribe one labelled real recording without modifying or deleting the fixture."""
    result: TranscriptionResult | None = None
    error = ""
    try:
        result = transcribe(case.audio_path, mode="melody")
    except Exception as exc:  # noqa: BLE001 - failures are reportable data
        error = f"{type(exc).__name__}: {exc}"

    if result is None:
        return CaseOutcome(
            name=case.name,
            tags=("real",),
            ok=False,
            error=error,
            ref_key=case.key,
            est_key="",
            ref_tempo=case.tempo_bpm,
            est_tempo=0,
            n_ref=len(case.notes),
            n_est=0,
            metrics={},
        )

    flat: dict[str, float] = {}
    flat.update(_prefixed("notes", metrics.note_metrics_seconds(
        case.notes, result.notes, result.tempo, case.tempo_bpm)))
    flat.update(_prefixed("beats", metrics.onset_metrics_beats(
        case.notes, result.notes, result.tempo, case.tempo_bpm)))
    flat.update(_prefixed("key", metrics.key_metrics(case.key, result.key)))
    flat.update(_prefixed("tempo", metrics.tempo_metrics(case.tempo_bpm, result.tempo)))
    flat.update(_prefixed("solfa", metrics.solfa_metrics(
        case.notes, result.notes, case.key, result.tempo, case.tempo_bpm)))
    flat.update(_prefixed("conf", metrics.note_confidence_metrics(
        case.notes, result.notes, result.tempo, case.tempo_bpm)))
    flat["key.confidence"] = float(result.key_confidence)
    return CaseOutcome(
        name=case.name,
        tags=("real",),
        ok=True,
        error="",
        ref_key=case.key,
        est_key=result.key,
        ref_tempo=case.tempo_bpm,
        est_tempo=result.tempo,
        n_ref=len(case.notes),
        n_est=len(result.notes),
        metrics=flat,
    )


def run_real(cases: Sequence[RealCase] | None = None) -> list[CaseOutcome]:
    return [run_real_case(case) for case in (load_real_cases() if cases is None else cases)]


def run_vocal_case(case: VocalCase) -> CaseOutcome:
    """Render one vocal case with ``vocal_synth``, transcribe it, score it."""
    audio, ref = vocal_synth.render(case.notes, case.tempo_bpm, case.options)
    handle, raw_path = tempfile.mkstemp(prefix=f"nf_voc_{case.name}_", suffix=".wav")
    os.close(handle)
    wav_path = Path(raw_path)

    result: TranscriptionResult | None = None
    error = ""
    try:
        synth.write_wav(wav_path, audio)
        result = transcribe(wav_path, mode="melody")
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}"
    finally:
        wav_path.unlink(missing_ok=True)

    if result is None:
        return CaseOutcome(
            name=case.name, tags=case.tags, ok=False, error=error, ref_key=case.key,
            est_key="", ref_tempo=case.tempo_bpm, est_tempo=0, n_ref=len(ref), n_est=0,
            metrics={},
        )

    flat: dict[str, float] = {}
    flat.update(_prefixed("notes", metrics.note_metrics_seconds(ref, result.notes, result.tempo, case.tempo_bpm)))
    flat.update(_prefixed("beats", metrics.onset_metrics_beats(ref, result.notes, result.tempo, case.tempo_bpm)))
    flat.update(_prefixed("key", metrics.key_metrics(case.key, result.key)))
    flat.update(_prefixed("tempo", metrics.tempo_metrics(case.tempo_bpm, result.tempo)))
    flat.update(_prefixed("solfa", metrics.solfa_metrics(ref, result.notes, case.key, result.tempo, case.tempo_bpm)))
    flat.update(_prefixed("conf", metrics.note_confidence_metrics(ref, result.notes, result.tempo, case.tempo_bpm)))
    flat.update(_prefixed("seq", metrics.sequence_metrics(ref, result.notes, case.key)))
    flat["key.confidence"] = float(result.key_confidence)
    return CaseOutcome(
        name=case.name, tags=case.tags, ok=True, error="", ref_key=case.key,
        est_key=result.key, ref_tempo=case.tempo_bpm, est_tempo=result.tempo,
        n_ref=len(ref), n_est=len(result.notes), metrics=flat,
    )


def run_vocal(cases: Sequence[VocalCase] | None = None) -> list[CaseOutcome]:
    return [run_vocal_case(case) for case in (VOCAL_CASES if cases is None else cases)]


# ── The hymn corpus ───────────────────────────────────────────────────────────

# The hymn corpus adds the written sheet's namespaces (``metrics.sheet_metrics``).
HYMN_METRIC_NAMESPACES = METRIC_NAMESPACES + ("meter", "bars", "pickup", "rhythm")


def run_hymn_case(case: HymnCase) -> CaseOutcome:
    """Render one hymn tune (instrument or sung), transcribe it, score the notes and the sheet."""
    if case.render == "instrument":
        audio, ref = synth.render(case.notes, case.tempo_bpm, case.options)
    else:
        audio, ref = vocal_synth.render(case.notes, case.tempo_bpm, case.options)
    handle, raw_path = tempfile.mkstemp(prefix=f"nf_hymn_{case.slug}_", suffix=".wav")
    os.close(handle)
    wav_path = Path(raw_path)
    result: TranscriptionResult | None = None
    error = ""
    try:
        synth.write_wav(wav_path, audio)
        result = transcribe(wav_path, mode="melody", audio_preview=False)
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}"
    finally:
        wav_path.unlink(missing_ok=True)

    if result is None:
        return CaseOutcome(
            name=case.name, tags=case.tags, ok=False, error=error, ref_key=case.key,
            est_key="", ref_tempo=case.tempo_bpm, est_tempo=0, n_ref=len(ref), n_est=0, metrics={},
        )
    flat: dict[str, float] = {}
    flat.update(_prefixed("notes", metrics.note_metrics_seconds(ref, result.notes, result.tempo, case.tempo_bpm)))
    flat.update(_prefixed("beats", metrics.onset_metrics_beats(ref, result.notes, result.tempo, case.tempo_bpm)))
    flat.update(_prefixed("key", metrics.key_metrics(case.key, result.key)))
    tempo = metrics.tempo_metrics(case.tempo_bpm, result.tempo)
    flat.update(_prefixed("tempo", tempo))
    flat["tempo.level_right"] = tempo["metrical_factor"] == 1.0
    flat.update(_prefixed("solfa", metrics.solfa_metrics(ref, result.notes, case.key, result.tempo, case.tempo_bpm)))
    flat.update(_prefixed("seq", metrics.sequence_metrics(ref, result.notes, case.key)))
    flat.update(metrics.sheet_metrics(
        ref, case.written, case.time_signature, case.bar_offset, case.tempo_bpm,
        result.notes, result.time_signature, result.tempo, result.beat_origin_sec,
    ))
    flat["key.confidence"] = float(result.key_confidence)
    return CaseOutcome(
        name=case.name, tags=case.tags + (f"est:{result.time_signature}",), ok=True, error="", ref_key=case.key,
        est_key=result.key, ref_tempo=case.tempo_bpm, est_tempo=result.tempo,
        n_ref=len(ref), n_est=len(result.notes), metrics=flat,
    )


def run_hymns(cases: Sequence[HymnCase], jobs: int = 1) -> list[CaseOutcome]:
    """Every case, in order; across ``jobs`` processes when more than one (each case is
    independent and deterministic, so the outcome does not depend on how many)."""
    if jobs <= 1:
        return [run_hymn_case(case) for case in cases]
    from concurrent.futures import ProcessPoolExecutor

    with ProcessPoolExecutor(max_workers=jobs) as pool:
        return list(pool.map(run_hymn_case, cases, chunksize=1))


# ── Aggregation ───────────────────────────────────────────────────────────────


def aggregate(outcomes: list[CaseOutcome]) -> dict[str, float]:
    """Mean of every metric over the cases that ran, plus ``n_cases``/``n_failed``.

    Bools are averaged as 0/1 on purpose — ``key.exact`` becomes key accuracy across
    the corpus.  Non-numeric metric values (a metric that reports a label rather than
    a number) are skipped rather than crashing the mean.
    """
    scored = [o for o in outcomes if o.ok]

    collected: dict[str, list[float]] = {}
    for outcome in scored:
        for name, value in outcome.metrics.items():
            if isinstance(value, (bool, int, float)):  # bool first: it is an int subclass
                collected.setdefault(name, []).append(float(value))

    means: dict[str, float] = {
        name: sum(values) / len(values) for name, values in sorted(collected.items())
    }
    means.update(_confidence_separation(scored))
    means["n_cases"] = len(outcomes)
    means["n_failed"] = len(outcomes) - len(scored)
    return means


def _confidence_separation(scored: list[CaseOutcome]) -> dict[str, float]:
    """Two views of whether key confidence can be thresholded at all.

    This is what makes key *calibration* gateable: a confidence that cannot be
    thresholded is the defect, and the mean confidence alone cannot show it (measured
    over the corpus: 0.810 mean when right against 0.719 on the most confident wrong
    answer, and no threshold separates the two populations at all — the lowest
    confidence on a CORRECT key is 0.568, well below that 0.719).  Undefined — and
    therefore absent — unless the corpus contains at least one case the detector got
    wrong, which is exactly when the question has an answer.  A missing key is a skip
    in the regression gate, not a regression.

    ``separation`` is mean(right) - max(wrong), which is the strict form: it only goes
    positive when the average correct answer outranks *every* wrong one.  It rests on
    a single order statistic though, so with a handful of wrong cases one unlucky case
    moves it a long way.  ``auc`` is the stable companion — the probability that a
    randomly chosen correct case outranks a randomly chosen wrong one, over all
    right x wrong pairs.  Both are reported because they fail differently: AUC can look
    healthy while the populations still overlap around the threshold the mobile
    actually cuts at, and separation can look poor because of one outlier.
    """
    right = [
        o.metrics["key.confidence"] for o in scored if "key.confidence" in o.metrics and o.metrics.get("key.exact")
    ]
    wrong = [
        o.metrics["key.confidence"]
        for o in scored
        if "key.confidence" in o.metrics and not o.metrics.get("key.exact")
    ]
    if not right or not wrong:
        return {}

    wins = sum(1.0 for r in right for w in wrong if r > w)
    ties = sum(1.0 for r in right for w in wrong if r == w)
    return {
        "key.confidence_separation": sum(right) / len(right) - max(wrong),
        "key.confidence_auc": (wins + 0.5 * ties) / (len(right) * len(wrong)),
    }
