"""Keeping yt-dlp current between image builds.

YouTube changes its player every few weeks, and a yt-dlp from before the change stops
extracting until it is updated.  The image bakes in the newest stable yt-dlp when it is built;
this module installs the newest release of ``settings.ytdlp_update_channel`` beside it at
startup and every ``settings.ytdlp_update_hours``, and ``app.ingest.links`` runs that copy
(``subprocess_env`` puts it first on yt-dlp's ``PYTHONPATH``) whenever it is newer than the
image's.

Each update goes into a fresh directory under ``settings.ytdlp_update_dir`` (``pip install
--target``: yt-dlp and the yt-dlp-ejs release it pins; their other dependencies are the
image's), must import and report a version newer than the one in use, and only then becomes
``current``, a symlink replaced in one step.  A yt-dlp already running keeps the copy it
started with: the previous copy is kept, older ones are removed.  Any failure (no network,
PyPI down, a release that does not import) leaves the copy in use alone and says so in the log.
"""

import importlib.metadata
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)

#: How long one ``pip install`` may take before the update is given up for this round.
PIP_TIMEOUT = 180.0
CURRENT = "current"

_VERSION = re.compile(r"""__version__\s*=\s*['"]([^'"]+)['"]""")
_EJS_PIN = re.compile(r"^Requires-Dist:\s*yt-dlp-ejs\s*==\s*([A-Za-z0-9.]+)", re.M)


class UpdateFailed(Exception):
    pass


def _key(version: str | None) -> tuple[int, ...]:
    """A version as numbers: "2026.08.19" and pip's "2026.8.19" compare equal, and a nightly
    ("2026.09.27.232945") sorts after the stable release it follows."""
    return tuple(int(part) for part in re.findall(r"\d+", version or ""))


def baked_version() -> str | None:
    """The yt-dlp the image was built with."""
    try:
        return importlib.metadata.version("yt-dlp")
    except importlib.metadata.PackageNotFoundError:
        return None


def version_at(directory: Path) -> str | None:
    """The version of the yt-dlp installed in ``directory``, from its own version file."""
    try:
        match = _VERSION.search((directory / "yt_dlp" / "version.py").read_text(encoding="utf-8"))
    except OSError:
        return None
    return match.group(1) if match else None


def active_dir() -> Path | None:
    """The updated copy yt-dlp runs from, or None for the image's own (self-update off, nothing
    installed yet, or the image's is as new)."""
    if not settings.ytdlp_update_dir:
        return None
    try:
        target = (Path(settings.ytdlp_update_dir) / CURRENT).resolve(strict=True)
    except OSError:
        return None
    version = version_at(target)
    if version is None or _key(version) <= _key(baked_version()):
        return None
    return target


def active_version() -> str | None:
    directory = active_dir()
    return version_at(directory) if directory is not None else baked_version()


def subprocess_env() -> dict[str, str] | None:
    """The environment yt-dlp is started with: the updated copy first on ``PYTHONPATH`` (the
    ``yt-dlp`` script then imports it instead of the image's), or None to inherit ours."""
    directory = active_dir()
    if directory is None:
        return None
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(p for p in (str(directory), env.get("PYTHONPATH", "")) if p)
    return env


def _pip(target: Path, *requirement: str) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--no-cache-dir",
         "--no-deps", "--only-binary=:all:", "--target", str(target), *requirement],
        capture_output=True, text=True, timeout=PIP_TIMEOUT)
    if result.returncode != 0:
        tail = " | ".join((result.stderr or result.stdout or "").strip().splitlines()[-2:])[:300]
        raise UpdateFailed(f"pip exited {result.returncode}: {tail or 'no output'}")


def _ejs_pin(target: Path) -> str | None:
    """The yt-dlp-ejs release the freshly installed yt-dlp asks for (its ``default`` extra)."""
    for metadata in target.glob("yt_dlp-*.dist-info/METADATA"):
        match = _EJS_PIN.search(metadata.read_text(encoding="utf-8", errors="replace"))
        if match:
            return match.group(1)
    return None


def _smoke(target: Path, version: str) -> None:
    """The new copy must start and name its version before anything runs it."""
    env = dict(os.environ, PYTHONPATH=str(target))
    result = subprocess.run([sys.executable, "-m", "yt_dlp", "--version"], capture_output=True, text=True,
                            timeout=60, env=env)
    if result.returncode != 0 or result.stdout.strip() != version:
        raise UpdateFailed(f"the new yt-dlp did not start (exit {result.returncode})")


def _swap(root: Path, fresh: Path) -> Path | None:
    """Point ``current`` at ``fresh`` in one step; the directory it pointed at before."""
    link = root / CURRENT
    try:
        previous = link.resolve(strict=True)
    except OSError:
        previous = None
    staging = root / f".{CURRENT}-{os.getpid()}"
    staging.unlink(missing_ok=True)
    os.symlink(fresh.name, staging)
    os.replace(staging, link)
    return previous


def _prune(root: Path, keep: set[Path]) -> None:
    for child in root.iterdir():
        if child.is_dir() and not child.is_symlink() and child.name.startswith("v") and child.resolve() not in keep:
            shutil.rmtree(child, ignore_errors=True)


def update() -> str | None:
    """Install the newest yt-dlp of the configured channel when it is newer than the one in use.
    The version now in use when it changed; None when nothing changed (already current, or the
    update failed, which is logged and otherwise harmless)."""
    if not settings.ytdlp_update_dir:
        return None
    root = Path(settings.ytdlp_update_dir)
    channel = "stable" if settings.ytdlp_update_channel == "stable" else "nightly"
    in_use = active_version()
    try:
        root.mkdir(parents=True, exist_ok=True)
        # Its own name, even for two updates in one second: a failed one deletes only itself.
        fresh = Path(tempfile.mkdtemp(prefix=f"v{time.strftime('%Y%m%d%H%M%S')}-", dir=root))
    except OSError as exc:
        logger.warning("yt-dlp update failed (%s); staying on %s", exc, in_use or "the image's copy")
        return None
    try:
        _pip(fresh, *(["--pre"] if channel == "nightly" else []), "yt-dlp")
        version = version_at(fresh)
        if version is None:
            raise UpdateFailed("pip installed no yt-dlp")
        if _key(version) <= _key(in_use):
            shutil.rmtree(fresh, ignore_errors=True)
            logger.info("yt-dlp %s is the newest %s release; no update", in_use, channel)
            return None
        ejs = _ejs_pin(fresh)
        if ejs:
            _pip(fresh, f"yt-dlp-ejs=={ejs}")
        _smoke(fresh, version)
        previous = _swap(root, fresh)
        _prune(root, {fresh.resolve(), *([previous] if previous else [])})
    except (UpdateFailed, OSError, subprocess.SubprocessError) as exc:
        shutil.rmtree(fresh, ignore_errors=True)
        logger.warning("yt-dlp update failed (%s); staying on %s", exc, in_use or "the image's copy")
        return None
    logger.info("yt-dlp updated %s -> %s (%s channel)", in_use, version, channel)
    return version


def start_background() -> threading.Thread | None:
    """Update now and then every ``settings.ytdlp_update_hours``, in a daemon thread (startup
    does not wait: until the first update lands, the image's yt-dlp runs)."""
    logger.info("yt-dlp %s in use (image %s); self-update %s", active_version(), baked_version(),
                f"every {settings.ytdlp_update_hours:g} h, {settings.ytdlp_update_channel} channel"
                if settings.ytdlp_update_dir else "off")
    if not settings.ytdlp_update_dir:
        return None

    def loop() -> None:
        while True:
            try:
                update()
            except Exception:  # noqa: BLE001 - an update must never take the worker down
                logger.exception("yt-dlp update crashed")
            if settings.ytdlp_update_hours <= 0:
                return
            time.sleep(settings.ytdlp_update_hours * 3600)

    thread = threading.Thread(target=loop, name="ytdlp-update", daemon=True)
    thread.start()
    return thread
