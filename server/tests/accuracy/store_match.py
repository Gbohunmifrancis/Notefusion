"""Store-song matching benchmark: which YouTube upload a Spotify or Apple Music song is taken from.

    python -m tests.accuracy.store_match                # dev and test tables, and every pick that is not right
    python -m tests.accuracy.store_match --split test   # the held-out searches only

A store link is found on YouTube by its title and artist (``links._search_youtube``) and the upload is chosen by
``links._rank_results``.  The yardstick is ``store_match_frozen.json``: 82 real searches (the worker's own
``ytsearch5`` query for Deezer's title, artist and length of each song), frozen with the uploads that are the store's
own recording and, apart, the artist's own official upload of the same song when it runs longer (an intro).  Songs
from Nigerian gospel, Afrobeats and amapiano, worship and pop, with the traps a search turns up: another song by the
same artist, remixes and covers of the right length, a 432 Hz retune, a live take with "Live" in the song's name,
and songs no upload among the five is (the right answer then is none, and the store's preview stands in).

  right        the first pick is the recording (or, with no recording among them, the artist's padded upload)
  wrong        the first pick is something else
  refused      nothing picked where nothing was right
  guessed      something picked where nothing was right
  missed       nothing picked where the recording was there
  runners-up   songs whose second or third pick (tried when the first cannot be fetched) is neither

Measurement only; ``tests/test_store_match.py`` holds the line (no wrong pick, no guess).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.ingest import links

FIXTURE = Path(__file__).with_name("store_match_frozen.json")


def cases(split: str | None = None) -> list[dict]:
    return [c for c in json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"] if split in (None, c["split"])]


def judge(case: dict, ranked: list[str]) -> str:
    """One case's verdict for the first pick of ``ranked``."""
    first = ranked[0] if ranked else None
    fine = case["recording"] or case["padded"]
    if not fine:
        return "refused" if first is None else "guessed"
    if first is None:
        return "missed"
    return "right" if first in fine else "wrong"


def score(split: str | None = None) -> tuple[dict[str, int], list[str]]:
    tally = dict(right=0, wrong=0, refused=0, guessed=0, missed=0, runners_up=0)
    notes = []
    for case in cases(split):
        source = links.Source(provider="spotify", url="", title=case["title"], artist=case["artist"],
                              thumbnail_url=None, duration=case["duration"])
        ranked = links._rank_results(case["results"], source)[:links._SEARCH_CANDIDATES]
        verdict = judge(case, ranked)
        tally[verdict] += 1
        stray = [v for v in ranked[1:] if v not in case["recording"] + case["padded"]]
        tally["runners_up"] += bool(stray)
        if verdict not in ("right", "refused") or stray:
            notes.append(f"  {verdict:8} {case['title']} | {case['artist']}: {ranked}" + (f" (runners-up {stray})" if stray else ""))
    return tally, notes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--split", choices=("dev", "test"))
    args = parser.parse_args()
    for split in [args.split] if args.split else ["dev", "test"]:
        tally, notes = score(split)
        print(f"{split}: {len(cases(split))} songs  " + "  ".join(f"{k} {v}" for k, v in tally.items()))
        print("\n".join(notes))


if __name__ == "__main__":
    main()
