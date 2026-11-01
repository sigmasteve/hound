import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import type { Participant } from '../challenges/types';
import { formatSteps, shotsFor, soccerClock, SOCCER_POSITION_NAME, SOCCER_POSITION_SHORT, type SoccerPosition } from '../challenges/soccer';
import { soccerTeamMembers, soccerTeamOf, type SoccerDay, type SoccerGame, type SoccerPlayer, type SoccerShot, type SoccerTeam } from '../challenges/soccerApi';

// Whoever's on the pitch: the fields Participant and BoardEntry both
// carry, so the detail screen and Home can each hand over what they have.
export type PitchPerson = Pick<Participant, 'userId' | 'name' | 'initials'> &
  Partial<Pick<Participant, 'frameId' | 'backgroundId' | 'iconId' | 'level'>>;

const PITCH = '#2f7a4f';
const PITCH_STRIPE = '#2b7049';
const LINE = 'rgba(255,255,255,0.85)';

// The pitch seen from above, the viewer's team at the near end: keeper in
// goal, defenders in front of the box, forwards near the halfway line.
export function SoccerPitch({
  game,
  people,
  userId,
  compact,
}: {
  game: SoccerGame;
  people: PitchPerson[];
  userId: string | null | undefined;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const myTeam = soccerTeamOf(game, userId) ?? 'a';
  const farTeam: SoccerTeam = myTeam === 'a' ? 'b' : 'a';
  const size = compact ? 26 : 36;

  const row = (players: SoccerPlayer[], key: string) => (
    <View key={key} style={styles.row}>
      {players.map((p) => {
        const person = people.find((x) => x.userId === p.playerId);
        const isMe = p.playerId === userId;
        return (
          <View key={p.playerId} style={styles.slot}>
            <View style={[styles.ring, isMe && styles.ringMe, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}>
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
            {!compact && (
              <Text style={[styles.slotName, isMe && styles.slotNameMe]} numberOfLines={1}>
                {!p.joined ? 'Invited' : isMe ? 'You' : (person?.name ?? 'Player')}
              </Text>
            )}
            <Text style={styles.slotPos}>{SOCCER_POSITION_SHORT[p.position]}</Text>
          </View>
        );
      })}
    </View>
  );

  const half = (team: SoccerTeam, far: boolean) => {
    const members = soccerTeamMembers(game, team);
    const by = (pos: SoccerPosition) => members.filter((m) => m.position === pos);
    const lines = far
      ? [by('keeper'), by('defender'), by('forward')]
      : [by('forward'), by('defender'), by('keeper')];
    return (
      <View style={[styles.half, far ? styles.halfFar : styles.halfNear]}>
        <View style={[styles.goal, far ? styles.goalFar : styles.goalNear]} />
        <View style={[styles.box, far ? styles.boxFar : styles.boxNear]} />
        {lines.map((l, i) => (l.length > 0 ? row(l, `${team}-${i}`) : <View key={`${team}-${i}`} style={styles.rowEmpty} />))}
      </View>
    );
  };

  return (
    <View style={[styles.pitch, compact && styles.pitchCompact]}>
      {half(farTeam, true)}
      <View style={styles.halfway} />
      <View style={styles.centreCircle} pointerEvents="none" />
      {half(myTeam, false)}
    </View>
  );
}

// The score as the viewer reads it: their side first, with the clock.
export function SoccerScore({
  game,
  people,
  userId,
  days,
  compact,
}: {
  game: SoccerGame;
  people: PitchPerson[];
  userId: string | null | undefined;
  days: number;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const myTeam = soccerTeamOf(game, userId) ?? 'a';
  const label = (team: SoccerTeam) => {
    const members = soccerTeamMembers(game, team);
    if (members.length === 0) return 'Nobody yet';
    if (team === myTeam) return members.length === 1 && members[0].playerId === userId ? 'You' : `Your side (${members.length})`;
    const names = members.map((m) => people.find((x) => x.userId === m.playerId)?.name ?? (m.joined ? 'Player' : 'Invited'));
    return names.length <= 2 ? names.join(' & ') : `${names[0]} +${names.length - 1}`;
  };
  const us = myTeam === 'a' ? game.goalsA : game.goalsB;
  const them = myTeam === 'a' ? game.goalsB : game.goalsA;
  return (
    <View style={styles.score}>
      <View style={styles.scoreSide}>
        <Text style={[styles.scoreName, compact && styles.scoreNameCompact]} numberOfLines={1}>
          {label(myTeam)}
        </Text>
      </View>
      <View style={styles.scoreMid}>
        <Text style={[styles.scoreNum, compact && styles.scoreNumCompact]}>
          {us} – {them}
        </Text>
        <Text style={styles.scoreClock}>{game.status === 'final' ? 'FT' : soccerClock(game.daysPlayed, days)}</Text>
      </View>
      <View style={[styles.scoreSide, { alignItems: 'flex-end' }]}>
        <Text style={[styles.scoreName, compact && styles.scoreNameCompact]} numberOfLines={1}>
          {label(myTeam === 'a' ? 'b' : 'a')}
        </Text>
      </View>
    </View>
  );
}

export function SoccerCard({
  game,
  days,
  participants,
  userId,
  stepsToday,
  dayNo,
  matchDays,
  shots,
}: {
  game: SoccerGame | null;
  days: number;
  participants: PitchPerson[];
  userId: string | undefined;
  // The viewer's steps so far today, from the phone; null while loading.
  stepsToday: number | null;
  // Today's day number in the match (1-based), or null outside it.
  dayNo: number | null;
  matchDays: SoccerDay[];
  shots: SoccerShot[];
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!game) {
    return (
      <Card style={{ gap: 8 }} elevated={false}>
        <Text style={text.h4}>Soccer</Text>
        <Text style={styles.note}>This match never got set up. Delete it and start another.</Text>
      </Card>
    );
  }

  const me = game.players.find((p) => p.playerId === userId);
  const myTeam = me?.team ?? 'a';
  const nameOf = (id: string | null) => (id === userId ? 'You' : (participants.find((p) => p.userId === id)?.name ?? 'Someone'));
  const waiting = game.players.filter((p) => !p.joined).length;
  const todaysShots = stepsToday == null ? null : shotsFor(stepsToday, game.shotSteps);
  const us = myTeam === 'a' ? game.goalsA : game.goalsB;
  const them = myTeam === 'a' ? game.goalsB : game.goalsA;

  const roleLine = () => {
    if (!me) return null;
    if (game.status === 'final') return null;
    if (dayNo == null) return 'The match hasn’t started yet. Your steps count from day 1.';
    const steps = stepsToday == null ? 'your steps so far' : formatSteps(stepsToday);
    switch (me.position) {
      case 'forward':
        return `Day ${dayNo}: ${steps} today${todaysShots != null ? ` = ${todaysShots} shot${todaysShots === 1 ? '' : 's'} so far` : ''}. Next shot at ${formatSteps(game.shotSteps * ((todaysShots ?? 0) + 1))}.`;
      case 'defender':
        return `Day ${dayNo}: ${steps} today, on the back line. The more the defense walks, the more of their shots miss.`;
      case 'keeper':
        return `Day ${dayNo}: ${steps} today, in goal. The more you walk, the more shots on target you stop.`;
    }
  };

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.header}>
        <Text style={text.h4}>Soccer</Text>
        <Text style={styles.meta}>
          {days} days · a shot every {formatSteps(game.shotSteps)} · up to 4 a day · resolved each morning
        </Text>
      </View>

      <SoccerScore game={game} people={participants} userId={userId} days={days} />
      <SoccerPitch game={game} people={participants} userId={userId} />

      {waiting > 0 && game.status === 'active' && (
        <Text style={styles.note}>
          {waiting === 1 ? 'One player hasn’t' : `${waiting} players haven’t`} accepted yet. The match plays on; they count from the day they join.
        </Text>
      )}
      {me && <Text style={styles.note}>You play {SOCCER_POSITION_NAME[me.position]}. {roleLine()}</Text>}
      {game.status === 'final' && (
        <Text style={styles.note}>
          Full time, {us}–{them}. {game.winnerTeam == null ? 'A draw.' : game.winnerTeam === myTeam ? 'Your side won!' : 'Their side won.'}
        </Text>
      )}

      {matchDays.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={styles.reportTitle}>Match report</Text>
          {[...matchDays].reverse().map((d) => {
            const dayShots = shots.filter((s) => s.dayNo === d.dayNo);
            const goals = dayShots.filter((s) => s.outcome === 'goal');
            const saves = dayShots.filter((s) => s.outcome === 'saved');
            const usDay = myTeam === 'a' ? d.goalsA : d.goalsB;
            const themDay = myTeam === 'a' ? d.goalsB : d.goalsA;
            const ourShots = myTeam === 'a' ? d.shotsA : d.shotsB;
            const ourOn = myTeam === 'a' ? d.onTargetA : d.onTargetB;
            const theirShots = myTeam === 'a' ? d.shotsB : d.shotsA;
            const theirOn = myTeam === 'a' ? d.onTargetB : d.onTargetA;
            return (
              <View key={d.dayNo} style={styles.report}>
                <View style={styles.reportHead}>
                  <Text style={styles.reportDay}>Day {d.dayNo}</Text>
                  <Text style={styles.reportScore}>
                    {usDay}–{themDay}
                  </Text>
                </View>
                <Text style={styles.reportLine}>
                  Your side {ourShots} shot{ourShots === 1 ? '' : 's'}, {ourOn} on target · theirs {theirShots}, {theirOn} on target.
                </Text>
                {goals.map((g, i) => (
                  <Text key={`g${i}`} style={styles.reportLine}>
                    ⚽ {nameOf(g.shooterId)} scored on {formatSteps(g.shooterSteps)}
                    {g.keeperId ? ` past ${nameOf(g.keeperId)}` : ''}.
                  </Text>
                ))}
                {saves.map((s, i) => (
                  <Text key={`s${i}`} style={styles.reportLine}>
                    🧤 {nameOf(s.keeperId)} saved from {nameOf(s.shooterId)}.
                  </Text>
                ))}
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { gap: 2 },
    meta: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.7), lineHeight: 18 },
    pitch: { borderRadius: 12, overflow: 'hidden', backgroundColor: PITCH, borderWidth: 2, borderColor: LINE },
    pitchCompact: { borderRadius: 10 },
    half: { paddingVertical: 8, paddingHorizontal: 12, gap: 4 },
    halfFar: { backgroundColor: PITCH_STRIPE },
    halfNear: {},
    halfway: { height: 1.5, backgroundColor: LINE },
    centreCircle: { position: 'absolute', alignSelf: 'center', top: '50%', marginTop: -18, width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: LINE, opacity: 0.8 },
    goal: { position: 'absolute', alignSelf: 'center', width: '28%', height: 6, backgroundColor: 'rgba(255,255,255,0.35)', borderWidth: 1.5, borderColor: LINE },
    goalFar: { top: 0 },
    goalNear: { bottom: 0 },
    box: { position: 'absolute', alignSelf: 'center', width: '60%', height: 22, borderWidth: 1.5, borderColor: LINE, opacity: 0.7 },
    boxFar: { top: -2, borderTopWidth: 0 },
    boxNear: { bottom: -2, borderBottomWidth: 0 },
    row: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'flex-start', gap: 6, minHeight: 36 },
    rowEmpty: { height: 10 },
    slot: { alignItems: 'center', gap: 1, minWidth: 48, maxWidth: 90 },
    ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
    ringMe: { borderColor: colors.amber },
    ghost: { borderWidth: 2, borderStyle: 'dashed', borderColor: LINE, alignItems: 'center', justifyContent: 'center' },
    ghostText: { color: LINE, fontFamily: font.heading, fontSize: 14 },
    slotName: { color: '#ffffff', fontSize: 11, fontFamily: font.heading, maxWidth: 88 },
    slotNameMe: { color: '#ffe3a3' },
    slotPos: { color: 'rgba(255,255,255,0.75)', fontSize: 9, letterSpacing: 0.5 },
    score: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    scoreSide: { flex: 1, minWidth: 0 },
    scoreMid: { alignItems: 'center' },
    scoreName: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    scoreNameCompact: { fontSize: 12 },
    scoreNum: { fontFamily: font.heading, fontSize: 24, color: colors.text, fontVariant: ['tabular-nums'] },
    scoreNumCompact: { fontSize: 18 },
    scoreClock: { fontSize: 11, color: withAlpha(colors.text, 0.55), fontVariant: ['tabular-nums'] },
    reportTitle: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    report: { gap: 2, padding: 10, borderRadius: 10, backgroundColor: withAlpha(colors.accent, 0.08) },
    reportHead: { flexDirection: 'row', justifyContent: 'space-between' },
    reportDay: { fontFamily: font.heading, fontSize: 13, color: colors.text },
    reportScore: { fontFamily: font.heading, fontSize: 13, color: colors.accentActive, fontVariant: ['tabular-nums'] },
    reportLine: { fontSize: 12, color: withAlpha(colors.text, 0.75), lineHeight: 17 },
  });
}
