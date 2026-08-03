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
