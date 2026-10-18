"""Full-speed runs (``/v1/grade/run``): the shape (the notes in order) and the landing note, on synthetic contours."""

import json
from io import BytesIO

import numpy as np
import pytest
import soundfile as sf
from app.config import settings
from app.pipeline import runs, vocal
from app.pipeline.grade import TargetNote
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _no_warmup(monkeypatch):
    # The lifespan's warm-up writes a temporary clip of its own on a thread.
    monkeypatch.setattr(settings, "pipeline_warmup", False)

SR = 22050
HOP = vocal.HOP / vocal.SAMPLE_RATE
DOH = 58  # Bb3
LEAD_IN = 1.0
#: The pentatonic run of the Riffs & runs board: d' l s m r in semiquavers, landing on a two-beat d.
PENTATONIC = [(12, .25), (9, .25), (7, .25), (4, .25), (2, .25), (0, 2.0)]


def _targets(line=PENTATONIC, doh=DOH):
    out, at = [], 0.0
    for semis, beats in line:
        out.append(TargetNote(doh + semis, at, beats))
        at += beats
    return out


def _sung(line, tempo, glide=0.03, late=0.0, octave=0, cents=None, step=HOP):
    """A per-frame (or per-sample, with ``step=1/SR``) MIDI contour singing ``line`` (pitch or None, beats)."""
    beat = 60.0 / tempo
    end = LEAD_IN + late + sum(b for _, b in line) * beat + 0.4
    t = np.arange(0.0, end, step)
    c = np.full(t.size, np.nan)
    at = LEAD_IN + late
    for i, (p, b) in enumerate(line):
        if p is not None:
            c[(t >= at) & (t < at + b * beat)] = p + octave + (cents or {}).get(i, 0) / 100.0
        at += b * beat
    k = max(1, int(round(glide / step)))
    if k > 1:  # each step reached by a short glide, as a voice moves
        voiced = ~np.isnan(c)
        kernel = np.ones(k) / k
        c = np.where(voiced, np.convolve(np.nan_to_num(c), kernel, "same") / np.maximum(np.convolve(voiced, kernel, "same"), 1e-9), np.nan)
    return t, c


def _contour(t, c):
    ones = np.ones(t.size)
    return vocal.Contour(times=t, midi=c, voiced_prob=ones, rms=ones, rms_fast=ones)


def _audio(c):
    voiced = ~np.isnan(c)
    f0 = np.where(voiced, 440.0 * 2.0 ** ((np.nan_to_num(c, nan=60.0) - 69.0) / 12.0), 0.0)
    phase = 2.0 * np.pi * np.cumsum(f0) / SR
    y = sum(w * np.sin(k * phase) for k, w in enumerate((1.0, 0.5, 0.25), start=1))
    return (0.5 * y * voiced).astype(np.float32)


def _as_sung(targets):
    return [(t.pitch_midi, t.dur_beats) for t in targets]


def _grade(line, tempo=60.0, **kw):
    return runs.grade_contour(_contour(*_sung(line, tempo, **kw)), _targets(), tempo, LEAD_IN)


def test_a_clean_run_at_full_speed_is_followed_and_lands():
    g = _grade(_as_sung(_targets()))
    assert (g.followed, g.run_notes, g.landing_status) == (5, 5, "hit")
    assert g.score == 100
    assert "followed the run" in g.summary and "in tune" in g.summary


def test_a_skipped_note_is_not_followed():
    line = _as_sung(_targets())
    line[2] = (line[1][0], 0.25)  # l held on through where s was due
    g = _grade(line)
    assert [n.status for n in g.notes] == ["hit", "hit", "wrong", "hit", "hit"]
    assert g.score == round(100 * (0.6 * 4 / 5 + 0.4))
    assert "4 of the run's 5 notes" in g.summary


def test_the_run_backwards_is_not_the_run():
    backwards = [(DOH + s, b) for s, b in [(2, .25), (4, .25), (7, .25), (9, .25), (12, .25), (0, 2.0)]]
    g = _grade(backwards)
    assert g.followed <= 1
    assert g.score < 80


def test_a_run_an_octave_down_and_a_little_late_is_the_same_run():
    g = _grade(_as_sung(_targets()), octave=-12, late=0.15)
    assert g.octave_shift == -12
    assert 0.1 <= g.offset_sec <= 0.2
    assert g.score == 100


def test_a_flat_landing_is_close_and_a_wrong_one_fails_the_run():
    flat = _grade(_as_sung(_targets()), cents={5: -60})
    assert flat.landing_status == "near" and -80 <= flat.landing_cents <= -35
    assert flat.score == 80 and "flat" in flat.summary

    line = _as_sung(_targets())
    line[5] = (DOH + 2, 2.0)  # lands on ray
    wrong = _grade(line)
    assert wrong.landing_status == "wrong"
    assert wrong.score == 60 and "wrong note" in wrong.summary


def test_a_run_with_no_landing_note_held():
    line = _as_sung(_targets())
    line[5] = (None, 2.0)
    g = _grade(line)
    assert g.landing_status == "missed" and g.followed == 5
    assert g.score == 60


def test_silence_marks_nothing():
    t = np.arange(0.0, 5.0, HOP)
    g = runs.grade_contour(_contour(t, np.full(t.size, np.nan)), _targets(), 60.0, LEAD_IN)
    assert g.score == 0
    assert all(n.status == "missed" for n in g.notes)
    assert "Nothing was heard" in g.summary


def test_the_trace_is_the_take_over_the_run_from_beat_one():
    g = _grade(_as_sung(_targets()))
    assert 0 < len(g.trace) <= runs.TRACE_POINTS
    assert g.trace[0][0] < 0.05 and g.trace[-1][0] > 1.25  # from the run's start into the landing
    assert abs(g.trace[0][1] - (DOH + 12)) < 1.0


def test_a_sung_run_is_marked_from_audio_at_full_and_ninety_percent():
    for tempo in (60.0, 54.0):
        _, c = _sung(_as_sung(_targets()), tempo, step=1.0 / SR)
        g = runs.grade_run(_audio(c), SR, _targets(), tempo, LEAD_IN)
        assert g.score == 100, (tempo, [n.status for n in g.notes], g.landing_status)

        line = _as_sung(_targets())
        line[3] = (line[2][0], 0.25)  # s held on through where m was due
        _, c = _sung(line, tempo, step=1.0 / SR)
        g = runs.grade_run(_audio(c), SR, _targets(), tempo, LEAD_IN)
        assert not g.notes[3].followed and g.score < 100


def test_the_run_route_round_trips():
    from app.main import app

    _, c = _sung(_as_sung(_targets()), 60.0, step=1.0 / SR)
    buf = BytesIO()
    sf.write(buf, _audio(c), SR, format="WAV")
    notes = [{"pitchMidi": t.pitch_midi, "startBeat": t.start_beat, "durBeats": t.dur_beats} for t in _targets()]
    with TestClient(app) as client:
        r = client.post("/v1/grade/run", files={"audio": ("take.wav", BytesIO(buf.getvalue()), "audio/wav")},
                        data={"target": json.dumps({"notes": notes, "tempoBpm": 60, "leadInSec": LEAD_IN, "maxSec": 8})})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["score"] == 100 and body["followed"] == 5 and body["runNotes"] == 5
        assert body["landingStatus"] == "hit" and body["landingMidi"] == DOH
        assert {"t", "midi"} == set(body["trace"][0])

        one = client.post("/v1/grade/run", files={"audio": ("take.wav", BytesIO(buf.getvalue()), "audio/wav")},
                          data={"target": json.dumps({"notes": notes[:1], "tempoBpm": 60})})
        assert one.status_code == 422
        slow = client.post("/v1/grade/run", files={"audio": ("take.wav", BytesIO(buf.getvalue()), "audio/wav")},
                           data={"target": json.dumps({"notes": notes, "tempoBpm": 5})})
        assert slow.status_code == 422
