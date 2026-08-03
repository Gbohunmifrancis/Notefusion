"""Tests for the transcriber's key-override parser (app/pipeline/transcriber._parse_key_override).

The parser feeds the "manual key wins" path (TRD par. 4.1). It must accept every
spelling the client's C# KeyParser accepts and reject the same garbage, or an
override silently mislabels the piece.
"""

import pytest

from app.pipeline.transcriber import _parse_key_override


@pytest.mark.parametrize("text,tonic_pc,mode", [
    ("C", 0, "major"),
    ("c", 0, "major"),
    ("G", 7, "major"),
    ("F#", 6, "major"),
    ("Gb", 6, "major"),
    ("Bb", 10, "major"),
    ("C#", 1, "major"),
    ("C♯", 1, "major"),      # unicode sharp
    ("D♭", 1, "major"),      # unicode flat
])
def test_parses_major_spellings(text, tonic_pc, mode):
    k = _parse_key_override(text)
    assert k.tonic.pitchClass == tonic_pc
    assert k.mode == mode


@pytest.mark.parametrize("text,tonic_pc", [
    ("Am", 9),
    ("A minor", 9),
    ("A min", 9),
    ("f#m", 6),
    ("F# minor", 6),
    ("Ebm", 3),
    ("bbm", 10),             # b-flat minor: the letter 'b' is not eaten by the flat rule
])
def test_parses_minor_spellings(text, tonic_pc):
    k = _parse_key_override(text)
    assert k.tonic.pitchClass == tonic_pc
    assert k.mode == "minor"


@pytest.mark.parametrize("text", [
    ("C major"), ("C maj"), ("Bb major"),
])
def test_parses_explicit_major(text):
    assert _parse_key_override(text).mode == "major"


def test_b_natural_is_not_flattened():
    # Regression: the old parser did text.replace("b","-"), turning bare 'b' into ''.
    assert _parse_key_override("b").tonic.pitchClass == 11  # B natural


@pytest.mark.parametrize("text", [
    "", "   ", None, "m", "H", "Cx", "123", "#", "Zb",
])
def test_rejects_invalid_input(text):
    with pytest.raises(ValueError):
        _parse_key_override(text)


def test_stacked_accidentals_cancel():
    # '#' then 'b' cancel: C#b == C natural, mirroring the C# parser.
    assert _parse_key_override("C#b").tonic.pitchClass == 0
