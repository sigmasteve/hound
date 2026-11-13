import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { crowdDots, groundPath, perspective, project, sizeAt, type Perspective } from './perspective';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { useTheme } from '../theme/ThemeContext';
import { font, type Palette } from '../theme/tokens';
import { HOOPS_TEAM_COLOR, type HoopsTeam } from '../challenges/hoops';
import type { HoopsEvent, HoopsGame, HoopsPlayer } from '../challenges/hoopsApi';

// The full court in perspective (perspective.ts), seen from the sideline
// like a TV broadcast: the long floor left to right, a hoop at each end,
// the fans along the far side. On the floor, x runs the length (0 the
// left baseline, 1 the right) and y across (0 the far sideline, 1 the
// near one); everything (lines, players, the ball) goes through
// project(), so the replay lines up with the drawing.
//
// Plays are worked out at one end in that end's own terms, as if facing
// the hoop: x across the lane (0 to 1, left to right as you face it) and
// y out from the baseline (0) to half court (1). toFloor() turns those
// into the floor at the right or left end.

const WOOD = '#d9a466';
const PLANK = '#c48d52';
const LINE = 'rgba(255,255,255,0.92)';
const KEY = 'rgba(145,132,217,0.78)';
const RIM = '#e8602c';

type Pt = { x: number; y: number };
type End = 'left' | 'right';

// One foot, along and across the floor.
const FX = 1 / 94;
const FY = 1 / 50;

// At one end: the hoop's spot, and how much shorter than its width the
// half court is (47 by 50 feet), for round circles.
const HOOP: Pt = { x: 0.5, y: 0.112 };
const LEN = 47 / 50;

function toFloor(p: Pt, end: End): Pt {
  return end === 'right' ? { x: 1 - p.y * 0.5, y: p.x } : { x: p.y * 0.5, y: 1 - p.x };
}

// Which end a side attacks: the home side goes right in the first half
// and left after halftime (overtime too), like the real thing.
export function attackEnd(team: HoopsTeam, period: number): End {
  return (team === 'home') === period <= 2 ? 'right' : 'left';
}

// Five spots for the side with the ball, and its defenders between each
// of them and the hoop.
const OFFENSE: Pt[] = [
  { x: 0.5, y: 0.72 },
  { x: 0.12, y: 0.5 },
  { x: 0.88, y: 0.5 },
  { x: 0.1, y: 0.17 },
  { x: 0.9, y: 0.19 },
];
const toward = (p: Pt, k: number) => ({ x: p.x + (HOOP.x - p.x) * k, y: p.y + (HOOP.y - p.y) * k });
// A defender: between their man and the hoop, a little to the inside.
const guardSpot = (p: Pt) => {
  const t = toward(p, 0.2);
  return { x: t.x + (p.x < 0.5 ? 0.06 : p.x > 0.5 ? -0.06 : 0.07), y: t.y };
};

// A spot around the hoop: an angle (0 = the right baseline, 90 = straight
// out in front, 180 = the left baseline) and a distance in court widths.
const around = (deg: number, r: number) => {
  const t = (deg * Math.PI) / 180;
  return { x: HOOP.x + r * Math.cos(t), y: HOOP.y + (r / LEN) * Math.sin(t) };
};

// Where threes go up from: both corners, the wings, in between and the top.
const THREES = [
  { x: 0.04, y: 0.15 },
  { x: 0.96, y: 0.15 },
  around(28, 0.5),
  around(152, 0.5),
  around(45, 0.5),
  around(135, 0.5),
  around(65, 0.5),
  around(115, 0.5),
  around(90, 0.5),
];
// Mid-range: the baseline, the elbows, the wings and the free-throw line.
const MIDS = [around(8, 0.27), around(172, 0.27), around(35, 0.29), around(145, 0.29), around(62, 0.3), around(118, 0.3), around(90, 0.29)];
// The angles a drive comes in from, and where it finishes by the rim.
const DRIVES = [15, 50, 90, 130, 165];

// A number from 0 to 1 that's the same for the same play every time.
function pick(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  // Stir it, so plays one apart land far apart.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Where a shot goes up from, and for a drive, where it cuts in from.
// Each play gets its own spot, so the same play replays the same way.
function shotSpot(e: HoopsEvent, home: Pt): Pt & { via?: Pt } {
  if (e.kind === 'ft') return { x: 0.5, y: 0.4 };
  const r = pick(`${e.shooter}:${e.seq}:${e.kind}`);
  if (e.kind === 'three') return THREES[Math.floor(r * THREES.length)];
  if (e.kind === 'mid') return MIDS[Math.floor(r * MIDS.length)];
  // Drives and putbacks finish by the rim from an angle; a drive cuts in
  // from further out on the same line.
  const deg = DRIVES[Math.floor(r * DRIVES.length)];
  if (e.kind === 'putback') return around(deg, 0.07);
  const at = around(deg, e.dunk ? 0.045 : 0.075);
  const via = around(deg, 0.27);
  // Not back through where they started: straight in if they're already on that line.
  return Math.hypot(home.x - via.x, home.y - via.y) < 0.08 ? at : { ...at, via };
}

export type CourtView = Perspective;
export function courtView(w: number, h: number, compact: boolean): CourtView {
  // A gentle tilt: the floor seen from up in the stands across the way.
  return perspective(w, h, { stand: h * (compact ? 0.17 : 0.2), gap: h * 0.035, near: h * 0.045, botW: w * 0.95, a: 0.8, b: 0.88 });
}

// A rim, up in the air over its spot: its centre on screen.
function rimAt(v: CourtView, end: End) {
  const f = toFloor(HOOP, end);
  const p = project(v, f.x, f.y);
  const ft = (v.botW * p.s) / 94;
  return { x: p.x, y: p.y - 10 * ft, rx: Math.max(6, 1.7 * ft), floorY: p.y, s: p.s, ft };
}

function resultWord(e: HoopsEvent): string {
  if (e.kind === 'ft') return e.made ? 'GOOD +1' : 'NO GOOD';
  if (!e.made) return e.dunk ? 'BLOCKED' : 'MISS';
  if (e.dunk) return `DUNK +${e.pts}`;
  if (e.kind === 'three') return e.onFire ? `ON FIRE +3` : 'SWISH +3';
  return `+${e.pts}`;
}

export function HoopsCourt({
  game,
  compact,
  play,
  spot,
}: {
  game: HoopsGame;
  compact?: boolean;
  // Two players side by side here (H-O-R-S-E: where today's shot is from),
  // in the right-hand end's terms.
  spot?: Pt;
  // A shot to replay; a new n replays it (again).
  play?: { event: HoopsEvent; n: number } | null;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [w, setW] = useState(0);
  const h = w * (compact ? 0.62 : 0.7);
  const view = useMemo(() => courtView(w, h, !!compact), [w, h, compact]);
  const size = compact ? 18 : 25;

  // The side with the ball: the shooter's in a replay, else mine (or home),
  // and the end it's attacking in this quarter.
  const meP = game.players.find((p) => p.id === game.me) ?? null;
  const offTeam: HoopsTeam = play?.event.team ?? meP?.team ?? 'home';
  const defTeam: HoopsTeam = offTeam === 'home' ? 'away' : 'home';
  const period = play ? game.last?.period ?? 1 : Math.max(1, (game.last?.period ?? 0) + (game.status === 'final' ? 0 : 1));
  const end: End = spot ? 'right' : attackEnd(offTeam, period);

  // Five a side on the court: whoever's shooting, then by points and steps.
  // Spots are in the attacking end's terms.
  const spots = useMemo(() => {
    const pick = (team: HoopsTeam, must: string | null) => {
      const list = game.players
        .filter((p) => p.team === team)
        .sort((a, b) => Number(b.id === must) - Number(a.id === must) || b.pts - a.pts || b.stepsToday - a.stepsToday);
      return list.slice(0, 5);
    };
    const shooter = play?.event.shooter ?? null;
    const out = new Map<string, { at: Pt; p: HoopsPlayer }>();
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

  // Replay: each player's offset from their spot, the ball's spot, the
  // swish, and the word.
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
    // A spot at this end, on screen.
    const px = (p: Pt, at: End = end) => {
      const f = toFloor(p, at);
      const q = project(view, f.x, f.y);
      return { x: q.x, y: q.y, s: q.s };
    };
    const rim = rimAt(view, end);
    const from = shotSpot(e, s.at);
    const off = (id: string, to: Pt) => {
      const b = spots.get(id);
      if (!b) return { x: 0, y: 0 };
      const a = px(b.at);
      const t = px(to);
      return { x: t.x - a.x, y: t.y - a.y };
    };
    const run = (v: Animated.ValueXY, to: { x: number; y: number }, ms: number) =>
      Animated.timing(v, { toValue: to, duration: ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    const above = (p: { x: number; y: number; s: number }) => ({ x: p.x, y: p.y - size * 0.9 * p.s });

    // Where the ball comes from: where the last play left it. A make or a
    // defensive rebound at the other end means a run up the floor; an
    // offensive rebound stays put; the quarter's first play starts from
    // the tip at center court.
    const list = game.last?.events ?? [];
    const i = list.findIndex((x) => x.seq === e.seq);
    const prev = i > 0 ? list[i - 1] : null;
    const prevEnd: End | null = prev ? attackEnd(prev.team, period) : null;
    const center = project(view, 0.5, 0.5);
    const startBall = !prev
      ? { x: center.x, y: center.y - size * 0.9 }
      : prevEnd !== end
        ? above(px({ x: 0.5, y: 0.2 }, prevEnd as End))
        : null;
    // Running up the floor: everyone starts back toward the other end and
    // comes forward with the ball.
    const upFloor = !!startBall;
    const dx = (end === 'right' ? -1 : 1) * view.botW * (prev ? 0.42 : 0.26);

    moves.forEach((v) => v.setValue({ x: 0, y: 0 }));
    spots.forEach((_, id) => moveOf(id).setValue({ x: upFloor ? dx : 0, y: 0 }));
    const fromPx = px(from);
    const hand = { x: fromPx.x + (end === 'right' ? 5 : -5) * fromPx.s, y: fromPx.y - size * 1.05 * fromPx.s };
    ball.setValue(startBall ?? above(px(s.at)));
    ballOn.setValue(1);
    word.setValue(0);
    swish.setValue(0);
    setWordText({ text: resultWord(e), good: e.made });

    const push = upFloor
      ? [
          Animated.parallel([
            ...[...spots.keys()].map((id) => run(moveOf(id), { x: 0, y: 0 }, 900)),
            run(ball, above(px(s.at)), 900),
          ]),
        ]
      : [];

    // The ball's flight: a high arc for a jump shot, a short one for a
    // drive or a putback, straight down for a dunk.
    const high = e.kind === 'three' ? 70 : e.kind === 'mid' || e.kind === 'ft' ? 54 : 26;
    const ctrl = { x: (hand.x + rim.x) / 2, y: Math.min(hand.y, rim.y) - high * (w / 360) };
    const n = 9;
    const arc: { x: number; y: number }[] = [];
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      arc.push({
        x: (1 - t) * (1 - t) * hand.x + 2 * (1 - t) * t * ctrl.x + t * t * rim.x,
        y: (1 - t) * (1 - t) * hand.y + 2 * (1 - t) * t * ctrl.y + t * t * (rim.y - 3),
      });
    }
    const flight = e.dunk && e.made
      ? [Animated.timing(ball, { toValue: { x: rim.x, y: rim.y - 10 }, duration: 260, useNativeDriver: true })]
      : arc.map((p) => Animated.timing(ball, { toValue: p, duration: (e.kind === 'drive' || e.kind === 'putback' ? 520 : 900) / n, easing: Easing.linear, useNativeDriver: true }));
    const down = e.made
      ? [
          Animated.parallel([
            Animated.timing(ball, { toValue: { x: rim.x, y: rim.y + 12 }, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
            Animated.sequence([
              Animated.timing(swish, { toValue: 1, duration: 130, useNativeDriver: true }),
              Animated.timing(swish, { toValue: 0, duration: 200, useNativeDriver: true }),
            ]),
          ]),
          Animated.timing(ball, { toValue: { x: rim.x, y: rim.floorY - 3 }, duration: 300, easing: Easing.bounce, useNativeDriver: true }),
        ]
      : [
          // Off the rim and out to the side.
          Animated.timing(ball, { toValue: { x: rim.x + (end === 'right' ? -1 : 1) * rim.rx * 1.6, y: rim.y - 12 }, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(ball, {
            toValue: px({ x: from.x < 0.5 ? 0.66 : 0.34, y: 0.24 }),
            duration: 420,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ];

    const defender = e.defender && spots.has(e.defender) ? e.defender : null;
    const shooterTo = e.dunk ? { x: from.x, y: from.y - 0.01 } : from;
    // A drive cuts to its lane first, then goes at the rim from there.
    const viaPx = from.via ? px(from.via) : null;
    const lead = [
      from.via
        ? Animated.sequence([run(moveOf(e.shooter), off(e.shooter, from.via), 420), run(moveOf(e.shooter), off(e.shooter, shooterTo), 330)])
        : run(moveOf(e.shooter), off(e.shooter, shooterTo), 700),
      viaPx
        ? Animated.sequence([run(ball, above(viaPx), 420), run(ball, above(fromPx), 330)])
        : run(ball, above(fromPx), 700),
      ...(defender ? [run(moveOf(defender), off(defender, guardSpot(from)), 750)] : []),
    ];
    // A dunk: the shooter rises to the rim.
    const rise = e.dunk ? [Animated.timing(moveOf(e.shooter), { toValue: { ...off(e.shooter, shooterTo), y: off(e.shooter, shooterTo).y - (fromPx.y - rim.y) * 0.75 }, duration: 260, useNativeDriver: true })] : [];
    const back = [e.shooter, ...(defender ? [defender] : [])].map((id) => run(moveOf(id), { x: 0, y: 0 }, 500));
    const anim = Animated.sequence([
      ...push,
      Animated.parallel(lead),
      Animated.parallel([...rise, Animated.sequence(flight)]),
      Animated.sequence(down),
      Animated.timing(word, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(700),
      Animated.parallel([...back, Animated.timing(word, { toValue: 0, duration: 400, useNativeDriver: true })]),
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

  const rims = w > 0 ? { left: rimAt(view, 'left'), right: rimAt(view, 'right') } : null;
  const rim = rims ? rims[end] : null;
  const ballSize = compact ? 10 : 13;
  const lit = new Set<string>(play ? [play.event.shooter, ...(play.event.defender ? [play.event.defender] : [])] : []);
  // On the floor; far players first, so nearer ones stand in front.
  const placed = [...spots.values()].map((sp) => ({ ...sp, f: toFloor(sp.at, end) })).sort((a, b) => a.f.y - b.f.y);

  return (
    <View
      onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}
      style={[styles.court, { height: h || undefined, aspectRatio: w ? undefined : compact ? 1 / 0.62 : 1 / 0.7 }]}
      accessible
      accessibilityLabel={`The court: ${game.teams.home.name} ${game.teams.home.score}, ${game.teams.away.name} ${game.teams.away.score}`}
    >
      {w > 0 && rims && rim && (
        <>
          <CourtArt view={view} compact={!!compact} />
          {placed.map(({ f, p }) => {
            const q = project(view, f.x, f.y);
            const sz = sizeAt(view, q.s, size);
            const isMe = p.id === game.me;
            const on = lit.has(p.id);
            const labelW = Math.max(sz + 10, compact ? 40 : 56);
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
                    { width: sz + 5, height: sz + 5, borderRadius: (sz + 5) / 2, borderColor: HOOPS_TEAM_COLOR[p.team] },
                    isMe && { borderColor: colors.amber },
                    on && !isMe && { borderColor: '#ffffff' },
                  ]}
                >
                  <Avatar
                    initials={p.initials}
                    tint={p.bot ? colors.neutral800 : p.team === 'home' ? '#7a4416' : '#26407a'}
                    size={sz}
                    fontSize={compact ? 9 : 11}
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

          {/* The ball, during a replay; then the rims' fronts and the nets
              over it, so a make drops through. */}
          <Animated.View
            pointerEvents="none"
            style={[styles.ball, { width: ballSize, height: ballSize, left: -ballSize / 2, top: -ballSize / 2, opacity: ballOn }, { transform: ball.getTranslateTransform() }]}
          >
            <Basketball size={ballSize} />
          </Animated.View>
          <Svg width={w} height={h} style={[StyleSheet.absoluteFill, { zIndex: 5 }]} pointerEvents="none">
            <Net rim={rims.left} />
            <Net rim={rims.right} />
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
                {
                  left: Math.max(4, Math.min(w - 104, rim.x + (end === 'right' ? -110 : 10))),
                  top: rim.y - 8,
                  opacity: word,
                  transform: [{ scale: word.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
                },
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
    ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
    slotName: {
      color: '#ffffff',
      fontSize: 10.5,
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

// A rim's front half and the net hanging under it.
function Net({ rim }: { rim: ReturnType<typeof rimAt> }) {
  const ry = rim.rx * 0.42;
  const strands = Array.from({ length: 5 }, (_, i) => {
    const x0 = rim.x - rim.rx + (2 * rim.rx * i) / 4;
    const x1 = rim.x - rim.rx * 0.55 + (1.1 * rim.rx * i) / 4;
    return `M ${x0.toFixed(1)} ${(rim.y + 1).toFixed(1)} L ${x1.toFixed(1)} ${(rim.y + rim.rx * 1.4).toFixed(1)}`;
  }).join(' ');
  return (
    <G>
      <Path d={strands} stroke="rgba(255,255,255,0.85)" strokeWidth={0.9} fill="none" />
      <Path d={`M ${rim.x - rim.rx} ${rim.y} A ${rim.rx} ${ry} 0 0 0 ${rim.x + rim.rx} ${rim.y}`} stroke={RIM} strokeWidth={2.2} fill="none" />
    </G>
  );
}

// The floor, the lines, the stand and both hoops' back halves, drawn once.
function CourtArt({ view: v, compact }: { view: CourtView; compact: boolean }) {
  const ell = (cx: number, cy: number, rx: number, ry: number, a0 = 0, a1 = Math.PI * 2, n = 32) =>
    groundPath(
      v,
      Array.from({ length: n + 1 }, (_, i) => {
        const t = a0 + ((a1 - a0) * i) / n;
        return [cx + Math.cos(t) * rx, cy + Math.sin(t) * ry] as [number, number];
      }),
    );
  const lw = compact ? 1.2 : 1.7;
  const crowd = useMemo(() => crowdDots(v.w, v.stand, compact), [v.w, v.stand, compact]);
  const planks = Array.from({ length: 9 }, (_, i) => groundPath(v, [[0, (i + 1) / 10], [1, (i + 1) / 10]])).join(' ');
  // Each end: the key, the free-throw circle, the corners and the arc.
  const T = Math.asin(0.44 / 0.475);
  const ends = (['left', 'right'] as End[]).map((end) => {
    const base = end === 'left' ? 0 : 1;
    const dir = end === 'left' ? 1 : -1;
    const hx = base + dir * 5.25 * FX;
    const keyX = base + dir * 19 * FX;
    const cornerX = hx + dir * 23.75 * FX * Math.cos(T);
    const arc = Array.from({ length: 37 }, (_, i) => {
      const t = -T + (2 * T * i) / 36;
      return [hx + dir * 23.75 * FX * Math.cos(t), 0.5 + 0.475 * Math.sin(t)] as [number, number];
    });
    const rim = rimAt(v, end);
    const bx = project(v, base + dir * 4 * FX, 0.5).x;
    const top = rim.y - 2.6 * rim.ft;
    const pole = project(v, base - dir * 0.022, 0.5);
    return { end, base, keyX, cornerX, arc, rim, bx, top, pole };
  });
  return (
    <Svg width={v.w} height={v.h} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="hoopsLight" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#000000" stopOpacity="0.22" />
          <Stop offset="0.45" stopColor="#000000" stopOpacity="0" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0.08" />
        </LinearGradient>
      </Defs>
      {/* The stand along the far sideline, and the fans in it. */}
      <Rect x={0} y={0} width={v.w} height={v.stand} fill="#2a2f45" />
      <Rect x={0} y={0} width={v.w} height={v.stand * 0.22} fill="#1d2133" />
      {crowd.map((c, i) => (
        <Circle key={i} cx={c.x} cy={c.y} r={compact ? 1.8 : 2.3} fill={c.c} opacity={0.85} />
      ))}
      <Rect x={0} y={v.stand} width={v.w / 2} height={v.y0 - v.stand} fill={HOOPS_TEAM_COLOR.home} />
      <Rect x={v.w / 2} y={v.stand} width={v.w / 2} height={v.y0 - v.stand} fill={HOOPS_TEAM_COLOR.away} />
      {/* Off the court, then the hardwood and its planks. */}
      <Rect x={0} y={v.y0} width={v.w} height={v.h - v.y0} fill="#8a5a30" />
      <Path d={groundPath(v, [[0, 0], [1, 0], [1, 1], [0, 1]], true)} fill={WOOD} />
      <Path d={planks} stroke={PLANK} strokeWidth={1} fill="none" />
      {ends.map((e) => (
        <Path key={`k${e.end}`} d={groundPath(v, [[e.base, 0.34], [e.keyX, 0.34], [e.keyX, 0.66], [e.base, 0.66]], true)} fill={KEY} />
      ))}
      <Path d={ell(0.5, 0.5, 2 * FX, 2 * FY) + ' Z'} fill="rgba(145,132,217,0.55)" />
      {/* The lines. */}
      <Path d={groundPath(v, [[0, 0], [1, 0], [1, 1], [0, 1]], true)} stroke={LINE} strokeWidth={lw} fill="none" />
      <Path d={groundPath(v, [[0.5, 0], [0.5, 1]])} stroke={LINE} strokeWidth={lw} />
      <Path d={ell(0.5, 0.5, 6 * FX, 6 * FY)} stroke={LINE} strokeWidth={lw} fill="none" />
      {ends.map((e) => (
        <G key={`l${e.end}`}>
          <Path d={groundPath(v, [[e.base, 0.34], [e.keyX, 0.34], [e.keyX, 0.66], [e.base, 0.66]])} stroke={LINE} strokeWidth={lw} fill="none" />
          <Path d={ell(e.keyX, 0.5, 6 * FX, 6 * FY)} stroke={LINE} strokeWidth={lw} fill="none" />
          <Path d={groundPath(v, [[e.base, 0.06], [e.cornerX, 0.06]])} stroke={LINE} strokeWidth={lw} />
          <Path d={groundPath(v, [[e.base, 0.94], [e.cornerX, 0.94]])} stroke={LINE} strokeWidth={lw} />
          <Path d={groundPath(v, e.arc)} stroke={LINE} strokeWidth={lw} fill="none" />
        </G>
      ))}
      <Rect x={0} y={v.y0} width={v.w} height={v.h - v.y0} fill="url(#hoopsLight)" />
      {/* Each hoop: the stanchion behind the baseline, the backboard seen
          edge-on, the rim's back half. */}
      {ends.map((e) => (
        <G key={`h${e.end}`}>
          <Path
            d={`M ${e.pole.x} ${e.pole.y} L ${e.pole.x} ${e.top + 3.6 * e.rim.ft} L ${e.bx} ${e.top + 3.6 * e.rim.ft}`}
            stroke="#3a3f55"
            strokeWidth={compact ? 2.5 : 3.5}
            strokeLinecap="round"
            fill="none"
          />
          <Rect x={e.bx - 1.8} y={e.top} width={3.6} height={3.6 * e.rim.ft} fill="rgba(255,255,255,0.92)" stroke="#2a2f45" strokeWidth={0.8} />
          <Path
            d={`M ${e.rim.x - e.rim.rx} ${e.rim.y} A ${e.rim.rx} ${e.rim.rx * 0.42} 0 0 1 ${e.rim.x + e.rim.rx} ${e.rim.y}`}
            stroke={RIM}
            strokeWidth={2.2}
            fill="none"
          />
          <Line x1={e.bx} y1={e.rim.y} x2={e.rim.x + (e.end === 'left' ? -e.rim.rx : e.rim.rx)} y2={e.rim.y} stroke={RIM} strokeWidth={1.6} />
        </G>
      ))}
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
