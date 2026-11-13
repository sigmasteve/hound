import React, { useId, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';
import { Text } from './Text';
import { crowdDots, perspective, project, sizeAt, type Perspective } from './perspective';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { DayCard } from './DayCard';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import type { Participant } from '../challenges/types';
import { ballLabel, formatSteps, oversLabel, wicketsAllowed, type CricketOutcome } from '../challenges/cricket';
import {
  battingNow,
  cricketSide,
  cricketTeamOf,
  otherSide,
  type CricketBall,
  type CricketGame,
  type CricketOnStrike,
  type CricketPlayer,
  type CricketTeam,
} from '../challenges/cricketApi';
import { GameDayLine, SportBadge, SportBonusRow, useGameDayIds } from './SportBonusRow';

// Whoever's on the ground: the fields Participant and BoardEntry both
// carry, so the detail screen and Home can each hand over what they have.
export type GroundPerson = Pick<Participant, 'userId' | 'name' | 'initials'> &
  Partial<Pick<Participant, 'frameId' | 'backgroundId' | 'iconId' | 'level'>>;

const GRASS = '#3b7f4a';
const GRASS_RING = '#357443';
const GRASS_OUT = '#2c6238';
const PITCH = '#d9c08a';
const CHALK = 'rgba(255,255,255,0.88)';

// Where the fielders stand, as a share of the ground from its centre:
// round the ring, leaving the two ends of the pitch clear.
const FIELD_SPOTS: [number, number][] = [
  [-0.3, -0.3],
  [0.3, -0.3],
  [-0.4, -0.02],
  [0.4, -0.02],
  [-0.32, 0.26],
  [0.32, 0.26],
  [-0.12, 0.41],
  [0.13, 0.43],
];
function sideName(game: CricketGame, team: CricketTeam, people: GroundPerson[], userId: string | null | undefined): string {
  const members = cricketSide(game, team);
  const mine = cricketTeamOf(game, userId) === team;
  if (mine) return members.length === 1 ? 'You' : `Your side (${members.length})`;
  const names = members.map((m) => people.find((p) => p.userId === m.playerId)?.name ?? (m.joined ? 'Player' : 'Invited'));
  return names.length <= 2 ? names.join(' & ') : `${names[0]} +${names.length - 1}`;
}

// The ground in perspective (perspective.ts) like every sport: seen from
// behind the batter, the far end narrower, a stand with the sight screen
// behind the bowler. The pitch runs up the middle with the stumps
// standing at each end; the batter on strike at the near end, the bowler
// at the far end, the rest of the fielding side round the ring, each
// with a shadow. The batting side's others wait in the pavilion.
//
// Every spot is a share of the ground's width (x) and length (y, 0 at
// the far boundary), put through project() so the art and the players
// line up.
// The pitch sits toward the near end, so the slips have room behind the
// batter; the batter stands beside the stumps (so they show), and the
// bowler's name goes above them so the pitch stays clear.
const PITCH_Y: [number, number] = [0.36, 0.8];
const STUMPS_Y: [number, number] = [0.38, 0.78];
const BOWLER_AT = { x: 0.54, y: 0.33 };
const BATTER_AT = { x: 0.455, y: 0.765 };

export function CricketGround({
  game,
  onStrike,
  people,
  userId,
  compact,
  gameDayIds,
}: {
  game: CricketGame;
  onStrike: CricketOnStrike | null;
  people: GroundPerson[];
  userId: string | null | undefined;
  compact?: boolean;
  // Who's played real cricket today: a 🏏 badge on their hound.
  gameDayIds?: Set<string>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [w, setW] = useState(0);
  const h = Math.round(w * (compact ? 0.72 : 1.02));
  const view = useMemo(() => perspective(w, h, { stand: h * (compact ? 0.12 : 0.13), botW: w * 1.02, near: h * 0.02, a: 0.74, b: 0.86 }), [w, h, compact]);
  const size = compact ? 24 : 36;
  const bt = onStrike?.battingTeam ?? battingNow(game);
  const ft = otherSide(bt);
  const fielders = cricketSide(game, ft).filter((p) => p.playerId !== onStrike?.bowlerId);
  const batters = cricketSide(game, bt);
  const waiting = batters.filter((p) => p.playerId !== onStrike?.batterId);

  const avatar = (p: CricketPlayer | undefined, sz: number, ring?: 'bat' | 'bowl') => {
    if (!p) return null;
    const person = people.find((x) => x.userId === p.playerId);
    const isMe = p.playerId === userId;
    return (
      <View style={[styles.ring, ring && styles.ringOn, { width: sz + 6, height: sz + 6, borderRadius: (sz + 6) / 2 }]}>
        {p.joined && person ? (
          <Avatar
            initials={person.initials}
            tint={isMe ? TINT_A : p.botId ? colors.neutral800 : TINT_N}
            size={sz}
            fontSize={compact ? 10 : 13}
            frameId={person.frameId}
            backgroundId={person.backgroundId}
            iconId={person.iconId}
          />
        ) : (
          <View style={[styles.ghost, { width: sz, height: sz, borderRadius: sz / 2 }]}>
            <View style={styles.ghostDot} />
          </View>
        )}
        {gameDayIds?.has(p.playerId) && <SportBadge kind="cricket" size={compact ? 12 : 15} />}
      </View>
    );
  };
  const label = (p: CricketPlayer | undefined, role: string) => {
    if (!p || compact) return null;
    const isMe = p.playerId === userId;
    const name = isMe ? 'You' : (people.find((x) => x.userId === p.playerId)?.name ?? (p.joined ? 'Player' : 'Invited'));
    return (
      <Text style={[styles.endLabel, isMe && styles.endLabelMe]} numberOfLines={1}>
        {name} · {role}
      </Text>
    );
  };
  // A player on the ground: centred on their spot, smaller further off,
  // with a shadow, and their name under them at the ends of the pitch.
  const onGround = (key: string, p: CricketPlayer | undefined, x: number, y: number, ring?: 'bat' | 'bowl', role?: string, labelAbove = false) => {
    if (!p) return null;
    const at = project(view, x, y);
    const sz = sizeAt(view, at.s, size);
    const boxW = role && !compact ? 170 : sz + 6;
    return (
      <View
        key={key}
        pointerEvents="none"
        style={[
          styles.player,
          labelAbove && role && !compact ? { bottom: view.h - at.y - (sz + 6) / 2, flexDirection: 'column-reverse' } : { top: at.y - (sz + 6) / 2 },
          { left: at.x - boxW / 2, width: boxW, zIndex: Math.round(y * 10) },
        ]}
      >
        <View style={[styles.shadow, { width: sz * 0.8, height: sz * 0.2, borderRadius: sz, left: (boxW - sz * 0.8) / 2 }, labelAbove && role && !compact ? { bottom: -sz * 0.08 } : { top: sz + 1 }]} />
        {avatar(p, sz, ring)}
        {role && label(p, role)}
      </View>
    );
  };
  const batter = game.players.find((p) => p.playerId === onStrike?.batterId);
  const bowler = game.players.find((p) => p.playerId === onStrike?.bowlerId);

  return (
    <View style={{ gap: 6 }}>
      <View
        onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}
        style={[styles.ground, compact && styles.groundCompact, { height: h || undefined, aspectRatio: w ? undefined : compact ? 1.39 : 0.98 }]}
      >
        {w > 0 && (
          <>
            <GroundArt view={view} compact={!!compact} />
            {fielders.slice(0, FIELD_SPOTS.length).map((p, i) => {
              const [x, y] = FIELD_SPOTS[i];
              return onGround(p.playerId, p, 0.5 + x, 0.5 + y);
            })}
            {onGround('bowler', bowler, BOWLER_AT.x, BOWLER_AT.y, 'bowl', 'bowling', true)}
            {onGround('batter', batter, BATTER_AT.x, BATTER_AT.y, 'bat', 'batting')}
            {!onStrike && (
              <View style={[styles.restWrap, { zIndex: 20 }]} pointerEvents="none">
                <Text style={styles.rest}>{game.status === 'final' ? 'Stumps' : 'Waiting for players'}</Text>
              </View>
            )}
          </>
        )}
      </View>
      {!compact && waiting.length > 0 && onStrike && (
        <View style={styles.pavilion}>
          <Text style={styles.pavilionLabel}>Pavilion</Text>
          <View style={styles.pavilionRow}>
            {waiting.map((p) => (
              <View key={p.playerId} style={{ opacity: 0.85 }}>
                {avatar(p, size)}
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

// The stand and the sight screen, the outfield inside the rope, mown in
// stripes, the inner ring, and the pitch with its creases and stumps.
function GroundArt({ view: v, compact }: { view: Perspective; compact: boolean }) {
  const P = (x: number, y: number) => project(v, x, y);
  const pts = (list: { x: number; y: number }[]) => list.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const quad = (x0: number, y0: number, x1: number, y1: number) => pts([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]);
  // An oval on the ground round the middle, rx and ry as shares.
  const oval = (rx: number, ry: number, n = 64) =>
    Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      return P(0.5 + Math.cos(t) * rx, 0.5 + Math.sin(t) * ry);
    });
  const lw = compact ? 1 : 1.5;
  const crowd = useMemo(() => crowdDots(v.w, v.stand, compact), [v.w, v.stand, compact]);
  const id = `ground${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const rope = oval(0.53, 0.5);
  const stripes = 10;
  // The stumps at one end: three standing up from the crease, bails on top.
  const stumps = (y: number, key: string) => {
    const c = P(0.5, y);
    const gap = 3 * c.s * (compact ? 0.8 : 1);
    const hgt = (compact ? 10 : 20) * c.s;
    return (
      <G key={key}>
        {[-1, 0, 1].map((k) => (
          <Rect key={k} x={c.x + k * gap - 0.8} y={c.y - hgt} width={compact ? 1.6 : 2.2} height={hgt} fill="#f4ead2" stroke="rgba(0,0,0,0.25)" strokeWidth={0.4} />
        ))}
        <Rect x={c.x - gap - 1} y={c.y - hgt - 1.2} width={gap * 2 + 2} height={1.4} fill="#c8913f" />
      </G>
    );
  };
  return (
    <Svg width={v.w} height={v.h} style={StyleSheet.absoluteFill}>
      <Defs>
        <ClipPath id={id}>
          <Polygon points={pts(rope)} />
        </ClipPath>
        <LinearGradient id={`${id}l`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#000000" stopOpacity="0.18" />
          <Stop offset="0.5" stopColor="#000000" stopOpacity="0" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0.06" />
        </LinearGradient>
      </Defs>
      {/* The stand behind the far boundary, its fans, and the white sight
          screen behind the bowler's arm. */}
      <Rect x={0} y={0} width={v.w} height={v.stand} fill="#2a2f45" />
      <Rect x={0} y={0} width={v.w} height={v.stand * 0.22} fill="#1d2133" />
      {crowd.map((c, i) => (
        <Circle key={i} cx={c.x} cy={c.y} r={compact ? 1.8 : 2.4} fill={c.c} opacity={0.85} />
      ))}
      <Rect x={v.w * 0.42} y={v.stand * 0.25} width={v.w * 0.16} height={v.y0 - v.stand * 0.25} fill="#f3f1ea" />
      <Rect x={0} y={v.stand} width={v.w * 0.42} height={v.y0 - v.stand} fill="#3fb37f" />
      <Rect x={v.w * 0.58} y={v.stand} width={v.w * 0.42} height={v.y0 - v.stand} fill="#3fb37f" />
      {/* Beyond the rope, then the outfield inside it, mown in stripes. */}
      <Rect x={0} y={v.y0} width={v.w} height={v.h - v.y0} fill={GRASS_OUT} />
      <G clipPath={`url(#${id})`}>
        {Array.from({ length: stripes }, (_, i) => (
          <Polygon key={i} points={quad(-0.1, i / stripes - 0.01, 1.1, (i + 1) / stripes + 0.01)} fill={i % 2 ? GRASS : GRASS_RING} />
        ))}
      </G>
      <Polygon points={pts(rope)} fill="none" stroke={CHALK} strokeWidth={compact ? 1.5 : 2.2} />
      <Polygon points={pts(oval(0.32, 0.3))} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={lw} strokeDasharray="4 4" />
      {/* The pitch, its creases, and the stumps. */}
      <Polygon points={quad(0.465, PITCH_Y[0], 0.535, PITCH_Y[1])} fill={PITCH} />
      {[STUMPS_Y[0] + 0.035, STUMPS_Y[1] - 0.035].map((y, i) => {
        const a = P(0.44, y);
        const b = P(0.56, y);
        return <Path key={`p${i}`} d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke={CHALK} strokeWidth={lw} />;
      })}
      {STUMPS_Y.map((y, i) => {
        const a = P(0.47, y);
        const b = P(0.53, y);
        return <Path key={`b${i}`} d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke={CHALK} strokeWidth={lw} />;
      })}
      <Rect x={0} y={v.y0} width={v.w} height={v.h - v.y0} fill={`url(#${id}l)`} />
      {stumps(STUMPS_Y[0], 'far')}
      {stumps(STUMPS_Y[1], 'near')}
    </Svg>
  );
}

// The scoreboard: both sides' runs, wickets and overs, the side batting
// marked, and the target once there is one.
export function CricketScore({
  game,
  people,
  userId,
  compact,
}: {
  game: CricketGame;
  people: GroundPerson[];
  userId: string | null | undefined;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const order: CricketTeam[] = [game.battingFirst, otherSide(game.battingFirst)];
  const batting = game.status === 'active' ? battingNow(game) : null;
  return (
    <View style={styles.score}>
      {order.map((team, i) => {
        const runs = team === 'a' ? game.runsA : game.runsB;
        const wk = team === 'a' ? game.wicketsA : game.wicketsB;
        const balls = team === 'a' ? game.ballsA : game.ballsB;
        const yetToBat = i === 1 && game.innings === 1 && game.status === 'active';
        const won = game.status === 'final' && game.winnerTeam === team;
        return (
          <View key={team} style={[styles.scoreRow, batting === team && styles.scoreRowOn]}>
            <Text style={[styles.scoreName, compact && styles.scoreNameCompact]} numberOfLines={1}>
              {sideName(game, team, people, userId)}
              {batting === team ? '  🏏' : ''}
              {won ? '  🏆' : ''}
            </Text>
            {yetToBat ? (
              <Text style={styles.scoreYet}>yet to bat</Text>
            ) : (
              <Text style={[styles.scoreRuns, compact && styles.scoreRunsCompact]}>
                {runs}/{wk} <Text style={styles.scoreOvers}>({oversLabel(balls)})</Text>
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

export function cricketResultLine(game: CricketGame, people: GroundPerson[], userId: string | null | undefined): string {
  if (game.status !== 'final') return '';
  if (game.result === 'tie') return 'A tie: the scores finished level.';
  const winner = game.winnerTeam as CricketTeam;
  const mine = cricketTeamOf(game, userId) === winner;
  const who = mine ? 'Your side' : sideName(game, winner, people, userId);
  if (game.result === 'chased') {
    const balls = winner === 'a' ? game.ballsA : game.ballsB;
    const wk = winner === 'a' ? game.wicketsA : game.wicketsB;
    const left = game.overs * 6 - balls;
    const sideSize = cricketSide(game, winner).filter((p) => p.joined).length;
    return `${who} chased it down with ${wicketsAllowed(sideSize) - wk} wicket${wicketsAllowed(sideSize) - wk === 1 ? '' : 's'} in hand${left > 0 ? ` and ${left} ball${left === 1 ? '' : 's'} to spare` : ''}.`;
  }
  const margin = (game.target ?? 0) - 1 - (winner === 'a' ? game.runsB : game.runsA);
  return `${who} won by ${margin} run${margin === 1 ? '' : 's'}.`;
}

export function CricketCard({
  game,
  onStrike,
  balls,
  participants,
  userId,
  stepsToday,
}: {
  game: CricketGame | null;
  onStrike: CricketOnStrike | null;
  balls: CricketBall[];
  participants: GroundPerson[];
  userId: string | undefined;
  // The viewer's steps so far today, from the phone; null while loading.
  stepsToday: number | null;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // The report shows the last three overs until asked for the rest.
  const [allOvers, setAllOvers] = useState(false);
  // Who's played real cricket today (0198), for the ground's badges.
  const gameDayIds = useGameDayIds(game?.challengeId, null);

  if (!game) {
    return (
      <Card style={{ gap: 8 }} elevated={false}>
        <Text style={text.h4}>Cricket</Text>
        <Text style={styles.note}>This match never got set up. Delete it and start another.</Text>
      </Card>
    );
  }

  const nameOf = (id: string | null | undefined) => (id === userId ? 'You' : (participants.find((p) => p.userId === id)?.name ?? 'Someone'));
  const chasing = game.innings === 2 && game.status === 'active' && game.target != null;
  const chaseTeam = otherSide(game.battingFirst);
  const chaseRuns = chaseTeam === 'a' ? game.runsA : game.runsB;
  const chaseBalls = chaseTeam === 'a' ? game.ballsA : game.ballsB;
  const need = chasing ? (game.target ?? 0) - chaseRuns : 0;
  const ballsLeft = game.overs * 6 - chaseBalls;
  const iBat = !!onStrike && onStrike.batterId === userId;
  const iBowl = !!onStrike && onStrike.bowlerId === userId;
  const mySteps = stepsToday == null ? 'steps loading' : `${formatSteps(stepsToday)} today`;

  // Overs, newest first, each with its balls.
  const overs = Array.from(
    balls
      .reduce((acc, b) => {
        const key = `${b.innings}-${b.overNo}`;
        const o = acc.get(key) ?? { innings: b.innings, overNo: b.overNo, bowlerId: b.bowlerId, battingTeam: b.battingTeam, day: b.dayNo, balls: [] as CricketBall[] };
        o.balls.push(b);
        return acc.set(key, o);
      }, new Map<string, { innings: 1 | 2; overNo: number; bowlerId: string; battingTeam: CricketTeam; day: number; balls: CricketBall[] }>())
      .values(),
  ).reverse();

  // The batting card for each innings so far.
  const card = (innings: 1 | 2) => {
    const rows = new Map<string, { runs: number; balls: number; out: boolean }>();
    for (const b of balls.filter((x) => x.innings === innings)) {
      const r = rows.get(b.batterId) ?? { runs: 0, balls: 0, out: false };
      r.runs += b.runs;
      r.balls += 1;
      if (b.outcome === 'W') r.out = true;
      rows.set(b.batterId, r);
    }
    return Array.from(rows.entries());
  };

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={{ gap: 2 }}>
        <Text style={text.h4}>Cricket</Text>
        <Text style={styles.meta}>
          {game.overs} overs a side · one over a day · {sideName(game, game.battingFirst, participants, userId)} won the toss and batted
        </Text>
      </View>

      <CricketScore game={game} people={participants} userId={userId} />
      {chasing && (
        <Text style={styles.chase}>
          Target {game.target}: {need} needed from {ballsLeft} ball{ballsLeft === 1 ? '' : 's'}.
        </Text>
      )}
      <CricketGround game={game} onStrike={onStrike} people={participants} userId={userId} gameDayIds={gameDayIds} />

      {/* Where things stand, in one line. */}
      {game.status === 'active' && onStrike && (
        <Text style={styles.status}>
          Today · {onStrike.innings === 1 ? '1st' : '2nd'} innings, over {onStrike.overNo} of {game.overs} ·{' '}
          {iBat
            ? `you bat against ${nameOf(onStrike.bowlerId)} · ${mySteps}`
            : iBowl
              ? `you bowl to ${nameOf(onStrike.batterId)} · ${mySteps}`
              : `${nameOf(onStrike.batterId)} bats, ${nameOf(onStrike.bowlerId)} bowls`}
          {' · played tomorrow morning'}
        </Text>
      )}
      {game.status === 'active' && (iBat || iBowl || game.players.some((p) => p.playerId === userId)) && (
        <SportBonusRow challengeId={game.challengeId} kind="cricket" userId={userId} />
      )}
      {game.status === 'final' && <Text style={styles.result}>{cricketResultLine(game, participants, userId)}</Text>}

      {overs.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={styles.sectionTitle}>Over by over</Text>
          {overs.slice(0, allOvers ? undefined : 3).map((o, i) => {
            const runs = o.balls.reduce((n, b) => n + b.runs, 0);
            const wk = o.balls.filter((b) => b.outcome === 'W').length;
            return (
              <DayCard
                key={`${o.innings}-${o.overNo}`}
                title={`Day ${o.day} · over ${o.overNo}${o.innings === 2 ? ' of the chase' : ''}`}
                score={`${runs}/${wk}`}
                summary={`${nameOf(o.bowlerId)} to ${Array.from(new Set(o.balls.map((b) => nameOf(b.batterId)))).join(', ')} · steps ${o.balls[0].bowlerSteps.toLocaleString()} vs ${o.balls[0].batterSteps.toLocaleString()}`}
                defaultOpen={i === 0}
              >
                <View style={styles.chips}>
                  {o.balls.map((b) => (
                    <View key={b.ballNo} style={[styles.chip, chipStyle(b.outcome, styles)]}>
                      <Text style={[styles.chipText, b.outcome === 'W' && styles.chipTextOut]}>{ballLabel(b.outcome)}</Text>
                    </View>
                  ))}
                </View>
                <GameDayLine challengeId={game.challengeId} day={o.balls[0]?.day ?? null} kind="cricket" nameOf={(id) => nameOf(id)} />
              </DayCard>
            );
          })}
          {!allOvers && overs.length > 3 && (
            <Pressable onPress={() => setAllOvers(true)} style={styles.earlier} accessibilityRole="button">
              <Text style={styles.earlierText}>Earlier overs ({overs.length - 3})</Text>
            </Pressable>
          )}
        </View>
      )}

      {balls.length > 0 && (
        <DayCard title="Batting card">
          {([1, 2] as const).map((inn) => {
            const rows = card(inn);
            if (rows.length === 0) return null;
            return (
              <View key={inn} style={{ gap: 2 }}>
                <Text style={styles.cardHead}>{inn === 1 ? '1st innings' : '2nd innings'}</Text>
                {rows.map(([id, r]) => (
                  <View key={id} style={styles.cardRow}>
                    <Text style={styles.cardName} numberOfLines={1}>
                      {nameOf(id)}
                      {r.out ? '' : '  not out'}
                    </Text>
                    <Text style={styles.cardNum}>
                      {r.runs} ({r.balls})
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}
        </DayCard>
      )}
    </Card>
  );
}

function chipStyle(o: CricketOutcome, styles: ReturnType<typeof makeStyles>) {
  if (o === 'W') return styles.chipOut;
  if (o === '4' || o === '6') return styles.chipBoundary;
  if (o === '0') return styles.chipDot;
  return null;
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    meta: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.7), lineHeight: 18 },
    chase: { fontFamily: font.heading, fontSize: 14, color: colors.accentActive },
    result: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    ground: { width: '100%', borderRadius: 12, overflow: 'hidden', backgroundColor: GRASS_OUT },
    groundCompact: { borderRadius: 10 },
    player: { position: 'absolute', alignItems: 'center', gap: 2 },
    shadow: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.22)' },
    // A dark pill, so the name reads over the grass and the pitch.
    endLabel: {
      color: '#ffffff',
      fontSize: 11,
      fontFamily: font.heading,
      maxWidth: 160,
      backgroundColor: 'rgba(0,0,0,0.5)',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      overflow: 'hidden',
    },
    endLabelMe: { color: '#ffe3a3' },
    ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
    ringOn: { borderColor: colors.amber },
    // Someone who hasn't accepted yet: a small dot, not a big '?'.
    ghost: { alignItems: 'center', justifyContent: 'center' },
    ghostDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
    restWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
    rest: { color: '#ffffff', fontFamily: font.heading, fontSize: 16, backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 },
    pavilion: { gap: 4 },
    pavilionLabel: { fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: withAlpha(colors.text, 0.55) },
    pavilionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    score: { gap: 4 },
    scoreRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, gap: 8 },
    scoreRowOn: { backgroundColor: withAlpha(colors.accent, 0.12) },
    scoreName: { fontFamily: font.heading, fontSize: 15, color: colors.text, flexShrink: 1 },
    scoreNameCompact: { fontSize: 13 },
    scoreRuns: { fontFamily: font.heading, fontSize: 20, color: colors.text, fontVariant: ['tabular-nums'] },
    scoreRunsCompact: { fontSize: 16 },
    scoreOvers: { fontSize: 13, color: withAlpha(colors.text, 0.55) },
    scoreYet: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    status: { fontSize: 12.5, color: withAlpha(colors.text, 0.62), lineHeight: 18 },
    earlier: { alignSelf: 'center', paddingVertical: 8 },
    earlierText: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.accent },
    sectionTitle: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { minWidth: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(colors.text, 0.08), paddingHorizontal: 6 },
    chipDot: { backgroundColor: withAlpha(colors.text, 0.05) },
    chipBoundary: { backgroundColor: withAlpha(colors.accent, 0.28) },
    chipOut: { backgroundColor: colors.amber },
    chipText: { fontFamily: font.heading, fontSize: 13, color: colors.text, fontVariant: ['tabular-nums'] },
    chipTextOut: { color: '#1c1b2e' },
    cardHead: { fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: withAlpha(colors.text, 0.55), marginTop: 2 },
    cardRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    cardName: { fontSize: 13.5, color: colors.text, flexShrink: 1 },
    cardNum: { fontFamily: font.heading, fontSize: 13.5, color: colors.text, fontVariant: ['tabular-nums'] },
  });
}
