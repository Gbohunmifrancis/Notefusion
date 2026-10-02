"""Real-singing benchmark: the melody pipeline on Vocadito (40 solo singers, two annotators).

    python -m tests.accuracy.vocadito            # downloads ~58 MB once, ~10 minutes
    python -m tests.accuracy.vocadito --decoder  # voice decoder only, ~1 minute

The synthetic sung corpus (``report --vocal``) knows the intended notes exactly, but its
singers are only as imprecise as someone chose to make them; this one is real voices.
Vocadito (Bittner et al., ISMIR 2021, CC BY 4.0) gives each note as the frequency that
was *sung*, not the note that was meant, and untrained singers land a median 25-30 cents
off their semitone, so "the right note" needs a definition.  The reference used here is
the one a musician writing the tune down would use: each annotator's notes are written in
the major scale that best fits them (``vocal.fit_scale`` / ``snap_to_scale``), and a clip
is scored only when both annotators' notes fit the *same* scale (32 of the 40) — there
the doh is not in question.  Annotator 2 scored against annotator 1 is the human ceiling.

Columns:
  solfa_ser     solfa syllable edit distance / reference length, each side in its own key
  doh           the output's doh equals the consensus scale's (a whole-tune semitone shift
                counts as wrong here although its solfa is identical)
  interval_ser  pitch-interval edit distance: notes heard right regardless of key
  accidentals   share of output syllables that carry an accidental (de, ma, fe, se, ta...)

Measurement only, never run by ``pytest``.  The audio is not committed; it is downloaded to
``~/.cache/notefusion/vocadito`` (or ``--data``).
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import time
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

from app.pipeline import vocal

ZENODO_URL = "https://zenodo.org/api/records/5578807/files/vocadito.zip/content"
DEFAULT_DATA = Path.home() / ".cache" / "notefusion" / "vocadito"
SYLLABLES = {0: "d", 1: "de", 2: "r", 3: "ma", 4: "m", 5: "f", 6: "fe", 7: "s", 8: "se", 9: "l", 10: "ta", 11: "t"}
_PITCH_CLASS = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6,
                "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}


def ensure_data(data: Path) -> Path:
    if (data / "Audio").is_dir():
        return data
    data.mkdir(parents=True, exist_ok=True)
    print(f"downloading Vocadito to {data} ...", flush=True)
    with urllib.request.urlopen(ZENODO_URL, timeout=300) as response:  # noqa: S310 - fixed https URL
        archive = zipfile.ZipFile(io.BytesIO(response.read()))
    for member in archive.namelist():
        if not member.startswith("__MACOSX"):
            archive.extract(member, data)
    return data


def load_notes(path: Path) -> list[tuple[float, float, float]]:
    """(start, end, fractional MIDI) per annotated note."""
    notes = []
    with path.open() as fh:
        for row in csv.reader(fh):
            if len(row) >= 3 and float(row[1]) > 0 and float(row[2]) > 0:
                start, hz, dur = float(row[0]), float(row[1]), float(row[2])
                notes.append((start, start + dur, 69.0 + 12.0 * np.log2(hz / 440.0)))
    return sorted(notes)


def written(notes: list[tuple[float, float, float]]) -> tuple[int, list[int]] | None:
    """(scale root, notes written in that scale), or None when too few to fit."""
    fit = vocal.fit_scale([m for *_, m in notes], [b - a for a, b, _ in notes])
    if fit is None:
        return None
    offset, root = fit
    return root, vocal.snap_to_scale([m - offset for *_, m in notes], root)


def edit_distance(a: list, b: list) -> int:
    row = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        previous, row[0] = row[0], i
        for j in range(1, len(b) + 1):
            current = min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] != b[j - 1]))
            previous, row[j] = row[j], current
    return row[-1]


def doh_of_key(key: str) -> int:
    name, mode = key.split()
    pc = _PITCH_CLASS[name.replace("-", "b")]
    return pc if mode == "major" else (pc + 3) % 12


def score(ref_root: int, ref_pitches: list[int], est_doh: int, est_pitches: list[int], est_syllables: list[str]) -> dict:
    ref_syllables = [SYLLABLES[(p - ref_root) % 12] for p in ref_pitches]
    return {
        "solfa_ser": edit_distance(ref_syllables, est_syllables) / max(1, len(ref_syllables)),
        "doh": float(est_doh == ref_root),
        "interval_ser": edit_distance(np.diff(ref_pitches).tolist(), np.diff(est_pitches).tolist()) / max(1, len(ref_pitches) - 1),
        "accidentals": sum(len(s) == 2 for s in est_syllables) / max(1, len(est_syllables)),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m tests.accuracy.vocadito", description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--decoder", action="store_true", help="score vocal.analyse() only, not the whole pipeline")
    parser.add_argument("--out", type=Path, default=None, help="write per-clip rows and the aggregate as JSON")
    args = parser.parse_args(argv)
    data = ensure_data(args.data)

    import librosa

    rows, human = [], []
    for clip in range(1, 41):
        a1 = written(load_notes(data / "Annotations" / "Notes" / f"vocadito_{clip}_notesA1.csv"))
        a2 = written(load_notes(data / "Annotations" / "Notes" / f"vocadito_{clip}_notesA2.csv"))
        if a1 is None or a2 is None or a1[0] != a2[0]:
            continue  # the annotators' notes do not agree on a scale: no doh to score against
        root, ref_pitches = a1
        human.append(score(root, ref_pitches, a2[0], a2[1], [SYLLABLES[(p - a2[0]) % 12] for p in a2[1]]))
        audio = data / "Audio" / f"vocadito_{clip}.wav"
        started = time.time()
        if args.decoder:
            y, sr = librosa.load(audio, sr=vocal.SAMPLE_RATE, mono=True)
            analysis = vocal.analyse(y, sr, contour=vocal.track(vocal.condition(y, sr), sr))
            pitches = [n.pitch for n in analysis.notes]
            doh = analysis.scale_root if analysis.scale_root is not None else 0
            syllables = [SYLLABLES[(p - doh) % 12] for p in pitches]
        else:
            from app.pipeline.transcriber import transcribe

            result = transcribe(audio, mode="melody", audio_preview=False)
            pitches = [n.pitch_midi for n in result.notes]
            doh = doh_of_key(result.key)
            syllables = [n.solfa for n in result.notes]
        row = {"clip": clip, "seconds": round(time.time() - started, 1), **score(root, ref_pitches, doh, pitches, syllables)}
        rows.append(row)
        print(f"vocadito_{clip:<3} solfa_ser {row['solfa_ser']:.2f}  doh {int(row['doh'])}  interval_ser {row['interval_ser']:.2f}  accidentals {row['accidentals']:.2f}", flush=True)

    def mean(table: list[dict], key: str) -> float:
        return round(float(np.mean([r[key] for r in table])), 3)

    keys = ("solfa_ser", "doh", "interval_ser", "accidentals")
    summary = {"clips": len(rows), "engine": {k: mean(rows, k) for k in keys}, "human_ceiling": {k: mean(human, k) for k in keys}}
    print(json.dumps(summary, indent=1))
    if args.out:
        args.out.write_text(json.dumps({"summary": summary, "rows": rows}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
