from types import SimpleNamespace

from app.pipeline import solfa_render


def test_render_lines_basic():
    notes = [
        SimpleNamespace(start_beat=0.0, dur_beats=1.0, solfa="d", octave_mark=""),
        SimpleNamespace(start_beat=1.0, dur_beats=1.0, solfa="r", octave_mark=""),
        SimpleNamespace(start_beat=2.0, dur_beats=2.0, solfa="m", octave_mark=""),
    ]
    lines = solfa_render.render_lines(notes, "Doh is C", "4/4")
    assert lines[0] == "Doh is C"
    assert lines[1] == "| d - r - m - - - |"


def test_render_curwen_lines_basic_4_4():
    notes = [
        SimpleNamespace(start_beat=0.0, dur_beats=1.0, solfa="d", octave_mark=""),
        SimpleNamespace(start_beat=1.0, dur_beats=0.5, solfa="r", octave_mark=""),
        SimpleNamespace(start_beat=1.5, dur_beats=0.5, solfa="m", octave_mark=""),
        SimpleNamespace(start_beat=2.0, dur_beats=2.0, solfa="f", octave_mark=""),
    ]
    lines = solfa_render.render_curwen_lines(notes, "Doh is C", "4/4")
    assert lines[0] == "Doh is C"
    assert lines[1] == "| d : r . m : f : - |"


def test_render_curwen_lines_3_4_with_rests_and_octave():
    notes = [
        SimpleNamespace(start_beat=0.0, dur_beats=1.0, solfa="s", octave_mark="₁"),
        SimpleNamespace(start_beat=2.0, dur_beats=1.0, solfa="d", octave_mark="'"),
    ]
    lines = solfa_render.render_curwen_lines(notes, "Doh is G", "3/4")
    assert lines[0] == "Doh is G"
    assert lines[1] == "| s₁ :   : d' |"


def test_render_curwen_lines_empty():
    lines = solfa_render.render_curwen_lines([], "Doh is F", "4/4")
    assert lines == ["Doh is F"]
