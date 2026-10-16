"""The hymn corpus reads the published tunes as the blog does, and its sheet metrics point the right way.

The corpus (``tests.accuracy.hymn_corpus``) is the yardstick for meter, bar lines, pickup and
rhythm; ``python -m tests.accuracy.report --hymns`` runs it in full.  Here: the Python port of
the blog's melody parser agrees with the blog (``tools/blog/lib/solfa.mjs`` when node is
installed; every hymn's underlay syllable count, which the blog build enforces, either way),
the held-out split stays frozen, the sheet metrics score a right sheet 1 and a wrong one less,
and a handful of tunes go through the real pipeline (``FAST_SLUGS``) against the baseline.
"""

import json
import shutil
import subprocess

import pytest

from app.pipeline.transcriber import TranscribedNote
from tests.accuracy import hymn_corpus as hc
from tests.accuracy import metrics
from tests.accuracy.synth import RefNote

pytestmark = pytest.mark.skipif(not hc.CASES, reason="content/hymns is not beside server/")

_NODE_PARSE = """
import { parseMelody } from "./tools/blog/lib/solfa.mjs";
import fs from "node:fs";
const out = {};
for (const f of fs.readdirSync("content/hymns/tunes").filter((f) => f.endsWith(".json"))) {
  const t = JSON.parse(fs.readFileSync("content/hymns/tunes/" + f, "utf8"));
  if (!t.melody) continue;
  const p = parseMelody(t.melody, { time: t.time, pickup: t.pickup || 0 });
  out[f.slice(0, -5)] = { offset: p.offset, end: p.endBeat, notes: p.notes.map((n) => [n.pitchMidi, n.startBeat, n.durBeats]) };
}
process.stdout.write(JSON.stringify(out));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_port_reads_every_tune_as_the_blog_does():
    done = subprocess.run(
        ["node", "--input-type=module", "-e", _NODE_PARSE], cwd=hc.REPO_ROOT, capture_output=True, text=True,
        timeout=60, check=True,
    )
    blog = json.loads(done.stdout)
    assert blog
    for path in sorted(hc.TUNES_DIR.glob("*.json")):
        tune = json.loads(path.read_text(encoding="utf-8"))
        if not tune.get("melody"):
            continue
        mine = hc.parse_melody(tune["melody"], tune["time"], tune.get("pickup") or 0)
        theirs = blog[path.stem]
        assert mine.offset == theirs["offset"] and mine.end_beat == theirs["end"], path.stem
        assert [[n.pitch_midi, n.start_beat, n.dur_beats] for n in mine.notes] == theirs["notes"], path.stem


def test_every_published_hymn_has_a_syllable_for_each_note():
    for slug, _tune, melody, underlay in hc.load_tunes():
        assert len(hc.syllabify(underlay)) == len(melody.notes), slug


def test_the_corpus_is_every_published_tune_twice_and_the_split_is_frozen():
    slugs = {c.slug for c in hc.CASES}
    assert len(hc.CASES) == 2 * len(slugs)
    assert {c.render for c in hc.CASES} == {"instrument", "sung"}
    # Pinned: a change to the salt or the rule would move tunes between halves, and a detector
    # tuned on dev would then be scored on tunes it was tuned on.
    assert [hc.split_of(s) for s in ("new-britain", "old-hundredth", "st-anne", "duke-street", "adeste-fideles")] == [
        "dev", "dev", "test", "test", "dev"]
    tests = [c for c in hc.CASES if c.split == "test"]
    assert 0.4 < len(tests) / len(hc.CASES) < 0.6
    assert set(hc.FAST_SLUGS) <= slugs


def test_a_case_starts_where_the_score_does_and_breathes_without_moving_an_onset():
    case = next(c for c in hc.CASES if c.slug == "new-britain" and c.render == "sung")
    assert case.time_signature == "3/4" and case.bar_offset == 2.0 and case.bpb == 3.0
    onsets, t = [], 0.0
    for pitch, dur in case.notes:
        if pitch is not None:
            onsets.append(t)
        t += dur
    melody = hc.parse_melody(json.loads((hc.TUNES_DIR / "new-britain.json").read_text())["melody"], "3/4", 1)
    assert onsets == [n.start_beat - melody.offset for n in melody.notes]
    assert any(p is None for p, _ in case.notes)  # it breathes at the punctuation
    assert case.written == tuple(n.dur_beats for n in melody.notes)


# ── sheet_metrics points the right way ──────────────────────────────────────────

# Amazing Grace's opening: 3/4 with a one-beat pickup, at 90.
_TEMPO = 90
_GRID = [(62, 2, 1), (67, 3, 2), (71, 5, 0.5), (67, 5.5, 0.5), (71, 6, 2), (69, 8, 1), (67, 9, 2), (64, 11, 1),
         (62, 12, 2), (62, 14, 1), (67, 15, 2)]
_OFFSET = 2.0
_REF = [RefNote(p, 0.4 + (s - _OFFSET) * 60 / _TEMPO, d * 60 / _TEMPO, s - _OFFSET, d) for p, s, d in _GRID]
_WRITTEN = [d for _, _, d in _GRID]


def _sheet(notes, time="3/4", tempo=_TEMPO, origin=None):
    est = [TranscribedNote(p, s, d, 1, "d", "", 1.0) for p, s, d in notes]
    origin = 0.4 - est[0].start_beat * 60 / tempo if origin is None else origin
    return metrics.sheet_metrics(_REF, _WRITTEN, "3/4", _OFFSET, _TEMPO, est, time, tempo, origin)


def test_the_published_sheet_scores_one():
    m = _sheet(_GRID)
    assert m["meter.exact"] and m["pickup.exact"] and m["bars.all_right"]
    assert m["bars.in_right_bar"] == m["bars.placed_exact"] == m["rhythm.ioi_exact"] == m["rhythm.dur_exact"] == 1.0


def test_the_sheet_written_from_the_first_note_in_4_4_loses_its_bars_not_its_rhythm():
    today = _sheet([(p, s - _OFFSET, d) for p, s, d in _GRID], time="4/4")
    assert not today["meter.exact"] and not today["pickup.exact"] and not today["bars.all_right"]
    assert today["bars.in_right_bar"] < 0.7
    assert today["rhythm.ioi_exact"] == 1.0
    # The right meter without the pickup still draws every bar line a beat early.
    no_pickup = _sheet([(p, s - _OFFSET, d) for p, s, d in _GRID])
    assert no_pickup["meter.exact"] and not no_pickup["pickup.exact"]
    assert no_pickup["bars.in_right_bar"] < 0.7 and not no_pickup["bars.all_right"]


def test_a_sheet_at_double_tempo_keeps_its_proportions_but_not_its_note_values():
    doubled = _sheet([(p, 2 * s, 2 * d) for p, s, d in _GRID], time="6/4", tempo=2 * _TEMPO)
    assert doubled["bars.in_right_bar"] == 1.0  # six beats of half the length: the same bars
    assert doubled["rhythm.ioi_exact"] == 0.0 and doubled["rhythm.ioi_proportional"] == 1.0
    assert not doubled["meter.exact"]


def test_a_missed_note_counts_against_the_bars_and_a_wrong_pitch_is_not_paired():
    missing = _sheet(_GRID[:5] + _GRID[6:])
    assert missing["bars.found"] == pytest.approx(10 / 11)
    assert missing["bars.in_right_bar"] == pytest.approx(10 / 11) and missing["bars.all_right"]
    wrong = _sheet([(60 if i == 3 else p, s, d) for i, (p, s, d) in enumerate(_GRID)])
    assert wrong["bars.found"] == pytest.approx(10 / 11)


# ── A few tunes through the pipeline ────────────────────────────────────────────

_GATED = ("meter.bar_length", "pickup.exact", "bars.in_right_bar", "rhythm.ioi_exact", "notes.f1")


@pytest.mark.parametrize("case", hc.select(slugs=hc.FAST_SLUGS, render="instrument"), ids=lambda c: c.name)
def test_fast_hymns_do_not_regress(case):
    from tests.accuracy.report import HYMN_BASELINE_PATH
    from tests.accuracy.runner import run_hymn_case

    outcome = run_hymn_case(case)
    assert outcome.ok, outcome.error
    if not HYMN_BASELINE_PATH.exists():
        pytest.skip("no hymn_baseline.json")
    recorded = json.loads(HYMN_BASELINE_PATH.read_text(encoding="utf-8"))["cases"].get(case.name)
    if recorded is None:
        pytest.skip(f"{case.name} is not in hymn_baseline.json")
    for name in _GATED:
        assert float(outcome.metrics[name]) >= float(recorded["metrics"][name]) - 1e-9, name
