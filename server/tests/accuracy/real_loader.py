"""Load labelled real recordings for the accuracy harness.

The loader is intentionally separate from the synthetic corpus.  Real fixtures are
optional in a checkout, but every fixture that exists must be valid and deterministic.
"""

from __future__ import annotations

import json
import hashlib
from dataclasses import dataclass
from pathlib import Path

from tests.accuracy.synth import RefNote


@dataclass(frozen=True)
class RealCase:
    name: str
    audio_path: Path
    key: str
    tempo_bpm: int
    notes: tuple[RefNote, ...]


def _number(value: object, field: str, path: Path) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{path.name}: {field} must be a number")
    result = float(value)
    if not result >= 0.0:
        raise ValueError(f"{path.name}: {field} must be non-negative")
    return result


def _load_sidecar(path: Path) -> RealCase:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path.name}: invalid JSON: {exc.msg}") from exc

    if isinstance(payload, list):
        raise ValueError(
            f"{path.name}: legacy bare-list sidecars are unsupported; add key and tempo_bpm"
        )
    if not isinstance(payload, dict):
        raise ValueError(f"{path.name}: root must be an object")

    key = payload.get("key")
    if not isinstance(key, str) or not key.strip():
        raise ValueError(f"{path.name}: key is required")
    tempo = payload.get("tempo_bpm")
    if isinstance(tempo, bool) or not isinstance(tempo, (int, float)):
        raise ValueError(f"{path.name}: tempo_bpm is required")
    if int(tempo) != tempo or not 20 <= int(tempo) <= 400:
        raise ValueError(f"{path.name}: tempo_bpm must be an integer between 20 and 400")

    raw_notes = payload.get("notes")
    if not isinstance(raw_notes, list) or not raw_notes:
        raise ValueError(f"{path.name}: notes must be a non-empty list")

    rows: list[tuple[int, float, float]] = []
    for index, row in enumerate(raw_notes):
        if not isinstance(row, dict):
            raise ValueError(f"{path.name}: notes[{index}] must be an object")
        pitch = row.get("pitch_midi")
        if isinstance(pitch, bool) or not isinstance(pitch, int) or not 0 <= pitch <= 127:
            raise ValueError(f"{path.name}: notes[{index}].pitch_midi must be 0..127")
        onset = _number(row.get("onset_sec"), f"notes[{index}].onset_sec", path)
        duration = _number(row.get("dur_sec"), f"notes[{index}].dur_sec", path)
        if duration <= 0:
            raise ValueError(f"{path.name}: notes[{index}].dur_sec must be positive")
        rows.append((pitch, onset, duration))

    if any(rows[index][1] > rows[index + 1][1] for index in range(len(rows) - 1)):
        raise ValueError(f"{path.name}: notes must be ordered by onset_sec")
    first_onset = rows[0][1]
    scale = int(tempo) / 60.0
    notes = tuple(
        RefNote(
            pitch_midi=pitch,
            onset_sec=onset,
            dur_sec=duration,
            onset_beat=(onset - first_onset) * scale,
            dur_beats=duration * scale,
        )
        for pitch, onset, duration in rows
    )
    # Both names come off the same stem.  ``with_suffix`` cannot be used here: it
    # replaces only the final suffix, so ``clip.truth.json`` becomes
    # ``clip.truth.wav`` and the audio beside it is never found.
    stem = path.name.removesuffix(".truth.json")
    audio_path = path.with_name(f"{stem}.wav")
    if not audio_path.is_file():
        raise ValueError(f"{path.name}: missing audio file {audio_path.name}")
    return RealCase(stem, audio_path, key.strip(), int(tempo), notes)


def load_real_cases(directory: Path | None = None) -> tuple[RealCase, ...]:
    """Load all real fixtures, sorted by stable case name.

    An empty directory is valid and returns no cases; malformed fixtures are errors.
    """
    root = directory or Path(__file__).parent / "real"
    sidecars = sorted(root.glob("*.truth.json"))
    return tuple(_load_sidecar(path) for path in sidecars)


def real_corpus_fingerprint(cases: tuple[RealCase, ...] | list[RealCase]) -> str:
    """Return a short fingerprint for the labelled audio and sidecar contents."""
    digest = hashlib.sha256()
    for case in sorted(cases, key=lambda item: item.name):
        digest.update(case.name.encode("utf-8"))
        digest.update(case.key.encode("utf-8"))
        digest.update(str(case.tempo_bpm).encode("ascii"))
        digest.update(case.audio_path.read_bytes())
        for note in case.notes:
            digest.update(
                f"{note.pitch_midi}:{note.onset_sec:.9f}:{note.dur_sec:.9f}".encode("ascii")
            )
    return digest.hexdigest()[:16]
