"""Hum to find a hymn (``POST /v1/identify``): a hummed clip is decoded by the melody engine alone,
cut to its cap whatever its header says, and named only when ``hymn_match`` is sure; the audio
never outlives the request.

The takes are rendered by the accuracy harness's voice (``tests.accuracy.vocal_synth``): glides,
vibrato, a detuned singer and breath noise, the defects a phone's hum has.
"""

import shutil
import subprocess
import tempfile
import threading
from io import BytesIO
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.api import routes
from app.config import TEMP_PREFIX, settings
from app.main import app
from tests.accuracy import vocal_synth
from tests.accuracy.vocal_corpus import TUNES

SR = vocal_synth.SAMPLE_RATE
HUM = vocal_synth.VocalOptions(style="hum", tuning_cents=-23.0, jitter_cents=8.0, vibrato_cents=25.0)


@pytest.fixture(autouse=True)
def _no_warmup(monkeypatch):
    # The lifespan's warm-up writes a temporary clip of its own on a thread.
    monkeypatch.setattr(settings, "pipeline_warmup", False)


def _wav(seq, tempo, options=HUM) -> bytes:
    y, _ = vocal_synth.render(seq, tempo, options)
    buf = BytesIO()
    sf.write(buf, y.astype(np.float32), SR, format="WAV")
    return buf.getvalue()


def _post(client, data: bytes, name: str = "hum.wav", headers=None):
    return client.post("/v1/identify", files={"audio": (name, BytesIO(data), "application/octet-stream")}, headers=headers or {})


def _left_behind() -> set[str]:
    return {p.name for p in Path(tempfile.gettempdir()).glob(TEMP_PREFIX + "*")}


def test_a_hummed_hymn_is_named_with_its_page_and_first_line():
    _, tempo, seq = TUNES["amazing_grace"]
    before = _left_behind()
    with TestClient(app) as client:
        r = _post(client, _wav(seq, tempo))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tooShort"] is False and body["notesHeard"] >= 11
    m = body["match"]
    assert m["slug"] == "amazing-grace" and m["kind"] == "hymn"
    assert m["url"] == "https://notefusion.studio/hymns/amazing-grace"
    assert m["title"] == "Amazing Grace" and m["tune"]
    assert m["firstLine"].startswith("Amazing grace!")
    assert 0.0 < m["confidence"] <= 1.0
    assert _left_behind() <= before  # the upload and its WAV are gone


def test_a_man_singing_the_tune_in_another_key_is_named_too():
    _, tempo, seq = TUNES["greensleeves"]
    low = tuple((None if p is None else p - 10, d) for p, d in seq)
    sung = vocal_synth.VocalOptions(style="da", tuning_cents=31.0, note_detune_cents=12.0, vibrato_cents=30.0)
    with TestClient(app) as client:
        r = _post(client, _wav(low, tempo, sung))
    assert r.status_code == 200, r.text
    m = r.json()["match"]
    assert m and m["slug"] == "what-child-is-this"  # GREENSLEEVES


def test_a_tune_that_is_no_hymn_is_not_named():
    _, tempo, seq = TUNES["leaps_a"]
    with TestClient(app) as client:
        r = _post(client, _wav(tuple(seq) * 2, tempo))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tooShort"] is False
    assert body["match"] is None


def test_a_few_notes_are_too_short_to_name_and_say_so():
    _, tempo, seq = TUNES["amazing_grace"]
    with TestClient(app) as client:
        r = _post(client, _wav(seq[:5], tempo))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tooShort"] is True and body["match"] is None
    assert body["notesHeard"] <= 6


def test_silence_is_too_short_not_an_error():
    buf = BytesIO()
    sf.write(buf, np.zeros(SR * 3, dtype=np.float32), SR, format="WAV")
    with TestClient(app) as client:
        r = _post(client, buf.getvalue())
    assert r.status_code == 200, r.text
    assert r.json() == {"match": None, "notesHeard": 0, "tooShort": True, "secondsHeard": pytest.approx(3.0, abs=0.05)}


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg cuts the clip")
def test_the_clip_is_cut_to_its_cap_whatever_its_header_says(monkeypatch):
    # A browser's streamed WebM carries no length in its header; the cut is made all the same.
    monkeypatch.setattr(settings, "identify_max_seconds", 4.0)
    seen = []
    real = routes._identify_notes
    monkeypatch.setattr(routes, "_identify_notes", lambda notes, seconds: seen.append(seconds) or real(notes, seconds))
    _, tempo, seq = TUNES["amazing_grace"]
    with tempfile.TemporaryDirectory() as d:
        wav, webm = Path(d) / "a.wav", Path(d) / "a.webm"
        wav.write_bytes(_wav(seq, tempo))  # ~18 s
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-c:a", "libopus", "-f", "webm", str(webm)], check=True)
        data = webm.read_bytes()
    with TestClient(app) as client:
        r = _post(client, data, name="hum.webm")
    assert r.status_code == 200, r.text
    assert seen and seen[0] <= 4.05
    assert r.json()["secondsHeard"] <= 4.05


def test_refusals_are_plain(monkeypatch):
    with TestClient(app) as client:
        assert _post(client, b"RIFF....", name="hum.exe").status_code == 415
        assert _post(client, b"").status_code == 422
        bad = _post(client, b"this is not audio at all" * 100)
        assert bad.status_code == 422
        assert bad.json()["detail"] == "This recording could not be read. Record it again and resend it."
        monkeypatch.setattr(routes, "IDENTIFY_MAX_UPLOAD_BYTES", 1000)
        assert _post(client, b"\0" * 5000).status_code == 413


def test_a_busy_finder_turns_the_caller_away_rather_than_queue_behind_transcriptions(monkeypatch):
    slots = threading.BoundedSemaphore(1)
    slots.acquire()  # someone else's look-up holds the only slot
    monkeypatch.setattr(routes, "_identify_slots", slots)
    monkeypatch.setattr(settings, "identify_wait_seconds", 0.05)
    _, tempo, seq = TUNES["amazing_grace"]
    with TestClient(app) as client:
        r = _post(client, _wav(seq[:5], tempo))
        assert r.status_code == 503
        assert r.headers["retry-after"] == str(routes.IDENTIFY_BUSY_RETRY_SECONDS)
        assert "busy" in r.json()["detail"]
        slots.release()
        assert _post(client, _wav(seq[:5], tempo)).status_code == 200


def test_the_finder_needs_the_api_key(monkeypatch):
    monkeypatch.setenv("NF_API_KEY", "secret_test_key_123")
    _, tempo, seq = TUNES["amazing_grace"]
    data = _wav(seq[:5], tempo)
    with TestClient(app) as client:
        assert _post(client, data).status_code == 401
        assert _post(client, data, headers={"X-Api-Key": "wrong"}).status_code == 401
        assert _post(client, data, headers={"X-Api-Key": "secret_test_key_123"}).status_code == 200


def test_the_first_line_reads_as_words():
    assert routes._first_line("A-maz-ing_ grace! how sweet the sound, That saved a_ wretch like me!") == "Amazing grace! how sweet the sound"
    assert routes._first_line("My Fath-er is rich in hous-es and lands, He hold-eth") == "My Father is rich in houses and lands"
    assert routes._first_line("") is None
