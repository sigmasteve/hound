#!/usr/bin/env python3
"""Push the Google Play listing from listing.md to the Play Console.

  python3 gplay.py --check       # lengths against Google's limits, no network
  python3 gplay.py --show        # what the Console has now (en-US)
  python3 gplay.py --text        # name, short and full description
  python3 gplay.py --graphics    # icon, feature graphic and phone screenshots

Needs the service account key for Hound's Play Console in the
environment: GPLAY_SERVICE_ACCOUNT_JSON, either the path to the key file
or the JSON itself. Never put the key in the repo or in a chat. Setting
it up (once):
  1. Google Cloud Console, the project with Hound's OAuth clients: APIs &
     Services → Library → enable "Google Play Android Developer API".
  2. IAM & Admin → Service accounts → Create ("hound-play-publisher"), no
     roles needed; then Keys → Add key → JSON. Download it.
  3. Play Console → Users and permissions → Invite new user → the service
     account's email; under App permissions pick Hound and grant "Edit
     and delete draft apps", "Release to testing tracks" and "Manage
     store presence". Save; it can take a few minutes to take effect.
The same key works for `eas submit --platform android`.

Text and graphics go into one "edit" that is committed at the end, so
either everything lands or nothing does. Also needs
`pip install pyjwt cryptography requests`.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
STORE = HERE.parent
PACKAGE = 'app.hound.mobile'
LOCALE = 'en-US'
LIMITS = {'title': 30, 'shortDescription': 80, 'fullDescription': 4000}
API = f'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}'
UPLOAD = f'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PACKAGE}'


def listing() -> dict[str, str]:
    md = (HERE / 'listing.md').read_text()

    def section(title: str) -> str:
        m = re.search(r'^### ' + re.escape(title) + r'.*?\n\n(.*?)(?=\n###|\n## )', md, re.S | re.M)
        if not m:
            sys.exit(f'listing.md has no section "{title}"')
        return m.group(1).strip()

    name = re.search(r'\*\*App name\*\* \(30\): `(.+?)`', md)
    if not name:
        sys.exit('listing.md has no app name')
    return {
        'title': name.group(1),
        'shortDescription': section('Short description'),
        'fullDescription': section('Full description'),
    }


def check_text() -> int:
    bad = 0
    for key, value in listing().items():
        n, limit = len(value), LIMITS[key]
        print(f'{key:17} {n:5} / {limit:<5} {"ok" if n <= limit else "TOO LONG"}')
        bad += n > limit
    return 1 if bad else 0


def check_graphics() -> int:
    graphics = HERE / 'out'
    missing = 0
    for name in ('icon-512.png', 'feature-graphic.png'):
        present = (graphics / name).exists()
        missing += not present
        print(f'{name:28} {"present" if present else "missing (run play-assets.py)"}')
    shots = sorted((STORE / 'app-store' / 'screenshots' / 'out').glob('play-*.png'))
    print(f'phone screenshots            {len(shots)} (Play needs 2 to 8)')
    return 1 if missing or len(shots) < 2 else 0


def check() -> int:
    return check_text() | check_graphics()


def access_token() -> str:
    import jwt
    import requests

    raw = os.environ.get('GPLAY_SERVICE_ACCOUNT_JSON')
    if not raw:
        sys.exit('Set GPLAY_SERVICE_ACCOUNT_JSON to the service account key (path or JSON). See the top of this file.')
    key = json.loads(Path(raw).read_text() if not raw.lstrip().startswith('{') else raw)
    now = int(time.time())
    assertion = jwt.encode(
        {
            'iss': key['client_email'],
            'scope': 'https://www.googleapis.com/auth/androidpublisher',
            'aud': key['token_uri'],
            'iat': now,
            'exp': now + 3600,
        },
        key['private_key'],
        algorithm='RS256',
    )
    r = requests.post(key['token_uri'], data={'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': assertion}, timeout=30)
    if r.status_code != 200:
        sys.exit(f'Token: HTTP {r.status_code}: {r.text[:300]}')
    return r.json()['access_token']


class Play:
    def __init__(self) -> None:
        import requests

        self.s = requests.Session()
        self.s.headers['Authorization'] = f'Bearer {access_token()}'
        self.edit: str | None = None

    def call(self, method: str, url: str, **kw):
        r = self.s.request(method, url, timeout=120, **kw)
        if r.status_code >= 300:
            sys.exit(f'{method} {url.replace(API, "").replace(UPLOAD, "")}: HTTP {r.status_code}: {r.text[:400]}')
        return r.json() if r.text else {}

    def begin(self) -> str:
        self.edit = self.call('POST', f'{API}/edits')['id']
        return self.edit

    def commit(self) -> None:
        self.call('POST', f'{API}/edits/{self.edit}:commit')
        print('committed')

    def show(self) -> None:
        self.begin()
        got = self.call('GET', f'{API}/edits/{self.edit}/listings/{LOCALE}')
        for key in ('title', 'shortDescription', 'fullDescription'):
            value = got.get(key, '')
            print(f'--- {key} ({len(value)})\n{value}\n')
        for kind in ('icon', 'featureGraphic', 'phoneScreenshots'):
            imgs = self.call('GET', f'{API}/edits/{self.edit}/listings/{LOCALE}/{kind}').get('images', [])
            print(f'{kind}: {len(imgs)}')
        self.call('DELETE', f'{API}/edits/{self.edit}')

    def text(self) -> None:
        body = {'language': LOCALE, **listing()}
        self.call('PUT', f'{API}/edits/{self.edit}/listings/{LOCALE}', json=body)
        print('listing text set')

    def graphics(self) -> None:
        def upload(kind: str, path: Path) -> None:
            with path.open('rb') as f:
                self.call('POST', f'{UPLOAD}/edits/{self.edit}/listings/{LOCALE}/{kind}?uploadType=media', data=f, headers={'Content-Type': 'image/png'})
            print(f'  {kind}: {path.name}')

        out = HERE / 'out'
        for kind, name in (('icon', 'icon-512.png'), ('featureGraphic', 'feature-graphic.png')):
            if not (out / name).exists():
                sys.exit(f'{name} is missing; run play-assets.py')
            self.call('DELETE', f'{API}/edits/{self.edit}/listings/{LOCALE}/{kind}')
            upload(kind, out / name)
        shots = sorted((STORE / 'app-store' / 'screenshots' / 'out').glob('play-*.png'), key=lambda p: int(re.search(r'(\d+)', p.stem).group(1)))
        if len(shots) < 2:
            sys.exit('Fewer than two phone screenshots; run ../app-store/frame.py')
        self.call('DELETE', f'{API}/edits/{self.edit}/listings/{LOCALE}/phoneScreenshots')
        for p in shots:
            upload('phoneScreenshots', p)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--show', action='store_true')
    ap.add_argument('--text', action='store_true')
    ap.add_argument('--graphics', action='store_true')
    args = ap.parse_args()
    if args.check:
        return check()
    if args.show:
        Play().show()
        return 0
    if args.text or args.graphics:
        if args.text and check_text() != 0:
            return 1
        if args.graphics and check_graphics() != 0:
            return 1
        play = Play()
        play.begin()
        if args.text:
            play.text()
        if args.graphics:
            play.graphics()
        play.commit()
        return 0
    ap.print_help()
    return 0


if __name__ == '__main__':
    sys.exit(main())
