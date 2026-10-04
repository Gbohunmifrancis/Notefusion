"""Unit tests for the in-process job queue (no heavy inference).

The queue is deliberately tested with the real ThreadPoolExecutor so we exercise
the worker boundary: status transitions, error surfacing, and the privacy
guarantee that the audio file is deleted once the job ends (TRD par. 9).
"""

import tempfile
import threading
import time
from pathlib import Path

import pytest

from app.jobs.queue import (PRIORITY_HIGH, STAGE_QUEUED, STAGE_TRANSCRIBING, STATUS_DONE, STATUS_FAILED,
                            STATUS_PROCESSING, JobQueue)
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


def _await_record(caplog, needle: str, timeout: float = 2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for record in caplog.records:
            if needle in record.getMessage():
                return record
        time.sleep(0.02)
    raise AssertionError(f"no log record containing {needle!r}; "
                         f"saw {[r.getMessage() for r in caplog.records]}")


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
        # The exception text stays in the log; the client gets a generic message.
        assert "boom" not in job.error
        assert "unexpected error" in job.error.lower()
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


def test_terminal_log_lines_carry_the_job_and_correlation_ids(monkeypatch, caplog):
    """A failure has to be findable, which means the traceback and both ids in the log.

    These lines used to be bare `print` calls, so the only record of a crashed job was
    its exception type with no stack and nothing tying it to the request that caused it.
    """
    def _boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr("app.jobs.queue.transcribe", _boom)
    queue = JobQueue(workers=1)
    try:
        with caplog.at_level("INFO", logger="app.jobs.queue"):
            jid = queue.submit(_temp_audio(), mode="melody", key=None, tempo=None,
                               correlation_id="req-42")
            _await_status(queue, jid, STATUS_FAILED)
            # The status flips just before the log call, so the record lands a beat
            # later on a pool thread. Poll for it inside at_level, not after.
            failure = _await_record(caplog, "EXCEPTION")

        text = failure.getMessage()
        assert jid[:8] in text
        assert "correlationId=req-42" in text
        assert failure.exc_info is not None, "logger.exception, so the traceback is kept"
    finally:
        queue.shutdown(wait=True)


def test_expired_jobs_are_purged(monkeypatch):
    monkeypatch.setattr("app.jobs.queue.transcribe", lambda *a, **k: _result())
    queue = JobQueue(workers=1)
    try:
        audio = _temp_audio()
        jid = queue.submit(audio, mode="melody", key=None, tempo=None)
        # Let the job finish under the normal TTL first: with a 0.0 TTL from the
        # start, the purge-on-get() inside _await_status would race the worker and
        # could evict the job before we ever observe "done" (flaky on slow CI).
        _await_status(queue, jid, STATUS_DONE)
        # Now expire the job unconditionally. A negative TTL is deliberate: the purge
        # test is `now - finished_at > ttl`, and with ttl == 0.0 a coarse monotonic
        # clock (Windows resolution is ~15 ms) can read the same tick as finished_at,
        # making the delta exactly 0.0 — not > 0.0 — so the job survives. A negative
        # TTL means "already expired" and purges deterministically on the next get().
        monkeypatch.setattr("app.jobs.queue.settings.job_ttl_seconds", -1.0)
        assert queue.get(jid) is None
    finally:
        queue.shutdown(wait=True)


def test_pro_lane_runs_while_the_general_worker_is_busy(monkeypatch):
    """The Pro lane's promise: a high-priority job starts at once even when the only
    general worker is in the middle of a long normal job. Before the lane had its own
    worker the high job sorted to the front of the queue and then waited for the running
    job anyway, which for a linked song in vocal separation was minutes."""
    import threading
    release = threading.Event()

    def slow_or_quick(audio_path, **kwargs):
        if "slow" in audio_path.name:
            release.wait(5.0)
        return _result()

    monkeypatch.setattr("app.jobs.queue.transcribe", slow_or_quick)
    queue = JobQueue(workers=1, pro_lane_workers=1)
    try:
        with tempfile.NamedTemporaryFile(suffix="-slow.wav", delete=False) as tmp:
            tmp.write(b"RIFF")
            slow = Path(tmp.name)
        slow_id = queue.submit(slow, mode="melody", key=None, tempo=120)
        _await_status(queue, slow_id, STATUS_PROCESSING)

        # A normal job queued behind the slow one must still wait: the lane is for Pro.
        waiting_id = queue.submit(_temp_audio(), mode="melody", key=None, tempo=120)
        pro_id = queue.submit(_temp_audio(), mode="melody", key=None, tempo=120, priority=PRIORITY_HIGH)
        _await_status(queue, pro_id, STATUS_DONE)
        assert queue.get(waiting_id).status != STATUS_DONE
        assert queue.get(slow_id).status == STATUS_PROCESSING

        release.set()
        _await_status(queue, slow_id, STATUS_DONE)
        _await_status(queue, waiting_id, STATUS_DONE)
    finally:
        release.set()
        queue.shutdown(wait=True, timeout=5.0)


def test_backing_is_encoded_as_mp3_when_ffmpeg_is_present(tmp_path):
    """The instrumental goes to the client as a small mono MP3; without ffmpeg it is simply
    absent (an empty string), never an error."""
    import shutil
    import base64

    import numpy as np
    import soundfile as sf

    from app.jobs.queue import _encode_backing

    wav = tmp_path / "backing.wav"
    t = np.arange(22_050) / 22_050
    sf.write(str(wav), (0.3 * np.sin(2 * np.pi * 110 * t)).astype(np.float32), 22_050)
    encoded = _encode_backing(wav)
    if shutil.which("ffmpeg"):
        raw = base64.b64decode(encoded)
        assert raw[:3] == b"ID3" or raw[0] == 0xFF, "not an MP3 stream"
        assert len(raw) < wav.stat().st_size / 4
    else:
        assert encoded == ""
    assert _encode_backing(tmp_path / "missing.wav") == ""


def _fake_separation(monkeypatch, peaks: float, voice_db: float) -> list:
    """Stand-ins for the MDX model: a band check that reads ``peaks`` and a separation
    whose vocal stem holds ``voice_db`` of the mix.  Returns the transcribe() calls."""
    import numpy as np
    import soundfile as sf

    from app.pipeline import separate

    calls = []

    def fake_separate_file(wav, out, progress=lambda f: None, backing_path=None):
        t = np.arange(22_050) / 22_050
        tone = np.sin(2 * np.pi * 220 * t).astype(np.float32)
        sf.write(str(out), tone * 10.0 ** (voice_db / 20.0), 22_050)
        sf.write(str(backing_path), tone, 22_050)
        return out

    monkeypatch.setattr(separate, "available", lambda: True)
    monkeypatch.setattr(separate, "accompaniment", lambda path: peaks)
    monkeypatch.setattr(separate, "separate_file", fake_separate_file)
    monkeypatch.setattr("app.jobs.queue._encode_backing", lambda path: "")
    monkeypatch.setattr("app.jobs.queue.transcribe",
                        lambda path, **kw: calls.append((Path(path).name, kw.get("tempo_source"))) or _result())
    return calls


@pytest.mark.parametrize("peaks, isolated", [(7.5, True), (2.0, False)])
def test_a_melody_upload_with_a_band_is_isolated_without_being_asked(monkeypatch, peaks, isolated):
    """separate=false, but the accompaniment check hears a band: the vocal is isolated and
    the beat read from the mix, exactly as for separate=true.  A solo voice is left alone."""
    calls = _fake_separation(monkeypatch, peaks=peaks, voice_db=-3.0)
    queue = JobQueue(workers=1)
    try:
        audio = _temp_audio()
        job = _await_status(queue, queue.submit(audio, mode="melody", key=None, tempo=None), STATUS_DONE)
        if isolated:
            assert calls == [("vocals.wav", audio)]
            assert job.result.separated is True
        else:
            assert calls == [(audio.name, None)]
            assert job.result.separated is False
    finally:
        queue.shutdown(wait=True)


def test_only_melody_mode_is_isolated_on_its_own(monkeypatch):
    calls = _fake_separation(monkeypatch, peaks=9.0, voice_db=-3.0)
    queue = JobQueue(workers=1)
    try:
        audio = _temp_audio()
        _await_status(queue, queue.submit(audio, mode="poly", key=None, tempo=None), STATUS_DONE)
        assert calls == [(audio.name, None)]
    finally:
        queue.shutdown(wait=True)


def test_a_band_with_no_voice_in_it_is_transcribed_as_the_mixture(monkeypatch):
    """An instrumental upload reads as accompanied too, but its vocal stem comes back empty;
    the tune is then in the mixture, so that is what gets transcribed."""
    calls = _fake_separation(monkeypatch, peaks=7.5, voice_db=-40.0)
    queue = JobQueue(workers=1)
    try:
        audio = _temp_audio()
        job = _await_status(queue, queue.submit(audio, mode="melody", key=None, tempo=None), STATUS_DONE)
        assert calls == [(audio.name, None)]
        assert job.result.separated is False
    finally:
        queue.shutdown(wait=True)


def test_an_explicit_song_upload_keeps_its_stem_however_quiet(monkeypatch):
    """separate=true is the user's call: the voice check only guards the automatic path."""
    calls = _fake_separation(monkeypatch, peaks=0.0, voice_db=-40.0)
    queue = JobQueue(workers=1)
    try:
        audio = _temp_audio()
        job = _await_status(queue, queue.submit(audio, mode="melody", key=None, tempo=None, separate=True),
                            STATUS_DONE)
        assert calls == [("vocals.wav", audio)]
        assert job.result.separated is True
    finally:
        queue.shutdown(wait=True)


def test_the_accompaniment_check_tells_a_band_from_a_voice(tmp_path):
    """The real check on two synthetic clips: a hummed line (one harmonic series) and the
    same line over a bass and a sustained triad."""
    import numpy as np
    import soundfile as sf

    from app.pipeline import separate

    sr = 22_050
    t = np.arange(int(4.0 * sr)) / sr

    def tone(f0, n: int = 8) -> np.ndarray:
        phase = 2 * np.pi * np.cumsum(np.broadcast_to(f0, t.shape)) / sr
        return sum(np.sin(k * phase) / k for k in range(1, n + 1))

    voice = tone(261.6 * (1 + 0.004 * np.sin(2 * np.pi * 5.5 * t)))
    band = voice + 0.8 * tone(65.4) + 0.5 * (tone(196.0) + tone(246.9) + tone(293.7))
    sf.write(tmp_path / "voice.wav", 0.2 * voice / np.max(np.abs(voice)), sr)
    sf.write(tmp_path / "band.wav", 0.2 * band / np.max(np.abs(band)), sr)
    assert not separate.has_accompaniment(tmp_path / "voice.wav")
    assert separate.has_accompaniment(tmp_path / "band.wav")


def test_a_waiting_job_says_so_and_knows_its_place_in_line(monkeypatch):
    """One worker, three jobs: the first runs, the others wait as ``queued`` with their place
    counted from the heap, and a Pro job that jumps the line moves the others back."""
    gate = threading.Event()

    def _slow(*a, **k):
        gate.wait(10)
        return _result()

    monkeypatch.setattr("app.jobs.queue.transcribe", _slow)
    queue = JobQueue(workers=1)
    try:
        first = queue.submit(_temp_audio(), mode="melody", key=None, tempo=None)
        _await_status(queue, first, STATUS_PROCESSING)
        second = queue.submit(_temp_audio(), mode="melody", key=None, tempo=None)
        third = queue.submit(_temp_audio(), mode="melody", key=None, tempo=None)
        assert queue.get(first).stage == STAGE_TRANSCRIBING and queue.queue_position(first) is None
        assert queue.get(second).stage == STAGE_QUEUED and queue.queue_position(second) == 0
        assert queue.get(third).stage == STAGE_QUEUED and queue.queue_position(third) == 1
        pro = queue.submit(_temp_audio(), mode="melody", key=None, tempo=None, priority=PRIORITY_HIGH)
        assert queue.queue_position(pro) == 0
        assert queue.queue_position(second) == 1 and queue.queue_position(third) == 2
        assert queue.queue_position("nosuchjob") is None
        gate.set()
        for jid in (first, pro, second, third):
            job = _await_status(queue, jid, STATUS_DONE)
            assert job.stage is None and queue.queue_position(jid) is None
    finally:
        gate.set()
        queue.shutdown(wait=True)
