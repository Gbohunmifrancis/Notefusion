"""Instruments recorded in the browser come back as their tune, not as one or two notes.

The founder's report: a recording with instruments in it, made in the web app, "just returned
2 notes". The web app sends a take recorded there as ``mode=melody`` and, when the person picked
"Voice with instruments" (or the mobile app's "A song with instruments"), ``separate=true``. With
the separation model in place (``NF_MDX_MODEL_PATH``) the instruments' vocal stem was empty, or
held only a burst the model took for a voice, and that stem was the sheet. Without the model
these run the mixture, which is what the fix falls back to; with it they run the whole road.

Each clip is synthesised (a decaying piano tone with a hammer, a Karplus-Strong guitar, a tune
over piano chords), given a little room and noise, and encoded as MediaRecorder sends it
(Opus in a streamed WebM, no length in the header), then submitted through the worker's route.
"""

import difflib
import shutil
import subprocess
import time
from io import BytesIO

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.main import app

FFMPEG = shutil.which("ffmpeg")
pytestmark = pytest.mark.skipif(FFMPEG is None, reason="ffmpeg is not installed")

SR = 22_050
TWINKLE = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60]
MARY = [64, 62, 60, 62, 64, 64, 64, 62, 62, 62, 64, 67, 67, 64, 62, 60]
CHORD_UNDER = {60: (48, 52, 55), 67: (43, 47, 50), 69: (53, 57, 60), 65: (53, 57, 60), 64: (48, 52, 55),
               62: (43, 47, 50)}


def _hz(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


def _piano(m: int, n: int, rng) -> np.ndarray:
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in range(1, 9):
        fk = _hz(m) * k * np.sqrt(1 + 0.0004 * k * k)  # a string's inharmonicity
        if fk > SR / 2.2:
            break
        out += 0.6 ** (k - 1) * np.exp(-(1.2 + 0.4 * k) * t) * np.sin(2 * np.pi * fk * t + rng.uniform(0, 6))
    hammer = rng.normal(0, 1, n) * np.exp(-t * 300) * 0.3
    return (out + hammer) * np.minimum(1.0, t / 0.003)


def _guitar(m: int, n: int, rng) -> np.ndarray:
    """Karplus-Strong: a noise burst through a damped delay line one period long."""
    period = int(round(SR / _hz(m)))
    out = np.empty(n)
    buf = rng.uniform(-1, 1, period)
    for start in range(0, n, period):
        chunk = buf[: min(period, n - start)]
        out[start:start + chunk.size] = chunk
        buf = 0.996 * 0.5 * (buf + np.roll(buf, -1))
    return out


def _recording(voice, tune, chords: bool = False, beat: float = 0.5, seed: int = 0):
    rng = np.random.default_rng(seed)
    lead_in = 0.6
    total = int((lead_in + beat * len(tune) + 2.0) * SR)
    y = np.zeros(total)
    for i, m in enumerate(tune):
        start = int((lead_in + i * beat) * SR)
        ring = min(int(3 * beat * SR), total - start)
        y[start:start + ring] += 0.5 * voice(m, ring, rng)
        if chords and i % 2 == 0:
            for c in CHORD_UNDER[m]:
                y[start:start + ring] += 0.2 * voice(c, ring, rng)
    room = rng.normal(0, 1, int(0.25 * SR)) * np.exp(-np.arange(int(0.25 * SR)) / (0.06 * SR)) * 0.08
    y = y + np.convolve(y, room)[:total]
    y = y / np.max(np.abs(y)) + rng.normal(0, 0.003, total)
    return (0.7 * y / np.max(np.abs(y))).astype(np.float32)


def _as_mediarecorder_webm(y: np.ndarray) -> bytes:
    """48 kHz Opus at a browser's bit rate, muxed to a pipe as MediaRecorder streams it."""
    wav = BytesIO()
    sf.write(wav, y, SR, format="WAV")
    done = subprocess.run(
        [FFMPEG, "-v", "error", "-nostdin", "-f", "wav", "-i", "pipe:0", "-ar", "48000", "-ac", "1",
         "-c:a", "libopus", "-b:a", "64k", "-f", "webm", "pipe:1"],
        input=wav.getvalue(), capture_output=True, check=True, timeout=60)
    return done.stdout


def _transcribe_as_the_web_app_does(client: TestClient, data: bytes, separate: bool) -> list[int]:
    r = client.post("/v1/transcribe", files={"audio": ("recording.webm", BytesIO(data), "audio/webm")},
                    data={"mode": "melody", "separate": str(separate).lower(), "audio_preview": "false"})
    assert r.status_code == 202, r.text
    job_id = r.json().get("job_id") or r.json()["jobId"]
    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        body = client.get(f"/v1/jobs/{job_id}").json()
        if body["status"] in ("done", "failed"):
            break
        time.sleep(0.2)
    assert body["status"] == "done", body
    return [n.get("pitch_midi", n.get("pitchMidi")) for n in body["result"]["notes"]]


def _in_order(got: list[int], want: list[int]) -> int:
    """Reference notes found, in order and at the right pitch."""
    blocks = difflib.SequenceMatcher(None, got, want, autojunk=False).get_matching_blocks()
    return sum(b.size for b in blocks)


@pytest.mark.parametrize("separate", [False, True], ids=["a-take-as-recorded", "voice-with-instruments"])
@pytest.mark.parametrize("name, voice, tune, chords", [
    ("piano", _piano, TWINKLE, False),
    ("guitar", _guitar, MARY, False),
    ("piano-with-chords", _piano, TWINKLE, True),
])
def test_an_instrument_recorded_in_the_browser_comes_back_as_its_tune(name, voice, tune, chords, separate):
    data = _as_mediarecorder_webm(_recording(voice, tune, chords=chords, seed=len(name)))
    with TestClient(app) as client:
        pitches = _transcribe_as_the_web_app_does(client, data, separate)
    assert len(pitches) >= 0.7 * len(tune), pitches
    assert len(pitches) <= 1.5 * len(tune), pitches
    assert _in_order(pitches, tune) >= 0.7 * len(tune), pitches


def test_a_short_sung_clip_still_takes_the_voice_engine(monkeypatch):
    """The fix sits in the queue's separation road; a hum recorded in the browser still
    goes to ``app.pipeline.vocal`` and comes back with its notes."""
    from app.pipeline import transcriber
    from tests.accuracy import vocal_synth
    from tests.accuracy.vocal_corpus import STYLES

    engine_notes = []
    real = transcriber._segment_vocal

    def counted(*args, **kwargs):
        out = real(*args, **kwargs)
        engine_notes.append(len(out[0]))
        return out

    monkeypatch.setattr(transcriber, "_segment_vocal", counted)
    tune = [(60, 1.0), (62, 1.0), (64, 1.0), (65, 1.0), (67, 2.0), (65, 1.0), (64, 1.0), (62, 1.0), (60, 2.0)]
    y, _ = vocal_synth.render(tune, 96, STYLES["hum_clean"], sr=SR)
    data = _as_mediarecorder_webm((0.7 * y / np.max(np.abs(y))).astype(np.float32))
    with TestClient(app) as client:
        pitches = _transcribe_as_the_web_app_does(client, data, separate=False)
    assert engine_notes and engine_notes[0] > 0
    want = [m for m, _ in tune]
    assert _in_order(pitches, want) >= len(want) - 1, pitches
