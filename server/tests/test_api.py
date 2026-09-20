"""HTTP-level tests for the v1 endpoints using FastAPI's TestClient."""

import tempfile
import time
from io import BytesIO
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from app.api.schemas import SubmitResponse
from app.jobs.queue import STATUS_DONE, STATUS_FAILED, STATUS_PENDING, JobQueue
from app.main import app
from fastapi.testclient import TestClient


def _make_wav(duration_sec: float = 0.5, sr: int = 22050) -> bytes:
    """Generate a simple sine-wave WAV in memory."""
    t = np.linspace(0, duration_sec, int(sr * duration_sec), endpoint=False)
    audio = 0.5 * np.sin(2 * np.pi * 440 * t)
    buffer = BytesIO()
    sf.write(buffer, audio, sr, format="WAV")
    return buffer.getvalue()


def _wait_for_status(
    client: TestClient, job_id: str, target: str, timeout: float = 5.0
) -> dict:
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
        # Default: a clip that was refined must not carry a warning flag.
        assert body["result"]["pitchRefined"] is True
        assert body["result"]["chromaticSpelling"] == "direction"


def test_a_skipped_refinement_reaches_the_wire(monkeypatch):
    """``pitchRefined`` is the client's only signal that a long clip was degraded.

    Worth its own contract test rather than trusting the DTO, because it is a negative
    boolean that defaults to True: both plausible wiring mistakes — dropping it from
    ``ResultDto`` and mis-aliasing the camelCase key — fail *silently*, as "this clip
    was fine".  The flag exists precisely for the clips that are not.
    """
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
            pitch_refined=False,
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
        assert body["result"]["pitchRefined"] is False
        # snake_case must NOT also be present — the C# and mobile DTOs bind the alias,
        # and a model emitting both would let a typo in either tier pass unnoticed.
        assert "pitch_refined" not in body["result"]


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


def test_preview_override_rejects_clip_over_preview_cap(monkeypatch):
    monkeypatch.setattr("app.api.routes._clip_duration_seconds", lambda _p: 12.0)

    with TestClient(app) as client:
        data = _make_wav(duration_sec=0.1)
        r = client.post(
            "/v1/transcribe",
            files={"audio": ("preview.wav", BytesIO(data), "audio/wav")},
            data={"mode": "melody", "preview_max_clip_seconds": "10"},
        )
        assert r.status_code == 413
        assert "10" in r.json()["detail"]


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


def test_submit_rejects_genuinely_unparseable_keys():
    """Keys that are not valid note names must return 422.

    Note: pure-whitespace ("   ") is now sanitised to None by the route layer
    (same as "Auto"/"null"), so it is NOT in this list — a blank key simply
    means "no override" rather than an error.
    """
    with TestClient(app) as client:
        data = _make_wav(duration_sec=0.1)
        for bad in ("H", "Cx", "123", "m", "#", "Zb"):
            r = client.post(
                "/v1/transcribe",
                files={"audio": ("clip.wav", BytesIO(data), "audio/wav")},
                data={"mode": "melody", "key": bad},
            )
            assert r.status_code == 422, f"key={bad!r} should be rejected"
            assert "key" in r.json()["detail"].lower()


def test_submit_accepts_sanitisable_key_values():
    """Values that the route sanitises to None (no override) must return 202."""
    with TestClient(app) as client:
        data = _make_wav(duration_sec=0.5)
        for neutral in ("Auto", "auto", "AUTO", "null", "none", "   "):
            r = client.post(
                "/v1/transcribe",
                files={"audio": ("clip.wav", BytesIO(data), "audio/wav")},
                data={"mode": "melody", "key": neutral},
            )
            assert r.status_code == 202, (
                f"key={neutral!r} should be accepted (sanitised to no override)"
            )


def test_submit_accepts_music21_dash_flat_key():
    """music21 flat notation ("B- major") must be accepted and forwarded to the queue."""
    with TestClient(app) as client:
        data = _make_wav(duration_sec=0.5)
        for valid in ("B- major", "E- minor", "A- major", "b-", "e-"):
            r = client.post(
                "/v1/transcribe",
                files={"audio": ("clip.wav", BytesIO(data), "audio/wav")},
                data={"mode": "melody", "key": valid},
            )
            assert r.status_code == 202, (
                f"key={valid!r} should be accepted (music21 dash-flat)"
            )


def test_failed_job_exposes_error_field(monkeypatch):
    """When a job fails the JSON response must include an 'error' field with the
    worker's reason — not null. Previously the C# JobResponse record was missing
    the error field so Python error messages were silently dropped."""
    from app.jobs import queue as queue_mod
    from app.pipeline.transcriber import LowConfidenceError

    def _low_conf(*a, **k):
        raise LowConfidenceError("No confident notes detected in the recording.")

    monkeypatch.setattr(queue_mod, "transcribe", _low_conf)

    with TestClient(app) as client:
        data = _make_wav(duration_sec=0.5)
        r = client.post(
            "/v1/transcribe",
            files={"audio": ("clip.wav", BytesIO(data), "audio/wav")},
            data={"mode": "melody"},
        )
        assert r.status_code == 202
        job_id = r.json()["jobId"]
        body = _wait_for_status(client, job_id, STATUS_FAILED)
        assert body.get("error"), "error field must be non-empty on a failed job"
        assert "confident" in body["error"].lower()


def test_submit_rejects_unsupported_format():
    with TestClient(app) as client:
        r = client.post(
            "/v1/transcribe",
            files={"audio": ("clip.txt", BytesIO(b"not audio"), "text/plain")},
        )
        assert r.status_code == 415


def test_correlation_id_header_is_carried_onto_the_job(monkeypatch):
    """The C# API's X-Correlation-ID must reach the job, and only if it is safe to log.

    This is the whole point of the header: the job's log lines are the only record of
    what inference did, and without the id there is nothing joining them to the API
    request — or to the user who reported the failure.
    """
    from app.jobs import queue as queue_mod

    monkeypatch.setattr(queue_mod, "transcribe", lambda *a, **k: None)

    with TestClient(app) as client:
        def _submit(headers: dict) -> str:
            r = client.post(
                "/v1/transcribe",
                files={"audio": ("clip.wav", BytesIO(_make_wav(0.5)), "audio/wav")},
                data={"mode": "melody"},
                headers=headers,
            )
            assert r.status_code == 202
            return r.json()["jobId"]

        good = _submit({"X-Correlation-ID": "9f2c4b1e-trace_7"})
        assert app.state.queue.get(good).correlation_id == "9f2c4b1e-trace_7"

        # Refused, not sanitised: a value that has been quietly edited no longer matches
        # the one the API wrote down, and these two would forge a log entry or pad the file.
        for forged in ("id with spaces; and punctuation", "a" * 65):
            assert app.state.queue.get(_submit({"X-Correlation-ID": forged})).correlation_id is None

        # No header at all is normal — anything calling the worker directly, and the API
        # itself when the call originates outside a request.
        assert app.state.queue.get(_submit({})).correlation_id is None


def test_submit_accepts_valid_time_signatures():
    with TestClient(app) as client:
        data = _make_wav(duration_sec=0.5)
        for valid_ts in ("4/4", "3/4", "6/8", "2/4", "12/8"):
            r = client.post(
                "/v1/transcribe",
                files={"audio": ("clip.wav", BytesIO(data), "audio/wav")},
                data={"mode": "melody", "time_signature": valid_ts},
            )
            assert r.status_code == 202, f"time_signature={valid_ts!r} should be accepted"


def test_submit_rejects_invalid_time_signatures():
    with TestClient(app) as client:
        data = _make_wav(duration_sec=0.1)
        for bad_ts in ("invalid", "4", "4/4/4", "3/a", "xyz"):
            r = client.post(
                "/v1/transcribe",
                files={"audio": ("clip.wav", BytesIO(data), "audio/wav")},
                data={"mode": "melody", "time_signature": bad_ts},
            )
            assert r.status_code == 422, f"time_signature={bad_ts!r} should be rejected"
            assert "time signature" in r.json()["detail"].lower()
