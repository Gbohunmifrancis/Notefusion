"""Tests for the transcriber's key-override parser (app/pipeline/transcriber._parse_key_override).

The parser feeds the "manual key wins" path (TRD par. 4.1). It must accept every
spelling the client's C# KeyParser accepts — including the dash-flat ("-") notation
used by music21 internally — and reject the same garbage inputs.

New in accuracy-improvement pass:
  - "-" is now accepted as a flat character so that music21 round-trips work
    (e.g. "B- major" parsed from a stored key string).
  - "Auto" / "null" / "none" are sanitised to None before reaching this function
    (handled in the Python route layer), so they are NOT tested here as rejections.
"""

import pytest
from app.pipeline.transcriber import _parse_key_override

# ── Standard "b" / "♭" flat notation ─────────────────────────────────────────


@pytest.mark.parametrize(
    "text,tonic_pc,mode",
    [
        ("C", 0, "major"),
        ("c", 0, "major"),
        ("G", 7, "major"),
        ("F#", 6, "major"),
        ("Gb", 6, "major"),
        ("Bb", 10, "major"),
        ("Eb", 3, "major"),
        ("Ab", 8, "major"),
        ("Db", 1, "major"),
        ("C#", 1, "major"),
        ("C♯", 1, "major"),  # unicode sharp
        ("D♭", 1, "major"),  # unicode flat
        ("B♭", 10, "major"),  # unicode flat on Bb
    ],
)
def test_parses_major_spellings(text, tonic_pc, mode):
    k = _parse_key_override(text)
    assert k.tonic.pitchClass == tonic_pc
    assert k.mode == mode


@pytest.mark.parametrize(
    "text,tonic_pc",
    [
        ("Am", 9),
        ("A minor", 9),
        ("A min", 9),
        ("f#m", 6),
        ("F# minor", 6),
        ("Ebm", 3),
        ("bbm", 10),  # b-flat minor: 'b' is the letter, second 'b' is flat accidental
        ("Bbm", 10),
        ("Abm", 8),
    ],
)
def test_parses_minor_spellings(text, tonic_pc):
    k = _parse_key_override(text)
    assert k.tonic.pitchClass == tonic_pc
    assert k.mode == "minor"


@pytest.mark.parametrize(
    "text",
    [
        "C major",
        "C maj",
        "Bb major",
        "F# major",
        "Eb major",
    ],
)
def test_parses_explicit_major(text):
    assert _parse_key_override(text).mode == "major"


# ── music21 dash-flat ("-") notation ─────────────────────────────────────────
#
# music21 uses "-" as its internal flat marker (e.g. "B-" for B♭).
# The Python pipeline normalises these before storing, but _parse_key_override
# must also accept them directly so that old stored keys and any
# future code paths that bypass normalisation don't crash.


@pytest.mark.parametrize(
    "text,tonic_pc,mode",
    [
        ("B-", 10, "major"),  # B♭ major
        ("E-", 3, "major"),  # E♭ major
        ("A-", 8, "major"),  # A♭ major
        ("D-", 1, "major"),  # D♭ major
        ("G-", 6, "major"),  # G♭ major
        ("C-", 11, "major"),  # C♭ major (enharmonic = B)
        ("F-", 4, "major"),  # F♭ major (enharmonic = E)
        ("B- major", 10, "major"),
        ("E- major", 3, "major"),
        ("A- major", 8, "major"),
        ("B- minor", 10, "minor"),
        ("E- minor", 3, "minor"),
        ("b- major", 10, "major"),  # lowercase tonic (music21 minor-style)
        ("e- minor", 3, "minor"),
        ("a- major", 8, "major"),
        ("f- minor", 4, "minor"),  # F♭ minor
    ],
)
def test_parses_music21_dash_flat_notation(text, tonic_pc, mode):
    k = _parse_key_override(text)
    assert k.tonic.pitchClass == tonic_pc, f"pitch class mismatch for {text!r}"
    assert k.mode == mode, f"mode mismatch for {text!r}"


# ── Round-trips for all keys the Python worker can return ─────────────────────
#
# These are the exact strings _normalise_key_name() produces.
# Every one must survive _parse_key_override without raising ValueError,
# since they can appear in "key override" calls from stored transcriptions.


@pytest.mark.parametrize(
    "text,tonic_pc,mode",
    [
        ("C major", 0, "major"),
        ("G major", 7, "major"),
        ("D major", 2, "major"),
        ("A major", 9, "major"),
        ("E major", 4, "major"),
        ("B major", 11, "major"),
        ("F major", 5, "major"),
        ("Bb major", 10, "major"),
        ("Eb major", 3, "major"),
        ("Ab major", 8, "major"),
        ("Db major", 1, "major"),
        ("F# major", 6, "major"),
        ("C# major", 1, "major"),
        ("A minor", 9, "minor"),
        ("E minor", 4, "minor"),
        ("D minor", 2, "minor"),
        ("G minor", 7, "minor"),
        ("C minor", 0, "minor"),
        ("B minor", 11, "minor"),
        ("F# minor", 6, "minor"),
        ("C# minor", 1, "minor"),
        ("Bb minor", 10, "minor"),
        ("Eb minor", 3, "minor"),
        ("Ab minor", 8, "minor"),
        ("F minor", 5, "minor"),
    ],
)
def test_round_trips_all_normalised_detected_keys(text, tonic_pc, mode):
    k = _parse_key_override(text)
    assert k.tonic.pitchClass == tonic_pc, f"pitch class mismatch for {text!r}"
    assert k.mode == mode, f"mode mismatch for {text!r}"


# ── Stacked / cancelling accidentals ─────────────────────────────────────────


def test_stacked_accidentals_cancel():
    # "#" then "b" cancel: C#b == C natural, mirroring the C# parser.
    assert _parse_key_override("C#b").tonic.pitchClass == 0


def test_dash_and_sharp_cancel():
    # "B-#" = B♭ sharpened back to B = pc 11
    assert _parse_key_override("B-#").tonic.pitchClass == 11


def test_double_dash_lowers_by_two():
    # "D--" = D double-flat = enharmonic C = pc 0
    assert _parse_key_override("D--").tonic.pitchClass == 0


def test_b_natural_is_not_flattened():
    # Regression: the old parser did text.replace("b", "-"), turning bare 'b' into ''.
    # "b" with no mode suffix means B natural (pc 11), not B-flat.
    assert _parse_key_override("b").tonic.pitchClass == 11


def test_bbm_is_b_flat_minor_not_b_double_flat():
    # "bbm" → tonic letter 'b' (pc 11), accidental 'b' (pc 10), mode 'm' → B♭ minor
    k = _parse_key_override("bbm")
    assert k.tonic.pitchClass == 10
    assert k.mode == "minor"


# ── Rejection paths ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "text",
    [
        "",
        "   ",
        None,
        "m",  # bare mode suffix, no tonic
        "H",  # invalid note letter
        "Cx",  # unknown accidental character
        "123",
        "#",  # sharp with no tonic
        "-",  # dash-flat with no tonic
        "minor",  # bare mode word
        "major",  # bare mode word
    ],
)
def test_rejects_invalid_input(text):
    with pytest.raises((ValueError, AttributeError)):
        _parse_key_override(text)


def test_rejects_an_overlong_key_before_parsing_it():
    # A megabyte of sharps is still "C sharp ... sharp" to the loop; it is refused unread.
    assert _parse_key_override("Bbb minor").tonic.pitchClass == 9
    with pytest.raises(ValueError, match="too long"):
        _parse_key_override("C" + "#" * 20)


# ── Specific regression: "Auto" is sanitised upstream, not here ──────────────
#
# "Auto" is handled by the route layer (routes.py strips it to None before
# calling _parse_key_override). This test documents that fact — if "Auto"
# somehow reaches _parse_key_override it IS rejected, which is the right
# behaviour since we don't want a silent mis-parse.


def test_auto_is_rejected_if_it_reaches_the_parser():
    # "Auto" → tonic letter 'a' ok, rest 'uto' → 'u' is not #/♯/b/♭/- → ValueError
    with pytest.raises(ValueError):
        _parse_key_override("Auto")
