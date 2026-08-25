"""Rhythm-aware rendering of the structured solfa note list.

The note DTO remains the source of truth.  This module only formats it for the
compact phone-friendly ``solfaLines`` field, preserving rests and held beats so
the text view agrees with the staff notation's rhythm grid.
"""

from collections.abc import Sequence
import math


def _beats_per_bar(time_signature: str) -> float:
    try:
        numerator, denominator = (int(part) for part in time_signature.split("/", 1))
        if numerator > 0 and denominator > 0:
            return numerator * 4.0 / denominator
    except (TypeError, ValueError):
        pass
    return 4.0


def render_lines(
    notes: Sequence,
    header: str,
    time_signature: str = "4/4",
    divisions_per_beat: int = 2,
    bars_per_line: int = 4,
) -> list[str]:
    """Render notes as bar-aligned cells.

    A cell contains a syllable when a note starts there, ``-`` while a note is
    being held, and ``_`` for a rest.  Simultaneous starts are joined with ``+``
    so polyphonic output remains explicit instead of silently dropping a voice.
    """
    divisions_per_beat = max(1, int(divisions_per_beat))
    bars_per_line = max(1, int(bars_per_line))
    bar_beats = _beats_per_bar(time_signature)
    cell_beats = 1.0 / divisions_per_beat
    cells_per_bar = max(1, int(round(bar_beats * divisions_per_beat)))

    if not notes:
        return [header]

    max_end = max(
        float(getattr(note, "start_beat", 0.0)) + max(0.0, float(getattr(note, "dur_beats", 0.0)))
        for note in notes
    )
    bar_count = max(1, int(math.ceil(max_end / bar_beats - 1e-9)))
    cells: list[str] = []

    ordered = sorted(notes, key=lambda note: (float(note.start_beat), float(note.dur_beats)))
    starts_by_cell: dict[int, list] = {}
    quantized_start: dict[int, float] = {}
    for note in ordered:
        # Use explicit half-up rounding so this matches JavaScript's Math.floor(x + .5)
        # in the mobile renderer; Python's round() uses banker's ties.
        cell_index = int(math.floor(float(note.start_beat) / cell_beats + 0.5))
        quantized_start[id(note)] = cell_index * cell_beats
        if 0 <= cell_index < bar_count * cells_per_bar:
            starts_by_cell.setdefault(cell_index, []).append(note)
    for cell_index in range(bar_count * cells_per_bar):
        start = cell_index * cell_beats
        end = start + cell_beats
        starts = starts_by_cell.get(cell_index, [])
        active = [
            note
            for note in ordered
            if quantized_start[id(note)] < end - 1e-9
            and quantized_start[id(note)] + max(0.0, float(note.dur_beats)) > start + 1e-9
        ]
        if starts:
            token = "+".join(
                f"{getattr(note, 'solfa', '')}{getattr(note, 'octave_mark', '')}"
                for note in starts
            )
        elif active:
            token = "-"
        else:
            token = "_"
        cells.append(token or "_")

    bars = [
        " ".join(cells[index : index + cells_per_bar])
        for index in range(0, len(cells), cells_per_bar)
    ]
    return [header] + [
        "| " + " | ".join(bars[index : index + bars_per_line]) + " |"
        for index in range(0, len(bars), bars_per_line)
    ]
