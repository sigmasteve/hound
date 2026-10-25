#!/usr/bin/env python3
"""Turn raw phone screenshots into App Store screenshots with a caption.

  python3 frame.py                 # every raw/N.png and raw/ipad-N.png in listing.md's order
  python3 frame.py --only 2        # one of them

Each output is Apple's exact size (iPhone 6.9": 1320x2868, iPad 13":
2064x2752): the caption in Hound's purple on a soft background at the top,
the screenshot below it with rounded corners, scaled to fit. Needs Pillow.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
RAW = HERE / 'screenshots' / 'raw'
OUT = HERE / 'screenshots' / 'out'
SIZES = {'iphone': (1320, 2868), 'ipad': (2064, 2752)}
BG = (245, 243, 255)
ACCENT = (145, 132, 217)
TEXT = (28, 27, 46)


def captions() -> list[str]:
    rows = re.findall(r'^\| (\d) \| .*? \| (.+?) \|$', (HERE / 'listing.md').read_text(), re.M)
    return [c for _, c in sorted(rows, key=lambda r: int(r[0]))]


def font(size: int) -> ImageFont.FreeTypeFont:
    for name in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def rounded(im: Image.Image, radius: int) -> Image.Image:
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1], radius=radius, fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


def frame(raw: Path, caption: str, device: str, out: Path) -> None:
    W, H = SIZES[device]
    canvas = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(canvas)
    f = font(int(W * 0.056))
    # The caption, wrapped to the width, centred near the top.
    words, lines, line = caption.split(), [], ''
    for w in words:
        trial = f'{line} {w}'.strip()
        if draw.textlength(trial, font=f) > W * 0.86 and line:
            lines.append(line)
            line = w
        else:
            line = trial
    lines.append(line)
    y = int(H * 0.055)
    for ln in lines:
        draw.text(((W - draw.textlength(ln, font=f)) / 2, y), ln, fill=TEXT, font=f)
        y += int(f.size * 1.25)
    # A short accent bar under it.
    bar_w = int(W * 0.08)
    draw.rounded_rectangle([(W - bar_w) / 2, y + 10, (W + bar_w) / 2, y + 22], radius=6, fill=ACCENT)
    # The screenshot, scaled to the room left, with rounded corners and a soft shadow.
    top = y + int(H * 0.035)
    shot = Image.open(raw).convert('RGB')
    scale = min((W * 0.86) / shot.width, (H - top - int(H * 0.04)) / shot.height)
    shot = shot.resize((int(shot.width * scale), int(shot.height * scale)), Image.LANCZOS)
    r = int(shot.width * 0.075)
    x = (W - shot.width) // 2
    shadow = Image.new('RGBA', (shot.width + 80, shot.height + 80), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([40, 50, shot.width + 40, shot.height + 50], radius=r, fill=(90, 80, 140, 60))
    canvas.paste(shadow, (x - 40, top - 40), shadow)
    canvas.paste(rounded(shot, r), (x, top), rounded(shot, r))
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, 'PNG', optimize=True)
    print(f'{out.relative_to(HERE)}  {W}x{H}')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', type=int)
    args = ap.parse_args()
    caps = captions()
    for i, cap in enumerate(caps, 1):
        if args.only and args.only != i:
            continue
        for device, name in (('iphone', f'{i}.png'), ('ipad', f'ipad-{i}.png')):
            raw = RAW / name
            if raw.exists():
                frame(raw, cap, device, OUT / f'{device}-{i}.png')
            else:
                print(f'(no {raw.relative_to(HERE)})')


if __name__ == '__main__':
    main()
