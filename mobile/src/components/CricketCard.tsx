import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { Card } from './Card';
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

// Whoever's on the ground: the fields Participant and BoardEntry both
// carry, so the detail screen and Home can each hand over what they have.
export type GroundPerson = Pick<Participant, 'userId' | 'name' | 'initials'> &
  Partial<Pick<Participant, 'frameId' | 'backgroundId' | 'iconId' | 'level'>>;

const GRASS = '#3b7f4a';
const GRASS_RING = '#357443';
const PITCH = '#d9c08a';
const CHALK = 'rgba(255,255,255,0.88)';

// Where the fielders stand, as a share of the ground from its centre:
// round the ring, leaving the two ends of the pitch clear.
const FIELD_SPOTS: [number, number][] = [
  [-0.36, -0.2],
  [0.36, -0.2],
  [-0.4, 0.12],
  [0.4, 0.12],
  [-0.22, 0.38],
  [0.22, 0.38],
  [-0.18, -0.4],
  [0.18, -0.4],
];

function sideName(game: CricketGame, team: CricketTeam, people: GroundPerson[], userId: string | null | undefined): string {
  const members = cricketSide(game, team);
  const mine = cricketTeamOf(game, userId) === team;
  if (mine) return members.length === 1 ? 'You' : `Your side (${members.length})`;
  const names = members.map((m) => people.find((p) => p.userId === m.playerId)?.name ?? (m.joined ? 'Player' : 'Invited'));
  return names.length <= 2 ? names.join(' & ') : `${names[0]} +${names.length - 1}`;
}

// The ground from above: the pitch down the middle, the batter on strike
// at the near end, the bowler at the far end, the rest of the fielding
// side round the ring. The batting side's others wait in the pavilion.
export function CricketGround({
  game,
  onStrike,
  people,
  userId,
  compact,
}: {
  game: CricketGame;
  onStrike: CricketOnStrike | null;
  people: GroundPerson[];
  userId: string | null | undefined;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const size = compact ? 28 : 38;
  const bt = onStrike?.battingTeam ?? battingNow(game);
  const ft = otherSide(bt);
  const fielders = cricketSide(game, ft).filter((p) => p.playerId !== onStrike?.bowlerId);
  const batters = cricketSide(game, bt);
  const waiting = batters.filter((p) => p.playerId !== onStrike?.batterId);

  const avatar = (p: CricketPlayer | undefined, ring?: 'bat' | 'bowl') => {
    if (!p) return null;
    const person = people.find((x) => x.userId === p.playerId);
    const isMe = p.playerId === userId;
    return (
      <View style={[styles.ring, ring && styles.ringOn, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}>
        {p.joined && person ? (
          <Avatar
            initials={person.initials}
            tint={isMe ? TINT_A : p.botId ? colors.neutral800 : TINT_N}
            size={size}
            fontSize={compact ? 10 : 13}
            frameId={person.frameId}
            backgroundId={person.backgroundId}
            iconId={person.iconId}
          />
        ) : (
          <View style={[styles.ghost, { width: size, height: size, borderRadius: size / 2 }]}>
            <Text style={styles.ghostText}>?</Text>
          </View>
        )}
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
  const batter = game.players.find((p) => p.playerId === onStrike?.batterId);
  const bowler = game.players.find((p) => p.playerId === onStrike?.bowlerId);

  return (
    <View style={{ gap: 6 }}>
      <View style={[styles.ground, compact && styles.groundCompact]}>
        <View style={styles.innerRing} />
        <View style={styles.pitch}>
          <View style={[styles.crease, { top: '12%' }]} />
          <View style={[styles.crease, { bottom: '12%' }]} />
        </View>
        <View style={[styles.end, styles.endFar]}>
          {avatar(bowler, 'bowl')}
          {label(bowler, 'bowling')}
        </View>
        <View style={[styles.end, styles.endNear]}>
          {label(batter, 'batting')}
          {avatar(batter, 'bat')}
        </View>
        {fielders.slice(0, FIELD_SPOTS.length).map((p, i) => {
          const [x, y] = FIELD_SPOTS[i];
          return (
            <View
              key={p.playerId}
              style={[
                styles.fielder,
                { left: `${50 + x * 100}%`, top: `${50 + y * 100}%`, marginLeft: -(size + 6) / 2, marginTop: -(size + 6) / 2 },
              ]}
            >
              {avatar(p)}
            </View>
          );
        })}
        {!onStrike && (
          <View style={styles.restWrap} pointerEvents="none">
            <Text style={styles.rest}>{game.status === 'final' ? 'Stumps' : 'Waiting for players'}</Text>
          </View>
        )}
      </View>
      {!compact && waiting.length > 0 && onStrike && (
        <View style={styles.pavilion}>
          <Text style={styles.pavilionLabel}>Pavilion</Text>
          <View style={styles.pavilionRow}>
            {waiting.map((p) => (
              <View key={p.playerId} style={{ opacity: 0.85 }}>
                {avatar(p)}
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
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
  const mySteps = stepsToday == null ? 'your steps so far' : formatSteps(stepsToday);

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
      <CricketGround game={game} onStrike={onStrike} people={participants} userId={userId} />

      {game.status === 'active' && onStrike && (
        <View style={styles.today}>
          <Text style={styles.todayTitle}>
            Today · innings {onStrike.innings}, over {onStrike.overNo} of {game.overs}
          </Text>
          <Text style={styles.note}>
            {iBat
              ? `You're on strike against ${nameOf(onStrike.bowlerId)}. Every ball is your steps against theirs: out-walk them for boundaries, fall behind and wickets fall. You have ${mySteps}.`
              : iBowl
                ? `You're bowling to ${nameOf(onStrike.batterId)}. Out-walk them and the wickets come. You have ${mySteps}.`
                : `${nameOf(onStrike.batterId)} bats against ${nameOf(onStrike.bowlerId)}'s bowling. The over is played tomorrow morning on today's steps.`}
          </Text>
        </View>
      )}
      {game.status === 'final' && <Text style={styles.result}>{cricketResultLine(game, participants, userId)}</Text>}

      {overs.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={styles.sectionTitle}>Over by over</Text>
          {overs.map((o) => (
            <View key={`${o.innings}-${o.overNo}`} style={styles.over}>
              <View style={styles.overHead}>
                <Text style={styles.overTitle}>
                  {o.innings === 1 ? '1st' : '2nd'} innings · over {o.overNo}
                </Text>
                <Text style={styles.overRuns}>
                  {o.balls.reduce((s, b) => s + b.runs, 0)} runs
                  {o.balls.some((b) => b.outcome === 'W') ? ` · ${o.balls.filter((b) => b.outcome === 'W').length}W` : ''}
                </Text>
              </View>
              <Text style={styles.overWho} numberOfLines={2}>
                {nameOf(o.bowlerId)} to {Array.from(new Set(o.balls.map((b) => nameOf(b.batterId)))).join(', ')} · steps{' '}
                {o.balls[0].bowlerSteps.toLocaleString()} vs {o.balls[0].batterSteps.toLocaleString()}
              </Text>
              <View style={styles.chips}>
                {o.balls.map((b) => (
                  <View key={b.ballNo} style={[styles.chip, chipStyle(b.outcome, styles)]}>
                    <Text style={[styles.chipText, b.outcome === 'W' && styles.chipTextOut]}>{ballLabel(b.outcome)}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}

      {balls.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={styles.sectionTitle}>Batting</Text>
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
        </View>
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
    ground: {
      width: '100%',
      aspectRatio: 1.15,
      maxWidth: '100%',
      borderRadius: 999,
      backgroundColor: GRASS,
      borderWidth: 3,
      borderColor: CHALK,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    groundCompact: { aspectRatio: 1.6 },
    innerRing: { position: 'absolute', width: '62%', height: '62%', borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)', borderStyle: 'dashed', backgroundColor: GRASS_RING },
    pitch: { position: 'absolute', width: '13%', height: '46%', backgroundColor: PITCH, borderRadius: 3 },
    crease: { position: 'absolute', left: -6, right: -6, height: 2, backgroundColor: CHALK },
    end: { position: 'absolute', alignItems: 'center', gap: 2, left: 0, right: 0 },
    endFar: { top: '10%' },
    endNear: { bottom: '10%' },
    endLabel: { color: '#ffffff', fontSize: 11, fontFamily: font.heading, maxWidth: 160 },
    endLabelMe: { color: '#ffe3a3' },
    fielder: { position: 'absolute' },
    ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
    ringOn: { borderColor: colors.amber },
    ghost: { borderWidth: 2, borderStyle: 'dashed', borderColor: CHALK, alignItems: 'center', justifyContent: 'center' },
    ghostText: { color: CHALK, fontFamily: font.heading, fontSize: 13 },
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
    today: { gap: 4, padding: 12, borderRadius: 12, backgroundColor: withAlpha(colors.accent, 0.08) },
    todayTitle: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    sectionTitle: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    over: { gap: 6, padding: 10, borderRadius: 10, backgroundColor: withAlpha(colors.text, 0.04) },
    overHead: { flexDirection: 'row', justifyContent: 'space-between' },
    overTitle: { fontFamily: font.heading, fontSize: 13, color: colors.text },
    overRuns: { fontFamily: font.heading, fontSize: 13, color: colors.accentActive, fontVariant: ['tabular-nums'] },
    overWho: { fontSize: 12, color: withAlpha(colors.text, 0.65) },
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
