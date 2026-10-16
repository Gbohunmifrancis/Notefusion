"""The SATB harmoniser: chord choice, voice leading, and the shape of what it returns."""

import pytest

from app.pipeline import harmony, solfa
from app.pipeline.harmony import MAJOR_CHORDS, MelodyNote, choose_chords, harmonise, voice_span
from app.pipeline.transcriber import TranscribedNote

C = 0


def _tune(pairs, start=0.0):
    """(midi, beats) pairs laid end to end as TranscribedNotes in C major."""
    notes, t = [], start
    for p, d in pairs:
        if p is not None:
            syl, mark, degree = solfa.syllable(p, C, 60)
            notes.append(TranscribedNote(p, t, d, degree, syl, mark, 1.0))
        t += d
    return notes


TWINKLE = [(60, 1), (60, 1), (67, 1), (67, 1), (69, 1), (69, 1), (67, 2), (65, 1), (65, 1), (64, 1), (64, 1), (62, 1), (62, 1), (60, 2)]


def test_a_scale_starts_and_ends_on_the_tonic_chord():
    melody = [MelodyNote(p, i, 1.0) for i, p in enumerate([60, 62, 64, 65, 67, 69, 71, 72])]
    spans = choose_chords(melody, C, "major")
    assert spans[0][2].name == "I"
    assert spans[-1][2].name == "I"
    # Every slot's melody note is a chord tone (passing notes aside), so no chord
    # is a stretch: the leading note gets a dominant-family chord.
    by_beat = {}
    for s, d, chord in spans:
        for b in range(int(s), int(s + d)):
            by_beat[b] = chord.name
    assert by_beat[6] in ("V", "V7", "vii°")


def test_twinkle_gets_a_hymn_progression_and_a_final_tonic():
    melody = [MelodyNote(n.pitch_midi, n.start_beat, n.dur_beats) for n in _tune(TWINKLE)]
    spans = choose_chords(melody, C, "major")
    names = [c.name for _s, _d, c in spans]
    assert names[0] == "I" and names[-1] == "I"
    # The sixth degree (A) over beats 4-5 is harmonised by IV or vi, not forced onto I.
    sixth = [c.name for s, d, c in spans if s <= 4 < s + d][0]
    assert sixth in ("IV", "vi", "ii")


def test_voicing_keeps_order_range_and_a_complete_triad():
    chord = MAJOR_CHORDS[0]  # I
    a, t, b = voice_span(chord, C, soprano=72, prev=None)
    assert b <= t <= a <= 72
    assert harmony.BASS_RANGE[0] <= b <= harmony.BASS_RANGE[1]
    assert harmony.TENOR_RANGE[0] <= t <= harmony.TENOR_RANGE[1]
    assert harmony.ALTO_RANGE[0] <= a <= harmony.ALTO_RANGE[1]
    assert {72 % 12, a % 12, t % 12, b % 12} >= {0, 4, 7}
    assert b % 12 == 0  # root position by default


def test_voicing_avoids_parallel_fifths_when_it_can():
    # I -> V with the soprano moving C5 -> D5: the previous voicing holds a fifth in
    # the tenor/bass; the next one must not carry it in parallel.
    prev = (72, 67, 64, 48)  # C5 G4 E4 C3
    a, t, b = voice_span(MAJOR_CHORDS[4], C, soprano=74, prev=prev)
    cur = (74, a, t, b)
    pairs = [(i, j) for i in range(4) for j in range(i + 1, 4)]
    assert not any(harmony._parallel((prev[i], prev[j]), (cur[i], cur[j])) for i, j in pairs)


def test_harmonise_returns_four_parts_in_the_note_shape_with_solfa():
    result = harmonise(_tune(TWINKLE), C, "major", doh_pc=C, ref_doh=60, time_signature="4/4", tempo_bpm=100)
    assert result is not None
    assert set(result.parts) == {"soprano", "alto", "tenor", "bass"}
    assert [n.pitch_midi for n in result.parts["soprano"]] == [p for p, _ in TWINKLE]
    for name in ("alto", "tenor", "bass"):
        notes = result.parts[name]
        assert notes, name
        assert all(isinstance(n, TranscribedNote) and n.solfa for n in notes)
        # The lower voices stay under the tune and in their ranges.
        assert max(n.pitch_midi for n in notes) <= 72
    assert max(n.pitch_midi for n in result.parts["bass"]) <= harmony.BASS_RANGE[1]
    assert result.solfa_lines["bass"][0].startswith("Doh is C")
    assert len(result.solfa_lines["alto"]) > 1
    assert result.chords[0][2] == "I" and result.chords[-1][2] == "I"
    assert "<score-partwise" in result.musicxml and result.musicxml.count("<part ") == 4
    # The parts are named for the engraver, and music21's own defaults never reach the sheet.
    assert "<part-name>Soprano</part-name>" in result.musicxml
    assert "Music21" not in result.musicxml


def test_the_lower_voices_rest_with_the_tune():
    tune = _tune([(60, 1), (64, 1), (None, 2), (67, 1), (60, 1)])
    result = harmonise(tune, C, "major", doh_pc=C, ref_doh=60)
    assert result is not None
    for name in ("alto", "tenor", "bass"):
        for n in result.parts[name]:
            assert not (2.0 < n.start_beat + 1e-6 and n.start_beat < 4.0 - 1e-6), (name, n)


def test_minor_key_cadences_on_the_tonic_minor():
    tune = _tune([(69, 1), (71, 1), (72, 1), (74, 1), (76, 1), (74, 1), (72, 1), (71, 1), (69, 2)])
    result = harmonise(tune, 9, "minor", doh_pc=solfa.doh_pitch_class(9, "minor"), ref_doh=60)
    assert result is not None
    assert result.chords[-1][2] == "i"
    # The raised leading note (G#) under a cadence: the bass of the last chord is A.
    assert result.parts["bass"][-1].pitch_midi % 12 == 9


def test_empty_melody_gives_nothing():
    assert harmonise([], C, "major", doh_pc=C, ref_doh=60) is None


@pytest.mark.parametrize("soprano", [55, 60, 84])
def test_voicing_never_fails_on_an_extreme_soprano(soprano):
    a, t, b = voice_span(MAJOR_CHORDS[3], C, soprano=soprano, prev=None)
    assert b <= t <= a <= soprano


def test_harmonise_sheet_writes_parts_for_a_clients_note_list():
    from app.pipeline.transcriber import harmonise_sheet

    notes = []
    t = 0.0
    for p, d in TWINKLE:
        notes.append({"pitch_midi": p, "start_beat": t, "dur_beats": d, "conf": 0.9})
        t += d
    parts, musicxml = harmonise_sheet("C major", 100, "4/4", notes)
    assert set(parts) == {"soprano", "alto", "tenor", "bass"}
    assert [n["pitch_midi"] for n in parts["soprano"]["notes"]] == [p for p, _ in TWINKLE]
    assert parts["bass"]["solfa_lines"][0].startswith("Doh is C")
    assert "<score-partwise" in musicxml


@pytest.mark.parametrize("middle, shift", [
    (52.5, 12),   # a man's Twinkle in C (C3-A3)
    (55, 12),     # a man's hymn in G (D3-D4)
    (61, 12),     # a man singing high, middle note C#4
    (62, 0),      # a woman's low key (A3-A4), as a hymn book in D prints it: left alone
    (64.5, 0),    # Twinkle in C as printed
    (74, 0),      # a tune sitting high in the soprano range
    (82, -12),    # whistled an octave up (Bb5)
    (40, 24),     # a bass two octaves down
])
def test_the_tune_is_moved_by_whole_octaves_to_a_sopranos_middle(middle, shift):
    pitches = [int(middle - 0.5), int(middle + 0.5)] if middle % 1 else [int(middle)]
    assert harmony.soprano_octave_shift(pitches) == shift


def _labelled(pairs, tonic, octaves=0):
    """``pairs`` moved ``octaves``, labelled as the transcription labels them; and their reference doh."""
    pitches = [p + 12 * octaves for p, _ in pairs]
    ref = solfa.reference_doh(pitches, tonic, "major")
    notes, t = [], 0.0
    for p, (_q, d) in zip(pitches, pairs):
        syl, mark, degree = solfa.syllable(p, tonic, ref)
        notes.append(TranscribedNote(p, t, d, degree, syl, mark, 1.0))
        t += d
    return notes, ref


G = 7
# The first two lines in G, as the book prints them (D4-D5): s, d m d m r d l, s, / s, d m d m r s.
AMAZING_GRACE_G = [
    (62, 1), (67, 2), (71, 0.5), (67, 0.5), (71, 2), (69, 1), (67, 2), (64, 1), (62, 2), (62, 1),
    (67, 2), (71, 0.5), (67, 0.5), (71, 2), (69, 1), (74, 3), (74, 2),
]


@pytest.mark.parametrize("tune, tonic", [(TWINKLE, C), (AMAZING_GRACE_G, G)], ids=["twinkle", "amazing-grace"])
def test_a_tune_sung_an_octave_low_gets_parts_in_their_own_ranges(tune, tonic):
    low, ref = _labelled(tune, tonic, octaves=-1)  # as a man sings it
    before = [(n.pitch_midi, n.solfa, n.octave_mark) for n in low]
    result = harmonise(low, tonic, "major", doh_pc=tonic, ref_doh=ref)
    assert result is not None and result.extra["octave_shift"] == 12
    # The transcription is what was heard: the harmoniser never touches it.
    assert [(n.pitch_midi, n.solfa, n.octave_mark) for n in low] == before
    # The soprano is the tune at the book's octave, and reads exactly as the tune does.
    soprano = result.parts["soprano"]
    assert [n.pitch_midi for n in soprano] == [p for p, _ in tune]
    lo, hi = harmony.SOPRANO_RANGE
    assert all(lo <= n.pitch_midi <= hi for n in soprano)
    assert [(n.solfa, n.octave_mark) for n in soprano] == [(syl, mark) for _p, syl, mark in before]
    # Each lower voice sings in its own range, and the alto is a line, not one note.
    for name, (lo, hi) in (("alto", harmony.ALTO_RANGE), ("tenor", harmony.TENOR_RANGE), ("bass", harmony.BASS_RANGE)):
        pitches = [n.pitch_midi for n in result.parts[name]]
        assert lo <= min(pitches) and max(pitches) <= hi, (name, min(pitches), max(pitches))
    assert len({n.pitch_midi for n in result.parts["alto"]}) >= 3
    # Written exactly as the same tune sung where a soprano sings it.
    book, book_ref = _labelled(tune, tonic)
    written = harmonise(book, tonic, "major", doh_pc=tonic, ref_doh=book_ref)
    for name in harmony.PART_NAMES:
        assert [(n.pitch_midi, n.solfa, n.octave_mark) for n in result.parts[name]] == \
            [(n.pitch_midi, n.solfa, n.octave_mark) for n in written.parts[name]], name
    assert written.extra["octave_shift"] == 0


def test_harmonise_sheet_writes_a_mans_tune_in_the_sopranos_octave():
    from app.pipeline.transcriber import harmonise_sheet

    notes, t = [], 0.0
    for p, d in TWINKLE:
        notes.append({"pitch_midi": p - 12, "start_beat": t, "dur_beats": d})
        t += d
    parts, _musicxml = harmonise_sheet("C major", 100, "4/4", notes)
    assert [n["pitch_midi"] for n in parts["soprano"]["notes"]] == [p for p, _ in TWINKLE]
    assert [n["pitch_midi"] for n in notes] == [p - 12 for p, _ in TWINKLE]
    assert [n["solfa"] + n["octave_mark"] for n in parts["soprano"]["notes"][:4]] == ["d", "d", "s", "s"]
    assert min(n["pitch_midi"] for n in parts["bass"]["notes"]) >= harmony.BASS_RANGE[0]


def test_harmonise_sheet_refuses_a_key_it_cannot_read():
    from app.pipeline.transcriber import harmonise_sheet

    with pytest.raises(ValueError):
        harmonise_sheet("H sharp mixolydian", 100, "4/4", [{"pitch_midi": 60, "start_beat": 0, "dur_beats": 1}])
    assert harmonise_sheet("C major", 100, "4/4", []) == (None, "")
