import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, TINT_N, type Palette } from '../theme/tokens';
import type { Participant } from '../challenges/types';
import { SOCCER_POSITION_SHORT, type SoccerPosition, type SoccerZone } from '../challenges/soccer';
import { soccerTeamMembers, soccerTeamOf, type SoccerGame, type SoccerPlayer, type SoccerShot, type SoccerTeam } from '../challenges/soccerApi';

// Whoever's on the pitch: the fields Participant and BoardEntry both
// carry, so the detail screen and Home can each hand over what they have.
export type PitchPerson = Pick<Participant, 'userId' | 'name' | 'initials'> &
  Partial<Pick<Participant, 'frameId' | 'backgroundId' | 'iconId' | 'level'>>;

const PITCH = '#2f7a4f';
const PITCH_STRIPE = '#2b7049';
const LINE = 'rgba(255,255,255,0.85)';

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
}: {
  game: SoccerGame;
  people: PitchPerson[];
  userId: string | null | undefined;
  compact?: boolean;
  shot?: { shot: SoccerShot; n: number } | null;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [w, setW] = useState(0);
  const h = w * (compact ? 1.0 : 1.45);
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

    const px = (p: { x: number; y: number }) => ({ x: p.x * w, y: p.y * h });
    const offset = (id: string, to: { x: number; y: number }) => {
      const b = spots.get(id)!;
      return { x: (to.x - b.x) * w, y: (to.y - b.y) * h };
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
  const ballSize = compact ? 8 : 11;

  return (
    <View
      onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}
      style={[styles.pitch, compact && styles.pitchCompact, { height: h || undefined, aspectRatio: w ? undefined : compact ? 1 : 1 / 1.45 }]}
    >
      {w > 0 && (
        <>
          <View style={[styles.stripe, { height: h / 2 }]} />
          <View style={[styles.halfway, { top: h / 2 - 0.75 }]} />
          <View style={[styles.centreCircle, { top: h / 2 - 18, left: w / 2 - 18 }]} pointerEvents="none" />
          <View style={[styles.box, { top: -2, left: w * 0.2, width: w * 0.6, height: h * 0.06, borderTopWidth: 0 }]} />
          <View style={[styles.box, { bottom: -2, left: w * 0.2, width: w * 0.6, height: h * 0.06, borderBottomWidth: 0 }]} />
          <View style={[styles.goal, { top: 0, left: w * 0.36, width: w * 0.28 }]} />
          <View style={[styles.goal, { bottom: 0, left: w * 0.36, width: w * 0.28 }]} />

          {[...spots.values()].map(({ x, y, p, perRow }) => {
            const left = x * w;
            const top = y * h;
            if (!p.joined) {
              // Someone who hasn't accepted yet: a small dot, out of the way.
              return <View key={p.playerId} pointerEvents="none" style={[styles.dot, { left: left - 4, top: top - 4 }]} />;
            }
            const person = people.find((q) => q.userId === p.playerId);
            const isMe = p.playerId === userId;
            const labelW = Math.min(88, (w / (perRow + 0.4)) * 0.98);
            const on = lit.has(p.playerId);
            return (
              <Animated.View
                key={p.playerId}
                pointerEvents="none"
                style={[
                  styles.slot,
                  { left: left - labelW / 2, top: top - (size + 6) / 2, width: labelW, zIndex: on ? 2 : 1 },
                  { transform: moveOf(p.playerId).getTranslateTransform() },
                ]}
              >
                <View style={[styles.ring, (isMe || on) && styles.ringMe, on && !isMe && styles.ringOn, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}>
                  <Avatar
                    initials={person?.initials ?? '?'}
                    tint={isMe ? TINT_A : p.botId ? colors.neutral800 : TINT_N}
                    size={size}
                    fontSize={compact ? 10 : 12}
                    frameId={person?.frameId}
                    backgroundId={person?.backgroundId}
                    iconId={person?.iconId}
                  />
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
              { width: ballSize, height: ballSize, borderRadius: ballSize / 2, left: -ballSize / 2, top: -ballSize / 2, opacity: ballOn },
              { transform: ball.getTranslateTransform() },
            ]}
          />
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
    pitch: { borderRadius: 12, overflow: 'hidden', backgroundColor: PITCH, borderWidth: 2, borderColor: LINE },
    pitchCompact: { borderRadius: 10 },
    stripe: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: PITCH_STRIPE },
    halfway: { position: 'absolute', left: 0, right: 0, height: 1.5, backgroundColor: LINE },
    centreCircle: { position: 'absolute', width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: LINE, opacity: 0.8 },
    goal: { position: 'absolute', height: 6, backgroundColor: 'rgba(255,255,255,0.35)', borderWidth: 1.5, borderColor: LINE },
    box: { position: 'absolute', borderWidth: 1.5, borderColor: LINE, opacity: 0.7 },
    dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.35)' },
    slot: { position: 'absolute', alignItems: 'center', gap: 1 },
    ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
    ringMe: { borderColor: colors.amber },
    ringOn: { borderColor: '#ffffff' },
    slotName: { color: '#ffffff', fontSize: 11, fontFamily: font.heading, maxWidth: '100%' },
    slotNameMe: { color: '#ffe3a3' },
    slotPos: { color: 'rgba(255,255,255,0.75)', fontSize: 9, letterSpacing: 0.5 },
    ball: { position: 'absolute', backgroundColor: '#ffffff', borderWidth: 1.5, borderColor: '#1d1d1d', zIndex: 3 },
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
