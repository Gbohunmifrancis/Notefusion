"""Regenerate the derived image assets from the mobile app's artwork.

    python assets/build-assets.py

Two outputs, both derived and both safe to delete and rebuild:

  app-home.jpg  the hero screenshot, resized to 3x its display size and
                re-encoded as JPEG. The source is a photographic screenshot,
                so PNG buys nothing but weight (1.1 MB -> 134 KB).
  og-card.jpg   the 1200x630 social share card. Link scrapers want a wide
                image; handing them the tall phone screenshot gets it cropped
                to nonsense.

Brand fidelity comes from mobile/src/design/theme.ts — the gradient is
gradients.brand and the type is Poppins. Keep them in step by hand.
"""

import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "../../mobile/node_modules/@expo-google-fonts/poppins")
SCREENSHOT = os.path.join(HERE, "../../mobile/assets/Notefusion-home.png")

BLUE_DEEP = (29, 78, 216)   # gradients.brand[0] — #1D4ED8
BLUE = (59, 130, 246)       # gradients.brand[1] — #3B82F6
BLUE_PALE = (191, 219, 254)
INK = (15, 23, 42)          # text — #0F172A


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def build_hero():
    """Hero screenshot at 3x its ~276px display width."""
    im = Image.open(SCREENSHOT).convert("RGB")
    target_w = 828
    target_h = round(im.height * target_w / im.width)
    out = os.path.join(HERE, "app-home.jpg")
    im.resize((target_w, target_h), Image.LANCZOS).save(
        out, "JPEG", quality=82, optimize=True, progressive=True
    )
    print(f"app-home.jpg  {os.path.getsize(out):>7,} bytes  {target_w}x{target_h}")


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

    # Soft white circle, echoing .african::after on the page.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([W - 260, -300, W + 380, 340], fill=(255, 255, 255, 20))
    card = Image.alpha_composite(card.convert("RGBA"), glow).convert("RGB")
    d = ImageDraw.Draw(card)

    # The mark ships as a white silhouette with alpha; tint it the way the app
    # does with tintColor, and the way theme.css does with a CSS mask.
    mark = Image.open(os.path.join(HERE, "mark.png")).convert("RGBA")
    mh = 92
    mark = mark.resize((round(mark.width * mh / mark.height), mh), Image.LANCZOS)
    tinted = Image.new("RGBA", mark.size, (255, 255, 255, 255))
    tinted.putalpha(mark.getchannel("A"))
    card.paste(tinted, (80, 74), tinted)

    d.text((80 + tinted.width + 24, 78), "Notefusion", font=font("600SemiBold/Poppins_600SemiBold.ttf", 40), fill=(255, 255, 255))
    d.text((80, 214), "Hear it. See it.", font=font("700Bold/Poppins_700Bold.ttf", 76), fill=(255, 255, 255))
    d.text((80, 300), "Notate it.", font=font("700Bold_Italic/Poppins_700Bold_Italic.ttf", 76), fill=BLUE_PALE)

    med = font("500Medium/Poppins_500Medium.ttf", 31)
    d.text((80, 424), "Record a chorus — get Tonic Solfa and staff", font=med, fill=(255, 255, 255))
    d.text((80, 468), "notation in seconds.", font=med, fill=(255, 255, 255))

    d.rounded_rectangle([80, 536, 660, 596], radius=14, fill=INK)
    d.text((104, 546), "d   r   m   f   s   l   t   d'", font=font("600SemiBold/Poppins_600SemiBold.ttf", 34), fill=(255, 255, 255))

    out = os.path.join(HERE, "og-card.jpg")
    card.save(out, "JPEG", quality=88, optimize=True, progressive=True)
    print(f"og-card.jpg   {os.path.getsize(out):>7,} bytes  {W}x{H}")


if __name__ == "__main__":
    build_hero()
    build_og_card()
