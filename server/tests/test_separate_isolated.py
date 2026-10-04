"""The vocal separation runs in a child process and hands its memory back; these cover the
plumbing with a stand-in child, and the real model once when it is on the machine."""

import os
import sys
import textwrap
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.pipeline import separate


def _child(script: str):
    """A stand-in for ``python -m app.pipeline.separate``: the same argv, our own body."""
    body = textwrap.dedent(script)

    def command(wav, out, backing):
        argv = [sys.executable, "-u", "-c", body, str(wav), str(out)]
        if backing is not None:
            argv += ["--backing", str(backing)]
        return argv

    return command


WRITES_STEMS = """
    import sys, soundfile as sf, numpy as np
    out = sys.argv[2]; backing = sys.argv[4] if len(sys.argv) > 4 else None
    for f in (0.25, 0.5, 1.0):
        print(f"progress {f}", flush=True)
    sf.write(out, np.zeros(22050, dtype="float32"), 22050)
    if backing: sf.write(backing, np.zeros(22050, dtype="float32"), 22050)
    print("done", flush=True)
"""


def test_progress_is_relayed_and_the_stem_comes_back(monkeypatch, tmp_path):
    monkeypatch.setattr(separate, "IN_PROCESS", False)
    monkeypatch.setattr(separate, "_child_command", _child(WRITES_STEMS))
    seen = []
    out = separate.separate_file(tmp_path / "in.wav", tmp_path / "vocals.wav", progress=seen.append,
                                 backing_path=tmp_path / "backing.wav")
    assert out == tmp_path / "vocals.wav" and out.is_file() and (tmp_path / "backing.wav").is_file()
    assert seen == [0.25, 0.5, 1.0]


def test_a_child_that_fails_is_a_separation_failure_with_its_last_words(monkeypatch, tmp_path):
    monkeypatch.setattr(separate, "IN_PROCESS", False)
    monkeypatch.setattr(separate, "_child_command", _child("""
        import sys
        print("progress 0.5", flush=True)
        print("something went wrong in the model", file=sys.stderr)
        sys.exit(3)
    """))
    with pytest.raises(separate.SeparationFailed, match="exit 3.*something went wrong"):
        separate.separate_file(tmp_path / "in.wav", tmp_path / "vocals.wav")


def test_a_child_the_kernel_killed_is_an_out_of_memory(monkeypatch, tmp_path):
    monkeypatch.setattr(separate, "IN_PROCESS", False)
    monkeypatch.setattr(separate, "_child_command", _child("""
        import os, signal
        os.kill(os.getpid(), signal.SIGKILL)
    """))
    with pytest.raises(MemoryError):
        separate.separate_file(tmp_path / "in.wav", tmp_path / "vocals.wav")


def test_a_child_that_never_finishes_is_given_up_on(monkeypatch, tmp_path):
    monkeypatch.setattr(separate, "IN_PROCESS", False)
    monkeypatch.setattr(separate, "SEPARATE_TIMEOUT", 0.5)
    monkeypatch.setattr(separate, "_child_command", _child("""
        import time
        print("progress 0.1", flush=True)
        time.sleep(30)
    """))
    with pytest.raises(separate.SeparationFailed, match="gave up"):
        separate.separate_file(tmp_path / "in.wav", tmp_path / "vocals.wav")


def test_a_child_that_writes_nothing_is_a_failure_too(monkeypatch, tmp_path):
    monkeypatch.setattr(separate, "IN_PROCESS", False)
    monkeypatch.setattr(separate, "_child_command", _child("print('done')"))
    with pytest.raises(separate.SeparationFailed, match="without writing"):
        separate.separate_file(tmp_path / "in.wav", tmp_path / "vocals.wav")


def test_in_process_is_still_there_behind_the_switch(monkeypatch, tmp_path):
    monkeypatch.setattr(separate, "IN_PROCESS", True)
    monkeypatch.setattr(separate, "_separate_here", lambda wav, out, progress=None, backing_path=None: Path("here"))
    monkeypatch.setattr(separate, "_child_command", lambda *a: pytest.fail("the child must not be used"))
    assert separate.separate_file(tmp_path / "in.wav", tmp_path / "vocals.wav") == Path("here")


@pytest.mark.skipif(not separate.available(), reason="the separation model is not on this machine")
def test_the_real_model_runs_in_the_child(tmp_path):
    """The whole road once: a two-second tone through the real child and the real model."""
    sr = separate.SAMPLE_RATE
    t = np.arange(sr * 2) / sr
    y = (0.2 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    sf.write(str(tmp_path / "in.wav"), np.stack([y, y], 1), sr)
    seen = []
    out = separate.separate_file(tmp_path / "in.wav", tmp_path / "vocals.wav", progress=seen.append,
                                 backing_path=tmp_path / "backing.wav")
    assert out.is_file() and (tmp_path / "backing.wav").is_file()
    assert seen and seen[-1] == 1.0 and seen == sorted(seen)
    info = sf.info(str(out))
    assert info.samplerate == 22_050 and abs(info.duration - 2.0) < 0.05
