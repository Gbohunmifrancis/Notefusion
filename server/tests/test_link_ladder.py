"""The ladder a refused YouTube request climbs (``app.ingest.links``): default clients with
proof-of-origin tokens, the fallback clients, then the proxy when one is set; how yt-dlp's
refusals are read; the next search match for a store link; and the one log line per attempt.
No network: yt-dlp is faked as subprocess.run (see conftest)."""

import json
import logging
import shutil
from pathlib import Path

import pytest

from app.config import settings
from app.ingest import links
from app.ingest.links import LinkError, Source

pytestmark = pytest.mark.usefixtures("ytdlp_via_subprocess_run")

YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
PROXY = "http://user:secret@proxy.example:8000"
POT = "http://bgutil-provider:4416"
BOT = "ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you're not a bot. Use --cookies-from-browser"
FORBIDDEN = "ERROR: unable to download video data: HTTP Error 403: Forbidden"
DETAILS = {"id": "dQw4w9WgXcQ", "duration": 213, "title": "Rick Astley - Never Gonna Give You Up",
           "uploader": "Rick Astley"}
OEMBED = {"title": "Rick Astley - Never Gonna Give You Up", "author_name": "Rick Astley"}


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    links._cache.clear()
    monkeypatch.delenv("NF_YTDLP_COOKIES_FILE", raising=False)
    monkeypatch.delenv("NF_YTDLP_EXTRA_ARGS", raising=False)
    monkeypatch.setattr(settings, "ytdlp_fallback_clients", "mweb,android_vr,web_embedded")
    monkeypatch.setattr(settings, "ytdlp_proxy", "")
    monkeypatch.setattr(settings, "ytdlp_pot_url", "")
    monkeypatch.setattr(settings, "link_max_video_seconds", 7200.0)
    yield
    links._cache.clear()


class _Completed:
    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = ""):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr


def _rung(args: list[str]) -> str:
    if "--proxy" in args:
        return "proxy"
    if any(a.startswith("youtube:player_client=") for a in args):
        return "clients"
    return "direct"


def _youtube(calls, *, refuse_reads=(), refuse_media=(), search="", gone_ids=(), details=None):
    """subprocess.run as yt-dlp, ffmpeg and ffprobe.  ``refuse_reads`` / ``refuse_media`` name
    the rungs whose ``-J`` reads / downloads YouTube turns away with the bot check / a 403;
    ``gone_ids`` are search hits that are private."""
    details = DETAILS if details is None else details

    def run(args, **kwargs):
        calls.append(list(args))
        if args[0] == "ffmpeg":
            Path(args[-1]).write_bytes(b"RIFF")
            return _Completed()
        if args[0] == "ffprobe":
            return _Completed(0, "22.0\n")
        if "--flat-playlist" in args:
            if _rung(args) in refuse_reads:
                return _Completed(1, "", BOT)
            return _Completed(0, search)
        if "-J" in args:
            if _rung(args) in refuse_reads:
                return _Completed(1, "", BOT)
            if any(video_id in args[-1] for video_id in gone_ids):
                return _Completed(1, "", "ERROR: [youtube] x: Private video. Sign in if you've been granted access")
            return _Completed(0, json.dumps(details))
        if _rung(args) in refuse_media:
            return _Completed(1, "", FORBIDDEN)
        Path(args[args.index("-o") + 1].replace("%(ext)s", "m4a")).write_bytes(b"m4a")
        return _Completed()

    return run


def _ytdlp(calls):
    return [c for c in calls if c[0] == "yt-dlp"]


def _video() -> Source:
    return Source("youtube", YOUTUBE, "Never Gonna Give You Up", "Rick Astley", audio_url=YOUTUBE)


def _fetch(source: Source, tmp_path: Path):
    fetched = links.fetch_audio(source, 60, work_dir=tmp_path)
    assert fetched.path.is_file()
    return fetched


# ── Reading yt-dlp's refusals ─────────────────────────────────────────────────


@pytest.mark.parametrize(("stderr", "kind"), [
    (BOT, "blocked"),
    ("ERROR: [youtube] x: Video unavailable. This content isn't available, try again later. "
     "The current session has been rate-limited by YouTube for up to an hour.", "blocked"),
    (FORBIDDEN, "blocked"),
    ("ERROR: [youtube] x: Requested format is not available", "blocked"),
    ("ERROR: [youtube] x: Sign in to confirm your age. This video may be inappropriate for some users.",
     "age_restricted"),
    ("ERROR: [youtube] x: Private video. Sign in if you've been granted access to this video", "unavailable"),
    ("ERROR: [youtube] x: Video unavailable. This video has been removed by the uploader", "unavailable"),
    ("ERROR: [youtube] x: The uploader has not made this video available in your country", "unavailable"),
    ("ERROR: something nobody has seen before", "other"),
    # A warning does not decide it: the ERROR line does.
    ("WARNING: [youtube] x: Some formats are unavailable\nERROR: [youtube] x: Sign in to confirm you’re not a bot",
     "blocked"),
])
def test_yt_dlps_refusals_are_told_apart(stderr, kind):
    assert links.classify(stderr) == kind


def test_the_rate_limit_is_a_refusal_in_the_users_words_not_a_missing_video():
    stderr = "ERROR: [youtube] x: Video unavailable. This content isn't available, try again later."
    assert "refusing" in links._explain(stderr)
    assert "private" not in links._explain(stderr)


# ── The ladder ────────────────────────────────────────────────────────────────


def test_a_bot_check_climbs_to_the_fallback_clients_and_stops_there(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(settings, "ytdlp_proxy", PROXY)
    monkeypatch.setattr(links.subprocess, "run", _youtube(calls, refuse_reads=("direct",)))
    _fetch(_video(), tmp_path)
    reads = [c for c in _ytdlp(calls) if "-J" in c]
    assert [_rung(c) for c in reads] == ["direct", "clients"]
    assert reads[1][reads[1].index("--extractor-args") + 1] == "youtube:player_client=mweb,android_vr,web_embedded"
    # The download goes the way the details were read, and never through the proxy.
    download = [c for c in _ytdlp(calls) if "--load-info-json" in c]
    assert [_rung(c) for c in download] == ["clients"]
    assert not any("--proxy" in c for c in calls)


def test_the_proxy_is_the_last_rung_and_the_download_goes_through_it_too(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(settings, "ytdlp_proxy", PROXY)
    monkeypatch.setattr(links.subprocess, "run", _youtube(calls, refuse_reads=("direct", "clients")))
    _fetch(_video(), tmp_path)
    assert [_rung(c) for c in _ytdlp(calls)] == ["direct", "clients", "proxy", "proxy"]
    proxied = _ytdlp(calls)[-1]
    assert proxied[proxied.index("--proxy") + 1] == PROXY


def test_without_a_proxy_the_ladder_has_two_rungs(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(links, "_itunes_preview", lambda source: None)
    monkeypatch.setattr(links.subprocess, "run", _youtube(calls, refuse_reads=("direct", "clients", "proxy")))
    with pytest.raises(LinkError, match="refusing automated downloads"):
        links.fetch_audio(_video(), 60, work_dir=tmp_path)
    assert [_rung(c) for c in _ytdlp(calls)] == ["direct", "clients"]
    assert not any("--proxy" in c for c in calls)


def test_a_video_that_is_gone_is_not_asked_again_on_any_rung(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(settings, "ytdlp_proxy", PROXY)
    monkeypatch.setattr(links.subprocess, "run", _youtube(calls, gone_ids=("dQw4w9WgXcQ",)))
    with pytest.raises(LinkError, match="private or unavailable"):
        links.fetch_audio(_video(), 60, work_dir=tmp_path)
    assert len(_ytdlp(calls)) == 1


def test_a_refused_download_reads_the_details_again_on_each_rung_up_to_the_proxy(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(settings, "ytdlp_proxy", PROXY)
    monkeypatch.setattr(links.subprocess, "run", _youtube(calls, refuse_media=("direct", "clients")))
    _fetch(_video(), tmp_path)
    shape = [(_rung(c), "-J" in c) for c in _ytdlp(calls)]
    assert shape == [("direct", True), ("direct", False), ("clients", True), ("clients", False),
                     ("proxy", True), ("proxy", False)]


def test_the_resolve_remembers_the_rung_and_the_job_downloads_on_it(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(settings, "ytdlp_proxy", PROXY)
    monkeypatch.setattr(links, "_http_json", lambda url: OEMBED)
    monkeypatch.setattr(links.subprocess, "run", _youtube(calls, refuse_reads=("direct", "clients")))
    source = links.resolve_link(YOUTUBE)
    assert source.duration == 213.0
    calls.clear()
    _fetch(source, tmp_path)
    # No read again: the details the proxy read, downloaded through the proxy (their media
    # addresses are bound to the address that asked).
    assert [(_rung(c), "-J" in c) for c in _ytdlp(calls)] == [("proxy", False)]


def test_the_proxy_never_carries_the_stores_metadata(monkeypatch):
    """Only yt-dlp is proxied: Spotify's oEmbed and page go out directly, through urllib."""
    monkeypatch.setattr(settings, "ytdlp_proxy", PROXY)
    opened = []

    class _Response:
        def __init__(self, body: bytes):
            self.body = body

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self, *a):
            return self.body

    def urlopen(request, timeout=None):
        opened.append(request)
        if "oembed" in request.full_url:
            return _Response(b'{"title": "Never Gonna Give You Up"}')
        return _Response(b"<html></html>")

    monkeypatch.setattr(links.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(links.subprocess, "run", lambda *a, **k: pytest.fail("no yt-dlp for a store resolve"))
    source = links.resolve_link("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT")
    assert source.title == "Never Gonna Give You Up"
    assert opened and all(not r.has_header("Proxy-authorization") for r in opened)
    assert all(not getattr(r, "_tunnel_host", None) for r in opened)


def test_proof_of_origin_tokens_are_asked_for_once(monkeypatch):
    monkeypatch.setattr(settings, "ytdlp_pot_url", POT)
    with links._ytdlp_args() as args:
        assert args[-2:] == ["--extractor-args", f"youtubepot-bgutilhttp:base_url={POT}"]
    # An older .env that still carries the tokens in the extra arguments gets them once.
    monkeypatch.setenv("NF_YTDLP_EXTRA_ARGS", f'--extractor-args "youtubepot-bgutilhttp:base_url={POT}"')
    with links._ytdlp_args() as args:
        assert sum("youtubepot-bgutilhttp" in a for a in args) == 1
    monkeypatch.setattr(settings, "ytdlp_pot_url", "")
    monkeypatch.delenv("NF_YTDLP_EXTRA_ARGS")
    with links._ytdlp_args() as args:
        assert not any("youtubepot" in a for a in args)


# ── Store links: the next search match ────────────────────────────────────────


def _song() -> Source:
    return Source("spotify", "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT", "Never Gonna Give You Up",
                  "Rick Astley", duration=213.0)


SEARCH = "\n".join([
    "AAAAAAAAAAA\t213\tRick Astley - Topic\tNever Gonna Give You Up",
    "BBBBBBBBBBB\t214\tRick Astley\tNever Gonna Give You Up (Official Audio)",
    "CCCCCCCCCCC\t40\tSomeone\tNever Gonna Give You Up (cover)",
])


def test_a_store_song_tries_the_next_match_when_the_first_is_gone(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _youtube(calls, search=SEARCH, gone_ids=("AAAAAAAAAAA",)))
    _fetch(_song(), tmp_path)
    reads = [c[-1] for c in _ytdlp(calls) if "-J" in c]
    assert reads == ["https://www.youtube.com/watch?v=AAAAAAAAAAA", "https://www.youtube.com/watch?v=BBBBBBBBBBB"]


def test_only_clean_uploads_of_the_right_length_are_runners_up():
    assert links._rank_results(SEARCH.splitlines(), _song()) == ["AAAAAAAAAAA", "BBBBBBBBBBB"]
    covers = "CCCCCCCCCCC\t40\tSomeone\tNever Gonna Give You Up (cover)"
    assert links._rank_results([covers], _song()) == []  # no cover is taken for the song


def test_a_later_match_starts_on_the_rung_the_refusals_reached(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(settings, "ytdlp_proxy", PROXY)
    monkeypatch.setattr(links, "_itunes_preview", lambda source: None)
    monkeypatch.setattr(links.subprocess, "run", _youtube(calls, search=SEARCH, refuse_reads=("direct", "clients"),
                                                          refuse_media=("proxy",)))
    with pytest.raises(LinkError):
        links.fetch_audio(_song(), 60, work_dir=tmp_path)
    # Search: direct, clients, proxy. Match 1: read + download through the proxy. Match 2: the same,
    # without asking the refusing rungs again.
    rungs = [_rung(c) for c in _ytdlp(calls)]
    assert rungs == ["direct", "clients", "proxy", "proxy", "proxy", "proxy", "proxy"]


# ── Observability ─────────────────────────────────────────────────────────────


def _attempt_lines(caplog) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.getMessage().startswith("link_attempt")]


def test_every_fetch_is_one_line_with_its_outcome_and_no_address(monkeypatch, tmp_path, caplog):
    monkeypatch.setattr(settings, "ytdlp_proxy", PROXY)
    monkeypatch.setattr(links, "_itunes_preview", lambda source: None)
    links._totals.clear()
    with caplog.at_level(logging.INFO, logger="app.ingest.links"):
        monkeypatch.setattr(links.subprocess, "run", _youtube([], refuse_reads=("direct",)))
        _fetch(_video(), tmp_path)
        monkeypatch.setattr(links.subprocess, "run", _youtube([], refuse_reads=("direct", "clients", "proxy")))
        with pytest.raises(LinkError):
            links.fetch_audio(_video(), 60, work_dir=tmp_path)
        monkeypatch.setattr(links.subprocess, "run", _youtube([], gone_ids=("dQw4w9WgXcQ",)))
        with pytest.raises(LinkError):
            links.fetch_audio(_video(), 60, work_dir=tmp_path)
    lines = _attempt_lines(caplog)
    assert len(lines) == 3
    assert "outcome=success route=clients ytdlp_calls=3" in lines[0]
    assert "outcome=blocked route=proxy" in lines[1]
    assert "outcome=unavailable" in lines[2]
    assert lines[2].endswith("totals=success:1,blocked:1,unavailable:1,other:0 block_rate=33%")
    assert links.link_totals()["fetch"] == {"success": 1, "blocked": 1, "unavailable": 1, "other": 0}
    everything = " ".join(r.getMessage() for r in caplog.records)
    assert "dQw4w9WgXcQ" not in " ".join(lines) and "secret" not in everything


def test_a_preview_standing_in_is_counted_as_blocked(monkeypatch, tmp_path, caplog):
    def preview(url, work):
        path = work / "preview.audio"
        path.write_bytes(b"mp3")
        return path

    monkeypatch.setattr(links, "_download_preview", preview)
    monkeypatch.setattr(links.subprocess, "run", _youtube([], refuse_reads=("direct", "clients")))
    song = Source("spotify", "https://open.spotify.com/track/x", "T", "A", audio_url=YOUTUBE,
                  preview_url="https://p.scdn.co/mp3-preview/x")
    with caplog.at_level(logging.INFO, logger="app.ingest.links"):
        fetched = links.fetch_audio(song, 60, work_dir=tmp_path)
    assert fetched.preview
    assert "outcome=blocked" in _attempt_lines(caplog)[-1] and "preview=yes" in _attempt_lines(caplog)[-1]


def test_a_resolve_that_asks_youtube_is_one_line_too(monkeypatch, caplog):
    monkeypatch.setattr(links, "_http_json", lambda url: OEMBED)
    monkeypatch.setattr(links.subprocess, "run", _youtube([], refuse_reads=("direct", "clients")))
    with caplog.at_level(logging.INFO, logger="app.ingest.links"):
        assert links.resolve_link(YOUTUBE).duration is None
    lines = _attempt_lines(caplog)
    assert len(lines) == 1 and "stage=resolve" in lines[0] and "outcome=blocked" in lines[0]


def test_rejected_cookies_are_said_plainly_and_not_on_every_call(monkeypatch, tmp_path, caplog):
    cookies = tmp_path / "cookies.txt"
    cookies.write_text("# Netscape HTTP Cookie File\n")
    monkeypatch.setenv("NF_YTDLP_COOKIES_FILE", str(cookies))
    monkeypatch.setattr(links, "_cookie_warned_at", [])
    rotated = ("WARNING: [youtube] The provided YouTube account cookies are no longer valid. They have likely "
               "been rotated in the browser as a security measure.")

    def run(args, **kwargs):
        if args[0] == "ffmpeg":
            Path(args[-1]).write_bytes(b"RIFF")
            return _Completed()
        if "-J" in args:
            return _Completed(0, json.dumps(DETAILS), rotated)
        Path(args[args.index("-o") + 1].replace("%(ext)s", "m4a")).write_bytes(b"m4a")
        return _Completed(0, "", rotated)

    monkeypatch.setattr(links.subprocess, "run", run)
    with caplog.at_level(logging.WARNING, logger="app.ingest.links"):
        _fetch(_video(), tmp_path)
    warnings = [r.getMessage() for r in caplog.records if "ytdlp_cookies_rejected" in r.getMessage()]
    assert len(warnings) == 1 and "no longer valid" in warnings[0] and "YTDLP_COOKIES" in warnings[0]


def test_no_cookie_warning_without_cookies(monkeypatch, tmp_path, caplog):
    monkeypatch.setattr(links, "_cookie_warned_at", [])
    monkeypatch.setattr(links, "_itunes_preview", lambda source: None)
    monkeypatch.setattr(links.subprocess, "run", _youtube([], refuse_reads=("direct", "clients")))
    with caplog.at_level(logging.WARNING, logger="app.ingest.links"), pytest.raises(LinkError):
        links.fetch_audio(_video(), 60, work_dir=tmp_path)
    assert not any("ytdlp_cookies_rejected" in r.getMessage() for r in caplog.records)


def test_the_log_masks_a_proxys_password():
    tail = links._log_tail("ERROR: Unable to connect to proxy http://user:secret@proxy.example:8000")
    assert "secret" not in tail and "http://***@proxy.example:8000" in tail


@pytest.fixture(autouse=True)
def _no_leftovers(tmp_path):
    yield
    shutil.rmtree(tmp_path, ignore_errors=True)
