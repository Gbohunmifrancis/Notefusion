"""The live 3D reward moments' pictures: each level emblem's face and each badge's colours and normal map, as the
web's WebGL port of design/rive/practice (web-site/assets/moment-3d.js) draws them, written to
web-site/assets/practice-3d/ (emblem-<n>.webp, <badge>.webp, <badge>-normal.webp). The colours are lossy; a normal
map is numbers, so it is kept lossless.

    node design/rive/faces.mjs && python3 design/rive/live.py
"""

from __future__ import annotations

import shutil

from PIL import Image

from stills import LEVELS, PROJECT, ROOT, STICKERS

OUT = ROOT / "web-site" / "assets" / "practice-3d"
EMBLEM_SIZE = 384  # the face spans the coin, at most 400 px on a 200 px moment at 2x
QUALITY = 90


def write(src: str, dst: str, size: int | None, lossless: bool) -> None:
    image = Image.open(PROJECT / src).convert("RGBA")
    if size and image.width > size:
        image = image.resize((size, size), Image.LANCZOS)
    image.save(OUT / dst, "WEBP", lossless=lossless, quality=100 if lossless else QUALITY, method=6, exact=lossless)


def main() -> None:
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    for i, _ in enumerate(LEVELS, start=1):
        write(f"emblem-{i}.png", f"emblem-{i}.webp", EMBLEM_SIZE, False)
    for s in STICKERS:
        if not s.startswith("badge-") or s.endswith("-locked"):
            continue
        write(f"{s}.png", f"{s}.webp", None, False)
        write(f"{s}-normal.png", f"{s}-normal.webp", None, True)
    total = sum(f.stat().st_size for f in OUT.iterdir())
    print(f"  {len(list(OUT.iterdir()))} pictures, {total // 1024} KB")


if __name__ == "__main__":
    main()
