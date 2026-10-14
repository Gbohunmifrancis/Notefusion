"""The job journal (``app.jobs.journal``): a submit survives a restart under its own id, a job
that keeps dying is failed instead of replayed forever, and the completion webhook is tried
again while the API restarts."""

import json
import threading
import time
from pathlib import Path

import httpx
import pytest

from app.config import settings
from app.ingest import links
from app.ingest.links import LinkError
from app.jobs import queue as queue_mod
from app.jobs.journal import JobJournal
from app.jobs.queue import STATUS_DONE, STATUS_FAILED, STATUS_PENDING, STATUS_PROCESSING, JobQueue
from app.pipeline.transcriber import TranscriptionResult


def _result() -> TranscriptionResult:
    return TranscriptionResult(key="C", key_confidence=1.0, tempo=120, time_signature="4/4",
                               musicxml="<score/>", midi_base64="bWk=", notes=[], solfa_lines=[], overall_confidence=1.0)


def _wait(queue: JobQueue, job_id: str, statuses, timeout: float = 5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = queue.get(job_id)
        if job is not None and job.status in statuses:
            return job
        time.sleep(0.02)
    job = queue.get(job_id)
    raise AssertionError(f"job {job_id} at {job and job.status!r}, wanted {statuses}")


def _until(check, timeout: float = 3.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.02)
    raise AssertionError("condition not met in time")


def _audio(folder: Path, name: str = "clip.wav") -> Path:
    path = folder / name
    path.write_bytes(b"RIFF")
    return path


class _Posts:
    """httpx.Client as the queue's webhook sees it: every post recorded, answered as told."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.posted: list[tuple[str, dict]] = []

    def __call__(self, *args, **kwargs):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def post(self, url, json=None, headers=None):
        self.posted.append((url, json))
        self.headers = headers
        answer = self.answers.pop(0) if self.answers else 200
        if isinstance(answer, Exception):
            raise answer
        return httpx.Response(answer, request=httpx.Request("POST", url))


def test_a_submit_is_journaled_with_its_audio_kept_and_forgotten_when_done(monkeypatch, tmp_path):
    gate = threading.Event()

    def transcribe(path, **kwargs):
        assert Path(path).is_file()
        gate.wait(5)
        return _result()

    monkeypatch.setattr(queue_mod, "transcribe", transcribe)
    monkeypatch.setattr(queue_mod, "_sounds_like_a_song", lambda *a: False)
    journal = tmp_path / "journal"
    queue = JobQueue(workers=1, pro_lane_workers=0, job_dir=str(journal))
    try:
        upload = _audio(tmp_path)
        jid = queue.submit(upload, "melody", None, 100, correlation_id="corr-1", callback_url="http://api/hook/{job_id}",
                           harmony=True)
        _wait(queue, jid, (STATUS_PROCESSING,))
        assert not upload.exists() and (journal / f"{jid}.wav").is_file()  # moved where a restart cannot reach
        record = json.loads((journal / f"{jid}.json").read_text())
        assert record["kind"] == "upload" and record["audio"] == str(journal / f"{jid}.wav")
        assert record["attempts"] == 1 and record["correlation_id"] == "corr-1"
        assert record["callback_url"] == f"http://api/hook/{jid}"
        assert (record["mode"], record["tempo"], record["harmony"]) == ("melody", 100, True)
        gate.set()
        _wait(queue, jid, (STATUS_DONE,))
        _until(lambda: not (journal / f"{jid}.json").exists())
        assert not (journal / f"{jid}.wav").exists()  # audio never outlives its job
    finally:
        gate.set()
        queue.shutdown(wait=True, timeout=2)


def test_a_restart_replays_queued_and_running_jobs_under_their_ids(monkeypatch, tmp_path, caplog):
    journal = JobJournal(tmp_path / "journal")
    audio = _audio(journal.dir, "aaaa.wav")
    journal.write("aaaa", {"id": "aaaa", "kind": "upload", "created": 1.0, "attempts": 1, "priority": "high",
                           "correlation_id": "corr-a", "callback_url": "http://api/hook/aaaa", "audio": str(audio),
                           "mode": "melody", "key": "G", "tempo": None, "time_signature": "3/4", "song_seconds": None,
                           "separate": False, "audio_preview": False, "harmony": False, "keyboard_transpose": 0})
    journal.write("bbbb", {"id": "bbbb", "kind": "link", "created": 2.0, "attempts": 0, "priority": "normal",
                           "correlation_id": None, "callback_url": None, "url": "https://youtu.be/dQw4w9WgXcQ",
                           "mode": "melody", "key": None, "tempo": None, "time_signature": "4/4", "max_seconds": 60.0,
                           "audio_preview": True, "harmony": False, "keyboard_transpose": 0, "start_seconds": 30.0,
                           "end_seconds": 90.0})
    seen: dict = {}

    def transcribe(path, **kwargs):
        seen["upload"] = (Path(path).name, kwargs.get("key_override"), kwargs.get("time_signature"), kwargs.get("fast"))
        return _result()

    def resolve(url):
        seen["link"] = url
        raise LinkError("YouTube is refusing automated downloads right now. Upload the audio file instead.")

    monkeypatch.setattr(queue_mod, "transcribe", transcribe)
    monkeypatch.setattr(queue_mod, "_sounds_like_a_song", lambda *a: False)
    monkeypatch.setattr(links, "resolve_source", resolve)
    queue = JobQueue(workers=1, pro_lane_workers=0, job_dir=str(journal.dir))
    try:
        assert queue.get("aaaa") is None  # nothing until recovery is asked for
        with caplog.at_level("INFO", logger="app.jobs.queue"):
            assert queue.recover() == 2
        done = _wait(queue, "aaaa", (STATUS_DONE, STATUS_FAILED))
        assert done.status == STATUS_DONE and done.correlation_id == "corr-a" and done.priority == "high"
        assert done.callback_url == "http://api/hook/aaaa"
        assert seen["upload"] == ("aaaa.wav", "G", "3/4", True)
        failed = _wait(queue, "bbbb", (STATUS_DONE, STATUS_FAILED))
        assert failed.status == STATUS_FAILED and "Upload the audio file" in failed.error
        assert seen["link"] == "https://youtu.be/dQw4w9WgXcQ"
        _until(lambda: not list(journal.dir.glob("*.json")))
        assert not audio.exists()
        assert any("Journal: 2 jobs re-queued, 0 failed" in r.getMessage() for r in caplog.records)
        assert any("started 1 times before" in r.getMessage() for r in caplog.records)
    finally:
        queue.shutdown(wait=True, timeout=2)


def test_a_job_started_too_often_or_without_its_audio_is_failed_and_the_api_told(monkeypatch, tmp_path):
    journal = JobJournal(tmp_path / "journal")
    journal.write("cccc", {"id": "cccc", "kind": "link", "created": 1.0, "attempts": settings.job_max_attempts,
                           "priority": "normal", "correlation_id": None, "callback_url": "http://api/hook/cccc",
                           "url": "https://youtu.be/dQw4w9WgXcQ", "mode": "melody", "max_seconds": 60.0})
    journal.write("dddd", {"id": "dddd", "kind": "upload", "created": 2.0, "attempts": 0, "priority": "normal",
                           "correlation_id": None, "callback_url": None, "audio": str(journal.dir / "gone.wav"),
                           "mode": "melody"})
    posts = _Posts([200])
    monkeypatch.setattr(queue_mod.httpx, "Client", posts)
    monkeypatch.setattr(links, "resolve_source", lambda url: pytest.fail("a job past its attempts must not run"))
    queue = JobQueue(workers=1, pro_lane_workers=0, job_dir=str(journal.dir))
    try:
        assert queue.recover() == 0
        for jid in ("cccc", "dddd"):
            job = queue.get(jid)
            assert job.status == STATUS_FAILED and job.stage is None
            assert job.error == queue_mod._LOST_ERROR
            assert "restart" in job.error and "Nothing was charged" in job.error
        assert not list(journal.dir.glob("*.json"))
        _until(lambda: len(posts.posted) == 1)
        url, payload = posts.posted[0]
        assert url == "http://api/hook/cccc" and payload["status"] == "failed"
        assert payload["error"] == queue_mod._LOST_ERROR
    finally:
        queue.shutdown(wait=True, timeout=2)


def test_an_unreadable_entry_is_dropped_and_a_queue_without_a_directory_keeps_nothing(tmp_path, caplog):
    journal = tmp_path / "journal"
    journal.mkdir()
    (journal / "junk.json").write_text("{not json")
    (journal / "noid.json").write_text("{}")
    queue = JobQueue(workers=1, pro_lane_workers=0, job_dir=str(journal))
    try:
        with caplog.at_level("WARNING", logger="app.jobs.journal"):
            assert queue.recover() == 0
        assert not list(journal.glob("*.json"))
        assert sum("dropped" in r.getMessage() for r in caplog.records) == 2
    finally:
        queue.shutdown(wait=True, timeout=2)

    plain = JobQueue(workers=1, pro_lane_workers=0)
    try:
        assert plain._journal is None and plain.recover() == 0
        assert queue_mod.job_queue._journal is None  # the module-level fallback never journals
    finally:
        plain.shutdown(wait=True, timeout=2)


def test_the_journal_is_written_whole_and_counts_starts(tmp_path):
    journal = JobJournal(tmp_path / "j")
    journal.write("eeee", {"id": "eeee", "kind": "link", "attempts": 0})
    journal.started("eeee")
    journal.started("eeee")
    assert journal.read("eeee")["attempts"] == 2
    assert [p.name for p in journal.dir.iterdir()] == ["eeee.json"]  # no temporary file left behind
    journal.started("missing")  # nothing to count: no error
    journal.delete("eeee")
    assert journal.read("eeee") is None and journal.entries() == []


def test_the_webhook_is_tried_again_while_the_api_is_away_but_not_after_an_answer(monkeypatch, tmp_path):
    monkeypatch.setattr(queue_mod, "_WEBHOOK_DELAYS", (0.0, 0.0, 0.0))
    monkeypatch.setattr(queue_mod, "transcribe", lambda path, **kwargs: _result())
    monkeypatch.setattr(queue_mod, "_sounds_like_a_song", lambda *a: False)
    away = _Posts([httpx.ConnectError("refused"), httpx.ConnectError("refused"), 200])
    monkeypatch.setattr(queue_mod.httpx, "Client", away)
    queue = JobQueue(workers=1, pro_lane_workers=0)
    try:
        jid = queue.submit(_audio(tmp_path, "a.wav"), "melody", None, None, callback_url="http://api/hook/{job_id}")
        _wait(queue, jid, (STATUS_DONE,))
        _until(lambda: len(away.posted) == 3)
        assert all(url == f"http://api/hook/{jid}" for url, _ in away.posted)

        answered = _Posts([404])
        monkeypatch.setattr(queue_mod.httpx, "Client", answered)
        jid = queue.submit(_audio(tmp_path, "b.wav"), "melody", None, None, callback_url="http://api/hook/{job_id}")
        _wait(queue, jid, (STATUS_DONE,))
        _until(lambda: len(answered.posted) == 1)
        time.sleep(0.1)
        assert len(answered.posted) == 1  # the API has made up its mind
    finally:
        queue.shutdown(wait=True, timeout=2)


def test_health_checks_stay_out_of_the_access_log():
    import logging

    from app.main import _HealthCheckFilter

    def record(path: str) -> logging.LogRecord:
        return logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                                 ("127.0.0.1:1", "GET", path, "1.1", 200), None)

    assert _HealthCheckFilter().filter(record("/healthz")) is False
    assert _HealthCheckFilter().filter(record("/v1/jobs/abc")) is True
