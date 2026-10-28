"""The worker's own check of its ladder to YouTube (app/ingest/probe.py), with yt-dlp faked."""

import json
import subprocess

from app.config import settings
from app.ingest import links, probe


def _fake_run(refuse_rungs):
    def run(args, timeout):
        out = args[args.index("-o") + 1]
        rung = "clients" if any(a.startswith("youtube:player_client=") for a in args) else (
            "proxy" if "--proxy" in args else "direct")
        if rung in refuse_rungs:
            return subprocess.CompletedProcess(args, 1, "", "ERROR: [youtube] x: Sign in to confirm you're not a bot. "
                                                            "Use --proxy http://user:secret@proxy.example:8080")
        with open(out.replace("%(ext)s", "m4a"), "wb") as f:
            f.write(b"\0" * 2048)
        return subprocess.CompletedProcess(args, 0, "", "")
    return run


def test_each_rung_fetches_a_few_seconds_on_its_own(monkeypatch, capsys):
    monkeypatch.setattr(settings, "ytdlp_fallback_clients", "mweb,android_vr")
    monkeypatch.setattr(settings, "ytdlp_proxy", "http://user:secret@proxy.example:8080")
    monkeypatch.setattr(settings, "ytdlp_pot_url", "")
    monkeypatch.setattr(links, "_run_group", _fake_run({"direct", "clients"}))

    assert probe.main(["dQw4w9WgXcQ"]) == 0
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]

    assert lines[0]["ladder"]["rungs"] == ["direct", "clients", "proxy"]
    assert lines[0]["ladder"]["proxy"] is True and lines[0]["ladder"]["pot_sidecar_answers"] is None
    assert [(l["rung"], l["fetched"]) for l in lines[1:]] == [("direct", False), ("clients", False), ("proxy", True)]
    assert lines[1]["why"] == "blocked" and lines[3]["bytes"] == 2048
    # The proxy's credentials are never printed, even when yt-dlp's own words carry them.
    assert "secret" not in "\n".join(json.dumps(l) for l in lines)


def test_a_rung_that_times_out_says_so(monkeypatch):
    def slow(args, timeout):
        raise subprocess.TimeoutExpired(args, timeout)
    monkeypatch.setattr(links, "_run_group", slow)
    line = probe.fetch("dQw4w9WgXcQ", links._Route("direct", ()))
    assert line["fetched"] is False and line["why"] == "TimeoutExpired"
