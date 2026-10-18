"""Clap it back (``/v1/grade/rhythm``): onsets found in synthetic click tracks, lined up with the rhythm, marked."""

import json
from io import BytesIO

import numpy as np
import pytest
import soundfile as sf
from app.config import settings
from app.pipeline import onsets
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _no_warmup(monkeypatch):
    # The lifespan's warm-up runs pyin on a thread; this file's takes are over before it is, and exiting under it aborts.
    monkeypatch.setattr(settings, "pipeline_warmup", False)

SR = 22050
TEMPO = 90.0
BEAT = 60.0 / TEMPO
LEAD_IN = 2.0
#: Two bars: crotchets, a quaver pair, a dotted crotchet and quaver, a minim's rest... (each clap's beat).
RHYTHM = [0.0, 1.0, 2.0, 2.5, 3.0, 4.0, 5.5, 6.0]


def _clicks(times, seconds, noise=0.003, gain=0.6, seed=1):
    """Claps as short decaying noise bursts at ``times`` over a quiet room."""
    rng = np.random.default_rng(seed)
    y = rng.normal(0.0, noise, int(seconds * SR))
    n = int(0.05 * SR)
    for t in times:
        burst = gain * rng.normal(0.0, 1.0, n) * np.exp(-np.arange(n) / SR / 0.008)
        s = int(t * SR)
        seg = y[s:s + n]
        seg += burst[:seg.size]
    return y.astype(np.float32)


def _due(beats=RHYTHM, shift=0.0, ratio=1.0):
    return [LEAD_IN + shift + (b - beats[0]) * BEAT / ratio + beats[0] * BEAT for b in beats]


def _take(times):
    return _clicks(times, LEAD_IN + 8 * BEAT + 1.5)


def test_claps_are_found_where_they_were_clapped():
    times = _due()
    heard = onsets.detect_onsets(_take(times), SR)
    assert heard.size == len(times)
    assert np.max(np.abs(heard - np.asarray(times))) < 0.015


def test_a_rhythm_clapped_in_time_scores_full_marks():
    g = onsets.grade_rhythm(_take(_due()), SR, RHYTHM, TEMPO, LEAD_IN)
    assert (g.hits, g.near, g.missed, g.extra) == (len(RHYTHM), 0, 0, 0)
    assert g.score == 100
    assert g.summary.startswith("8 of 8 claps in time")


def test_a_late_recording_is_lined_up_not_punished():
    # A phone's recording latency puts every clap a quarter of a second late against the count-in.
    g = onsets.grade_rhythm(_take(_due(shift=0.25)), SR, RHYTHM, TEMPO, LEAD_IN)
    assert g.score == 100
    assert 0.22 <= g.offset_sec <= 0.28


def test_one_clap_off_the_beat_is_close_and_one_left_out_is_missed():
    times = _due()
    times[3] += 0.11  # the second quaver of the pair, 110 ms late
    del times[6]  # the quaver after the rest, not clapped
    g = onsets.grade_rhythm(_take(times), SR, RHYTHM, TEMPO, LEAD_IN)
    assert [c.status for c in g.claps] == ["hit", "hit", "hit", "near", "hit", "hit", "missed", "hit"]
    assert 90 <= g.claps[3].error_ms <= 130
    assert g.claps[6].error_ms is None
    assert g.score == round(100 * (6 + 0.5) / 8)
    assert "1 close" in g.summary and "1 missed" in g.summary


def test_an_extra_clap_costs_half_a_clap():
    times = _due()
    times.append(LEAD_IN + 4.5 * BEAT)  # a clap in the middle of the minim
    g = onsets.grade_rhythm(_take(sorted(times)), SR, RHYTHM, TEMPO, LEAD_IN)
    assert g.hits == len(RHYTHM) and g.extra == 1
    assert g.score == round(100 * (8 - 0.5) / 8)
    assert "1 extra" in g.summary


def test_a_rhythm_clapped_a_little_quick_is_still_the_rhythm_and_is_told_so():
    g = onsets.grade_rhythm(_take(_due(ratio=1.08)), SR, RHYTHM, TEMPO, LEAD_IN)
    assert g.hits == len(RHYTHM)
    assert 1.06 <= g.tempo_ratio <= 1.10
    assert "sped up" in g.summary


def test_the_count_in_clicks_are_not_claps():
    count_in = [LEAD_IN - k * BEAT for k in (4, 3, 2, 1)]
    g = onsets.grade_rhythm(_take(count_in + _due()), SR, RHYTHM, TEMPO, LEAD_IN)
    assert g.score == 100 and g.extra == 0


def test_steady_claps_that_ignore_the_rhythm_do_not_pass():
    # Every beat clapped, whatever the rhythm asked: the quavers and the rest are wrong.
    steady = [LEAD_IN + k * BEAT for k in range(8)]
    g = onsets.grade_rhythm(_take(steady), SR, RHYTHM, TEMPO, LEAD_IN)
    assert g.score < 80


def test_silence_and_a_quiet_room_mark_nothing():
    quiet = onsets.grade_rhythm(_clicks([], 8.0), SR, RHYTHM, TEMPO, LEAD_IN)
    assert quiet.score == 0 and quiet.missed == len(RHYTHM)
    assert "No claps" in quiet.summary
    silent = onsets.grade_rhythm(np.zeros(SR * 8, dtype=np.float32), SR, RHYTHM, TEMPO, LEAD_IN)
    assert silent.score == 0


def test_the_rhythm_route_round_trips():
    from app.main import app

    buf = BytesIO()
    sf.write(buf, _take(_due()), SR, format="WAV")
    target = {"beats": RHYTHM, "tempoBpm": TEMPO, "leadInSec": LEAD_IN, "maxSec": 12}
    with TestClient(app) as client:
        r = client.post("/v1/grade/rhythm", files={"audio": ("take.wav", BytesIO(buf.getvalue()), "audio/wav")},
                        data={"target": json.dumps(target)})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["score"] == 100 and body["hits"] == len(RHYTHM)
        assert {"index", "beat", "errorMs", "status"} == set(body["claps"][0])
        assert "tempoRatio" in body and "offsetSec" in body

        none = client.post("/v1/grade/rhythm", files={"audio": ("take.wav", BytesIO(buf.getvalue()), "audio/wav")},
                           data={"target": json.dumps({"beats": [], "tempoBpm": TEMPO})})
        assert none.status_code == 422
        junk = client.post("/v1/grade/rhythm", files={"audio": ("take.wav", BytesIO(buf.getvalue()), "audio/wav")},
                           data={"target": "{"})
        assert junk.status_code == 422
