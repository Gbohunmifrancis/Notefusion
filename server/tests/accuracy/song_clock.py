"""Song clock: do a song's notes land on the recording's own beats when played over its backing?

    python -m tests.accuracy.song_clock                    # four tempo curves, three minutes each
    python -m tests.accuracy.song_clock --curve drift --bpm 132 --singer da --lane normal
    python -m tests.accuracy.song_clock --studio           # studio_songs' hymn songs, steady bands

A separated song's sheet is rehearsed over the song's own instrumental
(``TranscriptionResult.backing_audio_base64``): the clients play each note at the audio
time of its ``start_beat``, which is ``beat_times_sec`` interpolated when the result
carries it and ``beat_origin_sec + start_beat * 60 / tempo`` when it does not.  A band
keeps no metronome's time — it pushes in the chorus and pulls back at the end — so this
renders songs whose tempo moves, puts them through the song path exactly as the queue
does with a separated song (the vocal stem read for the notes, the mix for the beat,
the instrumental for the chords: ``studio_songs.transcribe_song``), and measures, for
every note sung, how far from its true onset each mapping places it.

The songs: tunes of the sung corpus moved into C and sung one after another by the
produced lead of ``tests.accuracy.songs`` over piano chords, bass and drums on every beat
of the same moving clock, with a two-bar intro; the stems are simulated as
``studio_songs`` simulates them (no separation model needed).  Curves (BPM per beat):

  steady     100 throughout
  drift      96 rising evenly to 104 (+-4% over the song)
  drift_rit  drift, and the last two bars slowing to 70%
  wander     100 +- 4%, pushing through the first half and dragging through the second

``--studio`` measures the hymn songs of ``tests.accuracy.studio_songs`` instead (``STUDIO_SLUGS``,
their simulated stems): steady bands, a singer whose onsets are harder to hear, pickups and 3/4.

Mappings scored (ms from each note's true onset; a note of the sheet is paired with the sung
note of the same pitch nearest where the transcriber heard it, within half a beat, so every
mapping is scored on the same pairs):

  wire    beat_origin_sec + start_beat * 60 / tempo (the result's tempo is a whole number)
  exact   the same line at the tempo the beats were counted at (``bpm`` before rounding)
  map     beat_times_sec, interpolated as the clients interpolate it
  heard   where the transcriber heard each note before rounding it to the grid: the onsets'
          own error, which a map fitted to them alone would play back

Measured when ``beat_times_sec`` was added (ms, mean / 95th / worst; Pro lane unless named):

  song (3 min)               wire              exact             map              heard
  steady 100                 12 /  12 /  12    12 /  13 /  13    12 /  13 /  13   17 / 47 / 67
  steady 97.4                417 / 769 / 801   14 /  14 /  14    14 /  14 /  14   18 / 50 / 66
  drift 100                  67 / 150 / 201    67 / 154 / 207    14 /  38 /  63   18 / 47 / 68
  drift 100, normal lane     67 / 150 / 201    67 / 154 / 207    14 /  38 /  63   18 / 47 / 68
  drift 100, da              66 / 151 / 200    65 / 145 / 190    14 /  30 /  63   17 / 35 / 46
  drift 100, amateur         67 / 154 / 201    65 / 142 / 164    11 /  27 /  67   17 / 39 / 90
  drift_rit 100              72 / 168 / 224    67 / 147 / 212    14 /  34 /  70   18 / 47 / 68
  drift_rit 84, amateur      87 / 220 / 254    78 / 179 / 227    13 /  43 / 192   17 / 41 / 165
  wander 100                 96 / 223 / 273    68 / 144 / 203    17 /  37 /  69   17 / 50 / 69
  wander 132, da             81 / 182 / 243    54 / 119 / 150    18 /  31 /  60   17 / 36 / 53
  --studio (16 songs, mean)  33 /  78 / -      33 /  79 / -      31 /  78 / -     33 / 94 / -

Every map increased and reached past the last note's end, and every note of every sheet had a
time.  The studio songs' tails (95th 145-297 ms on four of them, under every mapping) are notes
the sheet writes in the wrong slot.

Measurement only; ``tests/test_song_clock.py`` keeps one drifting song in pytest.
"""

from __future__ import annotations

import argparse
import json
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from tests.accuracy import songs, vocal_synth
from tests.accuracy.vocal_corpus import TUNES

STEM_SR = 22_050
BASE_BPM = 100.0
INTRO_BEATS = 8
CURVES = ("steady", "drift", "drift_rit", "wander")
# The sung corpus's tunes that sit in 4/4, moved into C, each followed by a breath.
_VERSES = (("twinkle", 0, 2.0), ("ode_to_joy", -2, 2.0), ("hymn_eflat", -3, 1.0), ("leaps_a", -9, 2.0))


def tempo_curve(curve: str, beats: int, base: float = BASE_BPM, drift: float = 0.04) -> np.ndarray:
    """BPM of each beat of the song (intro included)."""
    k = np.arange(beats, dtype=float)
    x = k / max(1, beats - 1)
    if curve == "steady":
        bpm = np.full(beats, base)
    elif curve in ("drift", "drift_rit"):
        bpm = base * (1.0 - drift + 2.0 * drift * x)
    elif curve == "wander":
        bpm = base * (1.0 + drift * np.sin(2.0 * np.pi * x))
    else:
        raise ValueError(curve)
    if curve == "drift_rit":
        rit = min(8, beats)
        bpm[-rit:] *= np.linspace(1.0, 0.7, rit)
    return bpm


@dataclass(frozen=True)
class Clock:
    """Seconds of any beat (fractions included) of a song whose beats each keep their own BPM."""

    starts: np.ndarray  # starts[k] = time of beat k, k = 0..len(bpm)

    @staticmethod
    def of(bpm: np.ndarray) -> "Clock":
        return Clock(np.concatenate(([0.0], np.cumsum(60.0 / bpm))))

    def __call__(self, beat: float) -> float:
        k = int(np.clip(np.floor(beat), 0, len(self.starts) - 2))
        return float(self.starts[k] + (beat - k) * (self.starts[k + 1] - self.starts[k]))


def song_notes(minutes: float, base: float = BASE_BPM) -> tuple[tuple[int | None, float], ...]:
    """Verses one after another until the song is ``minutes`` long at ``base`` BPM."""
    out: list[tuple[int | None, float]] = []
    beats, i = 0.0, 0
    while beats < minutes * base:
        tune, shift, rest = _VERSES[i % len(_VERSES)]
        for pitch, dur in TUNES[tune][2]:
            out.append((None if pitch is None else pitch + shift, dur))
            beats += dur
        out.append((None, rest))
        beats += rest
        i += 1
    return tuple(out)


@dataclass
class Song:
    name: str
    mix: np.ndarray
    vocals: np.ndarray  # the simulated vocal stem
    backing: np.ndarray  # the simulated instrumental
    onsets: np.ndarray  # true onset of every sung note, seconds
    pitches: np.ndarray
    beat_sec: np.ndarray  # local beat length at each onset


def render(curve: str, minutes: float = 3.0, drift: float = 0.04, base: float = BASE_BPM,
           singer: str = "pro") -> Song:
    """The song on ``curve`` around ``base`` BPM, sung by ``songs.SINGERS[singer]``."""
    import librosa

    sr = songs.SR
    notes = song_notes(minutes, base)
    tune_beats = int(np.ceil(sum(d for _, d in notes)))
    beats = INTRO_BEATS + tune_beats + 4
    clock = Clock.of(tempo_curve(curve, beats, base, drift))
    lead, ref = vocal_synth.render(notes, int(base), songs.SINGERS[singer], sr=sr,
                                   clock=lambda b: clock(INTRO_BEATS + b))
    n = int((clock(beats) + 1.5) * sr)
    lead = np.pad(lead, (0, max(0, n - len(lead))))[:n]

    # The band: one triad a bar on every beat, the bass on the root (the fifth on beat 3),
    # kick and snare, hats on the eighths -- every hit on the moving clock.
    rng = np.random.default_rng(len(curve))
    bar_chords, home = songs._chords(notes, "C major", tune_beats)
    chords_by_beat = [home] * INTRO_BEATS + [c for c in bar_chords for _ in range(4)]
    band = np.zeros(n)
    for k in range(beats):
        pcs = chords_by_beat[k] if k < len(chords_by_beat) else home
        at, length = clock(k), clock(k + 1) - clock(k)
        b = k % 4
        for m in sorted(55 + ((pc - 55) % 12) for pc in pcs):
            songs._add(band, 0.6 * songs._piano(m, length * 0.95, vel=0.9 if b in (0, 2) else 0.6), at * sr)
        root, fifth = 36 + ((pcs[0] - 36) % 12), 36 + ((pcs[2] - 36) % 12)
        songs._add(band, songs._bass(root if b != 2 else fifth, length * 0.9), at * sr)
        songs._add(band, songs._drum("kick" if b in (0, 2) else "snare", rng), at * sr)
        for half in (0.0, 0.5):
            songs._add(band, 0.6 * songs._drum("hat", rng), clock(k + half) * sr)
    voiced = np.abs(lead) > 1e-3
    band *= np.sqrt(np.mean(lead[voiced] ** 2)) / np.sqrt(np.mean(band[voiced] ** 2))

    def down(x: np.ndarray) -> np.ndarray:
        return librosa.resample(x.astype(np.float32), orig_sr=sr, target_sr=STEM_SR)

    vox, inst = down(lead), down(band)
    mix = vox + inst
    stem = vox + inst * 10 ** (-22.0 / 20.0)
    backing = inst + vox * 10 ** (-24.0 / 20.0)
    peak = max(float(np.max(np.abs(a))) for a in (mix, stem, backing)) / 0.9
    onsets = np.array([r.onset_sec for r in ref])
    local = np.array([clock(INTRO_BEATS + r.onset_beat + 1) - clock(INTRO_BEATS + r.onset_beat) for r in ref])
    return Song(f"{curve}_{base:g}bpm_{minutes:g}min_{singer}", mix / peak, stem / peak, backing / peak, onsets,
                np.array([r.pitch_midi for r in ref]), local)


# ── The song path, and what it counted the beats at ───────────────────────────


def _counted(read):
    """(result, bpm, heard) of ``read()``, the song path run as ``studio_songs.transcribe_song``
    runs it (the queue's own rules for a separated song).  ``bpm`` is the tempo the beats were
    counted at, before the result rounds it; ``heard`` is (written beat, beat heard) for every
    note of the sheet, both counted from the result's beat 0."""
    from app.pipeline import transcriber as tr

    seen: dict = {}
    refine, one_per_slot = tr._refine_grid, tr._one_note_per_slot

    def spy_refine(*args, **kwargs):
        out = refine(*args, **kwargs)
        seen.setdefault("bpm", out[0])  # the stem is read first
        return out

    def spy_slots(s, step, heard_at):
        one_per_slot(s, step, heard_at)
        seen.setdefault("heard", [(float(n.offset), heard_at[id(n)]) for n in s.notes if id(n) in heard_at])

    tr._refine_grid, tr._one_note_per_slot = spy_refine, spy_slots
    try:
        result, how = read()
    finally:
        tr._refine_grid, tr._one_note_per_slot = refine, one_per_slot
    if how != "stem":
        raise RuntimeError("the song path read the mixture, not the stem")
    pickup = result.pickup_beats
    return result, float(seen["bpm"]), [(w + pickup, h + pickup) for w, h in seen["heard"]]


def transcribe(song: Song, fast: bool = True):
    """(result, bpm, heard) for a rendered song: see ``_counted``."""
    import soundfile as sf

    from tests.accuracy import studio_songs

    with tempfile.TemporaryDirectory(prefix="nf-song-clock-") as tmp:
        paths = {}
        for part in ("mix", "vocals", "backing"):
            paths[part] = Path(tmp) / f"{part}.wav"
            sf.write(paths[part], getattr(song, part).astype(np.float32), STEM_SR, subtype="PCM_16")
        return _counted(lambda: studio_songs.transcribe_song(paths["mix"], paths["vocals"], paths["backing"], fast=fast))


# Hymn songs of ``tests.accuracy.studio_songs`` (dev half): a steady band, the synthetic singer
# with lyric consonants, scoops and melisma, 2/4, 3/4 and 4/4, pickups.
STUDIO_SLUGS = ("antioch", "aurelia", "austria-haydn", "belmont", "cwm-rhondda", "erfurt", "gloria", "hyfrydol",
                "jewett", "new-britain", "regent-square", "roll-call", "st-catherine", "stockbridge",
                "the-first-noel", "woodbird")


def studio(slug: str, data: Path | None = None) -> tuple[Song, object, float, list[tuple[float, float]]]:
    """(song, result, bpm, heard) for a ``studio_songs`` hymn song on its simulated stems."""
    from tests.accuracy import studio_songs

    case = next(c for c in studio_songs.CASES if c.slug == slug)
    mix, vocals, backing = studio_songs.ensure_stems(data or studio_songs.DEFAULT_DATA, case, "sim")
    result, bpm, heard = _counted(lambda: studio_songs.transcribe_song(mix, vocals, backing))
    ref = studio_songs.reference(case)
    song = Song(f"studio_{slug}", None, None, None, np.array([r.onset_sec for r in ref]),
                np.array([r.pitch_midi for r in ref]), np.full(len(ref), 60.0 / case.tempo_bpm))
    return song, result, bpm, heard


def audio_time_of_beat(beat: np.ndarray, beat_times: list[float] | None, origin: float, tempo: float) -> np.ndarray:
    """The clients' ``audioTimeOfBeat`` (CONTRACT: song backing), vectorised."""
    beat = np.asarray(beat, dtype=float)
    if not beat_times:
        return origin + beat * 60.0 / tempo
    t = np.asarray(beat_times, dtype=float)
    if t.size == 1:
        return np.full_like(beat, t[0])
    i = np.clip(np.floor(beat).astype(int), 0, t.size - 2)
    return t[i] + (beat - i) * (t[i + 1] - t[i])


def _pairs(est_on: np.ndarray, est_pitch: np.ndarray, song: Song) -> list[tuple[int, int]]:
    """One-to-one (sung note, sheet note) of the same pitch, nearest first, within half a beat."""
    cand = [
        (abs(est_on[j] - song.onsets[i]), i, j)
        for i in range(len(song.onsets))
        for j in np.flatnonzero(est_pitch == song.pitches[i])
        if abs(est_on[j] - song.onsets[i]) <= 0.5 * song.beat_sec[i]
    ]
    used_i, used_j, out = set(), set(), []
    for _, i, j in sorted(cand):
        if i not in used_i and j not in used_j:
            used_i.add(i)
            used_j.add(j)
            out.append((i, j))
    return sorted(out)


def _stats(err_sec: np.ndarray) -> dict[str, float]:
    a = np.abs(err_sec) * 1000.0
    if not a.size:
        return {"mean_ms": float("nan"), "p95_ms": float("nan"), "max_ms": float("nan")}
    return {"mean_ms": round(float(a.mean()), 1), "p95_ms": round(float(np.percentile(a, 95)), 1),
            "max_ms": round(float(a.max()), 1)}


def measure(song: Song, result, bpm: float, heard: list[tuple[float, float]]) -> dict:
    notes = sorted(result.notes, key=lambda n: n.start_beat)
    starts = np.array([n.start_beat for n in notes])
    pitch = np.array([n.pitch_midi for n in notes])
    beat_map = getattr(result, "beat_times_sec", None)
    origin = result.beat_origin_sec
    clocks = {
        "wire": audio_time_of_beat(starts, None, origin, result.tempo),
        "exact": audio_time_of_beat(starts, None, origin, bpm),
    }
    if beat_map:
        clocks["map"] = audio_time_of_beat(starts, beat_map, origin, result.tempo)
    heard_of = {round(w, 6): h for w, h in heard}
    clocks["heard"] = np.array([origin + heard_of.get(round(b, 6), np.nan) * 60.0 / bpm for b in starts])
    pairs = _pairs(clocks["heard"], pitch, song)
    i = np.array([p[0] for p in pairs], dtype=int)
    j = np.array([p[1] for p in pairs], dtype=int)
    last = song.onsets[i] >= song.onsets[-1] - 30.0
    out = {"song": song.name, "notes_sung": len(song.onsets), "notes_written": len(notes), "paired": len(pairs),
           "tempo": result.tempo, "bpm": round(bpm, 3), "beat_map_entries": len(beat_map or [])}
    for name, on in clocks.items():
        err = on[j] - song.onsets[i]
        ok = np.isfinite(err)
        out[name] = _stats(err[ok])
        out[f"{name}_last30s"] = _stats(err[ok & last])
    if beat_map:
        mapped = audio_time_of_beat(starts, beat_map, origin, result.tempo)
        out["map_increasing"] = bool(np.all(np.diff(beat_map) > 0))
        out["map_covers_last_note"] = len(beat_map) - 1 >= max(n.start_beat + n.dur_beats for n in notes)
        out["notes_playable"] = int(np.sum(np.isfinite(mapped)))
    return out


def run(curves=CURVES, minutes: float = 3.0, fast: bool = True, drift: float = 0.04, base: float = BASE_BPM,
        singer: str = "pro", slugs: tuple[str, ...] = ()) -> list[dict]:
    rows = []
    for item in slugs or curves:
        started = time.time()
        if slugs:
            song, result, bpm, heard = studio(item)
        else:
            song = render(item, minutes, drift, base, singer)
            result, bpm, heard = transcribe(song, fast=fast)
        row = measure(song, result, bpm, heard)
        row["seconds"] = round(time.time() - started, 1)
        rows.append(row)
        print(json.dumps(row), flush=True)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--curve", action="append", choices=CURVES)
    parser.add_argument("--minutes", type=float, default=3.0)
    parser.add_argument("--drift", type=float, default=0.04, help="the curves' tempo swing (0.04 = +-4%%)")
    parser.add_argument("--bpm", type=float, default=BASE_BPM, help="the tempo the curves move around")
    parser.add_argument("--singer", choices=("pro", "da", "amateur"), default="pro")
    parser.add_argument("--lane", choices=("pro", "normal"), default="pro")
    parser.add_argument("--studio", nargs="*", metavar="SLUG",
                        help="studio_songs hymn songs instead of the curves (all of STUDIO_SLUGS when none named)")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    slugs = () if args.studio is None else tuple(args.studio or STUDIO_SLUGS)
    rows = run(tuple(args.curve or CURVES), args.minutes, args.lane == "pro", args.drift, args.bpm, args.singer, slugs)
    print()
    print(f"{'song':<26}{'tempo':>7}{'bpm':>9}  " + "".join(f"{m + ' p95/max':>20}" for m in ("wire", "exact", "map", "heard")))
    for r in rows:
        cells = "".join(f"{(str(r[m]['p95_ms']) + ' / ' + str(r[m]['max_ms'])) if m in r else '-':>20}"
                        for m in ("wire", "exact", "map", "heard"))
        print(f"{r['song']:<26}{r['tempo']:>7}{r['bpm']:>9}  {cells}")
    if args.out:
        args.out.write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
