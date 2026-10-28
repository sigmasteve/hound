#!/usr/bin/env python3
"""The Google Play graphics Apple doesn't ask for.

  python3 play-assets.py

Writes into out/:
  icon-512.png           the app icon at Play's 512x512
  feature-graphic.png    the 1024x500 banner shown at the top of the
                         listing: the paw badge, "Hound", "Fitness with
                         Friends" and the tagline, on the app's purple.
Phone screenshots come from ../app-store/frame.py (play-N.png). Needs
Pillow.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
MOBILE = HERE.parent.parent
OUT = HERE / 'out'
ACCENT = (145, 132, 217)
DEEP = (22, 24, 38)
CREAM = (245, 243, 255)


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    for name in (
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/System/Library/Fonts/Helvetica.ttc',
    ):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def icon() -> None:
    im = Image.open(MOBILE / 'assets' / 'icon.png').convert('RGB').resize((512, 512), Image.LANCZOS)
    im.save(OUT / 'icon-512.png')
    print('wrote out/icon-512.png')


def feature_graphic() -> None:
    W, H = 1024, 500
    im = Image.new('RGB', (W, H), DEEP)
    d = ImageDraw.Draw(im)
    # A soft purple glow behind the badge.
    glow = Image.new('RGB', (W, H), DEEP)
    gd = ImageDraw.Draw(glow)
    gd.ellipse((40, -120, 560, 620), fill=(60, 52, 110))
    im = Image.blend(im, glow, 0.55)
    d = ImageDraw.Draw(im)
    # The app icon as the badge, rounded.
    badge = Image.open(MOBILE / 'assets' / 'icon.png').convert('RGBA').resize((300, 300), Image.LANCZOS)
    mask = Image.new('L', badge.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 299, 299), radius=68, fill=255)
    im.paste(badge, (120, 100), mask)
    x = 480
    d.text((x, 150), 'Hound', font=font(92), fill=CREAM)
    d.text((x, 262), 'Fitness with Friends', font=font(42), fill=ACCENT)
    d.text((x, 330), 'Step races, games & trash talk,', font=font(27, bold=False), fill=(205, 203, 220))
    d.text((x, 366), 'with a hound that cheers you on.', font=font(27, bold=False), fill=(205, 203, 220))
    im.save(OUT / 'feature-graphic.png')
    print('wrote out/feature-graphic.png')


if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    icon()
    feature_graphic()
