"""Chord-reading benchmark: rendered piano progressions, chord symbol right per beat.

    python -m tests.accuracy.chords_bench            # chords mode + the backing path, ~2 minutes

Each case is a progression in a known key, rendered as piano (block chords in close
position, broken chords, a left-hand bass with slash chords, with and without a melody on
top) at its own tempo.  The score is the share of the true beats on which the chord read
there has the right root *and* quality ("G7" for G7, not "G"); a beat is judged at its
middle, in seconds, so a tempo read at double or half speed costs nothing by itself.

Two paths are measured:
  chords   ``transcribe(mode="chords")`` end to end: Basic Pitch notes + audio, its own
           beat grid, its own key.
  backing  ``chords.read_chords`` on the audio alone (no notes) on the true beat grid: what
           a song's instrumental gets in melody mode.

The piano is the recorded Salamander Grand soft layer when its samples are found (the
clients' ``mobile/assets/piano/*.wav``, or a folder named by ``NF_PIANO_SAMPLES``), and an
additive piano with decaying, slightly inharmonic partials otherwise; the header says which.
Measurement only, never run by ``pytest``; ``tests/test_chords.py`` imports the renderer.
"""

from __future__ import annotations

import os
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import soundfile as sf

SAMPLE_RATE = 22_050
_NAMES = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"]
_LETTER_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_QUALITY_OF = {"": "maj", "m": "min", "7": "7", "maj7": "maj7", "m7": "min7", "dim": "dim", "sus4": "sus4"}
_INTERVALS = {"maj": (0, 4, 7), "min": (0, 3, 7), "7": (0, 4, 7, 10), "maj7": (0, 4, 7, 11),
              "min7": (0, 3, 7, 10), "dim": (0, 3, 6), "sus4": (0, 5, 7)}


# ── Piano ─────────────────────────────────────────────────────────────────────


def _sample_dir() -> Path | None:
    candidates = [os.environ.get("NF_PIANO_SAMPLES", "")]
    candidates.append(str(Path(__file__).resolve().parents[3] / "mobile" / "assets" / "piano"))
    for c in candidates:
        if c and (Path(c) / "C4.wav").is_file():
            return Path(c)
    return None


_SAMPLES: dict[int, np.ndarray] | None = None


def piano_samples() -> dict[int, np.ndarray] | None:
    """MIDI -> mono sample at SAMPLE_RATE for the 17 recorded notes, or None if absent."""
    global _SAMPLES
    if _SAMPLES is None:
        folder = _sample_dir()
        if folder is None:
            return None
        loaded = {}
        for midi in range(36, 85, 3):
            path = folder / f"{_NAMES[midi % 12]}{midi // 12 - 1}.wav"
            if path.is_file():
                y, sr = sf.read(str(path), dtype="float32", always_2d=True)
                y = y.mean(axis=1)
                if sr != SAMPLE_RATE:
                    import librosa
                    y = librosa.resample(y, orig_sr=sr, target_sr=SAMPLE_RATE)
                loaded[midi] = y
        _SAMPLES = loaded or None
    return _SAMPLES


def _additive_note(midi: int, dur: float, vel: float) -> np.ndarray:
    """A plain piano-like tone: inharmonic partials, each decaying faster the higher it is."""
    f0 = 440.0 * 2.0 ** ((midi - 69) / 12.0)
    tail = 0.25
    n = int((dur + tail) * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    tau = 2.5 * 2.0 ** (-(midi - 48) / 24.0)
    out = np.zeros(n)
    for k in range(1, 13):
        fk = k * f0 * np.sqrt(1.0 + 1.2e-4 * k * k)
        if fk > SAMPLE_RATE / 2 - 500:
            break
        out += (1.0 / k ** 1.3) * np.exp(-t * (1.0 + 0.35 * k) / tau) * np.sin(2 * np.pi * fk * t)
    env = np.minimum(1.0, t / 0.004)
    env *= np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.06))
    return vel * out * env


def _sampled_note(samples: dict[int, np.ndarray], midi: int, dur: float, vel: float) -> np.ndarray:
    base = min(samples, key=lambda s: abs(s - midi))
    src = samples[base]
    rate = 2.0 ** ((midi - base) / 12.0)
    tail = 0.12
    n = min(int((dur + tail) * SAMPLE_RATE), int((len(src) - 1) / rate))
    pos = np.arange(n) * rate
    i = pos.astype(int)
    frac = pos - i
    y = src[i] * (1 - frac) + src[np.minimum(i + 1, len(src) - 1)] * frac
    t = np.arange(n) / SAMPLE_RATE
    y = y * np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.04))
    return vel * 4.0 * y


def render(notes: list[tuple[float, float, int, float]], seconds: float, use_samples: bool = True) -> np.ndarray:
    """``(start_sec, dur_sec, midi, velocity)`` notes as a mono buffer of ``seconds``."""
    samples = piano_samples() if use_samples else None
    y = np.zeros(int((seconds + 1.0) * SAMPLE_RATE))
    for start, dur, midi, vel in notes:
        tone = _sampled_note(samples, midi, dur, vel) if samples else _additive_note(midi, dur, vel)
        a = int(start * SAMPLE_RATE)
        b = min(len(y), a + len(tone))
        y[a:b] += tone[: b - a]
    peak = float(np.max(np.abs(y))) or 1.0
    return (0.8 * y / peak).astype(np.float32)


# ── Progressions ──────────────────────────────────────────────────────────────


def parse_symbol(symbol: str) -> tuple[int, str, int | None]:
    """"F#m7/C#" -> (root pc, quality, bass pc or None)."""
    def pc(name: str) -> int:
        return (_LETTER_PC[name[0]] + name.count("#") - name[1:].count("b")) % 12

    body, _, bass = symbol.partition("/")
    root = body[:2] if len(body) > 1 and body[1] in "#b" else body[:1]
    quality = _QUALITY_OF[body[len(root):]]
    return pc(root), quality, (pc(bass) if bass else None)


@dataclass
class Case:
    name: str
    key: str  # e.g. "F major"
    bpm: float
    chords: list[tuple[str, int]]  # (symbol, beats)
    style: str = "block"  # block | broken | bass
    melody: bool = False
    inversion: int = 0  # rotate the right hand's close voicing this many times
    lead_in: float = 0.4
    truth: list[tuple[float, float, int, str]] = field(default_factory=list)  # (t0, t1, root, quality)


def _voicing(root: int, quality: str, inversion: int, low: int = 57) -> list[int]:
    """Close position above ``low`` (A3 by default), rotated ``inversion`` times."""
    tones = [root + iv for iv in _INTERVALS[quality]]
    base = low + ((tones[0] - low) % 12)
    pitches = [base + (t - tones[0]) for t in tones]
    for _ in range(inversion % len(pitches)):
        pitches = pitches[1:] + [pitches[0] + 12]
    while pitches[-1] > 79:
        pitches = [p - 12 for p in pitches]
    return pitches


def notes_for(case: Case) -> tuple[list[tuple[float, float, int, float]], float]:
    spb = 60.0 / case.bpm
    t = case.lead_in
    notes: list[tuple[float, float, int, float]] = []
    case.truth = []
    rng = np.random.default_rng(len(case.name))
    for symbol, beats in case.chords:
        root, quality, bass = parse_symbol(symbol)
        span = beats * spb
        case.truth.append((t, t + span, root, quality))
        rh = _voicing(root, quality, case.inversion)
        if case.style == "broken":
            # Bass then the chord tones in eighths, the way a pianist fills a bar.
            pattern = [rh[0] - 12] + rh[1:] + rh[:1] + rh[1:]
            step = spb / 2
            k = 0
            while k * step < span - 1e-6:
                p = pattern[k % len(pattern)]
                notes.append((t + k * step, step * 1.6, p, 0.6 + 0.1 * rng.random()))
                k += 1
        else:
            for p in rh:
                notes.append((t + 0.005 * rng.random(), span * 0.97, p, 0.55 + 0.1 * rng.random()))
            if case.style == "bass":
                low = bass if bass is not None else root
                notes.append((t, span * 0.97, 36 + ((low - 36) % 12), 0.7))
        if case.melody:
            # Chord tones above the voicing on the beat, a passing step between them.
            top = max(rh) + 1
            tones = sorted({top + ((root + iv - top) % 12) for iv in _INTERVALS[quality]})
            for b in range(beats):
                p = tones[b % len(tones)]
                notes.append((t + b * spb, spb * 0.9, p, 0.75))
        t += span
    return notes, t + 0.5


CASES: list[Case] = [
    Case("pop_C", "C major", 96, [("C", 4), ("G", 4), ("Am", 4), ("F", 4), ("C", 4), ("G", 4), ("F", 4), ("C", 4)]),
    Case("hymn_F", "F major", 80, [("F", 2), ("Bb", 2), ("C", 2), ("F", 2), ("Dm", 2), ("Gm", 2), ("C7", 2), ("F", 2)]),
    Case("v_of_v_F", "F major", 72, [("F", 4), ("Dm", 4), ("G", 4), ("Bb", 4), ("F", 4), ("C", 4), ("F", 4)], style="broken"),
    Case("jazzish_Bb", "Bb major", 100, [("Bbmaj7", 4), ("Gm7", 4), ("Cm7", 4), ("F7", 4), ("Bbmaj7", 4), ("Ebmaj7", 4), ("F7", 4), ("Bb", 4)]),
    Case("minor_A", "A minor", 90, [("Am", 4), ("Dm", 4), ("E", 4), ("Am", 4), ("F", 4), ("G", 4), ("E7", 4), ("Am", 4)]),
    Case("sharp_E", "E major", 110, [("E", 4), ("C#m", 4), ("A", 4), ("B", 4), ("E", 4), ("G#m", 4), ("A", 4), ("B7", 4), ("E", 4)], inversion=1),
    Case("slash_D", "D major", 84, [("D", 4), ("A/C#", 4), ("Bm", 4), ("D/A", 4), ("G", 4), ("D/F#", 4), ("Em", 4), ("A", 4), ("D", 4)], style="bass"),
    Case("melody_G", "G major", 88, [("G", 4), ("Em", 4), ("C", 4), ("D", 4), ("G", 4), ("C", 4), ("D7", 4), ("G", 4)], melody=True),
    Case("sus_Eb", "Eb major", 76, [("Eb", 4), ("Absus4", 2), ("Ab", 2), ("Bbsus4", 2), ("Bb", 2), ("Cm", 4), ("Ddim", 2), ("Eb", 2)], inversion=2),
    Case("melody_bass_Db", "Db major", 92, [("Db", 4), ("Bbm", 4), ("Gb", 4), ("Ab7", 4), ("Db", 4), ("Gb", 4), ("Ab", 4), ("Db", 4)], style="bass", melody=True),
]


# ── Scoring ───────────────────────────────────────────────────────────────────


def beat_accuracy(case: Case, read: list[tuple[float, float, int, str]]) -> float:
    """Share of the case's true beats whose middle falls in a read chord of the right root
    and quality.  ``read`` is ``(t0, t1, root, quality)`` in seconds, sounding pitch."""
    spb = 60.0 / case.bpm
    right = total = 0
    for t0, t1, root, quality in case.truth:
        for b in range(int(round((t1 - t0) / spb))):
            mid = t0 + (b + 0.5) * spb
            total += 1
            right += any(a <= mid < z and r == root and q == quality for a, z, r, q in read)
    return right / total if total else 0.0


def result_seconds(result, shift: int = 0) -> list[tuple[float, float, int, str]]:
    """A transcription's chords in seconds and sounding pitch (undoing ``shift``)."""
    spb = 60.0 / result.tempo
    return [
        (result.beat_origin_sec + c.start_beat * spb, result.beat_origin_sec + (c.start_beat + c.dur_beats) * spb,
         (c.root - shift) % 12, c.quality)
        for c in (result.chords or [])
    ]


def run_chords_mode(case: Case, use_samples: bool = True):
    from app.pipeline.transcriber import transcribe

    notes, seconds = notes_for(case)
    y = render(notes, seconds, use_samples)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        path = Path(tmp.name)
    try:
        sf.write(str(path), y, SAMPLE_RATE)
        return transcribe(path, mode="chords", audio_preview=False)
    finally:
        path.unlink(missing_ok=True)


def run_backing(case: Case, use_samples: bool = True) -> list[tuple[float, float, int, str]]:
    from app.pipeline import chords

    notes, seconds = notes_for(case)
    y = render(notes, seconds, use_samples)
    spans, _, _ = chords.read_chords(y, SAMPLE_RATE, case.bpm, case.lead_in)
    spb = 60.0 / case.bpm
    return [(case.lead_in + s.start_beat * spb, case.lead_in + (s.start_beat + s.dur_beats) * spb, s.root, s.quality)
            for s in spans]


def main() -> None:
    use_samples = piano_samples() is not None
    print(f"piano: {'Salamander samples' if use_samples else 'additive (no samples found)'}")
    print(f"{'case':<16} {'key':<9} {'chords':>7} {'key read':<10} {'backing':>8}  symbols")
    totals = {"chords": [], "backing": []}
    keys_right = 0
    t0 = time.perf_counter()
    for case in CASES:
        result = run_chords_mode(case, use_samples)
        acc = beat_accuracy(case, result_seconds(result))
        back = beat_accuracy(case, run_backing(case, use_samples))
        totals["chords"].append(acc)
        totals["backing"].append(back)
        keys_right += result.key == case.key
        symbols = " ".join(c.symbol for c in (result.chords or []))
        print(f"{case.name:<16} {case.key:<9} {acc:7.3f} {result.key:<10} {back:8.3f}  {symbols}")
    print(f"\nchord symbol accuracy (root+quality per beat): chords mode {np.mean(totals['chords']):.3f}, "
          f"backing (audio only) {np.mean(totals['backing']):.3f}; keys {keys_right}/{len(CASES)}; "
          f"{time.perf_counter() - t0:.0f}s")


if __name__ == "__main__":
    main()
