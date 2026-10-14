"""Links turned away at a glance, and the second try a refused YouTube extraction gets
(``app.ingest.links``): the fallback player client, oEmbed's own refusals, live streams and
videos over the cap, the refusal remembered for the submit, and the media's second chance."""

import json
import subprocess
import urllib.error
from pathlib import Path

import pytest

from app.config import settings
from app.ingest import links
from app.ingest.links import LinkError, Source

YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
BOT = "ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you're not a bot. Use --cookies-from-browser"
FORBIDDEN = "ERROR: unable to download video data: HTTP Error 403: Forbidden"
OEMBED = {"title": "Rick Astley - Never Gonna Give You Up (Official Video)", "author_name": "RickAstleyVEVO",
          "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"}
DETAILS = {"id": "dQw4w9WgXcQ", "duration": 213, "title": "Rick Astley - Never Gonna Give You Up",
           "uploader": "Rick Astley", "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxres.jpg"}


# yt-dlp is faked as subprocess.run here (see conftest).
pytestmark = pytest.mark.usefixtures("ytdlp_via_subprocess_run")


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    links._cache.clear()
    monkeypatch.delenv("NF_YTDLP_COOKIES_FILE", raising=False)
    monkeypatch.delenv("NF_YTDLP_EXTRA_ARGS", raising=False)
    monkeypatch.setattr(settings, "ytdlp_fallback_clients", "tv_embedded")
    monkeypatch.setattr(settings, "link_max_video_seconds", 7200.0)
    yield
    links._cache.clear()


class _Completed:
    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = ""):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr


def _video() -> Source:
    return Source("youtube", YOUTUBE, "Never Gonna Give You Up", "Rick Astley", audio_url=YOUTUBE)


def _is_fallback(args: list[str]) -> bool:
    return any(a.startswith("youtube:player_client=") for a in args)


def _ytdlp(calls, *, details=None, refuse=(), refuse_media=False, timeout=False):
    """subprocess.run as yt-dlp, ffmpeg and ffprobe.  ``refuse`` says which ``-J`` reads are
    turned away with the bot check: "first" (the default clients only) or "all"; ``refuse_media``
    turns the first download away with a 403; ``timeout`` makes the first read time out."""
    details = DETAILS if details is None else details

    def run(args, **kwargs):
        calls.append(list(args))
        if args[0] == "ffmpeg":
            Path(args[-1]).write_bytes(b"RIFF")
            return _Completed()
        if args[0] == "ffprobe":
            return _Completed(0, "22.0\n")
        reads = [c for c in calls if "-J" in c]
        if "-J" in args:
            if timeout and len(reads) == 1:
                raise subprocess.TimeoutExpired(args, kwargs.get("timeout", 0))
            if "all" in refuse or ("first" in refuse and not _is_fallback(args)):
                return _Completed(1, "", BOT)
            return _Completed(0, json.dumps(details))
        downloads = [c for c in calls if "--load-info-json" in c]
        if refuse_media and len(downloads) == 1:
            return _Completed(1, "", FORBIDDEN)
        Path(args[args.index("-o") + 1].replace("%(ext)s", "m4a")).write_bytes(b"m4a")
        return _Completed()

    return run


def _reads(calls):
    return [c for c in calls if c[0] == "yt-dlp" and "-J" in c]


# ── The second try ────────────────────────────────────────────────────────────


def test_a_refused_read_is_tried_again_with_the_fallback_client(monkeypatch):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _ytdlp(calls, refuse=("first",)))
    monkeypatch.setattr(links, "_http_json", lambda url: OEMBED)
    source = links.resolve_link(YOUTUBE)
    assert source.duration == 213.0
    first, second = _reads(calls)
    assert not _is_fallback(first)
    assert second[second.index("--extractor-args") + 1] == "youtube:player_client=tv_embedded"
    assert second.index("--extractor-args") < second.index("-f")  # yt-dlp's options before the video
    # The job then downloads from the details the second try read: no third read.
    fetched = links.fetch_audio(source, 60, work_dir=None)
    try:
        assert fetched.song_seconds == 213.0 and len(_reads(calls)) == 2
    finally:
        import shutil
        shutil.rmtree(fetched.path.parent, ignore_errors=True)


def test_no_second_try_without_a_fallback_client_and_none_for_a_video_that_is_gone(monkeypatch):
    calls = []
    monkeypatch.setattr(settings, "ytdlp_fallback_clients", "")
    monkeypatch.setattr(links.subprocess, "run", _ytdlp(calls, refuse=("all",)))
    monkeypatch.setattr(links, "_http_json", lambda url: OEMBED)
    assert links.resolve_link(YOUTUBE).duration is None
    assert len(_reads(calls)) == 1

    calls.clear()
    links._cache.clear()
    monkeypatch.setattr(settings, "ytdlp_fallback_clients", "tv_embedded")

    def private(args, **kwargs):
        calls.append(list(args))
        return _Completed(1, "", "ERROR: [youtube] dQw4w9WgXcQ: Private video. Sign in if you've been granted access")

    monkeypatch.setattr(links.subprocess, "run", private)
    with pytest.raises(LinkError, match="private or unavailable"):
        links.fetch_audio(_video(), 60)
    assert len(calls) == 1  # another client would not make a private video public


def test_a_second_refusal_is_the_answer_and_both_are_in_the_log(monkeypatch, caplog):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _ytdlp(calls, refuse=("all",)))
    monkeypatch.setattr(links, "_http_json", lambda url: OEMBED)
    with caplog.at_level("INFO", logger="app.ingest.links"):
        assert links.resolve_link(YOUTUBE).duration is None
    assert len(_reads(calls)) == 2
    messages = [r.getMessage() for r in caplog.records]
    assert sum("yt-dlp failed" in m for m in messages) == 2
    assert any("trying again with player client tv_embedded" in m for m in messages)


def test_the_second_try_needs_time_left_and_never_follows_a_timeout(monkeypatch):
    calls = []
    now = [1000.0]
    monkeypatch.setattr(links.time, "monotonic", lambda: now[0])
    refusing = _ytdlp(calls, refuse=("all",))

    def slow_refusal(args, **kwargs):
        if "-J" in args:
            now[0] += links._INFO_TIMEOUT - links._FALLBACK_MIN_SECONDS + 1  # the first try ate the budget
        return refusing(args, **kwargs)

    monkeypatch.setattr(links.subprocess, "run", slow_refusal)
    monkeypatch.setattr(links, "_http_json", lambda url: OEMBED)
    assert links.resolve_link(YOUTUBE).duration is None
    assert len(_reads(calls)) == 1

    calls.clear()
    links._cache.clear()
    monkeypatch.setattr(links.subprocess, "run", _ytdlp(calls, timeout=True))
    assert links.resolve_link(YOUTUBE).duration is None
    assert len(_reads(calls)) == 1


def test_a_refused_download_reads_the_details_again_with_the_fallback_client(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _ytdlp(calls, refuse_media=True))
    fetched = links.fetch_audio(_video(), 60, work_dir=tmp_path)
    assert fetched.path.is_file()
    ytdlp = [c for c in calls if c[0] == "yt-dlp"]
    assert ["-J" in c for c in ytdlp] == [True, False, True, False]
    assert _is_fallback(ytdlp[2]) and not _is_fallback(ytdlp[0])

    monkeypatch.setattr(settings, "ytdlp_fallback_clients", "")
    monkeypatch.setattr(links, "_itunes_preview", lambda source: None)
    calls.clear()
    monkeypatch.setattr(links.subprocess, "run", _ytdlp(calls, refuse_media=True))
    with pytest.raises(LinkError):
        links.fetch_audio(_video(), 60, work_dir=tmp_path)
    assert ["-J" in c for c in calls if c[0] == "yt-dlp"] == [True, False]


# ── Links that can never be a song ────────────────────────────────────────────


def _http_error(code: int):
    def raise_it(url):
        raise urllib.error.HTTPError(url, code, "nope", {}, None)
    return raise_it


@pytest.mark.parametrize("code", [400, 404])
def test_a_video_that_does_not_exist_is_said_so(monkeypatch, code):
    monkeypatch.setattr(links.subprocess, "run", lambda *a, **k: pytest.fail("yt-dlp asked about nothing"))
    monkeypatch.setattr(links, "_http_json", _http_error(code))
    with pytest.raises(LinkError, match="doesn't exist") as caught:
        links.resolve_link(YOUTUBE)
    assert caught.value.code == "not_found"


def test_a_video_oembed_will_not_describe_is_read_from_its_details(monkeypatch):
    """Embedding switched off: oEmbed answers 401, yt-dlp names the song and the link resolves."""
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _ytdlp(calls))
    monkeypatch.setattr(links, "_http_json", _http_error(401))
    source = links.resolve_link(YOUTUBE)
    assert (source.title, source.artist, source.duration) == ("Never Gonna Give You Up", "Rick Astley", 213.0)
    assert source.thumbnail_url == DETAILS["thumbnail"]
    assert len(_reads(calls)) == 1
    assert links.resolve_link(YOUTUBE) is source and len(_reads(calls)) == 1  # remembered, details and all


def test_a_private_video_and_a_refused_one_are_told_apart(monkeypatch):
    def private(args, **kwargs):
        return _Completed(1, "", "ERROR: [youtube] dQw4w9WgXcQ: Private video")

    monkeypatch.setattr(links.subprocess, "run", private)
    monkeypatch.setattr(links, "_http_json", _http_error(403))
    with pytest.raises(LinkError, match="private or unavailable") as caught:
        links.resolve_link(YOUTUBE)
    assert caught.value.code == "unavailable"

    monkeypatch.setattr(links.subprocess, "run", _ytdlp([], refuse=("all",)))
    with pytest.raises(LinkError, match="refusing automated downloads") as caught:
        links.resolve_link(YOUTUBE)
    assert caught.value.code == "refused"


def test_youtubes_own_trouble_still_reads_as_an_unreadable_link(monkeypatch):
    monkeypatch.setattr(links, "_http_json", _http_error(503))
    with pytest.raises(LinkError, match="Could not read that link") as caught:
        links.resolve_link(YOUTUBE)
    assert caught.value.code is None


@pytest.mark.parametrize(
    ("details", "words"),
    [
        ({**DETAILS, "duration": None, "is_live": True, "live_status": "is_live"}, "live stream"),
        ({**DETAILS, "duration": None, "live_status": "post_live"}, "live stream"),
        ({**DETAILS, "duration": None, "live_status": "is_upcoming"}, "premiered"),
    ],
)
def test_a_live_stream_is_refused_and_the_refusal_remembered(monkeypatch, details, words):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _ytdlp(calls, details=details))
    monkeypatch.setattr(links, "_http_json", lambda url: OEMBED)
    with pytest.raises(LinkError, match=words) as caught:
        links.resolve_link(YOUTUBE)
    assert caught.value.code == "live"
    # The submit that follows is answered from memory, and so is the next look.
    assert links.cached_refusal(YOUTUBE) is caught.value
    assert links.cached_refusal("https://youtu.be/dQw4w9WgXcQ") is caught.value
    with pytest.raises(LinkError, match=words):
        links.resolve_link(YOUTUBE)
    assert len(_reads(calls)) == 1


def test_a_video_over_the_cap_is_refused_with_both_lengths(monkeypatch):
    monkeypatch.setattr(links.subprocess, "run", _ytdlp([], details={**DETAILS, "duration": 9960}))
    monkeypatch.setattr(links, "_http_json", lambda url: OEMBED)
    with pytest.raises(LinkError, match="runs 2 h 46 min. Links up to 2 hours") as caught:
        links.resolve_link(YOUTUBE)
    assert (caught.value.code, caught.value.limit_seconds) == ("too_long", 7200.0)

    links._cache.clear()
    monkeypatch.setattr(settings, "link_max_video_seconds", 0.0)
    assert links.resolve_link(YOUTUBE).duration == 9960.0  # no cap, no refusal


def test_a_job_refuses_the_same_videos_before_downloading_anything(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _ytdlp(calls, details={**DETAILS, "is_live": True, "duration": None}))
    with pytest.raises(LinkError, match="live stream"):
        links.fetch_audio(_video(), 60, work_dir=tmp_path)
    assert all("--load-info-json" not in c for c in calls)
    assert list(tmp_path.iterdir()) == []


def test_a_wholesome_video_and_a_store_link_are_untouched(monkeypatch):
    assert links._video_refusal(json.dumps(DETAILS)) is None
    assert links._video_refusal(json.dumps({**DETAILS, "live_status": "was_live"})) is None
    assert links._video_refusal("") is None and links._video_refusal("[]") is None
    assert links.cached_refusal("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT") is None


@pytest.mark.parametrize(
    ("seconds", "words"),
    [(7200, "2 hours"), (3600, "1 hour"), (9960, "2 h 46 min"), (2700, "45 min"), (30, "1 min")],
)
def test_lengths_read_as_people_say_them(seconds, words):
    assert links._clock(seconds) == words


# ── The routes ────────────────────────────────────────────────────────────────


@pytest.fixture
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    submitted: list = []

    class FakeQueue:
        def submit_link(self, url, **kwargs):
            submitted.append(url)
            return "job123"

    monkeypatch.setattr("app.api.routes._get_queue", lambda request: FakeQueue())
    with TestClient(app) as c:
        yield c, submitted


def test_the_resolve_route_names_the_reason_for_the_api(client, monkeypatch):
    c, _ = client

    def live(text):
        raise LinkError("That's a live stream. Paste a link to the recorded song instead.", "live")

    monkeypatch.setattr(links, "resolve_link", live)
    r = c.post("/v1/links/resolve", json={"url": YOUTUBE})
    assert r.status_code == 422
    assert r.json() == {"detail": {"message": "That's a live stream. Paste a link to the recorded song instead.",
                                   "code": "live"}}

    def long(text):
        raise LinkError("That video runs 3 hours. Links up to 2 hours are supported.", "too_long", limit_seconds=7200.0)

    monkeypatch.setattr(links, "resolve_link", long)
    assert c.post("/v1/links/resolve", json={"url": YOUTUBE}).json()["detail"] == {
        "message": "That video runs 3 hours. Links up to 2 hours are supported.", "code": "too_long", "limit_seconds": 7200.0}

    def plain(text):
        raise LinkError("That Spotify link does not point to a song.")

    monkeypatch.setattr(links, "resolve_link", plain)
    assert c.post("/v1/links/resolve", json={"url": YOUTUBE}).json() == {"detail": "That Spotify link does not point to a song."}


def test_a_submit_of_a_refused_link_is_answered_at_once(client, monkeypatch):
    c, submitted = client
    monkeypatch.setattr(links, "cached_refusal", lambda text: LinkError("That's a live stream.", "live"))
    r = c.post("/v1/transcribe/link", data={"url": YOUTUBE})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "live"
    assert submitted == []

    monkeypatch.setattr(links, "cached_refusal", lambda text: None)
    assert c.post("/v1/transcribe/link", data={"url": YOUTUBE}).status_code == 202
    assert submitted == [YOUTUBE]
