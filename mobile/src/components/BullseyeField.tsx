import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { groundPath, perspective, project, type Perspective } from './perspective';
import { font } from '../theme/tokens';
import { longshotFlagWind } from '../challenges/longshotApi';
import { bullseyeBalloon, type BullseyeConditions, type BullseyeTarget } from '../challenges/bullseyeApi';

// Bullseye's field (0249), 2.5D like every field: a sunny meadow seen
// from behind your hound on the shooting line, the targets down the lane
// through perspective.ts and project() (x across, y from the far trees at
// 0 to the line at 1). Families picnic beside the line (never behind the
// targets). Moon days: grey dust, black sky, Earth up high.

const LANE_X: Record<string, number> = {
  '18': 0.3, '30': 0.66, '50': 0.4, '70': 0.58, '90': 0.47, clout: 0.5, gold: 0.7,
  b30: 0.36, b50: 0.62, b70: 0.45,
  m50: 0.34, m100: 0.64, m200: 0.44, m300: 0.57, m500: 0.5,
};
export const BALLOON_COLOR: Record<string, string> = { b30: '#e2412f', b50: '#2f7fd6', b70: '#9b6fe0', gold: '#ffd23f' };

export function fieldView(w: number, h: number): Perspective {
  return perspective(w, h, { stand: h * 0.28, near: h * 0.02, gap: 0, botW: w * 1.3, a: 0.08, b: 0.32 });
}

export function targetY(dist: number, world: 'earth' | 'moon'): number {
  return Math.max(0.03, 1 - (dist / (world === 'moon' ? 520 : 158)) * 0.96);
}

export function FaceRings({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <G>
      <Circle cx={cx} cy={cy} r={r} fill="#f4f4f4" />
      <Circle cx={cx} cy={cy} r={r * 0.8} fill="#222" />
      <Circle cx={cx} cy={cy} r={r * 0.6} fill="#2f7fd6" />
      <Circle cx={cx} cy={cy} r={r * 0.4} fill="#e2412f" />
      <Circle cx={cx} cy={cy} r={r * 0.2} fill="#ffd23f" />
    </G>
  );
}

function Sock({ v, y, wind }: { v: Perspective; y: number; wind: number }) {
  const b = project(v, 0.92, y);
  const pole = 40 * b.s + 8;
  const len = Math.min(1, Math.abs(wind) / 9) * (24 * b.s + 5) + 3;
  const dir = wind >= 0 ? 1 : -1;
  const droop = (1 - Math.min(1, Math.abs(wind) / 8)) * (12 * b.s + 2);
  const top = b.y - pole;
  const h = 7 * b.s + 2;
  return (
    <G>
      <Line x1={b.x} y1={b.y} x2={b.x} y2={top} stroke="#6b6b6b" strokeWidth={Math.max(1, 2 * b.s)} />
      <Path d={`M${b.x} ${top} L${b.x + dir * len} ${top + droop + h * 0.25} L${b.x + dir * len} ${top + droop + h * 0.75} L${b.x} ${top + h} Z`} fill="#f08a24" />
      <Path
        d={`M${b.x + dir * len * 0.33} ${top + droop * 0.33 + h * 0.08} L${b.x + dir * len * 0.62} ${top + droop * 0.62 + h * 0.16} L${b.x + dir * len * 0.62} ${top + droop * 0.62 + h * 0.84} L${b.x + dir * len * 0.33} ${top + droop * 0.33 + h * 0.92} Z`}
        fill="#ffffff"
      />
    </G>
  );
}

// The clout's flag in the wind (Steve, Nov 2026): it streams the way the
// wind blows (wind is mph, + from the left, so it points right), hangs
// limp in a calm, and ripples harder in a gust. x, top: the pole's top;
// len and h: the cloth's length and height in a stiff breeze.
export function ClothFlag({ x, top, len, h, wind, now, color = '#e2412f' }: { x: number; top: number; len: number; h: number; wind: number; now: number; color?: string }) {
  const s = Math.min(1, Math.abs(wind) / 10);
  const dir = wind >= 0 ? 1 : -1;
  const reach = len * (0.3 + 0.7 * s);
  const drop = (1 - s) * len * 0.75;
  const wave = Math.sin(now / (170 - 70 * s)) * h * (0.08 + 0.3 * s);
  const tipX = x + dir * reach;
  const tipTop = top + drop + wave * 0.6;
  const tipBot = tipTop + h * (0.75 - 0.25 * s);
  const midX = x + dir * reach * 0.5;
  const d = [
    `M${x} ${top}`,
    `Q${midX} ${top + drop * 0.35 + wave} ${tipX} ${tipTop}`,
    `L${tipX} ${tipBot}`,
    `Q${midX} ${top + h + drop * 0.35 - wave} ${x} ${top + h}`,
    'Z',
  ].join(' ');
  return <Path d={d} fill={color} />;
}

export function BullseyeFieldArt({
  width,
  height,
  conditions,
  targets,
  selected,
  onPick,
  now,
  showHound = true,
  labels = true,
  showSocks = true,
  bow = 'longbow',
}: {
  width: number;
  height: number;
  conditions: BullseyeConditions;
  targets: BullseyeTarget[];
  selected?: string | null;
  onPick?: (id: string) => void;
  now: number;
  showHound?: boolean;
  labels?: boolean;
  showSocks?: boolean;
  // Your bow, drawn as itself in your hound's paws.
  bow?: string;
}) {
  const moon = conditions.world === 'moon';
  const v = useMemo(() => fieldView(width, height), [width, height]);
  const lane = groundPath(v, [[0.35, 0], [0.65, 0], [0.8, 1], [0.2, 1]], true);
  const hs = width / 390;
  const spots = targets.map((t) => {
    const at = project(v, LANE_X[t.id] ?? 0.5, targetY(t.dist, conditions.world));
    return { t, at };
  });
  const hy = v.y1;
  // Balloons drift: cm across at their distance, on screen.
  const cmPx = (s: number) => (s * width * 0.06) / 61;

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Rect x={0} y={0} width={width} height={v.y0 + 4} fill={moon ? '#05060a' : '#8cc8f0'} />
        {moon ? (
          <G>
            {[0.1, 0.24, 0.37, 0.52, 0.63, 0.9].map((x, i) => (
              <Circle key={i} cx={x * width} cy={(0.04 + ((i * 29) % 13) / 100) * height} r={0.9} fill="#f2f3f7" />
            ))}
            <Circle cx={width * 0.8} cy={v.y0 * 0.4} r={v.y0 * 0.18} fill="#2f6fb4" />
          </G>
        ) : (
          <G>
            <Circle cx={width * 0.82} cy={v.y0 * 0.32} r={v.y0 * 0.14} fill="#ffe27a" />
            <Ellipse cx={width * 0.2} cy={v.y0 * 0.3} rx={width * 0.08} ry={v.y0 * 0.08} fill="#ffffff" />
            <Ellipse cx={width * 0.27} cy={v.y0 * 0.25} rx={width * 0.05} ry={v.y0 * 0.07} fill="#ffffff" />
            {[0.05, 0.18, 0.31, 0.69, 0.83, 0.96].map((x, i) => (
              <Ellipse key={i} cx={x * width} cy={v.y0 - 2} rx={width * 0.08} ry={v.y0 * 0.16} fill="#3f8a4f" />
            ))}
          </G>
        )}
        <Rect x={0} y={v.y0} width={width} height={height - v.y0} fill={moon ? '#8b8d95' : '#6fbf5e'} />
        <Path d={lane} fill={moon ? '#9a9ca4' : '#7cca69'} />

        {/* Distance lines. */}
        {labels &&
          spots
            .filter(({ t }) => t.kind === 'face')
            .map(({ t }) => {
              const l = project(v, 0.06, targetY(t.dist, conditions.world));
              const r = project(v, 0.94, targetY(t.dist, conditions.world));
              return (
                <G key={`l${t.id}`}>
                  <Line x1={l.x} y1={l.y} x2={r.x} y2={r.y} stroke={moon ? '#a7a9b1' : '#8fd77a'} strokeWidth={1} opacity={0.8} />
                  {l.s > 0.15 && (
                    <SvgText x={Math.max(4, l.x - 2)} y={l.y - 3} fontFamily={font.headingSemibold} fontSize={Math.max(7, 9 * l.s + 4)} fill={moon ? '#2a2b31' : '#1f4a26'}>
                      {`${t.dist} m`}
                    </SvgText>
                  )}
                </G>
              );
            })}

        {/* Families on picnic blankets, beside the line. */}
        {!moon && showHound && (
          <G>
            <Rect x={0} y={hy - 92 * hs} width={70 * hs} height={40 * hs} rx={4} fill="#e07a5f" opacity={0.9} />
            <Rect x={10 * hs} y={hy - 46 * hs} width={60 * hs} height={30 * hs} rx={4} fill="#4d7fc4" opacity={0.9} />
            {[
              [16, 82, 6],
              [40, 78, 5],
              [56, 84, 6],
              [28, 36, 6],
              [52, 34, 4.5],
            ].map(([x, y, r], i) => (
              <Circle key={i} cx={x * hs} cy={hy - y * hs} r={r * hs} fill="#f2cc8f" />
            ))}
          </G>
        )}

        {/* The targets, far to near. */}
        {[...spots].reverse().map(({ t, at }) => {
          const on = selected === t.id;
          if (t.kind === 'clout') {
            const pole = 26 * at.s + 6;
            return (
              <G key={t.id}>
                <Ellipse cx={at.x} cy={at.y} rx={24 * at.s + 6} ry={4 * at.s + 1.5} fill="none" stroke="#ffffff" strokeWidth={0.8} />
                <Ellipse cx={at.x} cy={at.y} rx={12 * at.s + 3} ry={2 * at.s + 0.8} fill="none" stroke="#ffffff" strokeWidth={0.8} />
                <Line x1={at.x} y1={at.y} x2={at.x} y2={at.y - pole} stroke="#5a4a33" strokeWidth={1.2} />
                <ClothFlag x={at.x} top={at.y - pole} len={9 * at.s + 4} h={5} wind={longshotFlagWind(conditions.wind, now, 'far')} now={now} color={on ? '#f08a24' : '#e2412f'} />
              </G>
            );
          }
          if (t.kind === 'balloon' || t.kind === 'gold') {
            const d = bullseyeBalloon(conditions, t.id, now);
            const r = Math.max(2.5, at.s * width * 0.03 + 2);
            const bx = at.x + d.x * cmPx(at.s) * 2.2;
            const by = at.y - 30 * at.s - 10 + d.y * cmPx(at.s);
            return (
              <G key={t.id}>
                <Line x1={bx} y1={by + r} x2={at.x} y2={at.y} stroke="#ffffff" strokeWidth={0.7} opacity={0.8} />
                <Ellipse cx={bx} cy={by} rx={r} ry={r * 1.2} fill={BALLOON_COLOR[t.id] ?? '#e2412f'} stroke={on ? '#f08a24' : '#00000033'} strokeWidth={on ? 2 : 0.6} />
              </G>
            );
          }
          const r = Math.max(2.4, at.s * width * 0.05 * (t.face / 122) + 1.6);
          const boss = r * 1.25;
          return (
            <G key={t.id}>
              <Line x1={at.x - boss * 0.7} y1={at.y - boss * 0.2} x2={at.x - boss} y2={at.y} stroke="#5a4a33" strokeWidth={Math.max(0.8, r * 0.18)} />
              <Line x1={at.x + boss * 0.7} y1={at.y - boss * 0.2} x2={at.x + boss} y2={at.y} stroke="#5a4a33" strokeWidth={Math.max(0.8, r * 0.18)} />
              <Rect x={at.x - boss} y={at.y - boss * 2.3} width={boss * 2} height={boss * 2.1} fill="#d8b36a" stroke={on ? '#f08a24' : 'none'} strokeWidth={on ? 2 : 0} />
              <FaceRings cx={at.x} cy={at.y - boss * 1.25} r={r} />
            </G>
          );
        })}

        {showSocks && !moon && (
          <G>
            <Sock v={v} y={0.3} wind={longshotFlagWind(conditions.wind, now, 'far')} />
            <Sock v={v} y={0.6} wind={longshotFlagWind(conditions.wind, now, 'mid')} />
            <Sock v={v} y={0.88} wind={longshotFlagWind(conditions.wind, now, 'near')} />
          </G>
        )}

        {/* Your hound on the line, bow up. */}
        {showHound && (
          <G>
            <Ellipse cx={width / 2 + 5 * hs} cy={hy - 6 * hs} rx={44 * hs} ry={22 * hs} fill={moon ? '#e8e9ee' : '#c98b4f'} />
            {!moon && <Ellipse cx={width / 2 - 23 * hs} cy={hy - 26 * hs} rx={11 * hs} ry={17 * hs} fill="#8f5a2e" transform={`rotate(-14 ${width / 2 - 23 * hs} ${hy - 26 * hs})`} />}
            {!moon && <Ellipse cx={width / 2 + 33 * hs} cy={hy - 26 * hs} rx={11 * hs} ry={17 * hs} fill="#8f5a2e" transform={`rotate(14 ${width / 2 + 33 * hs} ${hy - 26 * hs})`} />}
            {moon ? (
              <Circle cx={width / 2 + 5 * hs} cy={hy - 30 * hs} r={23 * hs} fill="#cfe3f5" stroke="#e8e9ee" strokeWidth={4 * hs} />
            ) : (
              <Ellipse cx={width / 2 + 5 * hs} cy={hy - 30 * hs} rx={24 * hs} ry={20 * hs} fill="#d39a5e" />
            )}
            <BowArt bow={bow} x={width / 2 - 37 * hs} top={hy - 120 * hs} bottom={hy} bend={-1} s={hs} />
          </G>
        )}
      </Svg>
      {onPick &&
        spots.map(({ t, at }) => (
          <Pressable
            key={`p${t.id}`}
            onPress={() => onPick(t.id)}
            accessibilityRole="button"
            accessibilityLabel={`${t.kind === 'clout' ? 'The clout flag' : t.kind === 'gold' ? 'The gold balloon' : t.kind === 'balloon' ? 'A balloon' : 'The target'} at ${t.dist} meters`}
            style={{ position: 'absolute', left: at.x - 20, top: at.y - 44, width: 40, height: 44 }}
          />
        ))}
    </View>
  );
}

// Each bow drawn as itself (Steve, Nov 2026): the youth bow short and light,
// the longbow a tall plain D of dark wood, the recurve with a dark riser,
// limbs that flick back at the tips, a sight and a stabilizer, and the
// compound short and stiff with wheels (cams) on the ends, cables and a
// sight. The string runs straight down x from top to bottom; the bow bends
// away from the archer, to the left (bend -1) or right (+1).
export function BowArt({
  bow,
  x,
  top,
  bottom,
  bend = -1,
  s = 1,
  string = true,
}: {
  bow: string;
  x: number;
  top: number;
  bottom: number;
  bend?: number;
  s?: number;
  // Off in the close-up aim view, where the string is at your face.
  string?: boolean;
}) {
  const L = bottom - top;
  const mid = (top + bottom) / 2;
  const b = bend;
  if (bow === 'compound') {
    const t1 = top + L * 0.18;
    const t2 = bottom - L * 0.18;
    const camR = L * 0.045;
    const rx = x + b * L * 0.16;
    return (
      <G>
        {/* Cables and string between the cams. */}
        {string && <Line x1={x} y1={t1} x2={x} y2={t2} stroke="#f2f3f7" strokeWidth={1.2 * s} />}
        {string && <Line x1={x + b * camR * 0.6} y1={t1} x2={rx - b * 2 * s} y2={t2 - camR} stroke="#9aa0b4" strokeWidth={1 * s} />}
        {string && <Line x1={x + b * camR * 0.6} y1={t2} x2={rx - b * 2 * s} y2={t1 + camR} stroke="#9aa0b4" strokeWidth={1 * s} />}
        {/* Limbs, short and stiff. */}
        <Path d={`M${rx} ${mid - L * 0.2} Q ${rx - b * L * 0.02} ${t1 + L * 0.06} ${x + b * camR} ${t1}`} fill="none" stroke="#2b2d36" strokeWidth={6 * s} strokeLinecap="round" />
        <Path d={`M${rx} ${mid + L * 0.2} Q ${rx - b * L * 0.02} ${t2 - L * 0.06} ${x + b * camR} ${t2}`} fill="none" stroke="#2b2d36" strokeWidth={6 * s} strokeLinecap="round" />
        {/* The riser, machined metal, with a sight and a stabilizer. */}
        <Path d={`M${rx} ${mid - L * 0.22} L ${rx + b * L * 0.04} ${mid} L ${rx} ${mid + L * 0.22}`} fill="none" stroke="#6b7385" strokeWidth={8 * s} strokeLinejoin="round" strokeLinecap="round" />
        <Line x1={rx + b * L * 0.04} y1={mid + L * 0.02} x2={rx + b * L * 0.3} y2={mid - L * 0.05} stroke="#1b1d29" strokeWidth={2.5 * s} />
        <Circle cx={rx + b * L * 0.3} cy={mid - L * 0.05} r={3.5 * s} fill="#1b1d29" />
        <Rect x={Math.min(rx, rx - b * L * 0.08) - 1} y={mid - L * 0.1} width={L * 0.08} height={5 * s} fill="#1b1d29" />
        <Circle cx={rx - b * L * 0.08} cy={mid - L * 0.1 + 2.5 * s} r={2.6 * s} fill="#f08a24" />
        {/* The cams. */}
        <Circle cx={x + b * camR * 0.5} cy={t1} r={camR} fill="#c0c4cf" stroke="#3a3f4e" strokeWidth={1.5 * s} />
        <Circle cx={x + b * camR * 0.5} cy={t2} r={camR} fill="#c0c4cf" stroke="#3a3f4e" strokeWidth={1.5 * s} />
      </G>
    );
  }
  if (bow === 'recurve') {
    const rx = x + b * L * 0.17;
    return (
      <G>
        {string && <Line x1={x} y1={top + L * 0.02} x2={x} y2={bottom - L * 0.02} stroke="#f2f3f7" strokeWidth={1.2 * s} />}
        {/* Limbs out from the riser, flicking back toward the string at the tips. */}
        <Path
          d={`M${rx} ${mid - L * 0.16} Q ${rx} ${top + L * 0.12} ${x + b * L * 0.06} ${top + L * 0.05} Q ${x + b * L * 0.015} ${top + L * 0.02} ${x - b * L * 0.02} ${top}`}
          fill="none"
          stroke="#3a3f4e"
          strokeWidth={4.5 * s}
          strokeLinecap="round"
        />
        <Path
          d={`M${rx} ${mid + L * 0.16} Q ${rx} ${bottom - L * 0.12} ${x + b * L * 0.06} ${bottom - L * 0.05} Q ${x + b * L * 0.015} ${bottom - L * 0.02} ${x - b * L * 0.02} ${bottom}`}
          fill="none"
          stroke="#3a3f4e"
          strokeWidth={4.5 * s}
          strokeLinecap="round"
        />
        {/* The riser, a sight out front and a long stabilizer rod. */}
        <Line x1={rx} y1={mid - L * 0.18} x2={rx} y2={mid + L * 0.18} stroke="#2b2d36" strokeWidth={8 * s} strokeLinecap="round" />
        <Line x1={rx} y1={mid + L * 0.06} x2={rx + b * L * 0.38} y2={mid - L * 0.02} stroke="#1b1d29" strokeWidth={2 * s} />
        <Circle cx={rx + b * L * 0.38} cy={mid - L * 0.02} r={3 * s} fill="#1b1d29" />
        <Line x1={rx} y1={mid - L * 0.12} x2={rx - b * L * 0.07} y2={mid - L * 0.12} stroke="#1b1d29" strokeWidth={2 * s} />
        <Circle cx={rx - b * L * 0.07} cy={mid - L * 0.12} r={2.6 * s} fill="#f08a24" />
      </G>
    );
  }
  if (bow === 'youth') {
    const t1 = top + L * 0.14;
    const t2 = bottom - L * 0.14;
    const LL = t2 - t1;
    return (
      <G>
        {string && <Line x1={x} y1={t1} x2={x} y2={t2} stroke="#f2f3f7" strokeWidth={1 * s} />}
        <Path d={`M${x} ${t1} Q ${x + b * LL * 0.42} ${(t1 + t2) / 2} ${x} ${t2}`} fill="none" stroke="#e0a85c" strokeWidth={4 * s} strokeLinecap="round" />
        <Rect x={x + b * LL * 0.2 - 3 * s} y={(t1 + t2) / 2 - LL * 0.07} width={6 * s} height={LL * 0.14} rx={2 * s} fill="#3fa0d8" />
      </G>
    );
  }
  // The longbow: tall, plain wood, a leather grip, no sight.
  return (
    <G>
      {string && <Line x1={x} y1={top} x2={x} y2={bottom} stroke="#f2f3f7" strokeWidth={1 * s} />}
      <Path d={`M${x} ${top} Q ${x + b * L * 0.42} ${mid} ${x} ${bottom}`} fill="none" stroke="#5b3a1e" strokeWidth={5.5 * s} strokeLinecap="round" />
      <Rect x={x + b * L * 0.21 - 3.5 * s} y={mid - L * 0.06} width={7 * s} height={L * 0.12} rx={2 * s} fill="#2b1a0c" />
    </G>
  );
}
