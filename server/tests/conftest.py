"""Test-wide environment. The app refuses to start without NF_API_KEY unless told it may
(``app.main._require_api_key``); the tests run it keyless, and the auth tests set a key."""

import os

import pytest

os.environ.setdefault("NF_ALLOW_NO_AUTH", "1")


@pytest.fixture
def ytdlp_via_subprocess_run(monkeypatch):
    """yt-dlp runs through ``links._run_group`` (Popen, its own process group); the link tests
    fake ``subprocess.run`` as yt-dlp, so this hands the call to whatever ``run`` they set."""
    from app.ingest import links

    monkeypatch.setattr(links, "_run_group", lambda args, timeout: links.subprocess.run(
        args, capture_output=True, text=True, timeout=timeout))
