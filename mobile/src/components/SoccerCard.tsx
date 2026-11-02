import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import type { Participant } from '../challenges/types';
import {
  formatSteps,
  shotsFor,
  soccerClock,
  SOCCER_PICK_PROMPT,
  SOCCER_POSITION_NAME,
  SOCCER_POSITION_SHORT,
  SOCCER_ZONE_NAME,
  type SoccerPosition,
  type SoccerZone,
} from '../challenges/soccer';
import {
  listSoccerTactics,
  setSoccerTactic,
  soccerTeamMembers,
  soccerTeamOf,
  type SoccerDay,
  type SoccerGame,
  type SoccerPlayer,
  type SoccerShot,
  type SoccerTactic,
  type SoccerTeam,
} from '../challenges/soccerApi';

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

// The goal seen from the penalty spot: four corners and the centre, each
// a tap target. A forward picks where to shoot, the keeper where to dive.
function GoalMouth({
  picked,
  mode,
  disabled,
  onPick,
}: {
  picked: SoccerZone | null;
  mode: 'aim' | 'dive';
  disabled: boolean;
  onPick: (zone: SoccerZone) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const mark = mode === 'aim' ? '⚽' : '🧤';
  const zone = (z: SoccerZone, style: object) => {
    const on = picked === z;
    return (
      <Pressable
        key={z}
        onPress={() => onPick(z)}
        disabled={disabled}
        style={({ pressed }) => [styles.zone, style, on && styles.zoneOn, pressed && !disabled && styles.zonePressed]}
        accessibilityRole="button"
        accessibilityState={{ selected: on, disabled }}
        accessibilityLabel={`${mode === 'aim' ? 'Shoot' : 'Dive'} ${SOCCER_ZONE_NAME[z]}`}
      >
        <Text style={[styles.zoneText, on && styles.zoneTextOn]}>{on ? mark : SOCCER_ZONE_NAME[z].replace('the ', '')}</Text>
      </Pressable>
    );
  };
  return (
    <View style={styles.goalFrame}>
      <View style={styles.goalRow}>
        {zone('top_left', styles.zoneCorner)}
        {zone('top_right', styles.zoneCorner)}
      </View>
      <View style={styles.goalRow}>
        {zone('bottom_left', styles.zoneCorner)}
        {zone('bottom_right', styles.zoneCorner)}
      </View>
      <View style={styles.zoneCenterWrap} pointerEvents="box-none">
        {zone('center', styles.zoneCenter)}
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
  firstDay,
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
  // The match's first day ('YYYY-MM-DD'), to name today's date.
  firstDay: string;
  matchDays: SoccerDay[];
  shots: SoccerShot[];
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Today's picks the viewer may see: their own side's (0145).
  const todayDay = useMemo(() => {
    if (dayNo == null) return null;
    const [y, m, d] = firstDay.split('-').map(Number);
    const at = new Date(y, m - 1, d + dayNo - 1);
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  }, [firstDay, dayNo]);
  const [tactics, setTactics] = useState<SoccerTactic[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const challengeId = game?.challengeId ?? null;
  const active = game?.status === 'active';
  const loadTactics = useCallback(
    (day: string) => {
      if (!challengeId) return;
      listSoccerTactics(challengeId, day)
        .then(setTactics)
        .catch(() => setTactics([]));
    },
    [challengeId],
  );
  useEffect(() => {
    if (active && todayDay) loadTactics(todayDay);
  }, [active, todayDay, loadTactics]);

  const pick = async (choice: string | null) => {
    if (!challengeId) return;
    setPicking(true);
    setPickError(null);
    try {
      const day = await setSoccerTactic(challengeId, choice);
      loadTactics(day);
    } catch (e) {
      setPickError(e instanceof Error ? e.message : 'Couldn’t save your pick.');
    } finally {
      setPicking(false);
    }
  };

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

  const myPick = tactics?.find((t) => t.playerId === userId) ?? null;
  const theirForwards = game.players.filter((p) => p.team !== myTeam && p.position === 'forward');
  const myPickLine = () => {
    if (!me) return '';
    if (!myPick) {
      return me.position === 'forward'
        ? 'No pick yet: your shots go somewhere at random.'
        : me.position === 'keeper'
          ? 'No pick yet: you stay put, no gain and no loss.'
          : 'No pick yet: you help the whole defense.';
    }
    if (myPick.aim) return `You’re shooting ${SOCCER_ZONE_NAME[myPick.aim]}.`;
    if (myPick.dive) return `You’re diving ${SOCCER_ZONE_NAME[myPick.dive]}.`;
    if (myPick.markId) return `You’re marking ${nameOf(myPick.markId)}.`;
    return '';
  };
  const teamPicks = (tactics ?? [])
    .filter((t) => t.playerId !== userId)
    .map((t) => {
      const who = nameOf(t.playerId);
      if (t.aim) return `${who} shoots ${SOCCER_ZONE_NAME[t.aim]}`;
      if (t.dive) return `${who} dives ${SOCCER_ZONE_NAME[t.dive]}`;
      if (t.markId) return `${who} marks ${nameOf(t.markId)}`;
      return '';
    })
    .filter((l) => l.length > 0);

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

      {me && me.joined && game.status === 'active' && dayNo != null && (
        <View style={styles.tactics}>
          <View style={styles.tacticsHead}>
            <Text style={styles.reportTitle}>Today&rsquo;s play</Text>
            {tactics === null || picking ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          </View>
          <Text style={styles.note}>{SOCCER_PICK_PROMPT[me.position]} Hidden from the other side until tomorrow&rsquo;s report.</Text>
          {(me.position === 'forward' || me.position === 'keeper') && (
            <GoalMouth
              mode={me.position === 'forward' ? 'aim' : 'dive'}
              picked={(me.position === 'forward' ? myPick?.aim : myPick?.dive) ?? null}
              disabled={picking || tactics === null}
              onPick={(z) => pick(z)}
            />
          )}
          {me.position === 'defender' && (
            <View style={styles.markRow}>
              {theirForwards.length === 0 ? (
                <Text style={styles.note}>The other side has no forwards to mark.</Text>
              ) : (
                theirForwards.map((f) => {
                  const on = myPick?.markId === f.playerId;
                  const person = participants.find((x) => x.userId === f.playerId);
                  return (
                    <Pressable
                      key={f.playerId}
                      onPress={() => pick(f.playerId)}
                      disabled={picking || tactics === null}
                      style={({ pressed }) => [styles.markChip, on && styles.markChipOn, pressed && styles.zonePressed]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Mark ${person?.name ?? 'this forward'}`}
                    >
                      <Avatar
                        initials={person?.initials ?? '?'}
                        tint={f.botId ? colors.neutral800 : TINT_N}
                        size={30}
                        fontSize={11}
                        frameId={person?.frameId}
                        backgroundId={person?.backgroundId}
                        iconId={person?.iconId}
                      />
                      <Text style={[styles.markName, on && styles.markNameOn]} numberOfLines={1}>
                        {on ? '🛡 ' : ''}
                        {person?.name ?? (f.joined ? 'Forward' : 'Invited')}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </View>
          )}
          <Text style={styles.note}>{myPickLine()}</Text>
          {myPick && (
            <Pressable onPress={() => pick(null)} disabled={picking} accessibilityRole="button">
              <Text style={styles.clear}>Clear my pick</Text>
            </Pressable>
          )}
          {teamPicks.length > 0 && (
            <View style={{ gap: 2 }}>
              <Text style={styles.teamTitle}>Your side today</Text>
              {teamPicks.map((line) => (
                <Text key={line} style={styles.reportLine}>
                  {line}
                </Text>
              ))}
            </View>
          )}
          {pickError && <Text style={styles.error}>{pickError}</Text>}
        </View>
      )}
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
            // One line per marked forward: who marked them and how it went.
            const marks = Array.from(
              dayShots
                .filter((s) => s.markerIds && s.markerIds.length > 0)
                .reduce((acc, s) => {
                  const m = acc.get(s.shooterId) ?? { shooterId: s.shooterId, markers: s.markerIds ?? [], taken: 0, on: 0 };
                  m.taken += 1;
                  if (s.outcome !== 'miss') m.on += 1;
                  return acc.set(s.shooterId, m);
                }, new Map<string, { shooterId: string; markers: string[]; taken: number; on: number }>())
                .values(),
            );
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
                {marks.map((m) => (
                  <Text key={`m${m.shooterId}`} style={styles.reportLine}>
                    🛡 {m.markers.map((id) => nameOf(id)).join(' & ')} marked {nameOf(m.shooterId)}: {m.on} of {m.taken} on target.
                  </Text>
                ))}
                {goals.map((g, i) => (
                  <Text key={`g${i}`} style={styles.reportLine}>
                    ⚽ {nameOf(g.shooterId)} scored{g.aim ? ` ${SOCCER_ZONE_NAME[g.aim]}` : ''} on {formatSteps(g.shooterSteps)}
                    {g.keeperId ? (g.dive ? `, ${nameOf(g.keeperId)} dove ${SOCCER_ZONE_NAME[g.dive]}` : ` past ${nameOf(g.keeperId)}`) : ''}.
                  </Text>
                ))}
                {saves.map((s, i) => (
                  <Text key={`s${i}`} style={styles.reportLine}>
                    🧤{' '}
                    {s.aim && s.dive && s.aim === s.dive
                      ? `${nameOf(s.shooterId)} shot ${SOCCER_ZONE_NAME[s.aim]}, ${nameOf(s.keeperId)} dove ${SOCCER_ZONE_NAME[s.dive]}. Saved.`
                      : `${nameOf(s.keeperId)} saved ${nameOf(s.shooterId)}’s shot${s.aim ? ` to ${SOCCER_ZONE_NAME[s.aim]}` : ''}.`}
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
    tactics: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: withAlpha(colors.accent, 0.08) },
    tacticsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    teamTitle: { fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: withAlpha(colors.text, 0.55), marginTop: 4 },
    clear: { fontSize: 12.5, color: colors.accentActive, fontFamily: font.heading },
    error: { fontSize: 12.5, color: colors.amber },
    goalFrame: {
      alignSelf: 'stretch',
      height: 132,
      backgroundColor: PITCH,
      borderColor: '#ffffff',
      borderTopWidth: 5,
      borderLeftWidth: 5,
      borderRightWidth: 5,
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
      padding: 6,
      gap: 6,
    },
    goalRow: { flex: 1, flexDirection: 'row', gap: 6 },
    zone: { alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.45)', backgroundColor: 'rgba(255,255,255,0.08)' },
    zoneCorner: { flex: 1 },
    zoneCenterWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
    zoneCenter: { width: '34%', height: '46%', backgroundColor: 'rgba(47,122,79,0.92)' },
    zoneOn: { backgroundColor: colors.amber, borderColor: '#ffffff' },
    zonePressed: { opacity: 0.75 },
    zoneText: { color: '#ffffff', fontSize: 11, fontFamily: font.heading, textTransform: 'uppercase', letterSpacing: 0.5 },
    zoneTextOn: { fontSize: 20 },
    markRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    markChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, borderWidth: 1.5, borderColor: withAlpha(colors.text, 0.15), maxWidth: '100%' },
    markChipOn: { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.14) },
    markName: { fontFamily: font.heading, fontSize: 13, color: colors.text, flexShrink: 1 },
    markNameOn: { color: colors.accentActive },
    report: { gap: 2, padding: 10, borderRadius: 10, backgroundColor: withAlpha(colors.accent, 0.08) },
    reportHead: { flexDirection: 'row', justifyContent: 'space-between' },
    reportDay: { fontFamily: font.heading, fontSize: 13, color: colors.text },
    reportScore: { fontFamily: font.heading, fontSize: 13, color: colors.accentActive, fontVariant: ['tabular-nums'] },
    reportLine: { fontSize: 12, color: withAlpha(colors.text, 0.75), lineHeight: 17 },
  });
}
