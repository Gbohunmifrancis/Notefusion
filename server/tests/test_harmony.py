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
