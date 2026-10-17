"""Regenerate the derived image assets from the mobile app's artwork.

    python tools/build-assets.py

All outputs are derived and safe to delete and rebuild:

  app-onboarding.jpg / app-splash.jpg
                the two hero devices, resized to ~3x their display width and
                re-encoded as JPEG. The sources are photographic renders, so
                PNG buys nothing but weight (1.1 MB each -> ~100 KB).
  app-onboarding-552.jpg / app-splash-552.jpg
                the same two at 2x, for the srcset. A 1x phone still downloads
                828px otherwise, which is most of the page weight on the
                connection this app is built for.
  og-card.jpg   the 1200x630 social share card. Link scrapers want a wide
                image; handing them a tall phone screenshot gets it cropped
                to nonsense.
  favicon.ico   16/32/48px, on an opaque blue tile. mark.png is a white
                silhouette with alpha, so used directly it is invisible in a
                light browser tab; the tile is what makes it show up.
  icon-192.png / icon-512.png / apple-touch-icon.png
                the same tile at the sizes Android home screens, the web
                manifest and iOS "Add to Home Screen" ask for.
  mark-mask.png the brand mark at 145x192 for the CSS masks (header, recorder,
                app logo): only its alpha matters, so it is a white palette PNG
                with exact alpha, ~8 KB instead of mark.png's 42 KB on every
                page. mark.png stays the full-size source (and the watermark).
  shot-sheet-{light,dark}-{640,960,1200}.{avif,webp}, -960.jpg
                the home page's web-app screenshots for phones first: the
                2400x1600 shot-sheet-*.jpg retakes are the source (and the 2x
                JPEG fallback); a phone gets a ~20 KB AVIF instead of 190 KB.

Both hero sources already have the black device frame rendered into them, so
the page must NOT wrap them in a bezel of its own — .device only rounds the
outer corners and applies the perspective. Feed this script a bare screen
capture and the hero will look frameless.

Brand fidelity comes from mobile/src/design/theme.ts — the gradient is
gradients.brand and the type is Poppins. Keep them in step by hand.
"""

import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
ASSETS = os.path.join(ROOT, "web-site/assets")
FONTS = os.path.join(ROOT, "mobile/node_modules/@expo-google-fonts/poppins")

# (source in mobile/assets, output stem). Order is front device first, purely so
# the printed sizes read in the order the page paints them.
HERO_SCREENS = (
    ("Notefusion-onboarding-1.png", "app-onboarding"),
    ("Notefusion-splash-screen.png", "app-splash"),
)

BLUE_DEEP = (29, 78, 216)   # gradients.brand[0] — #1D4ED8
BLUE = (59, 130, 246)       # gradients.brand[1] — #3B82F6
BLUE_PALE = (191, 219, 254)
INK = (15, 23, 42)          # text — #0F172A


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def build_hero():
    """The two hero devices, each at 3x its display width plus a 2x for srcset.

    Prints the exact pixel dimensions of every output: the <img> width/height
    attributes in index.html have to match, or the reserved layout box is wrong
    and the hero jumps as the images arrive.
    """
    for source, stem in HERO_SCREENS:
        im = Image.open(os.path.join(ROOT, "mobile/assets", source)).convert("RGB")
        for target_w, suffix in ((828, ""), (552, "-552")):
            target_h = round(im.height * target_w / im.width)
            name = f"{stem}{suffix}.jpg"
            out = os.path.join(ASSETS, name)
            im.resize((target_w, target_h), Image.LANCZOS).save(
                out, "JPEG", quality=82, optimize=True, progressive=True
            )
            print(f"{name:<24} {os.path.getsize(out):>7,} bytes  {target_w}x{target_h}")


def build_icon(px, mark_frac=0.68):
    """The brand mark on an opaque fusion tile, so it survives light tabs.

    mark.png is a white silhouette with alpha. Used directly (as it was) the
    silhouette is white-on-transparent: invisible against a light tab. The app
    tints it per surface; the closest web equivalent on a fixed tile is a solid
    gradient background, which is also what a dark favicon needs for the OS
    theme it sits in.
    """
    tile = Image.new("RGBA", (px, px))
    px_ = px
    # Linear gradient 135deg, blue-deep to blue, same as gradients.brand.
    for y in range(px_):
        for x in range(px_):
            t = (x / px_ + y / px_) / 2
            c = tuple(round(a + (b - a) * t) for a, b in zip(BLUE_DEEP, BLUE))
            tile.putpixel((x, y), (*c, 255))

    mark = Image.open(os.path.join(ASSETS, "mark.png")).convert("RGBA")
    mh = round(px_ * mark_frac)
    mark = mark.resize((round(mark.width * mh / mark.height), mh), Image.LANCZOS)
    mw = mark.width
    # Centre the mark. The mark ships with transparent margins, so centre it on
    # the whole tile; the visual whitespace will read correctly.
    pos = ((px_ - mw) // 2, (px_ - mh) // 2)
    tile.paste(mark, pos, mark)
    return tile


def build_favicons():
    # Pillow's ICO writer resizes *down* from the image you hand it, so the
    # source has to be the largest entry, not the smallest.
    build_icon(48).save(
        os.path.join(ASSETS, "favicon.ico"),
        sizes=[(16, 16), (32, 32), (48, 48)],
        format="ICO",
    )
    build_icon(192).save(os.path.join(ASSETS, "icon-192.png"), optimize=True)
    build_icon(512).save(os.path.join(ASSETS, "icon-512.png"), optimize=True)
    # iOS does not scale the PNG you give it; 180x180 is what it asks for.
    build_icon(180).save(os.path.join(ASSETS, "apple-touch-icon.png"), optimize=True)
    print(f"favicon.ico    {os.path.getsize(os.path.join(ASSETS, 'favicon.ico')):>7,} bytes  16/32/48")
    print(f"icon-192.png   {os.path.getsize(os.path.join(ASSETS, 'icon-192.png')):>7,} bytes  192x192")
    print(f"icon-512.png   {os.path.getsize(os.path.join(ASSETS, 'icon-512.png')):>7,} bytes  512x512")
    print(f"apple-touch-icon.png  {os.path.getsize(os.path.join(ASSETS, 'apple-touch-icon.png')):>7,} bytes  180x180")


def build_og_card():
    W, H = 1200, 630
    card = Image.new("RGB", (W, H))
    px = card.load()

    # 135deg linear gradient, stepped in 4px columns — imperceptible, ~4x faster.
    for y in range(H):
        for x in range(0, W, 4):
            t = (x / W + y / H) / 2
            c = tuple(round(a + (b - a) * t) for a, b in zip(BLUE_DEEP, BLUE))
            for dx in range(4):
                if x + dx < W:
                    px[x + dx, y] = c

    # Soft white circle, echoing .spotlight::after on the page.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([W - 260, -300, W + 380, 340], fill=(255, 255, 255, 20))
    card = Image.alpha_composite(card.convert("RGBA"), glow).convert("RGB")
    d = ImageDraw.Draw(card)

    # The mark ships as a white silhouette with alpha; tint it the way the app
    # does with tintColor, and the way theme.css does with a CSS mask.
    mark = Image.open(os.path.join(ASSETS, "mark.png")).convert("RGBA")
    mh = 92
    mark = mark.resize((round(mark.width * mh / mark.height), mh), Image.LANCZOS)
    tinted = Image.new("RGBA", mark.size, (255, 255, 255, 255))
    tinted.putalpha(mark.getchannel("A"))
    card.paste(tinted, (80, 74), tinted)

    d.text((80 + tinted.width + 24, 78), "Notefusion", font=font("600SemiBold/Poppins_600SemiBold.ttf", 40), fill=(255, 255, 255))
    d.text((80, 214), "Hear it. See it.", font=font("700Bold/Poppins_700Bold.ttf", 76), fill=(255, 255, 255))
    d.text((80, 300), "Notate it.", font=font("700Bold_Italic/Poppins_700Bold_Italic.ttf", 76), fill=BLUE_PALE)

    med = font("500Medium/Poppins_500Medium.ttf", 31)
    d.text((80, 424), "Record a chorus. Get Tonic Solfa and staff", font=med, fill=(255, 255, 255))
    d.text((80, 468), "notation in seconds.", font=med, fill=(255, 255, 255))

    d.rounded_rectangle([80, 536, 660, 596], radius=14, fill=INK)
    d.text((104, 546), "d   r   m   f   s   l   t   d'", font=font("600SemiBold/Poppins_600SemiBold.ttf", 34), fill=(255, 255, 255))

    out = os.path.join(ASSETS, "og-card.jpg")
    card.save(out, "JPEG", quality=88, optimize=True, progressive=True)
    print(f"og-card.jpg   {os.path.getsize(out):>7,} bytes  {W}x{H}")


def build_web_images():
    """The mark mask and the phone-first screenshot variants (see the module docstring)."""
    alpha = Image.open(os.path.join(ASSETS, "mark.png")).getchannel("A")
    h = 192
    small = alpha.resize((round(alpha.width * h / alpha.height), h), Image.LANCZOS).point(lambda v: 0 if v < 8 else v)
    mask = Image.frombytes("P", small.size, small.tobytes())
    mask.putpalette([255, 255, 255] * 256)
    out = os.path.join(ASSETS, "mark-mask.png")
    mask.save(out, "PNG", optimize=True, transparency=bytes(range(256)))
    print(f"mark-mask.png {os.path.getsize(out):>7,} bytes  {small.width}x{small.height}")
    for theme in ("light", "dark"):
        src = Image.open(os.path.join(ASSETS, f"shot-sheet-{theme}.jpg")).convert("RGB")
        for w in (640, 960, 1200):
            im = src.resize((w, round(src.height * w / src.width)), Image.LANCZOS)
            outs = [("avif", "AVIF", {"quality": 60, "speed": 4}), ("webp", "WEBP", {"quality": 78, "method": 6})]
            if w == 960:
                outs.append(("jpg", "JPEG", {"quality": 80, "optimize": True, "progressive": True}))
            for ext, fmt, kw in outs:
                name = f"shot-sheet-{theme}-{w}.{ext}"
                im.save(os.path.join(ASSETS, name), fmt, **kw)
                print(f"{name:<28} {os.path.getsize(os.path.join(ASSETS, name)):>7,} bytes  {im.width}x{im.height}")


if __name__ == "__main__":
    build_hero()
    build_favicons()
    build_og_card()
    build_web_images()
