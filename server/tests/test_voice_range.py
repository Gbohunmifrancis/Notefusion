"""Range finder (``/v1/range``): the notes held in a take, and its lowest and highest, on synthesised voices."""

import json
from io import BytesIO

import numpy as np
import pytest
import soundfile as sf
from app.config import settings
from app.pipeline import vocal, voice_range
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _no_warmup(monkeypatch):
    # The lifespan's warm-up writes a temporary clip of its own on a thread.
    monkeypatch.setattr(settings, "pipeline_warmup", False)

SR = 22050


def _hz(m):
    return 440.0 * 2.0 ** ((np.asarray(m) - 69.0) / 12.0)


def _voice(contour, vibrato_cents=0.0, vibrato_hz=5.5, sr=SR):
    """A harmonic 'voice' singing a per-sample MIDI contour (NaN is silence), with an optional vibrato."""
    t = np.arange(contour.size) / sr
    voiced = ~np.isnan(contour)
    m = np.nan_to_num(contour, nan=60.0) + vibrato_cents / 100.0 * np.sin(2 * np.pi * vibrato_hz * t)
    phase = 2.0 * np.pi * np.cumsum(np.where(voiced, _hz(m), 0.0)) / sr
    y = sum(w * np.sin(k * phase) for k, w in enumerate((1.0, 0.5, 0.25), start=1))
    return (0.5 * y * voiced).astype(np.float32)


def _silence(seconds):
    return np.full(int(seconds * SR), np.nan)


def _hold(midi, seconds):
    return np.full(int(seconds * SR), float(midi))


def _slide(a, b, seconds):
    return np.linspace(a, b, int(seconds * SR))


def test_a_slide_down_to_a_held_note_reads_the_held_note():
    # "Sing ah and slide down until it feels heavy; hold the last easy note": E4 down to A3, held three seconds.
    take = _voice(np.concatenate([_silence(0.3), _slide(64, 57, 1.5), _hold(57, 3.0), _silence(0.3)]), vibrato_cents=40)
    reading = voice_range.read_range(take, SR)
    assert [h.midi for h in reading.holds] == [57]
    assert reading.lowest.midi == 57 and reading.highest.midi == 57
    assert reading.lowest.seconds >= 2.5
    assert abs(reading.lowest.cents) < 20


def test_the_lowest_and_highest_holds_are_the_ends_of_the_range():
    # Low G3 held, a breath, then high D5 held: a whole range in one take.
    take = _voice(np.concatenate([_hold(55, 2.0), _silence(0.4), _slide(60, 74, 1.0), _hold(74, 2.0)]), vibrato_cents=30)
    reading = voice_range.read_range(take, SR)
    assert (reading.lowest.midi, reading.highest.midi) == (55, 74)


def test_a_slide_alone_and_a_note_held_too_briefly_are_not_holds():
    take = _voice(np.concatenate([_slide(72, 55, 2.0), _silence(0.3), _hold(60, 0.6), _silence(0.5)]))
    reading = voice_range.read_range(take, SR)
    assert reading.holds == [] and reading.lowest is None and reading.highest is None


def test_a_wide_vibrato_is_still_one_held_note():
    reading = voice_range.read_range(_voice(_hold(65, 3.0), vibrato_cents=60), SR)
    assert [h.midi for h in reading.holds] == [65]


def test_a_flat_hold_is_read_as_the_nearest_note_with_its_cents():
    reading = voice_range.read_range(_voice(_hold(61.7, 2.0)), SR)  # 30 cents flat of D4
    assert reading.lowest.midi == 62
    assert -40 <= reading.lowest.cents <= -20


def test_silence_holds_nothing():
    reading = voice_range.read_range(np.zeros(SR * 3, dtype=np.float32), SR)
    assert reading.holds == [] and reading.lowest is None


def test_holds_are_found_on_a_contour_directly():
    hop = vocal.HOP / vocal.SAMPLE_RATE
    times = np.arange(200) * hop
    midi = np.concatenate([np.full(60, 57.0), np.full(20, np.nan), np.linspace(57, 70, 30), np.full(90, 70.2)])
    contour = vocal.Contour(times=times, midi=midi, voiced_prob=np.ones(200), rms=np.ones(200), rms_fast=np.ones(200))
    holds = voice_range.holds_in(contour)
    assert [h.midi for h in holds] == [57, 70]


def test_the_range_route_round_trips():
    from app.main import app

    buf = BytesIO()
    sf.write(buf, _voice(np.concatenate([_hold(57, 2.0), _silence(0.3)])), SR, format="WAV")
    with TestClient(app) as client:
        r = client.post("/v1/range", files={"audio": ("take.wav", BytesIO(buf.getvalue()), "audio/wav")})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["lowest"]["midi"] == 57 and body["highest"]["midi"] == 57
        assert {"holds", "secondsHeard"} <= set(body)
        assert {"midi", "pitch", "cents", "startSec", "seconds"} == set(body["lowest"])

        empty = client.post("/v1/range", files={"audio": ("take.wav", BytesIO(b""), "audio/wav")})
        assert empty.status_code == 422
        wrong = client.post("/v1/range", files={"audio": ("take.txt", BytesIO(b"abc"), "text/plain")})
        assert wrong.status_code == 415
        assert json.loads(wrong.text)["detail"].startswith("Unsupported")
