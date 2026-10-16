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


# --- reference_doh: the doh at or below the middle note -----------------------
# The same cases are asserted in tests/NoteFusion.Tests/Solfa/SolfaMapperTests.cs.

@pytest.mark.parametrize(("pitches", "doh_pc", "expected"), [
    ([60, 64, 67], 0, 60),
    ([48, 55, 60, 67, 72, 79], 0, 60),
    ([36, 38, 40], 0, 36),
    ([84, 86, 88], 0, 84),
    ([60], 5, 53),                  # F3: the doh at or below, not the nearer F4
    ([62, 66, 69, 71], 2, 62),      # a tune around soh keeps its doh below it
    ([64, 67, 69, 71, 72], 0, 60),  # middle note t: still the doh below
])
def test_reference_doh_is_the_doh_at_or_below_the_middle_note(pitches, doh_pc, expected):
    assert solfa.reference_doh(pitches, doh_pc, "major") == expected


@pytest.mark.parametrize(("pitches", "expected"), [
    ([57, 59, 60, 59, 57, 56, 57], 60),  # centred on lah: l, t, d under doh C4
    ([60, 62, 64, 62, 60], 60),          # centred on doh: as in major
    ([69, 71, 72, 74, 76], 72),          # l, t, d r m an octave up
])
def test_a_minor_tune_centred_on_its_lah_keeps_the_lah_under_doh(pitches, expected):
    assert solfa.reference_doh(pitches, 0, "minor") == expected  # A minor, doh C


def test_reference_doh_reads_an_empty_tune_as_middle_c():
    assert solfa.reference_doh([], 0, "major") == 60
    assert solfa.reference_doh([], 5, "major") == 53
    assert solfa.reference_doh([], 0, "minor") == 60


def test_reference_doh_stays_on_the_midi_range():
    assert solfa.reference_doh([127], 0, "minor") == 120  # 132 would be off the top
    assert solfa.reference_doh([3], 10, "major") == 10    # -2 would be off the bottom


def test_doh_header_names_the_pitch():
    assert solfa.doh_header(0) == "Doh is C"
    assert solfa.doh_header(6) == "Doh is F#"


def test_doh_header_spells_the_doh_like_the_key_signature():
    # Bb major is written with two flats; "A#" would be ten sharps no choir reads.
    assert solfa.doh_header(10) == "Doh is Bb"
    assert [solfa.doh_header(pc) for pc in (1, 3, 8)] == ["Doh is Db", "Doh is Eb", "Doh is Ab"]


# --- ascending_flags: the hymn-book rule, mirrored case for case --------------
# Every case is asserted with the same pitches in SolfaMapperTests.cs.

def test_a_chromatic_rising_a_semitone_is_spelled_sharp():
    # C C# D — the C# leads up into ray, so it is a raised doh.
    flags = solfa.ascending_flags([60, 61, 62], 0)
    assert flags[1] is True
    syl, _, _ = solfa.syllable(61, doh_pc=0, ref_doh_midi=60, ascending=flags[1])
    assert syl == "de"


def test_a_chromatic_falling_a_semitone_is_spelled_flat():
    # D Db C — the same pitch, falling into doh, is a lowered ray.
    flags = solfa.ascending_flags([62, 61, 60], 0)
    assert flags[1] is False
    syl, _, _ = solfa.syllable(61, doh_pc=0, ref_doh_midi=60, ascending=flags[1])
    assert syl == "ra"


def test_the_spelling_comes_from_where_the_note_goes_not_where_it_came_from():
    # C Db C: an upper neighbour of doh falls back to it, so it is ra.
    assert solfa.ascending_flags([60, 61, 60], 0)[1] is False
    # E D# E: a lower neighbour of me rises back, so it is re.
    assert solfa.ascending_flags([64, 63, 64], 0)[1] is True
    # What a Friend bar 9 (F major, G F# G): reached from above, rising back to ray — de, as
    # the book prints, where the old approach rule printed ra.
    assert solfa.ascending_flags([67, 66, 67], 5)[1] is True


@pytest.mark.parametrize(("pitch", "sharp"), [
    (61, True),   # de, not ra
    (63, False),  # ma, not re
    (66, True),   # fe, not sa
    (68, True),   # se, not la
    (70, False),  # ta, not le
])
def test_a_note_that_does_not_move_a_semitone_takes_the_hymn_book_default(pitch, sharp):
    assert solfa.ascending_flags([pitch], 0) == [sharp]                 # the last note
    assert solfa.ascending_flags([pitch, pitch], 0) == [sharp, sharp]   # repeated, then nothing
    assert solfa.ascending_flags([pitch, pitch + 5], 0)[0] is sharp     # a leap up
    assert solfa.ascending_flags([pitch, pitch - 4], 0)[0] is sharp     # a leap down


@pytest.mark.parametrize(("pitch", "following", "expected"), [
    (63, 65, "ma"),  # up a tone to fah: Eb-F, a step, where D#-F would be a third
    (70, 72, "ta"),  # up a tone to doh: Bb-C
    (61, 59, "de"),  # down a tone to te: C#-B
    (66, 64, "fe"),  # down a tone to me: F#-E (Crown Him bars 6 and 11)
])
def test_a_tone_step_to_a_scale_note_keeps_the_default_which_keeps_it_a_step(pitch, following, expected):
    flag = solfa.ascending_flags([pitch, following], 0)[0]
    assert solfa.syllable(pitch, doh_pc=0, ref_doh_midi=60, ascending=flag)[0] == expected


def test_the_defaults_are_read_from_doh_not_from_c():
    assert solfa.ascending_flags([65], 7) == [False]  # G major: F natural is ta
    assert solfa.ascending_flags([61], 7) == [True]   # and C# is fe


def test_an_empty_melody_has_no_flags():
    assert solfa.ascending_flags([], 0) == []


def test_a_repeated_chromatic_keeps_one_spelling():
    # D Db Db C and D C# C# D: the run reads the note after it, so one sung pitch is never
    # printed "ra de".
    assert solfa.ascending_flags([62, 61, 61, 60], 0)[1:3] == [False, False]
    assert solfa.ascending_flags([62, 61, 61, 62], 0)[1:3] == [True, True]


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


# --- The hymn-book table: the lock-step contract ------------------------------
# The same rows, with the same expected strings, are in
# tests/NoteFusion.Tests/Solfa/HymnBookSolfaTests.cs, mobile/src/lib/solfa.test.ts and
# web-site/tests/choir.test.mjs.  Change one and you change all four.

HYMN_BOOK_CASES = [
    # A chromatic is named for where it goes: a semitone up is sharpened, a semitone down flattened.
    ("C major", [60, 61, 62], "d de r"),
    ("C major", [62, 61, 60], "r ra d"),
    ("C major", [60, 61, 60], "d ra d"),  # upper neighbour: it falls back, so ra
    ("C major", [64, 63, 64], "m re m"),  # lower neighbour: it rises back, so re
    ("C major", [67, 66, 67], "s fe s"),
    ("C major", [69, 68, 69], "l se l"),
    ("C major", [69, 70, 69], "l ta l"),
    ("C major", [71, 70, 69], "t ta l"),
    ("C major", [67, 68, 67], "s la s"),
    # Anything else — the last note, a leap, a tone — takes the default: de ma fe se ta.
    ("C major", [60, 61], "d de"),
    ("C major", [62, 63], "r ma"),
    ("C major", [65, 66], "f fe"),
    ("C major", [67, 68], "s se"),
    ("C major", [71, 70], "t ta"),
    ("C major", [60, 66, 60], "d fe d"),
    ("C major", [67, 70, 67], "s ta s"),
    ("C major", [72, 68, 65], "d' se f"),
    ("C major", [63, 65], "ma f"),
    ("C major", [70, 72], "ta d'"),
    ("C major", [61, 59], "de t,"),
    ("C major", [66, 64], "fe m"),
    ("C major", [62, 61, 61, 60], "r ra ra d"),
    ("C major", [62, 61, 61, 62], "r de de r"),
    # The held hymns' bars, as the books print them.
    ("F major", [67, 66, 67, 69, 70, 67], "r de r m f r"),  # What a Friend, bar 9
    ("Db major", [70, 68, 67, 68], "l s fe s"),  # It Is Well, bar 7
    ("D major", [68, 66, 64, 69, 74], "fe m r s d'"),  # Crown Him, bar 6
    ("G major", [76, 74, 73, 74], "l s fe s"),  # All Hail, bar 9
    ("C major", [72, 67, 69, 66, 67], "d' s l fe s"),  # O God Our Help, bar 4
    ("D major", [71, 68, 69, 71, 69, 68, 69], "l fe s l s fe s"),  # Thine Be the Glory, bars 14-15
    # La-based minor: se stays the leading note to lah, fe the melodic minor's raised fah.
    ("A minor", [69, 71, 72, 74, 76, 77, 80, 81, 80, 77, 76], "l, t, d r m f se l se f m"),
    ("A minor", [76, 78, 80, 81], "m fe se l"),
    # The unmarked octave starts at the doh at or below the middle note.
    ("D major", [62, 62, 66, 66, 69, 69, 71, 71, 71, 69, 66], "d d m m s s l l l s m"),  # Holy, Holy, Holy
    ("G major", [62, 67, 71, 67, 71, 69, 67, 64, 62], "s, d m d m r d l, s,"),  # Amazing Grace
    ("C major", [67, 64, 69, 67, 72, 72, 71, 72], "s m l s d' d' t d'"),  # St Anne
    ("Bb major", [65, 67, 65, 62], "s l s m"),  # Silent Night
    # ...and in a minor key, at the doh at or below a minor third above it: lah stays under doh.
    ("A minor", [57, 59, 60, 59, 57, 56, 57], "l, t, d t, l, se, l,"),
    ("A minor", [57, 59, 60, 62, 64, 62, 60, 59, 57], "l, t, d r m r d t, l,"),
]


@pytest.mark.parametrize(("key", "pitches", "expected"), HYMN_BOOK_CASES)
def test_a_tune_reads_as_a_tonic_solfa_hymn_book_prints_it(key, pitches, expected):
    from app.pipeline.transcriber import _parse_key_override

    parsed = _parse_key_override(key)
    doh_pc = solfa.doh_pitch_class(parsed.tonic.pitchClass, parsed.mode)
    ref = solfa.reference_doh(pitches, doh_pc, parsed.mode)
    flags = solfa.ascending_flags(pitches, doh_pc)
    labelled = [solfa.syllable(p, doh_pc, ref, flags[i]) for i, p in enumerate(pitches)]
    assert " ".join(syl + mark for syl, mark, _ in labelled) == expected
