"""A photo or PDF of printed music, read into a melody score the score path writes in solfa.

The reading is homr's (https://github.com/liebharc/homr, AGPL-3.0): installed unmodified in a
virtual environment of its own (``NF_OMR_BIN``, the image's ``/opt/homr``) and run as its own
program, one page at a time, never imported here.  A PDF's first ``MAX_PAGES`` pages are drawn
to images by poppler's ``pdftoppm`` first.

Two things are done to what homr writes before the tune is taken from it:

* the page's key signature is kept through it.  homr reads the first system's key signature
  and often none on the systems after it, which turned every flat of a hymn in E flat into a
  natural from its second line on; a hymn rarely changes key, so a later "no key signature"
  is taken as the first one again (a real change to another key is kept);
* the tune is the top note of the top staff at each moment: a hymn book prints soprano and
  alto on that staff, homr reads them as chords, and the score path reads single notes only.

Measured on hymn pages engraved and photographed for the test (99% of syllables right) and on
real scans of an 1870 hymn book (89% of syllables, 71% of note lengths), so the clients ask
the person to check the notes.
"""

from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path

from music21 import converter, key as m21key, meter, note as m21note, stream

from app.pipeline.transcriber import LowConfidenceError

logger = logging.getLogger(__name__)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
PDF_SUFFIXES = {".pdf"}
SHEET_SUFFIXES = IMAGE_SUFFIXES | PDF_SUFFIXES

#: Pages of a PDF read at most (about ten seconds each).
MAX_PAGES = 4
#: The resolution a PDF page is drawn at: a hymn book's staff is then about as tall as a phone photo's.
PDF_DPI = 200
#: The longest one page may take.
PAGE_TIMEOUT_SECONDS = 120
#: A sheet read off a page is not the exact score a notation file is: the clients' "Some notes may need a check"
#: (between their 0.5 and 0.75, web-site/assets/confidence.js and mobile lib/confidence.ts).
READ_CONFIDENCE = 0.7

NO_MUSIC = ("We couldn't find printed music in that picture. Take the photo straight on, with the whole "
            "page flat and in good light, or upload the PDF.")
UNREADABLE = "That file couldn't be opened as a picture or a PDF. Try a JPEG or PNG photo, or the PDF itself."

_SHARPS = "FCGDAEB"
_FLATS = "BEADGCF"


def _homr() -> str:
    return os.getenv("NF_OMR_BIN", "homr")


def _pages(path: Path, work: Path) -> list[Path]:
    """The pages to read: the picture itself, or a PDF's first pages drawn as PNGs."""
    if path.suffix.lower() in IMAGE_SUFFIXES:
        return [path]
    prefix = work / "page"
    done = subprocess.run(["pdftoppm", "-r", str(PDF_DPI), "-png", "-f", "1", "-l", str(MAX_PAGES), str(path), str(prefix)],
                          capture_output=True, timeout=PAGE_TIMEOUT_SECONDS)
    pages = sorted(work.glob("page*.png"))
    if done.returncode != 0 or not pages:
        logger.warning("pdftoppm could not draw the PDF (exit %d): %s", done.returncode, done.stderr[-300:])
        raise LowConfidenceError(UNREADABLE)
    return pages


def _read_page(page: Path) -> str | None:
    """homr's MusicXML for one page, or None when it found no music on it."""
    try:
        done = subprocess.run([_homr(), page.name], cwd=str(page.parent), capture_output=True, text=True,
                              timeout=PAGE_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        logger.warning("homr took longer than %ds on a page", PAGE_TIMEOUT_SECONDS)
        return None
    out = page.with_suffix(".musicxml")
    if done.returncode != 0 or not out.exists():
        logger.info("homr read no music (exit %d): %s", done.returncode, (done.stderr or "")[-300:])
        return None
    return out.read_text(encoding="utf-8")


def keep_key_signature(xml: str) -> str:
    """The first key signature kept where homr later writes none (see the module's note): each later ``<fifths>0``
    becomes the first, and the notes under it with no accidental of their own get its sharps or flats."""
    import xml.etree.ElementTree as et

    import defusedxml.ElementTree as defused

    root = defused.fromstring(xml.encode("utf-8"))
    first = next((int(f.text) for f in root.iter("fifths") if (f.text or "").strip().lstrip("-").isdigit()), 0)
    if first == 0:
        return xml
    letters = _SHARPS[:first] if first > 0 else _FLATS[:-first]
    alter = 1 if first > 0 else -1
    dropped = False
    for measure in root.iter("measure"):
        for fifths in measure.iter("fifths"):
            value = int(fifths.text or 0)
            dropped = value == 0
            if dropped:
                fifths.text = str(first)
        if not dropped:
            continue
        for n in measure.iter("note"):
            pitch = n.find("pitch")
            if pitch is None or n.find("accidental") is not None or pitch.find("alter") is not None:
                continue
            step = pitch.find("step")
            if step is not None and step.text in letters:
                el = et.Element("alter")
                el.text = str(alter)
                pitch.insert(1, el)
    return et.tostring(root, encoding="unicode")


def _tune(xml: str) -> tuple[list[tuple[int | None, float]], int, str | None]:
    """The top staff's top note at each moment (None for a rest), its key signature and its time signature."""
    score = converter.parseData(xml, format="musicxml")
    staves = score.parts
    if not staves:
        return [], 0, None
    top = staves[0].flatten()
    ks = next(iter(top.getElementsByClass(m21key.KeySignature)), None)
    ts = next(iter(top.getElementsByClass(meter.TimeSignature)), None)
    by_onset: dict[float, list] = {}
    for el in top.notesAndRests:
        by_onset.setdefault(round(float(el.offset), 4), []).append(el)
    line: list[tuple[int | None, float]] = []
    for onset in sorted(by_onset):
        sounding = [el for el in by_onset[onset] if not el.isRest]
        if sounding:
            best = max(sounding, key=lambda el: max(p.midi for p in el.pitches))
            line.append((max(p.midi for p in best.pitches), float(best.quarterLength)))
        else:
            line.append((None, float(by_onset[onset][0].quarterLength)))
    return line, (ks.sharps if ks is not None else 0), (ts.ratioString if ts is not None else None)


def read_sheet(path: Path, work: Path) -> Path:
    """The tune of the printed music in ``path`` (a photo or a PDF) as a MusicXML file in ``work``.

    Raises ``LowConfidenceError`` with a plain sentence when no music can be read from it.
    """
    line: list[tuple[int | None, float]] = []
    sharps, time_signature = 0, None
    for number, page in enumerate(_pages(path, work)):
        xml = _read_page(page)
        if xml is None:
            continue
        try:
            notes, page_sharps, page_time = _tune(keep_key_signature(xml))
        except Exception as exc:  # noqa: BLE001 - one unreadable page leaves the others
            logger.warning("homr's page %d could not be parsed: %s: %s", number + 1, type(exc).__name__, exc)
            continue
        if not line:
            sharps, time_signature = page_sharps, page_time
        line += notes
    while line and line[0][0] is None:
        line.pop(0)
    if sum(1 for midi, _ in line if midi is not None) < 4:
        raise LowConfidenceError(NO_MUSIC)

    part = stream.Part()
    part.append(m21key.KeySignature(sharps))
    part.append(meter.TimeSignature(time_signature or "4/4"))
    for midi, length in line:
        part.append(m21note.Rest(quarterLength=length) if midi is None else m21note.Note(midi, quarterLength=length))
    out = work / "sheet.musicxml"
    stream.Score([part]).write("musicxml", fp=str(out))
    return out
