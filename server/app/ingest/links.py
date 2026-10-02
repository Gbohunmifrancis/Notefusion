"""Turning a pasted link into audio on disk plus who made it.

Supported links: YouTube (watch, youtu.be, shorts, music.youtube.com), Spotify tracks and
Apple Music songs.  Only YouTube can supply audio: Spotify and Apple Music streams are
DRM-protected, so for those the link supplies the title and artist, and the song is then
found on YouTube by that title and artist — which is how every link-to-transcription
product does it.

Metadata comes from the platforms' official oEmbed endpoints (YouTube, Spotify) or the
page's Open Graph tags (Apple Music): no API keys, no scraping of signed-in pages, and
it works even where the download does not.

Audio comes through ``yt-dlp``, audio-only, capped in length, transcoded by ffmpeg to the
WAV the pipeline wants, and deleted with the job like every other upload.  YouTube rate
limits and sometimes refuses datacenter addresses outright ("Sign in to confirm you're
not a bot"); ``NF_YTDLP_COOKIES_FILE`` and ``NF_YTDLP_EXTRA_ARGS`` exist for that, and a
refusal surfaces as a ``LinkError`` the clients render as "upload the file instead".
"""

import json
import os
import re
import shlex
import subprocess
import tempfile
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

USER_AGENT = "NoteFusion/1.0 (+https://notefusion.studio)"
HTTP_TIMEOUT = 10.0


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


_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"}
_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _http_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


def _http_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        return response.read(2_000_000).decode("utf-8", errors="replace")


# ── Parsing ───────────────────────────────────────────────────────────────────


def youtube_video_id(url: str) -> str | None:
    """The 11-character video id, or None when the URL is not a YouTube video."""
    try:
        parsed = urllib.parse.urlparse(url.strip())
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    if host not in _YOUTUBE_HOSTS:
        return None
    candidate = None
    if host.endswith("youtu.be"):
        candidate = parsed.path.strip("/").split("/")[0]
    else:
        parts = [p for p in parsed.path.split("/") if p]
        if parts and parts[0] in ("shorts", "embed", "live", "v") and len(parts) > 1:
            candidate = parts[1]
        else:
            candidate = urllib.parse.parse_qs(parsed.query).get("v", [None])[0]
    return candidate if candidate and _VIDEO_ID.match(candidate) else None


def provider_of(url: str) -> str | None:
    if youtube_video_id(url):
        return "youtube"
    host = (urllib.parse.urlparse(url.strip()).hostname or "").lower()
    path = urllib.parse.urlparse(url.strip()).path
    if host in ("open.spotify.com", "spotify.link") and "/track/" in path:
        return "spotify"
    if host.endswith("music.apple.com") and "/song/" in path or (host.endswith("music.apple.com") and "?i=" in url):
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


def resolve_source(url: str) -> Source:
    """Who and what the link points at.  Raises ``LinkError`` for anything unusable."""
    provider = provider_of(url)
    if provider is None:
        raise LinkError("That link is not a YouTube video, Spotify track or Apple Music song.")
    try:
        if provider == "youtube":
            video_id = youtube_video_id(url)
            canonical = f"https://www.youtube.com/watch?v={video_id}"
            data = _http_json("https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(canonical, safe=""))
            title, artist = _split_title(str(data.get("title", "")), str(data.get("author_name", "")))
            return Source("youtube", canonical, title, artist, data.get("thumbnail_url"), audio_url=canonical)
        if provider == "spotify":
            data = _http_json("https://open.spotify.com/oembed?url=" + urllib.parse.quote(url.strip(), safe=""))
            title = str(data.get("title", "")).strip()
            artist = ""
            # Spotify's oEmbed carries only the track name; the artist is on the page's
            # Open Graph description ("Artist · Song · 2020").
            try:
                html = _http_text(url.strip())
                m = re.search(r'property="og:description"\s+content="([^"]*)"', html)
                if m:
                    artist = m.group(1).split("·")[0].strip()
            except Exception:  # noqa: BLE001 - the artist is a nicety; the title is enough to search
                pass
            return Source("spotify", url.strip(), title, artist, data.get("thumbnail_url"))
        html = _http_text(url.strip())
        m = re.search(r'property="og:title"\s+content="([^"]*)"', html)
        og_title = (m.group(1) if m else "").strip()
        # "Song by Artist on Apple Music"
        m2 = re.match(r"(.+?) by (.+?)(?: on Apple Music)?$", og_title)
        title, artist = (m2.group(1), m2.group(2)) if m2 else (og_title, "")
        thumb = re.search(r'property="og:image"\s+content="([^"]*)"', html)
        return Source("apple_music", url.strip(), title, artist, thumb.group(1) if thumb else None)
    except LinkError:
        raise
    except Exception as exc:  # noqa: BLE001 - network and parse failures all read the same to a user
        raise LinkError("Could not read that link. Check it opens in a browser, or upload the audio file instead.") from exc


# ── Audio ─────────────────────────────────────────────────────────────────────


def _ytdlp_base_args() -> list[str]:
    args = ["yt-dlp", "--no-warnings", "--no-playlist", "--no-progress", "-q"]
    cookies = os.getenv("NF_YTDLP_COOKIES_FILE", "").strip()
    if cookies and Path(cookies).is_file():
        args += ["--cookies", cookies]
    extra = os.getenv("NF_YTDLP_EXTRA_ARGS", "").strip()
    if extra:
        args += shlex.split(extra)
    return args


def _probe_duration(target: str) -> float | None:
    """Seconds, from yt-dlp's metadata, before any bytes of audio are fetched."""
    result = subprocess.run(
        [*_ytdlp_base_args(), "--print", "%(duration)s|%(webpage_url)s", target],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise LinkError(_explain(result.stderr))
    line = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""
    duration, _, _page = line.partition("|")
    try:
        return float(duration)
    except ValueError:
        return None


def _explain(stderr: str) -> str:
    text = stderr.lower()
    if "not a bot" in text or "sign in" in text:
        return "YouTube is refusing automated downloads right now. Upload the audio file instead."
    if "private" in text or "unavailable" in text or "removed" in text:
        return "That video is private or unavailable."
    if "age" in text and "confirm" in text:
        return "That video is age-restricted and cannot be fetched."
    return "Could not fetch audio from that link. Upload the audio file instead."


def fetch_audio(source: Source, max_seconds: float, work_dir: Path | None = None) -> tuple[Path, float]:
    """Download the source's audio (first ``max_seconds``), as a 22 050 Hz mono WAV.

    Returns ``(wav_path, song_duration_seconds)``.  The caller owns the file.  For a
    Spotify or Apple Music source the YouTube search result is used, and ``audio_url``
    on the returned path's source is left for the caller to record.
    """
    target = source.audio_url or f'ytsearch1:"{source.title}" "{source.artist}"'.strip()
    duration = _probe_duration(target)
    work = Path(tempfile.mkdtemp(prefix="nf_link_", dir=str(work_dir) if work_dir else None))
    raw = work / "audio.%(ext)s"
    args = [
        *_ytdlp_base_args(),
        "-f", "bestaudio[ext=m4a]/bestaudio/best",
        "--max-filesize", "60M",
        "-o", str(raw),
    ]
    # ``--download-sections`` asks the downloader for only the first ``max_seconds``,
    # which keeps a long video from costing a long download; ffmpeg below enforces it
    # exactly either way.
    if duration is not None and duration > max_seconds:
        args += ["--download-sections", f"*0-{int(max_seconds) + 2}", "--force-keyframes-at-cuts"]
    result = subprocess.run([*args, target], capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise LinkError(_explain(result.stderr))
    downloaded = sorted(p for p in work.iterdir() if p.name.startswith("audio."))
    if not downloaded:
        raise LinkError("Could not fetch audio from that link. Upload the audio file instead.")

    wav = work / "song.wav"
    ffmpeg = subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", str(downloaded[0]),
            "-t", f"{max_seconds:.2f}", "-ac", "2", "-ar", "44100", "-f", "wav", str(wav),
        ],
        capture_output=True, text=True, timeout=300,
    )
    for p in downloaded:
        p.unlink(missing_ok=True)
    if ffmpeg.returncode != 0 or not wav.is_file():
        raise LinkError("The audio from that link could not be decoded.")
    return wav, float(duration or 0.0)
