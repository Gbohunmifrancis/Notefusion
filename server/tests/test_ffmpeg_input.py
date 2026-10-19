"""An upload is read only as audio: a manifest sent as a recording makes ffmpeg fetch nothing (app.pipeline.ffmpeg_input).

ffmpeg chooses its reader from the content, and its DASH reader fetches the addresses a manifest names even under
``-protocol_whitelist file``. These tests point such a manifest at a listener on this machine and check that no route
by which the worker reads an upload (its own ffmpeg calls, and librosa's audioread fallback) ever reaches it, while
the formats people do send still decode.
"""

import http.server
import shutil
import subprocess
import threading
from pathlib import Path

import librosa
import pytest

from app.api import routes
from app.pipeline import ffmpeg_input, transcriber

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")


@pytest.fixture()
def listener():
    """A local HTTP server that records every request made to it."""
    hits: list[str] = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            hits.append(self.path)
            self.send_response(404)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", hits
    finally:
        server.shutdown()
        server.server_close()


def _manifest(path: Path, base: str) -> Path:
    path.write_text(
        '<?xml version="1.0"?>\n'
        '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" '
        'type="static" mediaPresentationDuration="PT1S" minBufferTime="PT1S"><Period>'
        '<AdaptationSet mimeType="audio/mp4"><Representation id="a" bandwidth="1" codecs="mp4a.40.2">'
        f"<BaseURL>{base}/fetched</BaseURL></Representation></AdaptationSet></Period></MPD>\n"
    )
    return path


@pytest.mark.parametrize("name", ["take.webm", "take.wav", "take.m4a"])
def test_a_manifest_sent_as_a_recording_fetches_nothing(tmp_path, listener, name):
    base, hits = listener
    upload = _manifest(tmp_path / name, base)

    wav, converted = transcriber._ensure_wav_path(upload, max_seconds=5)
    if converted:
        wav.unlink(missing_ok=True)
    with pytest.raises(Exception):
        routes._trim_head(_manifest(tmp_path / f"trim-{name}", base), 5)
    with pytest.raises(Exception):
        librosa.load(str(upload), sr=22_050, duration=5)

    assert hits == []


def test_without_the_guard_the_same_manifest_is_fetched(tmp_path, listener):
    """The test above would pass for the wrong reason if this ffmpeg had no DASH reader: show that it does."""
    base, hits = listener
    upload = _manifest(tmp_path / "take.webm", base)
    subprocess.run(["ffmpeg", "-v", "quiet", "-nostdin", "-y", "-protocol_whitelist", "file", "-i", str(upload),
                    "-t", "1", "-f", "null", "-"], capture_output=True, timeout=30)
    if not hits:
        pytest.skip("this ffmpeg's DASH reader does not fetch under -protocol_whitelist file")
    assert hits


# What people send (routes.ACCEPTED_SUFFIXES), each made here by this machine's ffmpeg.
SAMPLES = {
    "wav": ["-c:a", "pcm_s16le"],
    "flac": ["-c:a", "flac"],
    "mp3": ["-c:a", "libmp3lame"],
    "m4a": ["-c:a", "aac"],
    "mp4": ["-c:a", "aac"],
    "aac": ["-c:a", "aac", "-f", "adts"],
    "ogg": ["-c:a", "libvorbis"],
    "opus": ["-c:a", "libopus"],
    "webm": ["-c:a", "libopus"],
    "weba": ["-c:a", "libopus", "-f", "webm"],
    "caf": ["-c:a", "pcm_s16le"],
}


@pytest.mark.parametrize("suffix", sorted(SAMPLES))
def test_the_formats_people_send_still_decode(tmp_path, suffix):
    sample = tmp_path / f"tone.{suffix}"
    made = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                           *SAMPLES[suffix], str(sample)], capture_output=True, timeout=60)
    if made.returncode != 0:
        pytest.skip(f"this ffmpeg cannot write .{suffix}")

    probe = subprocess.run(["ffprobe", "-v", "error", *ffmpeg_input.INPUT_GUARD, "-show_entries", "format=duration",
                            "-of", "csv=p=0", str(sample)], capture_output=True, text=True, timeout=30)
    assert probe.returncode == 0, probe.stderr

    wav, converted = transcriber._ensure_wav_path(sample, max_seconds=5)
    try:
        y, sr = librosa.load(str(wav), sr=22_050)
        assert len(y) > sr * 0.5
    finally:
        if converted:
            wav.unlink(missing_ok=True)


def test_librosa_falls_back_through_the_guard_for_what_soundfile_cannot_read(tmp_path):
    sample = tmp_path / "tone.m4a"
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                    "-c:a", "aac", str(sample)], check=True, capture_output=True, timeout=60)
    y, sr = librosa.load(str(sample), sr=22_050)
    assert len(y) > sr * 0.5
