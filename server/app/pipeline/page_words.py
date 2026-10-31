"""The words printed on a page of music, read by Tesseract, and the hymn they name among those sung to a tune.

homr reads a page's notes and not its words, and most hymns we hold are words set to a tune another hymn has too
(OLD HUNDREDTH carries over a hundred): the notes alone name the tune. The page's title and the verse under its
staves name the hymn. Tesseract (Apache-2.0, the image's ``tesseract-ocr``, ``NF_OCR_BIN``) reads them, and
``pick_hymn`` scores each hymn sung to the matched tune by how many of its title's and first verse's words are on
the page. A page printed with its words gives the hymn's own words over and over, where every other hymn on that tune
shares only the common ones ("the", "Lord"), so the winner is clear or there is none: a page without words, or
with words we do not hold, picks nothing and the person is asked instead.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

#: Pages whose words are read (a hymn's title and first verse are on its first page).
WORD_PAGES = 2
#: Tesseract's sparse-text reading: a page of music is short runs of words between staves, which the default page
#: layout (3) takes for pictures and drops. Measured on 40 photographed words pages: 40 picked right with 11, 25 with 3.
PAGE_SEGMENTATION = "11"
#: The longest one page's reading may take.
OCR_TIMEOUT_SECONDS = 60
#: A hymn is picked when this share of its title's and first verse's words are on the page ...
PICK_SHARE = 0.5
#: ... and it leads every other hymn sung to the tune by this much.
PICK_LEAD = 0.2
#: Words this short ("a", "of", "to") say nothing about which hymn it is.
MIN_WORD = 3
#: Words every hymn shares, left out of the comparison.
COMMON = frozenset(
    "the and our thy thee thou him its all who that with for from are was not but you your his her they them their "
    "this these those shall will have hath has had let may now when where what which while there here then than lord "
    "god".split())


def _ocr() -> str:
    return os.getenv("NF_OCR_BIN", "tesseract")


def read_words(pages: list[Path]) -> str:
    """The text on the first ``WORD_PAGES`` pages ("" when Tesseract is not there or reads nothing)."""
    out = []
    for page in pages[:WORD_PAGES]:
        try:
            done = subprocess.run([_ocr(), str(page), "-", "--psm", PAGE_SEGMENTATION, "-l", "eng"], capture_output=True,
                                  text=True, encoding="utf-8", errors="replace", timeout=OCR_TIMEOUT_SECONDS)
        except (OSError, subprocess.TimeoutExpired) as exc:  # no Tesseract here, or a page that never ends
            logger.info("page words not read: %s: %s", type(exc).__name__, exc)
            return "\n".join(out)
        if done.returncode == 0:
            out.append(done.stdout)
    return "\n".join(out)


def words_of(text: str) -> set[str]:
    """The words of ``text`` as a set, a word split into syllables under the notes joined again ("A - maz - ing"
    and "A-maz-ing" both "amazing"), lower case, letters only, the short and the common left out."""
    text = text.lower().replace("’", "'")
    text = re.sub(r"(?<=[a-z])\s*[-–—_]+\s*(?=[a-z])", "", text)  # syllables joined
    return {w for w in re.findall(r"[a-z]+", text) if len(w) >= MIN_WORD and w not in COMMON}


@dataclass(frozen=True)
class Pick:
    slug: str
    share: float      # of the hymn's words found on the page
    lead: float       # over the next hymn sung to the tune


def pick_hymn(text: str, hymns) -> Pick | None:
    """Which of ``hymns`` (each with ``slug``, ``title`` and ``lyrics``) the page's ``text`` prints, or None."""
    page = words_of(text)
    if not page or not hymns:
        return None
    scored = []
    for h in hymns:
        own = words_of(f"{h.title} {h.lyrics}")
        if own:
            scored.append((len(own & page) / len(own), h.slug))
    if not scored:
        return None
    scored.sort(reverse=True)
    best, slug = scored[0]
    runner = scored[1][0] if len(scored) > 1 else 0.0
    if best < PICK_SHARE or best - runner < PICK_LEAD:
        return None
    return Pick(slug=slug, share=round(best, 3), lead=round(best - runner, 3))
