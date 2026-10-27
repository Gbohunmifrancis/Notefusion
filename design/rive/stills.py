"""The 3D stills: every level emblem and sticker of design/rive/practice rendered once, at rest, as a transparent WebP
the apps show wherever the 2D art was (web-site/assets/practice-art-3d/, mobile/assets/practice-3d/ and the phone's
index mobile/src/components/practice/art/stills.ts).

Each piece is captured twice by `rive --screenshot`, over black and over white, and its alpha read from the
difference (a capture always has a background). The 3D piece is then scaled to fill the box its 2D art fills in the
2D art's own viewBox, so a still drops into any layout sized for the 2D art.

    node design/rive/faces.mjs && python3 design/rive/stills.py
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PROJECT = HERE / "practice"
WORK = PROJECT / "build" / "stills"
WEB_DIR = ROOT / "web-site" / "assets" / "practice-art-3d"
MOBILE_DIR = ROOT / "mobile" / "assets" / "practice-3d"
MOBILE_INDEX = ROOT / "mobile" / "src" / "components" / "practice" / "art" / "stills.ts"
ART_2D = ROOT / "web-site" / "assets" / "practice-art"

RIVE = os.environ.get("RIVE", str(Path.home() / ".rive" / "bin" / "rive"))
CAPTURE = 512  # the square the 3D piece is rendered in
WIDTH = 384  # a still's width; its height follows the 2D art's viewBox
QUALITY = 88

LEVELS = ["doh", "ray", "me", "fah", "soh", "lah", "te", "choir-ready"]
STICKERS = [p.stem for p in sorted(PROJECT.glob("*-normal.png"))]
STICKERS = [s[: -len("-normal")] for s in STICKERS]


def view_box(name: str) -> tuple[float, float]:
    svg = (ART_2D / f"{name}.svg").read_text()
    w, h = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg).groups()
    return float(w), float(h)


def project(name: str, background: str, files: list[str], main: str, edits: dict[str, tuple[str, str]]) -> Path:
    """A one-piece copy of the project: only this piece's script, shader and images, on the given background."""
    d = WORK / f"{name}-{background.strip('#')}"
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    for f in files:
        text_edit = edits.get(f)
        if text_edit:
            old, new = text_edit
            src = (PROJECT / f).read_text()
            assert old in src, (f, old)
            (d / f).write_text(src.replace(old, new))
        else:
            shutil.copy(PROJECT / f, d / f)
    (d / "rive.yaml").write_text(
        f'name: still\nmain: {main}\nartboard:\n  width: {CAPTURE}\n  height: {CAPTURE}\n  background: "{background}"\n'
    )
    return d


def capture(d: Path, at: str) -> Image.Image:
    out = d / "build" / "still.png"
    subprocess.run([RIVE, str(d), f"--screenshot={out}", f"--advance={at}"], check=True, capture_output=True)
    return Image.open(out).convert("RGB")


def matte(black: Image.Image, white: Image.Image) -> Image.Image:
    """The piece with its alpha: a pixel over black is c·a, over white c·a + (1 - a)."""
    k, w = black.load(), white.load()
    out = Image.new("RGBA", black.size)
    o = out.load()
    for y in range(black.height):
        for x in range(black.width):
            kb, wb = k[x, y], w[x, y]
            a = 1 - sum(wb[i] - kb[i] for i in range(3)) / (3 * 255)
            a = min(1.0, max(0.0, a))
            if a < 1 / 255:
                o[x, y] = (0, 0, 0, 0)
                continue
            o[x, y] = tuple(min(255, round(kb[i] / a)) for i in range(3)) + (round(a * 255),)
    return out


def box_2d(name: str, face: Path) -> tuple[float, float, float, float]:
    """Where the 2D art sits in its viewBox, as fractions: its face PNG is the art letterboxed into a square."""
    w, h = view_box(name)
    im = Image.open(face).convert("RGBA")
    size = im.width
    s = size / max(w, h)
    ox, oy = (size - w * s) / 2, (size - h * s) / 2
    x0, y0, x1, y1 = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    return ((x0 - ox) / s / w, (y0 - oy) / s / h, (x1 - ox) / s / w, (y1 - oy) / s / h)


def place(piece: Image.Image, name: str, face: Path) -> Image.Image:
    w, h = view_box(name)
    W, H = WIDTH, round(WIDTH * h / w)
    bx0, by0, bx1, by1 = box_2d(name, face)
    crop = piece.crop(piece.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox())
    tw, th = (bx1 - bx0) * W, (by1 - by0) * H
    k = min(tw / crop.width, th / crop.height)
    crop = crop.resize((max(1, round(crop.width * k)), max(1, round(crop.height * k))), Image.LANCZOS)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cx, cy = (bx0 + bx1) / 2 * W, (by0 + by1) / 2 * H
    out.alpha_composite(crop, (round(cx - crop.width / 2), round(cy - crop.height / 2)))
    return out


def still(name: str, files: list[str], main: str, edits: dict[str, tuple[str, str]], at: str, face: Path) -> None:
    black = capture(project(name, "#000000", files, main, edits), at)
    white = capture(project(name, "#FFFFFF", files, main, edits), at)
    img = place(matte(black, white), name, face)
    for d in (WEB_DIR, MOBILE_DIR):
        img.save(d / f"{name}.webp", "WEBP", quality=QUALITY, method=6)
    print(f"  {name}.webp {img.width}x{img.height}")


def main() -> None:
    for d in (WEB_DIR, MOBILE_DIR):
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
    names: list[str] = []
    for i, level in enumerate(LEVELS, start=1):
        name = f"level-{i}-{level}"
        still(name, ["emblem.luau", "coin.wgsl", f"emblem-{i}.png"], "emblem",
              {"emblem.luau": ("        level = 1,", f"        level = {i},")}, "1300ms", PROJECT / f"emblem-{i}.png")
        names.append(name)
    for s in STICKERS:
        still(s, ["sticker.luau", "puff.wgsl", f"{s}.png", f"{s}-normal.png"], "sticker",
              {"sticker.luau": ("        art = 'flame-active',", f"        art = '{s}',")}, "1200ms", PROJECT / f"{s}.png")
        names.append(s)
    lines = [
        "// Generated by design/rive/stills.py — do not edit. The 3D stills of the Practice art (design/rive/practice),",
        "// shown by components/practice/Art.tsx in place of the 2D art of the same name. The web app's copies are in",
        "// web-site/assets/practice-art-3d/.",
        "export const STILLS = {",
        *[f'  "{n}": require("../../../../assets/practice-3d/{n}.webp"),' for n in names],
        "} as const;",
        "",
    ]
    MOBILE_INDEX.write_text("\n".join(lines))
    print(f"{len(names)} stills")


if __name__ == "__main__":
    main()
