"""Key evidence beyond the solo voice's own scale fit.

The voice engine decides the doh from the sung notes alone and snaps them into that scale.
When the user knows the key better — they typed it — the notes are written again in that
scale from the same sung pitches, unless the voice is plainly not in it.  A song's backing
names its chords and leaves the doh to the voice, unless the voice is unsure and the band's
doh is one it could as well be in (``_doh_from_band``).  And the melody-floor gate, which hands a
mixture's melody to Basic Pitch's top line, is declined when pyin was following a voice.

The sung line throughout is a G major tune whose F#s are sung 55 cents flat, nearer F than
F#: alone, the voice fits C major and writes them as F (``tests.test_vocal.FLAT_TI_SUNG``).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.pipeline import transcriber, vocal
from app.pipeline.transcriber import Event, transcribe
from tests.accuracy import chords_bench as bench
from tests.test_vocal import FLAT_TI_SUNG, FLAT_TI_TUNE

SR = vocal.SAMPLE_RATE
BEAT = 60.0 / 90.0
LEAD_IN = 0.4
DIATONIC = {"d", "r", "m", "f", "s", "l", "t"}


def _sing(path: Path, pitches: list[float], seconds: float | None = None) -> Path:
    """One steady harmonic tone per beat at 90 BPM, a short breath between notes."""
    total = seconds if seconds is not None else LEAD_IN + len(pitches) * BEAT + 0.5
    y = np.zeros(int(total * SR))
    for i, m in enumerate(pitches):
        a = int((LEAD_IN + i * BEAT) * SR)
        t = np.arange(int(0.85 * BEAT * SR)) / SR
        f0 = 440.0 * 2.0 ** ((m - 69.0) / 12.0)
        tone = sum(w * np.sin(2 * np.pi * k * f0 * t) for k, w in enumerate((1.0, 0.5, 0.25), start=1))
        y[a:a + t.size] += tone * np.minimum(1.0, np.minimum(t, t[-1] - t) / 0.02)
    sf.write(str(path), (0.4 * y / np.max(np.abs(y))).astype(np.float32), SR)
    return path


@pytest.fixture(scope="module")
def flat_ti(tmp_path_factory) -> Path:
    return _sing(tmp_path_factory.mktemp("sung") / "flat_ti.wav", FLAT_TI_SUNG)


def _pitches(result) -> list[int]:
    return [n.pitch_midi for n in result.notes]


# ── The key the user gave ─────────────────────────────────────────────────────


def test_rewrite_in_root_writes_the_engines_notes_again_from_the_sung_pitches():
    fit = vocal.ScaleFit(offset=0.1, root=0, cost_margin=0.4, tonal_margin=1.0)
    snapped = vocal.snap_to_scale([m - fit.offset for m in FLAT_TI_SUNG], fit.root)
    events = [Event(i * 0.5, i * 0.5 + 0.45, p, 0.8, pyin_midi=m - fit.offset, stability=1.0)
              for i, (m, p) in enumerate(zip(FLAT_TI_SUNG, snapped))]
    events, offset = transcriber._rewrite_in_root(events, fit, 7, False)
    assert [e.pitch for e in events] == FLAT_TI_TUNE
    # The tuned pitch each note carries is measured against the new offset, so it still sits
    # next to the note written.
    assert [e.pyin_midi + offset for e in events] == pytest.approx(FLAT_TI_SUNG)


def test_rewrite_in_root_declines_a_scale_the_voice_is_plainly_not_in():
    scale = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60]
    fit = vocal.ScaleFit(offset=0.0, root=0, cost_margin=1.0, tonal_margin=1.0)
    events = [Event(i * 0.5, i * 0.5 + 0.45, p, 0.8, pyin_midi=p + 0.05, stability=1.0) for i, p in enumerate(scale)]
    assert transcriber._rewrite_in_root(events, fit, 6, False) is None


def test_key_alternatives_carry_each_notes_step_in_the_other_scale():
    fit = vocal.ScaleFit(offset=0.1, root=0, cost_margin=0.0, tonal_margin=0.1, readings=2, alternatives=(7,))
    snapped = vocal.snap_to_scale([m - fit.offset for m in FLAT_TI_SUNG], fit.root)
    events = [Event(i * 0.5, i * 0.5 + 0.45, p, 0.8, pyin_midi=m - fit.offset, stability=1.0)
              for i, (m, p) in enumerate(zip(FLAT_TI_SUNG, snapped))]
    carried, roots = transcriber._key_alternatives(events, fit)
    assert roots == [7]
    assert [e.pitch + e.alt_steps[0] for e in carried] == FLAT_TI_TUNE
    assert [e.pitch for e in carried] == snapped  # the sheet's own notes are untouched


def test_offered_keys_name_the_doh_in_the_sheets_mode_and_drop_the_sheets_own():
    notes = [transcriber.TranscribedNote(60 + i, float(i), 1.0, 0, "d", "", 1.0) for i in range(3)]
    steps = [(0, 1), (1, 0), (0, 0)]
    major = transcriber._offered_keys([7, 0], 0, "major", 0, notes, steps)
    assert [(k.key, k.pitches) for k in major] == [("G major", [60, 62, 62])]
    # A la-based sheet is offered la-based keys; the keyboard transpose moves the doh.
    minor = transcriber._offered_keys([7], -2, "minor", 9, notes, [(1,), (0,), (0,)])
    assert [k.key for k in minor] == ["D minor"]
    assert transcriber._offered_keys([0], 0, "major", 0, notes, steps) is None


def test_an_unsure_doh_comes_with_the_others_and_their_notes(tmp_path, monkeypatch):
    # G A B C C# D D | D C# C B A G G: G and D major read it about equally (the near-tie in
    # test_vocal), an even chance, which is offered once the bar sits just above it.  (At
    # exactly even the measured trade was 12 more prompts on Vocadito and no wrong doh more.)
    sung = [67.05, 69.0, 70.95, 72.1, 73.0, 74.05, 74.05, 74.0, 72.9, 72.0, 71.05, 69.0, 66.95, 66.95]
    monkeypatch.setattr(transcriber, "KEY_ALTERNATIVES_BELOW", 0.51)
    result = transcribe(_sing(tmp_path / "near_tie.wav", sung), mode="melody", audio_preview=False, fast=True)
    assert result.key == "G major"
    offered = {k.key: k.pitches for k in result.key_alternatives or []}
    # D nearly as well; C exactly as well, since the tune never sings F or F#.  Every note was
    # sung within the keep band of its own pitch, so none moves: each only relabels.
    assert offered == {"D major": _pitches(result), "C major": _pitches(result)}
    # Each comes engraved in its own key signature, for a client that does not engrave.
    engraved = {k.key: k.musicxml for k in result.key_alternatives}
    assert "<fifths>2</fifths>" in engraved["D major"] and "<fifths>0</fifths>" in engraved["C major"]
    assert engraved["D major"].count("<note") == result.musicxml.count("<note")


def test_a_sure_doh_offers_nothing(flat_ti):
    # The flat F#s leave C the best fit by 40%: unsure (0.44) yet nothing else is close.
    alone = transcribe(flat_ti, mode="melody", audio_preview=False, fast=True)
    assert alone.key == "C major"
    assert alone.key_alternatives is None


def test_a_given_key_is_never_second_guessed(flat_ti):
    given = transcribe(flat_ti, mode="melody", audio_preview=False, fast=True, key_override="G major")
    assert given.key_alternatives is None


def test_the_users_key_writes_the_notes_in_its_own_scale(flat_ti):
    alone = transcribe(flat_ti, mode="melody", audio_preview=False, fast=True)
    assert _pitches(alone).count(77) == 3  # the voice alone: C major, the F#s written F
    given = transcribe(flat_ti, mode="melody", audio_preview=False, fast=True, key_override="G major")
    assert given.key == "G major"
    assert _pitches(given) == FLAT_TI_TUNE
    assert {n.solfa for n in given.notes} <= DIATONIC


def test_the_users_key_is_read_in_the_keyboards_written_pitch(flat_ti):
    # A keyboard set to -4 plays B major shapes for the G major heard; the user's key is the
    # written one.  Same notes four semitones up, same syllables, same confidence per note.
    heard = transcribe(flat_ti, mode="melody", audio_preview=False, fast=True, key_override="G major")
    played = transcribe(flat_ti, mode="melody", audio_preview=False, fast=True, key_override="B major",
                        keyboard_transpose=-4)
    assert played.key == "B major"
    assert _pitches(played) == [p + 4 for p in FLAT_TI_TUNE]
    assert [n.solfa for n in played.notes] == [n.solfa for n in heard.notes]
    assert [n.conf for n in played.notes] == [n.conf for n in heard.notes]


def test_a_key_the_voice_is_plainly_not_in_only_relabels(flat_ti):
    alone = transcribe(flat_ti, mode="melody", audio_preview=False, fast=True)
    wrong = transcribe(flat_ti, mode="melody", audio_preview=False, fast=True, key_override="F# major")
    assert wrong.key == "F# major"
    assert _pitches(wrong) == _pitches(alone)


def test_the_headline_keeps_the_doh_confidence_it_always_showed(tmp_path):
    # A scale sung 45 cents sharp: the cost is sure of the doh, but a singer that near a
    # quarter tone off reads as well a semitone over, so the key confidence reported is an
    # even chance.  The sheet's headline figure is weighed by the cost's own certainty.
    sung = [p + 0.45 for p in (60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60)]
    result = transcribe(_sing(tmp_path / "sharp.wav", sung), mode="melody", audio_preview=False, fast=True)
    assert result.key == "C major"
    assert result.key_confidence == pytest.approx(0.5)
    assert result.overall_confidence == transcriber._overall_confidence(result.notes, 1.0)


# ── A song's backing ─────────────────────────────────────────────────────────


def _backing(path: Path, case: bench.Case) -> Path:
    notes, seconds = bench.notes_for(case)
    sf.write(str(path), bench.render(notes, seconds, use_samples=False), bench.SAMPLE_RATE)
    return path


# A G major line with one F#, sung 55 cents flat: alone the voice fits C, where it is F, and
# G only 8% worse.
ONE_TI_TUNE = [67, 69, 71, 72, 74, 76, 74, 72, 71, 69, 67, 74, 78, 79, 74, 71, 67]
ONE_TI_SUNG = [
    p - 0.55 if p % 12 == 6 else p + wobble
    for p, wobble in zip(
        ONE_TI_TUNE, [0.12, -0.1, 0.15, -0.12, 0.1, -0.15, 0.12, -0.1, 0.15, -0.12, 0.1, -0.15, 0, 0.12, -0.1, 0.1, 0])
]


def test_a_songs_backing_names_its_chords_but_the_voice_keeps_its_doh(tmp_path):
    # Over a G major backing the voice above still fits C.  Taking the chords' doh instead was
    # tried (plan R5): it fixed synthetic songs like this one, but on the real ADC2004/MIREX05
    # songs it fired twice, and both times the chord key disagreed with the scale the sung
    # melody fits.  The chords are read and labelled; the doh is the voice's.
    case = bench.Case("song_G", "G major", 90, [("G", 4), ("C", 4), ("D", 4), ("G", 4)], style="bass", lead_in=LEAD_IN)
    backing = _backing(tmp_path / "backing.wav", case)
    vocal_path = _sing(tmp_path / "vocal.wav", ONE_TI_SUNG, seconds=sf.info(str(backing)).duration)
    result = transcribe(vocal_path, mode="melody", audio_preview=False, fast=True, chord_source=backing)
    assert result.key == "C major"
    assert _pitches(result).count(77) == 1
    assert result.chords
    # As a song's separated vocal too (the mix beside it): the voice is unsure of C, but G is
    # 8% worse, not one of the readings it could as well be (``_doh_from_band``).
    song = transcribe(vocal_path, mode="melody", audio_preview=False, fast=True, chord_source=backing,
                      tempo_source=_mixed(tmp_path / "mix.wav", vocal_path, backing))
    assert song.key == "C major"
    assert _pitches(song) == _pitches(result)


def _mixed(path: Path, *parts: Path) -> Path:
    """The parts summed, as a song's mix holds its vocal and its band."""
    ys = [sf.read(str(p), dtype="float32")[0] for p in parts]
    n = max(len(y) for y in ys)
    mix = sum(np.pad(y, (0, n - len(y))) for y in ys)
    sf.write(str(path), (0.8 * mix / np.max(np.abs(mix))).astype(np.float32), SR)
    return path


# G A B C C# D D | D C# C B A G G: G and D major read it about equally, an even chance
# (``test_an_unsure_doh_comes_with_the_others_and_their_notes``).
NEAR_TIE_SUNG = [67.05, 69.0, 70.95, 72.1, 73.0, 74.05, 74.05, 74.0, 72.9, 72.0, 71.05, 69.0, 66.95, 66.95]


def test_a_songs_band_settles_the_doh_its_voice_is_unsure_of(tmp_path, monkeypatch):
    # Sung over a band in D, as a song (its mix beside the separated vocal): D is one of the
    # dohs the voice could as well be in, and the band's chords rest on it.  The voice's own G
    # is then the one offered.  The same take read as a hum keeps the voice's G.
    monkeypatch.setattr(transcriber, "KEY_ALTERNATIVES_BELOW", 0.51)
    case = bench.Case("song_D", "D major", 90, [("D", 4), ("G", 4), ("A", 4), ("D", 4)], style="bass", lead_in=LEAD_IN)
    backing = _backing(tmp_path / "backing.wav", case)
    voice = _sing(tmp_path / "vocal.wav", NEAR_TIE_SUNG, seconds=sf.info(str(backing)).duration)
    mix = _mixed(tmp_path / "mix.wav", voice, backing)
    hum = transcribe(voice, mode="melody", audio_preview=False, fast=True, chord_source=backing)
    song = transcribe(voice, mode="melody", audio_preview=False, fast=True, chord_source=backing, tempo_source=mix)
    assert hum.key == "G major"
    assert song.key == "D major"
    assert "G major" in {k.key for k in song.key_alternatives or []}
    # Every note was sung within the keep band of its own pitch: the doh moves, the notes do not.
    assert _pitches(song) == _pitches(hum)
    monkeypatch.setenv("NF_SONG_DOH", "0")
    off = transcribe(voice, mode="melody", audio_preview=False, fast=True, chord_source=backing, tempo_source=mix)
    assert off.key == "G major"


def test_doh_from_band_moves_only_an_unsure_doh_to_one_the_voice_could_be_in():
    fit = vocal.ScaleFit(offset=0.1, root=0, cost_margin=0.0, tonal_margin=0.1, readings=2, alternatives=(7,))
    snapped = vocal.snap_to_scale([m - fit.offset for m in FLAT_TI_SUNG], fit.root)
    events = [Event(i * 0.5, i * 0.5 + 0.45, p, 0.8, pyin_midi=m - fit.offset, stability=1.0)
              for i, (m, p) in enumerate(zip(FLAT_TI_SUNG, snapped))]
    written, settled = transcriber._doh_from_band(events, fit, (7, "major"))
    assert settled.root == 7 and settled.alternatives == (0,)
    assert [e.pitch for e in written] == FLAT_TI_TUNE  # the flat F#s, in doubt in C, are G's ti
    assert transcriber._doh_from_band(events, fit, (4, "minor"))[1].root == 7  # E minor is la-based on G
    assert transcriber._doh_from_band(events, fit, (9, "minor")) is None  # A minor: the voice's own doh
    assert transcriber._doh_from_band(events, fit, (2, "major")) is None  # D: not a reading of the voice's
    sure = vocal.ScaleFit(offset=0.1, root=0, cost_margin=0.4, tonal_margin=1.0, alternatives=(7,))
    assert transcriber._doh_from_band(events, sure, (7, "major")) is None


# ── The melody floor ──────────────────────────────────────────────────────────


def _skyline_events(times: np.ndarray, pitch: int) -> list[tuple]:
    return [(float(times[0]), float(times[-1]) + 0.1, pitch, 0.9, None)]


def test_the_melody_floor_still_fires_under_a_steady_accompaniment():
    # pyin on a left hand: dead steady within each note, two octaves under the skyline.
    times = np.arange(200) * 0.0232
    midi = np.where(np.arange(200) < 100, 48.0, 50.0)
    assert transcriber._stillness(midi) == pytest.approx(1.0)
    assert transcriber._melody_floor_hz(_skyline_events(times, 72), times, midi) is not None


def test_the_melody_floor_is_declined_when_pyin_follows_a_voice():
    # A singer under a piano's top line: the skyline is just as far above, but pyin's pitch
    # never sits in one 10-cent bin from frame to frame.
    times = np.arange(200) * 0.0232
    rng = np.random.default_rng(0)
    midi = np.where(np.arange(200) < 100, 60.0, 62.0) + 0.1 * rng.integers(-2, 3, 200)
    assert transcriber._stillness(midi) < transcriber.MELODY_FLOOR_MIN_STILLNESS
    assert transcriber._melody_floor_hz(_skyline_events(times, 72), times, midi) is None


def test_a_wrong_key_inside_the_guard_leaves_the_notes_the_voice_sang_clearly():
    # G major, its one C natural a quick note 5 cents sharp; the user typed D major, whose
    # scale has C# instead.  Too short for an accidental's evidence, the C would be written
    # as a D-major tone; it was heard as C, though, and stays C: only notes left in doubt move.
    tune = [67, 69, 71, 72, 74, 71, 67, 66, 67, 69, 71, 74, 76, 74, 71, 69, 67]
    # An untrained singer's scatter elsewhere, so a scale one tone apart fits nearly as well.
    sung = [p + (0.05 if p == 72 else (0.2 if i % 2 else -0.2)) for i, p in enumerate(tune)]
    fit = vocal.ScaleFit(offset=0.0, root=7, cost_margin=0.3, tonal_margin=1.0)
    events = [Event(i * 0.5, i * 0.5 + (0.1 if p == 72 else 0.45), p, 0.8, pyin_midi=m - fit.offset, stability=1.0)
              for i, (m, p) in enumerate(zip(sung, tune))]
    rewritten = transcriber._rewrite_in_root(events, fit, 2, False)
    assert rewritten is not None  # D fits these notes nearly as well: the guard lets it in
    assert [e.pitch for e in rewritten[0]] == tune



def test_a_failure_writing_the_other_dohs_never_loses_the_sheet(tmp_path, monkeypatch):
    sung = [67.05, 69.0, 70.95, 72.1, 73.0, 74.05, 74.05, 74.0, 72.9, 72.0, 71.05, 69.0, 66.95, 66.95]
    monkeypatch.setattr(transcriber, "KEY_ALTERNATIVES_BELOW", 0.51)

    def broken(*_args):
        raise RuntimeError("engraver down")

    monkeypatch.setattr(transcriber, "_engrave_in", broken)
    result = transcribe(_sing(tmp_path / "near_tie.wav", sung), mode="melody", audio_preview=False, fast=True)
    assert result.key == "G major" and result.notes
    assert result.key_alternatives is None
