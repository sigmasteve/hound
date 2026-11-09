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
// no lapSteps, the lap fits the day: whoever goes furthest ends just
// short of the line, so nobody laps anybody and the order reads round
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
  onDone,
}: {
  runners: TrackRunner[];
  width: number;
  lapSteps?: number;
  durationMs?: number;
  autoPlay?: boolean;
  // Tag: IT tags a runner it catches (the TAG! and the grey ring).
  tagging?: boolean;
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

  const lap = lapSteps ?? Math.max(1, ...runners.map((r) => r.startSteps + r.daySteps)) / 0.92;
  const it = tagging ? runners.find((r) => r.it) : undefined;
  // When (0 to 1) IT draws level with each runner, if it does today.
  const caughtAt = useMemo(() => {
    const m = new Map<string, number>();
    if (!it) return m;
    for (const r of runners) {
      if (r.id === it.id) continue;
      const gap = r.startSteps - it.startSteps;
      const gain = it.daySteps - r.daySteps;
      if (gain > 0 && gap >= 0 && gap < gain) m.set(r.id, gap / gain);
    }
    return m;
  }, [runners, it]);

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
        const at = caughtAt.get(r.id);
        const tagged = at !== undefined && t >= at;
        const justTagged = tagged && t - (at ?? 0) < 0.18;
        const ring = r.it && tagging ? IT_RED : tagged ? '#8a8f9c' : r.me ? '#ffd23f' : '#ffffff';
        return (
          <View
            key={r.id}
            pointerEvents="none"
            style={[styles.runner, { left: p.x - avatar / 2, top: p.y - avatar / 2, width: avatar, height: avatar, zIndex: r.it ? 20 : 10 }]}
          >
            <View style={[styles.face, { borderRadius: avatar / 2, borderColor: ring, opacity: tagged && !justTagged ? 0.75 : 1 }]}>
              <HoundArt {...r.hound} mood="happy" variant="avatar" size={avatar - 4} animate={false} />
            </View>
            {r.it && tagging && (
              <View style={styles.itBadge}>
                <Text style={styles.itText}>IT</Text>
              </View>
            )}
            {r.me && (
              <View style={styles.meTag}>
                <Text style={styles.meText}>You</Text>
              </View>
            )}
            {justTagged && (
              <View style={styles.tagPop}>
                <Text style={styles.tagPopText}>TAG!</Text>
              </View>
            )}
          </View>
        );
      })}

      {!playing && (
        <Pressable
          onPress={() => {
            setT(0);
            setPlaying(true);
          }}
          style={styles.replay}
          accessibilityRole="button"
          accessibilityLabel="Play the chase again"
        >
          <PlayIcon size={14} color="#ffffff" weight="fill" />
          <Text style={styles.replayText}>Replay</Text>
        </Pressable>
      )}
    </View>
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
