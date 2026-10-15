"""The worker's defences: audio is decoded to its cap whatever its header says, the app will not
start keyless by accident, input is checked before work starts, nothing it writes outlives a
crash, the queue and its memory are bounded, and callbacks and score files are trusted no
further than they must be."""

import io
import json
import os
import shutil
import subprocess
import time
import zipfile
from io import BytesIO
from pathlib import Path

import httpx
import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.config import settings
from app.ingest import links
from app.jobs import queue as queue_mod
from app.jobs.journal import JobJournal
from app.jobs.queue import STATUS_DONE, Job, JobQueue, QueueFull
from app.main import _require_api_key, _sweep_stale_temp_files, app
from app.pipeline.transcriber import LowConfidenceError, TranscriptionResult, _ensure_wav_path

FFMPEG = shutil.which("ffmpeg")
needs_ffmpeg = pytest.mark.skipif(FFMPEG is None, reason="ffmpeg is not installed")


def _result(**audio) -> TranscriptionResult:
    return TranscriptionResult(key="C", key_confidence=1.0, tempo=120, time_signature="4/4", musicxml="<score/>",
                               midi_base64="", notes=[], solfa_lines=[], overall_confidence=1.0, **audio)


def _streamed_webm(seconds: float) -> bytes:
    """Opus in WebM written to a pipe, as a browser's MediaRecorder streams it: no length in
    the header, because the muxer could not seek back to write one."""
    done = subprocess.run(
        [FFMPEG, "-v", "error", "-nostdin", "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
         "-c:a", "libopus", "-f", "webm", "pipe:1"], capture_output=True, check=True, timeout=60)
    return done.stdout


# ── H4: the cap holds for audio with no length in its header ─────────────────


@needs_ffmpeg
def test_a_streamed_webm_longer_than_the_cap_is_cut_to_it(monkeypatch):
    from app.api import routes

    data = _streamed_webm(5.0)
    seen = {}

    def submit(self, audio_path, **kw):
        seen["seconds"] = sf.info(str(audio_path)).duration
        seen["song_seconds"] = kw["song_seconds"]
        Path(audio_path).unlink(missing_ok=True)
        return "job"

    monkeypatch.setattr(JobQueue, "submit", submit)
    with TestClient(app) as client:
        r = client.post("/v1/transcribe", files={"audio": ("take.webm", BytesIO(data), "audio/webm")},
                        data={"max_seconds": "2"})
    assert r.status_code == 202, r.text
    assert seen["seconds"] <= 2.0 + 1e-3
    assert seen["song_seconds"] is not None  # reported as cut, not as whole

    # The measurement that let it through before: the header says nothing.
    path = Path(routes.tempfile.gettempdir()) / "nf-test-streamed.webm"
    path.write_bytes(data)
    try:
        assert routes._clip_duration_seconds(path) < 2.0
    finally:
        path.unlink(missing_ok=True)


@needs_ffmpeg
def test_conversion_to_wav_never_reads_past_its_cap(tmp_path):
    src = tmp_path / "take.webm"
    src.write_bytes(_streamed_webm(5.0))
    wav, converted = _ensure_wav_path(src, max_seconds=2.0)
    try:
        assert converted and sf.info(str(wav)).duration <= 2.0 + 1e-3
    finally:
        wav.unlink(missing_ok=True)


def test_every_decode_has_a_bound(monkeypatch):
    monkeypatch.setattr(settings, "max_clip_seconds", 180.0)
    monkeypatch.setattr(settings, "link_max_seconds", 360.0)
    assert settings.audio_limit_seconds == 361.0


# ── M8/L6: no accidental keyless start, bytes comparison, no docs ────────────


def test_the_app_will_not_start_without_a_key_unless_told(monkeypatch):
    monkeypatch.delenv("NF_API_KEY", raising=False)
    monkeypatch.delenv("NF_ALLOW_NO_AUTH", raising=False)
    with pytest.raises(RuntimeError, match="NF_API_KEY"):
        _require_api_key()
    monkeypatch.setenv("NF_ALLOW_NO_AUTH", "1")
    _require_api_key()
    monkeypatch.delenv("NF_ALLOW_NO_AUTH")
    monkeypatch.setenv("NF_API_KEY", "k")
    _require_api_key()


def test_a_non_ascii_key_header_is_a_401_not_a_500(monkeypatch):
    monkeypatch.setenv("NF_API_KEY", "secret_test_key_123")
    with TestClient(app) as client:
        r = client.get("/v1/jobs/x", headers={"X-Api-Key": "sécret".encode("latin-1")})
        assert r.status_code == 401
        r = client.get("/v1/jobs/x", headers={"Authorization": b"Bearer \xff\xfe"})
        assert r.status_code == 401


def test_the_docs_are_not_served_by_default(monkeypatch):
    monkeypatch.setenv("NF_API_KEY", "secret_test_key_123")
    with TestClient(app) as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert client.get(path).status_code in (401, 404)
            assert client.get(path, headers={"X-Api-Key": "secret_test_key_123"}).status_code == 404


# ── M10: harmonise and grade input ────────────────────────────────────────────


NOTE = {"pitchMidi": 60, "startBeat": 0.0, "durBeats": 1.0}


@pytest.mark.parametrize("bad", [
    {"startBeat": float("nan")},
    {"durBeats": float("inf")},
    {"pitchMidi": 10_000},
    {"pitchMidi": -1},
    {"durBeats": 0.01},
    {"conf": float("nan")},
])
def test_harmonise_refuses_notes_out_of_range_in_a_plain_sentence(bad):
    with TestClient(app) as client:
        r = client.post("/v1/harmonise", content=json.dumps({"key": "C major", "tempoBpm": 100, "notes": [{**NOTE, **bad}]}),
                        headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], str) and "pitch from 0 to 127" in r.json()["detail"]


def test_harmonise_answers_a_bad_key_without_echoing_it():
    with TestClient(app) as client:
        r = client.post("/v1/harmonise", json={"key": "<script>", "tempoBpm": 100, "notes": [NOTE]})
    assert r.status_code == 422 and "<script>" not in r.text


def _grade(client, target) -> httpx.Response:
    buf = BytesIO()
    sf.write(buf, np.zeros(22050, dtype=np.float32), 22050, format="WAV")
    body = target if isinstance(target, str) else json.dumps(target)
    return client.post("/v1/grade", files={"audio": ("take.wav", BytesIO(buf.getvalue()), "audio/wav")},
                       data={"target": body})


@pytest.mark.parametrize("target", [
    {"notes": [{**NOTE, "startBeat": float("nan")}], "tempoBpm": 100},
    {"notes": [{**NOTE, "pitchMidi": 999}], "tempoBpm": 100},
    {"notes": [{**NOTE, "durBeats": 0.001}], "tempoBpm": 100},
    {"notes": [NOTE] * 2001, "tempoBpm": 100},
    {"notes": [NOTE], "tempoBpm": 100, "leadInSec": 31},
    {"notes": [NOTE], "tempoBpm": 100, "leadInSec": -1},
    {"notes": [NOTE], "tempoBpm": float("nan")},
])
def test_grade_refuses_a_target_out_of_range(target):
    with TestClient(app) as client:
        r = _grade(client, target)
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_grade_does_not_echo_a_parser_error():
    with TestClient(app) as client:
        r = _grade(client, '{"notes": [{"pitchMidi": "secret-input"}]')
    assert r.status_code == 422
    assert r.json()["detail"] == "The target part could not be read."


# ── M11: nothing outlives a crash ─────────────────────────────────────────────


JOB_A, JOB_B, JOB_C = "a" * 32, "b" * 32, "c" * 32


def test_deleting_a_journal_entry_takes_its_audio_with_it(tmp_path):
    journal = JobJournal(tmp_path / "j")
    journal.write(JOB_A, {"id": JOB_A, "kind": "upload"})
    (journal.dir / f"{JOB_A}.webm").write_bytes(b"x")
    (journal.dir / f"{JOB_B}.wav").write_bytes(b"y")
    journal.delete(JOB_A)
    assert sorted(p.name for p in journal.dir.iterdir()) == [f"{JOB_B}.wav"]


def test_recovery_sweeps_files_no_entry_owns(monkeypatch, tmp_path):
    journal = JobJournal(tmp_path / "j")
    kept = journal.dir / f"{JOB_A}.wav"
    kept.write_bytes(b"RIFF")
    journal.write(JOB_A, {"id": JOB_A, "kind": "upload", "audio": str(kept), "created": 1.0, "attempts": 0})
    (journal.dir / f"{JOB_B}.webm").write_bytes(b"orphan")  # the crash came before its entry
    (journal.dir / f".{JOB_C}.x1y2.tmp").write_text("{half")  # a write cut short
    (journal.dir / "README").write_text("not ours")
    gate = __import__("threading").Event()
    monkeypatch.setattr(queue_mod, "transcribe", lambda path, **kw: (gate.wait(5), _result())[1])
    monkeypatch.setattr(queue_mod, "_sounds_like_a_song", lambda *a: False)
    queue = JobQueue(workers=1, pro_lane_workers=0, job_dir=str(journal.dir))
    try:
        assert queue.recover() == 1
        names = sorted(p.name for p in journal.dir.iterdir())
        # Job C's write cut short is swept. Job A, replayed, may already be running and mid-way
        # through journaling its attempt, so a temp file of its own is a live write, not debris.
        assert f"{JOB_B}.webm" not in names and f".{JOB_C}.x1y2.tmp" not in names
        assert "README" in names and f"{JOB_A}.wav" in names
    finally:
        gate.set()
        queue.shutdown(wait=True, timeout=2)


def test_the_startup_sweep_removes_only_old_files_with_our_prefixes(tmp_path):
    old = time.time() - 3600
    stale = [tmp_path / "nf-tmp-abc.wav", tmp_path / "nf_cookies_x.txt"]
    for p in stale:
        p.write_bytes(b"x")
    stale_dir = tmp_path / "nf_link_q"
    stale_dir.mkdir()
    (stale_dir / "audio.m4a").write_bytes(b"x")
    stale.append(stale_dir)
    for p in stale:
        os.utime(p, (old, old))
    foreign = tmp_path / "tmpabc.wav"
    foreign.write_bytes(b"x")
    os.utime(foreign, (old, old))
    fresh = tmp_path / "nf-upload-new"
    fresh.mkdir()

    assert _sweep_stale_temp_files(tmp_path, before=time.time() - 60) == 3
    assert not any(p.exists() for p in stale)
    assert foreign.exists() and fresh.exists()


# ── M12: a bounded line and bounded memory ────────────────────────────────────


def test_a_full_queue_is_a_503_with_retry_after(monkeypatch):
    monkeypatch.setattr(settings, "max_pending_jobs", 0)
    with TestClient(app) as client:
        r = client.post("/v1/transcribe", files={"audio": ("clip.wav", BytesIO(b"RIFF"), "audio/wav")})
        assert r.status_code == 503 and r.headers["Retry-After"]
        assert r.json()["detail"] == "The transcription service is busy right now. Please try again in a minute."
        r = client.post("/v1/transcribe/link", data={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"})
        assert r.status_code == 503


def test_the_queue_refuses_past_its_limit_but_replays_what_it_accepted(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "max_pending_jobs", 1)
    queue = JobQueue(workers=1, pro_lane_workers=0)
    queue.shutdown(wait=True, timeout=2)  # no worker: whatever is queued stays pending
    queue._new_job(None, None, "normal")
    assert queue.is_full()
    with pytest.raises(QueueFull):
        queue._new_job(None, None, "normal")
    queue._new_job(None, None, "normal", job_id=JOB_A, recovered=True)
    assert queue.get(JOB_A) is not None


def test_delivered_results_shed_their_audio_first_when_over_budget(monkeypatch):
    monkeypatch.setattr(settings, "result_audio_budget_mb", 1.0)
    queue = JobQueue(workers=1, pro_lane_workers=0)
    queue.shutdown(wait=True, timeout=2)
    now = time.monotonic()
    big = "A" * (700 * 1024)

    def finished(jid, delivered_ago):
        job = Job(id=jid, status=STATUS_DONE, result=_result(audio_preview_base64=big, backing_audio_base64="B" * 10),
                  finished_at=now)
        job.delivered_at = None if delivered_ago is None else now - delivered_ago
        queue._jobs[jid] = job
        return job

    old, recent, undelivered = finished(JOB_A, 600), finished(JOB_B, 5), finished(JOB_C, None)
    queue.get(JOB_A)
    assert old.result.audio_preview_base64 == "" and old.result.backing_audio_base64 == ""
    assert old.result.musicxml == "<score/>"  # the sheet stays
    assert recent.result.audio_preview_base64 == big  # inside its grace period
    assert undelivered.result.audio_preview_base64 == big  # the API has not banked it


def test_the_link_cache_is_bounded_and_keeps_only_what_it_reads(monkeypatch):
    links._cache.clear()
    try:
        info = json.dumps({"duration": 200, "formats": [1], "automatic_captions": {"en": ["x" * 1000]},
                           "subtitles": {}, "thumbnails": [{}] * 50})
        entry = links._Cached(links.Source("youtube", "https://www.youtube.com/watch?v=x", "t", "a"), info)
        links._cache_put(entry, "k")
        kept = json.loads(links._cache_get("k").info_json)
        assert kept == {"duration": 200, "formats": [1]}
        for i in range(links.RESOLVE_CACHE_MAX_KEYS + 10):
            links._cache_put(links._Cached(links.Source("youtube", f"u{i}", "t", "a")), f"key{i}")
        assert len(links._cache) == links.RESOLVE_CACHE_MAX_KEYS
        assert links._cache_get("k") is None and links._cache_get("key0") is None
    finally:
        links._cache.clear()


# ── L15: callbacks only to known hosts, with the key ──────────────────────────


class _Posts:
    def __init__(self):
        self.posted = []

    def __call__(self, *a, **k):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def post(self, url, json=None, headers=None):
        self.posted.append((url, headers))
        return httpx.Response(200, request=httpx.Request("POST", url))


@pytest.mark.parametrize("url, sent", [
    ("http://api:8080/api/internal/webhooks/transcription/{job_id}", True),
    ("http://localhost/hook", True),
    ("http://169.254.169.254/latest/meta-data", False),
    ("https://evil.example/hook", False),
    ("file:///etc/passwd", False),
])
def test_the_webhook_goes_only_to_allowed_hosts_and_carries_the_key(monkeypatch, url, sent):
    monkeypatch.setenv("NF_API_KEY", "worker-key")
    posts = _Posts()
    monkeypatch.setattr(queue_mod.httpx, "Client", posts)
    queue = JobQueue(workers=1, pro_lane_workers=0)
    queue.shutdown(wait=True, timeout=2)
    job = queue._new_job(None, url, "normal")
    job.status, job.result = STATUS_DONE, _result()
    queue._trigger_webhook(job)
    deadline = time.monotonic() + 2
    while sent and not posts.posted and time.monotonic() < deadline:
        time.sleep(0.02)
    time.sleep(0.05)
    if sent:
        assert len(posts.posted) == 1 and posts.posted[0][1] == {"X-Api-Key": "worker-key"}
        assert job.delivered_at is not None
    else:
        assert posts.posted == []


# ── L16: score files ──────────────────────────────────────────────────────────


def test_an_mxl_that_unpacks_too_large_is_refused_in_plain_words(tmp_path):
    from app.pipeline.score_transcriber import UNREADABLE_SCORE, transcribe_score

    path = tmp_path / "bomb.mxl"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("score.xml", b"<a>" + b" " * (21 * 1024 * 1024) + b"</a>")
    assert path.stat().st_size < 1024 * 1024
    with pytest.raises(LowConfidenceError) as raised:
        transcribe_score(path)
    assert str(raised.value) == UNREADABLE_SCORE


def test_an_mxl_with_an_entity_expansion_is_refused(tmp_path):
    from app.pipeline.score_transcriber import UNREADABLE_SCORE, transcribe_score

    evil = (b'<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]>'
            b"<score-partwise>&b;</score-partwise>")
    path = tmp_path / "evil.mxl"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("score.xml", evil)
    with pytest.raises(LowConfidenceError) as raised:
        transcribe_score(path)
    assert str(raised.value) == UNREADABLE_SCORE


def test_a_malformed_score_is_answered_without_the_parsers_words(tmp_path):
    from app.pipeline.score_transcriber import UNREADABLE_SCORE, transcribe_score

    path = tmp_path / "broken.musicxml"
    path.write_text("<score-partwise><part secret-token")
    with pytest.raises(LowConfidenceError) as raised:
        transcribe_score(path)
    assert str(raised.value) == UNREADABLE_SCORE and "secret-token" not in str(raised.value)


# ── L17: a timed-out yt-dlp takes its children with it ────────────────────────


def test_a_timeout_kills_the_whole_process_group(tmp_path):
    pid_file = tmp_path / "child.pid"
    with pytest.raises(subprocess.TimeoutExpired):
        links._run_group(["sh", "-c", f"sleep 60 & echo $! > {pid_file}; wait"], timeout=0.5)
    pid = int(pid_file.read_text().strip())
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        try:
            state = Path(f"/proc/{pid}/status").read_text()
        except FileNotFoundError:
            return
        if "State:\tZ" in state:
            return  # killed, waiting on a parent that does not reap (no init in this container)
        time.sleep(0.05)
    pytest.fail("the grandchild outlived the timeout")
