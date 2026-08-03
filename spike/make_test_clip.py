"""Synthesizes test clips with known ground truth for pipeline validation.

Real phone recordings are what matter commercially (TRD par. 7) - these synthetic clips
only prove the pipeline is wired correctly before the real validation set is recorded.
Each clip gets a sidecar .truth.json with the expected notes for scoring.
"""

import json
from pathlib import Path

import numpy as np
import soundfile as sf

SAMPLE_RATE = 22_050
BPM = 100
BEAT_SEC = 60.0 / BPM

RECORDINGS = Path(__file__).parent / "recordings"


def midi_to_hz(midi: int) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def tone(midi: int, dur_sec: float) -> np.ndarray:
    """A plucked-string-ish tone: a few harmonics + exponential decay envelope."""
    t = np.linspace(0, dur_sec, int(SAMPLE_RATE * dur_sec), endpoint=False)
    f0 = midi_to_hz(midi)
    wave = (
        1.00 * np.sin(2 * np.pi * f0 * t)
        + 0.40 * np.sin(2 * np.pi * 2 * f0 * t)
        + 0.20 * np.sin(2 * np.pi * 3 * f0 * t)
        + 0.10 * np.sin(2 * np.pi * 4 * f0 * t)
    )
    envelope = np.minimum(t / 0.01, 1.0) * np.exp(-2.5 * t)
    return wave * envelope


def render(name: str, notes: list[tuple[int, float]]) -> None:
    """notes: list of (midi_pitch, duration_beats); rests use pitch 0."""
    audio = np.array([], dtype=np.float64)
    truth = []
    cursor = 0.0
    for midi, beats in notes:
        dur = beats * BEAT_SEC
        if midi > 0:
            audio = np.concatenate([audio, tone(midi, dur)])
            truth.append({"pitch_midi": midi, "onset_sec": round(cursor, 4), "dur_sec": round(dur, 4)})
        else:
            audio = np.concatenate([audio, np.zeros(int(SAMPLE_RATE * dur))])
        cursor += dur

    audio = (audio / np.max(np.abs(audio)) * 0.8).astype(np.float32)
    wav_path = RECORDINGS / f"{name}.wav"
    sf.write(wav_path, audio, SAMPLE_RATE)
    (RECORDINGS / f"{name}.truth.json").write_text(json.dumps(truth, indent=2))
    print(f"wrote {wav_path.name}: {len(truth)} notes, {len(audio) / SAMPLE_RATE:.1f}s")


C4, D4, E4, F4, G4, A4, B4, C5 = 60, 62, 64, 65, 67, 69, 71, 72

# 1. C major scale up and down - the doh re mi sanity check.
scale = [(p, 1) for p in [C4, D4, E4, F4, G4, A4, B4, C5, B4, A4, G4, F4, E4, D4]] + [(C4, 2)]

# 2. Melody in G major (F# present) - tests key detection away from C.
#    "s s l s d' t" shape of Happy Birthday, transposed to G.
happy_g = [(62, 0.75), (62, 0.25), (64, 1), (62, 1), (67, 1), (66, 2),
           (62, 0.75), (62, 0.25), (64, 1), (62, 1), (69, 1), (67, 2)]

# 3. A natural-minor phrase - tests la-based minor solfa (doh should be C for A minor).
minor_phrase = [(A4 - 12, 1), (B4 - 12, 1), (C4, 1), (D4, 1), (E4, 2), (D4, 1), (C4, 1), (B4 - 12, 2), (A4 - 12, 2)]

if __name__ == "__main__":
    RECORDINGS.mkdir(exist_ok=True)
    render("01_c_major_scale", scale)
    render("02_happy_birthday_g", happy_g)
    render("03_a_minor_phrase", minor_phrase)
