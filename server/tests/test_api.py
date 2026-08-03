"""HTTP-level tests for the v1 endpoints using FastAPI's TestClient."""

import tempfile
import time
from io import BytesIO
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.api.schemas import SubmitResponse
from app.jobs.queue import STATUS_DONE, STATUS_PENDING, JobQueue
from app.main import app


def _make_wav(duration_sec: float = 0.5, sr: int = 22050) -> bytes:
    """Generate a simple sine-wave WAV in memory."""
    t = np.linspace(0, duration_sec, int(sr * duration_sec), endpoint=False)
    audio = 0.5 * np.sin(2 * np.pi * 440 * t)
    buffer = BytesIO()
    sf.write(buffer, audio, sr, format="WAV")
    return buffer.getvalue()


def _wait_for_status(client: TestClient, job_id: str,
                     target: str, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = client.get(f"/v1/jobs/{job_id}")
        assert r.status_code == 200
        body = r.json()
        if body["status"] == target:
            return body
        time.sleep(0.1)
    raise TimeoutError(f"Job {job_id} did not reach {target}")


def test_healthz():
    with TestClient(app) as client:
        r = client.get("/healthz")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


def test_submit_returns_202_and_polls_done(monkeypatch):
    # Patch away the heavy pipeline so this remains a contract/API test.
    from app.jobs import queue as queue_mod

    def fake_transcribe(audio_path, mode="melody", **kwargs):
        from app.pipeline.transcriber import TranscriptionResult
        return TranscriptionResult(
            key="C",
            key_confidence=1.0,
            tempo=120,
            time_signature="4/4",
            musicxml="<score/>",
            midi_base64="bWk=",
            notes=[],
            solfa_lines=["Doh is C", "| - |"],
            overall_confidence=1.0,
        )

    monkeypatch.setattr(queue_mod, "transcribe", fake_transcribe)

    with TestClient(app) as client:
        data = _make_wav(duration_sec=0.5)
        r = client.post(
            "/v1/transcribe",
            files={"audio": ("clip.wav", BytesIO(data), "audio/wav")},
            data={"mode": "melody"},
        )
        assert r.status_code == 202
        submit = SubmitResponse.model_validate(r.json())
        body = _wait_for_status(client, submit.job_id, STATUS_DONE)
        assert body["result"] is not None
        assert body["result"]["musicxml"]
        assert isinstance(body["result"]["notes"], list)


def test_submit_rejects_empty_file():
    with TestClient(app) as client:
        r = client.post(
            "/v1/transcribe",
            files={"audio": ("empty.wav", BytesIO(b""), "audio/wav")},
        )
        assert r.status_code == 422


def test_submit_rejects_long_clip(monkeypatch):
    # Pretend every file is 10 minutes long so we don't actually process it.
    monkeypatch.setattr("app.api.routes.settings.max_clip_seconds", 60.0)
    monkeypatch.setattr("app.api.routes._clip_duration_seconds", lambda _p: 600.0)

    with TestClient(app) as client:
        data = _make_wav(duration_sec=0.1)
        r = client.post(
            "/v1/transcribe",
            files={"audio": ("long.wav", BytesIO(data), "audio/wav")},
        )
        assert r.status_code == 413


def test_get_unknown_job_returns_404():
    with TestClient(app) as client:
        r = client.get("/v1/jobs/nosuchid")
        assert r.status_code == 404


def test_submit_rejects_bad_mode():
    with TestClient(app) as client:
        data = _make_wav(duration_sec=0.1)
        r = client.post(
            "/v1/transcribe",
            files={"audio": ("clip.wav", BytesIO(data), "audio/wav")},
            data={"mode": "invalid"},
        )
        assert r.status_code == 422


def test_submit_accepts_optional_key_and_tempo():
    with TestClient(app) as client:
        data = _make_wav(duration_sec=0.5)
        r = client.post(
            "/v1/transcribe",
            files={"audio": ("clip.wav", BytesIO(data), "audio/wav")},
            data={"mode": "melody", "key": "F", "tempo": "88"},
        )
        assert r.status_code == 202


def test_submit_rejects_out_of_range_tempo():
    with TestClient(app) as client:
        data = _make_wav(duration_sec=0.1)
        for bad in ("10", "500", "0"):
            r = client.post(
                "/v1/transcribe",
                files={"audio": ("clip.wav", BytesIO(data), "audio/wav")},
                data={"mode": "melody", "tempo": bad},
            )
            assert r.status_code == 422, f"tempo={bad} should be rejected"


def test_submit_rejects_unparseable_key_synchronously():
    with TestClient(app) as client:
        data = _make_wav(duration_sec=0.1)
        for bad in ("H", "Cx", "123", "   ", "m"):
            r = client.post(
                "/v1/transcribe",
                files={"audio": ("clip.wav", BytesIO(data), "audio/wav")},
                data={"mode": "melody", "key": bad},
            )
            assert r.status_code == 422, f"key={bad!r} should be rejected"
            assert "key" in r.json()["detail"].lower()


def test_submit_rejects_unsupported_format():
    with TestClient(app) as client:
        r = client.post(
            "/v1/transcribe",
            files={"audio": ("clip.txt", BytesIO(b"not audio"), "text/plain")},
        )
        assert r.status_code == 415
