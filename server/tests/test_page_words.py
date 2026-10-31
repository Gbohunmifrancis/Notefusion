"""The words printed on a page name the hymn among those sung to the matched tune (Tesseract's reading faked here)."""

import shutil

import pytest

from app.pipeline import hymn_match as hm
from app.pipeline.page_words import pick_hymn, read_words, words_of


def test_a_word_split_into_syllables_under_the_notes_is_one_word_again():
    assert {"amazing", "grace", "sweet", "sound"} <= words_of("A - maz - ing grace! how sweet the sound")
    assert "amazing" in words_of("A-maz-ing")
    assert "the" not in words_of("the Lord of all")  # the common words say nothing about which hymn


def test_a_page_names_its_hymn_among_every_hymn_sung_to_the_tune():
    every = hm.default_index().settings["caithness"]
    target = next(s for s in every if s.slug == "o-for-a-closer-walk-with-god")
    # As Tesseract reads a photographed page: the title, then the verse in syllables between the staves, a few misread.
    page = ("O for a Closer Walk with God\n\nO for a clos - er walk with God, A calm and heav'n- ly frame,\n"
            "A light to shine up - on the road That leads me to the Lamb! 6 } 2\n")
    pick = pick_hymn(page, every)
    assert pick is not None and pick.slug == target.slug


def test_a_page_without_words_or_with_words_we_do_not_hold_picks_nothing():
    every = hm.default_index().settings["caithness"]
    assert pick_hymn("", every) is None
    assert pick_hymn("Allegro moderato  Op. 12  mf  Piano", every) is None
    assert pick_hymn("Twinkle twinkle little star how I wonder what you are", every) is None


def test_an_offer_for_a_photographed_page_names_the_hymn_its_words_print():
    from types import SimpleNamespace

    tune = hm.default_index().entries[[e.slug for e in hm.default_index().entries].index("tune-caithness")]
    notes = [SimpleNamespace(pitch_midi=p, start_beat=s, dur_beats=d) for p, s, d in tune.notes]
    page = ("O for a Closer Walk with God\nO for a clos - er walk with God, A calm and heav'n- ly frame,\n"
            "A light to shine up - on the road That leads me to the Lamb!")
    found = hm.offer(SimpleNamespace(notes=notes, tempo=90, key=None), page_words=page)
    assert found["chosen"] == "o-for-a-closer-walk-with-god"
    assert found["settings"][0]["slug"] == "o-for-a-closer-walk-with-god"
    assert "chosen" not in hm.offer(SimpleNamespace(notes=notes, tempo=90, key=None))


def test_no_reader_on_the_machine_reads_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv("NF_OCR_BIN", str(tmp_path / "missing-tesseract"))
    assert read_words([tmp_path / "page.png"]) == ""


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="Tesseract is not installed here")
def test_tesseract_reads_a_title_off_a_page(tmp_path):
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("L", (1200, 300), 255)
    ImageDraw.Draw(img).text((40, 100), "O for a Closer Walk with God", fill=0, font=ImageFont.load_default(size=56))
    img.save(tmp_path / "page.png")
    assert "closer" in words_of(read_words([tmp_path / "page.png"]))
