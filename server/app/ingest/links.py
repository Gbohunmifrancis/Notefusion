"""Turning a pasted link into audio on disk plus who made it.

Supported links: YouTube (watch, youtu.be, shorts, live, embed, music.youtube.com), Spotify
tracks (including ``spotify.link`` short links) and Apple Music songs.  The link may arrive
inside share text ("Listen to … on Spotify: https://…"); ``extract_url`` takes the first
link out of it, and the clients and the C# API mirror that rule.

Only YouTube can supply a whole song: Spotify and Apple Music streams are DRM-protected,
so for those the link supplies the title, artist and length, and the song is then found
on YouTube by them — which is how every link-to-transcription product does it.

Metadata comes from the platforms' official endpoints (YouTube and Spotify oEmbed, the
iTunes lookup API) or the page's Open Graph tags: no API keys, no scraping of signed-in
pages, and it works even where the download does not.

Audio comes through ``yt-dlp``, audio-only, the section the user chose (or the first
allowance of the song) and no more, transcoded by ffmpeg to the WAV the pipeline wants,
and deleted with the job like every other upload.  YouTube rate
limits and sometimes refuses datacenter addresses outright ("Sign in to confirm you're
not a bot"); ``NF_YTDLP_COOKIES_FILE`` and ``NF_YTDLP_EXTRA_ARGS`` (a proof-of-origin
token provider, a proxy) exist for that.  When YouTube still refuses, the store's official
30-second preview is transcribed instead and the result says so; with no preview either,
the refusal surfaces as a ``LinkError`` the clients render as "upload the file instead".
"""

import html
import json
import logging
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, replace
from pathlib import Path
from typing import NamedTuple

logger = logging.getLogger(__name__)

USER_AGENT = "NoteFusion/1.0 (+https://notefusion.studio)"
HTTP_TIMEOUT = 10.0

PREVIEW_NOTICE = "Only a 30-second preview was available for this song."


class LinkError(Exception):
    """A user-facing reason the link could not be used."""


@dataclass(frozen=True)
class Source:
    provider: str  # "youtube" | "spotify" | "apple_music"
    url: str
    title: str
    artist: str
    thumbnail_url: str | None = None
    # The YouTube URL the audio was (or will be) fetched from; the pasted URL for YouTube.
    audio_url: str | None = None
    # The song's length in seconds, when the store says (Spotify, Apple Music): it picks the
    # right YouTube search result and matches a preview.
    duration: float | None = None
    # The store's official 30-second preview, used only when YouTube refuses the song.
    preview_url: str | None = None


class FetchedAudio(NamedTuple):
    path: Path
    # The whole song's length (0.0 when unknown), not the length of what was fetched.
    song_seconds: float
    # True when YouTube refused and the store's 30-second preview was used instead.
    preview: bool = False
    # The section of the song that was kept, when the caller chose one and the song itself
    # was fetched (a preview has no position in the song, so neither is set then).
    start_seconds: float | None = None
    end_seconds: float | None = None
    # Only part of what was asked for is in ``path``: the chosen section (the whole song
    # when none was chosen) outlasted ``max_seconds``, or a preview stood in.
    truncated: bool = False


_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_URL_IN_TEXT = re.compile(r"https?://[^\s<>\"]+", re.I)
# A link that ends a sentence or sits in brackets drags these along when pasted.
_TRAILING = ".,;:!?)]}>'\"’”»…"
_SPOTIFY_TRACK_PATH = re.compile(r"^/(?:intl-[A-Za-z-]+/)?track/([A-Za-z0-9]+)/?$")
_SPOTIFY_TRACK_URL = re.compile(r"https://open\.spotify\.com/(?:intl-[A-Za-z-]+/)?track/[A-Za-z0-9]+")
_SPOTIFY_SHORT_HOSTS = ("spotify.link", "spotify.app.link")
# Hosts a store's preview may be downloaded from (Spotify's CDN, Apple's).
_PREVIEW_HOSTS = (".scdn.co", ".apple.com", ".mzstatic.com")
_PREVIEW_MAX_BYTES = 5_000_000
# ±seconds a YouTube upload may differ from the store's length and still be the recording.
DURATION_TOLERANCE = 8.0


def _http_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


def _http_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        return response.read(2_000_000).decode("utf-8", errors="replace")


def _clean(text: str) -> str:
    """Page text as a person reads it: entities decoded, non-breaking spaces made plain."""
    return re.sub(r"\s+", " ", html.unescape(text or "").replace("\xa0", " ")).strip()


def _meta(page: str, name: str) -> str:
    """An Open Graph / music meta tag's content (``property=`` or ``name=``, either order)."""
    key = re.escape(name)
    for pattern in (rf'<meta[^>]*?\b(?:property|name)="{key}"[^>]*?\bcontent="([^"]*)"',
                    rf'<meta[^>]*?\bcontent="([^"]*)"[^>]*?\b(?:property|name)="{key}"'):
        m = re.search(pattern, page)
        if m:
            return _clean(m.group(1))
    return ""


# ── Parsing ───────────────────────────────────────────────────────────────────


def extract_url(text: str) -> str | None:
    """The first http(s) link in pasted text, trailing punctuation trimmed; None without one.

    Share sheets wrap the link in words ("Listen to … on Spotify: https://…"), and a link
    that ends a sentence brings its full stop.  The C# API and both clients mirror this.
    """
    m = _URL_IN_TEXT.search(text or "")
    if not m:
        return None
    url = m.group(0).rstrip(_TRAILING)
    return url if len(url) > len("https://") else None


def _host_path_query(url: str) -> tuple[str, str, dict[str, list[str]]]:
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return "", "", {}
    if parsed.scheme.lower() not in ("http", "https"):
        return "", "", {}
    return (parsed.hostname or "").lower(), parsed.path, urllib.parse.parse_qs(parsed.query)


def youtube_video_id(url: str) -> str | None:
    """The 11-character video id, or None when the URL is not a YouTube video."""
    host, path, query = _host_path_query((url or "").strip().rstrip(_TRAILING))
    if host in ("youtu.be", "www.youtu.be"):
        candidate = path.strip("/").split("/")[0]
    elif host == "youtube.com" or host.endswith(".youtube.com"):
        parts = [p for p in path.split("/") if p]
        if parts and parts[0] in ("shorts", "embed", "live", "v") and len(parts) > 1:
            candidate = parts[1]
        elif parts == ["watch"]:
            candidate = query.get("v", [None])[0]
        else:
            candidate = None
    else:
        return None
    return candidate if candidate and _VIDEO_ID.match(candidate) else None


def spotify_track_id(url: str) -> str | None:
    host, path, _ = _host_path_query(url)
    m = _SPOTIFY_TRACK_PATH.match(path) if host == "open.spotify.com" else None
    return m.group(1) if m else None


def apple_track_id(url: str) -> str | None:
    """The song's iTunes id: ``?i=`` on an album link, the trailing number on a song link."""
    host, path, query = _host_path_query(url)
    if host not in ("music.apple.com", "geo.music.apple.com"):
        return None
    parts = [p for p in path.split("/") if p]
    # /<country>/(song|album)/<slug>/<id>, the slug sometimes missing.
    if len(parts) < 3 or parts[1] not in ("song", "album"):
        return None
    if parts[1] == "album":
        candidate = query.get("i", [""])[0]
    else:
        candidate = parts[-1]
    return candidate if candidate.isdigit() else None


def provider_of(text: str) -> str | None:
    """Which supported service the first link in ``text`` belongs to, or None."""
    url = extract_url(text)
    if url is None:
        return None
    if youtube_video_id(url):
        return "youtube"
    if spotify_track_id(url):
        return "spotify"
    host, path, _ = _host_path_query(url)
    if host in _SPOTIFY_SHORT_HOSTS and path.strip("/"):
        return "spotify"
    if apple_track_id(url):
        return "apple_music"
    return None


# ── Metadata ──────────────────────────────────────────────────────────────────


def _split_title(title: str, fallback_artist: str) -> tuple[str, str]:
    """"Artist - Title (Official Video)" -> ("Title", "Artist"), else (title, uploader)."""
    cleaned = re.sub(r"\s*[\(\[][^\)\]]*(official|video|audio|lyric|lyrics|hd|4k|visuali[sz]er)[^\)\]]*[\)\]]", "", title, flags=re.I)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    for sep in (" - ", " – ", " — ", " | "):
        if sep in cleaned:
            left, right = cleaned.split(sep, 1)
            return right.strip(), left.strip()
    artist = re.sub(r"\s*-\s*topic$", "", fallback_artist, flags=re.I).replace("VEVO", "").strip()
    return cleaned, artist


class _SpotifyRedirects(urllib.request.HTTPRedirectHandler):
    """Follows a short link's redirects within Spotify's own hosts and nowhere else."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        host, _, _ = _host_path_query(newurl)
        if spotify_track_id(newurl):
            raise _ShortLinkResolved(newurl)
        if not (host in _SPOTIFY_SHORT_HOSTS or host.endswith(".spotify.com") or host.endswith(".spotify.link")):
            return None  # urllib then raises the 3xx as an HTTPError
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class _ShortLinkResolved(Exception):
    def __init__(self, url: str):
        super().__init__(url)
        self.url = url


def _follow_short_link(url: str) -> tuple[str, str]:
    """``(final_url, page)`` for a Spotify short link; the page is empty when a redirect
    already named the track."""
    opener = urllib.request.build_opener(_SpotifyRedirects())
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with opener.open(request, timeout=HTTP_TIMEOUT) as response:
            return response.geturl(), response.read(2_000_000).decode("utf-8", errors="replace")
    except _ShortLinkResolved as resolved:
        return resolved.url, ""


def _expand_spotify_short(url: str) -> str:
    """The ``open.spotify.com/track/…`` address behind a ``spotify.link`` short link."""
    final_url, page = _follow_short_link(url)
    if spotify_track_id(final_url):
        return final_url
    # Only the short-link service's own interstitial page names the track; a redirect to
    # Spotify's home page (an expired code) lists other songs that must not be taken.
    host, _, _ = _host_path_query(final_url)
    m = _SPOTIFY_TRACK_URL.search(html.unescape(page)) if host in _SPOTIFY_SHORT_HOSTS else None
    if m:
        return m.group(0)
    raise LinkError("That Spotify link does not point to a song. Share the song itself and paste that link.")


def _itunes_lookup(track_id: str, country: str | None) -> dict | None:
    query = {"id": track_id, "entity": "song"}
    if country:
        query["country"] = country
    data = _http_json("https://itunes.apple.com/lookup?" + urllib.parse.urlencode(query))
    for item in data.get("results", []):
        if item.get("wrapperType") == "track" and str(item.get("trackId")) == track_id:
            return item
    return None


def _resolve_youtube(url: str) -> Source:
    video_id = youtube_video_id(url)
    canonical = f"https://www.youtube.com/watch?v={video_id}"
    data = _http_json("https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(canonical, safe=""))
    title, artist = _split_title(_clean(str(data.get("title", ""))), _clean(str(data.get("author_name", ""))))
    return Source("youtube", canonical, title, artist, data.get("thumbnail_url"), audio_url=canonical)


def _resolve_spotify(url: str) -> Source:
    host, _, _ = _host_path_query(url)
    if host in _SPOTIFY_SHORT_HOSTS:
        url = _expand_spotify_short(url)
    canonical = f"https://open.spotify.com/track/{spotify_track_id(url)}"
    data = _http_json("https://open.spotify.com/oembed?url=" + urllib.parse.quote(canonical, safe=""))
    title = _clean(str(data.get("title", "")))
    artist, duration, preview = "", None, None
    # oEmbed carries only the track name; the artist, length and preview are on the page
    # ("Artist · Album · Song · 1987", music:duration, og:audio).
    try:
        page = _http_text(canonical)
        artist = _meta(page, "music:musician_description") or _meta(page, "og:description").split("·")[0].strip()
        title = title or _meta(page, "og:title")
        seconds = _meta(page, "music:duration")
        duration = float(seconds) if seconds.isdigit() and int(seconds) > 0 else None
        preview = _meta(page, "og:audio") or None
    except Exception:  # noqa: BLE001 - these are niceties; the title is enough to search
        pass
    return Source("spotify", canonical, title, artist, data.get("thumbnail_url"),
                  duration=duration, preview_url=preview)


def _resolve_apple(url: str) -> Source:
    track_id = apple_track_id(url)
    _, path, _ = _host_path_query(url)
    country = path.strip("/").split("/")[0].lower()
    try:
        item = _itunes_lookup(track_id, country if re.fullmatch(r"[a-z]{2}", country) else None)
    except Exception:  # noqa: BLE001 - the page tags below still name the song
        item = None
    if item:
        millis = item.get("trackTimeMillis")
        return Source("apple_music", url, _clean(str(item.get("trackName", ""))), _clean(str(item.get("artistName", ""))),
                      # The lookup's artwork is 100 px; the same path serves larger sizes.
                      str(item["artworkUrl100"]).replace("/100x100bb.", "/600x600bb.") if item.get("artworkUrl100") else None,
                      duration=round(millis / 1000, 1) if isinstance(millis, (int, float)) and millis > 0 else None,
                      preview_url=item.get("previewUrl") or None)
    page = _http_text(url)
    og_title = _meta(page, "og:title")
    # "Song by Artist on Apple Music" (Apple writes the last space as a non-breaking one).
    m = re.match(r"(.+?) by (.+?)(?:\s+on\s+Apple\s+Music)?$", og_title)
    title, artist = (m.group(1), m.group(2)) if m else (og_title, "")
    return Source("apple_music", url, title, artist, _meta(page, "og:image") or None)


#: How long a resolved link is remembered.  The clients ask what a link is the moment it
#: is pasted and submit it shortly after, so the job resolves nothing twice and, for a
#: YouTube video, downloads from the details the resolve already read.
RESOLVE_CACHE_SECONDS = 600.0


@dataclass
class _Cached:
    source: Source
    # yt-dlp's ``-J`` output for the YouTube video, for the download to run from: None
    # until asked for, "" when asking failed (so the resolve does not ask again).
    info_json: str | None = None
    expires: float = 0.0


_cache: dict[str, _Cached] = {}
_cache_lock = threading.Lock()


def _cache_get(key: str | None) -> _Cached | None:
    if not key:
        return None
    with _cache_lock:
        entry = _cache.get(key)
        if entry is not None and entry.expires <= time.monotonic():
            del _cache[key]
            return None
        return entry


def _cache_put(entry: _Cached, *keys: str | None) -> None:
    now = time.monotonic()
    entry.expires = now + RESOLVE_CACHE_SECONDS
    with _cache_lock:
        for stale in [k for k, e in _cache.items() if e.expires <= now]:
            del _cache[stale]
        for key in keys:
            if key:
                _cache[key] = entry


def resolve_source(text: str) -> Source:
    """Who and what the (first) link points at.  Raises ``LinkError`` for anything unusable.

    Remembered for ``RESOLVE_CACHE_SECONDS`` under the pasted and the canonical address.
    """
    provider = provider_of(text)
    if provider is None:
        raise LinkError("That link is not a YouTube video, Spotify track or Apple Music song.")
    url = extract_url(text)
    cached = _cache_get(url)
    if cached is not None:
        return cached.source
    try:
        if provider == "youtube":
            source = _resolve_youtube(url)
        elif provider == "spotify":
            source = _resolve_spotify(url)
        else:
            source = _resolve_apple(url)
    except LinkError:
        raise
    except Exception as exc:  # noqa: BLE001 - network and parse failures all read the same to a user
        raise LinkError("Could not read that link. Check it opens in a browser, or upload the audio file instead.") from exc
    _cache_put(_Cached(source), url, source.url, source.audio_url)
    return source


# ── Audio ─────────────────────────────────────────────────────────────────────


_AUDIO_FORMAT = "bestaudio[ext=m4a]/bestaudio/best"
# Words that mark an upload as some other recording than the song itself.
_NOT_THE_RECORDING = re.compile(
    r"\b(cover|karaoke|instrumental|loop|live|slowed|sped up|reverb|nightcore|reaction|tutorial|\d+\s*hours?)\b", re.I)
_PREFERRED = re.compile(r"official (audio|lyric video)|\(audio\)", re.I)


class _YtdlpFailed(LinkError):
    """yt-dlp could not deliver; the message is the plain reason, ``stderr`` the evidence."""

    def __init__(self, message: str, stderr: str = ""):
        super().__init__(message)
        self.stderr = stderr


@contextmanager
def _ytdlp_args() -> Iterator[list[str]]:
    """yt-dlp's common arguments for one job.

    yt-dlp writes the cookie jar back when it exits, and the deploy mounts the cookies file
    read-only, so it is handed a private copy that is deleted afterwards.
    """
    args = ["yt-dlp", "--no-warnings", "--no-playlist", "--no-progress", "-q"]
    copy: str | None = None
    cookies = os.getenv("NF_YTDLP_COOKIES_FILE", "").strip()
    try:
        if cookies and Path(cookies).is_file() and Path(cookies).stat().st_size > 0:
            fd, copy = tempfile.mkstemp(prefix="nf_cookies_", suffix=".txt")
            with os.fdopen(fd, "wb") as out, open(cookies, "rb") as original:
                shutil.copyfileobj(original, out)
            args += ["--cookies", copy]
        extra = os.getenv("NF_YTDLP_EXTRA_ARGS", "").strip()
        if extra:
            args += shlex.split(extra)
        yield args
    finally:
        if copy:
            Path(copy).unlink(missing_ok=True)


_REFUSED = re.compile(
    r"not a bot|sign in to confirm|http error 403|http error 429|too many requests|po token"
    r"|unable to download (webpage|api)|unable to extract|connection refused|timed out", re.I)


def _refused(stderr: str) -> bool:
    """YouTube (or the way to it) turned the request away, as opposed to the video being gone."""
    return bool(_REFUSED.search(stderr or ""))


def _explain(stderr: str, provider: str = "youtube") -> str:
    text = (stderr or "").lower()
    searched = provider != "youtube"
    if "not a bot" in text or "sign in" in text:
        if searched:
            return "This song could not be fetched right now. Try again later, or upload the audio file instead."
        return "YouTube is refusing automated downloads right now. Upload the audio file instead."
    if "private" in text or "unavailable" in text or "removed" in text:
        if searched:
            return "Could not find a playable copy of that song. Upload the audio file instead."
        return "That video is private or unavailable."
    if "age" in text and "confirm" in text:
        if searched:
            return "Could not find a playable copy of that song. Upload the audio file instead."
        return "That video is age-restricted and cannot be fetched."
    return "Could not fetch audio from that link. Upload the audio file instead."


_COOKIE_ECHO = re.compile(r"skipping cookie file entry|^#?\S+\t(TRUE|FALSE)\t\S*\t(TRUE|FALSE)\t\d+\t", re.I)


def _log_tail(stderr: str) -> str:
    """The last few lines of yt-dlp's stderr for the log. Its cookie loader echoes a malformed
    line of the cookies file, value and all; those lines are withheld, the rest ("Sign in to
    confirm you're not a bot. Use --cookies-from-browser") is the evidence wanted."""
    lines = [line.strip() for line in (stderr or "").strip().splitlines() if line.strip()]
    kept = ["[cookie line withheld]" if _COOKIE_ECHO.search(line) else line for line in lines[-4:]]
    return " | ".join(kept)[:600] or "no output"


def _run_ytdlp(args: list[str], timeout: float, provider: str) -> subprocess.CompletedProcess:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        logger.warning("yt-dlp timed out (%s) after %.0fs", provider, timeout)
        raise _YtdlpFailed(_explain("", provider), "timed out") from None
    if result.returncode != 0:
        # The person reads the plain sentence; the log keeps yt-dlp's own words, which say which
        # of YouTube's refusals it was (bot check, 403, missing PO token) or that the video is gone.
        logger.warning("yt-dlp failed (%s, exit %d): %s", provider, result.returncode, _log_tail(result.stderr))
        raise _YtdlpFailed(_explain(result.stderr, provider), result.stderr)
    return result


def _choose_result(lines: list[str], source: Source) -> str | None:
    """The video id that best matches the song among yt-dlp's search results.

    One whose length agrees with the store's (±``DURATION_TOLERANCE``), preferring the
    label's own upload (a "… - Topic" channel, "Official Audio") and skipping covers,
    karaoke, loops and live takes — unless nothing else was found.
    """
    unwanted_in_title = set(m.group(0).lower() for m in _NOT_THE_RECORDING.finditer(source.title))
    ranked = []
    for index, line in enumerate(lines):
        video_id, _, rest = line.partition("\t")
        duration, _, rest = rest.partition("\t")
        channel, _, title = rest.partition("\t")
        if not _VIDEO_ID.match(video_id.strip()):
            continue
        try:
            seconds = float(duration)
        except ValueError:
            seconds = None
        if source.duration is None:
            fits = True
        else:
            fits = seconds is not None and abs(seconds - source.duration) <= DURATION_TOLERANCE
        # "Live" in the song's own name ("Live Like You Were Dying") is not a live take.
        other = any(m.group(0).lower() not in unwanted_in_title for m in _NOT_THE_RECORDING.finditer(title))
        preferred = channel.strip().lower().endswith("- topic") or bool(_PREFERRED.search(title))
        ranked.append((other, not fits, not preferred, index, video_id.strip()))
    return min(ranked)[-1] if ranked else None


def _search_youtube(base: list[str], source: Source) -> str:
    """The watch URL of the YouTube upload that best matches a Spotify / Apple Music song."""
    terms = [f'"{t.replace(chr(34), "")}"' for t in (source.title, source.artist) if t]
    result = _run_ytdlp(
        [*base, "--flat-playlist", "--print", "%(id)s\t%(duration)s\t%(channel)s\t%(title)s",
         "ytsearch5:" + " ".join(terms)],
        60, source.provider)
    video_id = _choose_result(result.stdout.strip().splitlines(), source)
    if video_id is None:
        raise _YtdlpFailed("Could not find a playable copy of that song. Upload the audio file instead.")
    return f"https://www.youtube.com/watch?v={video_id}"


#: How long yt-dlp may take to read a video's details for the resolve endpoint, which
#: answers while the user is looking at the link they just pasted.
_INFO_TIMEOUT = 20.0


def _youtube_info(url: str) -> str | None:
    """yt-dlp's ``-J`` JSON for a video, or None when YouTube would not say in time."""
    with _ytdlp_args() as base:
        try:
            return _run_ytdlp([*base, "-f", _AUDIO_FORMAT, "-J", url], _INFO_TIMEOUT, "youtube").stdout
        except (_YtdlpFailed, OSError):  # OSError: no yt-dlp on this machine; the link still resolves
            return None


def _info_duration(info_json: str | None) -> float | None:
    try:
        return float(json.loads(info_json or "").get("duration") or 0) or None
    except (ValueError, AttributeError):
        return None


def _window(start: float, end: float | None, song: float | None, max_seconds: float) -> tuple[float, bool]:
    """``(length, truncated)`` of what is kept from ``start``: up to ``end`` (the song's
    end when None, and never past it), at most ``max_seconds``.  ``truncated`` says the
    section asked for was longer than that.  ``song`` is None when the length is unknown.
    """
    stop = end if end is not None else song
    if stop is not None and song is not None:
        stop = min(stop, song)
    if stop is None:
        return max_seconds, False
    if stop - start < 0.5:
        raise LinkError("That section starts after the song ends. Pick an earlier start.")
    return min(stop - start, max_seconds), stop - start > max_seconds + 0.5


def _audio_seconds(audio: Path) -> float | None:
    """The file's length by ffprobe, or None when it will not say."""
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(audio)],
            capture_output=True, text=True, timeout=60)
        return float(probe.stdout.strip()) if probe.returncode == 0 else None
    except (subprocess.TimeoutExpired, ValueError, OSError):
        return None


class _Downloaded(NamedTuple):
    path: Path
    # The whole video's length when YouTube said; None otherwise.
    song_seconds: float | None
    # Where in the song the kept window begins and how long it is.
    start: float
    length: float
    # Where in ``path`` the window begins: 0 once a section download has done its job.
    offset: float
    truncated: bool


def _download_youtube(base: list[str], target: str, max_seconds: float, work: Path, source: Source,
                      start: float = 0.0, end: float | None = None) -> _Downloaded:
    """The video's audio file and its length, from one YouTube extraction.

    ``-J`` reads the video's details (length included) once — or not at all, when the
    resolve endpoint already did for this link — and the download runs from that info
    file instead of asking YouTube again.  The chosen section, or the first allowance of
    a long video, is downloaded on its own (``--download-sections``), so a long video
    never costs a long download; ffmpeg then cuts the exact window.
    """
    cached = _cache_get(target)
    info_json = cached.info_json if cached is not None and cached.info_json else None
    if info_json is None:
        info_json = _run_ytdlp([*base, "-f", _AUDIO_FORMAT, "-J", target], 60, source.provider).stdout
    duration = _info_duration(info_json)
    length, truncated = _window(start, end, duration if duration is not None else source.duration, max_seconds)
    info_path = work / "info.json"
    info_path.write_text(info_json, encoding="utf-8")
    args = [
        *base,
        "-f", _AUDIO_FORMAT,
        "--max-filesize", "60M",
        "-o", str(work / "audio.%(ext)s"),
        "--load-info-json", str(info_path),
    ]
    section = start > 0 or (duration is not None and start + length < duration)
    if section:
        # Two seconds past the window: the downloader cuts on frames, ffmpeg cuts exactly.
        args += ["--download-sections", f"*{start:.2f}-{start + length + 2:.2f}", "--force-keyframes-at-cuts"]
    try:
        _run_ytdlp(args, 300, source.provider)
    finally:
        info_path.unlink(missing_ok=True)
    downloaded = sorted(p for p in work.iterdir() if p.name.startswith("audio."))
    if not downloaded:
        raise _YtdlpFailed("Could not fetch audio from that link. Upload the audio file instead.")
    # The safety net: a download that came back whole (the section not honoured) is cut
    # from ``start`` by ffmpeg instead.
    got = _audio_seconds(downloaded[0]) if start > 0 else None
    offset = start if got is not None and got > length + 3 else 0.0
    return _Downloaded(downloaded[0], duration, start, length, offset, truncated)


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", _clean(text).lower()).strip()


def _itunes_preview(source: Source) -> tuple[str, float | None] | None:
    """``(preview_url, song_seconds)`` of the same song, found by title and artist (and
    length, when known)."""
    if not source.title:
        return None
    term = f"{source.artist} {source.title}".strip()
    data = _http_json("https://itunes.apple.com/search?" + urllib.parse.urlencode(
        {"term": term, "entity": "song", "limit": 5}))
    title, artist = _norm(source.title), _norm(source.artist)
    for item in data.get("results", []):
        name, by = _norm(str(item.get("trackName", ""))), _norm(str(item.get("artistName", "")))
        if not name or not (title in name or name in title):
            continue
        if artist and not (artist in by or by in artist):
            continue
        millis = item.get("trackTimeMillis")
        if source.duration is not None and not (
                isinstance(millis, (int, float)) and abs(millis / 1000 - source.duration) <= DURATION_TOLERANCE):
            continue
        if item.get("previewUrl"):
            return str(item["previewUrl"]), millis / 1000 if isinstance(millis, (int, float)) and millis > 0 else None
    return None


def _download_preview(url: str, work: Path) -> Path:
    host, _, _ = _host_path_query(url)
    if not url.lower().startswith("https://") or not host.endswith(_PREVIEW_HOSTS):
        raise LinkError("Untrusted preview host.")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    target = work / "preview.audio"
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        target.write_bytes(response.read(_PREVIEW_MAX_BYTES))
    return target


def _to_wav(audio: Path, max_seconds: float, work: Path, offset: float = 0.0) -> Path:
    """``max_seconds`` of ``audio`` from ``offset`` seconds in, as the pipeline's WAV."""
    wav = work / "song.wav"
    ffmpeg = subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error", *(["-ss", f"{offset:.3f}"] if offset > 0 else []), "-i", str(audio),
            "-t", f"{max_seconds:.2f}", "-ac", "2", "-ar", "44100", "-f", "wav", str(wav),
        ],
        capture_output=True, text=True, timeout=300,
    )
    audio.unlink(missing_ok=True)
    if ffmpeg.returncode != 0 or not wav.is_file():
        raise LinkError("The audio from that link could not be decoded.")
    return wav


def _preview_fallback(source: Source, failure: _YtdlpFailed, max_seconds: float, work: Path) -> FetchedAudio:
    """The store's 30-second preview, when YouTube turned the song away; else ``failure``.

    A pasted YouTube link falls back only when YouTube refused: a private or removed
    video is that, not a reason to transcribe some other upload of the song.
    """
    if source.provider == "youtube" and not _refused(failure.stderr):
        raise failure
    preview_url, duration = source.preview_url, source.duration
    try:
        if not preview_url:
            found = _itunes_preview(source)
            if not found:
                raise failure
            preview_url, duration = found[0], duration or found[1]
        wav = _to_wav(_download_preview(preview_url, work), max_seconds, work)
    except Exception:  # noqa: BLE001 - the user is told why YouTube failed, not why the preview did
        raise failure from None
    return FetchedAudio(wav, round(float(duration or 0.0), 1), preview=True, truncated=True)


def fetch_audio(source: Source, max_seconds: float, work_dir: Path | None = None,
                start_seconds: float = 0.0, end_seconds: float | None = None) -> FetchedAudio:
    """The source's audio as a 44.1 kHz stereo WAV: from ``start_seconds`` to
    ``end_seconds`` (the song's end when None), at most ``max_seconds`` of it.

    The caller owns the file and its folder.  A Spotify or Apple Music source is found on
    YouTube by title, artist and length.  When YouTube refuses, the store's 30-second
    preview stands in and ``preview`` says so; a preview has no position in the song, so
    the section is not applied to it.
    """
    start_seconds = max(0.0, float(start_seconds or 0.0))
    chosen = start_seconds > 0 or end_seconds is not None
    work = Path(tempfile.mkdtemp(prefix="nf_link_", dir=str(work_dir) if work_dir else None))
    try:
        with _ytdlp_args() as base:
            try:
                target = source.audio_url or _search_youtube(base, source)
                got = _download_youtube(base, target, max_seconds, work, source, start_seconds, end_seconds)
            except _YtdlpFailed as failure:
                return _preview_fallback(source, failure, max_seconds, work)
        wav = _to_wav(got.path, got.length, work, got.offset)
        return FetchedAudio(wav, float(got.song_seconds or source.duration or 0.0),
                            start_seconds=got.start if chosen else None,
                            end_seconds=round(got.start + got.length, 2) if chosen else None,
                            truncated=got.truncated)
    except BaseException:
        shutil.rmtree(work, ignore_errors=True)
        raise


# ── Resolving for the clients ─────────────────────────────────────────────────


def resolve_link(text: str) -> Source:
    """``resolve_source`` plus the song's length, for the clients' section picker.

    Spotify and Apple Music say how long a song is; YouTube's oEmbed does not, so the
    video's details are read with yt-dlp (``-J``, within ``_INFO_TIMEOUT``) and kept with
    the cached link, where the job's download picks them up instead of asking YouTube
    again.  When YouTube will not say, the length is None and the link still resolves:
    the clients then offer the first part of the song.
    """
    source = resolve_source(text)
    entry = _cache_get(source.url)
    if source.provider != "youtube" or source.duration is not None or entry is None or entry.info_json is not None:
        return source
    info_json = _youtube_info(source.audio_url or source.url)
    entry.info_json = info_json or ""
    duration = _info_duration(info_json)
    if duration is not None:
        entry.source = source = replace(source, duration=duration)
    return source
