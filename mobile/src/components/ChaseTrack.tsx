import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import { PlayIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { HoundArt } from '../kennel/HoundArt';
import { font } from '../theme/tokens';

// A park running track: hounds go round it by their steps, one lane
// each. Made for Tag's chase replay (IT closing in, the TAG!), and kept
// general so other challenges can race on it too: give each runner where
// they start and how far they go, and it plays the day back.
//
// Positions are in steps. A lap is lapSteps; a runner at startSteps +
// daySteps * t is that far round at time t of the replay (0 to 1). The
// day is played back evenly, since only the day's total is known. With
// no lapSteps, the lap fits the day: whoever goes furthest ends about
// four-fifths round, so nobody laps anybody and the order reads round
// the track.

export interface TrackRunner {
  id: string;
  name: string;
  hound: Omit<React.ComponentProps<typeof HoundArt>, 'size' | 'mood' | 'variant'>;
  startSteps: number;
  daySteps: number;
  // Tag: the one chasing.
  it?: boolean;
  me?: boolean;
}

// The colours of a park, not the theme: a track reads the same either way.
const GRASS = '#7fbf6a';
const GRASS_DARK = '#6aa957';
const TRACK = '#d98d63';
const LINE = 'rgba(255,255,255,0.75)';
const IT_RED = '#e5484d';

export function ChaseTrack({
  runners,
  width,
  lapSteps,
  durationMs = 6_000,
  autoPlay = true,
  tagging = true,
  chaserLabel = 'IT',
  catchWord = 'TAG!',
  caughtRing = '#8a8f9c',
  onDone,
}: {
  runners: TrackRunner[];
  width: number;
  lapSteps?: number;
  durationMs?: number;
  autoPlay?: boolean;
  // Tag: IT tags a runner it catches (the TAG! and the grey ring).
  tagging?: boolean;
  // What the chaser's badge says, the pop when it catches someone, and
  // the caught runner's ring (Tag: IT, TAG!, grey; Chase: its own words).
  chaserLabel?: string;
  catchWord?: string;
  caughtRing?: string;
  onDone?: () => void;
}) {
  const W = width;
  const H = Math.round(W * 0.62);
  const lanes = Math.max(1, runners.length);
  // The stadium: two straights and two bends, lane 0 on the inside.
  const geo = useMemo(() => {
    const pad = 14;
    const outerR = (H - pad * 2) / 2;
    const laneW = Math.min(16, (outerR * 0.55) / lanes);
    const innerR = outerR - laneW * lanes;
    const L = W - pad * 2 - outerR * 2;
    return { cx: W / 2, cy: H / 2, outerR, innerR, laneW, L };
  }, [W, H, lanes]);

  const { t, playing, replay } = useReplay(durationMs, autoPlay, onDone);
  const lap = lapSteps ?? Math.max(1, ...runners.map((r) => r.startSteps + r.daySteps)) / 0.8;
  const caughtAt = useMemo(() => catchTimes(runners, tagging), [runners, tagging]);

  const avatar = Math.round(Math.min(34, Math.max(24, geo.laneW * 2)));

  return (
    <View style={{ width: W, height: H }}>
      <Svg width={W} height={H}>
        <Rect x={0} y={0} width={W} height={H} rx={18} fill={GRASS} />
        {/* A few trees and bushes round the edge. */}
        {[
          [0.06, 0.12, 13],
          [0.94, 0.14, 15],
          [0.04, 0.86, 12],
          [0.95, 0.84, 14],
          [0.5, 0.06, 9],
        ].map(([x, y, r], i) => (
          <G key={i}>
            <Circle cx={x * W} cy={y * H} r={r} fill={GRASS_DARK} />
            <Circle cx={x * W - r * 0.35} cy={y * H - r * 0.3} r={r * 0.55} fill="#8fd17a" opacity={0.7} />
          </G>
        ))}
        <Path d={stadium(geo.cx, geo.cy, geo.L, geo.outerR)} fill={TRACK} />
        <Path d={stadium(geo.cx, geo.cy, geo.L, geo.innerR)} fill={GRASS_DARK} />
        {/* The infield: a pond and a bench, so it's a park. */}
        <Ellipse cx={geo.cx - geo.L * 0.18} cy={geo.cy} rx={geo.innerR * 0.9} ry={geo.innerR * 0.42} fill="#8fd0ef" />
        <Ellipse cx={geo.cx - geo.L * 0.18 - geo.innerR * 0.25} cy={geo.cy - geo.innerR * 0.12} rx={geo.innerR * 0.3} ry={geo.innerR * 0.1} fill="#c4e8f8" />
        <Rect x={geo.cx + geo.L * 0.22} y={geo.cy - 4} width={26} height={8} rx={3} fill="#a0703c" />
        {Array.from({ length: lanes - 1 }, (_, i) => (
          <Path
            key={i}
            d={stadium(geo.cx, geo.cy, geo.L, geo.innerR + geo.laneW * (i + 1))}
            fill="none"
            stroke={LINE}
            strokeWidth={1}
            strokeDasharray="6 6"
          />
        ))}
        {/* The start line, on the bottom straight. */}
        <Line
          x1={geo.cx}
          y1={geo.cy + geo.innerR}
          x2={geo.cx}
          y2={geo.cy + geo.outerR}
          stroke="#ffffff"
          strokeWidth={3}
        />
      </Svg>

      {runners.map((r, lane) => {
        const steps = r.startSteps + r.daySteps * t;
        const laneR = geo.innerR + geo.laneW * (lane + 0.5);
        const p = pointOn(geo.cx, geo.cy, geo.L, laneR, (((steps / lap) % 1) + 1) % 1);
        return (
          <RunnerMarker
            key={r.id}
            runner={r}
            x={p.x}
            y={p.y}
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

      {!playing && runners.length > 0 && <ReplayButton onPress={replay} />}
    </View>
  );
}

// The replay's clock: t runs 0 to 1 over durationMs, on a plain timer
// (the same on phones and the web preview).
export function useReplay(durationMs: number, autoPlay: boolean, onDone?: () => void) {
  const [t, setT] = useState(autoPlay ? 0 : 1);
  const [playing, setPlaying] = useState(autoPlay);
  const started = useRef(0);
  useEffect(() => {
    if (!playing) return;
    started.current = Date.now();
    const timer = setInterval(() => {
      const k = Math.min(1, (Date.now() - started.current) / durationMs);
      setT(k);
      if (k >= 1) {
        clearInterval(timer);
        setPlaying(false);
        onDone?.();
      }
    }, 40);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, durationMs]);
  const replay = () => {
    setT(0);
    setPlaying(true);
  };
  return { t, playing, replay };
}

// When (0 to 1) the chaser draws level with each runner it catches.
export function catchTimes(runners: TrackRunner[], tagging: boolean): Map<string, number> {
  const m = new Map<string, number>();
  const it = tagging ? runners.find((r) => r.it) : undefined;
  if (!it) return m;
  for (const r of runners) {
    if (r.id === it.id) continue;
    const gap = r.startSteps - it.startSteps;
    const gain = it.daySteps - r.daySteps;
    if (gain > 0 && gap >= 0 && gap < gain) m.set(r.id, gap / gain);
  }
  return m;
}

// A hound on the course: its face in a ring (red for the chaser, grey
// once caught, gold for you), the chaser's badge, and the catch pop.
export function RunnerMarker({
  runner: r,
  x,
  y,
  size,
  t,
  caughtAt,
  tagging,
  chaserLabel,
  catchWord,
  caughtRing,
}: {
  runner: TrackRunner;
  x: number;
  y: number;
  size: number;
  t: number;
  caughtAt: number | undefined;
  tagging: boolean;
  chaserLabel: string;
  catchWord: string;
  caughtRing: string;
}) {
  const tagged = caughtAt !== undefined && t >= caughtAt;
  const justTagged = tagged && t - (caughtAt ?? 0) < 0.18;
  const ring = r.it && tagging ? IT_RED : tagged ? caughtRing : r.me ? '#ffd23f' : '#ffffff';
  return (
    <View
      pointerEvents="none"
      style={[styles.runner, { left: x - size / 2, top: y - size / 2, width: size, height: size, zIndex: r.it ? 20 : 10 }]}
    >
      <View style={[styles.face, { borderRadius: size / 2, borderColor: ring, opacity: tagged && !justTagged ? 0.75 : 1 }]}>
        <HoundArt {...r.hound} mood="happy" variant="avatar" size={size - 4} animate={false} />
      </View>
      {r.it && tagging && (
        <View style={styles.itBadge}>
          <Text style={styles.itText}>{chaserLabel}</Text>
        </View>
      )}
      {r.me && (
        <View style={styles.meTag}>
          <Text style={styles.meText}>You</Text>
        </View>
      )}
      {justTagged && (
        <View style={styles.tagPop}>
          <Text style={styles.tagPopText}>{catchWord}</Text>
        </View>
      )}
    </View>
  );
}

export function ReplayButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.replay} accessibilityRole="button" accessibilityLabel="Play the chase again">
      <PlayIcon size={14} color="#ffffff" weight="fill" />
      <Text style={styles.replayText}>Replay</Text>
    </Pressable>
  );
}

// A stadium (two straights of length L, bends of radius r) round cx, cy.
function stadium(cx: number, cy: number, L: number, r: number): string {
  const x0 = cx - L / 2;
  const x1 = cx + L / 2;
  return `M ${x0} ${cy + r} L ${x1} ${cy + r} A ${r} ${r} 0 0 0 ${x1} ${cy - r} L ${x0} ${cy - r} A ${r} ${r} 0 0 0 ${x0} ${cy + r} Z`;
}

// The point s of the way round (0 to 1), from the start line at the
// middle of the bottom straight, running right and round anticlockwise.
function pointOn(cx: number, cy: number, L: number, r: number, s: number): { x: number; y: number } {
  const P = 2 * L + 2 * Math.PI * r;
  let d = s * P;
  if (d < L / 2) return { x: cx + d, y: cy + r };
  d -= L / 2;
  if (d < Math.PI * r) {
    const a = Math.PI / 2 - d / r;
    return { x: cx + L / 2 + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }
  d -= Math.PI * r;
  if (d < L) return { x: cx + L / 2 - d, y: cy - r };
  d -= L;
  if (d < Math.PI * r) {
    const a = -Math.PI / 2 - d / r;
    return { x: cx - L / 2 + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }
  d -= Math.PI * r;
  return { x: cx - L / 2 + d, y: cy + r };
}

const styles = StyleSheet.create({
  runner: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  face: { width: '100%', height: '100%', borderWidth: 2.5, overflow: 'hidden', backgroundColor: '#fff6e8', alignItems: 'center', justifyContent: 'center' },
  itBadge: { position: 'absolute', top: -9, right: -10, backgroundColor: IT_RED, borderRadius: 7, paddingHorizontal: 4, paddingVertical: 1 },
  itText: { fontFamily: font.headingSemibold, fontSize: 9, color: '#ffffff', letterSpacing: 0.5 },
  meTag: { position: 'absolute', bottom: -13, backgroundColor: '#ffd23f', borderRadius: 6, paddingHorizontal: 4 },
  meText: { fontFamily: font.headingSemibold, fontSize: 9, color: '#3a2a00' },
  tagPop: { position: 'absolute', top: -22, backgroundColor: '#ffd23f', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1.5 },
  tagPopText: { fontFamily: font.headingSemibold, fontSize: 11, color: '#3a2a00' },
  replay: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  replayText: { fontFamily: font.heading, fontSize: 12.5, color: '#ffffff' },
});
