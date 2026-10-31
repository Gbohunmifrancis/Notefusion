"""A photo or PDF of printed music: homr's reading (faked here) kept in its key and taken down to the tune."""

import stat
import textwrap
from pathlib import Path

import pytest

from app.pipeline import sheet_reader
from app.pipeline.score_transcriber import transcribe_score
from app.pipeline.transcriber import LowConfidenceError


def _note(step, octave, dur, chord=False, alter=None, accidental=None):
    return (("<chord/>" if chord else "") + "<pitch><step>%s</step>%s<octave>%d</octave></pitch><duration>%d</duration>"
            % (step, f"<alter>{alter}</alter>" if alter is not None else "", octave, dur)
            + "<voice>1</voice><staff>1</staff>"
            + (f"<accidental>{accidental}</accidental>" if accidental else ""))


def _page(measures):
    """homr's shape: one part, two staves, divisions 4 to the crotchet."""
    body = []
    for number, (attrs, notes) in enumerate(measures, start=1):
        body.append(f'<measure number="{number}">{attrs}' + "".join(f"<note>{n}</note>" for n in notes) + "</measure>")
    return ('<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1">'
            "<part-name>Piano</part-name></score-part></part-list><part id=\"P1\">" + "".join(body) + "</part></score-partwise>")


FIRST = ("<attributes><divisions>4</divisions><key><fifths>-3</fifths></key><time><beats>4</beats>"
         "<beat-type>4</beat-type></time><staves>1</staves><clef number=\"1\"><sign>G</sign><line>2</line></clef></attributes>")
DROPPED = "<attributes><key><fifths>0</fifths></key></attributes>"

# Eventide's opening as a hymn book prints it in E flat: soprano over alto on one staff, read as chords, and the
# second system's key signature lost.
EVENTIDE = _page([
    (FIRST, [_note("G", 4, 8), _note("E", 4, 8, chord=True, alter=-1), _note("G", 4, 4), _note("F", 4, 4)]),
    ("", [_note("E", 4, 8, alter=-1), _note("B", 4, 8, alter=-1)]),
    (DROPPED, [_note("C", 5, 4), _note("B", 4, 4), _note("B", 4, 4), _note("A", 4, 4), _note("F", 4, 4, chord=True)]),
    ("", [_note("G", 4, 12), _note("B", 4, 4, accidental="natural")]),
])


def _fake_homr(tmp_path, monkeypatch, xml):
    """A stand-in for homr that writes ``xml`` beside the page it was given (nothing for None)."""
    canned = tmp_path / "canned.musicxml"
    script = tmp_path / "homr"
    if xml is None:
        script.write_text("#!/bin/sh\nexit 1\n")
    else:
        canned.write_text(xml)
        script.write_text(textwrap.dedent(f"""\
            #!/bin/sh
            cp "{canned}" "$(basename "$1" | sed 's/\\.[^.]*$//').musicxml"
            """))
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("NF_OMR_BIN", str(script))


def test_a_lost_key_signature_is_kept_and_its_flats_put_back():
    fixed = sheet_reader.keep_key_signature(EVENTIDE)
    assert "<fifths>0</fifths>" not in fixed
    line, sharps, time_signature = sheet_reader._tune(fixed)
    assert (sharps, time_signature) == (-3, "4/4")
    # C5 B♭4 B♭4 A♭4 in the third bar, not B and A naturals; a note with its own natural keeps it.
    assert [m for m, _ in line] == [67, 67, 65, 63, 70, 72, 70, 70, 68, 67, 71]


def test_the_tune_is_the_top_note_of_each_chord_on_the_top_staff():
    line, _, _ = sheet_reader._tune(sheet_reader.keep_key_signature(EVENTIDE))
    assert line[0] == (67, 2.0)  # the soprano's G over the alto's E♭
    assert line[8] == (68, 1.0)  # A♭ over F


def test_bass_chords_read_in_place_of_a_lost_tune_staff_are_left_out():
    # A songbook page: the tune's staff in the treble clef, and on the second system homr lost it and reported the
    # piano's bass, in the bass clef, as staff 1.
    lost = _page([
        (FIRST, [_note("G", 4, 4), _note("A", 4, 4), _note("B", 4, 4, alter=-1), _note("C", 5, 4)]),
        ('<attributes><clef number="1"><sign>F</sign><line>4</line></clef></attributes>',
         [_note("E", 3, 8, alter=-1), _note("C", 3, 8, chord=True), _note("G", 2, 8)]),
    ])
    line, _, _ = sheet_reader._tune(lost)
    assert [m for m, _ in line] == [67, 69, 70, 72]


def test_a_tune_written_in_the_bass_clef_is_still_read():
    bass = FIRST.replace("<sign>G</sign><line>2</line>", "<sign>F</sign><line>4</line>")
    line, _, _ = sheet_reader._tune(_page([(bass, [_note("G", 3, 4), _note("B", 3, 4, alter=-1), _note("D", 4, 8)])]))
    assert [m for m, _ in line] == [55, 58, 62]


def _readings(monkeypatch, first, even, enlarged=None):
    """homr's reading of a page (``first``), of its evened-out copy (``even``) and of that copy enlarged; the copies
    are only asked for."""
    asked = []

    def copy(page, work, enlarge=1):
        asked.append(enlarge)
        return work / ("page-even.png" if enlarge == 1 else f"page-even-x{enlarge}.png")

    readings = {"page-even.png": even, "page-even-x2.png": enlarged}
    monkeypatch.setattr(sheet_reader, "_even_light", copy)
    monkeypatch.setattr(sheet_reader, "_read_page", lambda image: readings.get(image.name, first))
    return asked


def _line(count):
    return _page([(FIRST, [_note("C", 5, 4)] * 4)] + [("", [_note("D", 5, 4)] * 4)] * (count // 4 - 1))


def test_a_page_read_as_almost_nothing_is_read_again_with_its_lighting_evened(tmp_path, monkeypatch):
    asked = _readings(monkeypatch, _line(8), _line(32))
    line, _, _ = sheet_reader._page_tune(tmp_path / "page.jpg", 0, tmp_path)
    assert asked and len(line) == 32
    # Kept only when it reads more: an evened-out copy that loses the page leaves the first reading.
    _readings(monkeypatch, _line(8), None)
    line, _, _ = sheet_reader._page_tune(tmp_path / "page.jpg", 0, tmp_path)
    assert len(line) == 8


def test_a_page_photographed_small_is_read_once_more_enlarged(tmp_path, monkeypatch):
    from PIL import Image

    Image.new("L", (900, 1200), 255).save(tmp_path / "page.jpg")  # smaller than ENLARGE_BELOW
    asked = _readings(monkeypatch, _line(8), _line(12), _line(40))
    line, _, _ = sheet_reader._page_tune(tmp_path / "page.jpg", 0, tmp_path)
    assert asked == [1, 2] and len(line) == 40
    # The evened copy read well enough: no enlarged look.
    asked = _readings(monkeypatch, _line(8), _line(32), _line(40))
    line, _, _ = sheet_reader._page_tune(tmp_path / "page.jpg", 0, tmp_path)
    assert asked == [1] and len(line) == 32
    # A large photo is not enlarged.
    Image.new("L", (sheet_reader.ENLARGE_BELOW, 1200), 255).save(tmp_path / "page.jpg")
    asked = _readings(monkeypatch, _line(8), _line(12), _line(40))
    line, _, _ = sheet_reader._page_tune(tmp_path / "page.jpg", 0, tmp_path)
    assert asked == [1] and len(line) == 12


def test_enlarging_doubles_the_evened_page(tmp_path):
    from PIL import Image

    Image.new("L", (300, 400), 230).save(tmp_path / "photo.png")
    out = sheet_reader._even_light(tmp_path / "photo.png", tmp_path, 2)
    assert out.name == "photo-even-x2.png" and Image.open(out).size == (600, 800)


def test_a_page_read_well_is_read_once(tmp_path, monkeypatch):
    asked = _readings(monkeypatch, _line(20), _line(40))
    line, _, _ = sheet_reader._page_tune(tmp_path / "page.jpg", 0, tmp_path)
    assert not asked and len(line) == 20


def test_evening_the_light_takes_a_shadow_off_the_paper(tmp_path):
    import numpy as np
    from PIL import Image

    page = np.full((400, 300), 235, np.uint8)
    page[:, 150:] = 120            # a hand's shadow over the right half
    page[100:104, 20:280] = 20     # a staff line across both halves
    Image.fromarray(page).save(tmp_path / "photo.png")
    even = np.asarray(Image.open(sheet_reader._even_light(tmp_path / "photo.png", tmp_path)), dtype=np.float32)
    paper_lit, paper_shaded = even[300, 60], even[300, 240]
    assert abs(paper_lit - paper_shaded) < 25 and min(paper_lit, paper_shaded) > 200
    assert even[102, 240] < 120  # the line under the shadow is still dark


def test_a_photo_becomes_the_tune_in_solfa(tmp_path, monkeypatch):
    _fake_homr(tmp_path, monkeypatch, EVENTIDE)
    photo = tmp_path / "hymn.jpg"
    photo.write_bytes(b"\xff\xd8 not really a jpeg")
    work = tmp_path / "work"
    work.mkdir()
    result = transcribe_score(sheet_reader.read_sheet(photo, work))
    assert result.key == "Eb major"
    assert " ".join(n.solfa for n in result.notes[:10]) == "m m r d s l s s f m"


def test_no_music_in_the_picture_is_a_plain_sentence(tmp_path, monkeypatch):
    _fake_homr(tmp_path, monkeypatch, None)
    photo = tmp_path / "cat.png"
    photo.write_bytes(b"png")
    with pytest.raises(LowConfidenceError) as caught:
        sheet_reader.read_sheet(photo, tmp_path)
    assert str(caught.value) == sheet_reader.NO_MUSIC


def test_a_pdf_that_will_not_draw_is_a_plain_sentence(tmp_path):
    pdf = tmp_path / "broken.pdf"
    pdf.write_bytes(b"%PDF-1.4 nothing here")
    with pytest.raises(LowConfidenceError) as caught:
        sheet_reader.read_sheet(pdf, tmp_path)
    assert str(caught.value) == sheet_reader.UNREADABLE


def test_a_machine_without_the_readers_answers_in_plain_words(tmp_path, monkeypatch):
    # No pdftoppm (the CI runner has none) and no homr where NF_OMR_BIN points: no traceback, the plain sentences.
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))
    monkeypatch.setenv("NF_OMR_BIN", str(tmp_path / "missing-homr"))
    pdf, photo = tmp_path / "hymns.pdf", tmp_path / "hymn.jpg"
    pdf.write_bytes(b"%PDF-1.4")
    photo.write_bytes(b"jpeg")
    with pytest.raises(LowConfidenceError, match="couldn't be opened"):
        sheet_reader.read_sheet(pdf, tmp_path)
    with pytest.raises(LowConfidenceError, match="couldn't find printed music"):
        sheet_reader.read_sheet(photo, tmp_path)


def test_the_score_route_takes_a_photo_and_the_job_writes_its_tune(tmp_path, monkeypatch):
    import io
    import time

    from fastapi.testclient import TestClient

    from app.main import app

    _fake_homr(tmp_path, monkeypatch, EVENTIDE)
    with TestClient(app) as client:
        r = client.post("/v1/transcribe/score", files={"score": ("hymn.jpg", io.BytesIO(b"\xff\xd8 jpeg"), "image/jpeg")})
        assert r.status_code == 202
        job_id = r.json()["jobId"]
        for _ in range(100):
            job = client.get(f"/v1/jobs/{job_id}").json()
            if job["status"] in ("done", "failed"):
                break
            time.sleep(0.1)
    assert job["status"] == "done", job
    assert job["result"]["key"] == "Eb major"
    # Read off a page, not given exactly: the clients ask for a check of the notes.
    assert 0.5 <= job["result"]["overallConfidence"] < 0.75


def test_a_photographed_hymn_page_is_offered_its_hymnbook_version(tmp_path, monkeypatch):
    import io
    import json
    import time

    from fastapi.testclient import TestClient
    from music21 import key as m21key, meter, note as m21note, stream

    from app.main import app
    from app.pipeline import sheet_check

    # Amazing Grace as homr reads it: every note, but its tied notes as repeats (homr writes no ties).
    hymn = json.loads(sheet_check.PAGE.with_suffix(".json").read_text(encoding="utf-8"))["pitchMidi"]
    read = hymn[:9] + [hymn[8]] + hymn[9:] + [hymn[-1]]
    part = stream.Part()
    part.append(m21key.KeySignature(1))
    part.append(meter.TimeSignature("3/4"))
    for m in read:
        part.append(m21note.Note(m, quarterLength=1))
    _fake_homr(tmp_path, monkeypatch, stream.Score([part]).write("musicxml").read_text(encoding="utf-8"))
    with TestClient(app) as client:
        r = client.post("/v1/transcribe/score", files={"score": ("grace.jpg", io.BytesIO(b"\xff\xd8 jpeg"), "image/jpeg")})
        job_id = r.json()["jobId"]
        for _ in range(100):
            job = client.get(f"/v1/jobs/{job_id}").json()
            if job["status"] in ("done", "failed"):
                break
            time.sleep(0.1)
    assert job["status"] == "done", job
    offer = job["result"]["hymnMatch"]
    assert (offer["slug"], offer["kind"], offer["key"]) == ("amazing-grace", "score", "G major")
    # The hymnbook's notes: its held notes whole, as the page printed them.
    assert len(offer["notes"]) == len(hymn)
