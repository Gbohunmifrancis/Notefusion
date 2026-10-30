"""The film's score and sound, written in code from the app's own recorded piano (web-site/assets/piano).

C major at 120 BPM, read off timeline.json so every note and every sound lands on the frame its picture does:
the pad and the C chord (bar 1), Doh's tune on the chips' beats (bars 2-3), a climbing note per stop over C-Am-F-G
with hats and a light kick (bars 4-5), a snare roll and riser into a beat of silence (bar 6), the full beat on the
drop (bars 7-8) and the resolve (bars 9-10). Each visible action has its sound, its peak on its frame.

    python3 score.py            # writes build/score.wav (mastered: -14 LUFS, true peak <= -1 dBTP)
"""

import json
import pathlib
import subprocess
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
PIANO = HERE.parents[2] / "web-site" / "assets" / "piano"
BUILD = HERE / "build"
SR = 44100
T = json.loads((HERE / "timeline.json").read_text())
BEAT = 60.0 / T["bpm"]
BAR = 4 * BEAT
LENGTH = T["duration"]
rng = np.random.default_rng(7)

mix = np.zeros((int(LENGTH * SR) + SR, 2))  # a second of room past the end, trimmed later


def at(t):
    return int(round(t * SR))


def place(signal, t, gain=1.0, pan=0.0):
    """Adds a mono `signal` starting at `t` seconds, panned -1 (left) .. 1 (right)."""
    i = at(t)
    if i >= len(mix):
        return
    sig = signal[: len(mix) - i] * gain
    left, right = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    mix[i:i + len(sig), 0] += sig * left * np.sqrt(2)
    mix[i:i + len(sig), 1] += sig * right * np.sqrt(2)


def place_peak(signal, peak_t, gain=1.0, pan=0.0):
    """Places a sound so its loudest point lands on `peak_t` (a whoosh peaks late)."""
    peak = int(np.argmax(np.abs(signal)))
    place(signal, peak_t - peak / SR, gain, pan)


# ── The piano ────────────────────────────────────────────────────────────────

NAMES = ["C2", "Ds2", "Fs2", "A2", "C3", "Ds3", "Fs3", "A3", "C4", "Ds4", "Fs4", "A4", "C5", "Ds5", "Fs5", "A5", "C6"]
TUNING = json.loads((PIANO / "tuning.json").read_text())["centsSharp"]


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         check=True, capture_output=True).stdout
    data = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    onset = np.argmax(np.abs(data) > 0.01)
    return data[max(0, onset - int(0.002 * SR)):]


SAMPLES = [(36 + 3 * i, TUNING.get(n, 0.0), decode(PIANO / f"{n}.mp3")) for i, n in enumerate(NAMES)]


def piano(midi, dur, vel=0.8):
    """One piano note of `dur` seconds (plus its release), resampled from the nearest recorded note."""
    base, cents, data = min(SAMPLES, key=lambda s: abs(s[0] - midi))
    rate = 2 ** ((midi - base) / 12 - cents / 1200)
    n = int((dur + 0.6) * SR)
    pos = np.arange(n) * rate
    pos = pos[pos < len(data) - 1]
    i = pos.astype(int)
    frac = pos - i
    note = data[i] * (1 - frac) + data[i + 1] * frac
    t = np.arange(len(note)) / SR
    damper = np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.12))
    return note * damper * vel


def chord(midis, t, dur, vel=0.5, spread=0.012):
    for k, m in enumerate(midis):
        place(piano(m, dur, vel), t + k * spread, pan=(k - len(midis) / 2) * 0.15)


# ── Synths and drums ─────────────────────────────────────────────────────────

def env(n, attack, release):
    e = np.ones(n)
    a, r = int(attack * SR), int(release * SR)
    if a:
        e[:a] = np.linspace(0, 1, a)
    if r:
        e[-r:] *= np.linspace(1, 0, r)
    return e


def pad(midis, dur, vel=0.08):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in midis:
        f = 440 * 2 ** ((m - 69) / 12)
        for detune in (-0.12, 0.0, 0.12):
            ff = f * 2 ** (detune / 12)
            out += np.sin(2 * np.pi * ff * t) + 0.3 * np.sin(4 * np.pi * ff * t)
    return out / (len(midis) * 3) * env(n, 0.6, 0.8) * vel


def kick(vel=1.0):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 45 + 95 * np.exp(-t / 0.035)
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) * np.exp(-t / 0.16)
    click = rng.standard_normal(n) * np.exp(-t / 0.003) * 0.3
    return np.tanh((body + click) * 1.6) * vel


def noise_burst(dur, decay, hp=0.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    if hp:
        x = x - np.convolve(x, np.ones(int(hp)) / hp, mode="same")  # crude high-pass
    return x * np.exp(-t / decay)


def clap(vel=0.6):
    out = np.zeros(int(0.3 * SR))
    for k, d in enumerate((0.0, 0.011, 0.022)):
        b = noise_burst(0.25, 0.012 if k < 2 else 0.07, hp=4)
        out[at(d):at(d) + len(b)][: len(out) - at(d)] += b[: len(out) - at(d)]
    return out * vel * 0.5


def hat(vel=0.25, open_=False):
    return noise_burst(0.2 if open_ else 0.06, 0.05 if open_ else 0.012, hp=2) * vel


def snare(vel=0.4):
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.04)
    return (noise_burst(0.25, 0.06, hp=3) * 0.7 + tone * 0.5) * vel


def sub(midi, dur, vel=0.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 440 * 2 ** ((midi - 69) / 12)
    return np.tanh(np.sin(2 * np.pi * f * t) * 1.4) * env(n, 0.005, 0.08) * vel


def sweep(dur, f0, f1, vel=0.3, rise=True):
    """Filtered-noise whoosh from f0 to f1 Hz, loudest at the end (rise) or the start."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 * (f1 / f0) ** (t / dur)
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = rng.standard_normal(n) * 0.5 + np.sin(phase) * 0.5
    shape = (t / dur) ** 2 if rise else np.exp(-t / (dur / 4))
    return x * shape * vel


def pop(midi=84, vel=0.35):
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    f = 440 * 2 ** ((midi - 69) / 12) * (1 + 0.6 * np.exp(-t / 0.01))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.045) * vel


def tap(vel=0.5):
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 2300 * t) * 0.6 + rng.standard_normal(n) * 0.4) * np.exp(-t / 0.006) * vel


def shimmer(t0, vel=0.12):
    for k, m in enumerate((96, 100, 103, 108, 112)):
        n = int(1.2 * SR)
        t = np.arange(n) / SR
        f = 440 * 2 ** ((m - 69) / 12)
        tone = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.5) * (1 + 0.3 * np.sin(2 * np.pi * 9 * t))
        place(tone * vel, t0 + k * 0.035, pan=(k - 2) * 0.3)


# ── The score ────────────────────────────────────────────────────────────────

C, AM, F, G = [48, 60, 64, 67], [45, 57, 60, 64], [41, 57, 60, 65], [43, 55, 59, 62]
BASS = {"C": 36, "Am": 33, "F": 29, "G": 31}

# Bar 1 (0-2): the pad and a soft C chord: the hook reads, the music breathes.
place(pad([60, 64, 67, 72], 6.2), 0.0)
chord(C, 0.0, 1.9, vel=0.35, spread=0.05)
for k, m in enumerate((72, 76, 79, 84, 79, 76)):  # a soft figure over it, so the hook never goes quiet
    place(piano(m, 0.3, 0.32), 0.5 + k * 0.25, pan=0.25 - k * 0.1)
# Doh's tune: d r m f s on the chips' beats, as the card hears it (bars 2-3).
place(tap(0.6), T["tap"])                                   # the finger taps START
place_peak(sweep(0.4, 300, 2400, vel=0.15), T["tap"] + 0.3)  # the card opens
for t, m in zip(T["chips"], T["chipNotes"]):
    place(piano(m, 0.45, 0.85), t)
    place(pop(m + 24, 0.18), t, pan=0.2)
place(piano(48, 3.0, 0.4), T["chips"][0])
place(piano(55, 2.5, 0.3), T["chips"][2])
# The score counts up; three stars (5.00-5.50).
for k in range(6):
    place(tap(0.12), T["score"] + k * 0.08)
for k, m in enumerate((84, 88, 91)):
    place(piano(m, 0.5, 0.6), T["stars"] + k * 0.09)
    place(pop(m + 12, 0.2), T["stars"] + k * 0.09, pan=(k - 1) * 0.4)
place_peak(sweep(0.35, 2000, 400, vel=0.12, rise=False), T["cardBack"])
# Bars 4-5 (6-10): the climb. C-Am-F-G, hats, a light kick, a climbing note per stop.
for t0, name, ch in ((6.0, "C", C), (7.0, "Am", AM), (8.0, "F", F), (9.0, "G", G)):
    chord(ch, t0, 0.95, vel=0.3)
    place(sub(BASS[name], 0.95, 0.35), t0)
for k in range(8):
    t0 = 6.0 + k * BEAT
    place(kick(0.55 if k % 2 == 0 else 0.0), t0)
    place(hat(0.18), t0 + BEAT / 2, pan=0.3)
for i, (t, m) in enumerate(zip(T["stops"], T["stopNotes"])):
    place(piano(m, 0.4, 0.7), t)
    if i == T["chestStop"]:
        for k, mm in enumerate((84, 88, 91, 96)):  # the chest opens
            place(piano(mm, 0.6, 0.5), t + k * 0.06)
        shimmer(t, 0.08)
    else:
        place(pop(m + 12, 0.16), t, pan=-0.2)
# Bar 6 (10-12): the build. A snare roll speeding up, a riser, a beat of silence before the drop.
place(pad([62, 67, 71, 74], 1.85, vel=0.1), 10.0)
for k in range(28):
    t = 10.0 + 1.75 * (k / 28) ** 0.85
    place(snare(0.08 + 0.3 * k / 28), t)
place(sweep(1.75, 200, 6000, vel=0.35), 10.0)
place(tap(0.4), T["collapse"])
# Bars 7-8 (12-16): the drop. The 3D coin spins in with its whoosh; the full beat; the tune an octave up.
place_peak(sweep(0.6, 3000, 150, vel=0.5, rise=False), T["drop"])
place(sweep(1.0, 6000, 800, vel=0.12, rise=False), T["drop"])
shimmer(T["drop"] + 0.05, 0.1)
for k in range(8):
    t0 = T["drop"] + k * BEAT
    place(kick(1.0), t0)
    if k % 2 == 1:
        place(clap(0.7), t0)
    place(hat(0.2, open_=k % 2 == 1), t0 + BEAT / 2, pan=0.3)
for bar, (name, ch) in enumerate([("C", C), ("G", G)]):
    t0 = T["drop"] + bar * BAR
    for k in range(4):
        chord([n + 12 for n in ch[1:]], t0 + k * BEAT, 0.3, vel=0.42, spread=0.006)
    for k in range(8):
        place(sub(BASS[name], BEAT / 2 - 0.02, 0.55), t0 + k * BEAT / 2)
for t, m in zip([12.0, 12.5, 13.0, 13.5, 14.0, 15.0], [72, 74, 76, 77, 79, 84]):
    place(piano(m, 0.45 if t < 14 else 0.9, 0.95), t)
place(pop(96, 0.3), T["streak"] + 0.5)                       # the badge pops in
for k in range(8):
    t0 = T["streak"] + k * BEAT
    place(kick(0.9), t0)
    if k % 2 == 1:
        place(clap(0.6), t0)
    place(hat(0.2), t0 + BEAT / 2, pan=0.3)
# Bars 9-10 (16-20): the emblem flips into the mark (a whoosh and a shimmer); the music resolves on C.
place_peak(sweep(0.45, 800, 4000, vel=0.3), T["markFlip"] + 0.25)
shimmer(T["markFlip"] + 0.25, 0.12)
for t0, name, ch in ((16.0, "Am", AM), (17.0, "F", F)):
    chord(ch, t0, 0.95, vel=0.35)
    place(sub(BASS[name], 0.95, 0.4), t0)
    place(kick(0.6), t0)
for t, m in zip([16.0, 16.5, 17.0, 17.5], [76, 74, 72, 74]):
    place(piano(m, 0.45, 0.8), t)
chord([36, 48, 55, 60, 64, 67, 72], T["end"], 2.0, vel=0.55, spread=0.02)
place(pad([60, 64, 67, 72], 2.0, vel=0.1), T["end"])

# ── Mix and master ───────────────────────────────────────────────────────────

out = mix[: at(LENGTH)]
fade = int(0.25 * SR)
out[-fade:] *= np.linspace(1, 0, fade)[:, None]
out = np.tanh(out / max(1e-9, np.max(np.abs(out))) * 1.2) * 0.8  # gentle glue before loudness

BUILD.mkdir(exist_ok=True)
raw = BUILD / "score-raw.wav"
pcm = (np.clip(out, -1, 1) * 32767).astype("<i2")
import wave
with wave.open(str(raw), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())

# Two-pass loudnorm: -14 LUFS integrated, true peak -1.5 dBTP (room for the encode).
first = subprocess.run(["ffmpeg", "-v", "info", "-i", str(raw), "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json",
                        "-f", "null", "-"], capture_output=True, text=True).stderr
stats = json.loads(first[first.rindex("{"):first.rindex("}") + 1])
af = ("loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={input_i}:measured_TP={input_tp}:measured_LRA={input_lra}:"
      "measured_thresh={input_thresh}:offset={target_offset}:linear=true").format(**stats)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", af, "-ar", str(SR), str(BUILD / "score.wav")], check=True)
print("score:", BUILD / "score.wav", file=sys.stderr)
