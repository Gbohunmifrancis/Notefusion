"""yt-dlp keeping itself current (``app.ingest.ytdlp_update``): an update lands only when it
installs, starts and is newer; anything else leaves the copy in use alone.  pip is faked."""

import logging
import subprocess
from pathlib import Path

import pytest

from app.config import settings
from app.ingest import ytdlp_update


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ytdlp_update_dir", str(tmp_path / "ytdlp"))
    monkeypatch.setattr(settings, "ytdlp_update_channel", "nightly")
    monkeypatch.setattr(ytdlp_update, "baked_version", lambda: "2026.8.19")
    return tmp_path / "ytdlp"


def _fake_pip(calls, *, version="2026.09.27.232945", fail=False, timeout=False, starts=True):
    """subprocess.run as pip (writing a yt-dlp of ``version`` into --target) and as the new
    yt-dlp's ``--version``."""

    def run(args, **kwargs):
        calls.append(list(args))
        if "--version" in args:
            return subprocess.CompletedProcess(args, 0 if starts else 1, version + "\n" if starts else "", "")
        if timeout:
            raise subprocess.TimeoutExpired(args, kwargs.get("timeout", 0))
        if fail:
            return subprocess.CompletedProcess(args, 1, "", "ERROR: Could not find a version that satisfies yt-dlp\n"
                                                         "Network is unreachable")
        target = Path(args[args.index("--target") + 1])
        if args[-1] == "yt-dlp":
            (target / "yt_dlp").mkdir(parents=True)
            (target / "yt_dlp" / "version.py").write_text(f"__version__ = '{version}'\n")
            (target / "yt_dlp" / "__main__.py").write_text("")
            meta = target / f"yt_dlp-{version}.dist-info"
            meta.mkdir()
            (meta / "METADATA").write_text("Name: yt-dlp\nRequires-Dist: yt-dlp-ejs==0.8.0; extra == \"default\"\n")
        else:
            (target / "yt_dlp_ejs").mkdir()
        return subprocess.CompletedProcess(args, 0, "", "")

    return run


def test_an_update_lands_atomically_and_yt_dlp_runs_it(root, monkeypatch):
    calls = []
    monkeypatch.setattr(ytdlp_update.subprocess, "run", _fake_pip(calls))
    assert ytdlp_update.update() == "2026.09.27.232945"
    current = (root / "current").resolve()
    assert (root / "current").is_symlink() and (current / "yt_dlp_ejs").is_dir()
    pips = [c for c in calls if "pip" in c]
    assert "--pre" in pips[0] and pips[0][-1] == "yt-dlp"  # nightly
    assert pips[1][-1] == "yt-dlp-ejs==0.8.0"  # the solver release that yt-dlp pins
    assert all("--no-deps" in c for c in pips)
    env = ytdlp_update.subprocess_env()
    assert env["PYTHONPATH"].split(":")[0] == str(current)
    assert ytdlp_update.active_version() == "2026.09.27.232945"


def test_the_stable_channel_asks_for_no_pre_release(root, monkeypatch):
    calls = []
    monkeypatch.setattr(settings, "ytdlp_update_channel", "stable")
    monkeypatch.setattr(ytdlp_update.subprocess, "run", _fake_pip(calls, version="2026.09.01"))
    assert ytdlp_update.update() == "2026.09.01"
    assert "--pre" not in calls[0]


@pytest.mark.parametrize("trouble", [{"fail": True}, {"timeout": True}, {"starts": False}])
def test_a_failed_update_leaves_the_images_yt_dlp_in_use(root, monkeypatch, caplog, trouble):
    monkeypatch.setattr(ytdlp_update.subprocess, "run", _fake_pip([], **trouble))
    with caplog.at_level(logging.WARNING, logger="app.ingest.ytdlp_update"):
        assert ytdlp_update.update() is None
    assert not (root / "current").exists()
    assert ytdlp_update.subprocess_env() is None  # the yt-dlp script runs the image's copy
    assert not [p for p in root.iterdir() if p.name.startswith("v")]  # the half-install is gone
    assert any("yt-dlp update failed" in r.getMessage() and "staying on 2026.8.19" in r.getMessage()
               for r in caplog.records)


def test_a_failed_update_keeps_the_last_good_one(root, monkeypatch):
    monkeypatch.setattr(ytdlp_update.subprocess, "run", _fake_pip([]))
    good = ytdlp_update.update()
    monkeypatch.setattr(ytdlp_update.subprocess, "run", _fake_pip([], fail=True))
    assert ytdlp_update.update() is None
    assert ytdlp_update.active_version() == good


def test_nothing_newer_changes_nothing(root, monkeypatch):
    monkeypatch.setattr(ytdlp_update.subprocess, "run", _fake_pip([], version="2026.08.19"))
    assert ytdlp_update.update() is None
    assert not (root / "current").exists() and not list(root.iterdir())


def test_older_copies_are_pruned_but_the_one_before_is_kept(root, monkeypatch):
    for version in ("2026.09.01", "2026.09.10", "2026.09.20"):
        monkeypatch.setattr(ytdlp_update.subprocess, "run", _fake_pip([], version=version))
        monkeypatch.setattr(ytdlp_update.time, "strftime", lambda fmt, v=version: v.replace(".", ""))
        assert ytdlp_update.update() == version
    kept = sorted(p.name for p in root.iterdir() if p.name.startswith("v"))
    assert len(kept) == 2 and kept[1].startswith("v20260920")
    assert ytdlp_update.active_version() == "2026.09.20"


def test_an_image_newer_than_the_update_wins(root, monkeypatch):
    monkeypatch.setattr(ytdlp_update.subprocess, "run", _fake_pip([], version="2026.09.01"))
    ytdlp_update.update()
    monkeypatch.setattr(ytdlp_update, "baked_version", lambda: "2026.10.01")
    assert ytdlp_update.active_dir() is None and ytdlp_update.subprocess_env() is None


def test_off_without_a_directory(monkeypatch):
    monkeypatch.setattr(settings, "ytdlp_update_dir", "")
    monkeypatch.setattr(ytdlp_update.subprocess, "run", lambda *a, **k: pytest.fail("no pip when off"))
    assert ytdlp_update.update() is None
    assert ytdlp_update.start_background() is None
    assert ytdlp_update.subprocess_env() is None


def test_versions_compare_as_numbers():
    key = ytdlp_update._key
    assert key("2026.08.19") == key("2026.8.19")
    assert key("2026.09.27.232945") > key("2026.09.27") > key("2026.8.19")
