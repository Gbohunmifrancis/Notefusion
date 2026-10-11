"""Uploaded-song benchmark: the melody pipeline on songs with a band behind the voice.

    python -m tests.accuracy.songs                   # both sets, the song-upload path
    python -m tests.accuracy.songs --arm mix         # the mixture, no isolation
    python -m tests.accuracy.songs --arm auto        # a song uploaded as a tune (separate=false)
    python -m tests.accuracy.songs --set real --per-clip
    python -m tests.accuracy.songs --detector        # the accompaniment check: songs vs solo voices

The sung corpus (``report --vocal``) and Vocadito are solo voices; neither says anything
about a song with a band behind the singer, which is what an uploaded song is.  Two sets:

  synthetic  36 songs built from the nine sung-corpus tunes, three singers (a produced
             lead, "da" syllables, an untrained "ah") and four mixes: band (piano chords,
             bass, drums, a two-bar intro); the band 6 dB louder; reverb on the voice;
             band plus a backing vocal a third below at -6 dB.  44.1 kHz stereo; the
             intended notes, key and tempo are known exactly.
  real       ADC2004 + MIREX05 training clips with a sung lead (21 clips: pop, the
             "daisy" songs, opera, train01-09), whose verified f0 tracks are the
             reference.  Downloaded from LabROSA on first run (~60 MB).

Arms:
  song   what a song upload does (``separate=true``): the MDX vocal stem is transcribed
         on the Pro lane with the beat read from the mix and the chords from the
         instrumental (the free lane writes the same notes, ~1 s slower).
  mix    the mixture transcribed as it is, which is what a song uploaded as "a tune I
         hummed" got before the worker learned to isolate on its own.
  auto   what that upload gets now: the queue's accompaniment check picks song or mix,
         and an empty vocal stem falls back to the mix (``app.jobs.queue``).

Columns, synthetic: abs_f1 (onset within a quarter beat, pitch exact, on the audio clock),
syl_err (solfa edit distance / reference length, scored in the true key, timing-free),
key / tempo (exact), missed, extra (unmatched notes while the lead sings), leak (unmatched
notes where nobody sings), stacked (notes sharing a start beat with another).
Columns, real: pitchER / intvER (note and interval edit distance / reference length, with
repeats collapsed on both sides; the reference is the f0 track cut by the app's own
segmenter), RPA / OA (mir_eval frame-level melody scores), leak (output notes on frames
the reference calls unvoiced), n_ratio (output / reference notes), stacked.

``--detector`` scores ``separate.accompaniment``: every song in both sets should read as
accompanied, and every sung-corpus clip (and Vocadito, if ``python -m
tests.accuracy.vocadito`` has downloaded it) as solo.

Measurement only, never run by ``pytest``.  Separation runs once per clip (~0.4x real
time on four cores) and the stems are cached with the audio under
``~/.cache/notefusion/songs`` (or ``--data``); it needs the MDX model at
``NF_MDX_MODEL_PATH``.
"""

from __future__ import annotations

import argparse
import io
import json
import time
import urllib.request
import zipfile
import zlib
from dataclasses import asdict, replace
from pathlib import Path

import numpy as np

from tests.accuracy import metrics, vocal_synth
from tests.accuracy.synth import RefNote
from tests.accuracy.vocal_corpus import STYLES, TUNES
from tests.accuracy.vocal_synth import VocalOptions

DEFAULT_DATA = Path.home() / ".cache" / "notefusion" / "songs"
# LabROSA serves these over plain http only (its https certificate chain is incomplete).
ARCHIVES = {
    "adc2004_full_set": "http://labrosa.ee.columbia.edu/projects/melody/adc2004_full_set.zip",
    "mirex05TrainFiles": "http://labrosa.ee.columbia.edu/projects/melody/mirex05TrainFiles.zip",
}
REAL_CLIPS = (
    *(f"adc2004_full_set/{n}" for n in ("daisy1", "daisy2", "daisy3", "daisy4", "opera_fem2", "opera_fem4",
                                        "opera_male3", "opera_male5", "pop1", "pop2", "pop3", "pop4")),
    *(f"mirex05TrainFiles/train{i:02d}" for i in range(1, 10)),
)

SR = 44_100
PC = {"C": 0, "C#": 1, "Db": 1, "D": 2, "Eb": 3, "D#": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7,
      "Ab": 8, "G#": 8, "A": 9, "Bb": 10, "A#": 10, "B": 11}
# A produced lead: near A440, modest vibrato, small per-note error.
SONG_PRO = VocalOptions(style="ah", tuning_cents=5.0, note_detune_cents=8.0, vibrato_cents=35.0,
                        vibrato_hz=5.6, scoop_cents=40.0, glide_sec=0.09, jitter_cents=6.0,
                        breath_noise_db=-60.0, mic_noise_db=-70.0)
SINGERS = {"pro": SONG_PRO, "da": STYLES["da_syllables"], "amateur": STYLES["ah_amateur"]}
VARIANTS = ("band", "band_loud", "band_reverb", "band_harmony")
INTRO_BARS, OUTRO_BARS, BEATS_PER_BAR = 2, 1, 4


# ── Data ──────────────────────────────────────────────────────────────────────


def ensure_real(data: Path) -> Path:
    root = data / "real"
    for folder, url in ARCHIVES.items():
        if (root / folder).is_dir():
            continue
        root.mkdir(parents=True, exist_ok=True)
        print(f"downloading {url} ...", flush=True)
        with urllib.request.urlopen(url, timeout=300) as response:  # noqa: S310 - fixed URL
            zipfile.ZipFile(io.BytesIO(response.read())).extractall(root)
    return root


def synthetic_cases() -> list[tuple[str, str, str, str]]:
    singers = list(SINGERS)
    return [
        (f"{tune}__{variant}__{singers[(i + j) % 3]}", tune, variant, singers[(i + j) % 3])
        for i, tune in enumerate(TUNES)
        for j, variant in enumerate(VARIANTS)
    ]


def _hz(m):
    return 440.0 * 2.0 ** ((np.asarray(m, float) - 69.0) / 12.0)


def _piano(midi, dur, vel=1.0):
    n = int((dur + 0.25) * SR)
    t = np.arange(n) / SR
    f0 = _hz(midi)
    out = np.zeros(n)
    tau0 = 1.6 * (2.0 ** (-(midi - 60) / 24.0))
    for k in range(1, 14):
        fk = k * f0 * np.sqrt(1 + 1e-4 * k * k)
        if fk > SR * 0.45:
            break
        out += np.exp(-t / (tau0 / (1 + 0.35 * k))) * np.sin(2 * np.pi * fk * t) / k ** 1.2
    atk = int(0.004 * SR)
    out[:atk] *= np.linspace(0, 1, atk)
    rel = int(0.12 * SR)
    stop = min(n, int(dur * SR))
    env = np.ones(n)
    env[stop:stop + rel] = np.linspace(1, 0, len(env[stop:stop + rel]))
    env[stop + rel:] = 0
    return vel * out * env


def _bass(midi, dur):
    n = int((dur + 0.1) * SR)
    t = np.arange(n) / SR
    f0 = _hz(midi)
    out = sum(np.sin(2 * np.pi * k * f0 * t) / k ** 1.8 for k in range(1, 9))
    out *= np.exp(-t / 0.9)
    stop = min(n, int(dur * SR))
    out[stop:] *= np.linspace(1, 0, n - stop)
    out[:int(0.005 * SR)] *= np.linspace(0, 1, int(0.005 * SR))
    return out


def _drum(kind, rng):
    from scipy import signal

    if kind == "kick":
        t = np.arange(int(0.3 * SR)) / SR
        return np.sin(2 * np.pi * np.cumsum(45 + 105 * np.exp(-t / 0.03)) / SR) * np.exp(-t / 0.12)
    if kind == "snare":
        t = np.arange(int(0.25 * SR)) / SR
        noise = signal.sosfilt(signal.butter(2, [1000, 8000], btype="band", fs=SR, output="sos"), rng.standard_normal(t.size))
        return 0.7 * noise * np.exp(-t / 0.07) + 0.5 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05)
    t = np.arange(int(0.08 * SR)) / SR
    noise = signal.sosfilt(signal.butter(2, 7000, btype="high", fs=SR, output="sos"), rng.standard_normal(t.size))
    return 0.35 * noise * np.exp(-t / 0.018)


def _add(buf, x, start):
    s = int(start)
    if s < len(buf):
        e = min(len(buf), s + len(x))
        buf[s:e] += x[: e - s]


def _key(key):
    tonic, mode = key.split()
    return PC[tonic], mode


def _chords(notes, key, total_beats):
    """One diatonic triad per bar, the one holding most of that bar's melody."""
    tonic, mode = _key(key)
    if mode == "major":
        degrees = {"I": (0, 4, 7), "ii": (2, 5, 9), "iii": (4, 7, 11), "IV": (5, 9, 0), "V": (7, 11, 2), "vi": (9, 0, 4)}
        home = "I"
    else:
        degrees = {"i": (0, 3, 7), "iv": (5, 8, 0), "V": (7, 11, 2), "VI": (8, 0, 3), "III": (3, 7, 10), "VII": (10, 2, 5)}
        home = "i"
    n_bars = int(np.ceil(total_beats / BEATS_PER_BAR))
    weights = np.zeros((n_bars, 12))
    cursor = 0.0
    for p, d in notes:
        if p is not None:
            weights[min(int(cursor // BEATS_PER_BAR), n_bars - 1), (p - tonic) % 12] += d
        cursor += d
    out = []
    for b in range(n_bars):
        best = max(degrees, key=lambda name: sum(weights[b, pc] for pc in degrees[name]) + (0.1 if name == home else 0))
        out.append(tuple((tonic + pc) % 12 for pc in degrees[best]))
    return out, tuple((tonic + pc) % 12 for pc in degrees[home])


def _band(notes, key, tempo, seed):
    rng = np.random.default_rng(seed)
    beat = 60.0 / tempo
    tune_beats = sum(d for _, d in notes)
    total_bars = INTRO_BARS + int(np.ceil(tune_beats / BEATS_PER_BAR)) + OUTRO_BARS
    n = int((total_bars * BEATS_PER_BAR * beat + 1.5) * SR)
    piano, bass, drums, hats = (np.zeros(n) for _ in range(4))
    bar_chords, home = _chords(notes, key, tune_beats)
    for bar, pcs in enumerate([home] * INTRO_BARS + bar_chords + [home] * OUTRO_BARS):
        t0 = bar * BEATS_PER_BAR * beat
        triad = sorted(55 + ((pc - 55) % 12) for pc in pcs)
        root, fifth = 36 + ((pcs[0] - 36) % 12), 36 + ((pcs[2] - 36) % 12)
        for b in range(BEATS_PER_BAR):
            at = (t0 + b * beat) * SR
            for m in triad:
                _add(piano, _piano(m, beat * 0.95, vel=0.9 if b in (0, 2) else 0.6), at)
            _add(bass, _bass(root if b != 2 else fifth, beat * 0.9), at)
            _add(drums, _drum("kick" if b in (0, 2) else "snare", rng), at)
            for h in (0, 0.5):
                _add(hats, _drum("hat", rng), (t0 + (b + h) * beat) * SR)
    band = np.stack([0.6 * piano + bass + drums + 0.6 * hats, 0.4 * piano + bass + drums + 1.0 * hats])
    return band, INTRO_BARS * BEATS_PER_BAR * beat, n


def _reverb(x, rt60=1.3, seed=7):
    from scipy import signal

    rng = np.random.default_rng(seed)
    t = np.arange(int(rt60 * SR)) / SR
    ir = signal.sosfilt(signal.butter(1, 4000, fs=SR, output="sos"), rng.standard_normal(t.size) * np.exp(-6.91 * t / rt60))
    ir[: int(0.02 * SR)] = 0
    wet = signal.fftconvolve(x, ir)[: len(x)]
    wet *= 0.35 * np.sqrt(np.mean(x ** 2)) / max(1e-9, np.sqrt(np.mean(wet ** 2)))
    return x + wet


def _third_below(notes, key):
    tonic, mode = _key(key)
    scale = [0, 2, 4, 5, 7, 9, 11] if mode == "major" else [0, 2, 3, 5, 7, 8, 10]
    out = []
    for p, d in notes:
        if p is None:
            out.append((None, d))
            continue
        rel = (p - tonic) % 12
        down = (scale[scale.index(rel)] - scale[(scale.index(rel) - 2) % 7]) % 12 if rel in scale else 3
        out.append((p - down, d))
    return tuple(out)


def render_song(folder: Path, name: str, tune: str, variant: str, singer: str) -> None:
    import soundfile as sf

    key, tempo, notes = TUNES[tune]
    band, intro_sec, n = _band(notes, key, tempo, zlib.crc32(name.encode()))
    opts = replace(SINGERS[singer], lead_in_sec=intro_sec, tail_sec=OUTRO_BARS * BEATS_PER_BAR * 60.0 / tempo + 1.5)
    lead, ref = vocal_synth.render(notes, tempo, opts, sr=SR)
    lead = np.pad(lead, (0, max(0, n - len(lead))))[:n]
    harmony = np.zeros(n)
    if variant == "band_harmony":
        hopts = replace(STYLES["ah_vibrato"], lead_in_sec=intro_sec, tail_sec=opts.tail_sec, tuning_cents=-5.0)
        h, _ = vocal_synth.render(_third_below(notes, key), tempo, hopts, sr=SR)
        harmony = np.pad(h, (0, max(0, n - len(h))))[:n]
        harmony *= 0.5 * np.sqrt(np.mean(lead ** 2)) / max(1e-9, np.sqrt(np.mean(harmony ** 2)))  # -6 dB
    if variant in ("band_reverb", "band_harmony"):
        lead = _reverb(lead)
        harmony = _reverb(harmony, seed=11) if harmony.any() else harmony
    voiced = np.abs(lead) > 1e-3
    band *= np.sqrt(np.mean(lead[voiced] ** 2)) / np.sqrt(np.mean(band.mean(axis=0)[voiced] ** 2))
    band *= 10 ** (6.0 / 20.0) if variant == "band_loud" else 1.0
    vox = np.stack([lead + 0.8 * harmony, lead + 1.2 * harmony]) if harmony.any() else np.stack([lead, lead])
    mix = band + vox
    gain = 0.9 / np.max(np.abs(mix))
    folder.mkdir(parents=True, exist_ok=True)
    sf.write(folder / "mix.wav", (mix * gain).T.astype(np.float32), SR, subtype="PCM_16")
    sf.write(folder / "lead.wav", (np.stack([lead, lead]) * gain).T.astype(np.float32), SR, subtype="PCM_16")
    meta = {"name": name, "tune": tune, "variant": variant, "singer": singer, "key": key, "tempo": tempo,
            "intro_sec": intro_sec, "ref": [asdict(r) for r in ref]}
    (folder / "meta.json").write_text(json.dumps(meta, indent=1))


def ensure_synthetic(data: Path) -> list[tuple[str, Path]]:
    out = []
    for name, tune, variant, singer in synthetic_cases():
        folder = data / "synthetic" / name
        if not (folder / "meta.json").exists():
            print(f"rendering {name}", flush=True)
            render_song(folder, name, tune, variant, singer)
        out.append((name, folder / "mix.wav"))
    return out


def vocal_stem(mix: Path, stems: Path, name: str) -> Path:
    """The MDX vocal stem of ``mix``, separated once and cached."""
    from app.pipeline import separate

    vocals = stems / f"{name}_vocals.wav"
    if not vocals.exists():
        if not separate.available():
            raise SystemExit(f"no separation model at {separate.model_path()} (set NF_MDX_MODEL_PATH)")
        stems.mkdir(parents=True, exist_ok=True)
        started = time.time()
        separate.separate_file(mix, vocals, backing_path=stems / f"{name}_backing.wav")
        print(f"separated {name} in {time.time() - started:.0f}s", flush=True)
    return vocals


def transcribe_arm(arm: str, mix: Path, stems: Path, name: str) -> dict:
    from app.pipeline.transcriber import LowConfidenceError, transcribe

    started = time.time()
    path = arm
    # The chords are read where the queue reads them: off the instrumental for a song, off the
    # mixture when a band was heard but the vocal stem came back empty.
    chord_source = None
    if arm == "auto":
        from app.pipeline import separate

        path = "mix"
        if separate.has_accompaniment(mix):
            vocals = vocal_stem(mix, stems, name)
            share = separate.voice_share_db(vocals, stems / f"{name}_backing.wav")
            path = "song" if share >= separate.VOICE_MIN_SHARE_DB else "mix"
            chord_source = mix
    try:
        if path == "song":
            r = transcribe(vocal_stem(mix, stems, name), mode="melody", audio_preview=False, fast=True, tempo_source=mix,
                           chord_source=stems / f"{name}_backing.wav")
        else:
            r = transcribe(mix, mode="melody", audio_preview=False, chord_source=chord_source)
        row = {"key": r.key, "tempo": r.tempo, "beat_origin": r.beat_origin_sec,
               "notes": [[n.pitch_midi, n.start_beat, n.dur_beats] for n in r.notes]}
    except LowConfidenceError as ex:
        row = {"error": str(ex)}
    row["path"] = path
    row["seconds"] = round(time.time() - started, 1)
    return row


# ── Scoring ───────────────────────────────────────────────────────────────────


class _Note:
    def __init__(self, pitch, start_beat, dur_beats):
        self.pitch_midi, self.start_beat, self.dur_beats = pitch, start_beat, dur_beats


def _clock(row: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(onset s, offset s, pitch) of the output notes on the audio clock, as a player places them."""
    est = sorted(row["notes"], key=lambda n: n[1])
    spb = 60.0 / row["tempo"]
    on = np.array([row["beat_origin"] + n[1] * spb for n in est])
    off = np.array([row["beat_origin"] + (n[1] + n[2]) * spb for n in est])
    return np.maximum(on, 0.0), np.maximum(off, on + 0.01), np.array([n[0] for n in est])


def _stacked(row: dict) -> float:
    starts = [round(n[1], 4) for n in row["notes"]]
    return (len(starts) - len(set(starts))) / max(1, len(starts))


def score_synthetic(meta: dict, row: dict) -> dict:
    import mir_eval

    if "error" in row:
        return {"failed": 1.0}
    ref = [RefNote(**r) for r in meta["ref"]]
    ref_on = np.array([r.onset_sec for r in ref])
    ref_off = ref_on + np.array([r.dur_sec for r in ref])
    ref_p = np.array([r.pitch_midi for r in ref])
    on, off, pitch = _clock(row)
    tol = 0.25 * 60.0 / meta["tempo"] * 1.02
    out = {"failed": 0.0, "abs_f1": 0.0, "missed": 1.0, "extra": 0.0, "leak": 0.0}
    if pitch.size:
        _, _, f1, _ = mir_eval.transcription.precision_recall_f1_overlap(
            np.c_[ref_on, ref_off], _hz(ref_p), np.c_[on, off], _hz(pitch),
            onset_tolerance=tol, pitch_tolerance=50.0, offset_ratio=None)
        pairs = mir_eval.transcription.match_note_onsets(np.c_[ref_on, ref_off], np.c_[on, off], onset_tolerance=tol)
        matched = {j for _, j in pairs}
        singing = [bool(np.any((t >= ref_on - 0.1) & (t <= ref_off + 0.1))) for t in on]
        out.update({
            "abs_f1": f1,
            "missed": (len(ref) - len(pairs)) / len(ref),
            "extra": sum(1 for j, s in enumerate(singing) if s and j not in matched),
            "leak": sum(1 for j, s in enumerate(singing) if not s and j not in matched),
        })
    out["syl_err"] = metrics.sequence_metrics(ref, [_Note(*n) for n in row["notes"]], meta["key"])["syllable_error_rate"]
    out["key"] = float(metrics.key_metrics(meta["key"], row["key"])["exact"])
    out["tempo"] = float(metrics.tempo_metrics(meta["tempo"], row["tempo"])["metrical_factor"] == 1.0)
    out["stacked"] = _stacked(row)
    out["sec"] = row["seconds"]
    return out


def _collapse(pitches):
    out = []
    for p in pitches:
        if not out or out[-1] != p:
            out.append(p)
    return out


def real_reference(ref_path: Path) -> tuple[np.ndarray, np.ndarray, list[int]]:
    """(times, f0 Hz, notes): the verified f0 track and its notes, cut by the app's segmenter."""
    from app.pipeline import vocal

    table = np.loadtxt(ref_path)
    t, f = table[:, 0], table[:, 1]
    grid = np.arange(0, t[-1], vocal.HOP / vocal.SAMPLE_RATE)
    f0 = f[np.clip(np.searchsorted(t, grid), 0, len(t) - 1)]
    midi = np.where(f0 > 0, 69 + 12 * np.log2(np.maximum(f0, 1e-6) / 440.0), np.nan)
    on = (~np.isnan(midi)).astype(float)
    contour = vocal.Contour(times=grid, midi=midi, voiced_prob=on, rms=on, rms_fast=on)
    analysis = vocal.analyse(np.zeros(16), vocal.SAMPLE_RATE, contour=contour)
    # sung pitch (the tuning and any drift the engine took out put back) rounded; no scale
    # snapping on the reference side
    t0 = min((n.start for n in analysis.notes), default=0.0)
    notes = [int(round(n.midi + (analysis.tuning_cents + analysis.drift_cents_per_min * (n.start - t0) / 60.0) / 100.0))
             for n in analysis.notes]
    return t, f, _collapse(notes)


def score_real(ref: tuple, row: dict) -> dict:
    import mir_eval

    if "error" in row:
        return {"failed": 1.0}
    t, f, ref_notes = ref
    on, off, pitch = _clock(row)
    est = np.zeros_like(f)
    unvoiced = 0
    for a, b, p in zip(on, off, pitch):
        inside = (t >= a) & (t < b)
        est[inside] = _hz(p)
        unvoiced += int(inside.any() and np.mean(f[inside] > 0) < 0.5)
    frame = mir_eval.melody.evaluate(t, f, t, est)
    est_notes = _collapse([int(p) for p in pitch])
    ed = metrics._edit_distance
    return {
        "failed": 0.0,
        "pitchER": ed(ref_notes, est_notes) / len(ref_notes),
        "intvER": ed(list(np.diff(ref_notes)), list(np.diff(est_notes))) / max(1, len(ref_notes) - 1),
        "RPA": frame["Raw Pitch Accuracy"],
        "OA": frame["Overall Accuracy"],
        "leak": unvoiced / max(1, len(pitch)),
        "n_ratio": len(est_notes) / len(ref_notes),
        "stacked": _stacked(row),
        "sec": row["seconds"],
    }


def _table(title: str, rows: dict[str, dict], cols: tuple[str, ...], group) -> dict:
    groups: dict[str, list[dict]] = {"ALL": list(rows.values())}
    for name, scores in rows.items():
        groups.setdefault(group(name), []).append(scores)
    print(f"\n{title}\n" + "group".ljust(14) + "n".rjust(4) + "".join(c.rjust(9) for c in cols))
    summary = {}
    for g, items in groups.items():
        ok = [s for s in items if not s.get("failed")]
        summary[g] = {"n": len(items), "failed": len(items) - len(ok),
                      **{c: round(float(np.mean([s[c] for s in ok])), 3) if ok else None for c in cols}}
        print(g.ljust(14) + str(len(items)).rjust(4)
              + "".join(f"{summary[g][c]:9.3f}" if summary[g][c] is not None else "      n/a" for c in cols))
    return summary


# ── The accompaniment check ───────────────────────────────────────────────────


def run_detector(data: Path, vocadito: Path | None) -> int:
    """Every song should read as accompanied; every solo voice, and one instrument alone, not."""
    import tempfile

    from app.pipeline import separate
    from tests.accuracy import synth
    from tests.accuracy.corpus import CASES as INSTRUMENT_CASES
    from tests.accuracy.vocal_corpus import CASES as SUNG_CASES

    def check(path: Path) -> float:
        return separate.accompaniment(path)

    def rendered(audio) -> float:
        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            synth.write_wav(Path(tmp.name), audio)
            return check(Path(tmp.name))

    rows: list[tuple[str, bool, float]] = []
    for name, mix in ensure_synthetic(data):
        rows.append((f"synthetic/{name}", True, check(mix)))
    for wav in sorted(ensure_real(data).glob("*/*.wav")):
        rows.append((f"real/{wav.stem}", True, check(wav)))
    for case in SUNG_CASES:
        rows.append((f"sung/{case.name}", False, rendered(vocal_synth.render(case.notes, case.tempo_bpm, case.options)[0])))
    if vocadito is not None and (vocadito / "Audio").is_dir():
        for wav in sorted((vocadito / "Audio").glob("*.wav")):
            rows.append((f"vocadito/{wav.stem}", False, check(wav)))
    for case in INSTRUMENT_CASES:
        audio, _ = synth.render(case.notes, case.tempo_bpm, case.options, accompaniment=case.accompaniment)
        rows.append((f"instrument/{case.name}", bool(case.accompaniment), rendered(audio)))

    threshold = separate.ACCOMPANIMENT_MIN_PEAKS
    for name, truth, peaks in rows:
        wrong = "  <-- wrong" if (peaks >= threshold) != truth else ""
        print(f"{name:<52} {'band' if truth else 'solo'}  peaks {peaks:5.2f}{wrong}")
    print(f"\nisolated at {threshold:.1f} tonal peaks per frame off the main pitch:")
    for group in dict.fromkeys(n.split("/")[0] for n, _, _ in rows):
        sub = [(t, p >= threshold) for n, t, p in rows if n.startswith(group + "/")]
        print(f"  {group:<11} {len(sub):3d} clips ({sum(t for t, _ in sub)} accompanied): isolated {sum(a for _, a in sub)}, "
              f"right {sum(t == a for t, a in sub)}")
    tp = sum(t and p >= threshold for _, t, p in rows)
    fp = sum(not t and p >= threshold for _, t, p in rows)
    fn = sum(t and p < threshold for _, t, p in rows)
    print(f"  precision {tp / max(1, tp + fp):.3f}  recall {tp / max(1, tp + fn):.3f}")
    return 0


# ── Entry point ───────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m tests.accuracy.songs", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--set", choices=("synthetic", "real", "both"), default="both")
    parser.add_argument("--arm", choices=("song", "mix", "auto"), default="song")
    parser.add_argument("--only", default="", help="run clips whose name contains this")
    parser.add_argument("--per-clip", action="store_true")
    parser.add_argument("--out", type=Path, default=None, help="write per-clip rows and the summary as JSON")
    parser.add_argument("--detector", action="store_true", help="score the accompaniment check instead")
    parser.add_argument("--vocadito", type=Path, default=Path.home() / ".cache" / "notefusion" / "vocadito")
    args = parser.parse_args(argv)
    if args.detector:
        return run_detector(args.data, args.vocadito)

    stems = args.data / "stems"
    results: dict = {"arm": args.arm, "rows": {}, "summary": {}}
    if args.set in ("synthetic", "both"):
        scored = {}
        for name, mix in ensure_synthetic(args.data):
            if args.only not in name:
                continue
            row = transcribe_arm(args.arm, mix, stems, name)
            meta = json.loads((mix.parent / "meta.json").read_text())
            scored[name] = score_synthetic(meta, row)
            results["rows"][name] = {**row, "score": scored[name]}
            if args.per_clip:
                print(f"{name:<40} {meta['key']:>8} -> {str(row.get('key')):<9} {meta['tempo']:>3} -> {row.get('tempo')}  "
                      + " ".join(f"{k}={v:.2f}" for k, v in scored[name].items()), flush=True)
        if scored:
            results["summary"]["synthetic"] = _table(
                f"synthetic songs, arm={args.arm}", scored,
                ("abs_f1", "syl_err", "key", "tempo", "missed", "extra", "leak", "stacked", "sec"),
                lambda n: n.split("__")[1])
    if args.set in ("real", "both"):
        real = ensure_real(args.data)
        scored = {}
        for clip in REAL_CLIPS:
            name = clip.split("/")[1]
            if args.only not in name:
                continue
            ref_path = real / f"{clip}REF.txt"
            row = transcribe_arm(args.arm, real / f"{clip}.wav", stems, name)
            scored[name] = score_real(real_reference(ref_path), row)
            results["rows"][name] = {**row, "score": scored[name]}
            if args.per_clip:
                print(f"{name:<14} {str(row.get('key')):<9} {str(row.get('tempo')):>4}  "
                      + " ".join(f"{k}={v:.2f}" for k, v in scored[name].items()), flush=True)
        if scored:
            results["summary"]["real"] = _table(
                f"real songs (ADC2004 + MIREX05), arm={args.arm}", scored,
                ("pitchER", "intvER", "RPA", "OA", "leak", "n_ratio", "stacked", "sec"),
                lambda n: "mirex05" if n.startswith("train") else n.rstrip("0123456789").split("_")[0])
    if args.out:
        args.out.write_text(json.dumps(results, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
