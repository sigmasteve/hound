import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Polygon, Polyline } from 'react-native-svg';
import { Text } from './Text';
import { HoundArt } from '../kennel/HoundArt';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

// A Distance pool's trail (0233; mockup claude.ai/artifact/17YoJpFbHGVeWq335R1hj1,
// board 3): the group walks one trail up a mountain together, the pack of
// hounds where the group's total has got to, a landmark at each quarter
// of the goal (gold once reached, with the day it was), and who walked
// how much. Tap a landmark for its card.

export interface PoolWalker {
  id: string;
  name: string;
  hound: Omit<React.ComponentProps<typeof HoundArt>, 'size' | 'mood' | 'variant'>;
  amount: number;
  me?: boolean;
}

export const LANDMARKS: { at: number; name: string; line: string }[] = [
  { at: 0, name: 'Trailhead', line: 'Where the pack set off.' },
  { at: 0.25, name: 'Pine Lake', line: 'A quarter of the way.' },
  { at: 0.5, name: 'Rope Bridge', line: 'Halfway up.' },
  { at: 0.75, name: 'Waterfall', line: 'Three quarters there.' },
  { at: 1, name: 'The Summit', line: 'The goal, together.' },
];

// The trail, in a 358 x 300 box, from the trailhead (near, bottom) to
// the summit (far, top).
const PATH: [number, number][] = [
  [60, 288], [150, 268], [250, 256], [300, 230], [220, 212], [110, 200], [70, 178], [140, 160], [250, 148], [290, 126], [230, 110], [150, 100], [110, 82], [150, 62], [190, 44], [190, 28],
];
const LENS = (() => {
  const out = [0];
  for (let i = 1; i < PATH.length; i++) out.push(out[i - 1] + Math.hypot(PATH[i][0] - PATH[i - 1][0], PATH[i][1] - PATH[i - 1][1]));
  return out;
})();
const TOTAL = LENS[LENS.length - 1];
function along(f: number): { x: number; y: number; i: number } {
  const d = Math.max(0, Math.min(1, f)) * TOTAL;
  for (let i = 1; i < PATH.length; i++)
    if (d <= LENS[i]) {
      const k = (d - LENS[i - 1]) / Math.max(1, LENS[i] - LENS[i - 1]);
      return { x: PATH[i - 1][0] + (PATH[i][0] - PATH[i - 1][0]) * k, y: PATH[i - 1][1] + (PATH[i][1] - PATH[i - 1][1]) * k, i };
    }
  const e = PATH[PATH.length - 1];
  return { x: e[0], y: e[1], i: PATH.length - 1 };
}
const SHARE_COLORS = ['#f08a24', '#4f7be0', '#7fd39b', '#b4aaf0', '#e9e9ed', '#f0c24a', '#e05b5b', '#3fb3c7'];

export function PoolTrail({
  walkers,
  goal,
  total,
  unit,
  reachedDay,
  width,
}: {
  walkers: PoolWalker[];
  goal: number;
  total: number;
  unit: string;
  // The challenge day (1-based) each landmark was reached, or null.
  reachedDay: (number | null)[];
  width: number;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const f = goal > 0 ? Math.min(1, total / goal) : 0;
  const nextIdx = LANDMARKS.findIndex((m) => m.at > f);
  const [picked, setPicked] = useState<number>(nextIdx >= 0 ? nextIdx : LANDMARKS.length - 1);
  const sx = width / 358;
  const H = 300 * sx;
  const p = along(f);
  const walked = [...PATH.slice(0, p.i), [p.x, p.y]].map(([x, y]) => `${x * sx},${y * sx}`).join(' ');
  const sum = walkers.reduce((a, w) => a + w.amount, 0) || 1;
  const pick = LANDMARKS[picked];
  const reached = pick.at <= f;
  const fmt = (x: number) => (unit === 'mi' ? `${Math.round(x).toLocaleString()} mi` : `${Math.round(x).toLocaleString()} steps`);
  const ordered = [...walkers].sort((a, b) => b.amount - a.amount);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ width, height: H, borderRadius: 16, overflow: 'hidden', backgroundColor: '#24324a' }}>
        <Svg width={width} height={H} style={StyleSheet.absoluteFill}>
          <Polygon points={[[0, 90], [60, 52], [120, 72], [190, 18], [260, 60], [310, 36], [358, 68], [358, 300], [0, 300]].map(([x, y]) => `${x * sx},${y * sx}`).join(' ')} fill="#3d5a6b" />
          <Polygon points={[[170, 34], [190, 18], [212, 38], [200, 36], [190, 44], [180, 38]].map(([x, y]) => `${x * sx},${y * sx}`).join(' ')} fill="#e9eef2" />
          <Polygon points={[[0, 128], [90, 98], [170, 120], [260, 90], [358, 112], [358, 300], [0, 300]].map(([x, y]) => `${x * sx},${y * sx}`).join(' ')} fill="#3e7a4a" />
          <Polygon points={[[0, 196], [120, 166], [240, 188], [358, 170], [358, 300], [0, 300]].map(([x, y]) => `${x * sx},${y * sx}`).join(' ')} fill="#46894f" />
          {[[30, 226], [320, 196], [20, 150], [330, 142], [300, 92], [40, 114], [270, 172], [100, 248], [330, 270], [15, 270]].map(([x, y], i) => {
            const s = (8 + (y / 300) * 8) * sx;
            return <Polygon key={i} points={`${x * sx},${y * sx - s * 2} ${x * sx - s * 0.7},${y * sx} ${x * sx + s * 0.7},${y * sx}`} fill="#2f6b3c" />;
          })}
          <Polyline points={PATH.map(([x, y]) => `${x * sx},${y * sx}`).join(' ')} fill="none" stroke="#d8c48f" strokeWidth={6 * sx} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
          <Polyline points={walked} fill="none" stroke="#f0c24a" strokeWidth={3.5 * sx} strokeLinecap="round" strokeLinejoin="round" />
          {LANDMARKS.map((m, i) => {
            const q = along(m.at);
            return <Circle key={i} cx={q.x * sx} cy={q.y * sx} r={8 * sx} fill={m.at <= f ? '#f0c24a' : '#9a9ba6'} stroke={picked === i ? '#ffffff' : '#161826'} strokeWidth={picked === i ? 2.5 : 1.5} />;
          })}
          <Ellipse cx={p.x * sx} cy={p.y * sx + 10} rx={22 * sx} ry={4 * sx} fill="rgba(0,0,0,0.3)" />
        </Svg>
        {/* The pack, together where the group has got to. */}
        {ordered.slice(0, 5).map((w, i) => {
          const q = along(Math.max(0, f - i * 0.012));
          const size = 26;
          return (
            <View key={w.id} pointerEvents="none" style={{ position: 'absolute', left: q.x * sx - size / 2 + (i % 2 ? 7 : -7), top: q.y * sx - size + 4 }}>
              <View style={[styles.houndRing, w.me && { borderColor: '#4f7be0' }]}>
                <HoundArt {...w.hound} mood="happy" variant="avatar" size={size - 4} animate={false} />
              </View>
            </View>
          );
        })}
        {LANDMARKS.map((m, i) => {
          const q = along(m.at);
          return (
            <Pressable
              key={m.name}
              onPress={() => setPicked(i)}
              accessibilityRole="button"
              accessibilityLabel={m.name}
              style={{ position: 'absolute', left: q.x * sx - 22, top: q.y * sx - 22, width: 44, height: 44 }}
            />
          );
        })}
        <Text style={styles.chip} pointerEvents="none">
          {f >= 1 ? 'At the summit!' : nextIdx >= 0 ? `Next: ${LANDMARKS[nextIdx].name} in ${fmt(LANDMARKS[nextIdx].at * goal - total)}` : ''}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={[styles.kicker, { color: reached ? '#f0c24a' : withAlpha(colors.text, 0.6) }]}>{reached ? 'LANDMARK REACHED' : 'COMING UP'}</Text>
        <Text style={styles.cardTitle}>{pick.name}</Text>
        <Text style={styles.cardLine}>
          {reached
            ? picked === 0
              ? pick.line
              : `${pick.line} Reached${reachedDay[picked] ? ` on day ${reachedDay[picked]}` : ''}.`
            : `${pick.line} ${fmt(pick.at * goal - total)} to go.`}
        </Text>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={styles.small}>Who walked it</Text>
        <View style={styles.bar}>
          {ordered.map((w, i) => (
            <View key={w.id} style={{ width: `${(w.amount / sum) * 100}%`, backgroundColor: SHARE_COLORS[i % SHARE_COLORS.length] }} />
          ))}
        </View>
        <View style={styles.legend}>
          {ordered.map((w, i) => (
            <View key={w.id} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: SHARE_COLORS[i % SHARE_COLORS.length] }]} />
              <Text style={styles.small}>
                {w.me ? 'You' : w.name} {fmt(w.amount)}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    houndRing: { width: 26, height: 26, borderRadius: 13, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
    chip: {
      position: 'absolute',
      left: 8,
      top: 8,
      backgroundColor: 'rgba(15,17,28,0.82)',
      color: '#fff',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      fontSize: 11.5,
      fontFamily: font.headingSemibold,
      overflow: 'hidden',
    },
    card: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 3, backgroundColor: withAlpha(colors.text, 0.06) },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11, letterSpacing: 0.6 },
    cardTitle: { fontFamily: font.headingSemibold, fontSize: 15.5, color: colors.text },
    cardLine: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.75) },
    small: { fontSize: 12, color: withAlpha(colors.text, 0.7) },
    bar: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: withAlpha(colors.text, 0.1) },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, columnGap: 12 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    dot: { width: 9, height: 9, borderRadius: 5 },
  });
}
