"""Chord reading (``app.pipeline.chords``) and the "chords" mode around it.

Three layers: the spelling and solfa of a chord in a key (pure, instant); the decoder and the
key estimate on hand-made evidence; and whole transcriptions of rendered piano progressions
and of a real phone recording of a keyboard played with its transpose set to -4.
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.pipeline import chords
from app.pipeline.chords import BeatEvidence, ChordSpan
from app.pipeline.transcriber import Event, transcribe
from tests.accuracy import chords_bench as bench

FIXTURE = Path(__file__).parent / "fixtures" / "keyboard_f_major.m4a"


def _spans(*items: tuple[str, int]) -> list[ChordSpan]:
    out, beat = [], 0.0
    for symbol, beats in items:
        root, quality, bass = bench.parse_symbol(symbol)
        out.append(ChordSpan(beat, float(beats), root, quality, bass))
        beat += beats
    return out


def _named(spans, tonic: str, mode: str = "major") -> list[tuple[str, str]]:
    return [(c.symbol, c.solfa) for c in chords.label(spans, tonic, mode)]


# ── Spelling and solfa ────────────────────────────────────────────────────────


def test_a_progression_in_f_is_spelled_in_f_and_named_from_doh_f():
    spans = _spans(("F", 2), ("Dm", 2), ("G", 2), ("Bb", 2), ("C7", 2), ("Gm", 2))
    assert _named(spans, "F") == [("F", "d"), ("Dm", "l"), ("G", "r"), ("Bb", "f"), ("C7", "s"), ("Gm", "r")]


def test_chromatic_roots_are_flattened_degrees_unless_the_chord_is_diminished():
    spans = _spans(("Bb", 1), ("Eb", 1), ("Ab", 1), ("Db", 1), ("F#dim", 1), ("C#dim", 1), ("G#dim", 1))
    assert _named(spans, "C") == [
        ("Bb", "ta"), ("Eb", "ma"), ("Ab", "la"), ("Db", "ra"), ("F#dim", "fe"), ("C#dim", "de"), ("G#dim", "se")]


@pytest.mark.parametrize("tonic, items, expected", [
    ("E", [("C#m", 1), ("B7", 1), ("G#m", 1), ("A", 1), ("D#dim", 1)],
     [("C#m", "l"), ("B7", "s"), ("G#m", "m"), ("A", "f"), ("D#dim", "t")]),
    ("E-", [("Ab", 1), ("Cm", 1), ("Bb7", 1), ("Ddim", 1), ("Fm7", 1), ("Ebmaj7", 1)],
     [("Ab", "f"), ("Cm", "l"), ("Bb7", "s"), ("Ddim", "t"), ("Fm7", "r"), ("Ebmaj7", "d")]),
    ("Db", [("Gb", 1), ("Bbm", 1), ("Ab7", 1), ("Absus4", 1)],
     [("Gb", "f"), ("Bbm", "l"), ("Ab7", "s"), ("Absus4", "s")]),
    ("F#", [("B", 1), ("D#m", 1), ("C#7", 1), ("E#dim", 1)],
     [("B", "f"), ("D#m", "l"), ("C#7", "s"), ("E#dim", "t")]),
])
def test_sharp_keys_take_sharps_and_flat_keys_take_flats(tonic, items, expected):
    assert _named(_spans(*items), tonic) == expected


def test_a_minor_key_is_named_from_its_relative_majors_doh():
    # la-based minor: A minor's doh is C, so its tonic chord is "l" and its dominant "m".
    spans = _spans(("Am", 1), ("Dm", 1), ("E", 1), ("E7", 1), ("G#dim", 1), ("F", 1), ("C", 1))
    assert _named(spans, "A", "minor") == [
        ("Am", "l"), ("Dm", "r"), ("E", "m"), ("E7", "m"), ("G#dim", "se"), ("F", "f"), ("C", "d")]
    # D minor (doh F) keeps its flat: Bb, and the raised leading tone is C#.
    spans = _spans(("Dm", 1), ("Bb", 1), ("A7", 1), ("C#dim", 1), ("Gm", 1))
    assert _named(spans, "D", "minor") == [("Dm", "l"), ("Bb", "f"), ("A7", "m"), ("C#dim", "se"), ("Gm", "r")]


def test_a_slash_chord_spells_its_bass_as_the_chord_tone_it_is():
    assert _named(_spans(("A/C#", 1), ("D/F#", 1), ("D/A", 1), ("G/B", 1)), "D") == [
        ("A/C#", "s"), ("D/F#", "d"), ("D/A", "d"), ("G/B", "f")]
    assert _named(_spans(("Bb/D", 1), ("C/E", 1), ("F/C", 1), ("Gm7/F", 1)), "F") == [
        ("Bb/D", "f"), ("C/E", "s"), ("F/C", "d"), ("Gm7/F", "r")]


def test_keyboard_transpose_moves_the_symbols_and_leaves_the_solfa():
    # Played as A-major shapes on a keyboard set to -4: it sounds in F, the sheet is in A.
    sounding = _spans(("F", 4), ("Dm", 4), ("G", 4), ("Bb", 4), ("C/E", 2), ("F", 2))
    written = chords.transpose(sounding, 4)
    assert _named(written, "A") == [("A", "d"), ("F#m", "l"), ("B", "r"), ("D", "f"), ("E/G#", "s"), ("A", "d")]
    assert [s for _, s in _named(written, "A")] == [s for _, s in _named(sounding, "F")]
    assert [(c.root, c.bass) for c in written][4] == (4, 8)


def test_key_names_avoid_seven_accidentals():
    assert chords.tonic_name(1, "major") == "D-"
    assert chords.tonic_name(8, "minor") == "G#"
    assert chords.tonic_name(6, "major") == "F#"


def test_a_key_is_spelled_from_its_pitch_class_however_it_was_named():
    # The melody pipeline spells pitch class 1 "C# major" and 8 "A- minor"; C#'s ChordSpeller,
    # which names a saved sheet's chords, knows only the pitch class and spells Db and G#
    # minor (doh B).  The worker must name the chords the same way or a sheet changes its
    # symbols the moment it is saved.
    spans = _spans(("Db", 1), ("F", 1), ("Ab7", 1), ("Bbm", 1), ("Cdim", 1))
    db_major = [("Db", "d"), ("F", "m"), ("Ab7", "s"), ("Bbm", "l"), ("Cdim", "t")]
    assert _named(spans, "C#") == db_major
    assert _named(spans, "D-") == db_major
    gs_minor = [("C#", "r"), ("F", "sa"), ("G#7", "l"), ("A#m", "t"), ("B#dim", "de")]
    assert _named(spans, "A-", "minor") == gs_minor
    assert _named(spans, "G#", "minor") == gs_minor


# ── Decoding and key ──────────────────────────────────────────────────────────


def _evidence(progression: list[tuple[str, int]], noise: float = 0.15, seed: int = 0) -> BeatEvidence:
    rng = np.random.default_rng(seed)
    rows, bass = [], []
    for symbol, beats in progression:
        root, quality, slash = bench.parse_symbol(symbol)
        for _ in range(beats):
            v = rng.random(12) * noise
            for iv in bench._INTERVALS[quality]:
                v[(root + iv) % 12] += 1.0
            rows.append(v / v.sum())
            b = np.zeros(12)
            b[slash if slash is not None else root] = 1.0
            bass.append(b)
    n = len(rows)
    return BeatEvidence(np.array(rows), np.array(bass), np.zeros(n, bool), np.zeros(n, bool), np.zeros((n, 12)))


def test_the_decoder_holds_a_chord_through_one_stray_beat():
    progression = [("C", 4), ("Am", 4), ("F", 4), ("G7", 4), ("C", 4)]
    ev = _evidence(progression)
    # One beat in the middle of the A minor bar where a tune's passing notes G and B are as
    # loud as the chord: on its own that beat reads E minor or C major seven.
    ev.chroma[6] = 0.0
    ev.chroma[6, [9, 0, 4, 7, 11]] = [0.2, 0.2, 0.2, 0.2, 0.2]
    got = [(s.start_beat, s.dur_beats, s.root, s.quality) for s in chords.decode(ev, (0, "major"))]
    assert got == [(0, 4, 0, "maj"), (4, 4, 9, "min"), (8, 4, 5, "maj"), (12, 4, 7, "7"), (16, 4, 0, "maj")]


def test_silent_beats_are_no_chord():
    ev = _evidence([("D", 4), ("A", 4)])
    ev.silent[4:] = True
    ev.chroma[4:] = 0.0
    assert [(s.root, s.quality, s.dur_beats) for s in chords.decode(ev)] == [(2, "maj", 4.0)]


@pytest.mark.parametrize("progression, key", [
    ([("F", 4), ("Dm", 4), ("G", 4), ("Bb", 4), ("F", 4), ("C", 2), ("F", 4)], (5, "major")),
    ([("Am", 4), ("Dm", 4), ("E", 4), ("Am", 4), ("F", 4), ("E7", 4), ("Am", 4)], (9, "minor")),
    ([("G", 4), ("C", 4), ("D", 4), ("G", 4)], (7, "major")),
    ([("C", 4), ("F", 4), ("G7", 4), ("Am", 2), ("F", 2), ("G", 4), ("C", 4)], (0, "major")),
])
def test_the_key_comes_from_where_the_chords_rest(progression, key):
    spans = _spans(*progression)
    assert chords.estimate_key(spans)[0] == key


def test_a_sus4_is_not_read_over_its_own_fourth():
    # F G A C over an F bass (the opening of the keyboard fixture): F, not C sus4.
    ev = _evidence([("C", 1)])
    ev.chroma[0] = 0.0
    ev.chroma[0, [5, 7, 9, 0]] = [0.3, 0.25, 0.2, 0.25]
    ev.bass[0] = 0.0
    ev.bass[0, 5] = 1.0
    span = chords.decode(ev, (5, "major"))[0]
    assert (span.root, span.quality) == (5, "maj")


# ── MusicXML ──────────────────────────────────────────────────────────────────


def test_harmony_lands_on_its_beat_even_inside_a_held_note():
    from music21 import converter, harmony, meter, note, stream

    from app.pipeline.transcriber import export_musicxml

    s = stream.Stream()
    s.insert(0, meter.TimeSignature("4/4"))
    s.insert(0, note.Note(65, quarterLength=3))   # held across beat 2
    s.insert(3, note.Note(67, quarterLength=1))
    s.insert(4, note.Note(67, quarterLength=2))   # held across beat 5
    s.insert(6, note.Note(69, quarterLength=2))   # held across beat 7
    xml = export_musicxml(s.makeMeasures())
    labelled = chords.label(_spans(("F", 2), ("Gm7/F", 3), ("C7", 2), ("F", 1)), "F", "major")
    out = chords.add_harmony(xml, labelled)
    assert out.count("<harmony") == 4

    parsed = converter.parse(out, format="musicxml")
    symbols = list(parsed.recurse().getElementsByClass(harmony.ChordSymbol))
    assert [round(float(cs.getOffsetInHierarchy(parsed)), 3) for cs in symbols] == [0.0, 2.0, 5.0, 7.0]
    assert [cs.root().name for cs in symbols] == ["F", "G", "C", "F"]
    assert symbols[1].bass().name == "F"
    # The measures still hold exactly what they held: four beats each.
    for m in parsed.parts[0].getElementsByClass(stream.Measure):
        sounding = [n for n in m.notesAndRests if not isinstance(n, harmony.ChordSymbol)]
        assert float(sum(n.duration.quarterLength for n in sounding)) == 4.0


# ── Top line ──────────────────────────────────────────────────────────────────


def test_the_top_line_follows_the_highest_note_and_skips_overtones():
    events = [
        Event(0.0, 1.0, 60, 0.6), Event(0.0, 1.0, 64, 0.6), Event(0.0, 1.0, 67, 0.6),
        Event(0.0, 0.9, 79, 0.2),  # G5: the G4's octave, quieter, not a voice
        Event(0.5, 1.0, 72, 0.7),  # a melody note above the chord
        Event(1.0, 2.0, 65, 0.6), Event(1.0, 2.0, 69, 0.6), Event(1.0, 2.0, 60, 0.6),
    ]
    line = chords.top_line(events)
    assert [(round(e.start, 2), round(e.end, 2), e.pitch) for e in line] == [
        (0.0, 0.5, 67), (0.5, 1.0, 72), (1.0, 2.0, 69)]


# ── Rendered progressions, end to end ────────────────────────────────────────

CASES = {c.name: c for c in bench.CASES}


@pytest.mark.parametrize("name", ["hymn_F", "v_of_v_F", "minor_A", "slash_D", "melody_G", "jazzish_Bb"])
def test_a_rendered_progression_is_read_beat_for_beat(name):
    case = CASES[name]
    result = bench.run_chords_mode(case)
    assert bench.beat_accuracy(case, bench.result_seconds(result)) >= 0.9
    assert result.key == case.key
    assert result.chords_source == "heard"
    symbols = [c.symbol for c in result.chords]
    assert symbols == [s for s, _ in case.chords]
    assert result.musicxml.count("<harmony") == len(result.chords)
    # The melody is one line: no two notes start together.
    starts = [n.start_beat for n in result.notes]
    assert len(starts) == len(set(starts))


def test_keyboard_transpose_writes_the_sheet_in_the_key_that_was_played():
    case = CASES["hymn_F"]
    notes, seconds = bench.notes_for(case)
    y = bench.render(notes, seconds)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        path = Path(tmp.name)
    try:
        sf.write(str(path), y, bench.SAMPLE_RATE)
        heard = transcribe(path, mode="chords", audio_preview=False)
        played = transcribe(path, mode="chords", audio_preview=False, keyboard_transpose=-4)
    finally:
        path.unlink(missing_ok=True)
    assert (heard.key, played.key) == ("F major", "A major")
    assert [c.symbol for c in played.chords] == ["A", "D", "E", "A", "F#m", "Bm", "E7", "A"]
    assert [c.solfa for c in played.chords] == [c.solfa for c in heard.chords]
    assert [n.pitch_midi - 4 for n in played.notes] == [n.pitch_midi for n in heard.notes]
    assert [n.solfa for n in played.notes] == [n.solfa for n in heard.notes]


def test_a_songs_backing_gives_the_melody_its_chords(tmp_path):
    # A tune (the "vocal") and, on the same timeline, its accompaniment with a bass.
    case = bench.Case("song_G", "G major", 90, [("G", 4), ("Em", 4), ("C", 4), ("D", 4), ("G", 4)], style="bass")
    backing_notes, seconds = bench.notes_for(case)
    spb = 60.0 / case.bpm
    tune = [67, 71, 74, 71, 71, 67, 64, 67, 72, 76, 72, 67, 74, 72, 71, 69, 67, 67, 67, 67]
    vocal_notes = [(case.lead_in + i * spb, spb * 0.9, p, 0.7) for i, p in enumerate(tune)]
    vocal, backing = tmp_path / "vocal.wav", tmp_path / "backing.wav"
    sf.write(str(vocal), bench.render(vocal_notes, seconds, use_samples=False), bench.SAMPLE_RATE)
    sf.write(str(backing), bench.render(backing_notes, seconds), bench.SAMPLE_RATE)

    result = transcribe(vocal, mode="melody", audio_preview=False, chord_source=backing)
    assert result.chords_source == "heard"
    assert bench.beat_accuracy(case, bench.result_seconds(result)) >= 0.85
    assert [c.solfa for c in result.chords] == ["d", "l", "f", "s", "d"]

    plain = transcribe(vocal, mode="melody", audio_preview=False)
    assert plain.chords is None and plain.chords_source is None


# ── A real recording ──────────────────────────────────────────────────────────


def _long_chords(result, min_sec: float = 1.0):
    """The chords that last at least ``min_sec``: the harmony, without one-beat passing chords."""
    spb = 60.0 / result.tempo
    return [c for c in result.chords if c.dur_beats * spb >= min_sec]


@pytest.fixture(scope="module")
def keyboard_clip():
    if shutil.which("ffmpeg") is None:
        pytest.skip("the fixture is an m4a, which only ffmpeg decodes")
    return {
        kt: transcribe(FIXTURE, mode="chords", audio_preview=False, keyboard_transpose=kt)
        for kt in (0, -4)
    }


def test_the_keyboard_clip_is_in_f_as_heard(keyboard_clip):
    result = keyboard_clip[0]
    assert result.key == "F major"
    assert result.solfa_lines[0] == "Doh is F"
    first = _long_chords(result)[:4]
    assert [c.symbol for c in first] == ["F", "Dm", first[2].symbol, "Bb"]
    assert [c.solfa for c in first] == ["d", "l", "r", "f"]
    assert first[2].root == 7 and first[2].quality in ("maj", "7")  # G major, not the key's G minor
    assert _long_chords(result)[-1].solfa == "d"


def test_the_keyboard_clip_is_in_a_as_played_on_a_keyboard_set_to_minus_four(keyboard_clip):
    heard, played = keyboard_clip[0], keyboard_clip[-4]
    assert played.key == "A major"
    assert played.solfa_lines[0] == "Doh is A"
    first = _long_chords(played)[:4]
    assert [c.symbol.rstrip("7") for c in first] == ["A", "F#m", "B", "D"]
    assert [c.solfa for c in played.chords] == [c.solfa for c in heard.chords]
    assert [n.solfa for n in played.notes] == [n.solfa for n in heard.notes]


# ── Wire and plumbing ─────────────────────────────────────────────────────────


def _wav_bytes(seconds: float = 0.5) -> bytes:
    from io import BytesIO

    buffer = BytesIO()
    t = np.arange(int(22050 * seconds)) / 22050
    sf.write(buffer, 0.3 * np.sin(2 * np.pi * 220 * t), 22050, format="WAV")
    return buffer.getvalue()


def test_chords_reach_the_wire_in_camel_case():
    from dataclasses import asdict

    from app.api.schemas import ResultDto
    from app.pipeline.transcriber import TranscriptionResult

    result = TranscriptionResult(
        key="F major", key_confidence=1.0, tempo=90, time_signature="4/4", musicxml="<score/>",
        midi_base64="", notes=[], solfa_lines=[], overall_confidence=1.0,
        chords=chords.label(_spans(("F", 2), ("C/E", 2)), "F", "major"), chords_source="heard")
    wire = ResultDto.model_validate(asdict(result)).model_dump(by_alias=True)
    assert wire["chordsSource"] == "heard"
    assert wire["chords"][1] == {
        "startBeat": 2.0, "durBeats": 2.0, "root": 0, "quality": "maj", "bass": 4, "symbol": "C/E", "solfa": "s"}


def test_the_submit_takes_chords_mode_and_the_keyboard_transpose(monkeypatch):
    from io import BytesIO

    from fastapi.testclient import TestClient

    from app.jobs import queue as queue_mod
    from app.main import app

    seen = []

    def fake_submit(self, audio_path, **kwargs):
        seen.append((kwargs["mode"], kwargs["keyboard_transpose"]))
        audio_path.unlink(missing_ok=True)
        return "job"

    def fake_submit_link(self, url, **kwargs):
        seen.append((kwargs["mode"], kwargs["keyboard_transpose"]))
        return "job"

    monkeypatch.setattr(queue_mod.JobQueue, "submit", fake_submit)
    monkeypatch.setattr(queue_mod.JobQueue, "submit_link", fake_submit_link)
    with TestClient(app) as client:
        def upload(data):
            return client.post("/v1/transcribe", files={"audio": ("clip.wav", BytesIO(_wav_bytes()), "audio/wav")},
                               data=data)

        assert upload({"mode": "chords", "keyboard_transpose": "-4"}).status_code == 202
        assert upload({"mode": "melody"}).status_code == 202
        link = {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
        assert client.post("/v1/transcribe/link", data={**link, "keyboard_transpose": "3"}).status_code == 202
        for bad in ("12", "-12"):
            r = upload({"mode": "chords", "keyboard_transpose": bad})
            assert r.status_code == 422 and "between -11 and 11" in r.text
            assert client.post("/v1/transcribe/link", data={**link, "keyboard_transpose": bad}).status_code == 422
        assert upload({"mode": "piano"}).status_code == 422
    assert seen == [("chords", -4), ("melody", 0), ("melody", 3)]


def test_a_song_reads_its_chords_from_the_instrumental_and_a_hum_from_nothing(monkeypatch, tmp_path):
    from app.jobs import queue as queue_mod
    from app.pipeline import separate
    from app.pipeline.transcriber import TranscriptionResult

    calls = []

    def fake_transcribe(audio_path, mode="melody", **kwargs):
        calls.append((Path(audio_path).name, mode, kwargs.get("chord_source"), kwargs.get("keyboard_transpose")))
        return TranscriptionResult(key="C major", key_confidence=1.0, tempo=100, time_signature="4/4",
                                   musicxml="<score/>", midi_base64="", notes=[], solfa_lines=[],
                                   overall_confidence=1.0)

    def fake_separate(wav, out, progress=lambda f: None, backing_path=None):
        out.write_bytes(b"RIFF")
        backing_path.write_bytes(b"RIFF")
        return out

    monkeypatch.setattr(queue_mod, "transcribe", fake_transcribe)
    monkeypatch.setattr(queue_mod, "_encode_backing", lambda path: "")
    monkeypatch.setattr(separate, "separate_file", fake_separate)
    q = queue_mod.JobQueue(workers=1, pro_lane_workers=0)
    try:
        def run(mode, separate_vocals, available):
            monkeypatch.setattr(separate, "available", lambda: available)
            audio = tmp_path / f"song-{len(calls)}.wav"
            audio.write_bytes(_wav_bytes())
            job = queue_mod.Job(id=f"j{len(calls)}")
            q._run(job, audio, mode, None, None, separate_vocals=separate_vocals, keyboard_transpose=-2)
            assert job.status == queue_mod.STATUS_DONE, job.error
            return calls[-1]

        vocal, _, source, kt = run("melody", True, True)
        assert (vocal, Path(source).name, kt) == ("vocals.wav", "backing.wav", -2)
        mix, _, source, _ = run("melody", True, False)  # no isolation model: the mix itself
        assert Path(source).name == mix
        assert run("melody", False, True)[2] is None  # a hummed tune has no accompaniment
        assert run("chords", False, True)[2] is None  # chords mode reads its own audio
    finally:
        q.shutdown(wait=False)
