import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import { crowdDots, groundPath, perspective, project, sizeAt, type Perspective } from './perspective';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { useTheme } from '../theme/ThemeContext';
import { font, type Palette } from '../theme/tokens';
import { HOOPS_TEAM_COLOR, type HoopsTeam } from '../challenges/hoops';
import type { HoopsEvent, HoopsGame, HoopsPlayer } from '../challenges/hoopsApi';

// The half court in perspective (perspective.ts), seen from half court
// toward the hoop: the baseline far away, a stand behind it. Spots are
// shares of the court's width (x) and length (y, 0 at the far baseline,
// 1 at the half-court line), and everything (lines, players, the ball)
// goes through project(), so the replay lines up with the drawing.

const WOOD = '#d9a466';
const PLANK = '#c48d52';
const LINE = 'rgba(255,255,255,0.92)';
const KEY = 'rgba(145,132,217,0.78)';
const RIM = '#e8602c';

// The hoop's spot on the floor, and how much shorter than its width the
// half court is (47 by 50 feet), for round circles.
const HOOP = { x: 0.5, y: 0.105 };
const LEN = 47 / 50;

// Five spots for the side with the ball, and its defenders between each
// of them and the hoop.
const OFFENSE: { x: number; y: number }[] = [
  { x: 0.5, y: 0.8 },
  { x: 0.12, y: 0.56 },
  { x: 0.88, y: 0.56 },
  { x: 0.1, y: 0.17 },
  { x: 0.9, y: 0.19 },
];
const toward = (p: { x: number; y: number }, k: number) => ({ x: p.x + (HOOP.x - p.x) * k, y: p.y + (HOOP.y - p.y) * k });
// A defender: between their man and the hoop, a little to the inside.
const guardSpot = (p: { x: number; y: number }) => {
  const t = toward(p, 0.2);
  return { x: t.x + (p.x < 0.5 ? 0.06 : p.x > 0.5 ? -0.06 : 0.07), y: t.y };
};

// Where a shot of each kind goes up from.
function shotSpot(e: HoopsEvent, home: { x: number; y: number }): { x: number; y: number } {
  if (e.kind === 'ft') return { x: 0.5, y: 0.4 };
  if (e.kind === 'putback') return { x: 0.47, y: 0.17 };
  if (e.kind === 'drive') return { x: 0.52, y: e.dunk ? 0.14 : 0.18 };
  if (e.kind === 'mid') return { x: home.x < 0.5 ? 0.3 : 0.7, y: 0.3 };
  // A three: from the arc, on the shooter's side.
  const left = home.x < 0.5;
  return home.y > 0.6 ? { x: 0.5, y: 0.63 } : { x: left ? 0.09 : 0.91, y: 0.25 };
}

export type CourtView = Perspective;
export function courtView(w: number, h: number, compact: boolean): CourtView {
  // A gap under the stand, so the backboard stands clear of the crowd.
  return perspective(w, h, { stand: h * (compact ? 0.1 : 0.12), gap: h * (compact ? 0.13 : 0.14) });
}

// The rim, up in the air over its spot: its centre on screen.
function rimAt(v: CourtView) {
  const p = project(v, HOOP.x, HOOP.y);
  const lift = 0.26 * v.botW * p.s;
  return { x: p.x, y: p.y - lift, rx: Math.max(8, 0.045 * v.botW * p.s), floorY: p.y, s: p.s };
}

const WORD: Record<string, string> = {};
function resultWord(e: HoopsEvent): string {
  if (e.kind === 'ft') return e.made ? 'GOOD +1' : 'NO GOOD';
  if (!e.made) return e.dunk ? 'BLOCKED' : 'MISS';
  if (e.dunk) return `DUNK +${e.pts}`;
  if (e.kind === 'three') return e.onFire ? `ON FIRE +3` : 'SWISH +3';
  return `+${e.pts}`;
}
void WORD;

export function HoopsCourt({
  game,
  compact,
  play,
  spot,
}: {
  game: HoopsGame;
  compact?: boolean;
  // Two players side by side here (H-O-R-S-E: where today's shot is from).
  spot?: { x: number; y: number };
  // A shot to replay; a new n replays it (again).
  play?: { event: HoopsEvent; n: number } | null;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [w, setW] = useState(0);
  const h = w * (compact ? 0.72 : 0.92);
  const view = useMemo(() => courtView(w, h, !!compact), [w, h, compact]);
  const size = compact ? 26 : 36;

  // The side with the ball: the shooter's in a replay, else mine (or home).
  const meP = game.players.find((p) => p.id === game.me) ?? null;
  const offTeam: HoopsTeam = play?.event.team ?? meP?.team ?? 'home';
  const defTeam: HoopsTeam = offTeam === 'home' ? 'away' : 'home';

  // Five a side on the court: whoever's shooting, then by points and steps.
  const spots = useMemo(() => {
    const pick = (team: HoopsTeam, must: string | null) => {
      const list = game.players
        .filter((p) => p.team === team)
        .sort((a, b) => Number(b.id === must) - Number(a.id === must) || b.pts - a.pts || b.stepsToday - a.stepsToday);
      return list.slice(0, 5);
    };
    const shooter = play?.event.shooter ?? null;
    const out = new Map<string, { at: { x: number; y: number }; p: HoopsPlayer }>();
    if (spot) {
      game.players.slice(0, 2).forEach((p, i) => out.set(p.id, { at: { x: spot.x + (i ? 0.08 : -0.08), y: spot.y }, p }));
      return out;
    }
    const off = pick(offTeam, shooter);
    off.forEach((p, i) => out.set(p.id, { at: OFFENSE[i], p }));
    // Each defender on whoever they guard if that one's on the court.
    const def = pick(defTeam, play?.event.defender ?? null);
    const free = OFFENSE.map((_, i) => i);
    const used = new Set<number>();
    def.forEach((p) => {
      const iGuard = off.findIndex((o) => o.id === p.guarding);
      const i = iGuard >= 0 && !used.has(iGuard) ? iGuard : free.find((k) => !used.has(k)) ?? 0;
      used.add(i);
      out.set(p.id, { at: guardSpot(OFFENSE[i]), p });
    });
    return out;
  }, [game.players, offTeam, defTeam, play?.event.shooter, play?.event.defender, spot?.x, spot?.y]);

  // Replay: each player's offset from their spot, the ball's spot, its
  // size (a dunk's ball is bigger, nearer the eye), and the word.
  const moves = useRef(new Map<string, Animated.ValueXY>()).current;
  const moveOf = (id: string) => {
    let v = moves.get(id);
    if (!v) {
      v = new Animated.ValueXY({ x: 0, y: 0 });
      moves.set(id, v);
    }
    return v;
  };
  const ball = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const ballOn = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const swish = useRef(new Animated.Value(0)).current;
  const [wordText, setWordText] = useState<{ text: string; good: boolean } | null>(null);

  useEffect(() => {
    if (!play || w === 0) return;
    const e = play.event;
    const s = spots.get(e.shooter);
    if (!s) return;
    const px = (p: { x: number; y: number }) => {
      const q = project(view, p.x, p.y);
      return { x: q.x, y: q.y, s: q.s };
    };
    const rim = rimAt(view);
    const from = shotSpot(e, s.at);
    const off = (id: string, to: { x: number; y: number }) => {
      const b = spots.get(id);
      if (!b) return { x: 0, y: 0 };
      const a = px(b.at);
      const t = px(to);
      return { x: t.x - a.x, y: t.y - a.y };
    };
    const run = (v: Animated.ValueXY, to: { x: number; y: number }, ms: number) =>
      Animated.timing(v, { toValue: to, duration: ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true });

    moves.forEach((v) => v.setValue({ x: 0, y: 0 }));
    const fromPx = px(from);
    const hand = { x: fromPx.x + 6 * fromPx.s, y: fromPx.y - size * 1.05 * fromPx.s };
    ball.setValue({ x: px(s.at).x, y: px(s.at).y - size * 0.9 });
    ballOn.setValue(1);
    word.setValue(0);
    swish.setValue(0);
    setWordText({ text: resultWord(e), good: e.made });

    // The ball's flight: a high arc for a jump shot, a short one for a
    // drive or a putback, straight down for a dunk.
    const high = e.kind === 'three' ? 90 : e.kind === 'mid' || e.kind === 'ft' ? 70 : 34;
    const ctrl = { x: (hand.x + rim.x) / 2, y: Math.min(hand.y, rim.y) - high * (w / 360) };
    const n = 9;
    const arc: { x: number; y: number }[] = [];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      arc.push({
        x: (1 - t) * (1 - t) * hand.x + 2 * (1 - t) * t * ctrl.x + t * t * rim.x,
        y: (1 - t) * (1 - t) * hand.y + 2 * (1 - t) * t * ctrl.y + t * t * (rim.y - 3),
      });
    }
    const flight = e.dunk && e.made
      ? [Animated.timing(ball, { toValue: { x: rim.x, y: rim.y - 14 }, duration: 260, useNativeDriver: true })]
      : arc.map((p) => Animated.timing(ball, { toValue: p, duration: (e.kind === 'drive' || e.kind === 'putback' ? 520 : 900) / n, easing: Easing.linear, useNativeDriver: true }));
    const down = e.made
      ? [
          Animated.parallel([
            Animated.timing(ball, { toValue: { x: rim.x, y: rim.y + 16 }, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
            Animated.sequence([
              Animated.timing(swish, { toValue: 1, duration: 130, useNativeDriver: true }),
              Animated.timing(swish, { toValue: 0, duration: 200, useNativeDriver: true }),
            ]),
          ]),
          Animated.timing(ball, { toValue: { x: rim.x, y: rim.floorY - 4 }, duration: 300, easing: Easing.bounce, useNativeDriver: true }),
        ]
      : [
          // Off the rim and out to the side.
          Animated.timing(ball, { toValue: { x: rim.x + (from.x < 0.5 ? 1 : -1) * rim.rx * 1.6, y: rim.y - 16 }, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(ball, {
            toValue: px({ x: from.x < 0.5 ? 0.66 : 0.34, y: 0.24 }),
            duration: 420,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ];

    const defender = e.defender && spots.has(e.defender) ? e.defender : null;
    const shooterTo = e.dunk ? { x: from.x, y: from.y - 0.01 } : from;
    const lead = [
      run(moveOf(e.shooter), off(e.shooter, shooterTo), 700),
      run(ball, { x: fromPx.x, y: fromPx.y - size * 0.9 * fromPx.s }, 700),
      ...(defender ? [run(moveOf(defender), off(defender, guardSpot(from)), 750)] : []),
    ];
    // A dunk: the shooter rises to the rim.
    const rise = e.dunk ? [Animated.timing(moveOf(e.shooter), { toValue: { ...off(e.shooter, shooterTo), y: off(e.shooter, shooterTo).y - (fromPx.y - rim.y) * 0.75 }, duration: 260, useNativeDriver: true })] : [];
    const back = [e.shooter, ...(defender ? [defender] : [])].map((id) => run(moveOf(id), { x: 0, y: 0 }, 500));
    const anim = Animated.sequence([
      Animated.parallel(lead),
      Animated.parallel([...rise, Animated.sequence(flight)]),
      Animated.sequence(down),
      Animated.timing(word, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(900),
      Animated.parallel([...back, Animated.timing(ballOn, { toValue: 0, duration: 400, useNativeDriver: true }), Animated.timing(word, { toValue: 0, duration: 400, useNativeDriver: true })]),
    ]);
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play?.n, w]);

  useEffect(() => {
    if (play) return;
    moves.forEach((v) => v.setValue({ x: 0, y: 0 }));
    ballOn.setValue(0);
    word.setValue(0);
  }, [play, moves, ballOn, word]);

  const rim = w > 0 ? rimAt(view) : null;
  const ballSize = compact ? 12 : 17;
  const lit = new Set<string>(play ? [play.event.shooter, ...(play.event.defender ? [play.event.defender] : [])] : []);
  // Far players first, so nearer ones stand in front.
  const ordered = [...spots.values()].sort((a, b) => a.at.y - b.at.y);

  return (
    <View
      onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}
      style={[styles.court, { height: h || undefined, aspectRatio: w ? undefined : compact ? 1 / 0.72 : 1 / 0.92 }]}
      accessible
      accessibilityLabel={`The court: ${game.teams.home.name} ${game.teams.home.score}, ${game.teams.away.name} ${game.teams.away.score}`}
    >
      {w > 0 && rim && (
        <>
          <CourtArt view={view} compact={!!compact} />
          {ordered.map(({ at, p }) => {
            const q = project(view, at.x, at.y);
            const sz = sizeAt(view, q.s, size);
            const isMe = p.id === game.me;
            const on = lit.has(p.id);
            const labelW = Math.max(sz + 10, compact ? 44 : 64);
            return (
              <Animated.View
                key={p.id}
                pointerEvents="none"
                style={[
                  styles.slot,
                  { left: q.x - labelW / 2, top: q.y - sz - 4, width: labelW, zIndex: on ? 3 : 1, opacity: p.joined ? 1 : 0.45 },
                  { transform: moveOf(p.id).getTranslateTransform() },
                ]}
              >
                <View style={[styles.shadow, { width: sz * 0.85, height: sz * 0.22, borderRadius: sz, top: sz + 1, left: (labelW - sz * 0.85) / 2 }]} />
                <View
                  style={[
                    styles.ring,
                    { width: sz + 6, height: sz + 6, borderRadius: (sz + 6) / 2, borderColor: HOOPS_TEAM_COLOR[p.team] },
                    isMe && { borderColor: colors.amber },
                    on && !isMe && { borderColor: '#ffffff' },
                  ]}
                >
                  <Avatar
                    initials={p.initials}
                    tint={p.bot ? colors.neutral800 : p.team === 'home' ? '#7a4416' : '#26407a'}
                    size={sz}
                    fontSize={compact ? 10 : 12}
                    frameId={p.frameId}
                    backgroundId={p.backgroundId}
                    iconId={p.iconId}
                  />
                </View>
                {!compact && (
                  <Text style={[styles.slotName, isMe && styles.slotNameMe]} numberOfLines={1}>
                    {isMe ? 'You' : p.name.split(' ')[0]}
                  </Text>
                )}
              </Animated.View>
            );
          })}

          {/* The ball, during a replay; then the rim's front and the net
              over it, so a make drops through. */}
          <Animated.View
            pointerEvents="none"
            style={[styles.ball, { width: ballSize, height: ballSize, left: -ballSize / 2, top: -ballSize / 2, opacity: ballOn }, { transform: ball.getTranslateTransform() }]}
          >
            <Basketball size={ballSize} />
          </Animated.View>
          <Svg width={w} height={h} style={[StyleSheet.absoluteFill, { zIndex: 5 }]} pointerEvents="none">
            <Net rim={rim} />
          </Svg>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.swish,
              { left: rim.x - rim.rx * 1.6, top: rim.y - rim.rx * 0.6, width: rim.rx * 3.2, height: rim.rx * 2.6, opacity: swish },
            ]}
          />
          {wordText && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.word,
                wordText.good && styles.wordGood,
                { left: Math.max(4, Math.min(w - 104, rim.x - 50)), top: rim.y + 30, opacity: word, transform: [{ scale: word.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] },
              ]}
            >
              <Text style={styles.wordText}>{wordText.text}</Text>
            </Animated.View>
          )}
        </>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    court: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#1d2133' },
    shadow: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.24)' },
    slot: { position: 'absolute', alignItems: 'center', gap: 1 },
    ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 2.5 },
    slotName: {
      color: '#ffffff',
      fontSize: 11,
      fontFamily: font.heading,
      maxWidth: '100%',
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowRadius: 3,
      textShadowOffset: { width: 0, height: 1 },
    },
    slotNameMe: { color: '#ffe3a3' },
    ball: { position: 'absolute', zIndex: 4 },
    swish: { position: 'absolute', zIndex: 6, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.35)' },
    word: { position: 'absolute', width: 100, alignItems: 'center', paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(22,24,38,0.82)', zIndex: 7 },
    wordGood: { backgroundColor: colors.amber },
    wordText: { color: '#ffffff', fontFamily: font.heading, fontSize: 13, letterSpacing: 0.6 },
  });
}

// The rim's front half and the net hanging under it.
function Net({ rim }: { rim: ReturnType<typeof rimAt> }) {
  const ry = rim.rx * 0.34;
  const strands = Array.from({ length: 7 }, (_, i) => {
    const x0 = rim.x - rim.rx + (2 * rim.rx * i) / 6;
    const x1 = rim.x - rim.rx * 0.55 + (1.1 * rim.rx * i) / 6;
    return `M ${x0.toFixed(1)} ${(rim.y + 1).toFixed(1)} L ${x1.toFixed(1)} ${(rim.y + rim.rx * 1.3).toFixed(1)}`;
  }).join(' ');
  return (
    <G>
      <Path d={strands} stroke="rgba(255,255,255,0.85)" strokeWidth={1} fill="none" />
      <Path
        d={`M ${rim.x - rim.rx * 0.85} ${rim.y + rim.rx * 0.6} L ${rim.x + rim.rx * 0.85} ${rim.y + rim.rx * 0.6}`}
        stroke="rgba(255,255,255,0.7)"
        strokeWidth={0.9}
      />
      <Path d={`M ${rim.x - rim.rx} ${rim.y} A ${rim.rx} ${ry} 0 0 0 ${rim.x + rim.rx} ${rim.y}`} stroke={RIM} strokeWidth={2.6} fill="none" />
    </G>
  );
}

// The floor, the lines, the stand and the hoop's back half, drawn once.
function CourtArt({ view: v, compact }: { view: CourtView; compact: boolean }) {
  const P = (x: number, y: number) => project(v, x, y);
  const ring = (cx: number, cy: number, r: number, a0 = 0, a1 = Math.PI * 2, n = 40) =>
    groundPath(
      v,
      Array.from({ length: n + 1 }, (_, i) => {
        const t = a0 + ((a1 - a0) * i) / n;
        return [cx + Math.cos(t) * r, cy + (Math.sin(t) * r) / LEN] as [number, number];
      }),
    );
  const lw = compact ? 1.4 : 2;
  const crowd = useMemo(() => crowdDots(v.w, v.stand, compact), [v.w, v.stand, compact]);
  const planks = Array.from({ length: 17 }, (_, i) => groundPath(v, [[(i + 1) / 18, 0], [(i + 1) / 18, 1]])).join(' ');
  // The three-point line: straight in the corners, then the arc.
  const corner = Math.acos(0.44 / 0.475);
  const rim = rimAt(v);
  const ry = rim.rx * 0.34;
  const board = P(0.5, 0.045);
  const lift = 0.26 * v.botW * board.s;
  const bw = 0.2 * v.botW * board.s;
  const bh = 0.12 * v.botW * board.s;
  const bTop = board.y - lift - bh * 0.55;
  const pole = P(0.5, -0.04);
  return (
    <Svg width={v.w} height={v.h} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="hoopsLight" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#000000" stopOpacity="0.25" />
          <Stop offset="0.45" stopColor="#000000" stopOpacity="0" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0.08" />
        </LinearGradient>
      </Defs>
      {/* The stand behind the baseline, and the fans in it. */}
      <Rect x={0} y={0} width={v.w} height={v.stand} fill="#2a2f45" />
      <Rect x={0} y={0} width={v.w} height={v.stand * 0.22} fill="#1d2133" />
      {crowd.map((c, i) => (
        <Circle key={i} cx={c.x} cy={c.y} r={compact ? 2 : 2.6} fill={c.c} opacity={0.85} />
      ))}
      <Rect x={0} y={v.stand} width={v.w / 2} height={v.y0 - v.stand} fill={HOOPS_TEAM_COLOR.home} />
      <Rect x={v.w / 2} y={v.stand} width={v.w / 2} height={v.y0 - v.stand} fill={HOOPS_TEAM_COLOR.away} />
      {/* Off the court, then the hardwood and its planks. */}
      <Rect x={0} y={v.y0} width={v.w} height={v.h - v.y0} fill="#8a5a30" />
      <Path d={groundPath(v, [[0, 0], [1, 0], [1, 1], [0, 1]], true)} fill={WOOD} />
      <Path d={planks} stroke={PLANK} strokeWidth={1} fill="none" />
      {/* The key, and the lines. */}
      <Path d={groundPath(v, [[0.34, 0], [0.66, 0], [0.66, 0.38], [0.34, 0.38]], true)} fill={KEY} />
      <Path d={groundPath(v, [[0, 1], [0, 0], [1, 0], [1, 1], [0, 1]])} stroke={LINE} strokeWidth={lw} fill="none" />
      <Path d={groundPath(v, [[0.34, 0], [0.34, 0.38], [0.66, 0.38], [0.66, 0]])} stroke={LINE} strokeWidth={lw} fill="none" />
      <Path d={ring(0.5, 0.38, 0.12)} stroke={LINE} strokeWidth={lw} fill="none" />
      <Path d={groundPath(v, [[0.06, 0], [0.06, 0.295]])} stroke={LINE} strokeWidth={lw} />
      <Path d={groundPath(v, [[0.94, 0], [0.94, 0.295]])} stroke={LINE} strokeWidth={lw} />
      <Path d={ring(HOOP.x, HOOP.y, 0.475, corner, Math.PI - corner, 48)} stroke={LINE} strokeWidth={lw} fill="none" />
      <Path d={ring(0.5, 1, 0.12, Math.PI, Math.PI * 2, 24)} stroke={LINE} strokeWidth={lw} fill="none" />
      <Path d={ring(0.5, 1, 0.065, Math.PI, Math.PI * 2, 16) + ' Z'} fill="rgba(145,132,217,0.55)" />
      <Rect x={0} y={v.y0} width={v.w} height={v.h - v.y0} fill="url(#hoopsLight)" />
      {/* The hoop: pole, backboard with its square, the rim's back half. */}
      <Line x1={pole.x} y1={pole.y} x2={board.x} y2={bTop + bh} stroke="#3a3f55" strokeWidth={5 * board.s} strokeLinecap="round" />
      <Rect x={board.x - bw / 2} y={bTop} width={bw} height={bh} fill="rgba(255,255,255,0.88)" stroke="#2a2f45" strokeWidth={1.5} />
      <Rect x={board.x - bw * 0.2} y={bTop + bh * 0.45} width={bw * 0.4} height={bh * 0.4} fill="none" stroke={HOOPS_TEAM_COLOR.home} strokeWidth={1.5} />
      <Line x1={rim.x} y1={bTop + bh * 0.85} x2={rim.x} y2={rim.y - ry} stroke={RIM} strokeWidth={2} />
      <Path d={`M ${rim.x - rim.rx} ${rim.y} A ${rim.rx} ${ry} 0 0 1 ${rim.x + rim.rx} ${rim.y}`} stroke={RIM} strokeWidth={2.6} fill="none" />
      <Polygon points="0,0 0,0 0,0" fill="none" />
    </Svg>
  );
}

// A real basketball: orange, its black seams, lit from the top left.
export function Basketball({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <ClipPath id="bbClip">
          <Circle cx={50} cy={50} r={47} />
        </ClipPath>
        <RadialGradient id="bbLight" cx="35%" cy="30%" r="75%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.25" />
          <Stop offset="0.6" stopColor="#000000" stopOpacity="0.05" />
          <Stop offset="1" stopColor="#000000" stopOpacity="0.38" />
        </RadialGradient>
      </Defs>
      <Circle cx={50} cy={50} r={47} fill="#e8772e" />
      <G clipPath="url(#bbClip)">
        <Line x1={3} y1={50} x2={97} y2={50} stroke="#2a1608" strokeWidth={4} />
        <Line x1={50} y1={3} x2={50} y2={97} stroke="#2a1608" strokeWidth={4} />
        <Path d="M 18 12 Q 40 50 18 88" stroke="#2a1608" strokeWidth={4} fill="none" />
        <Path d="M 82 12 Q 60 50 82 88" stroke="#2a1608" strokeWidth={4} fill="none" />
        <Circle cx={50} cy={50} r={47} fill="url(#bbLight)" />
      </G>
      <Circle cx={50} cy={50} r={47} fill="none" stroke="#2a1608" strokeWidth={3} />
    </Svg>
  );
}
