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


def _line(*notes):
    return [SimpleNamespace(start_beat=s, dur_beats=d, solfa=t, octave_mark="") for s, d, t in notes]


def test_a_sheet_on_eighths_keeps_two_cells_a_beat_and_one_on_sixteenths_gets_four():
    assert solfa_render.divisions_for(_line((0.0, 1.0, "d"), (1.0, 0.5, "r"), (1.5, 2.5, "m"))) == 2
    assert solfa_render.divisions_for(_line((0.0, 0.75, "d"), (0.75, 0.25, "r"))) == 4
    assert solfa_render.divisions_for(_line((0.0, 0.25, "d"), (0.5, 0.5, "r"))) == 4  # ends between
    assert solfa_render.divisions_for([]) == 2


def test_the_grid_gives_sixteenths_a_cell_each_instead_of_a_chord():
    notes = _line((0.0, 0.25, "d"), (0.25, 0.25, "r"), (0.5, 0.5, "m"), (1.0, 3.0, "f"))
    lines = solfa_render.render_lines(notes, "Doh is C", "4/4")
    assert lines[1] == "| d r m - f - - - - - - - - - - - |"
    assert "+" not in lines[1]


def test_curwen_writes_quarters_within_their_half():
    four = _line((0.0, 0.25, "d"), (0.25, 0.25, "r"), (0.5, 0.25, "m"), (0.75, 0.25, "f"), (1.0, 3.0, "s"))
    assert solfa_render.render_curwen_lines(four, "Doh is C")[1] == "| d,r . m,f : s : - : - |"
    dotted = _line((0.0, 0.75, "d"), (0.75, 0.25, "r"), (1.0, 3.0, "m"))
    assert solfa_render.render_curwen_lines(dotted, "Doh is C")[1] == "| d . ,r : m : - : - |"
    snap = _line((0.0, 0.25, "d"), (0.25, 0.75, "r"), (1.0, 0.5, "m"), (1.5, 0.25, "f"), (1.75, 2.25, "s"))
    assert solfa_render.render_curwen_lines(snap, "Doh is C")[1] == "| d,r : m . f,s : - : - |"
    # A sheet on eighths reads exactly as it always has.
    eighths = _line((0.0, 1.0, "d"), (1.0, 0.5, "r"), (1.5, 0.5, "m"), (2.0, 2.0, "f"))
    assert solfa_render.render_curwen_lines(eighths, "Doh is C")[1] == "| d : r . m : f : - |"
