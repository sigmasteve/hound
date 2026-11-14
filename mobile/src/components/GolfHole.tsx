import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { perspective, project, type Perspective } from './perspective';
import { Text } from './Text';
import { font } from '../theme/tokens';
import { HoundArt } from '../kennel/HoundArt';
import { parseHoundAvatar } from '../kennel/houndAvatar';
import type { GolfHole as Hole, GolfSpot } from '../challenges/golfApi';
import type { GolfCourseId } from '../challenges/golf';

// One hole in perspective (perspective.ts), seen from just behind the
// ball and looking at the pin, like the prototype Steve played: the
// camera follows the ball and frames the hole from here to the pin, so
// the closer you get, the closer it zooms, until the green fills the
// view. The hole is in yards: d from the tee, lat across (right is +).
// Everything goes through toScreen() → project(), so the art, the
// preview and the ball's flight all line up.

// A sponsor on the course (the Hound Open, 0203): boards behind the
// green, and on their hole a sign beside the tee.
export interface GolfSponsorArt {
  name: string;
  color: string;
  boards: boolean;
  holeSign: boolean;
  // "HOLE 7 · PAR 4" on the sign.
  holeLabel?: string;
}

export interface GolfFlight {
  from: GolfSpot;
  // Where it lands (for water and out of bounds, before the drop).
  to: GolfSpot;
  putt: boolean;
  carry: number;
  // A new key starts the flight.
  key: number;
}

interface Camera {
  d: number;
  lat: number;
  fd: number;
  fl: number;
  len: number;
}

// The course's look: sky, far scenery, ground.
const STYLE: Record<GolfCourseId, { sky: [string, string]; far: string; sea: string | null; rough: string; roughStripe: string; fairway: string; fairwayStripe: string; tree: string; treeLight: string }> = {
  links: { sky: ['#7fb6e8', '#cfe6f5'], far: '#5f8f6a', sea: '#5aa0c8', rough: '#3d7f3e', roughStripe: '#3a7a3b', fairway: '#68b04f', fairwayStripe: '#5fa548', tree: '#1f4f2a', treeLight: '#2c6a37' },
  desert: { sky: ['#f2b878', '#fbe3c2'], far: '#c47c4c', sea: null, rough: '#c9a46a', roughStripe: '#c19c62', fairway: '#7cb35a', fairwayStripe: '#73aa52', tree: '#6b7a3a', treeLight: '#808f45' },
  park: { sky: ['#8cc4ee', '#dff0fa'], far: '#4f7f55', sea: '#6fb0d8', rough: '#3f8040', roughStripe: '#3b7a3c', fairway: '#6ab552', fairwayStripe: '#61aa4a', tree: '#1d4a26', treeLight: '#2a6233' },
  mountain: { sky: ['#9cc0e6', '#e6eef7'], far: '#7d8ea3', sea: null, rough: '#3e7b45', roughStripe: '#3a7441', fairway: '#69ad55', fairwayStripe: '#60a24d', tree: '#22472d', treeLight: '#305f3b' },
};

// The fairway's centre across at a distance: along the hole's centreline.
export function centerAt(hole: Hole, d: number): number {
  const c = hole.center;
  if (!c.length) return 0;
  if (d <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (d <= c[i][0]) {
      const t = (d - c[i - 1][0]) / Math.max(1, c[i][0] - c[i - 1][0]);
      return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t;
    }
  }
  return c[c.length - 1][1];
}

// Within this many yards of the pin the camera frames the putt, and the
// flag comes out of the cup.
const GREEN_VIEW_YD = 30;

export function makeCamera(hole: Hole, ball: GolfSpot): Camera {
  const pin = hole.pin;
  const dist = Math.max(1, Math.hypot(pin.d - ball.d, pin.lat - ball.lat));
  const fd = (pin.d - ball.d) / dist;
  const fl = (pin.lat - ball.lat) / dist;
  const far = Math.max(40, Math.min(Math.max(450, hole.length + 40), dist * 1.25 + 22));
  // Putting distance: frame the putt instead, the ball near the bottom and
  // the cup halfway up the screen, clear of the hound and the ball, so you
  // can see what you're putting at.
  if (dist <= GREEN_VIEW_YD) {
    const len = Math.min(far, Math.max(10, dist * 2.8));
    const back = len * 0.14;
    return { d: ball.d - fd * back, lat: ball.lat - fl * back, fd, fl, len };
  }
  const back = far * 0.05;
  return { d: ball.d - fd * back, lat: ball.lat - fl * back, fd, fl, len: far };
}

function view(w: number, h: number): Perspective {
  return perspective(w, h, { stand: h * 0.23, gap: 0, near: h * 0.015, botW: w * 1.25, a: 0.2, b: 0.5 });
}

export function GolfHole({
  hole,
  course,
  ball,
  plan,
  flight,
  onLanded,
  houndIcon,
  trail,
  height = 420,
  compact,
  cameraAt,
  sponsor,
}: {
  hole: Hole;
  course: GolfCourseId;
  ball: GolfSpot;
  // The shot you're lining up: where it should land.
  plan?: { to: GolfSpot; putt: boolean } | null;
  flight?: GolfFlight | null;
  onLanded?: () => void;
  // Your avatar code, for the hound beside the ball (a hound code; else the default hound).
  houndIcon?: string | null;
  // Shots so far on this hole (watching a friend's, or your own).
  trail?: { from: GolfSpot; to: GolfSpot }[];
  height?: number;
  compact?: boolean;
  // Look from here instead of from the ball (once it's in the cup, from
  // where the last shot was played).
  cameraAt?: GolfSpot | null;
  sponsor?: GolfSponsorArt | null;
}) {
  const [w, setW] = useState(0);
  const h = height;
  const v = useMemo(() => view(w || 358, h), [w, h]);
  const st = STYLE[course] ?? STYLE.links;

  // The flight: 0 → 1 over a second or so, then onLanded.
  const [t, setT] = useState<number | null>(null);
  const landed = useRef(onLanded);
  landed.current = onLanded;
  useEffect(() => {
    if (!flight) {
      setT(null);
      return;
    }
    const ms = flight.putt ? 600 : 1100;
    const start = Date.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (Date.now() - start) / ms);
      setT(k);
      if (k < 1) raf = requestAnimationFrame(tick);
      else landed.current?.();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flight?.key]);

  // The camera stays where the shot started until it lands.
  const eye = cameraAt ?? (flight && t != null ? flight.from : ball);
  const cam = useMemo(() => makeCamera(hole, eye), [hole, eye.d, eye.lat]);
  const zoomed = cam.len < 300;
  // Close enough to putt: the flag's out, so nothing stands in the cup.
  const putting = Math.hypot(hole.pin.d - eye.d, hole.pin.lat - eye.lat) <= GREEN_VIEW_YD;

  const P = (d: number, lat: number) => {
    const rd = d - cam.d;
    const rl = lat - cam.lat;
    const along = rd * cam.fd + rl * cam.fl;
    const across = rl * cam.fd - rd * cam.fl;
    const y = Math.min(1.6, Math.max(-0.2, 1 - along / cam.len));
    const x = 0.5 + across / (cam.len * 0.31);
    return project(v, x, y);
  };
  const f = (n: number) => n.toFixed(1);
  const path = (pts: [number, number][], close = false) =>
    pts.map(([d, lat], i) => {
      const q = P(d, lat);
      return `${i ? 'L' : 'M'}${f(q.x)} ${f(q.y)}`;
    }).join(' ') + (close ? ' Z' : '');
  const ellipse = (d: number, lat: number, rd: number, rl: number) =>
    path(Array.from({ length: 29 }, (_, i) => {
      const a = (Math.PI * 2 * i) / 28;
      return [d + rd * Math.cos(a), lat + rl * Math.sin(a)] as [number, number];
    }), true);
  const ellPx = (cx: number, cy: number, rx: number, ry: number) =>
    `M${f(cx - rx)} ${f(cy)} a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0 a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0`;

  const art = useMemo(() => {
    if (!w) return null;
    const hw = hole.fairwayW;
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let d = hole.fairwayFrom; d <= hole.fairwayTo; d += 10) {
      left.push([d, centerAt(hole, d) - hw]);
      right.push([d, centerAt(hole, d) + hw]);
    }
    const fairway = path(left.concat(right.slice().reverse()), true);
    let fairwayStripes = '';
    for (let d = hole.fairwayFrom; d < hole.fairwayTo; d += 36) {
      const e = Math.min(hole.fairwayTo, d + 18);
      fairwayStripes += path([[d, centerAt(hole, d) - hw], [e, centerAt(hole, e) - hw], [e, centerAt(hole, e) + hw], [d, centerAt(hole, d) + hw]], true) + ' ';
    }
    let roughStripes = '';
    for (let d = -40; d < hole.green.d + 60; d += 40) roughStripes += path([[d, -hole.ob - 20], [d + 20, -hole.ob - 20], [d + 20, hole.ob + 20], [d, hole.ob + 20]], true) + ' ';
    // Tree lines beyond the rough on both sides, and any tree hazards.
    let trees = '';
    let treesLight = '';
    const tree = (d: number, lat: number, size: number) => {
      const q = P(d, lat);
      if (q.y > v.h + 60 || q.y < v.y0 - 2) return;
      const r = size * q.s;
      trees += ellPx(q.x, q.y - r * 0.9, r * 0.75, r) + ' ';
      treesLight += ellPx(q.x - r * 0.2, q.y - r * 1.15, r * 0.35, r * 0.45) + ' ';
    };
    for (let d = 40; d <= hole.green.d + 50; d += 26) {
      [-1, 1].forEach((side) => tree(d, side * (hole.ob - 14 + ((d * 7) % 13)), 26));
    }
    const water: string[] = [];
    const sand: string[] = [];
    const waste: string[] = [];
    hole.hazards.forEach((z) => {
      if (z.type === 'water') water.push(ellipse(z.d, z.lat, z.rd, z.rl));
      else if (z.type === 'bunker') sand.push(ellipse(z.d, z.lat, z.rd, z.rl));
      else if (z.type === 'waste') waste.push(ellipse(z.d, z.lat, z.rd, z.rl));
      else if (z.type === 'trees') {
        for (let i = 0; i < 5; i++) tree(z.d + z.rd * Math.cos(i * 1.3) * 0.7, z.lat + z.rl * Math.sin(i * 1.3) * 0.7, 18);
      }
    });
    const markers: { x: number; y: number; s: number; text: string }[] = [];
    let markerLines = '';
    if (!zoomed) {
      [100, 150, 200, 250, 300].forEach((yd) => {
        if (yd > hole.green.d - 20) return;
        const q = P(yd, centerAt(hole, yd) + hw + 3);
        markerLines += `M${f(q.x)} ${f(q.y)} L${f(q.x)} ${f(q.y - 9 * q.s - 2)} `;
        markers.push({ x: q.x, y: q.y, s: q.s, text: String(yd) });
      });
    }
    const greenLines = zoomed && !putting
      ? [-0.6, -0.3, 0, 0.3, 0.6].map((k) => path([[hole.green.d - hole.green.r * 0.85, hole.green.lat + k * hole.green.r], [hole.green.d + hole.green.r * 0.85, hole.green.lat + k * hole.green.r]])).join(' ')
      : '';
    // Putting: read the green. A grid over it, shading darker toward the
    // low side, and arrows pointing downhill, stronger the more it breaks.
    // The green tilts one way (green.break: + drifts right, − left), so
    // the low side is that side.
    const g = hole.green;
    const brk = g.break || 0;
    const fall = brk >= 0 ? 1 : -1;
    const tilt = Math.min(1, Math.abs(brk) / 0.21);
    let greenGrid = '';
    const greenShade: { d: string; o: number }[] = [];
    let greenArrows = '';
    if (putting) {
      const step = 2;
      const half = (x: number) => Math.sqrt(Math.max(0, g.r * g.r - x * x));
      for (let k = -g.r + step; k < g.r; k += step) {
        const span = half(k) * 0.97;
        if (span < 0.8) continue;
        greenGrid += path([[g.d - span, g.lat + k], [g.d + span, g.lat + k]]) + ' ';
        greenGrid += path([[g.d + k, g.lat - span], [g.d + k, g.lat + span]]) + ' ';
      }
      // Bands across the slope, from the high side to the low side.
      const bands = 6;
      for (let b = 0; b < bands; b++) {
        const a = -g.r + (2 * g.r * b) / bands;
        const z = a + (2 * g.r) / bands;
        const pts: [number, number][] = [];
        for (let i = 0; i <= 8; i++) {
          const x = a + ((z - a) * i) / 8;
          pts.push([g.d + half(x), g.lat + x]);
        }
        for (let i = 8; i >= 0; i--) {
          const x = a + ((z - a) * i) / 8;
          pts.push([g.d - half(x), g.lat + x]);
        }
        // Lighter on the high side, darker toward the low side.
        const low = fall > 0 ? b / (bands - 1) : 1 - b / (bands - 1);
        greenShade.push({ d: path(pts, true), o: (0.03 + 0.24 * low) * (0.45 + 0.55 * tilt) });
      }
      // Arrows downhill on a coarser grid.
      for (let dd = -g.r + 3; dd < g.r; dd += 4.5) {
        for (let ll = -g.r + 3; ll < g.r; ll += 4.5) {
          if (dd * dd + ll * ll > (g.r - 1.5) * (g.r - 1.5)) continue;
          const a = P(g.d + dd, g.lat + ll);
          const b = P(g.d + dd, g.lat + ll + fall * 1.1);
          const vx = b.x - a.x;
          const vy = b.y - a.y;
          const len = Math.hypot(vx, vy);
          if (len < 2) continue;
          const ux = vx / len;
          const uy = vy / len;
          // A small chevron, no bigger near the camera than far away.
          const sz = Math.min(7, Math.max(3, len * 0.35));
          const w = sz * 0.7;
          greenArrows += `M${f(a.x - ux * sz - uy * w)} ${f(a.y - uy * sz + ux * w)} L${f(a.x)} ${f(a.y)} L${f(a.x - ux * sz + uy * w)} ${f(a.y - uy * sz - ux * w)} `;
        }
      }
    }
    // Sponsor boards: a low row standing on the ground just past the
    // green, alternating the sponsor's colour with Hound's cream.
    const boards: { d: string; fill: string; x: number; y: number; wpx: number; hpx: number; label: string }[] = [];
    if (sponsor?.boards) {
      const bd = hole.green.d + hole.green.r + 9;
      const n = 5;
      const bw = 11;
      const gap = 1.5;
      const start = hole.green.lat - (n * bw + (n - 1) * gap) / 2;
      for (let i = 0; i < n; i++) {
        const l0 = start + i * (bw + gap);
        const l1 = l0 + bw;
        const a = P(bd, l0);
        const b = P(bd, l1);
        const hpx = Math.max(3, 8 * ((a.s + b.s) / 2) + 2);
        boards.push({
          d: `M${f(a.x)} ${f(a.y)} L${f(b.x)} ${f(b.y)} L${f(b.x)} ${f(b.y - hpx)} L${f(a.x)} ${f(a.y - hpx)} Z`,
          fill: i % 2 === 1 ? '#f7f3ea' : sponsor.color,
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y) - hpx,
          wpx: Math.abs(b.x - a.x),
          hpx,
          label: i % 2 === 1 ? 'HOUND' : sponsor.name.toUpperCase(),
        });
      }
    }
    // The hole sponsor's sign: on a post beside the tee, right of it.
    let sign: { x: number; y: number; w: number; h: number; post: number } | null = null;
    if (sponsor?.holeSign) {
      const q = P(2, 14);
      if (q.y < v.h + 40 && q.y > v.y0) {
        const sw = Math.min(150, Math.max(70, 118 * q.s));
        const sh = sw * 0.42;
        sign = { x: q.x - sw * 0.2, y: q.y - sh - 14 * q.s - 6, w: sw, h: sh, post: 14 * q.s + 6 };
      }
    }
    return {
      boards,
      sign,
      fairway,
      fairwayStripes,
      roughStripes,
      trees,
      treesLight,
      water: water.join(' '),
      sand: sand.join(' '),
      waste: waste.join(' '),
      markers,
      markerLines,
      tee: path([[-4, -7], [12, -7], [12, 7], [-4, 7]], true),
      fringe: ellipse(hole.green.d, hole.green.lat, hole.green.r + 3, hole.green.r + 3),
      green: ellipse(hole.green.d, hole.green.lat, hole.green.r, hole.green.r),
      greenLines,
      greenGrid,
      greenShade,
      greenArrows,
      greenTilt: tilt,
      cup: ellipse(hole.pin.d, hole.pin.lat, 0.55, 0.55),
      cupRim: ellipse(hole.pin.d, hole.pin.lat, 0.8, 0.8),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h, hole, cam.d, cam.lat, cam.len, cam.fd, cam.fl, putting, sponsor?.boards, sponsor?.holeSign, sponsor?.color, sponsor?.name]);

  if (!w || !art) {
    return <View style={[styles.box, { height: h }]} onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))} />;
  }

  const horizon = v.y0;
  const pinQ = P(hole.pin.d, hole.pin.lat);
  const poleH = 30 * pinQ.s + 6;

  // The ball: flying, rolling, or lying.
  let pos = ball;
  let lift = 0;
  if (flight && t != null) {
    pos = { d: flight.from.d + (flight.to.d - flight.from.d) * t, lat: flight.from.lat + (flight.to.lat - flight.from.lat) * t };
    lift = flight.putt ? 0 : Math.sin(Math.PI * t) * (30 + 120 * Math.min(1, flight.carry / 250)) * (1 - 0.45 * t);
  }
  const bq = P(pos.d, pos.lat);
  const ballR = Math.max(2.2, 6 * bq.s + (lift > 0 ? 1.5 : 0));

  // The plan: a dotted line to where it should land.
  let preview = '';
  let landing = '';
  if (plan && !flight) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 14; i++) {
      const k = i / 14;
      pts.push([ball.d + (plan.to.d - ball.d) * k, ball.lat + (plan.to.lat - ball.lat) * k]);
    }
    preview = path(pts);
    landing = ellipse(plan.to.d, plan.to.lat, plan.putt ? 1.5 : 8, plan.putt ? 1.5 : 7);
  }
  const trailPath = (trail ?? []).map((s) => path([[s.from.d, s.from.lat], [s.to.d, s.to.lat]])).join(' ');

  // Your hound, beside the ball (not while it flies).
  const hq = P(ball.d, ball.lat - Math.max(0.6, cam.len * 0.012));
  const hs = Math.round(70 * hq.s + 12);
  const look = parseHoundAvatar(houndIcon);
  const showHound = !flight && !compact;

  return (
    <View style={[styles.box, { height: h }]} onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}>
      <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="golfSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={st.sky[0]} />
            <Stop offset="1" stopColor={st.sky[1]} />
          </LinearGradient>
          <LinearGradient id="golfHaze" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
            <Stop offset="0.35" stopColor="#ffffff" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={horizon} fill="url(#golfSky)" />
        {/* Far scenery: hills (mesas in the desert, peaks in the mountains), the sea on the links. */}
        {course === 'mountain' ? (
          <Path d={`M0 ${horizon} L0 ${horizon - 18} L${w * 0.18} ${horizon - 52} L${w * 0.32} ${horizon - 24} L${w * 0.5} ${horizon - 64} L${w * 0.7} ${horizon - 28} L${w * 0.86} ${horizon - 48} L${w} ${horizon - 20} L${w} ${horizon} Z`} fill={st.far} />
        ) : course === 'desert' ? (
          <Path d={`M0 ${horizon} L0 ${horizon - 14} L${w * 0.12} ${horizon - 14} L${w * 0.14} ${horizon - 36} L${w * 0.32} ${horizon - 36} L${w * 0.34} ${horizon - 14} L${w * 0.62} ${horizon - 14} L${w * 0.64} ${horizon - 30} L${w * 0.82} ${horizon - 30} L${w * 0.84} ${horizon - 12} L${w} ${horizon - 12} L${w} ${horizon} Z`} fill={st.far} />
        ) : (
          <Path d={`M0 ${horizon} L0 ${horizon - 20} Q ${w * 0.17} ${horizon - 34} ${w * 0.33} ${horizon - 24} T ${w * 0.67} ${horizon - 28} T ${w} ${horizon - 22} L${w} ${horizon} Z`} fill={st.far} />
        )}
        {st.sea && <Path d={`M${w * 0.56} ${horizon} L${w * 0.56} ${horizon - 8} L${w} ${horizon - 10} L${w} ${horizon} Z`} fill={st.sea} />}
        <Rect x={0} y={horizon} width={w} height={h - horizon} fill={st.rough} />
        <Path d={art.roughStripes} fill={st.roughStripe} />
        <Path d={art.waste} fill="#d9c08a" opacity={0.85} />
        <Path d={art.fairway} fill={st.fairway} />
        <Path d={art.fairwayStripes} fill={st.fairwayStripe} />
        <Path d={art.tee} fill="#76bd5a" stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
        <Path d={art.water} fill="#3f8fc4" stroke="#e8f3fa" strokeWidth={1} />
        <Path d={art.sand} fill="#ecd9a6" stroke="#d6bf86" strokeWidth={0.8} />
        <Path d={art.fringe} fill="#74bd57" />
        <Path d={art.green} fill="#86cf63" stroke="#5da545" strokeWidth={1} />
        {art.greenLines ? <Path d={art.greenLines} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={1} /> : null}
        {art.greenShade.map((b, i) => (
          <Path key={`shade${i}`} d={b.d} fill="#0b3d16" fillOpacity={b.o} />
        ))}
        {art.greenGrid ? <Path d={art.greenGrid} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={0.8} /> : null}
        {art.greenArrows ? (
          <Path d={art.greenArrows} fill="none" stroke="#ffffff" strokeOpacity={0.4 + 0.4 * art.greenTilt} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
        {putting ? <Path d={art.cupRim} fill="none" stroke="#ffffff" strokeWidth={2} strokeOpacity={0.9} /> : null}
        <Path d={art.cup} fill="#16241a" />
        {art.boards.map((b, i) => (
          <Path key={`board${i}`} d={b.d} fill={b.fill} stroke="rgba(0,0,0,0.25)" strokeWidth={0.6} />
        ))}
        <Path d={art.trees} fill={st.tree} />
        <Path d={art.treesLight} fill={st.treeLight} />
        <Rect x={0} y={horizon} width={w} height={h - horizon} fill="url(#golfHaze)" />
        {art.markerLines ? <Path d={art.markerLines} stroke="#ffffff" strokeWidth={1.5} strokeLinecap="round" /> : null}
        {preview ? <Path d={preview} fill="none" stroke="#ffffff" strokeWidth={2} strokeDasharray="3 5" strokeLinecap="round" /> : null}
        {landing ? <Path d={landing} fill="rgba(255,255,255,0.18)" stroke="#ffffff" strokeWidth={1.5} /> : null}
        {trailPath ? <Path d={trailPath} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} strokeLinecap="round" /> : null}
        {!putting ? (
          <>
            <Line x1={pinQ.x} y1={pinQ.y} x2={pinQ.x} y2={pinQ.y - poleH} stroke="#f4f4f4" strokeWidth={1.6} />
            <Path d={`M${f(pinQ.x)} ${f(pinQ.y - poleH)} l${f(9 * pinQ.s + 4)} ${f(3 * pinQ.s + 1.5)} l${f(-(9 * pinQ.s + 4))} ${f(3 * pinQ.s + 1.5)} Z`} fill="#e5484d" />
          </>
        ) : null}
        <Ellipse cx={bq.x} cy={bq.y} rx={ballR * 0.9} ry={ballR * 0.35} fill="rgba(0,0,0,0.3)" />
      </Svg>
      {art.markers.map((m) => (
        <Text
          key={m.text}
          style={[styles.marker, { left: m.x + 3, top: m.y - 14 * m.s - 8, fontSize: Math.max(9, Math.round(12 * m.s + 4)) }]}
          pointerEvents="none"
        >
          {m.text}
        </Text>
      ))}
      {art.boards.map((b, i) =>
        b.wpx >= 26 && b.hpx >= 7 ? (
          <Text
            key={`boardText${i}`}
            numberOfLines={1}
            pointerEvents="none"
            style={[styles.boardText, { left: b.x, top: b.y, width: b.wpx, height: b.hpx, lineHeight: b.hpx, fontSize: Math.max(5, Math.min(11, b.hpx * 0.6)) }]}
            maxFontSizeMultiplier={1}
          >
            {b.label}
          </Text>
        ) : null,
      )}
      {art.sign && sponsor && (
        <View pointerEvents="none" style={{ position: 'absolute', left: art.sign.x, top: art.sign.y, width: art.sign.w, alignItems: 'center' }}>
          <View style={[styles.sign, { width: art.sign.w, height: art.sign.h, borderColor: sponsor.color }]}>
            {sponsor.holeLabel ? (
              <Text style={[styles.signTop, { fontSize: art.sign.w * 0.085 }]} numberOfLines={1} maxFontSizeMultiplier={1}>
                {sponsor.holeLabel}
              </Text>
            ) : null}
            <Text style={[styles.signSmall, { fontSize: art.sign.w * 0.07 }]} numberOfLines={1} maxFontSizeMultiplier={1}>
              presented by
            </Text>
            <Text style={[styles.signName, { fontSize: art.sign.w * 0.085, color: sponsor.color }]} numberOfLines={1} maxFontSizeMultiplier={1}>
              {sponsor.name.toUpperCase()}
            </Text>
          </View>
          <View style={{ width: 3, height: art.sign.post, backgroundColor: '#7a5a3a' }} />
        </View>
      )}
      {showHound && (
        <View pointerEvents="none" style={{ position: 'absolute', left: hq.x - hs * 0.8, top: hq.y - hs * 0.95, width: hs, height: hs }}>
          <HoundArt
            rank="pup"
            mood="happy"
            size={hs}
            animate={false}
            coatId={look?.coatId}
            ears={look?.ears}
            tail={look?.tail}
            markings={look?.markings}
            neckId={look?.neckId}
            headId={look?.headId}
            faceId={look?.faceId}
            breedId={look?.breedId}
          />
        </View>
      )}
      <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Circle cx={bq.x} cy={bq.y - lift - ballR * 0.6} r={ballR} fill="#ffffff" stroke="rgba(0,0,0,0.35)" strokeWidth={0.8} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  boardText: {
    position: 'absolute',
    textAlign: 'center',
    color: '#161826',
    fontFamily: font.headingSemibold,
    letterSpacing: 0.3,
    overflow: 'hidden',
  },
  sign: {
    backgroundColor: '#f7f3ea',
    borderRadius: 5,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  signTop: { color: '#161826', fontFamily: font.headingSemibold },
  signSmall: { color: '#3a3a3a' },
  signName: { fontFamily: font.headingSemibold, letterSpacing: 0.3 },
  box: { width: '100%', borderRadius: 16, overflow: 'hidden', backgroundColor: '#2d6a35' },
  marker: {
    position: 'absolute',
    color: '#ffffff',
    fontFamily: font.headingSemibold,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 2,
    textShadowOffset: { width: 0, height: 1 },
  },
});
