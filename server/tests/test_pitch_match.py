"""Pitch match on the existing grader: eight held notes in one take, each after its reference tone.

The app plays each note's tone for two beats and the singer holds it for four, all in one recording, so without
headphones the tones are in the take too. The grader's usual alignment search (1.5 s either side) can line those
tones up with the held notes; a pitch-match target asks for a narrow one (``offsetSearchSec``), which still absorbs a
phone's recording latency.
"""

import json
from io import BytesIO

import numpy as np
import pytest
import soundfile as sf
from app.config import settings
from app.pipeline.grade import TargetNote, grade
from fastapi.testclient import TestClient

SR = 22050
TEMPO = 60.0
BEAT = 60.0 / TEMPO
LEAD_IN = 1.0
TONE_BEATS, HOLD_BEATS = 2, 4
PITCH_MATCH_SEARCH = 0.35
# d m s d' l f r t, in D (the board's set).
SET = [62, 66, 69, 74, 71, 67, 64, 61]
TARGETS = [TargetNote(p, i * (TONE_BEATS + HOLD_BEATS) + TONE_BEATS, HOLD_BEATS) for i, p in enumerate(SET)]


@pytest.fixture(autouse=True)
def _no_warmup(monkeypatch):
    monkeypatch.setattr(settings, "pipeline_warmup", False)


def _render(spans, seconds):
    """Harmonic tones: ``spans`` of (start s, end s, midi, gain)."""
    t = np.arange(int(seconds * SR)) / SR
    y = np.zeros(t.size)
    for s, e, m, gain in spans:
        on = (t >= s) & (t < e)
        f = 440.0 * 2.0 ** ((m - 69.0) / 12.0)
        y[on] += gain * sum(w * np.sin(2 * np.pi * k * f * t[on]) for k, w in enumerate((1.0, 0.5, 0.25), start=1))
    return y.astype(np.float32)


def _take(sing: bool, latency=0.3, tone_gain=0.3):
    spans = []
    for i, p in enumerate(SET):
        tone = LEAD_IN + i * (TONE_BEATS + HOLD_BEATS) * BEAT
        spans.append((tone + latency, tone + TONE_BEATS * BEAT + latency, p, tone_gain))  # the phone's tone, heard late
        if sing:
            hold = tone + TONE_BEATS * BEAT
            spans.append((hold + latency + 0.2, hold + HOLD_BEATS * BEAT + latency - 0.1, p, 0.5))
    return _render(spans, LEAD_IN + len(SET) * (TONE_BEATS + HOLD_BEATS) * BEAT + 1.0)


def test_the_tones_alone_can_pass_for_the_singer_under_the_usual_search():
    # Why pitch match narrows the search: a silent singer's take, the phone's tones alone, lined up 1.5 s over.
    wide = grade(_take(sing=False), SR, TARGETS, TEMPO, LEAD_IN)
    assert wide.hits + wide.near > 0


def test_a_narrow_search_leaves_a_silent_singer_unmarked():
    narrow = grade(_take(sing=False), SR, TARGETS, TEMPO, LEAD_IN, offset_search_sec=PITCH_MATCH_SEARCH)
    assert narrow.missed == len(SET) and narrow.score == 0


def test_a_singer_holding_each_note_is_marked_with_the_tones_in_the_take():
    g = grade(_take(sing=True), SR, TARGETS, TEMPO, LEAD_IN, offset_search_sec=PITCH_MATCH_SEARCH)
    assert [n.status for n in g.notes] == ["hit"] * len(SET)
    assert g.score == 100


def test_the_grade_route_takes_a_narrow_search_and_refuses_a_wider_one():
    from app.main import app

    buf = BytesIO()
    sf.write(buf, _take(sing=False), SR, format="WAV")
    notes = [{"pitchMidi": t.pitch_midi, "startBeat": t.start_beat, "durBeats": t.dur_beats} for t in TARGETS]
    target = {"notes": notes, "tempoBpm": TEMPO, "leadInSec": LEAD_IN, "maxSec": 60}
    with TestClient(app) as client:
        r = client.post("/v1/grade", files={"audio": ("take.wav", BytesIO(buf.getvalue()), "audio/wav")},
                        data={"target": json.dumps({**target, "offsetSearchSec": PITCH_MATCH_SEARCH})})
        assert r.status_code == 200, r.text
        assert r.json()["missed"] == len(SET)

        wide = client.post("/v1/grade", files={"audio": ("take.wav", BytesIO(buf.getvalue()), "audio/wav")},
                           data={"target": json.dumps({**target, "offsetSearchSec": 2.0})})
        assert wide.status_code == 422
