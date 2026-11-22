import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { Text } from './Text';
import { font } from '../theme/tokens';

// Hitting the ball for real (0231; mockup claude.ai/artifact/HGso1dZWWMbsHBxMMfSxP5),
// shared by Baseball batting and the Home Run Derby. The pitch crosses
// the plate somewhere (px across, py up and down, in half-widths of the
// strike zone: |px|, |py| <= 1 is in it). You tap where it crosses as it
// gets there: where you tap is your swing, when you tap is your timing,
// and the server judges both.

// How you swing (Steve, Nov 2026: players found tapping the ball hard in
// the Derby): the timing meter, as before 0231 (Swing! as the marker
// crosses the middle; only your timing counts), or tapping where the ball
// crosses (where and when both count). The meter is the default; the
// pick is kept on this phone, for batting and the Derby alike.
export type SwingMode = 'meter' | 'tap';
const SWING_MODE_KEY = 'hound:swing-mode';

export function useSwingMode(): [SwingMode, (m: SwingMode) => void] {
  const [mode, setMode] = useState<SwingMode>('meter');
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(SWING_MODE_KEY)
      .then((v) => live && (v === 'tap' || v === 'meter') && setMode(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const pick = useCallback((m: SwingMode) => {
    setMode(m);
    AsyncStorage.setItem(SWING_MODE_KEY, m).catch(() => {});
  }, []);
  return [mode, pick];
}

// "Swing with: Meter | Tap the ball", over the pinned button.
export function SwingModeSwitch({ mode, onChange, disabled }: { mode: SwingMode; onChange: (m: SwingMode) => void; disabled?: boolean }) {
  return (
    <View style={[styles.switchRow, disabled && { opacity: 0.5 }]}>
      <Text style={styles.switchLabel}>Swing with</Text>
      {(['meter', 'tap'] as const).map((m) => {
        const on = mode === m;
        return (
          <Pressable
            key={m}
            onPress={() => !disabled && onChange(m)}
            disabled={disabled}
            style={[styles.switchPill, on && styles.switchPillOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.switchText, on && styles.switchTextOn]}>{m === 'meter' ? 'Meter' : 'Tap the ball'}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// The timing meter: EARLY on the left, LATE on the right, on time in the
// middle; bands (ms either side, widest first) and the marker (0 to 1).
export function TimingMeter({
  bands,
  barMs,
  mark,
  moving,
  label,
}: {
  bands: { ms: number; color: string }[];
  barMs: number;
  mark: number | null;
  moving: boolean;
  label: string;
}) {
  const share = (ms: number) => Math.max(0, Math.min(0.5, ms / barMs));
  return (
    <View style={styles.meter} accessibilityLabel={label}>
      <View style={[styles.band, { backgroundColor: '#e5484d', left: 0, width: '100%' }]} />
      {bands.map((b) => (
        <View key={`${b.ms}${b.color}`} style={[styles.band, { backgroundColor: b.color, left: `${(0.5 - share(b.ms)) * 100}%`, width: `${2 * share(b.ms) * 100}%` }]} />
      ))}
      <Text style={[styles.meterWord, { left: 10 }]}>EARLY</Text>
      <Text style={[styles.meterWord, { right: 10 }]}>LATE</Text>
      {mark != null && <View style={[styles.markerBar, { left: `${mark * 100}%` }, !moving && { borderColor: '#ffd8b0' }]} />}
    </View>
  );
}

// A quick 3, 2, 1 before the wind-up: Pitch is pinned at the bottom of
// the screen, so this is the moment to look up at the plate (Steve).
export const COUNT_MS = 900;
export const COUNT_STEP = 300;

export type ZoneBox = { x: number; y: number; hw: number; hh: number };
export type BallAt = { x: number; y: number; d: number };

// The zone on screen: centred at (x, y), half-width hw, half-height hh.
// Drawn a little bigger than life, so a thumb can find the ball in it.
export function zoneBox(zone: { x: number; y: number }, homeS: number, hs: number): ZoneBox {
  return { x: zone.x, y: zone.y, hw: hs * homeS * 0.34, hh: hs * homeS * 0.36 };
}

// Where (px, py) is on screen.
export function zonePoint(z: ZoneBox, px: number, py: number): { x: number; y: number } {
  return { x: z.x + px * z.hw, y: z.y - py * z.hh };
}

// A tap on screen, in the zone's units.
export function tapToZone(z: ZoneBox, x: number, y: number): { x: number; y: number } {
  return { x: (x - z.x) / z.hw, y: -(y - z.y) / z.hh };
}

// The pitch in flight, k from 0 (the hand) to 1 (crossing the plate) and
// on past it. A curveball starts up and breaks down late; a changeup
// fades a little.
export function pitchPoint(hand: BallAt, z: ZoneBox, p: { kind: string; px: number; py: number }, dEnd: number, k: number): BallAt {
  const end = zonePoint(z, p.px, p.py);
  const f = Math.min(1, k);
  const drop = p.kind === 'curveball' ? z.hh * 1.2 : p.kind === 'changeup' ? z.hh * 0.4 : 0;
  const x = hand.x + (end.x - hand.x) * k;
  const y = hand.y + (end.y - drop - hand.y) * k + drop * f * f * f;
  return { x, y, d: hand.d + (dEnd - hand.d) * f };
}

// "(18 ms late, 0.3 off the ball)" after a swing.
export function feelLine(timing: number | null, miss: number | null): string {
  if (timing == null) return '';
  const t = Math.round(timing);
  const when = Math.abs(t) <= 5 ? 'right on time' : `${Math.abs(t)} ms ${t < 0 ? 'early' : 'late'}`;
  const where = miss == null ? '' : miss <= 0.2 ? ', right on the ball' : `, ${miss.toFixed(1)} off the ball`;
  return ` (${when}${where})`;
}

export const PITCH_NAMES: Record<string, string> = { fastball: 'Fastball', curveball: 'Curveball', changeup: 'Changeup' };

// The 3, 2, 1 over the field.
export function Countdown({ n, color = '#f08a24' }: { n: number; color?: string }) {
  return (
    <View pointerEvents="none" style={[styles.count, { borderColor: color }]}>
      <Text style={styles.countText}>{n}</Text>
    </View>
  );
}

// The grip in the pitcher's glove during the wind-up: two lines for a
// fastball, an arc for a curveball, a circle for a changeup.
export function GripTell({ kind, x, y, size = 20 }: { kind: string; x: number; y: number; size?: number }) {
  const r = size / 2;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x - r, top: y - r }}>
      <Svg width={size} height={size}>
        <Circle cx={r} cy={r} r={r - 1} fill="#ffffff" stroke="#c94a3a" strokeWidth={1} />
        {kind === 'fastball' ? (
          <>
            <Line x1={r - 4} y1={r - 4} x2={r - 4} y2={r + 4} stroke="#c94a3a" strokeWidth={1.8} strokeLinecap="round" />
            <Line x1={r + 4} y1={r - 4} x2={r + 4} y2={r + 4} stroke="#c94a3a" strokeWidth={1.8} strokeLinecap="round" />
          </>
        ) : kind === 'curveball' ? (
          <Path d={`M ${r - 5} ${r + 3} Q ${r} ${r - 7} ${r + 5} ${r + 3}`} stroke="#c94a3a" strokeWidth={1.8} fill="none" strokeLinecap="round" />
        ) : (
          <Circle cx={r} cy={r} r={3.4} stroke="#c94a3a" strokeWidth={1.8} fill="none" />
        )}
      </Svg>
    </View>
  );
}

// Where you tapped: a gold ring.
export function TapMark({ x, y }: { x: number; y: number }) {
  return <View pointerEvents="none" style={[styles.mark, { left: x - 9, top: y - 9 }]} />;
}

const styles = StyleSheet.create({
  count: {
    position: 'absolute',
    alignSelf: 'center',
    top: '30%',
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2,
    backgroundColor: 'rgba(15,17,28,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontFamily: font.headingSemibold, fontSize: 42, color: '#ffffff' },
  mark: { position: 'absolute', width: 18, height: 18, borderRadius: 9, borderWidth: 2.5, borderColor: '#ffd27a' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  switchLabel: { fontFamily: font.headingSemibold, fontSize: 12, color: '#9a9ba6', marginRight: 2 },
  switchPill: { paddingHorizontal: 12, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(150,150,170,0.18)' },
  switchPillOn: { backgroundColor: '#f08a24' },
  switchText: { fontFamily: font.headingSemibold, fontSize: 12.5, color: '#9a9ba6' },
  switchTextOn: { color: '#161826' },
  meter: { height: 32, borderRadius: 16, overflow: 'hidden', position: 'relative' },
  band: { position: 'absolute', top: 0, bottom: 0 },
  meterWord: { position: 'absolute', top: 8, fontSize: 11, fontFamily: font.headingSemibold, color: '#161826' },
  markerBar: { position: 'absolute', top: 0, bottom: 0, width: 6, marginLeft: -3, borderRadius: 3, backgroundColor: '#161826', borderWidth: 2, borderColor: '#ffffff' },
});
