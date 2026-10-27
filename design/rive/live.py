"""The live 3D reward moments: one small signed .riv per level emblem (spinning in, `levelup-<n>.riv`) and per earned
badge (popping in, `<badge>.riv`), each holding only its own faces, written to web-site/assets/practice-3d/ for the
Practice view to play when that reward lands.

Each file is a one-piece copy of design/rive/practice, signed by `rive --publish` (scripts must be signed for the web
runtimes) against the Rive file the project is bound to (`push:` in its rive.yaml), so it carries no watermark. That
needs `rive login` with an account that can open that file.

    node design/rive/faces.mjs && python3 design/rive/live.py
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

from stills import LEVELS, PROJECT, RIVE, ROOT, STICKERS, WORK

OUT = ROOT / "web-site" / "assets" / "practice-3d"
SIZE = 400


def binding() -> str:
    """The project's `push:` block, which every piece is signed against."""
    yaml = (PROJECT / "rive.yaml").read_text()
    m = re.search(r"^push:\n(?:  .+\n)+", yaml, re.M)
    if not m:
        raise SystemExit("design/rive/practice is not bound to a Rive file: run `rive push` there first")
    return m.group(0)


def publish(name: str, files: list[str], main: str, edits: list[tuple[str, str]], push: str) -> None:
    d = WORK.parent / "live" / name
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    for f in files:
        shutil.copy(PROJECT / f, d / f)
    script = d / f"{main}.luau"
    src = script.read_text()
    for old, new in edits:
        assert old in src, (name, old)
        src = src.replace(old, new)
    script.write_text(src)
    (d / "rive.yaml").write_text(
        f'name: {name}\nmain: {main}\nartboard:\n  width: {SIZE}\n  height: {SIZE}\n  background: "#00000000"\n{push}'
    )
    run = subprocess.run([RIVE, str(d), "--publish"], capture_output=True, text=True)
    log = run.stdout + run.stderr
    if run.returncode != 0 or "watermarked" in log:
        raise SystemExit(f"{name}: {log.strip().splitlines()[-1] if log.strip() else 'publish failed'}")
    shutil.copy(d / "build" / f"{name}.riv", OUT / f"{name}.riv")
    print(f"  {name}.riv {(OUT / f'{name}.riv').stat().st_size // 1024} KB")


def main() -> None:
    push = binding()
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    for i, _ in enumerate(LEVELS, start=1):
        publish(f"levelup-{i}", ["emblem.luau", "coin.wgsl", f"emblem-{i}.png"], "emblem",
                [("        level = 1,", f"        level = {i},"), ("        spin = 0,", "        spin = SPIN_SECONDS,")], push)
    for s in STICKERS:
        if not s.startswith("badge-") or s.endswith("-locked"):
            continue
        publish(s, ["sticker.luau", "puff.wgsl", f"{s}.png", f"{s}-normal.png"], "sticker",
                [("        art = 'flame-active',", f"        art = '{s}',"), ("        popLeft = 0,", "        popLeft = POP_SECONDS,")], push)


if __name__ == "__main__":
    main()
