"""The production check that printed music is still read: its page, its yardstick and its verdict (homr faked)."""

import json

from music21 import key as m21key, meter, note as m21note, stream

from app.pipeline import sheet_check
from tests.test_sheet_reader import _fake_homr


def _as_read(midis, key_sharps=1, time="3/4"):
    """A MusicXML of these notes, one crotchet each, as homr would write it for the page."""
    part = stream.Part()
    part.append(m21key.KeySignature(key_sharps))
    part.append(meter.TimeSignature(time))
    for m in midis:
        part.append(m21note.Note(m, quarterLength=1))
    return stream.Score([part]).write("musicxml").read_text(encoding="utf-8")


def _expected():
    return json.loads(sheet_check.PAGE.with_suffix(".json").read_text(encoding="utf-8"))


def test_the_page_and_its_notes_ship_together():
    assert sheet_check.PAGE.exists() and sheet_check.PAGE.stat().st_size > 10_000
    expected = _expected()
    assert (expected["key"], expected["time"], len(expected["pitchMidi"])) == ("G major", "3/4", 32)


def test_held_notes_and_repeats_count_alike_and_a_wrong_note_counts_against():
    assert sheet_check.share_found([62, 67, 67, 71], [62, 67, 71]) == 1.0
    assert sheet_check.share_found([62, 67, 71], [62, 67, 67, 67, 71]) == 1.0
    assert sheet_check.share_found([62, 67, 71, 69], [62, 67, 72, 69]) == 0.75
    assert sheet_check.share_found([], [60]) == 0.0


def test_a_page_read_as_printed_passes(tmp_path, monkeypatch):
    _fake_homr(tmp_path, monkeypatch, _as_read(_expected()["pitchMidi"]))
    line = sheet_check.check()
    assert line["ok"] and line["found"] == 1.0
    assert (line["key"], line["time"]) == ("G major", "3/4")
    # homr writes beside the picture: the copy it read was the work folder's, never the image's own file.
    assert not sheet_check.PAGE.with_suffix(".musicxml").exists()


def test_a_reader_that_reads_nothing_or_the_wrong_meter_fails(tmp_path, monkeypatch):
    _fake_homr(tmp_path, monkeypatch, None)
    line = sheet_check.check()
    assert not line["ok"] and "LowConfidenceError" in line["error"]

    _fake_homr(tmp_path, monkeypatch, _as_read(_expected()["pitchMidi"], time="4/4"))
    assert not sheet_check.check()["ok"]


def test_main_says_so_in_its_exit_code(tmp_path, monkeypatch, capsys):
    _fake_homr(tmp_path, monkeypatch, None)
    assert sheet_check.main() == 1
    assert json.loads(capsys.readouterr().out)["sheet_check"]["ok"] is False
