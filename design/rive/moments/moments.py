"""The reward moments: six small signed .riv files the Practice view (and the web app's play-along) shows over the page
when a marked take earns one. Each is one Luau piece in this folder (with helpers.luau before it) on an artboard whose
view model carries the values the page sets when it plays it (the streak's days, the stars, the run).

Every piece is built as its own Rive project under build/<name>/ (main.luau, scene.rml, its font and images) and
signed by `rive --publish` against the Rive file design/rive/practice is bound to, like design/rive/live.py, so it
carries no watermark. That needs `rive login` with an account that can open that file.

    python3 design/rive/moments/moments.py                 # verify every piece, then publish the signed files
    python3 design/rive/moments/moments.py --verify        # build and check only, no login needed
    python3 design/rive/moments/moments.py --preview DIR   # looping WebP previews of each piece, no login needed

Doh's two poses come from design/practice-art: `node design/rive/faces.mjs moments` draws them here.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent
BUILD = HERE / "build"
OUT = ROOT / "web-site" / "assets" / "practice-moments"
RIVE = str(Path.home() / ".rive" / "bin" / "rive")
FONT = "Geist-ExtraBold"

# name: artboard size, the view model's values (name: default; a string default makes a string), font, images.
PIECES: dict[str, dict] = {
    "stars": {"size": (440, 240), "values": {"stars": 3}, "font": False, "images": []},
    "streak": {"size": (360, 360), "values": {"days": 7}, "font": True, "images": []},
    "goal": {"size": (360, 380), "values": {"done": 5, "target": 5}, "font": True, "images": []},
    "combo": {"size": (460, 230), "values": {"run": 8, "perfect": 1}, "font": True, "images": []},
    "musicbox": {"size": (400, 440), "values": {"label": "Unit done!"}, "font": True, "images": []},
    "doh": {"size": (380, 420), "values": {}, "font": False, "images": ["doh-wave", "doh-cheer"]},
}


def period(name: str) -> float:
    """How long the piece plays, from its own `local PERIOD = …`."""
    m = re.search(r"^local PERIOD = ([\d.]+)", (HERE / f"{name}.luau").read_text(), re.M)
    assert m, name
    return float(m.group(1))


def scene(name: str, piece: dict) -> str:
    """The artboard, its view model (when it takes values) and its assets, as RML."""
    w, h = piece["size"]
    values = piece["values"]
    props, insts = [], []
    for i, (key, default) in enumerate(values.items()):
        pid = f"0:{45 + i}"
        if isinstance(default, str):
            props.append(f'        <ViewModelPropertyString name="{key}" id="{pid}"/>')
            insts.append(f'            <ViewModelInstanceString propertyValue="{default}" viewModelPropertyId="{pid}"/>')
        else:
            props.append(f'        <ViewModelPropertyNumber name="{key}" id="{pid}"/>')
            insts.append(f'            <ViewModelInstanceNumber propertyValue="{default}" viewModelPropertyId="{pid}"/>')
    bind = ' viewModelId="0:40" viewModelInstanceId="0:41"' if values else ""
    vm = ""
    if values:
        vm = ('    <ViewModel defaultInstanceId="0:41" name="Moment" id="0:40">\n' + "\n".join(props) + "\n"
              '        <ViewModelInstance exports="true" name="Instance" id="0:41">\n' + "\n".join(insts) + "\n"
              "        </ViewModelInstance>\n    </ViewModel>\n")
    assets = ['    <ScriptAsset file="main.luau" name="main" id="0:80"/>']
    if piece["font"]:
        assets.append(f'    <FontAsset file="{FONT}.ttf" name="{FONT}" id="0:30"/>')
    for i, image in enumerate(piece["images"]):
        assets.append(f'    <ImageAsset file="{image}.png" name="{image}" id="0:{60 + i}"/>')
    return f"""<Rive version="1" kind="fragment">
    <Artboard defaultStateMachineId="0:7"{bind} clip="true" width="{w}" height="{h}" styleId="0:5" name="{name}" id="0:2">
        <LayoutComponentStyle name="Artboard Style" id="0:5"/>
        <LayoutComponent width="{w}" height="{h}" styleId="0:11" name="Root Layout" id="0:10">
            <LayoutComponentStyle layoutWidthScaleType="1" layoutHeightScaleType="1" widthUnitsValue="3" heightUnitsValue="3" name="Layout Style" id="0:11"/>
            <ScriptedLayout scriptAssetId="0:80" name="Moment" id="0:12"/>
        </LayoutComponent>
        <StateMachine name="Play" id="0:7">
            <StateMachineLayer name="Layer 1" id="0:8">
                <AnyState x="200" y="-120"/>
                <ExitState x="400" y="-120"/>
                <EntryState/>
            </StateMachineLayer>
        </StateMachine>
    </Artboard>
{vm}{chr(10).join(assets)}
</Rive>
"""


def binding() -> str:
    """The `push:` block of design/rive/practice, which every piece is signed against (as live.py signs)."""
    yaml = (HERE.parent / "practice" / "rive.yaml").read_text()
    m = re.search(r"^push:\n(?:  .+\n)+", yaml, re.M)
    if not m:
        raise SystemExit("design/rive/practice is not bound to a Rive file: run `rive push` there first")
    return m.group(0)


def project(name: str) -> Path:
    piece = PIECES[name]
    d = BUILD / name
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    (d / "main.luau").write_text((HERE / "helpers.luau").read_text() + "\n" + (HERE / f"{name}.luau").read_text())
    (d / "scene.rml").write_text(scene(name, piece))
    (d / "rive.yaml").write_text(f"name: {name}\nmain: {name}\n{binding()}")
    if piece["font"]:
        shutil.copy(HERE / f"{FONT}.ttf", d)
    for image in piece["images"]:
        src = HERE / f"{image}.png"
        if not src.exists():
            raise SystemExit(f"{src.name} is missing: run `node design/rive/faces.mjs moments`")
        shutil.copy(src, d)
    return d


def run(args: list[str]) -> str:
    r = subprocess.run([RIVE, *args], capture_output=True, text=True)
    log = r.stdout + r.stderr
    if r.returncode != 0:
        errors = [line for line in log.splitlines() if " error " in line or "failed" in line]
        raise SystemExit("\n".join(errors[-12:]) or log[-1200:])
    return log


def verify(name: str) -> Path:
    d = project(name)
    run([str(d), "--verify"])
    problems = run(["inspect", str(d), "--summary"])
    if re.search(r'"severity":\s*"error"', problems):
        raise SystemExit(f"{name}: {problems[-800:]}")
    return d


def preview(name: str, out: Path, fps: int = 30) -> None:
    """A looping animated WebP of the piece as it plays, captured frame by frame by `rive --screenshot`."""
    from PIL import Image  # only the previews need it

    d = verify(name)
    frames = int(period(name) * fps)
    work = BUILD / "frames" / name
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    slots = 8

    def shoot(slot: int) -> None:
        copy = work / f"p{slot}"
        shutil.copytree(d, copy, ignore=shutil.ignore_patterns("build"))
        for i in range(slot, frames, slots):
            run([str(copy), f"--screenshot={work / f'f{i:04d}.png'}", f"--advance={i * 1000 // fps + 1}ms"])

    with ThreadPoolExecutor(slots) as pool:
        list(pool.map(shoot, range(slots)))
    images = [Image.open(f).convert("RGBA") for f in sorted(work.glob("f*.png"))]
    out.mkdir(parents=True, exist_ok=True)
    images[0].save(out / f"{name}.webp", save_all=True, append_images=images[1:], duration=1000 // fps, loop=0, quality=80)
    print(f"  {name}.webp {len(images)} frames")


def publish(name: str) -> None:
    d = verify(name)
    log = run([str(d), "--publish"])
    if "watermarked" in log:
        raise SystemExit(f"{name}: published watermarked; sign in with `rive login` as an account that can open the bound file")
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copy(d / "build" / f"{name}.riv", OUT / f"{name}.riv")
    print(f"  {name}.riv {(OUT / f'{name}.riv').stat().st_size // 1024} KB")


def main(argv: list[str]) -> None:
    if "--verify" in argv:
        for name in PIECES:
            verify(name)
            print(f"  {name} verified")
    elif "--preview" in argv:
        out = Path(argv[argv.index("--preview") + 1])
        for name in PIECES:
            preview(name, out)
    else:
        for name in PIECES:
            publish(name)


if __name__ == "__main__":
    main(sys.argv[1:])
