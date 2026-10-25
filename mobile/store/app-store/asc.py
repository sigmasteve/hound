#!/usr/bin/env python3
"""Push listing.md and the framed screenshots to App Store Connect.

  python3 asc.py --check            # lengths only, no network
  python3 asc.py --show             # what App Store Connect has now
  python3 asc.py --text             # name, subtitle, URLs, description, keywords, promo, what's new
  python3 asc.py --screenshots      # upload screenshots/out/*.png, replacing each display's set
  python3 asc.py --text --screenshots

Needs ASC_ISSUER_ID, ASC_KEY_ID and ASC_PRIVATE_KEY (the .p8's contents)
in the environment, and `pip install pyjwt cryptography requests`. The
key needs the App Manager role. Text goes to the app's en-US
localizations: the app-level one (name, subtitle, privacy URL) and the
one on the newest version that is still editable (everything else).
Never prints the key.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUNDLE_ID = 'app.hound.mobile'
LOCALE = 'en-US'
API = 'https://api.appstoreconnect.apple.com/v1'
EDITABLE = {'PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'WAITING_FOR_REVIEW', 'INVALID_BINARY'}
DISPLAY = {'iphone': 'APP_IPHONE_67', 'ipad': 'APP_IPAD_PRO_3GEN_129'}
LIMITS = {'name': 30, 'subtitle': 30, 'promotionalText': 170, 'description': 4000, 'keywords': 100, 'whatsNew': 4000}


def listing() -> dict[str, str]:
    s = (HERE / 'listing.md').read_text()

    def section(title: str) -> str:
        m = re.search(r'^### ' + re.escape(title) + r'[^\n]*\n(.*?)(?=^### |^## )', s, re.S | re.M)
        if not m:
            sys.exit(f'listing.md: no section "{title}"')
        return m.group(1).strip()

    def field(label: str) -> str:
        m = re.search(r'\*\*' + re.escape(label) + r'\*\* \(\d+\): `(.+?)`', s)
        if not m:
            sys.exit(f'listing.md: no field "{label}"')
        return m.group(1)

    def url(label: str) -> str:
        m = re.search(r'\*\*' + re.escape(label) + r':\*\* (\S+)', s)
        return m.group(1) if m else ''

    return {
        'name': field('Name'),
        'subtitle': field('Subtitle'),
        'privacyPolicyUrl': url('Privacy policy URL'),
        'supportUrl': url('Support URL'),
        'marketingUrl': url('Marketing URL'),
        'promotionalText': section('Promotional text'),
        'description': section('Description'),
        'keywords': section('Keywords'),
        'whatsNew': section("What's New"),
    }


def check(text: dict[str, str]) -> bool:
    ok = True
    for k, limit in LIMITS.items():
        n = len(text[k])
        flag = 'ok' if n <= limit else 'TOO LONG'
        ok &= n <= limit
        print(f'{k:16} {n:5} / {limit}  {flag}')
    return ok


# ── API ──────────────────────────────────────────────────────────────

def token() -> str:
    import jwt  # pyjwt

    issuer, kid, key = os.environ.get('ASC_ISSUER_ID'), os.environ.get('ASC_KEY_ID'), os.environ.get('ASC_PRIVATE_KEY')
    if not (issuer and kid and key):
        sys.exit('Set ASC_ISSUER_ID, ASC_KEY_ID and ASC_PRIVATE_KEY in the environment.')
    key = key.replace('\\n', '\n')
    now = int(time.time())
    return jwt.encode({'iss': issuer, 'iat': now, 'exp': now + 15 * 60, 'aud': 'appstoreconnect-v1'}, key, algorithm='ES256', headers={'kid': kid})


class Client:
    def __init__(self) -> None:
        import requests

        self.s = requests.Session()
        self.s.headers['Authorization'] = f'Bearer {token()}'

    def call(self, method: str, path: str, **kw):
        r = self.s.request(method, path if path.startswith('http') else API + path, timeout=60, **kw)
        if r.status_code >= 400:
            sys.exit(f'{method} {path} -> {r.status_code}\n{r.text[:800]}')
        return r.json() if r.content else {}

    def get(self, path, **params):
        return self.call('GET', path, params=params)

    def patch(self, path, attributes):
        return self.call('PATCH', path, json={'data': {'type': path.split('/')[1], 'id': path.split('/')[2], 'attributes': attributes}})


def app_id(c: Client) -> str:
    apps = c.get('/apps', **{'filter[bundleId]': BUNDLE_ID})['data']
    if not apps:
        sys.exit(f'No app with bundle id {BUNDLE_ID} visible to this key.')
    return apps[0]['id']


def app_info_localization(c: Client, app: str) -> dict:
    infos = c.get(f'/apps/{app}/appInfos')['data']
    for info in infos:
        for loc in c.get(f'/appInfos/{info["id"]}/appInfoLocalizations')['data']:
            if loc['attributes']['locale'] == LOCALE:
                return loc
    sys.exit(f'No {LOCALE} app info localization.')


def editable_version(c: Client, app: str) -> dict:
    versions = c.get(f'/apps/{app}/appStoreVersions', **{'filter[platform]': 'IOS', 'limit': 10})['data']
    for v in versions:
        if v['attributes']['appStoreState'] in EDITABLE:
            return v
    states = ', '.join(f"{v['attributes']['versionString']} ({v['attributes']['appStoreState']})" for v in versions)
    sys.exit(f'No editable version. Versions: {states}')


def version_localization(c: Client, version: str) -> dict:
    for loc in c.get(f'/appStoreVersions/{version}/appStoreVersionLocalizations')['data']:
        if loc['attributes']['locale'] == LOCALE:
            return loc
    sys.exit(f'No {LOCALE} version localization.')


def show(c: Client) -> None:
    app = app_id(c)
    info = app_info_localization(c, app)
    v = editable_version(c, app)
    loc = version_localization(c, v['id'])
    print(f"App {app} · version {v['attributes']['versionString']} ({v['attributes']['appStoreState']})")
    for k in ('name', 'subtitle', 'privacyPolicyUrl'):
        print(f'  {k}: {info["attributes"].get(k)!r}')
    for k in ('promotionalText', 'keywords', 'supportUrl', 'marketingUrl', 'whatsNew'):
        print(f'  {k}: {loc["attributes"].get(k)!r}')
    d = loc['attributes'].get('description') or ''
    print(f'  description: {len(d)} chars')
    for st in c.get(f'/appStoreVersionLocalizations/{loc["id"]}/appScreenshotSets')['data']:
        shots = c.get(f'/appScreenshotSets/{st["id"]}/appScreenshots')['data']
        print(f'  screenshots {st["attributes"]["screenshotDisplayType"]}: {len(shots)}')


def push_text(c: Client, text: dict[str, str]) -> None:
    app = app_id(c)
    info = app_info_localization(c, app)
    c.patch(f'/appInfoLocalizations/{info["id"]}', {k: text[k] for k in ('name', 'subtitle', 'privacyPolicyUrl')})
    print('app info: name, subtitle, privacy URL')
    v = editable_version(c, app)
    loc = version_localization(c, v['id'])
    c.patch(f'/appStoreVersionLocalizations/{loc["id"]}', {k: text[k] for k in ('description', 'keywords', 'promotionalText', 'whatsNew', 'supportUrl', 'marketingUrl')})
    print(f"version {v['attributes']['versionString']}: description, keywords, promo, what's new, URLs")


def push_screenshots(c: Client) -> None:
    app = app_id(c)
    v = editable_version(c, app)
    loc = version_localization(c, v['id'])
    sets = {s['attributes']['screenshotDisplayType']: s for s in c.get(f'/appStoreVersionLocalizations/{loc["id"]}/appScreenshotSets')['data']}
    for device, display in DISPLAY.items():
        files = sorted((HERE / 'screenshots' / 'out').glob(f'{device}-*.png'), key=lambda p: int(p.stem.split('-')[1]))
        if not files:
            print(f'{device}: nothing in screenshots/out, skipped')
            continue
        st = sets.get(display)
        if st:
            for old in c.get(f'/appScreenshotSets/{st["id"]}/appScreenshots')['data']:
                c.call('DELETE', f'/appScreenshots/{old["id"]}')
        else:
            st = c.call('POST', '/appScreenshotSets', json={'data': {'type': 'appScreenshotSets', 'attributes': {'screenshotDisplayType': display},
                'relationships': {'appStoreVersionLocalization': {'data': {'type': 'appStoreVersionLocalizations', 'id': loc['id']}}}}})['data']
        for f in files:
            data = f.read_bytes()
            shot = c.call('POST', '/appScreenshots', json={'data': {'type': 'appScreenshots', 'attributes': {'fileName': f.name, 'fileSize': len(data)},
                'relationships': {'appScreenshotSet': {'data': {'type': 'appScreenshotSets', 'id': st['id']}}}}})['data']
            for op in shot['attributes']['uploadOperations']:
                chunk = data[op['offset']:op['offset'] + op['length']]
                headers = {h['name']: h['value'] for h in op['requestHeaders']}
                import requests
                r = requests.request(op['method'], op['url'], data=chunk, headers=headers, timeout=120)
                if r.status_code >= 400:
                    sys.exit(f'upload {f.name}: {r.status_code} {r.text[:300]}')
            c.patch(f'/appScreenshots/{shot["id"]}', {'uploaded': True, 'sourceFileChecksum': hashlib.md5(data).hexdigest()})
            print(f'{display}: {f.name}')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--show', action='store_true')
    ap.add_argument('--text', action='store_true')
    ap.add_argument('--screenshots', action='store_true')
    args = ap.parse_args()
    text = listing()
    if not check(text):
        sys.exit('Fix the lengths in listing.md first.')
    if args.check or not (args.show or args.text or args.screenshots):
        return
    c = Client()
    if args.show:
        show(c)
    if args.text:
        push_text(c, text)
    if args.screenshots:
        push_screenshots(c)


if __name__ == '__main__':
    main()
