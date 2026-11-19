import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { Text } from './Text';
import { crowdDots, groundPath, perspective, project, type Perspective } from './perspective';
import { font } from '../theme/tokens';
import type { BoutPunch, BoutPunchKind } from '../challenges/boutApi';

// Hound Bout's ring (0225), 2.5D like every sport: seen from behind your
// corner, the far ropes narrower, a stand of fans behind with the
// sponsor's apron in front, and every point through project(). The canvas
// is a square: x across (0 the left ropes), y from the far ropes (0) to
// the near ropes (1). Your hound stands near the bottom, its back to you;
// the opponent faces you from the middle of the ring; the referee is off
// to the right. Both hounds act out what happened: a punch, a guard
// catching it, a slip, a punch landing, a knockdown.

export type BoxerPose = 'idle' | BoutPunchKind | 'block' | 'slip' | 'hit' | 'down';
export interface BoxerAct {
  pose: BoxerPose;
  // How far into it, 0..1 (a punch goes out and back).
  k: number;
}

export interface RingView {
  v: Perspective;
  opp: { x: number; y: number; s: number };
  me: { x: number; y: number; s: number };
  ref: { x: number; y: number; s: number };
  apronTop: number;
  apronBottom: number;
}

export function ringView(w: number, h: number): RingView {
  const v = perspective(w, h, { stand: h * 0.2, gap: h * 0.08, near: 0, botW: w * 1.4, a: 0.66, b: 0.82 });
  return {
    v,
    opp: project(v, 0.5, 0.52),
    me: project(v, 0.5, 0.97),
    ref: project(v, 0.84, 0.3),
    apronTop: v.stand - h * 0.01,
    apronBottom: v.stand + h * 0.075,
  };
}

const ROPES = ['#e05b5b', '#f4f1ea', '#4f7be0'];

// The stand, the apron with the sponsor, the canvas and the ropes.
export const RingArt = React.memo(function RingArt({ rv, apron, compact = false }: { rv: RingView; apron: string; compact?: boolean }) {
  const { v } = rv;
  const crowd = useMemo(() => crowdDots(v.w, v.stand, compact), [v.w, v.stand, compact]);
  const floor = groundPath(v, [[0, 0], [1, 0], [1, 1.2], [0, 1.2]], true);
  const farStrip = groundPath(v, [[0, 0], [1, 0], [1, 0.06], [0, 0.06]], true);
  const P = (x: number, y: number) => project(v, x, y);
  const postH = (s: number) => v.h * 0.16 * s;
  const fl = P(0, 0);
  const fr = P(1, 0);
  const nl = P(-0.05, 1.25);
  const nr = P(1.05, 1.25);
  const word = apron.toUpperCase();
  const apronH = rv.apronBottom - rv.apronTop;
  const fs = Math.max(6, Math.min(apronH * 0.55, 12));
  const step = Math.max(70, word.length * fs * 0.72 + 30);
  const words = Array.from({ length: Math.ceil(v.w / step) + 1 }, (_, i) => i * step + step / 2);
  const logo = P(0.5, 0.18);
  return (
    <Svg style={StyleSheet.absoluteFill} width={v.w} height={v.h}>
      <Rect x={0} y={0} width={v.w} height={v.stand + 2} fill="#22243a" />
      {crowd.map((d, i) => (
        <Circle key={i} cx={d.x} cy={d.y} r={compact ? 1.6 : 2.2} fill={d.c} opacity={0.9} />
      ))}
      <Rect x={0} y={rv.apronTop} width={v.w} height={apronH} fill="#2f3150" />
      {words.map((x, i) => (
        <SvgText key={i} x={x} y={rv.apronTop + apronH / 2 + fs * 0.36} fontSize={fs} fontFamily={font.headingSemibold} fontWeight="800" fill="#f0c98a" textAnchor="middle" letterSpacing={0.8}>
          {word}
        </SvgText>
      ))}
      <Rect x={0} y={rv.apronBottom} width={v.w} height={v.h - rv.apronBottom} fill="#1d2133" />
      <Path d={floor} fill="#d9d2c2" />
      <Path d={farStrip} fill="#cfc7b6" />
      <Ellipse cx={logo.x} cy={logo.y} rx={v.w * 0.16 * logo.s} ry={v.h * 0.035 * logo.s} fill="none" stroke="#c9c0ac" strokeWidth={2} />
      {/* Posts and ropes. */}
      <Rect x={fl.x - 3.5 * fl.s} y={fl.y - postH(fl.s)} width={7 * fl.s} height={postH(fl.s)} rx={2} fill="#3a3c4c" />
      <Rect x={fr.x - 3.5 * fr.s} y={fr.y - postH(fr.s)} width={7 * fr.s} height={postH(fr.s)} rx={2} fill="#3a3c4c" />
      {ROPES.map((c, i) => {
        const at = (p: { x: number; y: number; s: number }) => p.y - postH(p.s) * (0.88 - i * 0.28);
        return (
          <G key={c} stroke={c} strokeLinecap="round" fill="none">
            <Line x1={fl.x} y1={at(fl)} x2={fr.x} y2={at(fr)} strokeWidth={compact ? 1.6 : 2.4} />
            <Line x1={fl.x} y1={at(fl)} x2={nl.x} y2={at(nl)} strokeWidth={compact ? 2.4 : 3.4} />
            <Line x1={fr.x} y1={at(fr)} x2={nr.x} y2={at(nr)} strokeWidth={compact ? 2.4 : 3.4} />
          </G>
        );
      })}
    </Svg>
  );
});

// The referee: white shirt, black stripes; counts over a knockdown.
export function Referee({ rv, counting }: { rv: RingView; counting: number | null }) {
  const s = rv.ref.s;
  const H = rv.v.h * 0.2 * s;
  const W = H * 0.6;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: rv.ref.x - W / 2, top: rv.ref.y - H, width: W, height: H }}>
      <Svg width={W} height={H} viewBox="0 0 60 100">
        <Ellipse cx={30} cy={97} rx={14} ry={3} fill="rgba(0,0,0,0.2)" />
        <Rect x={22} y={62} width={7} height={34} rx={3} fill="#2b2d3c" />
        <Rect x={31} y={62} width={7} height={34} rx={3} fill="#2b2d3c" />
        <Rect x={17} y={28} width={26} height={38} rx={7} fill="#f4f1ea" />
        <Path d="M23 28 L23 66 M30 28 L30 66 M37 28 L37 66" stroke="#2b2d3c" strokeWidth={2.2} />
        <Circle cx={30} cy={18} r={10} fill="#e7c39b" />
        {counting != null && <Line x1={43} y1={34} x2={56} y2={14} stroke="#e7c39b" strokeWidth={5} strokeLinecap="round" />}
      </Svg>
      {counting != null && (
        <Text style={[styles.count, { fontSize: Math.max(12, H * 0.28) }]}>{counting}</Text>
      )}
    </View>
  );
}

const out = (k: number) => (k < 0.5 ? k * 2 : (1 - k) * 2);

// A boxing hound. facing 'front': the opponent, looking at you; 'back':
// you, from behind. Drawn in a 100 x 140 box, bottom middle on its spot.
export function Boxer({
  at,
  height,
  facing,
  trunks,
  gloves,
  coat = '#b9854f',
  act,
}: {
  at: { x: number; y: number };
  height: number;
  facing: 'front' | 'back';
  trunks: string;
  gloves: string;
  coat?: string;
  act: BoxerAct;
}) {
  const H = height;
  const W = H * (100 / 140);
  const { pose, k } = act;
  const e = out(k);
  // The body: leaning out of a slip, rocked by a hit, flat on a knockdown.
  let tx = 0;
  let ty = 0;
  let rot = 0;
  if (pose === 'slip') {
    tx = -W * 0.28 * e;
    ty = H * 0.04 * e;
    rot = -14 * e;
  } else if (pose === 'hit') {
    tx = (facing === 'front' ? W * 0.06 : W * 0.04) * e;
    ty = (facing === 'front' ? -H * 0.03 : H * 0.03) * e;
    rot = 10 * e;
  } else if (pose === 'down') {
    rot = 78 * Math.min(1, k * 2.2);
    ty = H * 0.3 * Math.min(1, k * 2.2);
  }
  // The gloves: where they are, and how big (nearer the eye is bigger).
  let lg = { x: 30, y: 66, r: 11 };
  let rg = { x: 70, y: 64, r: 11 };
  if (pose === 'block') {
    lg = { x: 41, y: 40 - 6 * e, r: 12 };
    rg = { x: 59, y: 40 - 6 * e, r: 12 };
  } else if (pose === 'jab' || pose === 'hook' || pose === 'up') {
    const reach = facing === 'front' ? 1 : -1; // toward the eye, or away
    if (pose === 'jab') rg = { x: 70 - 16 * e, y: 64 + 28 * e * reach * (facing === 'front' ? 1 : 0.6) - (facing === 'back' ? 40 * e : 0), r: 11 + (facing === 'front' ? 9 : -4) * e };
    if (pose === 'hook') rg = { x: 70 + 14 * e - 34 * e * e, y: 58 - (facing === 'back' ? 30 : -14) * e, r: 11 + (facing === 'front' ? 7 : -3) * e };
    if (pose === 'up') lg = { x: 30 + 18 * e, y: 66 + (facing === 'back' ? -52 : 6) * e - 8 * e, r: 11 + (facing === 'front' ? 6 : -3) * e };
  }
  const head = facing === 'front' ? (
    <>
      <Ellipse cx={38} cy={24} rx={6} ry={12} fill="#5e3b26" />
      <Ellipse cx={62} cy={24} rx={6} ry={12} fill="#5e3b26" />
      <Circle cx={50} cy={22} r={15} fill={coat} />
      <Ellipse cx={50} cy={29} rx={8} ry={6} fill="#f1d9b8" />
      <Circle cx={50} cy={26} r={2.6} fill="#1b1d29" />
      {pose === 'hit' && e > 0.3 ? (
        <Path d="M41 16 l5 4 M54 20 l5 -4" stroke="#1b1d29" strokeWidth={2.4} strokeLinecap="round" />
      ) : (
        <>
          <Circle cx={44} cy={18} r={2} fill="#1b1d29" />
          <Circle cx={56} cy={18} r={2} fill="#1b1d29" />
        </>
      )}
    </>
  ) : (
    <>
      <Ellipse cx={34} cy={28} rx={8} ry={15} fill="#5e3b26" />
      <Ellipse cx={66} cy={28} rx={8} ry={15} fill="#5e3b26" />
      <Circle cx={50} cy={26} r={20} fill={coat} />
      <Path d="M38 18 Q50 10 62 18" stroke="#a87442" strokeWidth={2.4} fill="none" />
    </>
  );
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: at.x - W / 2, top: at.y - H, width: W, height: H, transform: [{ translateX: tx }, { translateY: ty }, { rotate: `${rot}deg` }] }}
    >
      <Svg width={W} height={H} viewBox="0 0 100 140">
        <Ellipse cx={50} cy={137} rx={26} ry={4} fill="rgba(0,0,0,0.24)" />
        <Rect x={36} y={96} width={11} height={40} rx={4} fill={coat} />
        <Rect x={53} y={96} width={11} height={40} rx={4} fill={coat} />
        <Rect x={30} y={84} width={40} height={22} rx={7} fill={trunks} />
        <Rect x={30} y={44} width={40} height={46} rx={16} fill={coat} />
        {facing === 'front' && <Ellipse cx={50} cy={64} rx={11} ry={14} fill="#f1d9b8" opacity={0.6} />}
        {head}
        <Circle cx={lg.x} cy={lg.y} r={lg.r} fill={gloves} />
        <Circle cx={rg.x} cy={rg.y} r={rg.r} fill={gloves} />
        {pose === 'hit' && e > 0.25 && (
          <Path d="M78 8 l5 -8 l2 8 l8 -3 l-4 7 l8 3 l-9 2 l3 8 l-7 -5 l-4 8 l-2 -9 z" fill="#fff6c8" />
        )}
      </Svg>
    </View>
  );
}

// A ticking clock for animations: now, while active.
export function useClock(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return now;
}

// ── The replay: a scored round, punch by punch ──

const BEAT = 1100; // one punch: thrown, then how it ended
const DOWN = 1800; // a knockdown's count

export interface ReplayBeat {
  start: number;
  end: number;
  p: BoutPunch;
  mine: boolean;
}

export function replayBeats(punches: BoutPunch[], me: string): { beats: ReplayBeat[]; total: number } {
  let t = 300;
  const beats = punches.map((p) => {
    const len = BEAT + (p.knockdown ? DOWN : 0);
    const b = { start: t, end: t + len, p, mine: p.by === me };
    t += len + 150;
    return b;
  });
  return { beats, total: t + 400 };
}

// What the beat shows at time t: who's doing what, the line under it.
export function beatActs(b: ReplayBeat, t: number): { me: BoxerAct; opp: BoxerAct; line: string; counting: number | null; down: boolean } {
  const k = (t - b.start) / BEAT;
  const throwK = Math.min(1, k / 0.42);
  const reactK = Math.max(0, Math.min(1, (k - 0.32) / 0.6));
  const p = b.p;
  const attacker: BoxerAct = { pose: p.punch, k: throwK };
  const outcome = p.quality === 'miss' ? 'miss' : p.blocked ? 'blocked' : p.slip === 'slipped' ? 'slipped' : 'landed';
  let defender: BoxerAct = { pose: 'idle', k: 0 };
  if (outcome === 'blocked') defender = { pose: 'block', k: reactK };
  else if (outcome === 'slipped' || outcome === 'miss') defender = { pose: 'slip', k: outcome === 'miss' ? reactK * 0.5 : reactK };
  else defender = { pose: 'hit', k: reactK };
  let counting: number | null = null;
  let down = false;
  if (p.knockdown && t - b.start > BEAT * 0.6) {
    const dk = (t - b.start - BEAT * 0.6) / DOWN;
    // Down, the count, then back up.
    defender = { pose: 'down', k: dk < 0.85 ? Math.min(1, dk * 2) : Math.max(0, 1 - (dk - 0.85) / 0.15) };
    counting = Math.min(8, 1 + Math.floor(dk * 8));
    down = true;
  }
  const name = p.punch === 'up' ? 'Uppercut' : p.punch === 'hook' ? 'Hook' : 'Jab';
  const line =
    outcome === 'miss'
      ? `${name}: missed`
      : outcome === 'blocked'
        ? p.countered
          ? `${name}: caught by the counter, +1 back`
          : `${name}: blocked by the guard`
        : outcome === 'slipped'
          ? `${name}: slipped`
          : down
            ? `${name} lands +${p.points}: down!`
            : `${name} lands +${p.points}`;
  return b.mine ? { me: attacker, opp: defender, line, counting, down } : { me: defender, opp: attacker, line, counting, down };
}

const styles = StyleSheet.create({
  count: { position: 'absolute', top: -22, left: 0, right: 0, textAlign: 'center', fontFamily: font.headingSemibold, color: '#ffffff' },
});
