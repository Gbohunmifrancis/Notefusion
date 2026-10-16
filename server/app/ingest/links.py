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
and deleted with the job like every other upload.  YouTube rate limits and refuses
datacenter addresses ("Sign in to confirm you're not a bot"), so every yt-dlp call goes up
a ladder (``_routes``) and climbs a rung only when YouTube refused the one below:

1. yt-dlp's default player clients, with proof-of-origin tokens from the bgutil sidecar
   (``NF_YTDLP_POT_URL``) and the cookies of ``NF_YTDLP_COOKIES_FILE`` when set;
2. the fallback clients (``NF_YTDLP_FALLBACK_CLIENTS``, by default ``mweb`` with its token,
   ``android_vr`` and ``web_embedded``, which need none);
3. the same through ``NF_YTDLP_PROXY``, a residential proxy, when one is configured.

The yt-dlp that runs is kept current by ``app.ingest.ytdlp_update``.  A store link tries
the next-best YouTube upload when one cannot be had.  When YouTube still refuses, the
store's official 30-second preview is transcribed instead and the result says so; with no
preview either, the refusal surfaces as a ``LinkError`` the clients render as "upload the
file instead".  Every resolve that asks yt-dlp and every fetch ends in one ``link_attempt``
log line (outcome, rung, running totals) and never names the video or the proxy.

A link is turned away the moment it is looked at (``resolve_link``) when it can never be a
song: a video that does not exist, one that is private, a live stream or premiere, or a
video longer than ``NF_LINK_MAX_VIDEO_SECONDS``.  Each ``LinkError`` carries a ``code`` for
the C# API, which tells the user in its own words.
"""

import html
import json
import logging
import os
import re
import shlex
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, replace
from pathlib import Path
from typing import NamedTuple

from app.config import settings
from app.ingest import ytdlp_update

logger = logging.getLogger(__name__)

USER_AGENT = "NoteFusion/1.0 (+https://notefusion.studio)"
HTTP_TIMEOUT = 10.0

PREVIEW_NOTICE = "Only a 30-second preview was available for this song."


class LinkError(Exception):
    """A user-facing reason the link could not be used.

    ``code`` names the reason for the C# API, which has words of its own for ``not_found``,
    ``unavailable``, ``live``, ``too_long`` and ``refused``; None for every other reason.
    ``limit_seconds`` goes with ``too_long``: the cap the video outran.
    """

    def __init__(self, message: str, code: str | None = None, limit_seconds: float | None = None):
        super().__init__(message)
        self.code = code
        self.limit_seconds = limit_seconds


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


def _resolve_youtube(url: str) -> "_Cached":
    """The video behind a YouTube link, from oEmbed; from yt-dlp's details when oEmbed will not say.

    oEmbed answers 400 or 404 for an id no video has, and 401 or 403 for one that is private,
    removed or merely not embeddable.  The last of those is still a song anyone can play, so
    yt-dlp (asked for the length anyway) decides between "private or unavailable" and a
    video that only refuses embedding, and its details then name the song.
    """
    video_id = youtube_video_id(url)
    canonical = f"https://www.youtube.com/watch?v={video_id}"
    try:
        data = _http_json("https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(canonical, safe=""))
    except urllib.error.HTTPError as exc:
        if exc.code in (400, 404):
            raise LinkError("That YouTube video doesn't exist. Check the link and try again.", "not_found") from exc
        if exc.code not in (401, 403):
            raise
        return _resolve_youtube_by_details(canonical)
    title, artist = _split_title(_clean(str(data.get("title", ""))), _clean(str(data.get("author_name", ""))))
    return _Cached(Source("youtube", canonical, title, artist, data.get("thumbnail_url"), audio_url=canonical))


UNAVAILABLE = "That video is private or unavailable, so it can't be fetched."


def _resolve_youtube_by_details(canonical: str) -> "_Cached":
    with _tracked("resolve", "youtube"):
        return _read_youtube_details(canonical)


def _read_youtube_details(canonical: str) -> "_Cached":
    try:
        info_json, route = _extract_info(canonical, _INFO_TIMEOUT)
    except _YtdlpFailed as failure:
        if _refused(failure.stderr):
            raise LinkError("YouTube is refusing automated downloads right now. Upload the audio file instead.",
                            "refused") from failure
        raise LinkError(UNAVAILABLE, "unavailable") from failure
    except OSError as exc:  # no yt-dlp on this machine: nothing left to ask
        raise LinkError(UNAVAILABLE, "unavailable") from exc
    refusal = _video_refusal(info_json)
    if refusal is not None:
        raise refusal
    info = json.loads(info_json)
    title, artist = _split_title(_clean(str(info.get("title") or "")),
                                 _clean(str(info.get("uploader") or info.get("channel") or "")))
    source = Source("youtube", canonical, title, artist, info.get("thumbnail") or None, audio_url=canonical,
                    duration=_info_duration(info_json))
    return _Cached(source, info_json, route=route)


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
    # Why the video was turned away once its details were read (a live stream, too long), so
    # the submit that follows is answered at once instead of queueing a job that cannot run.
    refusal: LinkError | None = None
    expires: float = 0.0
    # The rung of the ladder (``_routes``) ``info_json`` was read on: its media addresses are
    # bound to the address that asked, so the download goes the same way.
    route: int = 0


#: Most addresses remembered at once; the least recently used goes first. Every pasted link
#: lands here, and a caller pasting thousands of them must not grow the worker's memory.
RESOLVE_CACHE_MAX_KEYS = 256

_cache: "OrderedDict[str, _Cached]" = OrderedDict()
_cache_lock = threading.Lock()

#: Parts of yt-dlp's ``-J`` output that neither the refusal checks nor the download read, and
#: that make up most of it (every caption track in every language, every thumbnail size).
_UNUSED_INFO_KEYS = ("automatic_captions", "subtitles", "thumbnails", "heatmap")


def _slim_info(info_json: str | None) -> str | None:
    """``info_json`` without ``_UNUSED_INFO_KEYS``, to be remembered; as it was when it is not
    a JSON object."""
    if not info_json:
        return info_json
    try:
        info = json.loads(info_json)
    except ValueError:
        return info_json
    if not isinstance(info, dict):
        return info_json
    for key in _UNUSED_INFO_KEYS:
        info.pop(key, None)
    return json.dumps(info)


def _cache_get(key: str | None) -> _Cached | None:
    if not key:
        return None
    with _cache_lock:
        entry = _cache.get(key)
        if entry is not None and entry.expires <= time.monotonic():
            del _cache[key]
            return None
        if entry is not None:
            _cache.move_to_end(key)
        return entry


def _cache_put(entry: _Cached, *keys: str | None) -> None:
    now = time.monotonic()
    entry.expires = now + RESOLVE_CACHE_SECONDS
    entry.info_json = _slim_info(entry.info_json)
    with _cache_lock:
        for stale in [k for k, e in _cache.items() if e.expires <= now]:
            del _cache[stale]
        for key in keys:
            if key:
                _cache[key] = entry
                _cache.move_to_end(key)
        while len(_cache) > RESOLVE_CACHE_MAX_KEYS:
            _cache.popitem(last=False)


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
            entry = _resolve_youtube(url)
        elif provider == "spotify":
            entry = _Cached(_resolve_spotify(url))
        else:
            entry = _Cached(_resolve_apple(url))
    except LinkError:
        raise
    except Exception as exc:  # noqa: BLE001 - network and parse failures all read the same to a user
        raise LinkError("Could not read that link. Check it opens in a browser, or upload the audio file instead.") from exc
    _cache_put(entry, url, entry.source.url, entry.source.audio_url)
    return entry.source


def cached_refusal(text: str) -> LinkError | None:
    """The reason the link was turned away when it was looked at, while that is remembered.
    A YouTube video is known under every address it has (youtu.be, shorts, music)."""
    url = extract_url(text or "")
    entry = _cache_get(url)
    if entry is None and url and (video_id := youtube_video_id(url)):
        entry = _cache_get(f"https://www.youtube.com/watch?v={video_id}")
    return entry.refusal if entry is not None else None


# ── Audio ─────────────────────────────────────────────────────────────────────


#: Audio only: an m4a (AAC) stream first, any audio stream next — a six-minute song is a few
#: megabytes either way. A small muxed video is the last resort, for a video YouTube serves
#: no separate audio for (which happens when it withholds formats from a client).
_AUDIO_FORMAT = "bestaudio[ext=m4a]/bestaudio/best[height<=480]/best"
# Words that mark an upload as some other recording than the song itself.
_NOT_THE_RECORDING = re.compile(
    r"\b(cover|karaoke|instrumental|loop|live|slowed|sped up|reverb|nightcore|reaction|tutorial|\d+\s*hours?)\b", re.I)
_PREFERRED = re.compile(r"official (audio|lyric video)|\(audio\)", re.I)


# ── Why yt-dlp failed ─────────────────────────────────────────────────────────

# Read in this order. An age gate ("Sign in to confirm your age") and a private video ("Sign in
# if you've been granted access") both mention signing in, so the age gate comes first and the
# bot check is matched on its own words. YouTube's rate limit reads "Video unavailable. This
# content isn't available, try again later", so it is matched before "unavailable" is.
_AGE_GATE = re.compile(r"confirm your age|age[- ]restricted|inappropriate for some users", re.I)
_BOT_CHECK = re.compile(r"not a bot|confirm you(?:'|’)re not|rate-limited|try again later|captcha", re.I)
_GONE = re.compile(
    r"private|unavailable|removed|no longer available|terminated|does not exist|members|copyright"
    r"|available in your country", re.I)
_TURNED_AWAY = re.compile(
    r"http error 403|http error 429|too many requests|po token|sabr|requested format is not available"
    r"|only images are available|unable to download (?:webpage|api)|unable to extract|unable to connect to proxy"
    r"|connection refused|connection reset|timed out|network is unreachable|name resolution", re.I)


def classify(stderr: str) -> str:
    """What yt-dlp's stderr says went wrong: "blocked" (YouTube, or the way to it, turned this
    server away: worth another client, the proxy or a later try), "unavailable" (the video
    is private, removed, members-only or region-locked), "age_restricted", or "other".

    Only the ERROR lines are read when there are any: yt-dlp's warnings come first and must
    not decide it.
    """
    lines = [line for line in (stderr or "").splitlines() if line.lstrip().startswith("ERROR")]
    text = "\n".join(lines) if lines else (stderr or "")
    if _AGE_GATE.search(text):
        return "age_restricted"
    if _BOT_CHECK.search(text):
        return "blocked"
    if _GONE.search(text):
        return "unavailable"
    if _TURNED_AWAY.search(text):
        return "blocked"
    return "other"


class _YtdlpFailed(LinkError):
    """yt-dlp could not deliver; the message is the plain reason, ``stderr`` the evidence."""

    def __init__(self, message: str, stderr: str = "", timed_out: bool = False):
        super().__init__(message)
        self.stderr = stderr
        self.timed_out = timed_out
        self.kind = "timeout" if timed_out else classify(stderr)
        #: The rung of ``_routes()`` that failed last.
        self.route = 0


def _refused(stderr: str) -> bool:
    """YouTube (or the way to it) turned the request away, as opposed to the video being gone."""
    return classify(stderr) == "blocked"


def _explain(stderr: str, provider: str = "youtube") -> str:
    kind = classify(stderr)
    searched = provider != "youtube"
    if kind in ("unavailable", "age_restricted"):
        if searched:
            return "Could not find a playable copy of that song. Upload the audio file instead."
        if kind == "age_restricted":
            return "That video is age-restricted and cannot be fetched."
        return "That video is private or unavailable."
    if kind == "blocked":
        if searched:
            return "This song could not be fetched right now. Try again later, or upload the audio file instead."
        return "YouTube is refusing automated downloads right now. Upload the audio file instead."
    return "Could not fetch audio from that link. Upload the audio file instead."


# ── Running yt-dlp ────────────────────────────────────────────────────────────


@contextmanager
def _ytdlp_args() -> Iterator[list[str]]:
    """yt-dlp's common arguments for one job.

    Warnings are kept (they go to stderr, which is only logged): the one that says the cookies
    were rotated is how an expired cookies file shows up (``_check_cookies``).
    yt-dlp writes the cookie jar back when it exits, and the deploy mounts the cookies file
    read-only, so it is handed a private copy that is deleted afterwards.
    """
    args = ["yt-dlp", "--no-playlist", "--no-progress", "-q"]
    copy: str | None = None
    cookies = os.getenv("NF_YTDLP_COOKIES_FILE", "").strip()
    try:
        if cookies and Path(cookies).is_file() and Path(cookies).stat().st_size > 0:
            fd, copy = tempfile.mkstemp(prefix="nf_cookies_", suffix=".txt")
            with os.fdopen(fd, "wb") as out, open(cookies, "rb") as original:
                shutil.copyfileobj(original, out)
            args += ["--cookies", copy]
        extra = os.getenv("NF_YTDLP_EXTRA_ARGS", "").strip()
        # Proof-of-origin tokens from the bgutil sidecar, unless the extra arguments name it
        # themselves (they used to carry it, and an older .env may still).
        if settings.ytdlp_pot_url and "youtubepot-bgutilhttp" not in extra:
            args += ["--extractor-args", f"youtubepot-bgutilhttp:base_url={settings.ytdlp_pot_url}"]
        if extra:
            args += shlex.split(extra)
        yield args
    finally:
        if copy:
            Path(copy).unlink(missing_ok=True)


_COOKIE_ECHO = re.compile(r"skipping cookie file entry|^#?\S+\t(TRUE|FALSE)\t\S*\t(TRUE|FALSE)\t\d+\t", re.I)
_CREDENTIALS = re.compile(r"([a-z][a-z0-9+.-]*://)[^/\s@]+@", re.I)


def _log_tail(stderr: str) -> str:
    """The last few lines of yt-dlp's stderr for the log. Its cookie loader echoes a malformed
    line of the cookies file, value and all; those lines are withheld, and a proxy's user and
    password are masked. The rest ("Sign in to confirm you're not a bot") is the evidence wanted."""
    lines = [line.strip() for line in (stderr or "").strip().splitlines() if line.strip()]
    kept = ["[cookie line withheld]" if _COOKIE_ECHO.search(line) else _CREDENTIALS.sub(r"\1***@", line)
            for line in lines[-4:]]
    return " | ".join(kept)[:600] or "no output"


def _run_group(args: list[str], timeout: float) -> subprocess.CompletedProcess:
    """``subprocess.run`` for yt-dlp, in a session of its own: yt-dlp starts ffmpeg for a
    section download, and on a timeout the whole process group is killed — killing yt-dlp
    alone left its ffmpeg running, holding the half-downloaded file and a core.  It runs the
    self-updated yt-dlp when there is one (``ytdlp_update.subprocess_env``)."""
    with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                          start_new_session=True, env=ytdlp_update.subprocess_env()) as proc:
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            proc.communicate()
            raise
    return subprocess.CompletedProcess(args, proc.returncode, stdout, stderr)


_SIGN_IN = re.compile(r"not a bot|confirm you(?:'|’)re not", re.I)
#: The cookies warning is logged at most this often: every yt-dlp call would repeat it.
_COOKIE_WARNING_SECONDS = 900.0
_cookie_warned_at: list[float] = []


def _check_cookies(args: list[str], stderr: str) -> None:
    """Say plainly in the log when the cookies stopped working: YouTube rotated or expired them
    (yt-dlp warns), or asked for a sign-in although they were sent."""
    if "--cookies" not in args or not stderr:
        return
    if "cookies are no longer valid" in stderr.lower():
        reason = "YouTube says the cookies are no longer valid (rotated or expired)"
    elif _SIGN_IN.search(stderr):
        reason = "YouTube asked for a sign-in although cookies were sent (expired, or the account is flagged)"
    else:
        return
    now = time.monotonic()
    if _cookie_warned_at and now - _cookie_warned_at[0] < _COOKIE_WARNING_SECONDS:
        return
    _cookie_warned_at[:] = [now]
    logger.warning("ytdlp_cookies_rejected: %s. Export fresh cookies from the throwaway account into the "
                   "YTDLP_COOKIES secret and redeploy (docs/DEPLOYMENT.md, \"Cookies\").", reason)


def _run_ytdlp(args: list[str], timeout: float, provider: str) -> subprocess.CompletedProcess:
    attempt = _current_attempt()
    if attempt is not None:
        attempt.calls += 1
    try:
        result = _run_group(args, timeout)
    except subprocess.TimeoutExpired:
        logger.warning("yt-dlp timed out (%s) after %.0fs", provider, timeout)
        raise _YtdlpFailed(_explain("", provider), "timed out", timed_out=True) from None
    _check_cookies(args, result.stderr)
    if result.returncode != 0:
        # The person reads the plain sentence; the log keeps yt-dlp's own words, which say which
        # of YouTube's refusals it was (bot check, 403, missing PO token) or that the video is gone.
        logger.warning("yt-dlp failed (%s, exit %d, %s): %s", provider, result.returncode, classify(result.stderr),
                       _log_tail(result.stderr))
        raise _YtdlpFailed(_explain(result.stderr, provider), result.stderr)
    return result


# ── The ladder: default clients, fallback clients, the proxy ─────────────────


class _Route(NamedTuple):
    name: str  # for the log: "direct", "clients" or "proxy"
    args: tuple[str, ...]


def _routes() -> list[_Route]:
    """The ways to ask YouTube, in order; a rung is climbed only after a refusal on the one below.

    The proxy rung exists only with ``settings.ytdlp_proxy`` set, and only yt-dlp is ever sent
    through it: the stores' metadata and previews are fetched directly.
    """
    routes = [_Route("direct", ())]
    if settings.ytdlp_fallback_clients:
        routes.append(_Route("clients", ("--extractor-args", f"youtube:player_client={settings.ytdlp_fallback_clients}")))
    if settings.ytdlp_proxy:
        routes.append(_Route("proxy", ("--proxy", settings.ytdlp_proxy)))
    return routes


def _describe(route: _Route) -> str:
    if route.name == "clients":
        return f"with player client {settings.ytdlp_fallback_clients}"
    if route.name == "proxy":
        return "through the proxy"
    return "directly"


#: A refused extraction is tried again only with this much of its time budget left: the
#: next rung needs a few seconds of its own, and a near-dead deadline would only add another
#: refusal to the log.
_FALLBACK_MIN_SECONDS = 4.0


def _extract(base: list[str], args: list[str], timeout: float, provider: str,
             first: int = 0) -> tuple[subprocess.CompletedProcess, int]:
    """``_run_ytdlp`` up the ladder from rung ``first``: YouTube's "Sign in to confirm you're not
    a bot" is given per player client and per address, so a refusal is tried again on the next
    rung, within what is left of ``timeout``.  The result and the rung that answered (the
    download must use the same address the details were read from); the last refusal when
    every rung refused."""
    routes = _routes()
    started = time.monotonic()
    index = min(max(first, 0), len(routes) - 1)
    while True:
        _note_route(routes[index].name)
        try:
            left = timeout - (time.monotonic() - started)
            return _run_ytdlp([*base, *routes[index].args, *args], left, provider), index
        except _YtdlpFailed as failure:
            failure.route = index
            left = timeout - (time.monotonic() - started)
            if (index + 1 >= len(routes) or failure.timed_out or not _refused(failure.stderr)
                    or left < _FALLBACK_MIN_SECONDS):
                raise
            index += 1
            logger.info("yt-dlp was refused (%s); trying again %s", provider, _describe(routes[index]))


# ── Searching for a store's song ──────────────────────────────────────────────

#: Search hits a store link tries, best first, before giving up on YouTube.
_SEARCH_CANDIDATES = 3
#: No further search hit is tried once this long has gone on the earlier ones.
_SEARCH_BUDGET_SECONDS = 240.0


def _rank_results(lines: list[str], source: Source) -> list[str]:
    """The video ids among yt-dlp's search results that may be the song, best first.

    The best is the one whose length agrees with the store's (±``DURATION_TOLERANCE``),
    preferring the label's own upload (a "… - Topic" channel, "Official Audio") and skipping
    covers, karaoke, loops and live takes — unless nothing else was found.  The runners-up are
    only clean uploads of the right length.
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
    ranked.sort()
    if not ranked:
        return []
    best = ranked[0][-1]
    return [best, *[r[-1] for r in ranked[1:] if not r[0] and not r[1] and r[-1] != best]]


def _choose_result(lines: list[str], source: Source) -> str | None:
    """The video id that best matches the song among yt-dlp's search results (``_rank_results``)."""
    ranked = _rank_results(lines, source)
    return ranked[0] if ranked else None


def _search_youtube(base: list[str], source: Source) -> tuple[list[str], int]:
    """Watch URLs of the YouTube uploads that best match a Spotify / Apple Music song, best
    first, and the rung of the ladder the search got through on."""
    terms = [f'"{t.replace(chr(34), "")}"' for t in (source.title, source.artist) if t]
    result, route = _extract(
        base, ["--flat-playlist", "--print", "%(id)s\t%(duration)s\t%(channel)s\t%(title)s",
               "ytsearch5:" + " ".join(terms)],
        60, source.provider)
    ids = _rank_results(result.stdout.strip().splitlines(), source)[:_SEARCH_CANDIDATES]
    if not ids:
        raise _YtdlpFailed("Could not find a playable copy of that song. Upload the audio file instead.")
    return [f"https://www.youtube.com/watch?v={video_id}" for video_id in ids], route


#: How long yt-dlp may take to read a video's details for the resolve endpoint, which
#: answers while the user is looking at the link they just pasted — and which the C# API
#: waits twenty seconds for, so a refusal and its retries all fit inside that.
_INFO_TIMEOUT = 15.0


def _extract_info(url: str, timeout: float, provider: str = "youtube") -> tuple[str, int]:
    """yt-dlp's ``-J`` JSON for a video and the rung that read it; raises ``_YtdlpFailed`` (or
    OSError without yt-dlp)."""
    with _ytdlp_args() as base:
        result, route = _extract(base, ["-f", _AUDIO_FORMAT, "-J", url], timeout, provider)
        return result.stdout, route


def _youtube_info(url: str) -> tuple[str | None, int]:
    """yt-dlp's ``-J`` JSON for a video and the rung that read it, or None when YouTube would
    not say in time."""
    try:
        return _extract_info(url, _INFO_TIMEOUT)
    except (_YtdlpFailed, OSError) as failure:  # OSError: no yt-dlp on this machine; the link still resolves
        attempt = _current_attempt()
        if attempt is not None:
            attempt.outcome = _outcome_of(failure)
        return None, 0


# ── One line per link attempt ─────────────────────────────────────────────────


class _Attempt:
    """What one resolve or fetch did, for its ``link_attempt`` log line."""

    def __init__(self, stage: str, provider: str):
        self.stage, self.provider = stage, provider
        self.calls = 0
        self.route = "direct"
        self.outcome: str | None = None
        self.preview = False
        self.started = time.monotonic()


_attempt_local = threading.local()
_totals: dict[str, dict[str, int]] = {}
_totals_lock = threading.Lock()
OUTCOMES = ("success", "blocked", "unavailable", "other")


def _current_attempt() -> _Attempt | None:
    return getattr(_attempt_local, "current", None)


def _note_route(name: str) -> None:
    attempt = _current_attempt()
    if attempt is not None:
        attempt.route = name


def _outcome_of(failure: BaseException) -> str:
    if isinstance(failure, _YtdlpFailed):
        return {"blocked": "blocked", "unavailable": "unavailable", "age_restricted": "unavailable"}.get(
            failure.kind, "other")
    if isinstance(failure, LinkError):
        return {"refused": "blocked", "unavailable": "unavailable", "not_found": "unavailable",
                "live": "unavailable", "too_long": "unavailable"}.get(failure.code or "", "other")
    return "other"


def link_totals() -> dict[str, dict[str, int]]:
    """Attempts since the worker started, by stage ("resolve", "fetch") and outcome."""
    with _totals_lock:
        return {stage: dict(counts) for stage, counts in _totals.items()}


@contextmanager
def _tracked(stage: str, provider: str) -> Iterator[_Attempt]:
    """Count one resolve or fetch and log it as one line: no URL, no video id, no proxy."""
    attempt = _Attempt(stage, provider)
    outer = _current_attempt()
    _attempt_local.current = attempt
    try:
        yield attempt
    except BaseException as failure:
        attempt.outcome = attempt.outcome or _outcome_of(failure)
        raise
    finally:
        _attempt_local.current = outer
        outcome = attempt.outcome or "success"
        with _totals_lock:
            counts = _totals.setdefault(stage, dict.fromkeys(OUTCOMES, 0))
            counts[outcome] = counts.get(outcome, 0) + 1
            snapshot = dict(counts)
        total = sum(snapshot.values())
        logger.info("link_attempt stage=%s provider=%s outcome=%s route=%s ytdlp_calls=%d seconds=%.1f preview=%s "
                    "totals=%s block_rate=%.0f%%", stage, provider, outcome, attempt.route, attempt.calls,
                    time.monotonic() - attempt.started, "yes" if attempt.preview else "no",
                    ",".join(f"{k}:{snapshot.get(k, 0)}" for k in OUTCOMES),
                    100.0 * snapshot.get("blocked", 0) / total if total else 0.0)


def _clock(seconds: float) -> str:
    """A length as a person says it: "2 hours", "3 h 12 min", "45 min"."""
    hours, minutes = divmod(int(round(seconds)) // 60, 60)
    if hours and minutes:
        return f"{hours} h {minutes} min"
    if hours:
        return f"{hours} hour" + ("s" if hours > 1 else "")
    return f"{max(1, minutes)} min"


def _video_refusal(info_json: str | None) -> LinkError | None:
    """Why a video's details rule it out before anything is downloaded: a live stream or a
    premiere (there is no song to cut a section from), or a video longer than
    ``settings.link_max_video_seconds``.  None when the details are missing or fine."""
    try:
        info = json.loads(info_json or "")
    except ValueError:
        return None
    if not isinstance(info, dict):
        return None
    status = info.get("live_status")
    if status == "is_upcoming":
        return LinkError("That video hasn't premiered yet. Try again once it has.", "live")
    if info.get("is_live") or status in ("is_live", "post_live"):
        return LinkError("That's a live stream. Paste a link to the recorded song instead.", "live")
    duration, cap = info.get("duration"), settings.link_max_video_seconds
    if cap > 0 and isinstance(duration, (int, float)) and duration > cap:
        return LinkError(f"That video runs {_clock(duration)}. Links up to {_clock(cap)} are supported — "
                         "upload the song's audio file instead.", "too_long", limit_seconds=cap)
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
                      start: float = 0.0, end: float | None = None, route: int = 0) -> _Downloaded:
    """The video's audio file and its length, from one YouTube extraction.

    ``-J`` reads the video's details (length included) once — or not at all, when the
    resolve endpoint already did for this link — and the download runs from that info
    file instead of asking YouTube again, on the rung of the ladder that read it (from
    ``route`` up, when it is read here).  The chosen section, or the first allowance of
    a long video, is downloaded on its own (``--download-sections``), so a long video
    never costs a long download; ffmpeg then cuts the exact window.
    """
    cached = _cache_get(target)
    if cached is not None and cached.info_json:
        info_json, route = cached.info_json, cached.route
    else:
        result, route = _extract(base, ["-f", _AUDIO_FORMAT, "-J", target], 60, source.provider, route)
        info_json = result.stdout
    refusal = _video_refusal(info_json)
    if refusal is not None:
        raise refusal
    duration = _info_duration(info_json)
    length, truncated = _window(start, end, duration if duration is not None else source.duration, max_seconds)
    info_path = work / "info.json"
    args = [
        "-f", _AUDIO_FORMAT,
        "--max-filesize", "60M",
        "-o", str(work / "audio.%(ext)s"),
        "--load-info-json", str(info_path),
    ]
    section = start > 0 or (duration is not None and start + length < duration)
    if section:
        # Two seconds past the window: the downloader cuts on audio frames (a copy, no
        # re-encode: every AAC or Opus frame stands alone, so the cut lands within one frame
        # of the mark), and ffmpeg then cuts the exact window while decoding to WAV.
        args += ["--download-sections", f"*{start:.2f}-{start + length + 2:.2f}"]
    try:
        _download(base, args, info_path, info_json, target, source.provider, route)
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


def _download(base: list[str], args: list[str], info_path: Path, info_json: str, target: str, provider: str,
              route: int = 0) -> None:
    """Run the download from ``info_json`` on rung ``route`` of the ladder.  When YouTube refuses
    the media itself (a 403 on a URL it no longer honours, a missing token for that client),
    the details are read again on the next rung and the download runs from those."""
    routes = _routes()
    route = min(max(route, 0), len(routes) - 1)
    info_path.write_text(info_json, encoding="utf-8")
    _note_route(routes[route].name)
    try:
        _run_ytdlp([*base, *routes[route].args, *args], 300, provider)
        return
    except _YtdlpFailed as failure:
        failure.route, last = route, failure
    for index in range(route + 1, len(routes)):
        if last.timed_out or not _refused(last.stderr):
            break
        logger.info("yt-dlp was refused the media (%s); reading the details again %s", provider, _describe(routes[index]))
        _note_route(routes[index].name)
        try:
            info = _run_ytdlp([*base, *routes[index].args, "-f", _AUDIO_FORMAT, "-J", target], 60, provider).stdout
            info_path.write_text(info, encoding="utf-8")
            _run_ytdlp([*base, *routes[index].args, *args], 300, provider)
            return
        except _YtdlpFailed as failure:
            failure.route, last = index, failure
    raise last


def _download_song(base: list[str], source: Source, max_seconds: float, work: Path,
                   start: float, end: float | None) -> _Downloaded:
    """The song's audio: the pasted video, or for a store link the best YouTube match — and,
    when that one cannot be had (gone, region-locked, refused, a live take), the next-best
    of ``_SEARCH_CANDIDATES`` within ``_SEARCH_BUDGET_SECONDS``.  A later candidate starts on
    the rung the refusals reached, so a blocked address is not asked again for each one."""
    if source.audio_url:
        return _download_youtube(base, source.audio_url, max_seconds, work, source, start, end)
    candidates, route = _search_youtube(base, source)
    started = time.monotonic()
    for number, target in enumerate(candidates, start=1):
        try:
            return _download_youtube(base, target, max_seconds, work, source, start, end, route)
        except _YtdlpFailed as failure:
            last = failure
            if failure.kind == "blocked":
                route = max(route, failure.route)
        except LinkError as refusal:
            if refusal.code not in ("live", "too_long"):
                raise
            last = _YtdlpFailed("Could not find a playable copy of that song. Upload the audio file instead.")
        for partial in work.glob("audio.*"):
            partial.unlink(missing_ok=True)
        if last.timed_out or number == len(candidates) or time.monotonic() - started > _SEARCH_BUDGET_SECONDS:
            break
        logger.info("Search match %d of %d could not be fetched (%s, %s); trying the next",
                    number, len(candidates), source.provider, last.kind)
    raise last


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
    with _tracked("fetch", source.provider) as attempt:
        work = Path(tempfile.mkdtemp(prefix="nf_link_", dir=str(work_dir) if work_dir else None))
        try:
            with _ytdlp_args() as base:
                try:
                    got = _download_song(base, source, max_seconds, work, start_seconds, end_seconds)
                except _YtdlpFailed as failure:
                    fetched = _preview_fallback(source, failure, max_seconds, work)
                    attempt.outcome, attempt.preview = _outcome_of(failure), True
                    return fetched
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
    the clients then offer the first part of the song.  A video the details rule out (a
    live stream, one longer than the cap) is refused here, and the refusal is remembered
    so the submit of the same link is refused at once too (``cached_refusal``).
    """
    source = resolve_source(text)
    entry = _cache_get(source.url)
    if entry is not None and entry.refusal is not None:
        raise entry.refusal
    if source.provider != "youtube" or source.duration is not None or entry is None or entry.info_json is not None:
        return source
    with _tracked("resolve", "youtube"):
        info_json, entry.route = _youtube_info(source.audio_url or source.url)
    entry.info_json = _slim_info(info_json) or ""
    entry.refusal = _video_refusal(info_json)
    if entry.refusal is not None:
        raise entry.refusal
    duration = _info_duration(info_json)
    if duration is not None:
        entry.source = source = replace(source, duration=duration)
    return source
