import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { Text } from './Text';
import { crowdDots, groundPath, perspective, project, type Perspective } from './perspective';
import { font } from '../theme/tokens';

// The Hound Shootout's scene (0221), 2.5D like every sport: the penalty
// area seen from behind the spot, facing the goal, the far end narrower,
// a stand of fans behind it with the sponsor's boards in front, and every
// point through project(). The ground is 16 yards across (x 0..1, the goal
// 8 yards in the middle, 0.25..0.75) and 14 yards long (y 0 the goal line,
// 1 just behind the penalty spot at 12 yards).

export const SPOT_Y = 12 / 14;
const FAR_GRASS = '#357f45';

export interface GoalBox {
  l: number;
  r: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface ShootoutView {
  v: Perspective;
  goal: GoalBox;
  boardsTop: number;
  boardsBottom: number;
  // The ball on the spot (d its size) and the kicker's feet.
  spot: { x: number; y: number; d: number };
  kicker: { x: number; y: number; s: number };
}

export function shootoutView(w: number, h: number): ShootoutView {
  // The goal about two thirds of the width (less on a short strip), and
  // the ground in perspective from its line to just behind the spot.
  const a = 0.62;
  const gw = Math.min(w * 0.66, h * 0.95);
  const botW = (2 * gw) / a;
  const gh = gw * 0.4;
  // The crossbar about a quarter of the way down: the stand fills above.
  const stand = Math.max(h * 0.12, h * 0.26 + gh * 0.05);
  const v = perspective(w, h, { stand, gap: gh * 0.95, near: 0, botW, a, b: 0.8 });
  const L = project(v, 0.25, 0);
  const R = project(v, 0.75, 0);
  const goal = { l: L.x, r: R.x, top: v.y0 - (R.x - L.x) * 0.4, bottom: v.y0, w: R.x - L.x, h: (R.x - L.x) * 0.4 };
  const sp = project(v, 0.5, SPOT_Y);
  const k = project(v, 0.4, 0.97);
  return {
    v,
    goal,
    boardsTop: stand,
    boardsBottom: stand + Math.max(9, (v.y0 - stand) * 0.36),
    spot: { x: sp.x, y: sp.y, d: Math.max(9, gh * 0.24) },
    kicker: { x: k.x, y: k.y, s: k.s },
  };
}

// The middle of each of the six spots in the goal (0-2 top, 3-5 low; left
// to right as the kicker sees it).
export function zonePoint(g: GoalBox, z: number): { x: number; y: number } {
  const col = z % 3;
  const row = Math.floor(z / 3);
  return { x: g.l + (g.w * (col * 2 + 1)) / 6, y: g.top + g.h * (row === 0 ? 0.28 : 0.72) };
}

// The stand, the boards, the grass and its lines, and the goal's net and
// frame. Drawn once per size.
export const GoalArt = React.memo(function GoalArt({ sv, board, compact = false }: { sv: ShootoutView; board: string; compact?: boolean }) {
  const { v, goal: g } = sv;
  const crowd = useMemo(() => crowdDots(v.w, v.stand, compact), [v.w, v.stand, compact]);
  const gp = (pts: [number, number][], close = false) => groundPath(v, pts.map(([x, y]) => [x / 16 + 0.5, y / 14] as [number, number]), close);
  const boardH = sv.boardsBottom - sv.boardsTop;
  const word = board.toUpperCase();
  const fs = Math.max(6, Math.min(boardH * 0.62, 13));
  const step = Math.max(60, word.length * fs * 0.72 + 26);
  const words = Array.from({ length: Math.ceil(v.w / step) + 1 }, (_, i) => i * step + step / 2 - (step - v.w % step) / 2);
  // Stripes across the grass, near to far.
  const stripes = [0, 2, 4, 6, 8, 10, 12].map((y) => gp([[-16, y], [16, y], [16, y + 1], [-16, y + 1]], true));
  const netCols = 10;
  const netRows = 4;
  const depth = g.h * 0.22;
  return (
    <Svg style={StyleSheet.absoluteFill} width={v.w} height={v.h}>
      <Rect x={0} y={0} width={v.w} height={v.stand + 2} fill="#22243a" />
      {crowd.map((d, i) => (
        <Circle key={i} cx={d.x} cy={d.y} r={compact ? 1.6 : 2.2} fill={d.c} opacity={0.9} />
      ))}
      {/* The boards: the sponsor's name all the way along. */}
      <Rect x={0} y={sv.boardsTop} width={v.w} height={boardH} fill="#2f3150" />
      <Rect x={0} y={sv.boardsTop} width={v.w} height={1.2} fill="rgba(255,255,255,0.25)" />
      {words.map((x, i) => (
        <SvgText key={i} x={x} y={sv.boardsTop + boardH / 2 + fs * 0.36} fontSize={fs} fontFamily={font.headingSemibold} fontWeight="800" fill="#f0c98a" textAnchor="middle" letterSpacing={0.6}>
          {word}
        </SvgText>
      ))}
      <Rect x={0} y={sv.boardsBottom} width={v.w} height={v.h - sv.boardsBottom} fill="#3a8a4c" />
      <Rect x={0} y={sv.boardsBottom} width={v.w} height={Math.max(0, v.y0 - sv.boardsBottom)} fill={FAR_GRASS} />
      {stripes.map((d, i) => (
        <Path key={i} d={d} fill="#40944f" />
      ))}
      {/* Lines: the goal line, the six-yard box, the penalty area, the spot. */}
      <G stroke="rgba(255,255,255,0.85)" strokeWidth={compact ? 1 : 1.5} fill="none">
        <Path d={gp([[-16, 0], [16, 0]])} />
        <Path d={gp([[-10, 0], [-10, 6], [10, 6], [10, 0]])} />
        <Path d={gp([[-22, 0], [-22, 18], [22, 18], [22, 0]])} />
      </G>
      <Ellipse cx={sv.spot.x} cy={sv.spot.y} rx={sv.spot.d * 0.32} ry={sv.spot.d * 0.12} fill="rgba(255,255,255,0.9)" />
      {/* The net: its back a little higher and narrower, then the mesh. */}
      <Path
        d={`M ${g.l} ${g.bottom} L ${g.l + depth * 0.5} ${g.top - depth * 0.4} L ${g.r - depth * 0.5} ${g.top - depth * 0.4} L ${g.r} ${g.bottom} Z`}
        fill="rgba(255,255,255,0.08)"
      />
      <G stroke="rgba(255,255,255,0.32)" strokeWidth={0.7}>
        {Array.from({ length: netCols - 1 }, (_, i) => {
          const x = g.l + (g.w * (i + 1)) / netCols;
          return <Line key={`c${i}`} x1={x} y1={g.top - depth * 0.4} x2={x} y2={g.bottom} />;
        })}
        {Array.from({ length: netRows }, (_, i) => {
          const y = g.top - depth * 0.4 + ((g.h + depth * 0.4) * (i + 1)) / (netRows + 1);
          return <Line key={`r${i}`} x1={g.l} y1={y} x2={g.r} y2={y} />;
        })}
      </G>
      <Path d={`M ${g.l} ${g.bottom} L ${g.l} ${g.top} L ${g.r} ${g.top} L ${g.r} ${g.bottom}`} stroke="#ffffff" strokeWidth={compact ? 2.5 : 3.5} strokeLinecap="round" fill="none" />
      <Ellipse cx={(g.l + g.r) / 2} cy={g.bottom + 1} rx={g.w * 0.55} ry={2.5} fill="rgba(0,0,0,0.12)" />
    </Svg>
  );
});

// The keeper: a hound in the sponsor's shirt with big gloves, on the line.
// dive: -1 left, 0 home, 1 right (as the kicker sees it); k how far into it
// (0..1); lift how high he stretches (0..1, for a ball up top).
export function Keeper({
  g,
  color,
  label,
  dive,
  k,
  lift = 0,
  lean = 0,
}: {
  g: GoalBox;
  color: string;
  label: string | null;
  dive: -1 | 0 | 1;
  k: number;
  lift?: number;
  lean?: number;
}) {
  const H = g.h * 0.86;
  const W = H * 1.3;
  const cx = W / 2;
  const reach = dive === 0 ? k : 0;
  const x0 = (g.l + g.r) / 2 - W / 2 + lean * g.w * 0.06;
  const tx = dive * g.w * 0.3 * k;
  const ty = -(lift * g.h * 0.35 + (dive === 0 ? 0.12 * g.h * k : 0)) * k;
  const rot = dive * 72 * k;
  const shoulder = H * 0.36;
  const armUp = H * (0.16 + 0.12 * reach);
  const glove = Math.max(3, H * 0.09);
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: x0, top: g.bottom - H + 2, width: W, height: H, transform: [{ translateX: tx }, { translateY: ty }, { rotate: `${rot}deg` }] }}
    >
      <Svg width={W} height={H}>
        <Ellipse cx={cx} cy={H - 2} rx={W * 0.16} ry={2.5} fill="rgba(0,0,0,0.28)" opacity={1 - k * 0.8} />
        <Rect x={cx - H * 0.11} y={H * 0.72} width={H * 0.08} height={H * 0.26} rx={2} fill="#2b2d3c" />
        <Rect x={cx + H * 0.03} y={H * 0.72} width={H * 0.08} height={H * 0.26} rx={2} fill="#2b2d3c" />
        <Rect x={cx - H * 0.15} y={H * 0.6} width={H * 0.3} height={H * 0.16} rx={3} fill="#1f2130" />
        <Rect x={cx - H * 0.17} y={shoulder - 2} width={H * 0.34} height={H * 0.3} rx={H * 0.08} fill={color} />
        {!!label && H >= 40 && (
          <SvgText x={cx} y={shoulder + H * 0.15} fontSize={Math.max(5, H * 0.075)} fontFamily={font.headingSemibold} fontWeight="800" fill="#161826" textAnchor="middle">
            {label.toUpperCase().slice(0, 10)}
          </SvgText>
        )}
        <Line x1={cx - H * 0.15} y1={shoulder + 3} x2={cx - H * 0.36} y2={shoulder + 3 - armUp} stroke={color} strokeWidth={Math.max(2.5, H * 0.07)} strokeLinecap="round" />
        <Line x1={cx + H * 0.15} y1={shoulder + 3} x2={cx + H * 0.36} y2={shoulder + 3 - armUp} stroke={color} strokeWidth={Math.max(2.5, H * 0.07)} strokeLinecap="round" />
        <Circle cx={cx - H * 0.37} cy={shoulder + 3 - armUp} r={glove} fill="#f4f6f8" stroke="#9aa3ad" strokeWidth={0.8} />
        <Circle cx={cx + H * 0.37} cy={shoulder + 3 - armUp} r={glove} fill="#f4f6f8" stroke="#9aa3ad" strokeWidth={0.8} />
        {/* A hound's head: floppy ears, a muzzle, a nose. */}
        <Ellipse cx={cx - H * 0.11} cy={H * 0.21} rx={H * 0.045} ry={H * 0.09} fill="#5e3b26" />
        <Ellipse cx={cx + H * 0.11} cy={H * 0.21} rx={H * 0.045} ry={H * 0.09} fill="#5e3b26" />
        <Circle cx={cx} cy={H * 0.19} r={H * 0.11} fill="#b9854f" />
        <Ellipse cx={cx} cy={H * 0.24} rx={H * 0.055} ry={H * 0.04} fill="#f1d9b8" />
        <Circle cx={cx} cy={H * 0.225} r={H * 0.018} fill="#1b1d29" />
        <Circle cx={cx - H * 0.04} cy={H * 0.17} r={H * 0.013} fill="#1b1d29" />
        <Circle cx={cx + H * 0.04} cy={H * 0.17} r={H * 0.013} fill="#1b1d29" />
      </Svg>
    </View>
  );
}

// A small goal for the board and Today: where each of the top scorers
// scores most, a dot with their initials at that spot.
export function ShootoutGoal({
  spots,
  board,
  keeperColor,
  height = 170,
}: {
  spots: { zone: number; initials: string; me: boolean; color: string }[];
  board: string;
  keeperColor: string;
  height?: number;
}) {
  const [w, setW] = React.useState(0);
  const sv = useMemo(() => (w > 0 ? shootoutView(w, height) : null), [w, height]);
  const r = sv ? Math.max(8, Math.min(11, sv.goal.h * 0.17)) : 9;
  // Two in the same spot sit side by side.
  const placed = useMemo(() => {
    if (!sv) return [];
    const seen: Record<number, number> = {};
    return spots.map((s) => {
      const n = seen[s.zone] ?? 0;
      seen[s.zone] = n + 1;
      const p = zonePoint(sv.goal, s.zone);
      return { ...s, x: p.x + (n === 0 ? 0 : (n % 2 ? 1 : -1) * Math.ceil(n / 2) * (2 * r + 2)), y: p.y };
    });
  }, [sv, spots, r]);
  return (
    <View style={{ height, borderRadius: 12, overflow: 'hidden', backgroundColor: '#1d2133' }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {sv && (
        <>
          <GoalArt sv={sv} board={board} compact />
          <Keeper g={sv.goal} color={keeperColor} label={null} dive={0} k={0} />
          {placed.map((s, i) => (
            <View
              key={i}
              style={[styles.dot, { left: s.x - r, top: s.y - r, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: s.color, borderWidth: s.me ? 2.5 : 2 }]}
            >
              <Text style={[styles.dotText, { fontSize: s.me ? 7 : 7.5 }]}>{s.me ? 'YOU' : s.initials.slice(0, 2).toUpperCase()}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { position: 'absolute', borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  dotText: { fontFamily: font.headingSemibold, color: '#ffffff' },
});
