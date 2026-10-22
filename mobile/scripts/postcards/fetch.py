#!/usr/bin/env python3
"""Fetch the Journey stop postcards from Wikipedia.

For every stop on every course (src/journeys/courses.ts), takes the lead
picture of a Wikipedia article about the place (ARTICLES below), keeps
it only under a free licence (CC0, public domain, CC BY, CC BY-SA),
crops it to the postcard's 1200×816, saves it as WebP under
assets/stops/<course>/<slug>.webp, and writes src/journeys/stopPictures.ts
with every picture and its credit line (the app shows the credit under
the picture). Stops with no usable picture are left out, so the app
shows its map for them, and listed at the end.

Usage:  python3 fetch.py [--only windy-city] [--force]
  --only   one course id
  --force  fetch again even if the file exists
Needs: pip install pillow. Be gentle: two seconds between requests,
and Wikimedia throttles shared addresses with 429s, so every request is
retried with a growing pause (and honours Retry-After) before giving up.

Hosts: en.wikipedia.org (which picture stands for an article),
commons.wikimedia.org (licence and credit), upload.wikimedia.org and
thumb.wikimedia.org (the pictures). Wikimedia only serves thumbnails at
its listed widths (960, 1280, 1920 among them), so pictures are asked
for at 1280, just over the postcard's 1200.
"""
from __future__ import annotations

import argparse
import html
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

UA = 'hound-postcards/0.1 (https://houndchallenge.net; hello@houndchallenge.net)'
HERE = Path(__file__).resolve().parent
MOBILE = HERE.parent.parent
ASSETS = MOBILE / 'assets' / 'stops'
OUT_TS = MOBILE / 'src' / 'journeys' / 'stopPictures.ts'
WIDTH, HEIGHT = 1200, 816
THUMB = 1280  # a width Wikimedia serves, the first above WIDTH
GAP = 2.0  # seconds between requests
RETRIES = 6  # on 429 or a 5xx: pauses of 10, 20, 40, 80, 160, 320 s

# Which article stands for each stop: the first with a free lead picture
# not already on another postcard of the course wins. A Commons file name
# ("File:…") can be given instead of an article.
ARTICLES: dict[str, dict[str, list[str]]] = {
    'golden-gate': {
        'San Francisco side': ['Crissy Field', 'Palace of Fine Arts', 'Fort Mason', 'Presidio of San Francisco'],
        'South tower': ['Fort Point, San Francisco', 'Golden Gate Bridge'],
        'Midspan': ['Golden Gate Bridge'],
        'North tower': ['Marin Headlands', 'Golden Gate Bridge'],
        'Vista Point': ['Golden Gate', 'Sausalito, California'],
    },
    'windy-city': {
        'Grant Park': ['Buckingham Fountain', 'Grant Park (Chicago)'],
        'Lincoln Park': ['Lincoln Park Zoo', 'Lincoln Park'],
        'Lakeview turnaround': ['Wrigley Field', 'Lakeview, Chicago'],
        'Halfway': ['Chicago River', 'Chicago Loop'],
        'United Center': ['United Center'],
        'Little Italy': ['Hull House', 'University of Illinois Chicago', 'Little Italy, Chicago', 'Taylor Street (Chicago)'],
        'Pilsen': ['Pilsen, Chicago', 'Lower West Side, Chicago'],
        'Chinatown': ['Chinatown, Chicago'],
        'Bronzeville': ['Victory Monument (Chicago)', 'Chicago Bee Building', 'Monument to the Great Northern Migration', 'Bronzeville, Chicago'],
        '“Mount Roosevelt”': ['Roosevelt Road', 'Museum Campus'],
        'Finish, Grant Park': ['Grant Park (Chicago)', 'Columbus Drive (Chicago)'],
    },
    'five-boroughs': {
        'Staten Island': ['Fort Wadsworth', 'Verrazzano-Narrows Bridge'],
        'Brooklyn': ['Bay Ridge, Brooklyn', 'Fourth Avenue (Brooklyn)'],
        'Atlantic Avenue': ['Barclays Center', 'Atlantic Avenue (New York City)'],
        'Williamsburg': ['Williamsburg, Brooklyn', 'Bedford Avenue'],
        'Halfway, into Queens': ['Pulaski Bridge', 'Long Island City'],
        'Queensboro Bridge': ['Queensboro Bridge'],
        'First Avenue': ['First Avenue (Manhattan)', 'Upper East Side'],
        'The Bronx': ['Willis Avenue Bridge', 'Mott Haven, Bronx'],
        'Harlem': ['Marcus Garvey Park', 'Harlem'],
        'Central Park': ['Central Park'],
        'Finish, Central Park': ['Tavern on the Green', 'Central Park'],
    },
    'thames': {
        'Greenwich Park': ['Royal Observatory, Greenwich', 'Greenwich Park'],
        'Woolwich': ['Royal Arsenal', 'Woolwich'],
        'Cutty Sark': ['Cutty Sark'],
        'Tower Bridge': ['Tower Bridge'],
        'Halfway': ['Wapping', 'Shadwell Basin'],
        'Canary Wharf': ['Canary Wharf'],
        'Tower of London': ['Tower of London'],
        'Big Ben': ['Big Ben', 'Palace of Westminster'],
        'Finish, The Mall': ['The Mall, London', 'Buckingham Palace'],
    },
    'death-valley': {
        'Badwater Basin': ['Badwater Basin'],
        'Furnace Creek': ['Furnace Creek, California'],
        'Stovepipe Wells': ['Mesquite Flat Sand Dunes', 'Stovepipe Wells, California'],
        'Towne Pass': ['Towne Pass', 'Panamint Range'],
        'Panamint Springs': ['Panamint Springs, California', 'Panamint Valley'],
        'Keeler': ['Keeler, California', 'Owens Lake'],
        'Lone Pine': ['Alabama Hills', 'Lone Pine, California'],
        'Whitney Portal': ['Whitney Portal', 'Mount Whitney'],
    },
    'appalachian': {
        'Springer Mountain': ['Springer Mountain'],
        'Fontana Dam': ['Fontana Dam'],
        'Clingmans Dome': ['Clingmans Dome'],
        'Damascus': ['Damascus, Virginia'],
        'McAfee Knob': ['McAfee Knob'],
        'Harpers Ferry': ['Harpers Ferry, West Virginia'],
        'Duncannon': ['Duncannon, Pennsylvania'],
        'Delaware Water Gap': ['Delaware Water Gap'],
        'Bear Mountain': ['Bear Mountain (Hudson Highlands)', 'Bear Mountain State Park'],
        'Mount Greylock': ['Mount Greylock'],
        'Hanover': ['Hanover, New Hampshire', 'Dartmouth College'],
        'Mount Washington': ['Mount Washington'],
        'Monson': ['Monson, Maine'],
        'Katahdin': ['Mount Katahdin'],
    },
    'route-66': {
        'Chicago': ['Art Institute of Chicago', 'Adams Street (Chicago)'],
        'Springfield, IL': ['Cozy Dog Drive In', 'Springfield, Illinois'],
        'St. Louis': ['Gateway Arch'],
        'Joplin': ['Joplin, Missouri'],
        'Tulsa': ['Blue Whale of Catoosa', 'Tulsa, Oklahoma'],
        'Oklahoma City': ['Round Barn (Arcadia, Oklahoma)', 'Oklahoma City'],
        'Amarillo': ['Cadillac Ranch'],
        'Albuquerque': ['Sandia Mountains', 'Albuquerque, New Mexico'],
        'Flagstaff': ['Flagstaff, Arizona'],
        'Kingman': ['Kingman, Arizona'],
        'Barstow': ['Barstow, California', 'Mojave Desert'],
        'Santa Monica Pier': ['Santa Monica Pier'],
    },
}

FREE = re.compile(r'^(cc0|public domain|pd|cc[- ]by(?:[- ]sa)?(?:[- ]\d(?:\.\d)?)?)', re.I)
_last = 0.0


def get(url: str) -> bytes:
    """GET with the gap between requests, retrying when Wikimedia throttles."""
    global _last
    pause = 10.0
    for attempt in range(RETRIES + 1):
        wait = _last + GAP - time.time()
        if wait > 0:
            time.sleep(wait)
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
            _last = time.time()
            return body
        except urllib.error.HTTPError as e:
            _last = time.time()
            if e.code not in (429, 500, 502, 503, 504) or attempt == RETRIES:
                raise
            retry_after = e.headers.get('Retry-After')
            delay = float(retry_after) if retry_after and retry_after.isdigit() else pause
            print(f'    HTTP {e.code} from {urllib.parse.urlsplit(url).netloc}; waiting {delay:.0f}s', file=sys.stderr)
            time.sleep(delay)
            pause *= 2
    raise RuntimeError('unreachable')


def get_json(url: str) -> dict:
    return json.loads(get(url))


def lead_file(article: str) -> str | None:
    """The file name of an article's lead picture, if any."""
    if article.startswith('File:'):
        return article
    url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode({
        'action': 'query', 'format': 'json', 'prop': 'pageimages', 'piprop': 'name', 'redirects': 1, 'titles': article,
    })
    try:
        pages = get_json(url).get('query', {}).get('pages', {})
        for p in pages.values():
            name = p.get('pageimage')
            if name:
                return 'File:' + name
        return None
    except urllib.error.HTTPError as e:
        if e.code != 429:
            raise
    # The action API is the first thing Wikimedia throttles; the REST
    # summary names the same picture (its original's URL ends in the file).
    url = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + urllib.parse.quote(article.replace(' ', '_'), safe='')
    src = get_json(url).get('originalimage', {}).get('source')
    if not src:
        return None
    return 'File:' + urllib.parse.unquote(src.split('/')[-1].split('?')[0]).replace('_', ' ')


def file_info(file: str) -> dict | None:
    """Licence, credit and a THUMB-wide URL for a file, from Commons or,
    for the few files kept on English Wikipedia itself, from there."""
    info = None
    for host in ('commons.wikimedia.org', 'en.wikipedia.org'):
        url = f'https://{host}/w/api.php?' + urllib.parse.urlencode({
            'action': 'query', 'format': 'json', 'prop': 'imageinfo', 'iiprop': 'url|extmetadata|size',
            'iiurlwidth': THUMB, 'titles': file,
        })
        pages = get_json(url).get('query', {}).get('pages', {})
        info = next(((p.get('imageinfo') or [None])[0] for p in pages.values()), None)
        if info:
            break
    if not info:
        return None
    meta = {k: v.get('value', '') for k, v in info.get('extmetadata', {}).items()}
    licence = meta.get('LicenseShortName') or meta.get('License') or ''
    artist = re.sub(r'<[^>]+>', '', html.unescape(meta.get('Artist') or meta.get('Credit') or '')).strip()
    return {
        'url': info.get('thumburl') or info.get('url'),
        'original': info.get('url'),
        'size': info.get('size', 0),
        'width': info.get('width', 0),
        'height': info.get('height', 0),
        'licence': licence,
        'artist': artist[:60],
        'page': info.get('descriptionurl'),
    }


def slug(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', name.lower().replace('“', '').replace('”', '')).strip('-')


def postcard(data: bytes) -> bytes:
    im = Image.open(io.BytesIO(data)).convert('RGB')
    # Crop to the postcard's shape around the middle, then fit.
    target = WIDTH / HEIGHT
    w, h = im.size
    if w / h > target:
        nw = int(h * target)
        im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = int(w / target)
        im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    im = im.resize((WIDTH, HEIGHT), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, 'WEBP', quality=80, method=6)
    return out.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only')
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()

    credits_path = ASSETS / 'credits.json'
    credits: dict[str, dict[str, dict]] = json.loads(credits_path.read_text()) if credits_path.exists() else {}
    missing: list[str] = []

    for course, stops in ARTICLES.items():
        if args.only and course != args.only:
            continue
        for stop, candidates in stops.items():
            out = ASSETS / course / f'{slug(stop)}.webp'
            if out.exists() and not args.force and credits.get(course, {}).get(stop):
                continue
            used = {c['source'] for s, c in credits.get(course, {}).items() if s != stop}
            picked = None
            for article in candidates:
                try:
                    file = lead_file(article)
                    if not file:
                        continue
                    if file in used:
                        print(f'  {course}/{stop}: {file} is already on another postcard; skipping', file=sys.stderr)
                        continue
                    info = file_info(file)
                    if not info or not info['url']:
                        continue
                    if not FREE.match(info['licence'].strip()):
                        print(f'  {course}/{stop}: {file} is {info["licence"]!r}, not free; skipping', file=sys.stderr)
                        continue
                    if info['width'] < 800:
                        print(f'  {course}/{stop}: {file} is only {info["width"]}px wide; skipping', file=sys.stderr)
                        continue
                    picked = (article, file, info)
                    break
                except Exception as e:  # noqa: BLE001
                    print(f'  {course}/{stop}: {article}: {e}', file=sys.stderr)
            if not picked:
                missing.append(f'{course}: {stop}')
                continue
            article, file, info = picked
            try:
                data = get(info['url'])
            except urllib.error.HTTPError as e:
                # A thumbnail Wikimedia won't make (HTTP 400): take the
                # original when it isn't huge.
                if e.code != 400 or not info['original'] or info['size'] > 20_000_000:
                    print(f'  {course}/{stop}: {file}: {e}', file=sys.stderr)
                    missing.append(f'{course}: {stop}')
                    continue
                data = get(info['original'])
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(postcard(data))
            licence = info['licence'].strip()
            by = f'{info["artist"]}, ' if info['artist'] and not licence.lower().startswith(('cc0', 'public')) else ''
            credits.setdefault(course, {})[stop] = {
                'file': out.relative_to(MOBILE).as_posix(),
                'credit': f'Photo: {by}{licence}, via Wikimedia Commons',
                'source': file,
                'page': info['page'],
                'article': article,
            }
            print(f'{course}/{stop}: {file} ({licence}, {out.stat().st_size // 1024} KB)')
            credits_path.write_text(json.dumps(credits, indent=2, ensure_ascii=False) + '\n')

    # The manifest the app reads (stopNotes.ts imports it).
    lines = [
        '// Generated by mobile/scripts/postcards/fetch.py from Wikipedia lead',
        '// pictures (assets/stops/credits.json has the sources). Do not edit by',
        '// hand; re-run the script. Each picture is under a free licence and',
        '// the app shows its credit line under it.',
        '',
        "import type { StopPicture } from './stopNotes';",
        '',
        'export const STOP_PICTURES: Record<string, Record<string, StopPicture>> = {',
    ]
    for course, stops in credits.items():
        lines.append(f"  '{course}': {{")
        for stop, c in stops.items():
            rel = '../../' + c['file']
            lines.append(f"    {json.dumps(stop, ensure_ascii=False)}: {{ source: require('{rel}'), credit: {json.dumps(c['credit'], ensure_ascii=False)} }},")
        lines.append('  },')
    lines.append('};')
    lines.append('')
    OUT_TS.write_text('\n'.join(lines))
    total = sum(len(s) for s in credits.values())
    print(f'wrote {OUT_TS.relative_to(MOBILE)} with {total} pictures')
    if missing:
        print('No free picture yet for:\n  ' + '\n  '.join(missing))


if __name__ == '__main__':
    main()
