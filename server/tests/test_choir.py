"""Choir mode: a recording of a choir singing in parts comes back as the parts that were sung.

``_assign_voices`` is the decision under test: which of soprano, alto, tenor and bass each
simultaneous note belongs to. The chords here are a hymn's first phrase as Basic Pitch would
hand them over — onsets a few tens of milliseconds apart, a held soprano over a moving alto,
and an octave ghost on one chord.
"""

from __future__ import annotations

from app.pipeline import transcriber
from app.pipeline.transcriber import Event, _assign_voices, _choir_parts


def _chord(start: float, pitches: list[int], dur: float = 0.9, spread: float = 0.02) -> list[Event]:
    # Lower voices land a touch late, as singers do; the spread stays inside the chord window.
    return [Event(start + i * spread, start + dur, p, 0.8 - 0.05 * i) for i, p in enumerate(pitches)]


def test_a_hymn_phrase_is_split_into_four_lines_by_pitch_order():
    # C major: I  V  vi  IV, voiced S/A/T/B.
    events = (
        _chord(0.0, [72, 67, 64, 48])
        + _chord(1.0, [71, 67, 62, 43])
        + _chord(2.0, [72, 69, 64, 45])
        + _chord(3.0, [72, 69, 65, 41])
    )
    voices = _assign_voices(events)
    assert [e.pitch for e in voices["soprano"]] == [72, 71, 72, 72]
    assert [e.pitch for e in voices["alto"]] == [67, 67, 69, 69]
    assert [e.pitch for e in voices["tenor"]] == [64, 62, 64, 65]
    assert [e.pitch for e in voices["bass"]] == [48, 43, 45, 41]


def test_a_moving_alto_under_a_held_soprano_stays_the_alto():
    events = _chord(0.0, [72, 67, 64, 48], dur=2.0)
    # The alto walks up while the others hold: one note at a time, no chord to lean on. Its
    # first note ends where it moves, as a sung note does.
    events[1] = Event(events[1].start, 1.0, 67, events[1].amp)
    events += [Event(1.0, 1.5, 69, 0.7), Event(1.5, 2.0, 71, 0.7)]
    voices = _assign_voices(events)
    assert [e.pitch for e in voices["alto"]] == [67, 69, 71]
    assert [e.pitch for e in voices["soprano"]] == [72]


def test_a_voice_that_re_enters_early_is_trimmed_so_the_line_never_overlaps():
    # Basic Pitch can start the next note before it ends the previous one in the same voice.
    events = [Event(0.0, 1.2, 72, 0.8), Event(1.0, 2.0, 74, 0.8)]
    voices = _assign_voices(events)
    assert [(e.pitch, e.end) for e in voices["soprano"]] == [(72, 1.0), (74, 2.0)]


def test_a_fifth_note_in_a_chord_is_the_quietest_one_dropped():
    chord = _chord(0.0, [72, 67, 64, 48]) + [Event(0.01, 0.9, 50, 0.1)]  # a faint stray fragment
    voices = _assign_voices(chord)
    assert all(len(v) == 1 for v in voices.values())
    assert voices["soprano"][0].pitch == 72 and voices["bass"][0].pitch == 48


def test_a_faint_octave_above_a_voice_is_its_harmonic_not_a_fifth_singer():
    chord = _chord(0.0, [72, 67, 64, 48]) + [Event(0.01, 0.9, 79, 0.2)]  # the alto's octave, faint
    voices = _assign_voices(chord)
    assert [e.pitch for e in voices["soprano"]] == [72]
    assert all(len(v) == 1 for v in voices.values())


def test_a_stray_note_far_outside_every_range_is_left_out_rather_than_forced_in():
    # Three voices sing; a loud fragment at 30 (F#1) is nobody's note.
    chord = _chord(0.0, [72, 67, 64]) + [Event(0.01, 0.9, 30, 0.9)]
    voices = _assign_voices(chord)
    assert not voices["bass"]
    assert [e.pitch for e in voices["tenor"]] == [64]


def test_one_voice_in_choir_mode_lands_in_its_own_register():
    # A lone bass line is not forced up into the soprano.
    events = [Event(i * 0.5, i * 0.5 + 0.45, p, 0.8) for i, p in enumerate([48, 50, 52, 53])]
    voices = _assign_voices(events)
    assert [e.pitch for e in voices["bass"]] == [48, 50, 52, 53]
    assert not voices["soprano"] and not voices["alto"] and not voices["tenor"]


def test_choir_parts_share_the_melody_beat_grid_and_doh():
    events = _chord(0.0, [72, 67, 64, 48]) + _chord(1.0, [71, 67, 62, 43])
    voices = _assign_voices(events)
    detected = transcriber._parse_key_override("C major")
    doh_pc = 0
    ref_doh = 60
    melody = [
        transcriber.TranscribedNote(72, 0.0, 1.0, 1, "d", "'", 0.9),
        transcriber.TranscribedNote(71, 1.0, 1.0, 7, "t", "", 0.9),
    ]
    parts, musicxml = _choir_parts(voices, "soprano", melody, 60.0, 0.0, detected, doh_pc, ref_doh, "4/4")
    assert parts is not None
    assert set(parts) == {"soprano", "alto", "tenor", "bass"}
    assert [n["pitch_midi"] for n in parts["bass"]["notes"]] == [48, 43]
    assert [n["start_beat"] for n in parts["bass"]["notes"]] == [0.0, 1.0]
    assert parts["alto"]["notes"][0]["solfa"] == "s"
    assert parts["alto"]["solfa_lines"][0].startswith("Doh is C")
    assert "<score-partwise" in musicxml and musicxml.count("<part ") == 4


def test_choir_mode_is_a_decoding_strategy_that_keeps_every_voice():
    strategy = transcriber.get_decoding_strategy("choir")
    assert strategy.name == "choir"
    assert strategy.contour_first is False and strategy.resolve_overlaps is False


def test_one_pitch_reported_three_times_in_a_chord_is_one_singer():
    chord = [Event(0.0, 0.9, 43, 0.74), Event(0.01, 0.9, 43, 0.55), Event(0.03, 0.9, 43, 0.75)]
    voices = _assign_voices(chord)
    assert sum(len(v) for v in voices.values()) == 1
    assert voices["bass"][0].amp == 0.75
