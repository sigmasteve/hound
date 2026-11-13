import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Line, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import { perspective, project, sizeAt, type Perspective } from './perspective';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, TINT_N, type Palette } from '../theme/tokens';
import type { Participant } from '../challenges/types';
import { SOCCER_POSITION_SHORT, type SoccerPosition, type SoccerZone } from '../challenges/soccer';
import { soccerTeamMembers, soccerTeamOf, type SoccerGame, type SoccerPlayer, type SoccerShot, type SoccerTeam } from '../challenges/soccerApi';
import { SportBadge } from './SportBonusRow';

// Whoever's on the pitch: the fields Participant and BoardEntry both
// carry, so the detail screen and Home can each hand over what they have.
export type PitchPerson = Pick<Participant, 'userId' | 'name' | 'initials'> &
  Partial<Pick<Participant, 'frameId' | 'backgroundId' | 'iconId' | 'level'>>;

const PITCH = '#3f9a5a';
const PITCH_STRIPE = '#358a4e';
const LINE = 'rgba(255,255,255,0.88)';

// The pitch in perspective (perspective.ts), seen from behind the near
// goal: the far end narrower, a stand of fans behind it. Every spot (a
// share of the pitch's width, x, and length, y, 0 at the far goal line)
// goes through project(), so players, the ball and the replay all line
// up with the drawing.
type PitchView = Perspective;
function pitchView(w: number, h: number, compact: boolean): PitchView {
  return perspective(w, h, { stand: h * (compact ? 0.1 : 0.12) });
}

// Where each line stands, as a share of the pitch's height: the far team
// at the top, the viewer's at the bottom.
const LINE_Y: Record<'far' | 'near', Record<SoccerPosition, number>> = {
  far: { keeper: 0.07, defender: 0.215, forward: 0.36 },
  near: { forward: 0.6, defender: 0.745, keeper: 0.885 },
};

// A shot's zone across the goal: -1 left, 0 the middle, 1 right, from
// the shooter's side.
const ZONE_X: Record<SoccerZone, number> = { top_left: -1, bottom_left: -1, center: 0, top_right: 1, bottom_right: 1 };

export type ShotResult = 'goal' | 'saved' | 'blocked' | 'wide';
export function shotResult(s: Pick<SoccerShot, 'outcome' | 'markerIds'>): ShotResult {
  if (s.outcome === 'goal') return 'goal';
  if (s.outcome === 'saved') return 'saved';
  return s.markerIds && s.markerIds.length > 0 ? 'blocked' : 'wide';
}

const RESULT_WORD: Record<ShotResult, string> = { goal: 'GOAL!', saved: 'SAVED', blocked: 'BLOCKED', wide: 'WIDE' };

// The pitch seen from above, the viewer's team at the near end: keeper in
// goal, defenders in front of the box, forwards near the halfway line.
// With a shot to replay (shot, and n going up each time), the shooter
// runs at goal, any defenders marking them close in, the keeper dives,
// and the ball goes in, gets saved, blocked or flies wide.
export function SoccerPitch({
  game,
  people,
  userId,
  compact,
  shot,
  gameDayIds,
}: {
  game: SoccerGame;
  people: PitchPerson[];
  userId: string | null | undefined;
  compact?: boolean;
  shot?: { shot: SoccerShot; n: number } | null;
  // Who played real soccer on the day shown: a ⚽ badge on their hound.
  gameDayIds?: Set<string>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [w, setW] = useState(0);
  const h = w * (compact ? 1.0 : 1.35);
  const view = useMemo(() => pitchView(w, h, !!compact), [w, h, compact]);
  const myTeam = soccerTeamOf(game, userId) ?? 'a';
  const size = compact ? 24 : 34;

  // Each player's spot, as shares of the pitch.
  const spots = useMemo(() => {
    const out = new Map<string, { x: number; y: number; p: SoccerPlayer; perRow: number }>();
    for (const team of ['a', 'b'] as SoccerTeam[]) {
      const end = team === myTeam ? 'near' : 'far';
      const members = soccerTeamMembers(game, team);
      for (const pos of ['keeper', 'defender', 'forward'] as SoccerPosition[]) {
        const line = members.filter((m) => m.position === pos);
        line.forEach((p, i) => out.set(p.playerId, { x: (i + 1) / (line.length + 1), y: LINE_Y[end][pos], p, perRow: line.length }));
      }
    }
    return out;
  }, [game, myTeam]);

  // Moving: an offset per player from their spot, and the ball.
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
  const [wordAt, setWordAt] = useState<{ x: number; y: number; text: string; goal: boolean } | null>(null);

  useEffect(() => {
    if (!shot || w === 0) return;
    const s = shot.shot;
    const from = spots.get(s.shooterId);
    if (!from) return;
    const up = s.team === myTeam;
    const goalY = up ? 0.02 : 0.98;
    const flip = up ? 1 : -1;
    const zx = s.aim ? ZONE_X[s.aim] * flip : 0;
    const shootAt = { x: 0.5 + zx * 0.1, y: goalY + (up ? 0.24 : -0.24) };
    const markers = (s.markerIds ?? []).filter((id) => spots.has(id));
    const markAt = (i: number) => ({ x: shootAt.x + (i % 2 ? 0.13 : -0.13) * (i > 1 ? 1.7 : 1), y: shootAt.y + (up ? -0.09 : 0.09) });
    const keeper = s.keeperId ? spots.get(s.keeperId) : undefined;
    const dx = s.dive ? ZONE_X[s.dive] * flip : s.outcome === 'saved' ? zx : 0;
    // In goal, even a defender standing in for a missing keeper.
    const keeperAt = keeper ? { x: 0.5 + dx * 0.14, y: up ? LINE_Y.far.keeper : LINE_Y.near.keeper } : null;
    const result = shotResult(s);
    const end =
      result === 'goal'
        ? { x: 0.5 + zx * 0.12, y: goalY }
        : result === 'saved' && keeperAt
          ? { x: keeperAt.x, y: keeperAt.y + (up ? 0.03 : -0.03) }
          : result === 'blocked'
            ? markAt(0)
            : { x: 0.5 + (zx === 0 ? 1 : Math.sign(zx)) * 0.3, y: goalY };

    const px = (p: { x: number; y: number }) => {
      const q = project(view, p.x, p.y);
      return { x: q.x, y: q.y };
    };
    const offset = (id: string, to: { x: number; y: number }) => {
      const b = spots.get(id)!;
      const from = px(b);
      const there = px(to);
      return { x: there.x - from.x, y: there.y - from.y };
    };
    const run = (v: Animated.ValueXY, to: { x: number; y: number }, ms: number) =>
      Animated.timing(v, { toValue: to, duration: ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true });

    moves.forEach((v) => v.setValue({ x: 0, y: 0 }));
    ball.setValue(px(from));
    ballOn.setValue(1);
    word.setValue(0);
    setWordAt({ ...px(end), text: RESULT_WORD[result], goal: result === 'goal' });

    const runners: Animated.CompositeAnimation[] = [
      run(moveOf(s.shooterId), offset(s.shooterId, shootAt), 900),
      run(ball, px({ x: shootAt.x, y: shootAt.y + (up ? -0.03 : 0.03) }), 900),
      ...markers.map((id, i) => run(moveOf(id), offset(id, markAt(i)), 900)),
      ...(keeper && keeperAt && s.keeperId ? [run(moveOf(s.keeperId), offset(s.keeperId, keeperAt), 1100)] : []),
    ];
    const back = [s.shooterId, ...markers, ...(s.keeperId ? [s.keeperId] : [])].map((id) => run(moveOf(id), { x: 0, y: 0 }, 500));
    const anim = Animated.sequence([
      Animated.parallel(runners),
      Animated.timing(ball, { toValue: px(end), duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(word, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(900),
      Animated.parallel([
        ...back,
        Animated.timing(ballOn, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(word, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]),
    ]);
    anim.start();
    return () => anim.stop();
    // A new shot (or the same one again) restarts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot?.n, w]);

  // Not back on screen: everyone home.
  useEffect(() => {
    if (shot) return;
    moves.forEach((v) => v.setValue({ x: 0, y: 0 }));
    ballOn.setValue(0);
    word.setValue(0);
  }, [shot, moves, ballOn, word]);

  const active = shot?.shot;
  const lit = new Set<string>(active ? [active.shooterId, ...(active.markerIds ?? []), ...(active.keeperId ? [active.keeperId] : [])] : []);
  const ballSize = compact ? 11 : 16;

  return (
    <View
      onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}
      style={[styles.pitch, compact && styles.pitchCompact, { height: h || undefined, aspectRatio: w ? undefined : compact ? 1 : 1 / 1.45 }]}
    >
      {w > 0 && (
        <>
          <PitchArt view={view} compact={!!compact} />

          {[...spots.values()].map(({ x, y, p, perRow }) => {
            const at = project(view, x, y);
            const left = at.x;
            const top = at.y;
            // Smaller toward the far end, with a shadow on the grass.
            const sz = sizeAt(view, at.s, size);
            if (!p.joined) {
              // Someone who hasn't accepted yet: a small dot, out of the way.
              return <View key={p.playerId} pointerEvents="none" style={[styles.dot, { left: left - 4, top: top - 4 }]} />;
            }
            const person = people.find((q) => q.userId === p.playerId);
            const isMe = p.playerId === userId;
            const labelW = Math.min(88, ((view.botW * at.s) / (perRow + 0.4)) * 0.98);
            const on = lit.has(p.playerId);
            return (
              <Animated.View
                key={p.playerId}
                pointerEvents="none"
                style={[
                  styles.slot,
                  { left: left - labelW / 2, top: top - (sz + 6) / 2, width: labelW, zIndex: on ? 2 : 1 },
                  { transform: moveOf(p.playerId).getTranslateTransform() },
                ]}
              >
                <View style={[styles.shadow, { width: sz * 0.8, height: sz * 0.2, borderRadius: sz, top: sz + 2, left: (labelW - sz * 0.8) / 2 }]} />
                <View style={[styles.ring, (isMe || on) && styles.ringMe, on && !isMe && styles.ringOn, { width: sz + 6, height: sz + 6, borderRadius: (sz + 6) / 2 }]}>
                  <Avatar
                    initials={person?.initials ?? '?'}
                    tint={isMe ? TINT_A : p.botId ? colors.neutral800 : TINT_N}
                    size={sz}
                    fontSize={compact ? 10 : 12}
                    frameId={person?.frameId}
                    backgroundId={person?.backgroundId}
                    iconId={person?.iconId}
                  />
                  {gameDayIds?.has(p.playerId) && <SportBadge kind="soccer" size={compact ? 12 : 15} />}
                </View>
                {!compact && (
                  <Text style={[styles.slotName, isMe && styles.slotNameMe]} numberOfLines={1}>
                    {isMe ? 'You' : (person?.name ?? 'Player')}
                  </Text>
                )}
                {!compact && <Text style={styles.slotPos}>{SOCCER_POSITION_SHORT[p.position]}</Text>}
              </Animated.View>
            );
          })}

          {/* The ball, during a replay. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.ball,
              { width: ballSize, height: ballSize, left: -ballSize / 2, top: -ballSize / 2, opacity: ballOn },
              { transform: ball.getTranslateTransform() },
            ]}
          >
            <SoccerBall size={ballSize} />
          </Animated.View>
          {wordAt && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.word,
                wordAt.goal && styles.wordGoal,
                {
                  left: Math.max(4, Math.min(w - 84, wordAt.x - 40)),
                  top: Math.max(4, Math.min(h - 30, wordAt.y + (wordAt.y < h / 2 ? 14 : -38))),
                  opacity: word,
                  transform: [{ scale: word.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
                },
              ]}
            >
              <Text style={styles.wordText}>{wordAt.text}</Text>
            </Animated.View>
          )}
        </>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    pitch: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#1f5a36' },
    pitchCompact: { borderRadius: 10 },
    shadow: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.18)' },
    dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.35)' },
    slot: { position: 'absolute', alignItems: 'center', gap: 1 },
    ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
    ringMe: { borderColor: colors.amber },
    ringOn: { borderColor: '#ffffff' },
    slotName: {
      color: '#ffffff',
      fontSize: 11,
      fontFamily: font.heading,
      maxWidth: '100%',
      textShadowColor: 'rgba(0,0,0,0.55)',
      textShadowRadius: 3,
      textShadowOffset: { width: 0, height: 1 },
    },
    slotNameMe: { color: '#ffe3a3' },
    slotPos: { color: 'rgba(255,255,255,0.75)', fontSize: 9, letterSpacing: 0.5 },
    ball: { position: 'absolute', zIndex: 3 },
    word: {
      position: 'absolute',
      width: 80,
      alignItems: 'center',
      paddingVertical: 3,
      borderRadius: 8,
      backgroundColor: 'rgba(22,24,38,0.78)',
      zIndex: 4,
    },
    wordGoal: { backgroundColor: colors.amber },
    wordText: { color: '#ffffff', fontFamily: font.heading, fontSize: 13, letterSpacing: 0.6 },
  });
}

// The ground, the lines, the goals and the stand, drawn once in
// perspective (see project()).
function PitchArt({ view: v, compact }: { view: PitchView; compact: boolean }) {
  const P = (x: number, y: number) => project(v, x, y);
  const quad = (x0: number, y0: number, x1: number, y1: number) =>
    [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)].map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const line = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  // Circles and arcs on the ground: x is a share of the width, and the
  // length is 1.5 widths, so a round circle is shorter in y.
  const ring = (cx: number, cy: number, r: number, a0 = 0, a1 = Math.PI * 2, n = 40) =>
    line(Array.from({ length: n + 1 }, (_, i) => {
      const t = a0 + ((a1 - a0) * i) / n;
      return P(cx + Math.cos(t) * r, cy + (Math.sin(t) * r) / 1.5);
    }));
  const stripes = 12;
  const lw = compact ? 1.2 : 1.6;
  // A goal: posts and crossbar standing up from the goal line, a net
  // behind. far: the far goal (net away from us); near: ours.
  const goal = (y: number, far: boolean) => {
    const l = P(0.39, y);
    const rr = P(0.61, y);
    const hgt = (compact ? 14 : 24) * l.s;
    const back = far ? -7 * l.s : 9 * l.s;
    const nl = { x: l.x + (far ? 3 : -4) * l.s, y: l.y + back };
    const nr = { x: rr.x - (far ? 3 : -4) * l.s, y: rr.y + back };
    const netLines = Array.from({ length: 7 }, (_, i) => {
      const k = (i + 1) / 8;
      return { x0: l.x + (rr.x - l.x) * k, x1: nl.x + (nr.x - nl.x) * k };
    });
    return (
      <G>
        <Polygon
          points={`${l.x},${l.y - hgt} ${rr.x},${rr.y - hgt} ${nr.x},${nr.y - hgt * 0.8} ${nl.x},${nl.y - hgt * 0.8}`}
          fill="rgba(255,255,255,0.18)"
        />
        <Polygon points={`${nl.x},${nl.y - hgt * 0.8} ${nr.x},${nr.y - hgt * 0.8} ${nr.x},${nr.y} ${nl.x},${nl.y}`} fill="rgba(255,255,255,0.22)" />
        {netLines.map((n, i) => (
          <Line key={i} x1={n.x0} y1={l.y - hgt} x2={n.x1} y2={nl.y - hgt * 0.8} stroke="rgba(255,255,255,0.45)" strokeWidth={0.7} />
        ))}
        {[0.25, 0.5, 0.75].map((k) => (
          <Line key={k} x1={nl.x} y1={nl.y - hgt * 0.8 * (1 - k)} x2={nr.x} y2={nr.y - hgt * 0.8 * (1 - k)} stroke="rgba(255,255,255,0.4)" strokeWidth={0.7} />
        ))}
        <Path d={`M ${l.x} ${l.y} L ${l.x} ${l.y - hgt} L ${rr.x} ${rr.y - hgt} L ${rr.x} ${rr.y}`} stroke="#ffffff" strokeWidth={compact ? 2 : 3} fill="none" strokeLinejoin="round" />
      </G>
    );
  };
  const crowd = useMemo(() => {
    const out: { x: number; y: number; c: string }[] = [];
    const colors = ['#e5484d', '#ffd23f', '#4f7ae5', '#ffffff', '#f08a24', '#8b6fd6', '#3fb37f'];
    const rows = compact ? 3 : 4;
    for (let r = 0; r < rows; r++) {
      const y = v.stand * (0.3 + (0.62 * r) / rows);
      const n = Math.round(v.w / (compact ? 7 : 8));
      for (let i = 0; i < n; i++) {
        const k = (i * 7 + r * 13) % colors.length;
        out.push({ x: (i + (r % 2) * 0.5) * (v.w / n), y: y + ((i * 31) % 5) * 0.4, c: colors[k] });
      }
    }
    return out;
  }, [v.w, v.stand, compact]);
  const far = P(0, 0);
  const farR = P(1, 0);
  return (
    <Svg width={v.w} height={v.h} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="light" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#000000" stopOpacity="0.18" />
          <Stop offset="0.5" stopColor="#000000" stopOpacity="0" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0.06" />
        </LinearGradient>
      </Defs>
      {/* The stand behind the far goal, and the fans in it. */}
      <Rect x={0} y={0} width={v.w} height={v.stand} fill="#2a2f45" />
      <Rect x={0} y={0} width={v.w} height={v.stand * 0.22} fill="#1d2133" />
      {crowd.map((c, i) => (
        <Circle key={i} cx={c.x} cy={c.y} r={compact ? 2 : 2.6} fill={c.c} opacity={0.85} />
      ))}
      {/* Ad boards along the far end. */}
      <Rect x={0} y={v.stand} width={v.w} height={v.y0 - v.stand} fill="#e5484d" />
      <Rect x={v.w * 0.33} y={v.stand} width={v.w * 0.34} height={v.y0 - v.stand} fill="#4f7ae5" />
      {/* The ground round the pitch, then the pitch, mown in stripes. */}
      <Rect x={0} y={v.y0} width={v.w} height={v.h - v.y0} fill="#2c7a47" />
      {Array.from({ length: stripes }, (_, i) => (
        <Polygon key={i} points={quad(-0.04, i / stripes, 1.04, (i + 1) / stripes)} fill={i % 2 ? PITCH : PITCH_STRIPE} />
      ))}
      {/* Lines. */}
      <Polygon points={quad(0, 0, 1, 1)} fill="none" stroke={LINE} strokeWidth={lw} />
      <Path d={line([P(0, 0.5), P(1, 0.5)])} stroke={LINE} strokeWidth={lw} />
      <Path d={ring(0.5, 0.5, 0.15)} stroke={LINE} strokeWidth={lw} fill="none" />
      <Circle cx={P(0.5, 0.5).x} cy={P(0.5, 0.5).y} r={2} fill={LINE} />
      {[0, 1].map((end) => {
        const dir = end ? -1 : 1;
        const y = end;
        return (
          <G key={end}>
            <Path d={line([P(0.21, y), P(0.21, y + dir * 0.16), P(0.79, y + dir * 0.16), P(0.79, y)])} stroke={LINE} strokeWidth={lw} fill="none" />
            <Path d={line([P(0.37, y), P(0.37, y + dir * 0.055), P(0.63, y + dir * 0.055), P(0.63, y)])} stroke={LINE} strokeWidth={lw} fill="none" />
            <Circle cx={P(0.5, y + dir * 0.11).x} cy={P(0.5, y + dir * 0.11).y} r={1.8} fill={LINE} />
            <Path d={ring(0.5, y + dir * 0.11, 0.13, end ? Math.PI * 1.22 : Math.PI * 0.22, end ? Math.PI * 1.78 : Math.PI * 0.78, 16)} stroke={LINE} strokeWidth={lw} fill="none" />
            {[0, 1].map((side) => (
              <Path key={side} d={ring(side, y, 0.025, 0, Math.PI * 2, 20)} stroke={LINE} strokeWidth={lw * 0.8} fill="none" opacity={0.7} />
            ))}
          </G>
        );
      })}
      {/* Light from the stand's side, darker at the far end. */}
      <Rect x={0} y={v.y0} width={v.w} height={v.h - v.y0} fill="url(#light)" />
      {goal(0, true)}
      {goal(1, false)}
      {/* The far corners' flags. */}
      {[far, farR].map((c, i) => (
        <G key={i}>
          <Line x1={c.x} y1={c.y} x2={c.x} y2={c.y - 12 * c.s} stroke="#ffffff" strokeWidth={1.2} />
          <Polygon points={`${c.x},${c.y - 12 * c.s} ${c.x + (i ? -7 : 7) * c.s},${c.y - 10 * c.s} ${c.x},${c.y - 8 * c.s}`} fill="#ffd23f" />
        </G>
      ))}
    </Svg>
  );
}

// A real-looking ball: white panels, a black pentagon in the middle and
// five round the edge, the seams between them, lit from the top left.
export function SoccerBall({ size }: { size: number }) {
  const pent = (cx: number, cy: number, r: number, turn: number) =>
    Array.from({ length: 5 }, (_, i) => {
      const a = turn + (i * 2 * Math.PI) / 5;
      return `${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`;
    }).join(' ');
  const up = -Math.PI / 2;
  const inner = Array.from({ length: 5 }, (_, i) => up + (i * 2 * Math.PI) / 5);
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <ClipPath id="ballClip">
          <Circle cx={50} cy={50} r={47} />
        </ClipPath>
        <RadialGradient id="ballLight" cx="35%" cy="30%" r="75%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <Stop offset="0.7" stopColor="#000000" stopOpacity="0.08" />
          <Stop offset="1" stopColor="#000000" stopOpacity="0.35" />
        </RadialGradient>
      </Defs>
      <Circle cx={50} cy={50} r={47} fill="#ffffff" />
      <G clipPath="url(#ballClip)">
        {/* Seams from the middle pentagon out to the edge ones. */}
        {inner.map((a, i) => (
          <Line key={i} x1={50 + Math.cos(a) * 17} y1={50 + Math.sin(a) * 17} x2={50 + Math.cos(a) * 30} y2={50 + Math.sin(a) * 30} stroke="#2a2a2a" strokeWidth={2.5} />
        ))}
        {inner.map((a, i) => {
          const m = a + Math.PI / 5;
          return <Line key={`s${i}`} x1={50 + Math.cos(a) * 30} y1={50 + Math.sin(a) * 30} x2={50 + Math.cos(m) * 44} y2={50 + Math.sin(m) * 44} stroke="#2a2a2a" strokeWidth={2.5} />;
        })}
        <Polygon points={pent(50, 50, 17, up)} fill="#1d1d1d" />
        {inner.map((a, i) => {
          const m = a + Math.PI / 5;
          return <Polygon key={`p${i}`} points={pent(50 + Math.cos(m) * 50, 50 + Math.sin(m) * 50, 16, m + Math.PI)} fill="#1d1d1d" />;
        })}
        <Circle cx={50} cy={50} r={47} fill="url(#ballLight)" />
      </G>
      <Circle cx={50} cy={50} r={47} fill="none" stroke="#1d1d1d" strokeWidth={3} />
    </Svg>
  );
}

