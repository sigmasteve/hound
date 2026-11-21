import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { PlayIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { HoundArt } from '../kennel/HoundArt';
import { crowdDots, groundPath, perspective, project } from './perspective';
import { useReplay } from './ChaseTrack';
import { font } from '../theme/tokens';
import type { Checkpoint } from '../challenges/stepStory';

// A Most steps race (0233; mockup claude.ai/artifact/17YoJpFbHGVeWq335R1hj1):
// a straight track in perspective (perspective.ts), seen from behind the
// start, each hound in its own lane, placed by its steps on a course of
// the challenge's days x 10,000. Checkpoint lines at a quarter, half and
// three quarters (a gold flag once someone's there), the finish at the
// far end under the stand. Every point (the lanes, the lines, the
// hounds) goes through project().
//
// It plays a stretch back: each runner from `from` steps to `to` (the
// race: where today began to now; yesterday's replay: where yesterday
// began to where it ended; the finish: the blackout to the end), and an
// overtake on the way gets a moment. Tap a hound for its steps.

export interface RaceRunner {
  id: string;
  name: string;
  hound: Omit<React.ComponentProps<typeof HoundArt>, 'size' | 'mood' | 'variant'>;
  from: number;
  to: number;
  me?: boolean;
  ribbons?: number;
  stars?: number;
}

const GRASS = '#3e8a4f';
const TAG_H = 18;
const TRACK = '#b8613e';
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export function StepRace({
  runners,
  course,
  checkpoints = [],
  width,
  height = 340,
  durationMs = 4200,
  autoPlay = true,
  blackout = null,
  finishLabel = 'FINISH',
  clock,
  onDone,
}: {
  runners: RaceRunner[];
  course: number;
  checkpoints?: Checkpoint[];
  width: number;
  height?: number;
  durationMs?: number;
  autoPlay?: boolean;
  // The Blackout's lines over the track; only your own hound shows.
  blackout?: { title: string; line: string } | null;
  finishLabel?: string;
  // The chip in the corner as it plays (t 0 → 1).
  clock?: (t: number) => string;
  onDone?: () => void;
}) {
  const v = useMemo(() => perspective(width, height, { stand: height * 0.17, gap: height * 0.01, near: height * 0.02, botW: width * 0.98, a: 0.5, b: 0.7 }), [width, height]);
  const crowd = useMemo(() => crowdDots(width, v.stand, true), [width, v.stand]);
  const { t, playing, replay } = useReplay(durationMs, autoPlay, onDone);
  const [picked, setPicked] = useState<string | null>(null);
  const k = ease(t);
  const n = Math.max(1, runners.length);
  // Room past the finish, so the hounds near it aren't bunched at the
  // narrow far end.
  const top = Math.max(course * 1.2, ...runners.map((r) => r.to * 1.1));
  // Ground y: the start line near (0.97), the finish far (0.06).
  const gy = (u: number) => 0.97 - 0.91 * Math.max(0, Math.min(1, u));
  const P = (x: number, u: number) => project(v, x, gy(u));
  const lane = (i: number) => (i + 0.5) / n;

  const at = runners.map((r) => r.from + (r.to - r.from) * k);
  // An overtake: the moment one runner goes past another, held a beat.
  let pass: string | null = null;
  if (playing || (t > 0 && t < 1)) {
    for (let a = 0; a < runners.length && !pass; a++)
      for (let b = 0; b < runners.length; b++) {
        const A = runners[a];
        const B = runners[b];
        if (a === b || !(A.from < B.from && A.to > B.to)) continue;
        const d0 = B.from - A.from;
        const kc = d0 / (d0 + (A.to - B.to));
        if (k >= kc && k < kc + 0.16) {
          pass = `${A.me ? 'You pass' : `${A.name} passes`} ${B.me ? 'you' : B.name}!`;
          break;
        }
      }
  }

  const shown = runners
    .map((r, i) => ({ r, i, u: at[i] / top }))
    .filter((x) => !blackout || x.r.me)
    .sort((p, q) => q.u - p.u);
  const pk = picked ? runners.find((r) => r.id === picked) : null;

  return (
    <View style={{ width, height, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1d2133' }}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={width} height={v.stand} fill="#1a1e30" />
        {crowd.map((c, i) => (
          <Circle key={i} cx={c.x} cy={c.y} r={2.2} fill={c.c} opacity={0.85} />
        ))}
        <Rect x={0} y={v.stand - 4} width={width} height={v.y0 - v.stand + 6} fill="#2d5a3a" />
        <Rect x={0} y={v.y0} width={width} height={height - v.y0} fill={GRASS} />
        <Path d={groundPath(v, [[0.03, 0], [0.97, 0], [0.97, 1], [0.03, 1]], true)} fill={TRACK} />
        {Array.from({ length: n - 1 }, (_, i) => {
          const x = 0.03 + (0.94 * (i + 1)) / n;
          return <Path key={i} d={groundPath(v, [[x, 0], [x, 1]])} stroke="rgba(255,255,255,0.45)" strokeWidth={1} />;
        })}
        {checkpoints.map((c) => {
          const u = c.at / top;
          if (u > 1) return null;
          const l = P(0.03, u);
          const r = P(0.97, u);
          const reached = !!c.firstId;
          return (
            <React.Fragment key={c.label}>
              <Line x1={l.x} y1={l.y} x2={r.x} y2={r.y} stroke="#ffffff" strokeWidth={1.3} strokeDasharray="4 4" opacity={0.7} />
              <Line x1={r.x + 3} y1={r.y} x2={r.x + 3} y2={r.y - 18 * r.s} stroke="#e9e9ed" strokeWidth={1.4} />
              <Polygon
                points={`${r.x + 3},${r.y - 18 * r.s} ${r.x + 3 + 12 * r.s},${r.y - 14 * r.s} ${r.x + 3},${r.y - 10 * r.s}`}
                fill={reached ? '#f0c24a' : '#9a9ba6'}
              />
              <SvgText x={l.x - 2} y={l.y - 3} fontSize={10} fontWeight="bold" fill="#ffffff" textAnchor="end">
                {c.label}
              </SvgText>
            </React.Fragment>
          );
        })}
        {(() => {
          const l = P(0.03, course / top);
          const r = P(0.97, course / top);
          return (
            <>
              <Line x1={l.x} y1={l.y} x2={r.x} y2={r.y} stroke="#ffffff" strokeWidth={4} strokeDasharray="5 5" />
              <SvgText x={(l.x + r.x) / 2} y={l.y - 6} fontSize={9.5} fontWeight="bold" fill="#ffffff" textAnchor="middle" letterSpacing={1.2}>
                {finishLabel}
              </SvgText>
            </>
          );
        })()}
      </Svg>

      {shown.map(({ r, i, u }) => {
        const q = P(0.03 + 0.94 * lane(i), Math.min(1, u));
        const size = 34 * q.s + 8;
        const bob = playing ? Math.sin(Date.now() / 90 + i) * 2 : 0;
        const sel = picked === r.id;
        const above = i % 2 === 1 && !sel;
        const tag = (
          <Text style={[styles.tag, above && { marginTop: 0, marginBottom: 2 }, r.me && styles.tagMe, sel && styles.tagSel]} numberOfLines={1}>
            {sel ? `${r.name} · ${Math.round(at[i]).toLocaleString()}` : r.name}
            {!sel && (r.stars ?? 0) > 0 ? ` ★${r.stars}` : ''}
          </Text>
        );
        return (
          <Pressable
            key={r.id}
            onPress={() => setPicked(sel ? null : r.id)}
            accessibilityRole="button"
            accessibilityLabel={`${r.name}, ${Math.round(at[i]).toLocaleString()} steps`}
            style={{ position: 'absolute', left: q.x - size / 2, top: q.y - size + bob - (above ? TAG_H : 0), width: size, alignItems: 'center', overflow: 'visible' }}
          >
            {/* Every other lane's tag sits above its hound, so neighbours
                don't run into each other where the lanes narrow. */}
            {above && tag}
            <View>
              <View style={[styles.shadow, { width: size * 0.7, left: size * 0.15, top: size - 4 }]} />
              <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }, r.me && styles.ringMe, sel && styles.ringSel]}>
                <HoundArt {...r.hound} mood="happy" variant="avatar" size={size - 4} animate={false} />
              </View>
              {(r.ribbons ?? 0) > 0 && <View style={[styles.ribbon, { right: -2 }]} />}
            </View>
            {!above && tag}
          </Pressable>
        );
      })}

      {blackout && (
        <View pointerEvents="none" style={styles.dark}>
          <Text style={styles.darkTitle}>{blackout.title}</Text>
          <Text style={styles.darkLine}>{blackout.line}</Text>
        </View>
      )}
      {(clock || pk) && (
        <Text style={[styles.chip, { left: 10 }]} pointerEvents="none">
          {pk ? `${pk.name} · ${Math.round(pk.to).toLocaleString()} steps` : clock?.(t)}
        </Text>
      )}
      {pass && (
        <View pointerEvents="none" style={styles.pass}>
          <Text style={styles.passText}>{pass}</Text>
        </View>
      )}
      {!playing && t >= 1 && durationMs > 0 && (
        <Pressable onPress={replay} hitSlop={8} accessibilityRole="button" accessibilityLabel="Play it again" style={styles.again}>
          <PlayIcon size={13} color="#ffffff" weight="fill" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: { position: 'absolute', height: 6, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.3)' },
  ring: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.12)' },
  ringMe: { borderColor: '#4f7be0' },
  ringSel: { borderColor: '#f0c24a' },
  ribbon: { position: 'absolute', top: 2, width: 9, height: 9, borderRadius: 5, backgroundColor: '#f0c24a', borderWidth: 1, borderColor: '#161826' },
  tag: {
    marginTop: 2,
    maxWidth: 120,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 10,
    fontFamily: font.headingSemibold,
    color: '#e9e9ed',
    backgroundColor: 'rgba(15,17,28,0.8)',
  },
  tagMe: { backgroundColor: '#4f7be0', color: '#ffffff' },
  tagSel: { backgroundColor: '#f0c24a', color: '#161826' },
  dark: { position: 'absolute', left: 0, right: 0, bottom: 0, top: '18%', backgroundColor: 'rgba(13,15,24,0.84)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 6 },
  darkTitle: { fontFamily: font.headingSemibold, fontSize: 24, color: '#e9e9ed', letterSpacing: 1 },
  darkLine: { fontSize: 12.5, color: '#c9cad3', textAlign: 'center', lineHeight: 18 },
  chip: {
    position: 'absolute',
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
  pass: { position: 'absolute', alignSelf: 'center', top: '40%', backgroundColor: '#f0c24a', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 8 },
  passText: { fontFamily: font.headingSemibold, fontSize: 18, color: '#161826' },
  again: { position: 'absolute', right: 8, top: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(15,17,28,0.82)', alignItems: 'center', justifyContent: 'center' },
});
