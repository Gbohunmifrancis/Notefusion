"""The worker's own check that it still reads printed music: a known page through the reader a job uses.

    docker compose exec transcriber python -m app.pipeline.sheet_check

Reads ``data/sheet_check/amazing-grace.png`` (Amazing Grace as the hymn page publishes it, engraved by the site's
pinned OSMD) through ``sheet_reader.read_sheet`` (homr in its own process) and ``transcribe_score``, the path a photo
of sheet music takes, and compares it with the hymn's own notes beside it. Prints one JSON line: the key and meter
read, how many of the hymn's notes were found in order, and the seconds it took; exits 1 when the key or meter is
wrong, fewer than ``MIN_SHARE`` of the notes were found, or nothing could be read (homr missing, its models gone, a
library that no longer imports). Notes are compared with repeats joined: homr writes no ties, so a held note comes
back as the same note again. Run by ``.github/workflows/check-ec2.yml``.
"""

from __future__ import annotations

import difflib
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

PAGE = Path(__file__).resolve().parents[1] / "data" / "sheet_check" / "amazing-grace.png"
#: Of the hymn's notes, the share that must be read, in order. The page is clean engraving, read 30 of 30 when made.
MIN_SHARE = 0.9


def _joined(midis: list[int]) -> list[int]:
    """The notes with each run of one pitch as one note (a tied note and a repeated one alike)."""
    return [m for i, m in enumerate(midis) if i == 0 or midis[i - 1] != m]


def share_found(expected: list[int], read: list[int]) -> float:
    """Of ``expected``'s notes (repeats joined), the share found in ``read`` in the same order."""
    want, got = _joined(expected), _joined(read)
    if not want:
        return 0.0
    blocks = difflib.SequenceMatcher(None, want, got, autojunk=False).get_matching_blocks()
    return sum(b.size for b in blocks) / len(want)


def check(page: Path = PAGE) -> dict:
    """Reads ``page`` as a job would and says how close it came to the notes in the JSON beside it."""
    from app.pipeline.score_transcriber import transcribe_score
    from app.pipeline.sheet_reader import read_sheet

    expected = json.loads(page.with_suffix(".json").read_text(encoding="utf-8"))
    work = Path(tempfile.mkdtemp(prefix="nf_sheet_check_"))
    started = time.monotonic()
    line: dict = {"page": page.name}
    try:
        # A copy in the work folder: homr writes its MusicXML beside the picture, never into the image's own files.
        copy = work / page.name
        shutil.copyfile(page, copy)
        result = transcribe_score(read_sheet(copy, work))
        found = share_found(expected["pitchMidi"], [n.pitch_midi for n in result.notes])
        line.update(key=result.key, time=result.time_signature, notes=len(result.notes), found=round(found, 3),
                    ok=result.key == expected["key"] and result.time_signature == expected["time"] and found >= MIN_SHARE)
    except Exception as exc:  # noqa: BLE001 - whatever stopped it is the answer
        line.update(ok=False, error=f"{type(exc).__name__}: {exc}"[:200])
    finally:
        shutil.rmtree(work, ignore_errors=True)
    line["expected"] = {"key": expected["key"], "time": expected["time"], "notes": len(expected["pitchMidi"])}
    line["seconds"] = round(time.monotonic() - started, 1)
    return line


def main() -> int:
    line = check()
    print(json.dumps({"sheet_check": line}), flush=True)
    return 0 if line["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
