"""The SATB harmoniser: chord choice, voice leading, and the shape of what it returns."""

import json

import numpy as np
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


# ── Lines that move: the hymn book's four parts as the yardstick ────────────────
# ``tests/accuracy/harmony_bench.py`` measures the written parts against CCEH's own
# harmonisations (``harmony_book.json``); these hold the line on what it showed.


@pytest.fixture
def no_engraving(monkeypatch):
    monkeypatch.setattr(harmony, "build_musicxml", lambda *a, **k: "")


@pytest.fixture(scope="module")
def book():
    """[(book tune, our parts, our chord spans)] for every tune in the bench's fixture."""
    from tests.accuracy import harmony_bench as hb

    engrave, harmony.build_musicxml = harmony.build_musicxml, lambda *a, **k: ""
    try:
        return [(tune, *hb.ours(tune)[:2]) for tune in hb.load()]
    finally:
        harmony.build_musicxml = engrave


def _longest_run(pitches):
    best = run = 1
    for a, b in zip(pitches, pitches[1:]):
        run = run + 1 if a == b else 1
        best = max(best, run)
    return best


@pytest.mark.parametrize("slug", ["new-britain", "azmon", "belmont"])
def test_the_tenor_is_a_line_not_one_note(slug, no_engraving):
    # Under our own hymn page's melody (Amazing Grace is NEW BRITAIN): its tenor used to sit
    # on doh with a dip to ti, two pitches for the whole verse.
    from tests.accuracy.hymn_corpus import TUNES_DIR, _parse_key, parse_melody

    path = TUNES_DIR / f"{slug}.json"
    if not path.is_file():
        pytest.skip("content/hymns is not beside server/")
    tune = json.loads(path.read_text(encoding="utf-8"))
    melody = parse_melody(tune["melody"], tune["time"], tune.get("pickup") or 0)
    tonic, mode = _parse_key(tune["key"])
    ref = solfa.reference_doh([n.pitch_midi for n in melody.notes], tonic, mode)
    notes = [TranscribedNote(n.pitch_midi, n.start_beat, n.dur_beats, 0, "", "", 1.0) for n in melody.notes]
    result = harmonise(notes, tonic, mode, doh_pc=tonic, ref_doh=ref, time_signature=tune["time"])
    tenor = [n.pitch_midi for n in result.parts["tenor"]]
    assert len(set(tenor)) >= 4, tenor
    assert _longest_run(tenor) <= 4, tenor
    moves = sum(1 for a, b in zip(tenor, tenor[1:]) if a != b) / (len(tenor) - 1)
    assert moves >= 0.5, moves
    # The alto may hold the dominant through I-V-I as the books do (CCEH's Azmon holds it for
    # most of the verse), but it is still a line.
    assert len({n.pitch_midi for n in result.parts["alto"]}) >= 3


def test_written_parts_keep_the_rules_on_the_hymn_book_corpus(book):
    from tests.accuracy import harmony_bench as hb

    for tune, parts, _chords in book:
        rows = hb._sonorities(parts)
        for prev, cur in zip(rows, rows[1:]):
            for i in range(4):
                for j in range(i + 1, 4):
                    assert not harmony._parallel((prev[i], prev[j]), (cur[i], cur[j])), (tune.slug, prev, cur)
        for row in rows:
            assert row[0] >= row[1] >= row[2] >= row[3], (tune.slug, row)  # no crossing
            assert row[0] - row[1] <= harmony.MAX_UPPER_SPACING and row[1] - row[2] <= harmony.MAX_UPPER_SPACING
        for name, (lo, hi) in (("alto", harmony.ALTO_RANGE), ("tenor", harmony.TENOR_RANGE),
                               ("bass", harmony.BASS_RANGE)):
            assert all(lo <= p <= hi for p, _s, _d in parts[name]), (tune.slug, name)


def test_inner_voices_move_like_the_hymn_books(book):
    # Over the whole fixture the written alto and tenor repeat about as often as CCEH's
    # (0.40 of their notes) and run on one pitch about as long (6 notes); they used to repeat
    # two notes in three, for runs of nine.
    from tests.accuracy import harmony_bench as hb

    for name in ("alto", "tenor"):
        stats = [hb.motion(parts[name]) for _tune, parts, _chords in book]
        mean = {k: sum(s[k] for s in stats) / len(stats) for k in ("repeat", "longest", "distinct")}
        assert mean["repeat"] < 0.5, (name, mean)
        assert mean["longest"] < 7.5, (name, mean)
        assert mean["distinct"] >= 5.5, (name, mean)


def test_a_passing_note_is_reached_and_left_by_step(book):
    chords_by_name = {c.name: c for c in harmony.MINOR_CHORDS + harmony.MAJOR_CHORDS}
    count = 0
    for tune, parts, chords in book:
        for name in ("alto", "tenor"):
            line = parts[name]
            for i, (p, s, _d) in enumerate(line):
                chord = next(c for cs, cd, c in chords if cs <= s + 1e-6 < cs + cd)
                if p % 12 in chords_by_name[chord].pitch_classes(tune.tonic):
                    continue
                count += 1
                assert 0 < i < len(line) - 1, (tune.slug, name, i)
                assert 1 <= abs(p - line[i - 1][0]) <= 2 and 1 <= abs(line[i + 1][0] - p) <= 2, (tune.slug, name, i)
    assert count > 0  # the corpus does get passing notes


def test_the_line_search_scores_moves_as_the_single_step_does():
    scale = (0, 2, 4, 5, 7, 9, 11)
    for c1, c2, s1, s2, same in [(0, 4, 72, 74, False), (3, 3, 69, 67, True), (5, 0, 71, 72, False)]:
        a, b = harmony.MAJOR_CHORDS[c1], harmony.MAJOR_CHORDS[c2]
        prev = harmony._voicings(a, C, s1, False, tuple(p for p in scale if p not in a.pitch_classes(C)))
        cur = harmony._voicings(b, C, s2, False, tuple(p for p in scale if p not in b.pitch_classes(C)))
        matrix = harmony._transition_matrix(
            s1, s2, np.array([v for _c, v, _m in prev]), np.array([m for _c, _v, m in prev]),
            np.array([v for _c, v, _m in cur]), np.array([m for _c, _v, m in cur]), same)
        for i, (_c, pv, pm) in enumerate(prev):
            for j, (_c2, cv, cm) in enumerate(cur):
                assert matrix[i, j] == pytest.approx(harmony._transition((s1, *pv), (s2, *cv), same, pm, cm))


def test_harmonise_is_deterministic(no_engraving):
    first = harmonise(_tune(TWINKLE), C, "major", doh_pc=C, ref_doh=60)
    again = harmonise(_tune(TWINKLE), C, "major", doh_pc=C, ref_doh=60)
    for name in harmony.PART_NAMES:
        assert first.parts[name] == again.parts[name]
