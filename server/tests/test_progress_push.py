"""Live progress: a job's changes are posted on to the API, coalesced, and never after it has ended."""

import threading
import time

import httpx

from app.jobs import progress as progress_mod
from app.jobs import queue as queue_mod
from app.jobs.progress import ProgressReporter
from app.jobs.queue import STAGE_QUEUED, STATUS_DONE, STATUS_PENDING, STATUS_PROCESSING, JobQueue

HOOK = "http://api:8080/api/internal/webhooks/transcription/{job_id}"


class _Posts:
    """Stands in for httpx.Client: records every progress post (``/progress``). Other posts are left out: a
    completion webhook another test started may still be on its way through the same patched client."""

    def __init__(self):
        self.posted = []
        self.lock = threading.Lock()

    def __call__(self, *a, **k):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def post(self, url, json=None, headers=None):
        if url.endswith("/progress"):
            with self.lock:
                self.posted.append((url, json, headers))
        return httpx.Response(204, request=httpx.Request("POST", url))

    def wait_for(self, count, within=2.0):
        return self.wait_until(lambda posted: len(posted) >= count, within)

    def wait_until(self, done, within=2.0):
        deadline = time.monotonic() + within
        while time.monotonic() < deadline:
            with self.lock:
                if done(self.posted):
                    return list(self.posted)
            time.sleep(0.01)
        with self.lock:
            return list(self.posted)


def _about(job, posted):
    """The bodies posted about ``job``, oldest first."""
    return [body for url, body, _ in posted if url.endswith(f"/{job.id}/progress")]


class _Job:
    def __init__(self, job_id, status=STATUS_PROCESSING):
        self.id, self.status, self.progress = job_id, status, 0.0


def _reporter(posts, monkeypatch, min_interval=0.2):
    monkeypatch.setattr(progress_mod.httpx, "Client", posts)
    return ProgressReporter(
        snapshot=lambda job: None if job.status == STATUS_DONE else {"status": job.status, "progress": job.progress},
        url=lambda job: f"http://api/jobs/{job.id}/progress",
        headers=lambda: {"X-Api-Key": "k"},
        min_interval=min_interval)


def test_a_burst_of_changes_is_sent_once_with_the_latest_state(monkeypatch):
    posts = _Posts()
    reporter = _reporter(posts, monkeypatch, min_interval=0.3)
    job = _Job("a")
    reporter.mark(job)  # the first change goes at once
    first = posts.wait_for(1)
    for i in range(1, 21):
        job.progress = i / 20
        reporter.mark(job)

    sent = posts.wait_for(2)
    time.sleep(0.4)
    sent = posts.wait_for(3, within=0.1)

    assert len(sent) == 2, sent
    assert first[0][1]["progress"] == 0.0
    assert sent[1][1]["progress"] == 1.0
    assert sent[1][0] == "http://api/jobs/a/progress" and sent[1][2] == {"X-Api-Key": "k"}


def test_an_ended_job_is_not_posted(monkeypatch):
    posts = _Posts()
    reporter = _reporter(posts, monkeypatch, min_interval=0.01)
    job = _Job("b", status=STATUS_DONE)

    reporter.mark(job)
    time.sleep(0.2)

    assert posts.posted == []


def test_a_job_reports_its_changes_and_the_line_moving(monkeypatch):
    posts = _Posts()
    monkeypatch.setattr(progress_mod.httpx, "Client", posts)
    monkeypatch.setattr(progress_mod, "MIN_INTERVAL", 0.0)
    queue = JobQueue(workers=1, pro_lane_workers=0)
    queue.shutdown(wait=True, timeout=2)  # nothing runs: every job stays in line
    queue._progress._min_interval = 0.0

    first = queue._new_job(None, HOOK, "normal")
    queue._enqueue(first, lambda: None)
    second = queue._new_job(None, HOOK, "normal")
    queue._enqueue(second, lambda: None)

    waiting = {"status": STATUS_PENDING, "progress": 0.0, "stage": STAGE_QUEUED, "queuePosition": 1}
    sent = posts.wait_until(lambda posted: waiting in _about(second, posted))
    assert waiting in _about(second, sent)

    # The first leaves the line (a worker takes it): the second is told it is next.
    queue._take(pro_lane=False)
    sent = posts.wait_until(lambda posted: _about(second, posted)[-1].get("queuePosition") == 0)
    assert _about(second, sent)[-1]["queuePosition"] == 0


def test_no_progress_is_posted_to_a_host_outside_the_allowed_ones(monkeypatch):
    posts = _Posts()
    monkeypatch.setattr(progress_mod.httpx, "Client", posts)
    queue = JobQueue(workers=1, pro_lane_workers=0)
    queue.shutdown(wait=True, timeout=2)
    queue._progress._min_interval = 0.0

    job = queue._new_job(None, "https://evil.example/hook", "normal")
    job.stage = STAGE_QUEUED
    job.progress = 0.5
    time.sleep(0.2)

    assert posts.posted == []


def test_the_switch_turns_it_off(monkeypatch):
    monkeypatch.setenv("NF_PROGRESS_PUSH", "0")
    queue = JobQueue(workers=1, pro_lane_workers=0)
    queue.shutdown(wait=True, timeout=2)

    job = queue._new_job(None, HOOK, "normal")

    assert job.on_change is None


def test_the_body_is_the_job_response_without_a_result(monkeypatch):
    queue = JobQueue(workers=1, pro_lane_workers=0)
    queue.shutdown(wait=True, timeout=2)
    job = queue._new_job(None, HOOK, "normal")
    job.status, job.stage, job.progress = STATUS_PROCESSING, "transcribing", 0.25

    assert queue._progress_body(job) == {"status": "processing", "progress": 0.25, "stage": "transcribing"}
    job.status = STATUS_DONE
    assert queue._progress_body(job) is None
    assert queue_mod._progress_url(job) == job.callback_url + "/progress"
