"""Choir mode: a recording of a choir singing in parts comes back as the parts that were sung.

``_assign_voices`` is the decision under test: which of soprano, alto, tenor and bass each
simultaneous note belongs to. The chords here are a hymn's first phrase as Basic Pitch would
hand them over — onsets a few tens of milliseconds apart, a held soprano over a moving alto,
and an octave ghost on one chord.
"""

from __future__ import annotations

import numpy as np
import pytest

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


# ── Tuning and the scale ──────────────────────────────────────────────────────

FRAME_SEC = 0.0116


def _posteriorgram(sung: list[tuple[Event, float]]) -> transcriber.Posteriorgram:
    """A contour head with each note's energy at its sung (fractional) pitch."""
    frames = int(max(e.end for e, _ in sung) / FRAME_SEC) + 2
    contour = np.zeros((frames, 264))
    times = np.arange(frames) * FRAME_SEC
    for e, pitch in sung:
        b = (pitch - transcriber.POSTERIOR_MIDI_LOW) * transcriber.CONTOUR_BINS_PER_SEMITONE
        lo = int(np.floor(b))
        rows = (times >= e.start) & (times <= e.end)
        contour[rows, lo] += 1.0 - (b - lo)
        contour[rows, lo + 1] += b - lo
    zeros = np.zeros((frames, 88))
    return transcriber.Posteriorgram(onset=zeros, note=zeros, contour=contour, times=times)


def test_a_note_is_heard_where_in_its_semitone_it_was_sung():
    e = Event(0.0, 0.5, 60, 0.8)
    assert transcriber._heard_pitch(_posteriorgram([(e, 60.3)]), e) == pytest.approx(60.3, abs=0.01)
    assert transcriber._heard_pitch(None, e) == 60.0


def _chorale(pitches: list[list[int]], sung_as: dict[tuple[str, int], float]):
    # S/A/T/B chords a second apart, each note sung at its pitch unless ``sung_as`` says
    # otherwise; Basic Pitch names each note its nearest semitone.
    sung, voices = [], {"soprano": [], "alto": [], "tenor": [], "bass": []}
    for i, chord in enumerate(pitches):
        for name, p in zip(voices, chord):
            heard = sung_as.get((name, p), float(p))
            e = Event(i * 1.0, i * 1.0 + 0.9, int(round(heard)), 0.8)
            voices[name].append(e)
            sung.append((e, heard))
    return voices, _posteriorgram(sung)


def _hymn(sung_tenor_f: float):
    # C major: I IV V I, with the tenor's F sung at ``sung_tenor_f``.
    return _chorale([[72, 67, 64, 48], [72, 69, 65, 53], [71, 67, 62, 55], [72, 67, 64, 48]],
                    {("tenor", 65): sung_tenor_f})


def test_the_parts_are_written_in_one_scale_fitted_across_every_voice():
    # The tenor's F sung 55 cents sharp: Basic Pitch names it F#, which C major does not have
    # and which it is not near enough to keep.
    voices, post = _hymn(65.55)
    assert voices["tenor"][1].pitch == 66
    written, fit = transcriber._choir_in_scale(voices, post)
    assert fit.root == 0
    assert [e.pitch for e in written["tenor"]] == [64, 65, 62, 64]
    assert [e.pitch for e in written["bass"]] == [48, 53, 55, 48]


def test_a_users_key_the_choir_is_plainly_not_in_leaves_the_fitted_scale():
    voices, post = _hymn(65.0)
    _written, fit = transcriber._choir_in_scale(voices, post, doh=6)
    assert fit.root == 0
    _written, fit = transcriber._choir_in_scale(voices, post, doh=0)
    assert fit.root == 0


def test_a_users_key_the_choir_fits_nearly_as_well_is_the_scale_it_is_written_in():
    # G major, I V vi I, with the tenor's F# sung 55 cents flat: alone the parts fit C, where
    # it is F.  G fits them barely worse, so the user's G is the scale.
    voices, post = _chorale([[74, 71, 67, 55], [74, 69, 66, 50], [71, 67, 64, 52], [71, 67, 62, 55]],
                            {("tenor", 66): 65.45})
    alone, fit = transcriber._choir_in_scale(voices, post)
    assert fit.root == 0 and [e.pitch for e in alone["tenor"]] == [67, 65, 64, 62]
    given, fit = transcriber._choir_in_scale(voices, post, doh=7)
    assert fit.root == 7 and [e.pitch for e in given["tenor"]] == [67, 66, 64, 62]


def test_the_choirs_key_vote_hears_every_part_and_the_bass_twice():
    voices, _post = _hymn(65.0)
    s = transcriber._choir_key_stream(voices, sec_to_beats=1.0)
    assert len(s.notes) == 16
    bass = [n.duration.quarterLength for n in s.notes if n.pitch.midi in (48, 53, 55)]
    assert bass == [pytest.approx(0.9 * transcriber.CHOIR_BASS_KEY_WEIGHT)] * 4


def test_the_choirs_tuning_comes_out_before_basic_pitch(tmp_path):
    sr = 22_050
    t = np.arange(sr * 2) / sr
    flat = np.sin(2 * np.pi * 440.0 * 2.0 ** (-0.3 / 12.0) * t).astype(np.float32)
    seen = []

    def fake_predict(path=None):
        seen.append(path)
        return "output", "midi", []

    *_, time_scale = transcriber._retuned_basic_pitch(flat, sr, fake_predict)
    assert time_scale == pytest.approx(2.0 ** (0.3 / 12.0), rel=0.01)
    assert seen[0] is not None and not seen[0].exists()  # a temporary, removed afterwards

    in_tune = np.sin(2 * np.pi * 440.0 * t).astype(np.float32)
    *_, time_scale = transcriber._retuned_basic_pitch(in_tune, sr, fake_predict)
    assert time_scale == 1.0 and seen[1] is None


def test_a_choir_singing_flat_is_written_in_its_key_without_accidentals(tmp_path):
    import soundfile as sf

    from tests.accuracy import vocal_synth

    chords = [(64, 60, 55, 48), (65, 60, 57, 53), (67, 64, 60, 48), (67, 62, 59, 55),
              (69, 64, 60, 57), (65, 60, 57, 53), (62, 59, 55, 43), (60, 55, 52, 48)]
    mix = None
    for v in range(4):
        opts = vocal_synth.VocalOptions(style="ah", tuning_cents=-30.0, vibrato_cents=25.0,
                                        note_detune_cents=12.0, glide_sec=0.08)
        audio, _ = vocal_synth.render([(c[v], 1) for c in chords], 80, opts)
        mix = audio if mix is None else mix[: min(mix.size, audio.size)] + audio[: min(mix.size, audio.size)]
    path = tmp_path / "choir.wav"
    sf.write(str(path), (0.8 * mix / np.max(np.abs(mix))).astype(np.float32), 22_050)

    result = transcriber.transcribe(path, mode="choir", audio_preview=False)
    assert result.key == "C major"
    sung = [n["pitch_midi"] for part in result.parts.values() for n in part["notes"]]
    assert sung and all(p % 12 in (0, 2, 4, 5, 7, 9, 11) for p in sung)
