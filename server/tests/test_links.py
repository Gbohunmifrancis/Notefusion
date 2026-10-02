"""Linked-song ingest: URL parsing, metadata shaping, the link job and its route."""

import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.ingest import links
from app.ingest.links import LinkError, Source
from app.jobs import queue as queue_mod
from app.jobs.queue import PRIORITY_HIGH, PRIORITY_NORMAL, STATUS_DONE, STATUS_FAILED, JobQueue


# ── URL parsing ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ?t=42",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123",
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        "  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ",
    ],
)
def test_youtube_video_id_accepts_every_youtube_shape(url):
    assert links.youtube_video_id(url) == "dQw4w9WgXcQ"
    assert links.provider_of(url) == "youtube"


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/",
        "https://www.youtube.com/watch?v=short",
        "https://example.com/watch?v=dQw4w9WgXcQ",
        "not a url",
        "javascript:alert(1)",
        "",
    ],
)
def test_youtube_video_id_rejects_non_videos(url):
    assert links.youtube_video_id(url) is None


def test_provider_of_spotify_and_apple():
    assert links.provider_of("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc") == "spotify"
    assert links.provider_of("https://music.apple.com/us/album/song-name/123?i=456") == "apple_music"
    assert links.provider_of("https://music.apple.com/ng/song/amazing-grace/1440856203") == "apple_music"
    assert links.provider_of("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M") is None
    assert links.provider_of("https://music.apple.com/us/album/some-album/123") is None


def test_split_title_reads_artist_dash_title_and_strips_noise():
    assert links._split_title("Sinach - Way Maker (Official Video)", "SinachVEVO") == ("Way Maker", "Sinach")
    assert links._split_title("Way Maker [Lyrics]", "Sinach - Topic") == ("Way Maker", "Sinach")
    assert links._split_title("Nara Ekele Mo", "Tim Godfrey") == ("Nara Ekele Mo", "Tim Godfrey")


def test_explain_maps_bot_refusal_to_an_upload_hint():
    message = links._explain("ERROR: [youtube] abc: Sign in to confirm you’re not a bot.")
    assert "upload" in message.lower()
    assert "private" in links._explain("ERROR: Private video").lower()


def test_resolve_source_rejects_unknown_links():
    with pytest.raises(LinkError):
        links.resolve_source("https://example.com/song.mp3")


# ── Queue ─────────────────────────────────────────────────────────────────────


def _wait(queue: JobQueue, job_id: str, statuses, timeout: float = 10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = queue.get(job_id)
        if job is not None and job.status in statuses:
            return job
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not reach {statuses}")


def test_high_priority_jobs_run_before_waiting_normal_ones(monkeypatch, tmp_path):
    order: list[str] = []
    gate = time.monotonic() + 0.3

    def slow_transcribe(path, **kwargs):
        from app.pipeline.transcriber import TranscriptionResult

        while time.monotonic() < gate:  # the first job holds the single worker
            time.sleep(0.01)
        order.append(kwargs.get("fast") and "high" or "normal")
        return TranscriptionResult(key="C major", key_confidence=1, tempo=100, time_signature="4/4",
                                   musicxml="<x/>", midi_base64="")

    monkeypatch.setattr(queue_mod, "transcribe", slow_transcribe)
    queue = JobQueue(workers=1)
    try:
        paths = []
        for _ in range(3):
            p = tmp_path / f"{len(paths)}.wav"
            p.write_bytes(b"x")
            paths.append(p)
        first = queue.submit(paths[0], "melody", None, None)  # occupies the worker
        _wait(queue, first, ("processing",))
        normal = queue.submit(paths[1], "melody", None, None, priority=PRIORITY_NORMAL)
        high = queue.submit(paths[2], "melody", None, None, priority=PRIORITY_HIGH)
        for jid in (first, normal, high):
            _wait(queue, jid, (STATUS_DONE, STATUS_FAILED))
        assert order == ["normal", "high", "normal"]
    finally:
        queue.shutdown(wait=True, timeout=2)


def _fake_wav(path: Path) -> Path:
    sr = 22_050
    t = np.arange(sr) / sr
    sf.write(str(path), (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), sr)
    return path


def test_link_job_resolves_fetches_separates_and_transcribes(monkeypatch, tmp_path):
    from app.pipeline import separate
    from app.pipeline.transcriber import TranscriptionResult

    source = Source("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "Way Maker", "Sinach", None,
                    audio_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    seen: dict = {}

    monkeypatch.setattr(links, "resolve_source", lambda url: source)

    def fake_fetch(src, max_seconds, work_dir=None):
        seen["max_seconds"] = max_seconds
        work = tmp_path / "work"
        work.mkdir()
        return _fake_wav(work / "song.wav"), 250.0

    monkeypatch.setattr(links, "fetch_audio", fake_fetch)
    monkeypatch.setattr(separate, "available", lambda: True)

    def fake_separate(wav, out, progress=lambda f: None):
        progress(1.0)
        return _fake_wav(out)

    monkeypatch.setattr(separate, "separate_file", fake_separate)

    def fake_transcribe(path, **kwargs):
        seen["transcribed"] = Path(path).name
        seen["fast"] = kwargs.get("fast")
        return TranscriptionResult(key="C major", key_confidence=1, tempo=100, time_signature="4/4",
                                   musicxml="<x/>", midi_base64="")

    monkeypatch.setattr(queue_mod, "transcribe", fake_transcribe)

    queue = JobQueue(workers=1)
    try:
        jid = queue.submit_link("https://youtu.be/dQw4w9WgXcQ", "melody", None, None,
                                priority=PRIORITY_HIGH, max_seconds=60)
        job = _wait(queue, jid, (STATUS_DONE, STATUS_FAILED))
        assert job.status == STATUS_DONE, job.error
        assert job.source == {"provider": "youtube", "url": source.url, "title": "Way Maker",
                              "artist": "Sinach", "thumbnail_url": None}
        assert seen == {"max_seconds": 60, "transcribed": "vocals.wav", "fast": True}
        assert job.result.source["title"] == "Way Maker"
        assert job.result.truncated is True and job.result.separated is True
        assert job.result.song_duration_sec == 250.0
        assert job.stage is None and job.progress == 1.0
        assert not (tmp_path / "work").exists()  # audio never outlives the job
    finally:
        queue.shutdown(wait=True, timeout=2)


def test_link_job_surfaces_a_link_error_verbatim(monkeypatch):
    def refuse(url):
        raise LinkError("YouTube is refusing automated downloads right now. Upload the audio file instead.")

    monkeypatch.setattr(links, "resolve_source", refuse)
    queue = JobQueue(workers=1)
    try:
        jid = queue.submit_link("https://youtu.be/dQw4w9WgXcQ", "melody", None, None)
        job = _wait(queue, jid, (STATUS_DONE, STATUS_FAILED))
        assert job.status == STATUS_FAILED
        assert "Upload the audio file" in job.error
    finally:
        queue.shutdown(wait=True, timeout=2)


# ── Route ─────────────────────────────────────────────────────────────────────


@pytest.fixture
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    submitted: dict = {}

    class FakeQueue:
        def submit_link(self, url, **kwargs):
            submitted.update(url=url, **kwargs)
            return "job123"

        def get(self, job_id):
            return None

    monkeypatch.setattr("app.api.routes._get_queue", lambda request: FakeQueue())
    with TestClient(app) as c:
        yield c, submitted


def test_link_route_accepts_a_youtube_url_and_caps_the_length(client):
    c, submitted = client
    r = c.post("/v1/transcribe/link", data={"url": "https://youtu.be/dQw4w9WgXcQ", "priority": "high",
                                            "max_seconds": "9999"})
    assert r.status_code == 202, r.text
    assert r.json() == {"jobId": "job123"}
    assert submitted["priority"] == "high"
    assert submitted["max_seconds"] == pytest.approx(360.0)  # the worker's own cap wins
    assert submitted["mode"] == "melody" and submitted["time_signature"] == "4/4"


@pytest.mark.parametrize(
    "data",
    [
        {"url": "https://example.com/x.mp3"},
        {"url": "https://youtu.be/dQw4w9WgXcQ", "priority": "urgent"},
        {"url": "https://youtu.be/dQw4w9WgXcQ", "max_seconds": "3"},
        {"url": "https://youtu.be/dQw4w9WgXcQ", "mode": "choir"},
    ],
)
def test_link_route_rejects_bad_input(client, data):
    c, _ = client
    assert c.post("/v1/transcribe/link", data=data).status_code == 422


def test_job_response_carries_stage_and_source(monkeypatch):
    from fastapi.testclient import TestClient

    from app.jobs.queue import STATUS_PROCESSING, Job
    from app.main import app

    job = Job(id="abc", status=STATUS_PROCESSING, progress=0.3, stage="separating",
              source={"provider": "youtube", "url": "u", "title": "T", "artist": "A", "thumbnail_url": None})

    class FakeQueue:
        def get(self, job_id):
            return job

    monkeypatch.setattr("app.api.routes._get_queue", lambda request: FakeQueue())
    with TestClient(app) as c:
        body = c.get("/v1/jobs/abc").json()
    assert body["stage"] == "separating"
    assert body["source"] == {"provider": "youtube", "url": "u", "title": "T", "artist": "A"}
