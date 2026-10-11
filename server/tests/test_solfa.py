"""Unit tests for the movable-do solfa engine (app/pipeline/solfa.py).

These mirror the C# Core/Solfa tests: the two implementations must agree syllable
for syllable, or a key override on the client diverges from the server's labels.
Pure functions - no inference, fast.
"""

import pytest

from app.pipeline import solfa


# --- doh_pitch_class: la-based minor (TRD par. 4.1) ---------------------------

def test_doh_is_tonic_for_major():
    assert solfa.doh_pitch_class(0, "major") == 0     # C major -> doh C
    assert solfa.doh_pitch_class(7, "major") == 7     # G major -> doh G


def test_doh_is_relative_major_for_minor():
    # A minor (pc 9) -> doh is C (pc 0): (9 + 3) % 12 == 0
    assert solfa.doh_pitch_class(9, "minor") == 0
    # E minor (pc 4) -> doh is G (pc 7)
    assert solfa.doh_pitch_class(4, "minor") == 7


# --- syllable: degrees, chromatics, octave marks ------------------------------

@pytest.mark.parametrize("semitone,expected_syllable,expected_degree", [
    (0, "d", 1), (2, "r", 2), (4, "m", 3), (5, "f", 4),
    (7, "s", 5), (9, "l", 6), (11, "t", 7),
])
def test_diatonic_syllables_in_c_major(semitone, expected_syllable, expected_degree):
    ref = 60  # middle-C doh, unmarked register
    syl, mark, degree = solfa.syllable(60 + semitone, doh_pc=0, ref_doh_midi=ref)
    assert syl == expected_syllable
    assert degree == expected_degree
    assert mark == ""


def test_raised_fourth_is_fe():
    # F# above C doh is the raised 4th -> 'fe' (ascending chromatic table)
    syl, _, degree = solfa.syllable(66, doh_pc=0, ref_doh_midi=60)
    assert syl == "fe"
    assert degree == 4  # still the 4th degree, just chromatically raised


def test_octave_marks_above_and_below():
    # An octave above the reference doh gets one prime; below gets one comma.
    _, above, _ = solfa.syllable(72, doh_pc=0, ref_doh_midi=60)
    _, at, _ = solfa.syllable(60, doh_pc=0, ref_doh_midi=60)
    _, below, _ = solfa.syllable(48, doh_pc=0, ref_doh_midi=60)
    assert above == "'"
    assert at == ""
    assert below == ","


def test_two_octaves_below_gets_two_commas():
    _, mark, _ = solfa.syllable(36, doh_pc=0, ref_doh_midi=60)
    assert mark == ",,"


# --- reference_doh: nearest doh to the melody median --------------------------

def test_reference_doh_picks_nearest_octave_to_median():
    # Median sits near 62; nearest C (pc 0) is middle C (60), not 48 or 72.
    ref = solfa.reference_doh([60, 62, 64], doh_pc=0)
    assert ref == 60


def test_doh_header_names_the_pitch():
    assert solfa.doh_header(0) == "Doh is C"
    assert solfa.doh_header(6) == "Doh is F#"


def test_doh_header_spells_the_doh_like_the_key_signature():
    # Bb major is written with two flats; "A#" would be ten sharps no choir reads.
    assert solfa.doh_header(10) == "Doh is Bb"
    assert [solfa.doh_header(pc) for pc in (1, 3, 8)] == ["Doh is Db", "Doh is Eb", "Doh is Ab"]


# --- ascending_flags: chromatic spelling follows melodic direction -------------

def test_a_rising_chromatic_is_spelled_sharp():
    # C C# D — the C# is passed through on the way up, so it is a raised doh.
    flags = solfa.ascending_flags([60, 61, 62])
    assert flags[1] is True
    syl, _, _ = solfa.syllable(61, doh_pc=0, ref_doh_midi=60, ascending=flags[1])
    assert syl == "de"


def test_a_falling_chromatic_is_spelled_flat():
    # D C# C — the same pitch, arrived at from above, is a lowered re.
    flags = solfa.ascending_flags([62, 61, 60])
    assert flags[1] is False
    syl, _, _ = solfa.syllable(61, doh_pc=0, ref_doh_midi=60, ascending=flags[1])
    assert syl == "ra"


def test_direction_comes_from_where_the_melody_arrived_from():
    # C C# C: rising into the chromatic, falling out of it.  The approach wins, so
    # this is an upper neighbour of doh (de) rather than a lower neighbour of re.
    assert solfa.ascending_flags([60, 61, 60])[1] is True
    # E D# E: falling into it, rising out.  Still the approach.
    assert solfa.ascending_flags([64, 63, 64])[1] is False


def test_the_first_note_looks_ahead_because_nothing_precedes_it():
    assert solfa.ascending_flags([61, 62])[0] is True
    assert solfa.ascending_flags([61, 60])[0] is False


def test_a_single_pitch_is_ascending_by_convention():
    assert solfa.ascending_flags([61]) == [True]
    assert solfa.ascending_flags([61, 61, 61]) == [True, True, True]


def test_an_empty_melody_has_no_flags():
    assert solfa.ascending_flags([]) == []


def test_a_repeated_chromatic_keeps_one_spelling():
    # D C# C# E.  Taking the literal previous note would make the second C# look ahead
    # to E and flip it, printing "ra de" on one sung pitch — so the run shares a flag.
    flags = solfa.ascending_flags([62, 61, 61, 64])
    assert flags[1] == flags[2] is False


def test_a_repeat_at_the_head_looks_past_itself():
    # C# C# D: the opening run has nothing behind it, so the whole run reads the pitch
    # the melody leaves for.  The note after it reads the run, as usual.
    assert solfa.ascending_flags([61, 61, 62]) == [True, True, True]
    assert solfa.ascending_flags([61, 61, 60]) == [False, False, False]


@pytest.mark.parametrize("semitone", [0, 2, 4, 5, 7, 9, 11])
def test_direction_cannot_change_a_diatonic_syllable(semitone):
    # The two tables are identical on all seven diatonic degrees, which is what makes
    # this change unable to touch a note that prints no accidental.
    up, _, _ = solfa.syllable(60 + semitone, doh_pc=0, ref_doh_midi=60, ascending=True)
    down, _, _ = solfa.syllable(60 + semitone, doh_pc=0, ref_doh_midi=60, ascending=False)
    assert up == down


@pytest.mark.parametrize(
    ("semitone", "up", "down"),
    [(1, "de", "ra"), (3, "re", "ma"), (6, "fe", "sa"), (8, "se", "la"), (10, "le", "ta")],
)
def test_every_chromatic_degree_has_both_spellings(semitone, up, down):
    rising, _, deg_up = solfa.syllable(60 + semitone, doh_pc=0, ref_doh_midi=60, ascending=True)
    falling, _, deg_down = solfa.syllable(60 + semitone, doh_pc=0, ref_doh_midi=60, ascending=False)
    assert (rising, falling) == (up, down)
    # The degree is shared: SEMITONE_TO_DEGREE is one table, so re-spelling a note
    # never moves which degree it is.
    assert deg_up == deg_down


def test_direction_does_not_move_the_octave_mark():
    _, up, _ = solfa.syllable(73, doh_pc=0, ref_doh_midi=60, ascending=True)
    _, down, _ = solfa.syllable(73, doh_pc=0, ref_doh_midi=60, ascending=False)
    assert up == down == "'"


def test_resolve_ascending_honours_explicit_spelling_modes():
    assert solfa.resolve_ascending(False, "direction") is False
    assert solfa.resolve_ascending(False, "ascending") is True
    assert solfa.resolve_ascending(True, "descending") is False
