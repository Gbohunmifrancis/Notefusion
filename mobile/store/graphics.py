"""Build the two Play Store graphics that are not screenshots.

    python mobile/store/graphics.py        # after: node mobile/store/render.mjs

  out/icon-512.png        512x512, 32-bit PNG with alpha, under 1024 KB. Play's
                          own limits. The source is the app icon itself, so the
                          listing tile and the launcher tile are the same
                          artwork — a store icon that differs from the installed
                          one reads as a different app.
  out/feature-graphic.png 1024x500, 24-bit PNG, no alpha. Play rejects alpha
                          here. Shown at the top of the listing and cropped
                          differently on different surfaces, so every word sits
                          inside a 60px margin and nothing but the card art
                          reaches an edge.

The feature graphic composites out/parts/solfa-card.png — the real Tonic Solfa
card, captured from the rendered screen by render.mjs. Run that first. Drawing a
lookalike by hand here would be a picture of notation the app never produced.

Brand values come from mobile/src/design/theme.ts, the same way tools/build-assets.py
takes them; the type is Poppins, as in the app.
"""

import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
OUT = os.path.join(HERE, "out")
PARTS = os.path.join(OUT, "parts")
FONTS = os.path.join(ROOT, "mobile/node_modules/@expo-google-fonts/poppins")

BLUE_DEEP = (29, 78, 216)   # gradients.brand[0] — #1D4ED8
BLUE = (59, 130, 246)       # gradients.brand[1] — #3B82F6
BLUE_PALE = (191, 219, 254)
WHITE = (255, 255, 255)

W, H = 1024, 500
MARGIN = 60          # nothing readable goes outside this, because Play crops
CARD_W = 430


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def build_icon():
    """The app icon at the size Play asks for.

    mobile/assets/icon.png is 1024x1024 and fully opaque, so this is only a
    resample — no tile to build, unlike the web favicons. Saved RGBA because
    Play's spec says 32-bit, even though every pixel here is opaque.
    """
    src = Image.open(os.path.join(ROOT, "mobile/assets/icon.png")).convert("RGBA")
    icon = src.resize((512, 512), Image.LANCZOS)
    out = os.path.join(OUT, "icon-512.png")
    icon.save(out, optimize=True)
    size = os.path.getsize(out)
    if size > 1024 * 1024:
        raise SystemExit(f"icon-512.png is {size:,} bytes; Play's limit is 1024 KB")
    print(f"icon-512.png        {size:>7,} bytes  512x512 RGBA")


def rounded(im, radius):
    """`im` with its corners cut out, as RGBA.

    The card capture is a rectangle of page, so its rounded corners arrive filled
    with the app's background colour. Against the gradient that reads as four
    pale notches, which is why this exists.
    """
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1], radius=radius, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def build_feature_graphic():
    card_src = os.path.join(PARTS, "solfa-card.png")
    if not os.path.exists(card_src):
        raise SystemExit("out/parts/solfa-card.png is missing — run node mobile/store/render.mjs first")

    card = Image.open(card_src).convert("RGB")
    card_h = round(card.height * CARD_W / card.width)
    card = card.resize((CARD_W, card_h), Image.LANCZOS)
    # 20dp of border-radius, captured at 3x and scaled by CARD_W/width.
    card = rounded(card, round(20 * 3 * CARD_W / 1140))

    canvas = Image.new("RGB", (W, H))
    px = canvas.load()
    # 135deg brand gradient, stepped in 4px columns as in tools/build-assets.py.
    for y in range(H):
        for x in range(0, W, 4):
            t = (x / W + y / H) / 2
            c = tuple(round(a + (b - a) * t) for a, b in zip(BLUE_DEEP, BLUE))
            for dx in range(4):
                if x + dx < W:
                    px[x + dx, y] = c

    # Spotlight. og-card draws this ellipse unblurred, which at 630px tall stays
    # subtle; across 500px it left a visible arc cutting the sky, so blur it well
    # past its own radius and it becomes the wash it was meant to be.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([W - 420, -300, W + 200, 320], fill=(255, 255, 255, 30))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(110)))

    # Drop shadow, so the card lifts off the gradient instead of floating on it.
    card_x = W - CARD_W - MARGIN
    card_y = (H - card_h) // 2
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [card_x + 6, card_y + 14, card_x + CARD_W + 6, card_y + card_h + 14], radius=26, fill=(11, 33, 92, 130)
    )
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(16)))
    canvas.paste(card, (card_x, card_y), card)

    canvas = canvas.convert("RGB")
    d = ImageDraw.Draw(canvas)
    col_right = card_x - 32          # the text column stops short of the card

    def line(x, y, text, f, fill):
        """Draw, having proved it lands inside the safe box.

        Play crops this image differently on different surfaces, so anything
        readable has to stay off the edges. A silent overflow here ships as
        clipped copy on a public listing, which is why this raises.
        """
        box = d.textbbox((x, y), text, font=f)
        if box[2] > col_right or box[0] < MARGIN or box[1] < MARGIN or box[3] > H - MARGIN:
            raise SystemExit(
                f'"{text}" occupies {box}; the safe box is '
                f"({MARGIN}, {MARGIN}) to ({col_right}, {H - MARGIN})"
            )
        d.text((x, y), text, font=f, fill=fill)

    # Wordmark. mark.png is a white silhouette with alpha — used as-is it is the
    # right colour for this background, unlike on the web's light tiles. The name
    # is spelled as app.json spells it: a store graphic that renames the app is a
    # different app as far as a shopper is concerned.
    #
    # The y values below centre the column on the card, which sits at the middle
    # of the canvas: the block runs 80..420, whose midpoint is H/2.
    mark = Image.open(os.path.join(ROOT, "web-site/assets/mark.png")).convert("RGBA")
    mh = 40
    mark = mark.resize((round(mark.width * mh / mark.height), mh), Image.LANCZOS)
    canvas.paste(mark, (MARGIN, 80), mark)
    line(MARGIN + mark.width + 18, 84, "NoteFusion", font("600SemiBold/Poppins_600SemiBold.ttf", 27), WHITE)

    line(MARGIN, 168, "Hear it. See it.", font("700Bold/Poppins_700Bold.ttf", 44), WHITE)
    line(MARGIN, 226, "Notate it.", font("700Bold_Italic/Poppins_700Bold_Italic.ttf", 44), BLUE_PALE)

    med = font("500Medium/Poppins_500Medium.ttf", 18)
    line(MARGIN, 308, "Tonic Solfa and staff notation,", med, WHITE)
    line(MARGIN, 333, "from a single take.", med, WHITE)

    # 5 is FreeTier.TrialGenerations. If that constant moves, this line is a
    # false claim on a public listing, so it is worth grepping for.
    pill_font = font("500Medium/Poppins_500Medium.ttf", 16)
    label = "5 free transcriptions to start"
    pill_w = round(d.textlength(label, font=pill_font)) + 40
    pill = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(pill).rounded_rectangle(
        [MARGIN, 376, MARGIN + pill_w, 420], radius=22,
        fill=(255, 255, 255, 38), outline=(255, 255, 255, 120), width=2,
    )
    canvas = Image.alpha_composite(canvas.convert("RGBA"), pill).convert("RGB")
    d = ImageDraw.Draw(canvas)
    line(MARGIN + 20, 388, label, pill_font, WHITE)

    out = os.path.join(OUT, "feature-graphic.png")
    canvas.save(out, optimize=True)
    print(f"feature-graphic.png {os.path.getsize(out):>7,} bytes  {W}x{H} RGB")


if __name__ == "__main__":
    build_icon()
    build_feature_graphic()
