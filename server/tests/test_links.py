"""Linked-song ingest: URL parsing, metadata shaping, the link job and its route."""

import shutil
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.ingest import links
from app.ingest.links import FetchedAudio, LinkError, Source
from app.jobs import queue as queue_mod
from app.jobs.queue import PRIORITY_HIGH, PRIORITY_NORMAL, STATUS_DONE, STATUS_FAILED, JobQueue


# yt-dlp is faked as subprocess.run here (see conftest).
pytestmark = pytest.mark.usefixtures("ytdlp_via_subprocess_run")


@pytest.fixture(autouse=True)
def _fresh_cache():
    """Resolved links are remembered for ten minutes; one test's link must not answer another's."""
    links._cache.clear()
    yield
    links._cache.clear()


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


SPOTIFY_ID = "4cOdK2wGLETKBW3PvgPWqT"


@pytest.mark.parametrize(
    ("text", "url", "provider"),
    [
        # YouTube, every subdomain and path shape, share-sheet tails and sentence punctuation.
        ("https://youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/watch?v=dQw4w9WgXcQ", "youtube"),
        ("https://youtube.com/shorts/dQw4w9WgXcQ?si=x", "https://youtube.com/shorts/dQw4w9WgXcQ?si=x", "youtube"),
        ("https://www.youtube.com/live/dQw4w9WgXcQ", "https://www.youtube.com/live/dQw4w9WgXcQ", "youtube"),
        ("https://www.youtube.com/embed/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ", "youtube"),
        ("https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=a", "https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=a", "youtube"),
        ("https://youtu.be/1k8craCGpgs?si=Xy12AbCdEfGhIjKl", "https://youtu.be/1k8craCGpgs?si=Xy12AbCdEfGhIjKl", "youtube"),
        ("Check this out https://youtu.be/dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ", "youtube"),
        ("Sing this: https://youtu.be/dQw4w9WgXcQ.", "https://youtu.be/dQw4w9WgXcQ", "youtube"),
        ("(https://www.youtube.com/watch?v=dQw4w9WgXcQ)!", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"),
        # Spotify: tracks, regional paths, share text, short links.
        (f"https://open.spotify.com/track/{SPOTIFY_ID}?si=abc", f"https://open.spotify.com/track/{SPOTIFY_ID}?si=abc", "spotify"),
        (f"https://open.spotify.com/intl-fr/track/{SPOTIFY_ID}", f"https://open.spotify.com/intl-fr/track/{SPOTIFY_ID}", "spotify"),
        (f"Listen to Never Gonna Give You Up on Spotify: https://open.spotify.com/track/{SPOTIFY_ID}?si=1f2e",
         f"https://open.spotify.com/track/{SPOTIFY_ID}?si=1f2e", "spotify"),
        ("https://spotify.link/qKr2CFxMQwb", "https://spotify.link/qKr2CFxMQwb", "spotify"),
        ("https://spotify.app.link/AbCdEfGhIjK?_p=1", "https://spotify.app.link/AbCdEfGhIjK?_p=1", "spotify"),
        # Apple Music: album links with i= anywhere in the query, song links, geo links.
        ("https://music.apple.com/us/album/song-name/123?i=456", "https://music.apple.com/us/album/song-name/123?i=456", "apple_music"),
        ("https://music.apple.com/ng/album/x/123?ls=1&i=456", "https://music.apple.com/ng/album/x/123?ls=1&i=456", "apple_music"),
        ("https://music.apple.com/ng/song/amazing-grace/1440856203", "https://music.apple.com/ng/song/amazing-grace/1440856203", "apple_music"),
        ("https://music.apple.com/us/song/1440856203", "https://music.apple.com/us/song/1440856203", "apple_music"),
        ("https://geo.music.apple.com/us/album/_/1559885421?i=1559885426&mt=1",
         "https://geo.music.apple.com/us/album/_/1559885421?i=1559885426&mt=1", "apple_music"),
        # Not a song: channels, playlists, albums without a track, other sites, no link at all.
        ("https://www.youtube.com/@RickAstleyYT", "https://www.youtube.com/@RickAstleyYT", None),
        ("https://www.youtube.com/playlist?list=PL123", "https://www.youtube.com/playlist?list=PL123", None),
        ("https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw", "https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw", None),
        ("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", None),
        ("https://open.spotify.com/album/5Z9iiGl2FcIfa3BMiv6OIw", "https://open.spotify.com/album/5Z9iiGl2FcIfa3BMiv6OIw", None),
        ("https://music.apple.com/us/album/some-album/123", "https://music.apple.com/us/album/some-album/123", None),
        ("https://example.com/watch?v=dQw4w9WgXcQ", "https://example.com/watch?v=dQw4w9WgXcQ", None),
        ("no link here", None, None),
    ],
)
def test_extract_url_and_provider_of_follow_the_shared_link_rule(text, url, provider):
    assert links.extract_url(text) == url
    assert links.provider_of(text) == provider


def test_youtube_video_id_tolerates_a_trailing_full_stop():
    assert links.youtube_video_id("https://youtu.be/dQw4w9WgXcQ.") == "dQw4w9WgXcQ"


def test_apple_track_id_reads_i_or_the_song_id():
    assert links.apple_track_id("https://music.apple.com/ng/album/x/123?ls=1&i=456") == "456"
    assert links.apple_track_id("https://music.apple.com/ng/song/amazing-grace/1440856203") == "1440856203"
    assert links.apple_track_id("https://music.apple.com/ng/album/x/123") is None


def test_clean_unescapes_entities_and_non_breaking_spaces():
    assert links._clean("Simon &amp; Garfunkel\xa0on\xa0Apple\xa0Music ") == "Simon & Garfunkel on Apple Music"
    assert links._clean("Don&#39;t Stop") == "Don't Stop"


def test_apple_page_fallback_strips_the_non_breaking_suffix(monkeypatch):
    page = ('<meta property="og:title" content="Never Gonna Give You Up by Rick Astley on Apple\xa0Music">'
            '<meta property="og:image" content="https://is1-ssl.mzstatic.com/a.jpg">')

    def lookup_down(url):
        raise OSError("iTunes is down")

    monkeypatch.setattr(links, "_http_json", lookup_down)
    monkeypatch.setattr(links, "_http_text", lambda url: page)
    source = links.resolve_source("https://music.apple.com/us/album/x/1559885421?i=1559885426")
    assert (source.title, source.artist) == ("Never Gonna Give You Up", "Rick Astley")
    assert source.thumbnail_url == "https://is1-ssl.mzstatic.com/a.jpg"


def test_apple_metadata_comes_from_the_itunes_lookup(monkeypatch):
    asked = []

    def lookup(url):
        asked.append(url)
        return {"results": [
            {"wrapperType": "collection", "collectionId": 1559885421},
            {"wrapperType": "track", "trackId": 1559885426, "trackName": "Don&#39;t Say Goodbye",
             "artistName": "Rick Astley", "trackTimeMillis": 249240,
             "previewUrl": "https://audio-ssl.itunes.apple.com/p.m4a",
             "artworkUrl100": "https://is1-ssl.mzstatic.com/x/100x100bb.jpg"},
        ]}

    monkeypatch.setattr(links, "_http_json", lookup)
    source = links.resolve_source("Hear it: https://music.apple.com/ng/album/x/1559885421?i=1559885426")
    assert "id=1559885426" in asked[0] and "country=ng" in asked[0]
    assert (source.title, source.artist, source.duration) == ("Don't Say Goodbye", "Rick Astley", 249.2)
    assert source.preview_url == "https://audio-ssl.itunes.apple.com/p.m4a"
    assert source.thumbnail_url == "https://is1-ssl.mzstatic.com/x/600x600bb.jpg"


SPOTIFY_PAGE = (
    '<meta property="og:title" content="Never Gonna Give You Up"/>'
    '<meta property="og:description" content="Rick Astley &amp; Friends · Whenever You Need Somebody · Song · 1987"/>'
    '<meta property="og:audio" content="https://p.scdn.co/mp3-preview/abc"/>'
    '<meta property="og:audio:type" content="audio/mpeg"/>'
    '<meta name="music:duration" content="214"/>'
)


def test_spotify_reads_artist_length_and_preview_from_the_page(monkeypatch):
    monkeypatch.setattr(links, "_http_json", lambda url: {"title": "Never Gonna Give You Up", "thumbnail_url": "t"})
    monkeypatch.setattr(links, "_http_text", lambda url: SPOTIFY_PAGE)
    source = links.resolve_source(f"https://open.spotify.com/intl-fr/track/{SPOTIFY_ID}?si=x")
    assert source.url == f"https://open.spotify.com/track/{SPOTIFY_ID}"
    assert source.artist == "Rick Astley & Friends"
    assert source.duration == 214.0
    assert source.preview_url == "https://p.scdn.co/mp3-preview/abc"


@pytest.mark.parametrize(
    ("final_url", "page"),
    [
        (f"https://open.spotify.com/track/{SPOTIFY_ID}?si=1", ""),
        ("https://spotify.app.link/x?_p=1",
         f'<html><a href="https://open.spotify.com/track/{SPOTIFY_ID}?si=1&amp;x=2">Open</a></html>'),
    ],
)
def test_spotify_short_link_is_expanded_from_the_redirect_or_the_page(monkeypatch, final_url, page):
    followed = []

    def follow(url):
        followed.append(url)
        return final_url, page

    monkeypatch.setattr(links, "_follow_short_link", follow)
    oembed = []
    monkeypatch.setattr(links, "_http_json", lambda url: oembed.append(url) or {"title": "Never Gonna Give You Up"})
    monkeypatch.setattr(links, "_http_text", lambda url: SPOTIFY_PAGE)
    source = links.resolve_source("https://spotify.link/qKr2CFxMQwb")
    assert followed == ["https://spotify.link/qKr2CFxMQwb"]
    assert source.url == f"https://open.spotify.com/track/{SPOTIFY_ID}"
    assert SPOTIFY_ID in oembed[0]


@pytest.mark.parametrize(
    ("final_url", "page"),
    [
        ("https://spotify.app.link/x", "<html></html>"),
        # An expired code lands on the home page, whose featured songs are not the one shared.
        ("https://open.spotify.com/", f'<a href="https://open.spotify.com/track/{SPOTIFY_ID}">'),
    ],
)
def test_spotify_short_link_to_something_else_is_a_plain_error(monkeypatch, final_url, page):
    monkeypatch.setattr(links, "_follow_short_link", lambda url: (final_url, page))
    with pytest.raises(LinkError, match="does not point to a song"):
        links.resolve_source("https://spotify.link/qKr2CFxMQwb")


def test_short_link_redirects_stay_on_spotify_hosts():
    import urllib.request

    handler = links._SpotifyRedirects()
    req = urllib.request.Request("https://spotify.link/abc")
    assert handler.redirect_request(req, None, 302, "Found", {}, "http://169.254.169.254/latest") is None
    assert handler.redirect_request(req, None, 302, "Found", {}, "https://spotify.app.link/abc") is not None
    with pytest.raises(links._ShortLinkResolved):
        handler.redirect_request(req, None, 302, "Found", {}, f"https://open.spotify.com/track/{SPOTIFY_ID}")


# ── yt-dlp ────────────────────────────────────────────────────────────────────


class _Completed:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr


def test_cookies_are_copied_and_the_original_is_never_written(monkeypatch, tmp_path):
    original = tmp_path / "cookies.txt"
    original.write_text("# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n")
    original.chmod(0o444)  # the deploy mounts it read-only
    before = original.read_bytes()
    monkeypatch.setenv("NF_YTDLP_COOKIES_FILE", str(original))
    monkeypatch.setenv("NF_YTDLP_EXTRA_ARGS", '--extractor-args "youtubepot-bgutilhttp:base_url=http://bgutil-provider:4416"')
    passed = []

    with links._ytdlp_args() as args:
        cookies = args[args.index("--cookies") + 1]
        passed.append(cookies)
        assert cookies != str(original)
        Path(cookies).write_text("rewritten by yt-dlp on exit")  # what yt-dlp does
        assert args[-2:] == ["--extractor-args", "youtubepot-bgutilhttp:base_url=http://bgutil-provider:4416"]
    assert original.read_bytes() == before
    assert not Path(passed[0]).exists()  # the copy goes with the job


def test_no_cookies_flag_without_a_cookies_file(monkeypatch):
    monkeypatch.setenv("NF_YTDLP_COOKIES_FILE", "/dev/null")  # what compose mounts with no secret
    monkeypatch.delenv("NF_YTDLP_EXTRA_ARGS", raising=False)
    with links._ytdlp_args() as args:
        assert "--cookies" not in args


def _song(**kwargs) -> Source:
    base = dict(provider="spotify", url=f"https://open.spotify.com/track/{SPOTIFY_ID}",
                title="Never Gonna Give You Up", artist="Rick Astley", duration=214.0)
    base.update(kwargs)
    return Source(**base)


def test_search_choice_matches_length_and_skips_covers():
    lines = [
        "q9si9jcjZUY\t33\tLachlan Sings\tNever Gonna Give You Up (cover)",
        "AAAAAAAAAAA\t214\tKaraoke Hits\tNever Gonna Give You Up - Karaoke",
        "BBBBBBBBBBB\t3600\tLoops\tNever Gonna Give You Up 1 hour",
        "dQw4w9WgXcQ\t213\tRick Astley\tRick Astley - Never Gonna Give You Up (Official Video)",
        "CCCCCCCCCCC\t214\tRick Astley - Topic\tNever Gonna Give You Up",
    ]
    assert links._choose_result(lines, _song()) == "CCCCCCCCCCC"  # the label's own upload
    assert links._choose_result(lines[:4], _song()) == "dQw4w9WgXcQ"  # length agrees, not a cover
    assert links._choose_result(lines[:3], _song()) == "AAAAAAAAAAA"  # nothing else: a cover beats nothing
    # Without a known length the first clean upload wins.
    assert links._choose_result(lines[:4], _song(duration=None)) == "dQw4w9WgXcQ"
    # "Live" in the song's own name is not a live take.
    live_song = _song(title="Live Like You Were Dying", artist="Tim McGraw", duration=300.0)
    assert links._choose_result(["DDDDDDDDDDD\t301\tTim McGraw - Topic\tLive Like You Were Dying"], live_song) == "DDDDDDDDDDD"


def _fake_ytdlp(calls, *, search="", info_duration=214, fail_on=None, stderr="", probe_seconds=22.0):
    """A stand-in for subprocess.run that answers like yt-dlp, ffmpeg and ffprobe would."""

    def run(args, **kwargs):
        calls.append(list(args))
        if args[0] == "ffmpeg":
            Path(args[-1]).write_bytes(b"RIFF")
            return _Completed()
        if args[0] == "ffprobe":
            return _Completed(0, f"{probe_seconds}\n")
        if fail_on and fail_on in args:
            return _Completed(1, "", stderr)
        if "--flat-playlist" in args:
            return _Completed(0, search)
        if "-J" in args:
            return _Completed(0, '{"id": "dQw4w9WgXcQ", "duration": %d}' % info_duration)
        out = Path(args[args.index("-o") + 1].replace("%(ext)s", "m4a"))
        out.write_bytes(b"m4a")
        return _Completed()

    return run


def test_a_linked_youtube_video_costs_one_extraction(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _fake_ytdlp(calls, info_duration=400))
    monkeypatch.delenv("NF_YTDLP_COOKIES_FILE", raising=False)
    source = Source("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "T", "A",
                    audio_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    fetched = links.fetch_audio(source, 60, work_dir=tmp_path)
    assert fetched.preview is False and fetched.song_seconds == 400
    assert fetched.path.name == "song.wav"
    ytdlp = [c for c in calls if c[0] == "yt-dlp"]
    assert len(ytdlp) == 2 and "-J" in ytdlp[0] and "--load-info-json" in ytdlp[1]
    assert "--download-sections" in ytdlp[1]  # a long video is fetched only as far as needed
    assert fetched.truncated is True and fetched.start_seconds is None and fetched.end_seconds is None
    assert not any(p.name.startswith(("audio.", "info.")) for p in fetched.path.parent.iterdir())


YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def _video(**kwargs) -> Source:
    base = dict(provider="youtube", url=YOUTUBE, title="T", artist="A", audio_url=YOUTUBE)
    base.update(kwargs)
    return Source(**base)


def _ytdlp_calls(calls):
    return [c for c in calls if c[0] == "yt-dlp"]


def _ffmpeg_call(calls):
    return next(c for c in calls if c[0] == "ffmpeg")


def test_a_chosen_section_is_downloaded_on_its_own_and_cut_exactly(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _fake_ytdlp(calls, info_duration=213))
    monkeypatch.delenv("NF_YTDLP_COOKIES_FILE", raising=False)
    fetched = links.fetch_audio(_video(), 360, work_dir=tmp_path, start_seconds=60, end_seconds=80)
    download = _ytdlp_calls(calls)[1]
    assert download[download.index("--download-sections") + 1] == "*60.00-82.00"
    # A copy, not a re-encode: the flag cost six seconds a section and a second lossy pass.
    assert "--force-keyframes-at-cuts" not in download
    ffmpeg = _ffmpeg_call(calls)
    assert ffmpeg[ffmpeg.index("-t") + 1] == "20.00"
    assert "-ss" not in ffmpeg  # the download already begins at 60 s
    assert (fetched.start_seconds, fetched.end_seconds) == (60.0, 80.0)
    assert fetched.song_seconds == 213 and fetched.truncated is False  # the whole song's length, not the section's


def test_a_section_longer_than_the_allowance_is_capped_and_marked(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _fake_ytdlp(calls, info_duration=213))
    fetched = links.fetch_audio(_video(), 60, work_dir=tmp_path, start_seconds=65, end_seconds=200)
    download = _ytdlp_calls(calls)[1]
    assert download[download.index("--download-sections") + 1] == "*65.00-127.00"
    assert _ffmpeg_call(calls)[_ffmpeg_call(calls).index("-t") + 1] == "60.00"
    assert (fetched.start_seconds, fetched.end_seconds, fetched.truncated) == (65.0, 125.0, True)


def test_a_section_past_the_end_is_clamped_or_refused(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _fake_ytdlp(calls, info_duration=213))
    fetched = links.fetch_audio(_video(), 360, work_dir=tmp_path, start_seconds=200, end_seconds=500)
    assert (fetched.start_seconds, fetched.end_seconds, fetched.truncated) == (200.0, 213.0, False)
    # Only the end was given: the section runs to the song's end, within the allowance.
    fetched = links.fetch_audio(_video(), 360, work_dir=tmp_path, end_seconds=30)
    assert (fetched.start_seconds, fetched.end_seconds) == (0.0, 30.0)
    before = set(tmp_path.iterdir())
    with pytest.raises(LinkError, match="starts after the song ends"):
        links.fetch_audio(_video(), 360, work_dir=tmp_path, start_seconds=213)
    assert set(tmp_path.iterdir()) == before  # nothing left behind by the refusal


def test_a_section_of_a_video_of_unknown_length_is_still_asked_for(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _fake_ytdlp(calls, info_duration=0))
    fetched = links.fetch_audio(_video(), 60, work_dir=tmp_path, start_seconds=30)
    download = _ytdlp_calls(calls)[1]
    assert download[download.index("--download-sections") + 1] == "*30.00-92.00"
    assert (fetched.start_seconds, fetched.end_seconds, fetched.truncated) == (30.0, 90.0, False)
    assert fetched.song_seconds == 0.0


def _tone_wav(path: Path, sr: int = 22_050) -> Path:
    """Ten seconds: 220 Hz for the first five, 440 Hz for the last five."""
    t = np.arange(5 * sr) / sr
    low = 0.3 * np.sin(2 * np.pi * 220 * t)
    high = 0.3 * np.sin(2 * np.pi * 440 * t)
    sf.write(str(path), np.concatenate([low, high]).astype(np.float32), sr)
    return path


def _dominant_hz(path: Path) -> float:
    y, sr = sf.read(str(path), always_2d=True)
    mono = y.mean(axis=1)
    spectrum = np.abs(np.fft.rfft(mono))
    return float(np.fft.rfftfreq(len(mono), 1 / sr)[spectrum.argmax()])


@pytest.mark.skipif(shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
                    reason="the cut is made by the real ffmpeg")
def test_a_whole_download_is_cut_from_the_start_of_the_section_by_ffmpeg(monkeypatch, tmp_path):
    """The safety net: yt-dlp hands back the whole song despite the section, and ffmpeg
    (the real one) cuts the chosen window out of it."""
    real_run = links.subprocess.run
    calls = []

    def run(args, **kwargs):
        calls.append(list(args))
        if args[0] in ("ffmpeg", "ffprobe"):
            return real_run(args, **kwargs)
        if "-J" in args:
            return _Completed(0, '{"id": "dQw4w9WgXcQ", "duration": 10}')
        _tone_wav(Path(args[args.index("-o") + 1].replace("%(ext)s", "wav")))  # the section ignored
        return _Completed()

    monkeypatch.setattr(links.subprocess, "run", run)
    fetched = links.fetch_audio(_video(), 60, work_dir=tmp_path, start_seconds=6, end_seconds=10)
    assert (fetched.start_seconds, fetched.end_seconds) == (6.0, 10.0)
    ffmpeg = _ffmpeg_call(calls)
    assert ffmpeg[ffmpeg.index("-ss") + 1] == "6.000"
    info = sf.info(str(fetched.path))
    assert info.samplerate == 44_100 and info.channels == 2
    assert abs(info.duration - 4.0) < 0.05
    assert abs(_dominant_hz(fetched.path) - 440) < 2  # the last four seconds, not the first


@pytest.mark.skipif(shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
                    reason="the cut is made by the real ffmpeg")
def test_a_download_that_honoured_the_section_is_not_cut_again(monkeypatch, tmp_path):
    real_run = links.subprocess.run
    calls = []

    def run(args, **kwargs):
        calls.append(list(args))
        if args[0] in ("ffmpeg", "ffprobe"):
            return real_run(args, **kwargs)
        if "-J" in args:
            return _Completed(0, '{"id": "dQw4w9WgXcQ", "duration": 400}')
        _tone_wav(Path(args[args.index("-o") + 1].replace("%(ext)s", "wav")))  # 10 s: the section, with its padding
        return _Completed()

    monkeypatch.setattr(links.subprocess, "run", run)
    fetched = links.fetch_audio(_video(), 60, work_dir=tmp_path, start_seconds=300, end_seconds=308)
    assert "-ss" not in _ffmpeg_call(calls)
    assert abs(sf.info(str(fetched.path)).duration - 8.0) < 0.05
    assert fetched.end_seconds == 308.0


def test_the_download_runs_from_the_details_the_resolve_already_read(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _fake_ytdlp(calls, info_duration=213))
    monkeypatch.setattr(links, "_http_json", lambda url: {"title": "Rick Astley - Never Gonna Give You Up",
                                                          "author_name": "Rick Astley", "thumbnail_url": "t"})
    monkeypatch.delenv("NF_YTDLP_COOKIES_FILE", raising=False)
    source = links.resolve_link("https://youtu.be/dQw4w9WgXcQ")
    assert source.duration == 213.0
    assert len(_ytdlp_calls(calls)) == 1 and "-J" in _ytdlp_calls(calls)[0]
    # The job: the same link resolves from memory and the download needs no second extraction.
    assert links.resolve_source("https://youtu.be/dQw4w9WgXcQ") is source
    fetched = links.fetch_audio(source, 60, work_dir=tmp_path, start_seconds=60, end_seconds=80)
    ytdlp = _ytdlp_calls(calls)
    assert len(ytdlp) == 2 and "--load-info-json" in ytdlp[1] and "-J" not in ytdlp[1]
    assert fetched.song_seconds == 213.0


def test_a_store_link_downloads_the_search_hit_that_fits(monkeypatch, tmp_path):
    calls = []
    search = "q9si9jcjZUY\t33\tLachlan Sings\tNever Gonna Give You Up (cover)\ndQw4w9WgXcQ\t214\tRick Astley\tNever Gonna Give You Up"
    monkeypatch.setattr(links.subprocess, "run", _fake_ytdlp(calls, search=search))
    fetched = links.fetch_audio(_song(), 360, work_dir=tmp_path)
    assert fetched.song_seconds == 214 and fetched.preview is False
    assert calls[0][-1] == 'ytsearch5:"Never Gonna Give You Up" "Rick Astley"'
    assert calls[1][-1] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


BOT = "ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you're not a bot. Use --cookies-from-browser"


def test_preview_stands_in_when_youtube_refuses(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _fake_ytdlp(calls, fail_on="--flat-playlist", stderr=BOT))
    fetched_urls = []

    def download(url, work):
        fetched_urls.append(url)
        (work / "preview.audio").write_bytes(b"mp3")
        return work / "preview.audio"

    monkeypatch.setattr(links, "_download_preview", download)
    fetched = links.fetch_audio(_song(preview_url="https://p.scdn.co/mp3-preview/abc"), 30, work_dir=tmp_path,
                                start_seconds=60, end_seconds=90)
    assert fetched.preview is True and fetched.song_seconds == 214.0 and fetched.truncated is True
    assert fetched.path.is_file()
    assert fetched_urls == ["https://p.scdn.co/mp3-preview/abc"]
    # A 30-second preview has no position in the song: the chosen section does not apply to it.
    assert fetched.start_seconds is None and fetched.end_seconds is None
    assert "-ss" not in _ffmpeg_call(calls)


def test_preview_is_found_on_itunes_by_title_artist_and_length(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(links, "_http_json", lambda url: {"results": [
        {"trackName": "Never Gonna Give You Up", "artistName": "Rick Astley", "trackTimeMillis": 180000,
         "previewUrl": "https://audio-ssl.itunes.apple.com/wrong-version.m4a"},
        {"trackName": "Never Gonna Give You Up", "artistName": "Rick Astley", "trackTimeMillis": 213500,
         "previewUrl": "https://audio-ssl.itunes.apple.com/right.m4a"},
    ]})
    fetched_urls = []

    def download(url, work):
        fetched_urls.append(url)
        (work / "p").write_bytes(b"x")
        return work / "p"

    monkeypatch.setattr(links, "_download_preview", download)
    search = "dQw4w9WgXcQ\t214\tRick Astley\tNever Gonna Give You Up"
    monkeypatch.setattr(links.subprocess, "run", _fake_ytdlp(calls, search=search, fail_on="-J", stderr=BOT))
    fetched = links.fetch_audio(_song(), 30, work_dir=tmp_path)
    assert fetched.preview is True and fetched.song_seconds == 214.0
    assert fetched_urls == ["https://audio-ssl.itunes.apple.com/right.m4a"]


def test_a_refused_youtube_link_takes_its_length_from_the_itunes_match(monkeypatch, tmp_path):
    monkeypatch.setattr(links.subprocess, "run", _fake_ytdlp([], fail_on="-J", stderr=BOT))
    monkeypatch.setattr(links, "_http_json", lambda url: {"results": [
        {"trackName": "Never Gonna Give You Up", "artistName": "Rick Astley", "trackTimeMillis": 213573,
         "previewUrl": "https://audio-ssl.itunes.apple.com/right.m4a"}]})

    def download(url, work):
        (work / "p").write_bytes(b"x")
        return work / "p"

    monkeypatch.setattr(links, "_download_preview", download)
    source = Source("youtube", "u", "Never Gonna Give You Up", "Rick Astley",
                    audio_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    fetched = links.fetch_audio(source, 30, work_dir=tmp_path)
    assert fetched.preview is True and fetched.song_seconds == 213.6


def test_a_missing_youtube_video_does_not_fall_back_to_a_preview(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _fake_ytdlp(calls, fail_on="-J", stderr="ERROR: Private video"))
    monkeypatch.setattr(links, "_itunes_preview", lambda source: pytest.fail("no preview for a private video"))
    source = Source("youtube", "u", "T", "A", audio_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    with pytest.raises(LinkError, match="private or unavailable"):
        links.fetch_audio(source, 30, work_dir=tmp_path)
    assert list(tmp_path.iterdir()) == []  # nothing left behind


def test_refusal_without_any_preview_is_a_plain_error(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _fake_ytdlp(calls, fail_on="--flat-playlist", stderr=BOT))
    monkeypatch.setattr(links, "_http_json", lambda url: {"results": []})
    with pytest.raises(LinkError) as caught:
        links.fetch_audio(_song(), 30, work_dir=tmp_path)
    message = str(caught.value)
    assert "upload the audio file" in message.lower() and "youtube" not in message.lower()


def test_preview_downloads_only_from_store_hosts(tmp_path):
    with pytest.raises(LinkError):
        links._download_preview("https://evil.example/p.mp3", tmp_path)
    with pytest.raises(LinkError):
        links._download_preview("http://p.scdn.co/mp3-preview/abc", tmp_path)


def test_split_title_reads_artist_dash_title_and_strips_noise():
    assert links._split_title("Sinach - Way Maker (Official Video)", "SinachVEVO") == ("Way Maker", "Sinach")
    assert links._split_title("Way Maker [Lyrics]", "Sinach - Topic") == ("Way Maker", "Sinach")
    assert links._split_title("Nara Ekele Mo", "Tim Godfrey") == ("Nara Ekele Mo", "Tim Godfrey")


def test_explain_maps_bot_refusal_to_an_upload_hint():
    message = links._explain("ERROR: [youtube] abc: Sign in to confirm you’re not a bot.")
    assert "upload" in message.lower()
    assert "private" in links._explain("ERROR: Private video").lower()
    # A Spotify or Apple user never pasted a video: the search hit's state is not theirs.
    assert "video" not in links._explain("ERROR: Video unavailable", "spotify").lower()
    assert "youtube" not in links._explain("ERROR: Sign in to confirm you're not a bot", "apple_music").lower()


def test_resolve_source_rejects_unknown_links():
    with pytest.raises(LinkError):
        links.resolve_source("https://example.com/song.mp3")


def _never_run(args, **kwargs):
    pytest.fail(f"yt-dlp was asked: {args}")


def test_resolve_link_takes_a_store_length_without_asking_youtube(monkeypatch):
    monkeypatch.setattr(links.subprocess, "run", _never_run)
    monkeypatch.setattr(links, "_http_json", lambda url: {"title": "Never Gonna Give You Up", "thumbnail_url": "t"})
    monkeypatch.setattr(links, "_http_text", lambda url: SPOTIFY_PAGE)
    spotify = links.resolve_link(f"https://open.spotify.com/track/{SPOTIFY_ID}")
    assert (spotify.provider, spotify.duration) == ("spotify", 214.0)

    monkeypatch.setattr(links, "_http_json", lambda url: {"results": [
        {"wrapperType": "track", "trackId": 1559885426, "trackName": "Don't Say Goodbye",
         "artistName": "Rick Astley", "trackTimeMillis": 249240}]})
    apple = links.resolve_link("https://music.apple.com/ng/album/x/1559885421?i=1559885426")
    assert (apple.provider, apple.duration) == ("apple_music", 249.2)


def test_resolve_link_reads_a_youtube_length_once_and_remembers_it(monkeypatch):
    calls = []
    asked = []
    monkeypatch.setattr(links.subprocess, "run", _fake_ytdlp(calls, info_duration=213))
    monkeypatch.setattr(links, "_http_json", lambda url: asked.append(url) or {
        "title": "Rick Astley - Never Gonna Give You Up (Official Video)", "author_name": "RickAstleyVEVO",
        "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"})
    monkeypatch.delenv("NF_YTDLP_COOKIES_FILE", raising=False)
    monkeypatch.delenv("NF_YTDLP_EXTRA_ARGS", raising=False)
    source = links.resolve_link("Watch: https://youtu.be/dQw4w9WgXcQ?si=abc")
    assert (source.title, source.artist, source.url) == ("Never Gonna Give You Up", "Rick Astley", YOUTUBE)
    assert source.duration == 213.0
    assert calls == [["yt-dlp", "--no-playlist", "--no-progress", "-q",
                      "-f", links._AUDIO_FORMAT, "-J", YOUTUBE]]
    # The same video under another address: nothing is asked again, of YouTube or oEmbed.
    assert links.resolve_link(YOUTUBE) is source
    assert links.resolve_link("https://youtu.be/dQw4w9WgXcQ?si=abc") is source
    assert len(calls) == 1 and len(asked) == 1


def test_resolve_link_still_answers_without_yt_dlp_on_the_machine(monkeypatch):
    def missing(args, **kwargs):
        raise FileNotFoundError(args[0])

    monkeypatch.setattr(links.subprocess, "run", missing)
    monkeypatch.setattr(links, "_http_json", lambda url: {"title": "T", "author_name": "A"})
    source = links.resolve_link(YOUTUBE)
    assert source.duration is None and source.title == "T"


def test_resolve_link_has_no_length_when_youtube_will_not_say(monkeypatch):
    calls = []
    monkeypatch.setattr(links.subprocess, "run", _fake_ytdlp(calls, fail_on="-J", stderr=BOT))
    monkeypatch.setattr(links, "_http_json", lambda url: {"title": "T", "author_name": "A"})
    source = links.resolve_link(YOUTUBE)
    assert source.duration is None and source.title == "T"
    assert links.resolve_link(YOUTUBE).duration is None
    # The refusal and its one second try (the fallback client); remembered after that, not
    # retried on every keystroke.
    assert len(calls) == 2


def test_a_resolved_link_is_forgotten_after_ten_minutes(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(links.time, "monotonic", lambda: now[0])
    answers = iter([{"title": "First", "author_name": "A"}, {"title": "Second", "author_name": "A"}])
    monkeypatch.setattr(links, "_http_json", lambda url: next(answers))
    assert links.resolve_source(YOUTUBE).title == "First"
    now[0] += links.RESOLVE_CACHE_SECONDS - 1
    assert links.resolve_source(YOUTUBE).title == "First"
    now[0] += 2
    assert links.resolve_source(YOUTUBE).title == "Second"
    assert [e.source.title for e in links._cache.values()] == ["Second"]  # the stale entry went with it


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
    # The general queue's ordering is what this test is about, so the Pro lane's own worker
    # is switched off here; with it on, the high job would not wait at all (see test_queue).
    queue = JobQueue(workers=1, pro_lane_workers=0)
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
    from app.pipeline.transcriber import TranscribedNote, TranscriptionResult

    source = Source("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "Way Maker", "Sinach", None,
                    audio_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    seen: dict = {}

    monkeypatch.setattr(links, "resolve_source", lambda url: source)

    def fake_fetch(src, max_seconds, work_dir=None, start_seconds=0.0, end_seconds=None):
        seen["max_seconds"] = max_seconds
        seen["section"] = (start_seconds, end_seconds)
        work = tmp_path / "work"
        work.mkdir()
        return FetchedAudio(_fake_wav(work / "song.wav"), 250.0, start_seconds=30.0, end_seconds=90.0, truncated=True)

    monkeypatch.setattr(links, "fetch_audio", fake_fetch)
    monkeypatch.setattr(separate, "available", lambda: True)

    def fake_separate(wav, out, progress=lambda f: None, backing_path=None):
        progress(1.0)
        if backing_path is not None:
            _fake_wav(backing_path)
        return _fake_wav(out)

    monkeypatch.setattr(separate, "separate_file", fake_separate)

    def fake_transcribe(path, **kwargs):
        seen["transcribed"] = Path(path).name
        seen["fast"] = kwargs.get("fast")
        seen["harmony"] = kwargs.get("harmony")
        # The beat is read from the full mix, not the isolated vocal.
        seen["tempo_source"] = Path(kwargs["tempo_source"]).name if kwargs.get("tempo_source") else None
        return TranscriptionResult(key="C major", key_confidence=1, tempo=100, time_signature="4/4",
                                   musicxml="<x/>", midi_base64="",
                                   notes=[TranscribedNote(60, float(i), 1.0, 1, "d", "", 1.0) for i in range(8)])

    monkeypatch.setattr(queue_mod, "transcribe", fake_transcribe)

    queue = JobQueue(workers=1)
    try:
        jid = queue.submit_link("https://youtu.be/dQw4w9WgXcQ", "melody", None, None,
                                priority=PRIORITY_HIGH, max_seconds=60, harmony=True, start_seconds=30, end_seconds=100)
        job = _wait(queue, jid, (STATUS_DONE, STATUS_FAILED))
        assert job.status == STATUS_DONE, job.error
        assert job.source == {"provider": "youtube", "url": source.url, "title": "Way Maker",
                              "artist": "Sinach", "thumbnail_url": None,
                              "duration_seconds": 250.0, "start_seconds": 30.0, "end_seconds": 90.0}
        assert seen == {"max_seconds": 60, "section": (30, 100), "transcribed": "vocals.wav", "fast": True,
                        "tempo_source": "song.wav", "harmony": True}
        # The instrumental rides along for rehearsal (ffmpeg permitting); never an error either way.
        assert isinstance(job.result.backing_audio_base64, str)
        assert job.result.source["title"] == "Way Maker"
        assert job.result.truncated is True and job.result.separated is True
        assert job.result.song_duration_sec == 250.0
        assert job.stage is None and job.progress == 1.0
        assert not (tmp_path / "work").exists()  # audio never outlives the job
    finally:
        queue.shutdown(wait=True, timeout=2)


def test_link_job_marks_a_preview_stand_in(monkeypatch, tmp_path):
    from app.pipeline import separate
    from app.pipeline.transcriber import TranscriptionResult

    source = _song()
    monkeypatch.setattr(links, "resolve_source", lambda url: source)

    def fake_fetch(src, max_seconds, work_dir=None, start_seconds=0.0, end_seconds=None):
        work = tmp_path / "work"
        work.mkdir()
        return FetchedAudio(_fake_wav(work / "song.wav"), 214.0, preview=True, truncated=True)

    monkeypatch.setattr(links, "fetch_audio", fake_fetch)
    monkeypatch.setattr(separate, "available", lambda: False)
    monkeypatch.setattr(queue_mod, "transcribe", lambda path, **kwargs: TranscriptionResult(
        key="C major", key_confidence=1, tempo=100, time_signature="4/4", musicxml="<x/>", midi_base64=""))

    queue = JobQueue(workers=1)
    try:
        # The cap is longer than the song: only the preview flag makes this truncated.
        jid = queue.submit_link(source.url, "melody", None, None, max_seconds=360)
        job = _wait(queue, jid, (STATUS_DONE, STATUS_FAILED))
        assert job.status == STATUS_DONE, job.error
        assert job.result.truncated is True
        assert job.source["preview"] is True
        assert job.source["notice"] == "Only a 30-second preview was available for this song."
        assert job.result.source["preview"] is True
        assert job.source["duration_seconds"] == 214.0
        assert job.source["start_seconds"] is None and job.source["end_seconds"] is None
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
        def queue_position(self, job_id):
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
    # No meter given: the worker reads it off the notes (None), as for "auto".
    assert submitted["mode"] == "melody" and submitted["time_signature"] is None
    assert submitted["start_seconds"] == 0.0 and submitted["end_seconds"] is None  # the whole song, as before


def test_link_route_forwards_the_chosen_section(client):
    c, submitted = client
    r = c.post("/v1/transcribe/link", data={"url": "https://youtu.be/dQw4w9WgXcQ", "start_seconds": "65",
                                            "end_seconds": "95.5"})
    assert r.status_code == 202, r.text
    assert (submitted["start_seconds"], submitted["end_seconds"]) == (65.0, 95.5)


@pytest.mark.parametrize(
    "data",
    [
        {"url": "https://example.com/x.mp3"},
        {"url": "https://youtu.be/dQw4w9WgXcQ", "priority": "urgent"},
        {"url": "https://youtu.be/dQw4w9WgXcQ", "max_seconds": "3"},
        {"url": "https://youtu.be/dQw4w9WgXcQ", "mode": "opera"},
        {"url": "https://youtu.be/dQw4w9WgXcQ", "start_seconds": "-1"},
        {"url": "https://youtu.be/dQw4w9WgXcQ", "start_seconds": "60", "end_seconds": "60"},
        {"url": "https://youtu.be/dQw4w9WgXcQ", "end_seconds": "0"},
        {"url": "https://youtu.be/dQw4w9WgXcQ", "start_seconds": "nan"},
        {"url": "https://youtu.be/dQw4w9WgXcQ", "end_seconds": "nan"},
        {"url": "https://youtu.be/dQw4w9WgXcQ", "start_seconds": "inf"},
        {"url": "https://youtu.be/dQw4w9WgXcQ", "end_seconds": "1e400"},
    ],
)
def test_link_route_rejects_bad_input(client, data):
    c, _ = client
    assert c.post("/v1/transcribe/link", data=data).status_code == 422


def test_resolve_route_describes_the_song_in_camel_case(client, monkeypatch):
    c, _ = client
    resolved = []
    monkeypatch.setattr(links, "resolve_link", lambda text: resolved.append(text) or Source(
        "spotify", f"https://open.spotify.com/track/{SPOTIFY_ID}", "Never Gonna Give You Up", "Rick Astley",
        "https://i.scdn.co/image/x", duration=214.0))
    r = c.post("/v1/links/resolve", json={"url": f"Listen: https://open.spotify.com/track/{SPOTIFY_ID}?si=1"})
    assert r.status_code == 200, r.text
    assert r.json() == {"provider": "spotify", "url": f"https://open.spotify.com/track/{SPOTIFY_ID}",
                        "title": "Never Gonna Give You Up", "artist": "Rick Astley",
                        "thumbnailUrl": "https://i.scdn.co/image/x", "durationSeconds": 214.0}
    assert resolved == [f"Listen: https://open.spotify.com/track/{SPOTIFY_ID}?si=1"]


def test_resolve_route_says_null_when_the_length_is_unknown(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(links, "resolve_link", lambda text: _video(title="T", thumbnail_url=None))
    body = c.post("/v1/links/resolve", json={"url": YOUTUBE}).json()
    assert body["durationSeconds"] is None and body["thumbnailUrl"] is None
    assert body["provider"] == "youtube"


def test_resolve_route_turns_an_unusable_link_into_a_plain_422(client, monkeypatch):
    c, _ = client
    r = c.post("/v1/links/resolve", json={"url": "https://example.com/song.mp3"})
    assert r.status_code == 422
    assert r.json()["detail"] == "url must be a YouTube video, Spotify track or Apple Music song link."

    def refuse(text):
        raise LinkError("That Spotify link does not point to a song. Share the song itself and paste that link.")

    monkeypatch.setattr(links, "resolve_link", refuse)
    r = c.post("/v1/links/resolve", json={"url": "https://spotify.link/qKr2CFxMQwb"})
    assert r.status_code == 422
    assert r.json()["detail"].startswith("That Spotify link does not point to a song.")
    assert c.post("/v1/links/resolve", json={}).status_code == 422


def test_job_response_carries_stage_and_source(monkeypatch):
    from fastapi.testclient import TestClient

    from app.jobs.queue import STATUS_PROCESSING, Job
    from app.main import app

    job = Job(id="abc", status=STATUS_PROCESSING, progress=0.3, stage="separating",
              source={"provider": "youtube", "url": "u", "title": "T", "artist": "A", "thumbnail_url": None})

    class FakeQueue:
        def get(self, job_id):
            return job
        def queue_position(self, job_id):
            return None


    monkeypatch.setattr("app.api.routes._get_queue", lambda request: FakeQueue())
    with TestClient(app) as c:
        body = c.get("/v1/jobs/abc").json()
    assert body["stage"] == "separating"
    assert body["source"] == {"provider": "youtube", "url": "u", "title": "T", "artist": "A"}


def test_job_response_carries_the_preview_marking(monkeypatch):
    from fastapi.testclient import TestClient

    from app.jobs.queue import STATUS_DONE, Job
    from app.main import app

    source = {**queue_mod._source_dict(_song()), "preview": True, "notice": links.PREVIEW_NOTICE}
    job = Job(id="abc", status=STATUS_DONE, progress=1.0, source=source)

    class FakeQueue:
        def get(self, job_id):
            return job
        def queue_position(self, job_id):
            return None


    monkeypatch.setattr("app.api.routes._get_queue", lambda request: FakeQueue())
    with TestClient(app) as c:
        body = c.get("/v1/jobs/abc").json()
    assert body["source"]["preview"] is True
    assert body["source"]["notice"] == "Only a 30-second preview was available for this song."
    assert body["source"]["durationSeconds"] == 214.0
    assert "startSeconds" not in body["source"]


def test_job_response_carries_the_chosen_section(monkeypatch):
    from fastapi.testclient import TestClient

    from app.jobs.queue import STATUS_DONE, Job
    from app.main import app

    source = {**queue_mod._source_dict(_video()), "duration_seconds": 213.0, "start_seconds": 65.0, "end_seconds": 95.0}
    job = Job(id="abc", status=STATUS_DONE, progress=1.0, source=source)

    class FakeQueue:
        def get(self, job_id):
            return job
        def queue_position(self, job_id):
            return None


    monkeypatch.setattr("app.api.routes._get_queue", lambda request: FakeQueue())
    with TestClient(app) as c:
        body = c.get("/v1/jobs/abc").json()
    assert body["source"] == {"provider": "youtube", "url": YOUTUBE, "title": "T", "artist": "A",
                              "durationSeconds": 213.0, "startSeconds": 65.0, "endSeconds": 95.0}


def test_a_refusal_leaves_ytdlps_own_words_in_the_log(monkeypatch, tmp_path, caplog):
    """The person reads the plain sentence; the log keeps the evidence of which refusal it was."""
    import logging

    monkeypatch.setattr(links.subprocess, "run", _fake_ytdlp([], fail_on="-J", stderr=BOT))
    monkeypatch.setattr(links, "_http_json", lambda url: {"title": "Rick Astley - Never Gonna Give You Up",
                                                          "author_name": "Rick Astley", "thumbnail_url": "t"})
    monkeypatch.delenv("NF_YTDLP_COOKIES_FILE", raising=False)
    with caplog.at_level(logging.WARNING, logger="app.ingest.links"):
        source = links.resolve_link("https://youtu.be/dQw4w9WgXcQ")
    assert source.duration is None  # the length lookup failed, the link still resolved
    record = next(r for r in caplog.records if "yt-dlp failed" in r.getMessage())
    assert "Sign in to confirm you're not a bot" in record.getMessage()
    assert "youtube" in record.getMessage()


def test_the_logged_tail_never_carries_a_cookie_line():
    stderr = ("WARNING: skipping cookie file entry due to invalid length 3: "
              "'.youtube.com\tTRUE\t/\tTRUE\t1800000000\tSID\tg.a000secretvalue'\n"
              "ERROR: [youtube] abc: Sign in to confirm you're not a bot\n")
    tail = links._log_tail(stderr)
    assert "secretvalue" not in tail and "SID" not in tail
    assert "[cookie line withheld]" in tail and "Sign in to confirm" in tail
    # A bare cookie row (the loader prints the offending line on its own too) is withheld as well.
    assert "secret2" not in links._log_tail(".youtube.com\tTRUE\t/\tTRUE\t1800000000\tSSID\tsecret2")
    # Mentioning cookies is not the same as echoing one: the bot message keeps its advice.
    assert "--cookies-from-browser" in links._log_tail("ERROR: Sign in to confirm. Use --cookies-from-browser")
    assert links._log_tail("") == "no output"
