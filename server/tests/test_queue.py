"""Unit tests for the in-process job queue (no heavy inference).

The queue is deliberately tested with the real ThreadPoolExecutor so we exercise
the worker boundary: status transitions, error surfacing, and the privacy
guarantee that the audio file is deleted once the job ends (TRD par. 9).
"""

import tempfile
import time
from pathlib import Path

import pytest

from app.jobs.queue import (STATUS_DONE, STATUS_FAILED, JobQueue)
from app.pipeline.transcriber import LowConfidenceError, TranscriptionResult


def _result() -> TranscriptionResult:
    return TranscriptionResult(
        key="C", key_confidence=1.0, tempo=120, time_signature="4/4",
        musicxml="<score/>", midi_base64="bWk=", notes=[],
        solfa_lines=[], overall_confidence=1.0)


def _temp_audio() -> Path:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(b"RIFF")
        return Path(tmp.name)


def _await_status(queue: JobQueue, jid: str, target: str, timeout: float = 5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = queue.get(jid)
        if job and job.status == target:
            return job
        time.sleep(0.02)
    job = queue.get(jid)
    raise AssertionError(f"job {jid} stuck at {job and job.status!r}, wanted {target}")


def _await_deleted(path: Path, timeout: float = 2.0) -> None:
    # The worker flips job status to terminal just before the finally-block unlink,
    # so cleanup is observable a beat after the status change. Poll, don't race.
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not path.exists():
            return
        time.sleep(0.02)
    raise AssertionError(f"{path} was not deleted (privacy guarantee, TRD par. 9)")


def test_submit_returns_unique_id():
    queue = JobQueue(workers=1)
    try:
        # Job ids must be unique even when submitted back-to-back; the worker never
        # runs because the path is never read before we assert.
        path = _temp_audio()
        jid1 = queue.submit(path, mode="melody", key=None, tempo=None)
        jid2 = queue.submit(path, mode="melody", key=None, tempo=None)
        assert jid1 and jid2 and jid1 != jid2
    finally:
        queue.shutdown(wait=True)


def test_job_transitions_to_done(monkeypatch):
    monkeypatch.setattr("app.jobs.queue.transcribe",
                        lambda *a, **k: _result())
    queue = JobQueue(workers=1)
    try:
        audio = _temp_audio()
        jid = queue.submit(audio, mode="melody", key=None, tempo=120)
        job = _await_status(queue, jid, STATUS_DONE)
        assert job.result is not None
        assert job.progress == 1.0
        # Privacy: the worker deletes the recording once the job ends (TRD par. 9).
        _await_deleted(audio)
    finally:
        queue.shutdown(wait=True)


def test_failed_job_surfaces_generic_error(monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr("app.jobs.queue.transcribe", _boom)
    queue = JobQueue(workers=1)
    try:
        audio = _temp_audio()
        jid = queue.submit(audio, mode="melody", key=None, tempo=None)
        job = _await_status(queue, jid, STATUS_FAILED)
        assert "boom" in job.error
        _await_deleted(audio)  # still cleaned up on failure
    finally:
        queue.shutdown(wait=True)


def test_low_confidence_error_is_surfaced_verbatim(monkeypatch):
    def _low(*a, **k):
        raise LowConfidenceError("No confident notes detected in the recording.")

    monkeypatch.setattr("app.jobs.queue.transcribe", _low)
    queue = JobQueue(workers=1)
    try:
        audio = _temp_audio()
        jid = queue.submit(audio, mode="melody", key=None, tempo=None)
        job = _await_status(queue, jid, STATUS_FAILED)
        # LowConfidence is an expected, honest outcome - surfaced without the
        # "Transcription failed:" wrapper the generic branch adds.
        assert job.error == "No confident notes detected in the recording."
    finally:
        queue.shutdown(wait=True)


def test_get_unknown_job_returns_none():
    queue = JobQueue(workers=1)
    try:
        assert queue.get("does-not-exist") is None
    finally:
        queue.shutdown(wait=True)


def test_expired_jobs_are_purged(monkeypatch):
    monkeypatch.setattr("app.jobs.queue.transcribe", lambda *a, **k: _result())
    # Force an immediate TTL so the finished job is purged on the next access.
    monkeypatch.setattr("app.jobs.queue.settings.job_ttl_seconds", 0.0)
    queue = JobQueue(workers=1)
    try:
        audio = _temp_audio()
        jid = queue.submit(audio, mode="melody", key=None, tempo=None)
        _await_status(queue, jid, STATUS_DONE)
        time.sleep(0.05)
        # A subsequent get() runs _purge_expired first, evicting the done job.
        assert queue.get(jid) is None
    finally:
        queue.shutdown(wait=True)
