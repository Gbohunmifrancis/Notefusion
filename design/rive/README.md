# Practice art in 3D (Rive)

`practice/` is a [Rive CLI](https://rive.app/docs/cli/getting-started) project: `emblem.luau` + `coin.wgsl` draw a level
emblem on a bevelled 3D coin (sways at rest, spins on a level-up); `sticker.luau` + `puff.wgsl` light a sticker (flame,
freeze, stars, badges) through a normal map inflated from its outline (floats at rest, pops when earned). Its faces come
from `design/practice-art`, so the 3D always wears the 2D art.

```bash
curl -fsSL https://releases.rive.app/cli/install.sh | sh   # once; Linux needs libEGL, libGLESv2, libX11
node design/rive/faces.mjs        # faces + normal maps from design/practice-art (after changing that art)
python3 design/rive/stills.py     # the transparent WebP stills the apps show (web + phone + art/stills.ts)
rive login                        # once per machine: signing needs the account the project is bound to
python3 design/rive/live.py       # the signed live moments, web-site/assets/practice-3d/*.riv
rive design/rive/practice         # preview window (main: emblem in rive.yaml; set main: sticker for the stickers)
```

`practice/rive.yaml`'s `push:` binds the project to the "NoteFusion Practice 3D" file, so `live.py`'s signed files carry
no watermark; `rive push design/rive/practice` sends edits there for the Rive editor.
