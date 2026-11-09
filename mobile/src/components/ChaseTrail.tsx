import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';
import { catchTimes, ReplayButton, RunnerMarker, useReplay, type TrackRunner } from './ChaseTrack';

// A trail through the woods or up a mountain: the same race as
// ChaseTrack (runners by steps or miles, played back, the chaser's
// catches), on a winding path instead of a loop. Nobody laps: the trail
// fits the run, whoever's furthest ending near the top.

export type TrailScene = 'woods' | 'mountains';

export const TRAIL_SCENES: { id: TrailScene; name: string }[] = [
  { id: 'woods', name: 'Woods' },
  { id: 'mountains', name: 'Mountains' },
];

export function ChaseTrail({
  runners,
  width,
  scene = 'woods',
  durationMs = 7_000,
  autoPlay = true,
  tagging = true,
  chaserLabel = 'IT',
  catchWord = 'CAUGHT!',
  caughtRing = '#8a8f9c',
}: {
  runners: TrackRunner[];
  width: number;
  scene?: TrailScene;
  durationMs?: number;
  autoPlay?: boolean;
  tagging?: boolean;
  chaserLabel?: string;
  catchWord?: string;
  caughtRing?: string;
}) {
  const W = width;
  const H = Math.round(W * (scene === 'mountains' ? 0.86 : 0.7));
  const trail = useMemo(() => makeTrail(scene, W, H), [scene, W, H]);
  const { t, playing, replay } = useReplay(durationMs, autoPlay);
  const caughtAt = useMemo(() => catchTimes(runners, tagging), [runners, tagging]);
  const far = Math.max(1, ...runners.map((r) => r.startSteps + r.daySteps)) / 0.94;
  const avatar = 30;
  const lanes = runners.length;

  return (
    <View style={{ width: W, height: H, borderRadius: 18, overflow: 'hidden' }}>
      <Svg width={W} height={H}>
        {scene === 'mountains' ? <Mountains W={W} H={H} trail={trail} /> : <Woods W={W} H={H} trail={trail} />}
      </Svg>
      {runners.map((r, lane) => {
        const at = (r.startSteps + r.daySteps * t) / far;
        const p = trail.at(Math.max(0, Math.min(1, at)));
        // Side by side across the path, so nobody hides behind anyone.
        const off = (lane - (lanes - 1) / 2) * 6;
        return (
          <RunnerMarker
            key={r.id}
            runner={r}
            x={p.x + p.nx * off}
            y={p.y + p.ny * off}
            size={avatar}
            t={t}
            caughtAt={caughtAt.get(r.id)}
            tagging={tagging}
            chaserLabel={chaserLabel}
            catchWord={catchWord}
            caughtRing={caughtRing}
          />
        );
      })}
      {!playing && <ReplayButton onPress={replay} />}
    </View>
  );
}

interface Trail {
  d: string;
  pts: { x: number; y: number }[];
  // The point s (0 to 1) of the way along, evenly by distance, with the
  // path's normal there.
  at: (s: number) => { x: number; y: number; nx: number; ny: number };
  near: (x: number, y: number, r: number) => boolean;
}

function makeTrail(scene: TrailScene, W: number, H: number): Trail {
  const N = 240;
  const raw: { x: number; y: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    if (scene === 'mountains') {
      // Switchbacks up the slope, from the bottom left to the summit.
      const x = W * 0.5 + W * 0.36 * Math.sin(u * Math.PI * 3.5 - Math.PI / 2) * (1 - u * 0.35);
      const y = H * 0.93 - u * H * 0.66;
      raw.push({ x, y });
    } else {
      // A wandering path through the trees, left to right.
      const x = W * 0.07 + u * W * 0.86;
      const y = H * 0.56 + H * 0.24 * Math.sin(u * Math.PI * 2.4 + 0.4) * (0.6 + 0.4 * Math.cos(u * 3));
      raw.push({ x, y });
    }
  }
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y));
  const total = cum[cum.length - 1];
  const at = (s: number) => {
    const target = s * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i++;
    const a = raw[i - 1];
    const b = raw[i];
    const seg = cum[i] - cum[i - 1] || 1;
    const k = (target - cum[i - 1]) / seg;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, nx: -(b.y - a.y) / len, ny: (b.x - a.x) / len };
  };
  const near = (x: number, y: number, r: number) => raw.some((p) => Math.hypot(p.x - x, p.y - y) < r);
  const d = raw.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return { d, pts: raw, at, near };
}

// A steady scatter, the same every time for a given size.
function scatter(n: number, seed: number): { u: number; v: number }[] {
  const out: { u: number; v: number }[] = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 9301 + 49297) % 233280;
    const u = x / 233280;
    x = (x * 9301 + 49297) % 233280;
    out.push({ u, v: x / 233280 });
  }
  return out;
}

function Pine({ x, y, h, dark, light }: { x: number; y: number; h: number; dark: string; light: string }) {
  const w = h * 0.62;
  return (
    <G>
      <Rect x={x - h * 0.05} y={y - h * 0.12} width={h * 0.1} height={h * 0.16} fill="#6b4a2b" />
      <Polygon points={`${x},${y - h} ${x - w / 2},${y - h * 0.35} ${x + w / 2},${y - h * 0.35}`} fill={dark} />
      <Polygon points={`${x},${y - h * 0.78} ${x - w * 0.6},${y - h * 0.1} ${x + w * 0.6},${y - h * 0.1}`} fill={dark} />
      <Polygon points={`${x},${y - h} ${x - w * 0.18},${y - h * 0.62} ${x},${y - h * 0.62}`} fill={light} opacity={0.5} />
    </G>
  );
}

function TrailPath({ trail, edge, fill }: { trail: Trail; edge: string; fill: string }) {
  return (
    <G>
      <Path d={trail.d} stroke={edge} strokeWidth={30} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d={trail.d} stroke={fill} strokeWidth={24} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d={trail.d} stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} strokeDasharray="2 10" fill="none" />
    </G>
  );
}

function Trailhead({ x, y }: { x: number; y: number }) {
  return (
    <G>
      <Rect x={x - 1.5} y={y - 22} width={3} height={22} fill="#6b4a2b" />
      <Rect x={x - 12} y={y - 26} width={24} height={10} rx={2} fill="#a0703c" />
    </G>
  );
}

function Woods({ W, H, trail }: { W: number; H: number; trail: Trail }) {
  const trees = scatter(70, 7)
    .map(({ u, v }) => ({ x: u * W, y: 18 + v * (H - 10), h: 26 + ((u * 97) % 1) * 22 }))
    .filter((p) => !trail.near(p.x, p.y - 6, 26))
    .sort((a, b) => a.y - b.y);
  const start = trail.pts[0];
  const end = trail.pts[trail.pts.length - 1];
  return (
    <G>
      <Rect x={0} y={0} width={W} height={H} fill="#5f9e57" />
      <Ellipse cx={W * 0.78} cy={H * 0.18} rx={W * 0.14} ry={H * 0.06} fill="#7cc2e3" />
      <Ellipse cx={W * 0.75} cy={H * 0.16} rx={W * 0.05} ry={H * 0.015} fill="#bfe6f5" />
      {scatter(26, 3).map(({ u, v }, i) => (
        <Circle key={`b${i}`} cx={u * W} cy={v * H} r={5 + (i % 3) * 2} fill="#6fb062" />
      ))}
      <TrailPath trail={trail} edge="#9a7748" fill="#c9a46b" />
      <Trailhead x={start.x + 4} y={start.y - 14} />
      {/* A cabin where the trail goes. */}
      <G>
        <Rect x={end.x - 14} y={end.y - 34} width={28} height={18} fill="#8a5a33" />
        <Polygon points={`${end.x - 18},${end.y - 34} ${end.x},${end.y - 48} ${end.x + 18},${end.y - 34}`} fill="#5b3a22" />
        <Rect x={end.x - 3} y={end.y - 26} width={6} height={10} fill="#3a2414" />
      </G>
      {trees.map((p, i) => (
        <Pine key={i} x={p.x} y={p.y} h={p.h} dark={i % 3 === 0 ? '#2f6b3a' : '#3d7d45'} light="#8fd17a" />
      ))}
    </G>
  );
}

function Mountains({ W, H, trail }: { W: number; H: number; trail: Trail }) {
  const trees = scatter(40, 11)
    .map(({ u, v }) => ({ x: u * W, y: H * 0.62 + v * H * 0.38, h: 18 + ((u * 89) % 1) * 16 }))
    .filter((p) => !trail.near(p.x, p.y - 4, 22))
    .sort((a, b) => a.y - b.y);
  const start = trail.pts[0];
  const end = trail.pts[trail.pts.length - 1];
  return (
    <G>
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#9fd4f2" />
          <Stop offset="1" stopColor="#e3f3fb" />
        </LinearGradient>
        <LinearGradient id="slope" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#a3b98a" />
          <Stop offset="1" stopColor="#6f9a5e" />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={W} height={H} fill="url(#sky)" />
      {/* Far peaks, then the big one the trail climbs. */}
      <Polygon points={`${-W * 0.1},${H * 0.45} ${W * 0.12},${H * 0.12} ${W * 0.36},${H * 0.45}`} fill="#9aaec4" />
      <Polygon points={`${W * 0.62},${H * 0.45} ${W * 0.9},${H * 0.08} ${W * 1.15},${H * 0.45}`} fill="#9aaec4" />
      <Polygon points={`${W * 0.06},${H * 0.17} ${W * 0.12},${H * 0.12} ${W * 0.18},${H * 0.17} ${W * 0.13},${H * 0.19}`} fill="#ffffff" />
      <Polygon points={`${W * 0.83},${H * 0.15} ${W * 0.9},${H * 0.08} ${W * 0.97},${H * 0.15} ${W * 0.91},${H * 0.17}`} fill="#ffffff" />
      {/* Foothills under the far peaks. */}
      <Path d={`M 0 ${H * 0.44} Q ${W * 0.25} ${H * 0.4} ${W * 0.5} ${H * 0.46} T ${W} ${H * 0.43} L ${W} ${H} L 0 ${H} Z`} fill="#b9cf9f" />
      <Polygon points={`${-W * 0.05},${H} ${W * 0.5},${H * 0.12} ${W * 1.05},${H}`} fill="url(#slope)" />
      <Polygon
        points={`${W * 0.38},${H * 0.31} ${W * 0.5},${H * 0.12} ${W * 0.62},${H * 0.31} ${W * 0.56},${H * 0.28} ${W * 0.5},${H * 0.32} ${W * 0.44},${H * 0.28}`}
        fill="#ffffff"
      />
      {scatter(18, 5).map(({ u, v }, i) => (
        <Ellipse key={`r${i}`} cx={W * (0.15 + u * 0.7)} cy={H * (0.35 + v * 0.55)} rx={6 + (i % 3) * 3} ry={4 + (i % 2) * 2} fill="#8d8f86" opacity={0.55} />
      ))}
      <TrailPath trail={trail} edge="#a08b6a" fill="#dccdb0" />
      <Trailhead x={start.x + 18} y={start.y - 4} />
      {/* A flag at the top of the trail. */}
      <G>
        <Rect x={end.x - 1} y={end.y - 30} width={2.5} height={30} fill="#5b3a22" />
        <Polygon points={`${end.x + 1.5},${end.y - 30} ${end.x + 18},${end.y - 25} ${end.x + 1.5},${end.y - 20}`} fill="#e5484d" />
      </G>
      {trees.map((p, i) => (
        <Pine key={i} x={p.x} y={p.y} h={p.h} dark={i % 2 ? '#2f5f3a' : '#3b6f45'} light="#9fd08a" />
      ))}
    </G>
  );
}
