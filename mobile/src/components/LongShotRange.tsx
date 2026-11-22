import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { groundPath, perspective, project, type Perspective } from './perspective';
import { font } from '../theme/tokens';
import { longshotFlagWind, type LongShotConditions, type LongShotPlate } from '../challenges/longshotApi';

// Long Shot's range (0247), 2.5D like every field: seen from behind your
// bench, the plates down a long lane through perspective.ts and project()
// (x across, y from the far berm at 0 to the bench at 1), the wind flags
// near, mid and far, the gallery beside the firing line (a stand can't go
// behind the plates: that's where the rounds go), and your hound prone at
// the bench. Moon days: black sky, Earth up high, grey dust, no flags.

// Where each plate stands across the lane, so they don't hide each other.
const LANE_X: Record<number, number> = { 300: 0.32, 600: 0.64, 1000: 0.42, 1500: 0.58, 2000: 0.46, 2500: 0.54, 3000: 0.5, 4000: 0.53, 5000: 0.5 };

export function plateY(dist: number, far: number): number {
  return Math.max(0.02, 1 - (dist / far) * 0.97);
}

// The range's own ground: very long, the far end tiny.
export function rangeView(w: number, h: number): Perspective {
  return perspective(w, h, { stand: h * 0.27, near: h * 0.02, gap: 0, botW: w * 1.25, a: 0.05, b: 0.25 });
}

function Flag({ v, y, wind, moon }: { v: Perspective; y: number; wind: number; moon: boolean }) {
  const base = project(v, 0.9, y);
  const pole = 46 * base.s + 8;
  const len = Math.min(1, Math.abs(wind) / 14) * (30 * base.s + 6) + 3;
  const dir = wind >= 0 ? 1 : -1;
  // Light wind droops, strong wind stands the flag out.
  const droop = (1 - Math.min(1, Math.abs(wind) / 12)) * (16 * base.s + 3);
  if (moon) return null;
  const top = base.y - pole;
  return (
    <G>
      <Line x1={base.x} y1={base.y} x2={base.x} y2={top} stroke="#55503f" strokeWidth={Math.max(1, 2.4 * base.s)} />
      <Path
        d={`M${base.x} ${top} L${base.x + dir * len} ${top + droop + 3 * base.s} L${base.x} ${top + 9 * base.s + 3} Z`}
        fill="#f08a24"
      />
    </G>
  );
}

export function LongShotRangeArt({
  width,
  height,
  conditions,
  plates,
  selected,
  onPick,
  now,
  showFlags = true,
  showHound = true,
  labels = true,
}: {
  width: number;
  height: number;
  conditions: LongShotConditions;
  plates: LongShotPlate[];
  selected?: number | null;
  onPick?: (dist: number) => void;
  now: number;
  showFlags?: boolean;
  showHound?: boolean;
  labels?: boolean;
}) {
  const moon = conditions.world === 'moon';
  const far = moon ? 5000 : conditions.far;
  const v = useMemo(() => rangeView(width, height), [width, height]);
  const lane = groundPath(v, [[0, 0], [1, 0], [1, 1], [0, 1]], true);
  const mid = groundPath(v, [[0.4, 0], [0.6, 0], [0.75, 1], [0.25, 1]], true);
  const spots = plates.map((p) => {
    const at = project(v, LANE_X[p.dist] ?? 0.5, plateY(p.dist, far));
    // The plate's face, bigger up close and for the big plates.
    const r = Math.max(2.2, at.s * width * 0.05 * (p.size / 48) + 1.4);
    return { p, at, r };
  });
  const flagWind = (where: 'near' | 'mid' | 'far') => longshotFlagWind(conditions.wind, now, where);
  const sky = moon ? '#05060a' : '#7fa6c9';
  const ground = moon ? '#8b8d95' : '#9a8a62';
  const groundMid = moon ? '#9a9ca4' : '#a8996e';
  const hy = v.y1;
  const hs = width / 390;

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Rect x={0} y={0} width={width} height={v.y0 + 4} fill={sky} />
        {moon ? (
          <G>
            {[0.08, 0.2, 0.33, 0.5, 0.66, 0.79, 0.9].map((x, i) => (
              <Circle key={i} cx={x * width} cy={(0.05 + ((i * 37) % 17) / 100) * height} r={0.9} fill="#f2f3f7" />
            ))}
            <Circle cx={width * 0.8} cy={v.y0 * 0.42} r={v.y0 * 0.2} fill="#2f6fb4" />
            <Path
              d={`M${width * 0.77} ${v.y0 * 0.36} c${v.y0 * 0.06} -${v.y0 * 0.04} ${v.y0 * 0.13} -${v.y0 * 0.01} ${v.y0 * 0.14} ${v.y0 * 0.06} c0 ${v.y0 * 0.06} -${v.y0 * 0.07} ${v.y0 * 0.08} -${v.y0 * 0.11} ${v.y0 * 0.12} Z`}
              fill="#6aa86a"
            />
          </G>
        ) : (
          <G>
            <Rect x={0} y={0} width={width} height={v.y0 * 0.45} fill="#6b95bd" />
            <Path
              d={`M0 ${v.y0} L${width * 0.1} ${v.y0 * 0.72} L${width * 0.2} ${v.y0 * 0.86} L${width * 0.31} ${v.y0 * 0.6} L${width * 0.44} ${v.y0 * 0.82} L${width * 0.55} ${v.y0 * 0.66} L${width * 0.67} ${v.y0 * 0.84} L${width * 0.79} ${v.y0 * 0.58} L${width * 0.9} ${v.y0 * 0.8} L${width} ${v.y0 * 0.7} L${width} ${v.y0} Z`}
              fill="#5d6f86"
            />
          </G>
        )}
        <Rect x={0} y={v.y0} width={width} height={height - v.y0} fill={ground} />
        <Path d={lane} fill={ground} />
        <Path d={mid} fill={groundMid} />
        {/* The berm behind the far plates. */}
        <Rect x={width * 0.2} y={v.y0 - 3} width={width * 0.6} height={5} rx={2} fill={moon ? '#6b6d75' : '#8a7b5e'} />

        {/* Distance lines and their numbers. */}
        {labels &&
          spots.map(({ p }) => {
            const l = project(v, 0.05, plateY(p.dist, far));
            const r = project(v, 0.95, plateY(p.dist, far));
            return (
              <G key={`l${p.dist}`}>
                <Line x1={l.x} y1={l.y} x2={r.x} y2={r.y} stroke={moon ? '#a7a9b1' : '#c9bb8c'} strokeWidth={0.8} opacity={0.6} />
                {l.s > 0.12 && (
                  <SvgText fontFamily={font.headingSemibold} x={Math.max(4, l.x - 2)} y={l.y - 2} fontSize={Math.max(7, 10 * l.s + 4)} fontWeight="700" fill={moon ? '#2a2b31' : '#3d3524'}>
                    {p.dist.toLocaleString('en-US')}
                  </SvgText>
                )}
              </G>
            );
          })}

        {/* The gallery, beside the line. */}
        {!moon && showHound && (
          <G>
            <Rect x={0} y={hy - 112 * hs} width={64 * hs} height={72 * hs} fill="#3b4256" />
            <Rect x={0} y={hy - 112 * hs} width={64 * hs} height={8 * hs} fill="#2d3344" />
            {[0, 1, 2].map((row) =>
              [0, 1, 2, 3].map((c) => (
                <Circle
                  key={`${row}${c}`}
                  cx={(10 + c * 14 + (row % 2) * 6) * hs}
                  cy={hy - (94 - row * 17) * hs}
                  r={4 * hs}
                  fill={['#e07a5f', '#81b29a', '#f2cc8f'][(row + c) % 3]}
                />
              )),
            )}
          </G>
        )}

        {/* The plates, far to near, with their posts and shadows. */}
        {[...spots].reverse().map(({ p, at, r }) => {
          const on = selected === p.dist;
          const post = Math.max(2, r * 1.5);
          return (
            <G key={p.dist}>
              <Ellipse cx={at.x} cy={at.y} rx={r * 1.1} ry={Math.max(0.6, r * 0.3)} fill={moon ? '#6b6d75' : '#6d6043'} opacity={0.8} />
              <Line x1={at.x} y1={at.y} x2={at.x} y2={at.y - post} stroke="#4a4232" strokeWidth={Math.max(0.8, r * 0.25)} />
              <Circle
                cx={at.x}
                cy={at.y - post - r}
                r={r}
                fill={p.gold ? '#ffd34d' : '#f4f1e8'}
                stroke={on ? '#f08a24' : p.gold ? '#8a6a10' : '#3a3a3a'}
                strokeWidth={on ? Math.max(1.6, r * 0.35) : Math.max(0.5, r * 0.12)}
              />
              {p.hitToday && <Circle cx={at.x} cy={at.y - post - r} r={Math.max(1, r * 0.3)} fill="#3a7d55" />}
            </G>
          );
        })}

        {showFlags && !moon && (
          <G>
            <Flag v={v} y={0.25} wind={flagWind('far')} moon={moon} />
            <Flag v={v} y={0.55} wind={flagWind('mid')} moon={moon} />
            <Flag v={v} y={0.86} wind={flagWind('near')} moon={moon} />
          </G>
        )}

        {/* Your hound, prone at the bench. */}
        {showHound && (
          <G>
            <Rect x={width / 2 - 75 * hs} y={hy - 30 * hs} width={150 * hs} height={34 * hs} rx={4} fill={moon ? '#4a4c54' : '#5a4a33'} />
            <Ellipse cx={width / 2} cy={hy - 20 * hs} rx={46 * hs} ry={20 * hs} fill={moon ? '#e8e9ee' : '#c98b4f'} />
            {!moon && <Ellipse cx={width / 2 - 31 * hs} cy={hy - 34 * hs} rx={12 * hs} ry={18 * hs} fill="#8f5a2e" transform={`rotate(-18 ${width / 2 - 31 * hs} ${hy - 34 * hs})`} />}
            {!moon && <Ellipse cx={width / 2 + 31 * hs} cy={hy - 34 * hs} rx={12 * hs} ry={18 * hs} fill="#8f5a2e" transform={`rotate(18 ${width / 2 + 31 * hs} ${hy - 34 * hs})`} />}
            {moon ? (
              <Circle cx={width / 2} cy={hy - 42 * hs} r={24 * hs} fill="#cfe3f5" stroke="#e8e9ee" strokeWidth={4 * hs} />
            ) : (
              <Ellipse cx={width / 2} cy={hy - 42 * hs} rx={26 * hs} ry={20 * hs} fill="#d39a5e" />
            )}
            <Line x1={width / 2 + 8 * hs} y1={hy - 32 * hs} x2={width / 2 + 3 * hs} y2={hy - 122 * hs} stroke="#2b2b2b" strokeWidth={6 * hs} strokeLinecap="round" />
            <Rect x={width / 2 - 4 * hs} y={hy - 94 * hs} width={14 * hs} height={22 * hs} rx={4 * hs} fill="#3a3a3a" />
          </G>
        )}
      </Svg>
      {onPick &&
        spots.map(({ p, at, r }) => (
          <Pressable
            key={`t${p.dist}`}
            onPress={() => onPick(p.dist)}
            accessibilityRole="button"
            accessibilityLabel={`The plate at ${p.dist.toLocaleString('en-US')} yards, ${p.pts} points`}
            style={{ position: 'absolute', left: at.x - 18, top: at.y - r * 2 - Math.max(2, r * 1.5) - 18 + r, width: 36, height: 36 }}
          />
        ))}
    </View>
  );
}
