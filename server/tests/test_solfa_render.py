from types import SimpleNamespace

from app.pipeline.solfa_render import render_lines


def _note(start, duration, solfa):
    return SimpleNamespace(
        start_beat=start,
        dur_beats=duration,
        solfa=solfa,
        octave_mark="",
    )


def test_renders_rests_and_held_cells_on_the_grid():
    notes = [_note(1.0, 1.5, "d")]

    assert render_lines(notes, "Doh is C", divisions_per_beat=2) == [
        "Doh is C",
        "| _ _ | d - _ _ | _ _ _ _ | _ _ _ _ | _ _ _ _ |",
    ]


def test_renders_simultaneous_starts_without_dropping_a_voice():
    notes = [_note(0.0, 1.0, "d"), _note(0.0, 1.0, "m")]

    lines = render_lines(notes, "Doh is C", divisions_per_beat=1)

    assert lines[1].startswith("| d+m - _ _ |")


def test_snaps_small_start_drift_to_the_nearest_display_cell():
    notes = [_note(0.51, 0.5, "r")]

    lines = render_lines(notes, "Doh is C", divisions_per_beat=2)

    assert lines[1].startswith("| _ _ r _ |")


def test_empty_note_list_keeps_only_the_header():
    assert render_lines([], "Doh is C") == ["Doh is C"]
