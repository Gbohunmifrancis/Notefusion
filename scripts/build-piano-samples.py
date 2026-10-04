#!/usr/bin/env python3
"""Build the piano sample pack both clients play notes with.

Source: the Salamander Grand Piano V3 soft layer (velocity 5 of 16), the 17 notes
C2..C6 every three semitones, as the MP3s @tonejs/piano serves from
https://tambien.github.io/Piano/audio/. Alexander Holm's recording, CC BY 3.0 — the
LICENSE.txt written next to the outputs carries the attribution the licence asks for.

Each note is mixed to mono, resampled to 22 050 Hz (the synth rate in
mobile/src/lib/synth.ts), trimmed to its onset (−40 dB, backed off 2 ms), kept for
KEEP_SEC with a cosine fade over the last FADE_SEC, and loudness-matched on the RMS of
its first 300 ms. The matched set is then scaled as one so the loudest peak in it is
PEAK_CEILING: the clients multiply a sample by the velocity (0.55..0.9) and nothing
else, so a single note can never reach their limiters.

Salamander is stretch-tuned (bass flat, treble sharp of equal temperament), which a
singing reference cannot be, so the fundamental of each processed note is measured
and written to tuning.json as `centsSharp` — how far the note sounds above equal
temperament. The players correct it in the playback rate: rate *= 2^(-centsSharp/1200).

Outputs (checked in):
  mobile/assets/piano/<Note>.wav     PCM16 mono 22 050 Hz, ~150 KB each
  web-site/assets/piano/<Note>.mp3   64 kbps, ~28 KB each
  <both>/tuning.json, <both>/LICENSE.txt

Usage: python scripts/build-piano-samples.py [--cache DIR]
Needs ffmpeg (with libmp3lame), numpy and soundfile. --cache keeps the downloaded
originals between runs (default: .cache/salamander under the repo).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://tambien.github.io/Piano/audio/{name}v{velocity}.mp3"
VELOCITY_LAYER = 5

SAMPLE_RATE = 22_050
NOTE_NAMES = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"]
MIDIS = list(range(36, 85, 3))  # C2 .. C6

KEEP_SEC = 3.5
FADE_SEC = 0.6
ONSET_DB = -40.0
ONSET_BACKOFF_SEC = 0.002
RMS_WINDOW_SEC = 0.3
RMS_TARGET_DB = -18.0
PEAK_CEILING = 0.8
MP3_BITRATE = "64k"

MOBILE_DIR = ROOT / "mobile" / "assets" / "piano"
WEB_DIR = ROOT / "web-site" / "assets" / "piano"

LICENSE_TEXT = """Piano sound: Salamander Grand Piano V3 by Alexander Holm
(https://archive.org/details/SalamanderGrandPianoV3), licensed under CC BY 3.0
(https://creativecommons.org/licenses/by/3.0/). Converted to mono, resampled,
trimmed and level-matched for NoteFusion.

The 17 notes here (C2 to C6, every three semitones) are the soft layer (velocity 5
of 16) of that recording, taken from the MP3 set published for @tonejs/piano at
https://tambien.github.io/Piano/audio/. Changes made by NoteFusion, as the licence
requires us to say: stereo mixed to mono; resampled to 22 050 Hz; trimmed to the
onset and to 3.5 seconds with a 0.6 second fade; loudness-matched across the set;
their pitch measured and written to tuning.json so a player can correct the piano's
stretch tuning to equal temperament.
"""


def note_name(midi: int) -> str:
    return f"{NOTE_NAMES[midi % 12]}{midi // 12 - 1}"


def nominal_hz(midi: int) -> float:
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def fetch(url: str, dest: Path) -> None:
    if dest.is_file():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}")
    with urllib.request.urlopen(url, timeout=60) as resp, open(dest, "wb") as out:
        out.write(resp.read())


def decode_mono(path: Path) -> np.ndarray:
    """ffmpeg: any input -> float32 mono at SAMPLE_RATE."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def trim_and_fade(x: np.ndarray) -> np.ndarray:
    peak = np.abs(x).max()
    onset = int(np.argmax(np.abs(x) > peak * 10 ** (ONSET_DB / 20)))
    onset = max(0, onset - int(ONSET_BACKOFF_SEC * SAMPLE_RATE))
    y = x[onset : onset + int(KEEP_SEC * SAMPLE_RATE)].copy()
    fade = int(FADE_SEC * SAMPLE_RATE)
    y[-fade:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(fade) / fade)
    return y


def cents_sharp(x: np.ndarray, midi: int) -> float:
    """The fundamental's offset from equal temperament, in cents (positive = sharp).

    Measured on the second 0.1..1.1 s of the note — past the attack, before the fade —
    as the interpolated peak of a Hann-windowed, 16x zero-padded spectrum within
    ±50 cents of the nominal pitch. The fundamental, not the period: a soft piano
    note's fundamental is its loudest partial from C3 up, and what a singer tunes to.
    """
    seg = x[int(0.1 * SAMPLE_RATE) : int(1.1 * SAMPLE_RATE)]
    seg = seg - seg.mean()
    n = len(seg) * 16
    spectrum = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n))
    freqs = np.fft.rfftfreq(n, 1.0 / SAMPLE_RATE)
    f0 = nominal_hz(midi)
    window = np.where((freqs > f0 * 2 ** (-50 / 1200)) & (freqs < f0 * 2 ** (50 / 1200)))[0]
    j = window[int(np.argmax(spectrum[window]))]
    a, b, c = spectrum[j - 1], spectrum[j], spectrum[j + 1]
    shift = 0.5 * (a - c) / (a - 2 * b + c)
    measured = freqs[j] + shift * (freqs[1] - freqs[0])
    return float(1200.0 * np.log2(measured / f0))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache" / "salamander", help="where the downloaded originals are kept")
    args = parser.parse_args()

    MOBILE_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DIR.mkdir(parents=True, exist_ok=True)

    processed: dict[int, np.ndarray] = {}
    for midi in MIDIS:
        name = note_name(midi)
        src = args.cache / f"{name}v{VELOCITY_LAYER}.mp3"
        fetch(SOURCE_URL.format(name=name, velocity=VELOCITY_LAYER), src)
        y = trim_and_fade(decode_mono(src))
        rms = np.sqrt(np.mean(y[: int(RMS_WINDOW_SEC * SAMPLE_RATE)] ** 2))
        processed[midi] = y * (10 ** (RMS_TARGET_DB / 20) / rms)

    # One gain for the whole set keeps the loudness match and puts the loudest peak at the ceiling.
    set_gain = PEAK_CEILING / max(np.abs(y).max() for y in processed.values())

    tuning: dict[str, float] = {}
    wav_bytes = mp3_bytes = 0
    print(f"{'note':5s} {'peak':>6s} {'cents':>7s}")
    for midi in MIDIS:
        name = note_name(midi)
        y = processed[midi] * set_gain
        offset = cents_sharp(y, midi)
        tuning[name] = round(offset, 1)
        wav_path = MOBILE_DIR / f"{name}.wav"
        sf.write(str(wav_path), y, SAMPLE_RATE, subtype="PCM_16")
        mp3_path = WEB_DIR / f"{name}.mp3"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(wav_path), "-c:a", "libmp3lame", "-b:a", MP3_BITRATE, str(mp3_path)],
            check=True,
        )
        wav_bytes += wav_path.stat().st_size
        mp3_bytes += mp3_path.stat().st_size
        print(f"{name:5s} {np.abs(y).max():6.3f} {offset:+7.1f}")

    tuning_json = json.dumps({"sampleRate": SAMPLE_RATE, "centsSharp": tuning}, indent=2) + "\n"
    for folder in (MOBILE_DIR, WEB_DIR):
        (folder / "tuning.json").write_text(tuning_json)
        (folder / "LICENSE.txt").write_text(LICENSE_TEXT)
    print(f"{len(MIDIS)} notes: wav {wav_bytes // 1024} KB, mp3 {mp3_bytes // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
