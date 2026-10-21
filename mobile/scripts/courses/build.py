#!/usr/bin/env python3
"""Build the Journey course shapes from OpenStreetMap.

Writes mobile/src/journeys/courseGeometry.ts: for each course, its path
(the line you walk), water (polygons to shade) and rivers (lines to
draw), simplified to a few hundred points so the app stays small. The
stops, lengths and names stay in courses.ts.

Sources (all OpenStreetMap data, ODbL):
  - OSRM (router.project-osrm.org) routes the road and street courses
    between hand-picked waypoints, so each line follows real streets.
  - The OSM API (api.openstreetmap.org/api/0.6) gives the Appalachian
    Trail's route relation, way by way.
  - Nominatim gives water bodies, rivers and islands as geometry.
  Overpass would do the lot in one go but its public servers refuse
  this build environment, so it isn't used.

Usage:  python3 build.py [--cache DIR] [--out FILE] [--svg DIR]
  --cache  where HTTP responses are kept (default: .cache here)
  --svg    also write one preview SVG per course, drawn the way
           JourneyMap draws them, for checking by eye.
Needs: pip install shapely. Be gentle: Nominatim allows ~1 request/s.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from shapely.geometry import (GeometryCollection, LineString, MultiLineString, MultiPolygon, Polygon, box, shape)
from shapely.ops import linemerge, unary_union

UA = 'hound-courses-build/0.1 (https://houndchallenge.net)'
HERE = Path(__file__).resolve().parent
ARGS = None
_last_nominatim = 0.0
DEBUG_WAYPOINTS: list[tuple[float, float]] = []


# ── HTTP with a cache ───────────────────────────────────────────────

def fetch(url: str, data: bytes | None = None, min_gap: float = 0.0) -> bytes:
    global _last_nominatim
    key = hashlib.sha1((url + (data or b'').decode('utf-8', 'replace')).encode()).hexdigest()
    cache = Path(ARGS.cache) / (key + '.bin')
    if cache.exists():
        return cache.read_bytes()
    if min_gap:
        wait = _last_nominatim + min_gap - time.time()
        if wait > 0:
            time.sleep(wait)
    req = urllib.request.Request(url, data=data, headers={'User-Agent': UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                body = r.read()
            break
        except urllib.error.HTTPError as e:
            if e.code == 400 and 'osrm' in url:
                return e.read()  # a JSON error, reported by the caller
            raise
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f'  retry {attempt + 1} after {e}: {url[:90]}', file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    if min_gap:
        _last_nominatim = time.time()
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(body)
    return body


def nominatim(query: str | None = None, osm_id: str | None = None, threshold: float = 0.0003):
    """A Nominatim result's geometry, as a shapely shape (lng, lat)."""
    if osm_id:
        url = ('https://nominatim.openstreetmap.org/lookup?format=json&polygon_geojson=1'
               f'&polygon_threshold={threshold}&osm_ids={osm_id}')
    else:
        url = ('https://nominatim.openstreetmap.org/search?format=json&limit=1&polygon_geojson=1'
               f'&polygon_threshold={threshold}&q={urllib.parse.quote(query)}')
    rows = json.loads(fetch(url, min_gap=1.5))
    if not rows:
        raise SystemExit(f'Nominatim found nothing for {query or osm_id}')
    r = rows[0]
    print(f'  nominatim {query or osm_id}: {r["osm_type"]} {r["osm_id"]} {r["display_name"][:50]}')
    return shape(r['geojson'])


def on_street(name: str, near: tuple[float, float], area: tuple[float, float, float, float]) -> tuple[float, float]:
    """The point (lat, lng) on the named street closest to a rough guess, so
    a waypoint lands on the street meant and not a lane beside it."""
    url = ('https://nominatim.openstreetmap.org/search?format=json&limit=10&polygon_geojson=1'
           f'&bounded=1&viewbox={area[1]},{area[0]},{area[3]},{area[2]}&q={urllib.parse.quote(name)}')
    rows = [r for r in json.loads(fetch(url, min_gap=1.5)) if r.get('class') == 'highway']
    if not rows:
        print(f'    WARNING no street {name!r}; using the guess {near}')
        return near
    from shapely.geometry import Point
    pt = Point(near[1], near[0])
    best = min((shape(r['geojson']) for r in rows), key=lambda g: g.distance(pt))
    p = best.interpolate(best.project(pt))
    off = miles(LineString([(near[1], near[0]), (p.x, p.y)]))
    if off > 0.25:
        print(f'    WARNING {name!r} is {off:.2f} mi from the guess {near}')
    return (round(p.y, 5), round(p.x, 5))


def osrm(profile: str, waypoints: list[tuple[float, float]], radius: float | None = None,
         bearings: list[tuple[int, int] | None] | None = None) -> LineString:
    """The route through the waypoints (lat, lng), as a line in (lng, lat).
    radius (m) limits how far a waypoint may snap, so a badly placed one
    fails loudly instead of routing somewhere odd."""
    coords = ';'.join(f'{lng},{lat}' for lat, lng in waypoints)
    url = f'https://router.project-osrm.org/route/v1/{profile}/{coords}?overview=full&geometries=geojson'
    if radius:
        url += '&radiuses=' + ';'.join([str(radius)] * len(waypoints))
    if bearings:
        url += '&bearings=' + ';'.join(f'{b[0]},{b[1]}' if b else '' for b in bearings)
    d = json.loads(fetch(url))
    if d.get('code') != 'Ok':
        import re
        m = re.search(r'coordinate (\d+)', d.get('message', ''))
        at = f' (waypoint {m.group(1)} = {waypoints[int(m.group(1))]})' if m else ''
        raise SystemExit(f'OSRM {profile}: {d.get("code")} {d.get("message")}{at}')
    route = d['routes'][0]
    flags = []
    for i, leg in enumerate(route['legs']):
        straight = miles(LineString([(waypoints[i][1], waypoints[i][0]), (waypoints[i + 1][1], waypoints[i + 1][0])]))
        got = leg['distance'] / 1609.344
        if got > straight * 1.5 + 0.15:
            flags.append(f'leg {i} {waypoints[i]}->{waypoints[i + 1]}: {got:.1f} mi for {straight:.1f} straight')
    straight_total = sum(miles(LineString([(a[1], a[0]), (b[1], b[0])])) for a, b in zip(waypoints, waypoints[1:]))
    print(f'  osrm {profile}: {route["distance"] / 1609.344:.1f} mi ({straight_total:.1f} straight), {len(route["geometry"]["coordinates"])} pts')
    for f in flags:
        print('    DETOUR ' + f)
    DEBUG_WAYPOINTS.extend(waypoints)
    return LineString(route['geometry']['coordinates'])


def bridge_line(name: str, toward: tuple[float, float]) -> LineString:
    """A straight bridge's centreline, from its outline in OSM, running
    toward the given (lat, lng) end."""
    outline = nominatim(name)
    rect = list(outline.minimum_rotated_rectangle.exterior.coords)[:4]
    sides = [(rect[i], rect[(i + 1) % 4]) for i in range(4)]
    short = sorted(sides, key=lambda ab: (ab[0][0] - ab[1][0]) ** 2 + (ab[0][1] - ab[1][1]) ** 2)[:2]
    ends = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in short]
    ends.sort(key=lambda e: (e[0] - toward[1]) ** 2 + (e[1] - toward[0]) ** 2, reverse=True)
    return LineString(ends)


def osm_relation_ways(rel_id: int) -> list[LineString]:
    """A route relation (and its member relations) stitched into one line."""
    root = ET.fromstring(fetch(f'https://api.openstreetmap.org/api/0.6/relation/{rel_id}'))
    members = [(m.get('type'), int(m.get('ref'))) for m in root.iter('member')]
    lines = []
    for mtype, ref in members:
        if mtype == 'relation':
            lines.extend(_relation_ways(ref))
    if not lines:
        lines = _relation_ways(rel_id)
    return lines


def _relation_ways(rel_id: int) -> list[LineString]:
    root = ET.fromstring(fetch(f'https://api.openstreetmap.org/api/0.6/relation/{rel_id}/full'))
    nodes = {int(n.get('id')): (float(n.get('lon')), float(n.get('lat'))) for n in root.iter('node')}
    roles = {int(m.get('ref')): m.get('role') for m in root.iter('member') if m.get('type') == 'way'}
    out = []
    skipped = set()
    for w in root.iter('way'):
        role = roles.get(int(w.get('id')), '')
        if role not in ('', 'main', 'forward', 'backward'):
            skipped.add(role)
            continue
        pts = [nodes[int(nd.get('ref'))] for nd in w.iter('nd') if int(nd.get('ref')) in nodes]
        if len(pts) > 1:
            out.append(LineString(pts))
    print(f'  relation {rel_id}: {len(out)} ways' + (f', skipped roles {sorted(skipped)}' if skipped else ''))
    return out


def map_ways(minx: float, miny: float, maxx: float, maxy: float) -> dict[int, tuple[dict, list[tuple[float, float]], list[int]]]:
    """Every way in a box with its tags and coordinates, from OSM map tiles
    (a tile too full for the API is split in four)."""
    ways: dict[int, tuple[dict, list[tuple[float, float]], list[int]]] = {}

    def tile(x0, y0, x1, y1):
        url = f'https://api.openstreetmap.org/api/0.6/map?bbox={x0:.4f},{y0:.4f},{x1:.4f},{y1:.4f}'
        try:
            body = fetch(url)
        except urllib.error.HTTPError as e:
            if e.code != 400:
                raise
            mx, my = (x0 + x1) / 2, (y0 + y1) / 2
            for bx in ((x0, mx), (mx, x1)):
                for by in ((y0, my), (my, y1)):
                    tile(bx[0], by[0], bx[1], by[1])
            return
        root = ET.fromstring(body)
        nodes = {int(n.get('id')): (float(n.get('lon')), float(n.get('lat'))) for n in root.iter('node')}
        for w in root.iter('way'):
            tags = {t.get('k'): t.get('v') for t in w.iter('tag')}
            nids = [int(nd.get('ref')) for nd in w.iter('nd') if int(nd.get('ref')) in nodes]
            ways[int(w.get('id'))] = (tags, [nodes[n] for n in nids], nids)

    step = 0.02
    x = minx
    while x < maxx:
        y = miny
        while y < maxy:
            tile(x, y, min(x + step, maxx), min(y + step, maxy))
            y += step
        x += step
    return ways


def coastline_water(minx: float, miny: float, maxx: float, maxy: float) -> list[Polygon]:
    """The water inside a box, from OSM coastline ways (land on their left,
    water on their right)."""
    ways = map_ways(minx, miny, maxx, maxy)
    coast = [LineString(c) for tags, c, _ in ways.values() if tags.get('natural') == 'coastline' and len(c) > 1]
    print(f'  coastline: {len(coast)} ways')
    from shapely.ops import split
    area = box(minx, miny, maxx, maxy)
    merged = linemerge(unary_union(coast))
    faces = polygons(split(area, merged))
    water = []
    for f in faces:
        pt = f.representative_point()
        # Which side of the nearest coastline segment is this face on?
        best = None
        for line in lines(merged):
            dist = line.distance(pt)
            if best is None or dist < best[0]:
                best = (dist, line)
        line = best[1]
        along = line.project(pt)
        a = line.interpolate(max(0, along - 1e-4))
        b = line.interpolate(min(line.length, along + 1e-4))
        cross = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x)
        if cross < 0:  # right of the coastline: water
            water.append(f)
    return water


# ── Walking a course over OSM streets ──────────────────────────────
#
# The public OSRM server routes everything as a car, so a race course that
# runs against one-way streets comes out with detours. Instead the streets
# along the course are fetched as map tiles and walked here: shortest path
# between the waypoints, one-way ignored (the roads are closed on race
# day), street centrelines preferred over sidewalks.

WALK_COST = {
    'motorway': 6, 'motorway_link': 6, 'trunk': 2, 'trunk_link': 2, 'service': 1.5,
    'footway': 1.6, 'path': 1.6, 'cycleway': 1.4, 'steps': 3, 'track': 2, 'bridleway': 2,
}
WALK_SKIP = {'construction', 'proposed', 'raceway', 'bus_guideway', 'corridor', 'elevator', 'platform', 'busway'}


def tile_streets(x0: float, y0: float, x1: float, y1: float) -> list[tuple[dict, list[tuple[float, float]], list[int]]]:
    """The highway ways in a tile, kept in a compact cache (the full tile
    is big and most of it is buildings)."""
    key = Path(ARGS.cache) / f'streets_{x0:.4f}_{y0:.4f}_{x1:.4f}_{y1:.4f}.json'
    if key.exists():
        return json.loads(key.read_text())
    ways = map_ways(x0, y0, x1, y1)
    out = []
    for tags, coords, nids in ways.values():
        hw = tags.get('highway')
        if not hw or hw in WALK_SKIP or tags.get('area') == 'yes' or len(coords) < 2:
            continue
        keep = {k: v for k, v in tags.items() if k in ('highway', 'name', 'footway', 'access', 'foot', 'bridge', 'tunnel', 'layer')}
        out.append((keep, coords, nids))
    key.parent.mkdir(parents=True, exist_ok=True)
    key.write_text(json.dumps(out, separators=(',', ':')))
    return out


class Walker:
    def __init__(self, waypoints: list[tuple[float, float]], corridor: float = 0.004):
        line = LineString([(lng, lat) for lat, lng in waypoints]).buffer(corridor)
        minx, miny, maxx, maxy = line.bounds
        step = 0.01
        tiles = []
        x = math.floor(minx / step) * step
        while x < maxx:
            y = math.floor(miny / step) * step
            while y < maxy:
                if box(x, y, x + step, y + step).intersects(line):
                    tiles.append((x, y))
                y += step
            x += step
        print(f'  walker: {len(tiles)} tiles along the course')
        self.adj: dict[int, list[tuple[int, float, float]]] = {}
        self.pos: dict[int, tuple[float, float]] = {}
        self.street_nodes: set[int] = set()
        self.names: dict[int, str] = {}
        for x, y in tiles:
            for tags, coords, nids in tile_streets(x, y, x + step, y + step):
                hw = tags['highway']
                if tags.get('access') in ('private', 'no') and tags.get('foot') not in ('yes', 'designated', 'permissive'):
                    continue
                cost = WALK_COST.get(hw, 1.0)
                if tags.get('footway') == 'sidewalk':
                    cost = 2.0
                street = cost <= 1.5 and hw not in ('service',)
                for i, (nid, c) in enumerate(zip(nids, coords)):
                    self.pos[nid] = tuple(c)
                    if street:
                        self.street_nodes.add(nid)
                    self.names.setdefault(nid, tags.get('name', hw))
                    if i:
                        a, b = nids[i - 1], nid
                        d = miles(LineString([coords[i - 1], c]))
                        self.adj.setdefault(a, []).append((b, d * cost, d))
                        self.adj.setdefault(b, []).append((a, d * cost, d))
        print(f'  walker: {len(self.pos)} nodes, {sum(len(v) for v in self.adj.values()) // 2} edges')

    def snap(self, lat: float, lng: float) -> int:
        kx = math.cos(math.radians(lat))
        best = None
        for pool in (self.street_nodes, self.pos.keys()):
            for nid in pool:
                x, y = self.pos[nid]
                d = ((x - lng) * kx) ** 2 + (y - lat) ** 2
                if best is None or d < best[0]:
                    best = (d, nid)
            if best and math.sqrt(best[0]) * 69 < 0.08:  # within ~130 m of a street
                break
        d_mi = math.sqrt(best[0]) * 69
        if d_mi > 0.15:
            print(f'    WARNING waypoint ({lat}, {lng}) is {d_mi:.2f} mi from the nearest street ({self.names.get(best[1])})')
        return best[1]

    def route(self, waypoints: list[tuple[float, float]]) -> LineString:
        import heapq
        nodes = [self.snap(lat, lng) for lat, lng in waypoints]
        for (lat, lng), n in zip(waypoints, nodes):
            pass
        out: list[tuple[float, float]] = []
        total = 0.0
        for i, (a, b) in enumerate(zip(nodes, nodes[1:])):
            dist = {a: 0.0}
            real = {a: 0.0}
            prev: dict[int, int] = {}
            heap = [(0.0, a)]
            while heap:
                d, n = heapq.heappop(heap)
                if n == b:
                    break
                if d > dist.get(n, math.inf):
                    continue
                for m, w, r in self.adj.get(n, ()):
                    nd = d + w
                    if nd < dist.get(m, math.inf):
                        dist[m] = nd
                        real[m] = real[n] + r
                        prev[m] = n
                        heapq.heappush(heap, (nd, m))
            if b not in prev and a != b:
                raise SystemExit(f'walker: no way from waypoint {i} {waypoints[i]} ({self.names.get(a)}) to {i + 1} {waypoints[i + 1]} ({self.names.get(b)})')
            leg = []
            n = b
            while n != a:
                leg.append(self.pos[n])
                n = prev[n]
            leg.append(self.pos[a])
            leg.reverse()
            straight = miles(LineString([(waypoints[i][1], waypoints[i][0]), (waypoints[i + 1][1], waypoints[i + 1][0])]))
            got = real.get(b, 0.0)
            total += got
            if got > straight * 1.5 + 0.15:
                print(f'    DETOUR leg {i} {waypoints[i]} ({self.names.get(a)}) -> {waypoints[i + 1]} ({self.names.get(b)}): {got:.1f} mi for {straight:.1f} straight')
            out.extend(leg if not out else leg[1:])
        print(f'  walked {total:.1f} mi via {", ".join(dict.fromkeys(self.names.get(n, "?") for n in nodes))}')
        DEBUG_WAYPOINTS.extend(waypoints)
        return LineString(out)


def walk(waypoints: list[tuple[float, float]]) -> LineString:
    return Walker(waypoints).route(waypoints)


# ── Geometry helpers ────────────────────────────────────────────────

def order_along(ways: list[LineString], reference: LineString) -> LineString:
    """Ways of a long trail, joined in order of where they fall along a rough
    reference line (so junctions and gaps don't matter), each turned to run
    the reference's way. Ways far off the reference (side trails) are dropped."""
    keep = []
    for w in ways:
        mid = w.interpolate(0.5, normalized=True)
        if reference.distance(mid) > 0.35:
            continue
        a, b = reference.project(w.interpolate(0, normalized=True)), reference.project(w.interpolate(1, normalized=True))
        coords = list(w.coords)
        if b < a:
            coords.reverse()
        keep.append((reference.project(mid), coords))
    keep.sort(key=lambda k: k[0])
    out = []
    for _, coords in keep:
        out.extend(coords)
    print(f'  ordered {len(keep)} of {len(ways)} ways')
    return LineString(out)


def simplify_to(geom, max_pts: int):
    """Douglas-Peucker to at most max_pts, choosing the tolerance by search."""
    def count(g):
        if g.is_empty:
            return 0
        if hasattr(g, 'geoms'):
            return sum(count(p) for p in g.geoms)
        if isinstance(g, Polygon):
            return len(g.exterior.coords) + sum(len(r.coords) for r in g.interiors)
        return len(g.coords)
    if count(geom) <= max_pts:
        return geom
    lo, hi = 0.0, 1.0
    best = geom
    for _ in range(40):
        mid = (lo + hi) / 2
        s = geom.simplify(mid, preserve_topology=True)
        if count(s) <= max_pts:
            best, hi = s, mid
        else:
            lo = mid
    return best


def padded_bbox(line: LineString, pad: float = 0.14) -> Polygon:
    """The line's box, padded by `pad` times its longer side on every side
    (the map may be much taller or wider than the course)."""
    minx, miny, maxx, maxy = line.bounds
    p = max(maxx - minx, maxy - miny) * pad or 0.003
    return box(minx - p, miny - p, maxx + p, maxy + p)


def polygons(geom) -> list[Polygon]:
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, (MultiPolygon, GeometryCollection)):
        return [p for g in geom.geoms for p in polygons(g)]
    return []


def lines(geom) -> list[LineString]:
    if geom.is_empty:
        return []
    if isinstance(geom, LineString):
        return [geom]
    if isinstance(geom, (MultiLineString, GeometryCollection)):
        return [l for g in geom.geoms for l in lines(g)]
    return []


def without_holes(polys: list[Polygon]) -> list[Polygon]:
    """JourneyMap fills each polygon with nonzero winding and no holes, so a
    polygon with islands in it is cut along a line through each hole."""
    out = []
    for p in polys:
        if not p.interiors:
            out.append(p)
            continue
        from shapely.ops import split
        pieces = [p]
        for ring in p.interiors:
            cx = Polygon(ring).centroid.x
            cutter = LineString([(cx, p.bounds[1] - 1), (cx, p.bounds[3] + 1)])
            nxt = []
            for piece in pieces:
                nxt.extend(polygons(split(piece, cutter)))
            pieces = nxt
        out.extend(pieces)
    return out


def latlng(coords) -> list[list[float]]:
    return [[round(y, 4), round(x, 4)] for x, y in coords]


# ── The courses ─────────────────────────────────────────────────────

def golden_gate():
    # The bridge's east sidewalk (the one open to walkers), south to north.
    ways = map_ways(-122.49, 37.80, -122.47, 37.84)  # the bridge; the water box below is wider
    sidewalk = [LineString(c) for tags, c, _ in ways.values() if tags.get('name') == 'Golden Gate Bridge East Sidewalk' and len(c) > 1]
    print(f'  sidewalk: {len(sidewalk)} ways')
    path = order_along(sidewalk, LineString([(-122.4753, 37.8070), (-122.4793, 37.8330)]))
    minx, miny, maxx, maxy = padded_bbox(path, 1.0).bounds
    water = coastline_water(minx, miny, maxx, maxy)
    return path, water, []


def windy_city():
    # Grant Park, north through the Loop and Lincoln Park to Addison, back
    # down through Old Town, west on Adams to Damen, then the West Side,
    # Pilsen, Chinatown, Bronzeville and up Michigan Avenue to the finish.
    wp = [
        (41.8807, -87.6205), (41.8917, -87.6203), (41.8917, -87.6282),  # Columbus north, Grand west to State
        (41.8781, -87.6278), (41.8781, -87.6324), (41.8865, -87.6325),  # State south, Jackson, LaSalle north
        (41.9110, -87.6332), (41.9257, -87.6355), (41.9325, -87.6400),  # LaSalle Dr, Stockton, Cannon
        (41.9400, -87.6420), (41.9470, -87.6450), (41.9470, -87.6462),  # Sheridan to Addison, the turnaround
        (41.9399, -87.6443), (41.9325, -87.6438), (41.9256, -87.6398),  # Broadway, Clark south
        (41.9113, -87.6338), (41.9113, -87.6387), (41.9035, -87.6385),  # Clark, North, Sedgwick
        (41.8966, -87.6342), (41.8838, -87.6355), (41.8794, -87.6355),  # Wells, Franklin, to Adams
        (41.8794, -87.6770), (41.8780, -87.6770), (41.8780, -87.6470),  # Adams west to Damen, Jackson east
        (41.8695, -87.6470), (41.8695, -87.6660), (41.8578, -87.6660),  # Halsted, Taylor, Ashland
        (41.8578, -87.6470), (41.8530, -87.6470), (41.8530, -87.6320),  # 18th, Halsted, Cermak
        (41.8347, -87.6320), (41.8347, -87.6270), (41.8312, -87.6270),  # Wentworth, 33rd, State
        (41.8312, -87.6235), (41.8674, -87.6240), (41.8674, -87.6205),  # 35th, Michigan north, Roosevelt
        (41.8726, -87.6205),  # Columbus, finish
    ]
    path = walk(wp)
    bbox = padded_bbox(path, 1.0)
    lake = nominatim(osm_id='R1205149', threshold=0.0002)  # Lake Michigan
    water = polygons(lake.intersection(bbox))
    rivers = []
    for rid in ('R2192735', 'R2192744'):  # Chicago River main stem, South Branch
        rivers.extend(lines(nominatim(osm_id=rid).intersection(bbox)))
    rivers.extend(lines(nominatim('North Branch Chicago River').intersection(bbox)))
    return path, water, rivers


def five_boroughs():
    # Staten Island over the Verrazzano, up Fourth Avenue and through
    # Williamsburg and Greenpoint, over the Pulaski and Queensboro bridges,
    # up First Avenue to the Bronx and back down Fifth into Central Park.
    # The bridges that have no footway come from their outlines in OSM.
    verrazzano = bridge_line('Verrazzano-Narrows Bridge', toward=(40.6109, -74.0319))
    brooklyn = walk([
        (40.6168, -74.0330), (40.6450, -74.0097), (40.6835, -73.9775),  # 4th Ave to Flatbush
        (40.6865, -73.9745), (40.6890, -73.9535), (40.7100, -73.9570), (40.7210, -73.9560),  # Lafayette, Bedford north
        (40.7300, -73.9540), (40.7305, -73.9512), (40.7420, -73.9530), (40.7445, -73.9545),  # Greenpoint, Pulaski, Vernon
        (40.7465, -73.9525), (40.7470, -73.9430), (40.7505, -73.9410),  # 44th Dr, Crescent St, Queens Plaza
    ])
    queensboro = bridge_line('Queensboro Bridge', toward=(40.7602, -73.962))
    manhattan = walk([
        (queensboro.coords[-1][1], queensboro.coords[-1][0]),
        (40.7800, -73.9470), (40.7975, -73.9340), (40.8092, -73.9268), (40.8115, -73.9255),  # 1st Ave north, Willis Ave
        (40.8120, -73.9290), (40.8137, -73.9365), (40.7980, -73.9500), (40.7838, -73.9580),  # 138th, Madison Ave Bridge, 5th
        (40.7770, -73.9632), (40.7720, -73.9690), (40.7680, -73.9720), (40.7645, -73.9735),  # East Drive to Grand Army Plaza
        (40.7660, -73.9770), (40.7681, -73.9819), (40.7700, -73.9800), (40.7722, -73.9776),  # Central Park South, Columbus Circle, finish
    ])
    path = LineString(list(verrazzano.coords) + list(brooklyn.coords) + list(queensboro.coords) + list(manhattan.coords))
    bbox = padded_bbox(path, 0.6)
    land = unary_union([
        nominatim(osm_id='R3954665'),  # Manhattan Island
        nominatim(osm_id='R3955977', threshold=0.0005),  # Long Island
        nominatim('Staten Island, New York'),
        nominatim('Roosevelt Island, New York'),
        nominatim('Randalls and Wards Islands'),
        nominatim('The Bronx, New York'),
        nominatim('Hudson County, New Jersey'),
    ])
    bay = nominatim(osm_id='R2389632')  # Upper New York Bay
    water = polygons(unary_union([bay, bbox.difference(land)]).intersection(bbox))
    return path, water, []


def thames():
    # Blackheath through Charlton to Woolwich, back west along the river
    # through Greenwich and Rotherhithe to Tower Bridge, east around the
    # Isle of Dogs, then back along the river to Westminster and The Mall.
    london = (51.44, -0.2, 51.54, 0.1)
    streets = [
        ('Shooters Hill Road', (51.4725, 0.0100)), ('Charlton Way', (51.4745, 0.0200)), ('Charlton Park Road', (51.4770, 0.0370)),
        ('Charlton Park Lane', (51.4800, 0.0450)), ('Little Heath', (51.4830, 0.0480)), ('Charlton Road', (51.4850, 0.0540)),
        ('Artillery Place', (51.4890, 0.0620)), ('John Wilson Street', (51.4915, 0.0650)), ('Woolwich Church Street', (51.4918, 0.0520)),
        ('Woolwich Road', (51.4895, 0.0300)), ('Trafalgar Road', (51.4830, 0.0000)), ('King William Walk', (51.4826, -0.0096)),
        ('Creek Road', (51.4830, -0.0200)), ('Evelyn Street', (51.4870, -0.0350)), ('Surrey Quays Road', (51.4945, -0.0455)),
        ('Redriff Road', (51.4975, -0.0410)), ('Salter Road', (51.5020, -0.0430)), ('Brunel Road', (51.5010, -0.0570)),
        ('Jamaica Road', (51.4985, -0.0640)), ('Tower Bridge Road', (51.5020, -0.0765)), ('Tower Bridge', (51.5055, -0.0754)),
        ('East Smithfield', (51.5090, -0.0710)), ('The Highway', (51.5100, -0.0590)), ('Narrow Street', (51.5088, -0.0345)),
        ('Westferry Road', (51.5065, -0.0260)), ('Westferry Road', (51.4900, -0.0180)), ('East Ferry Road', (51.4925, -0.0120)),
        ('Marsh Wall', (51.5020, -0.0215)), ('West India Avenue', (51.5050, -0.0260)), ('Upper Bank Street', (51.5040, -0.0180)),
        ('Trafalgar Way', (51.5065, -0.0120)), ('Poplar High Street', (51.5085, -0.0150)), ('East India Dock Road', (51.5105, -0.0180)),
        ('Commercial Road', (51.5110, -0.0350)), ('Butcher Row', (51.5110, -0.0400)), ('The Highway', (51.5097, -0.0600)),
        ('Tower Hill', (51.5095, -0.0740)), ('Lower Thames Street', (51.5090, -0.0850)), ('Upper Thames Street', (51.5100, -0.0980)),
        ('Victoria Embankment', (51.5080, -0.1150)), ('Bridge Street', (51.5007, -0.1246)), ('Birdcage Walk', (51.5010, -0.1340)),
        ('Spur Road', (51.5017, -0.1415)), ('The Mall', (51.5040, -0.1340)),
    ]
    path = walk([on_street(name, near, london) for name, near in streets])
    bbox = padded_bbox(path, 1.0)
    rivers = lines(nominatim(osm_id='R2263653', threshold=0.0002).intersection(bbox))  # River Thames
    return path, [], rivers


def death_valley():
    path = osrm('driving', [
        (36.2297, -116.7675), (36.4573, -116.8676), (36.6066, -117.1450), (36.3920, -117.2960),
        (36.3395, -117.4680), (36.4880, -117.8750), (36.6061, -118.0626), (36.5869, -118.2400),
    ])
    return path, [], []


def appalachian():
    # The trail's route relation, state by state, ordered along a rough
    # Springer-to-Katahdin line.
    reference = LineString([(lng, lat) for lat, lng in [
        (34.6266, -84.194), (35.451, -83.811), (35.5628, -83.4985), (36.0, -82.6), (36.633, -81.787),
        (37.392, -80.036), (38.03, -78.86), (39.3254, -77.7286), (40.397, -77.031), (40.974, -75.14),
        (41.312, -73.988), (42.637, -73.166), (43.702, -72.29), (44.2706, -71.3033), (45.286, -69.501),
        (45.9044, -68.9213)]])
    path = order_along(osm_relation_ways(156553), reference)
    return path, [], []


def route_66():
    path = osrm('driving', [
        (41.8787, -87.6246), (41.5250, -88.0817), (40.8808, -88.6298), (40.4842, -88.9937), (39.7817, -89.6501),
        (39.1753, -89.6543), (38.6270, -90.1994), (37.9514, -91.7713), (37.6806, -92.6638), (37.2090, -93.2923),
        (37.0842, -94.5133), (36.8745, -94.8775), (36.1540, -95.9928), (35.4676, -97.5164), (35.5156, -98.9670),
        (35.2140, -100.2490), (35.2220, -101.8313), (35.1717, -103.7250), (34.9381, -104.6825), (35.0844, -106.6504),
        (35.1473, -107.8514), (35.5281, -108.7426), (34.9022, -110.1582), (35.0242, -110.6974), (35.1983, -111.6513),
        (35.2494, -112.1910), (35.3258, -112.8766), (35.5292, -113.4258), (35.1894, -114.0530), (35.0261, -114.3833),
        (34.8481, -114.6141), (34.5578, -115.7447), (34.8958, -117.0173), (34.5362, -117.2928), (34.1083, -117.2898),
        (34.1478, -118.1445), (34.0522, -118.2437), (34.0094, -118.4973),
    ])
    return path, [], []


COURSES = {
    'golden-gate': (golden_gate, 1.7, 160),
    'windy-city': (windy_city, 26.2, 320),
    'five-boroughs': (five_boroughs, 26.2, 320),
    'thames': (thames, 26.2, 320),
    'death-valley': (death_valley, 135, 240),
    'appalachian': (appalachian, 2190, 400),
    'route-66': (route_66, 2448, 400),
}


def miles(line: LineString) -> float:
    R = 3958.8
    c = list(line.coords)
    total = 0.0
    for (x1, y1), (x2, y2) in zip(c, c[1:]):
        dlat, dlng = math.radians(y2 - y1), math.radians(x2 - x1)
        h = math.sin(dlat / 2) ** 2 + math.cos(math.radians(y1)) * math.cos(math.radians(y2)) * math.sin(dlng / 2) ** 2
        total += 2 * R * math.asin(math.sqrt(h))
    return total


# ── Preview SVGs, drawn like JourneyMap ─────────────────────────────

def preview_svg(cid: str, geom: dict, stops: list[dict], labels: list[dict], w=360, h=480, waypoints=()) -> str:
    pts = geom['path']
    lats = [p[0] for p in pts]
    lngs = [p[1] for p in pts]
    min_lat, max_lat, min_lng, max_lng = min(lats), max(lats), min(lngs), max(lngs)
    pad_lat, pad_lng = (max_lat - min_lat) * 0.08 or 0.002, (max_lng - min_lng) * 0.08 or 0.002
    min_lat -= pad_lat; max_lat += pad_lat; min_lng -= pad_lng; max_lng += pad_lng
    kx = math.cos(math.radians((min_lat + max_lat) / 2))
    s = min(w / ((max_lng - min_lng) * kx), h / (max_lat - min_lat))
    ox = (w - (max_lng - min_lng) * kx * s) / 2
    oy = (h - (max_lat - min_lat) * s) / 2

    def P(p):
        return ox + (p[1] - min_lng) * kx * s, oy + (max_lat - p[0]) * s

    def d(ps):
        return ' '.join(f'{"L" if i else "M"}{P(p)[0]:.1f},{P(p)[1]:.1f}' for i, p in enumerate(ps))

    # Where each stop lands, by its share of the line (as pointAt does).
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.hypot((b[0] - a[0]), (b[1] - a[1]) * kx))
    total_mi = max(st['mi'] for st in stops)

    def at(mi):
        dd = max(0, min(1, mi / total_mi)) * cum[-1]
        i = 1
        while i < len(cum) - 1 and cum[i] < dd:
            i += 1
        t = (dd - cum[i - 1]) / ((cum[i] - cum[i - 1]) or 1)
        a, b = pts[i - 1], pts[i]
        return P((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))

    line = max(3, w / 70); dot = max(3, w / 95); font = max(9, w / 38)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="Helvetica, Arial, sans-serif">',
           f'<rect width="{w}" height="{h}" rx="12" fill="#f0f0f3"/>']
    for poly in geom.get('water', []):
        out.append(f'<path d="{d(poly)} Z" fill="rgba(59,111,181,0.22)"/>')
    for r in geom.get('rivers', []):
        out.append(f'<path d="{d(r)}" stroke="rgba(74,123,196,0.45)" stroke-width="{line * 0.7}" fill="none" stroke-linecap="round"/>')
    for l in labels:
        x, y = P(l['at'])
        out.append(f'<text x="{x:.1f}" y="{y:.1f}" fill="rgba(143,176,224,0.7)" font-size="{font * 0.9}" text-anchor="middle" letter-spacing="1.5" font-weight="600">{l["text"]}</text>')
    out.append(f'<path d="{d(pts)}" stroke="rgba(20,20,30,0.22)" stroke-width="{line}" fill="none" stroke-linejoin="round" stroke-linecap="round"/>')
    for st in stops:
        x, y = at(st['mi'])
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{dot}" fill="#fff" stroke="#c9a227" stroke-width="1.2"/>')
        left = x > w * 0.6
        text = 'Start' if st['mi'] == 0 else 'Finish' if st['mi'] == total_mi else st['name']
        out.append(f'<text x="{(x - dot * 2) if left else (x + dot * 2):.1f}" y="{y + font * 0.35:.1f}" fill="rgba(20,20,30,0.8)" font-size="{font}" text-anchor="{"end" if left else "start"}" font-weight="600">{text}</text>')
    for i, wp in enumerate(waypoints):
        x, y = P(wp)
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="#d33"/><text x="{x + 4:.1f}" y="{y - 3:.1f}" fill="#d33" font-size="9">{i}</text>')
    out.append('</svg>')
    return '\n'.join(out)


# ── Main ────────────────────────────────────────────────────────────

def main():
    global ARGS
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=str(HERE / '.cache'))
    ap.add_argument('--out', default=str(HERE.parent.parent / 'src' / 'journeys' / 'courseGeometry.ts'))
    ap.add_argument('--svg', default=None)
    ap.add_argument('--only', default=None)
    ap.add_argument('--debug', action='store_true')
    ARGS = ap.parse_args()

    # Stops and labels, for the previews only, pulled from courses.ts.
    courses_ts = (HERE.parent.parent / 'src' / 'journeys' / 'courses.ts').read_text()
    import re
    meta = {}
    for block in re.split(r'\n  \{\n    id: ', courses_ts)[1:]:
        cid = re.match(r"'([^']+)'", block).group(1)
        stops = [{'mi': float(m.group(1)), 'name': m.group(2)} for m in re.finditer(r"\{ mi: ([\d.]+), name: '([^']*)' \}", block)]
        labels = [{'at': (float(m.group(1)), float(m.group(2))), 'text': m.group(3)} for m in re.finditer(r"\{ at: \[([-\d.]+), ([-\d.]+)\], text: '([^']*)' \}", block)]
        meta[cid] = (stops, labels)

    result = {}
    for cid, (build, length, max_pts) in COURSES.items():
        if ARGS.only and cid not in ARGS.only.split(','):
            continue
        print(f'== {cid}')
        DEBUG_WAYPOINTS.clear()
        path, water, rivers = build()
        raw_mi = miles(path)
        path = simplify_to(path, max_pts)
        # Water and rivers: anything under about a pixel at 400px across goes.
        minx, miny, maxx, maxy = path.bounds
        tol = max(maxx - minx, maxy - miny) / 400
        water = without_holes([p for w in water for p in polygons(w.simplify(tol, preserve_topology=True))])
        rivers = [l for r in rivers for l in lines(r.simplify(tol, preserve_topology=True))]
        # Specks and stubs too small to see at that scale go too.
        water = [p for p in water if p.area > (tol * 6) ** 2]
        rivers = [l for l in rivers if l.length > tol * 20]
        print(f'  path {len(path.coords)} pts, {miles(path):.1f} mi (raw {raw_mi:.1f}, course {length}); '
              f'water {sum(len(p.exterior.coords) for p in water)} pts in {len(water)}; rivers {sum(len(l.coords) for l in rivers)} pts in {len(rivers)}')
        result[cid] = {'path': latlng(path.coords)}
        if water:
            result[cid]['water'] = [latlng(p.exterior.coords)[:-1] for p in water]
        if rivers:
            result[cid]['rivers'] = [latlng(l.coords) for l in rivers]
        if ARGS.svg:
            Path(ARGS.svg).mkdir(parents=True, exist_ok=True)
            (Path(ARGS.svg) / f'{cid}.svg').write_text(preview_svg(cid, result[cid], *meta[cid]))
            if ARGS.debug:
                (Path(ARGS.svg) / f'{cid}-debug.svg').write_text(preview_svg(cid, result[cid], *meta[cid], w=900, h=1200, waypoints=list(DEBUG_WAYPOINTS)))

    if ARGS.only:
        print('(--only: not writing the TypeScript file)')
        return
    ts = ['// Generated by mobile/scripts/courses/build.py from OpenStreetMap data',
          '// (© OpenStreetMap contributors, ODbL). Do not edit by hand; re-run the',
          '// script. Lines are simplified to a few hundred points: close enough to',
          '// recognise on a small map, not for navigation.',
          '',
          'import type { LatLng } from \'./courses\';',
          '',
          'export interface CourseGeometry {',
          '  path: LatLng[];',
          '  water?: LatLng[][];',
          '  rivers?: LatLng[][];',
          '}',
          '',
          'export const COURSE_GEOMETRY: Record<string, CourseGeometry> = {']
    for cid, g in result.items():
        ts.append(f"  '{cid}': {{")
        for key in ('path', 'water', 'rivers'):
            if key not in g:
                continue
            ts.append(f'    {key}: {json.dumps(g[key], separators=(",", ":"))},')
        ts.append('  },')
    ts.append('};')
    ts.append('')
    Path(ARGS.out).write_text('\n'.join(ts))
    print(f'wrote {ARGS.out} ({Path(ARGS.out).stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
