"""The worker's own check of its way to YouTube: each rung of the ladder (``links._routes``) asked on its own to
fetch ten seconds of a video, with the cookies, proof-of-origin tokens and proxy the jobs use.

    docker compose exec transcriber python -m app.ingest.probe [VIDEO_ID ...]
    docker compose exec transcriber python -m app.ingest.probe --links     # the link test matrix

Prints the ladder as configured, then one line per video and rung: fetched (bytes, seconds) or not (yt-dlp's
words read as blocked / unavailable / age_restricted / other, and the last lines of its error, a proxy's
credentials masked).  A download, not only the video's details: YouTube can answer the details and still refuse
the audio, which a details-only probe passes and every job fails.  Never prints the proxy's address or the
cookies; asks YouTube once per video and rung and leaves nothing behind.  Run by ``.github/workflows/check-ec2.yml``.

``--links`` runs the controlled link test matrix instead (``link_matrix.json``): one public link per shape a person
pastes, each through the worker's own parse (``provider_of``), resolve (``resolve_link``) and a ten-second fetch
(``fetch_audio``), the way a job takes it, and whether it ended as expected: fetched, the store's preview, or the
failure code (``links.failure_code``) at the step it stopped (``links.STAGES``).
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from app.config import settings
from app.ingest import links, ytdlp_update

#: An upload YouTube has served for years, and an upload of the kind people send here (Nigerian gospel).
DEFAULT_VIDEOS = ("dQw4w9WgXcQ", "awexlghI7gM")
SECONDS = 10
TIMEOUT_SECONDS = 120.0


def _sidecar_answers() -> bool | None:
    """Whether the proof-of-origin sidecar answers its ping; None when none is configured."""
    if not settings.ytdlp_pot_url:
        return None
    try:
        with urllib.request.urlopen(settings.ytdlp_pot_url.rstrip("/") + "/ping", timeout=5) as response:
            return 200 <= response.status < 300
    except Exception:  # noqa: BLE001 - unreachable, refused or slow: it does not answer
        return False


def _cookie_rows() -> int:
    """youtube.com rows in the cookies file the jobs use (a count, never a value); 0 without one."""
    path = Path(os.getenv("NF_YTDLP_COOKIES_FILE", "").strip() or "/nonexistent")
    try:
        return sum(1 for line in path.read_text(encoding="utf-8", errors="replace").splitlines() if "youtube.com" in line)
    except OSError:
        return 0


def ladder() -> dict:
    """The ladder as configured: its rungs in order and what each leans on."""
    return {
        "rungs": [route.name for route in links._routes("youtube")],
        "fallback_clients": settings.ytdlp_fallback_clients or None,
        "proxy": bool(settings.ytdlp_proxy),
        "pot_sidecar": bool(settings.ytdlp_pot_url),
        "pot_sidecar_answers": _sidecar_answers(),
        "cookie_rows": _cookie_rows(),
        "ytdlp": ytdlp_update.active_version(),
        "ytdlp_image": ytdlp_update.baked_version(),
    }


def fetch(video_id: str, route: links._Route, seconds: int = SECONDS) -> dict:
    """One rung's try at ``seconds`` of the video's audio."""
    work = Path(tempfile.mkdtemp(prefix="nf_probe_"))
    started = time.monotonic()
    try:
        with links._ytdlp_args() as base:
            args = [*base, *route.args, "-f", links._AUDIO_FORMAT, "--download-sections", f"*0-{seconds}",
                    "-o", str(work / "probe.%(ext)s"), f"https://www.youtube.com/watch?v={video_id}"]
            try:
                done = links._run_group(args, TIMEOUT_SECONDS)
            except Exception as exc:  # noqa: BLE001 - a timeout or a missing yt-dlp is this rung's answer
                return {"video": video_id, "rung": route.name, "fetched": False, "why": type(exc).__name__,
                        "seconds": round(time.monotonic() - started, 1)}
        got = [p for p in work.iterdir() if p.is_file() and p.stat().st_size > 0]
        line = {"video": video_id, "rung": route.name, "fetched": done.returncode == 0 and bool(got),
                "seconds": round(time.monotonic() - started, 1)}
        if line["fetched"]:
            line["bytes"] = got[0].stat().st_size
        else:
            line["why"] = links.classify(done.stderr)
            line["said"] = links._log_tail(done.stderr)
        return line
    finally:
        shutil.rmtree(work, ignore_errors=True)


MATRIX = Path(__file__).with_name("link_matrix.json")


def try_link(url: str) -> dict:
    """One link the way a job takes it: parse, resolve, then ten seconds of its audio."""
    started = time.monotonic()
    line: dict = {}
    if links.provider_of(url) is None:
        return {"outcome": "not_a_song_link", "stage": "parse", "seconds": 0.0}
    work = Path(tempfile.mkdtemp(prefix="nf_matrix_"))
    try:
        source = links.resolve_link(url)
        line.update(provider=source.provider, title=source.title[:60], artist=source.artist[:40], duration=source.duration)
        got = links.fetch_audio(source, SECONDS, work_dir=work, start_seconds=0.0, end_seconds=float(SECONDS))
        line.update(outcome="preview" if got.preview else "fetched", wav_bytes=got.path.stat().st_size)
    except links.LinkError as refusal:
        line.update(outcome=links.failure_code(refusal), stage=refusal.stage, said=str(refusal)[:120])
    except Exception as exc:  # noqa: BLE001 - anything else is this link's answer too
        line.update(outcome=links.failure_code(exc), stage="other", said=type(exc).__name__)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    line["seconds"] = round(time.monotonic() - started, 1)
    return line


def matrix() -> int:
    """Runs ``link_matrix.json``; prints a line per case and a summary, and is 1 when any case ended otherwise."""
    cases = json.loads(MATRIX.read_text(encoding="utf-8"))["cases"]
    missed = 0
    for case in cases:
        line = {"case": case["name"], "expect": case["expect"], **try_link(case["url"])}
        line["as_expected"] = line["outcome"] == case["expect"]
        missed += not line["as_expected"]
        print(json.dumps(line), flush=True)
    print(json.dumps({"cases": len(cases), "as_expected": len(cases) - missed}))
    return 1 if missed else 0


def main(argv: list[str]) -> int:
    if argv[:1] == ["--links"]:
        return matrix()
    print(json.dumps({"ladder": ladder()}))
    for video_id in argv or DEFAULT_VIDEOS:
        for route in links._routes("youtube"):
            print(json.dumps(fetch(video_id, route)), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
