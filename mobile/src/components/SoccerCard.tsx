import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { PauseIcon, PlayIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { DayCard, groupLines } from './DayCard';
import { PickRow } from './PickRow';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, TINT_N, withAlpha, type Palette } from '../theme/tokens';
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

// The pitch lives in SoccerField.tsx (players placed so they can move in
// a replay); re-exported here for the screens that import it from here.
export { SoccerPitch, type PitchPerson } from './SoccerField';
import { SoccerPitch, shotResult, type PitchPerson } from './SoccerField';
import { GameDayLine, SportBonusRow, useGameDayIds } from './SportBonusRow';

const PITCH = '#2f7a4f';

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
  onShowPitch,
}: {
  // Scroll the page to the pitch, when a day's replay starts lower down.
  onShowPitch?: (pitch: View | null) => void;
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
  // Replay last night: each of the day's shots in turn, the two sides'
  // taking turns.
  const lastDayNo = shots.length ? Math.max(...shots.map((s) => s.dayNo)) : null;
  // The day being replayed: any day, from its card in the report.
  const [replayDay, setReplayDay] = useState<number | null>(null);
  const showDay = replayDay ?? lastDayNo;
  // Who played real soccer on the day shown (0198).
  const shownDate = shots.find((s) => s.dayNo === showDay)?.day ?? null;
  const gameDayIds = useGameDayIds(game?.challengeId, shownDate);
  const night = useMemo(() => {
    const day = shots.filter((s) => s.dayNo === showDay);
    const a = day.filter((s) => s.team === 'a');
    const b = day.filter((s) => s.team === 'b');
    const out: SoccerShot[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i]) out.push(a[i]);
      if (b[i]) out.push(b[i]);
    }
    return out;
  }, [shots, showDay]);
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [replayN, setReplayN] = useState(0);
  // Bumped to start a replay over, even of the same day.
  const [replayGo, setReplayGo] = useState(0);
  const pitchRef = useRef<View>(null);
  const startReplay = (d: number) => {
    setReplayDay(d);
    setStep(null);
    setPlaying(true);
    setReplayGo((g) => g + 1);
    onShowPitch?.(pitchRef.current);
  };
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!playing) return;
    const next = () =>
      setStep((st) => {
        const n = (st ?? -1) + 1;
        if (n >= night.length) {
          setPlaying(false);
          return night.length - 1;
        }
        setReplayN((r) => r + 1);
        return n;
      });
    next();
    timer.current = setInterval(next, 3200);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, night.length, replayGo]);
  const [picking, setPicking] = useState(false);
  // The report shows the last three days until asked for the rest.
  const [allDays, setAllDays] = useState(false);
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

  // "Day 5 · Defender · 764 steps today"
  const statusLine = () => {
    if (!me) return '';
    if (dayNo == null) return 'Starts soon · your steps count from day 1';
    const steps = stepsToday == null ? 'steps loading' : `${formatSteps(stepsToday)} today`;
    const extra =
      me.position === 'forward' && todaysShots != null
        ? ` = ${todaysShots} shot${todaysShots === 1 ? '' : 's'} · next at ${formatSteps(game.shotSteps * (todaysShots + 1)).replace(' steps', '')}`
        : '';
    return `Day ${dayNo} · ${SOCCER_POSITION_NAME[me.position]} · ${steps}${extra}`;
  };
  // Your pick, short, for the row.
  const shortPick = () => {
    if (!myPick) return 'No pick yet';
    if (myPick.aim) return `Shooting ${SOCCER_ZONE_NAME[myPick.aim]}`;
    if (myPick.dive) return `Diving ${SOCCER_ZONE_NAME[myPick.dive]}`;
    if (myPick.markId) return `Marking ${nameOf(myPick.markId)}`;
    return 'No pick yet';
  };
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
      <View ref={pitchRef} collapsable={false}>
        <SoccerPitch
          game={game}
          people={participants}
          userId={userId}
          shot={step != null && night[step] ? { shot: night[step], n: replayN } : null}
          gameDayIds={gameDayIds}
        />
      </View>

      {step != null && night[step] && (() => {
        const s = night[step];
        const result = shotResult(s);
        const before = matchDays.filter((d) => d.dayNo < (showDay ?? 0));
        const goalsBy = (t: SoccerTeam) =>
          before.reduce((n, d) => n + (t === 'a' ? d.goalsA : d.goalsB), 0) +
          night.slice(0, step + 1).filter((x) => x.team === t && x.outcome === 'goal').length;
        const face = (id: string | null) => {
          const person = participants.find((x) => x.userId === id);
          const bot = game.players.find((x) => x.playerId === id)?.botId;
          return id ? (
            <Avatar
              key={id}
              initials={person?.initials ?? '?'}
              tint={id === userId ? TINT_A : bot ? colors.neutral800 : TINT_N}
              size={30}
              fontSize={11}
              frameId={person?.frameId}
              backgroundId={person?.backgroundId}
              iconId={person?.iconId}
            />
          ) : null;
        };
        const markers = s.markerIds ?? [];
        const aimWords = s.aim ? ` ${SOCCER_ZONE_NAME[s.aim]}` : '';
        const line =
          result === 'goal'
            ? `⚽ Goal! ${nameOf(s.shooterId)} scored${aimWords}${s.keeperId ? `${s.dive && s.dive !== s.aim ? `, ${nameOf(s.keeperId)} dove the other way` : ` past ${nameOf(s.keeperId)}`}` : ', into an empty net'}.`
            : result === 'saved'
              ? `🧤 ${nameOf(s.keeperId)} saved ${nameOf(s.shooterId)}’s shot${aimWords ? ` to${aimWords}` : ''}${s.dive && s.dive === s.aim ? ', guessing right' : ''}.`
              : result === 'blocked'
                ? `🛡 ${markers.map((id) => nameOf(id)).join(' & ')} closed down ${nameOf(s.shooterId)} and blocked it.`
                : `${nameOf(s.shooterId)}’s shot went wide.`;
        return (
          <View style={styles.playNow}>
            <View style={styles.playNowHead}>
              <Text style={styles.playNowTitle}>
                Day {s.dayNo} · shot {step + 1} of {night.length}
              </Text>
              <Text style={styles.playNowScore}>
                {goalsBy(myTeam)}–{goalsBy(myTeam === 'a' ? 'b' : 'a')}
              </Text>
            </View>
            <View style={styles.playNowRow}>
              <View style={styles.faces}>
                {face(s.shooterId)}
                {result !== 'wide' && result !== 'goal' && <Text style={styles.vs}>vs</Text>}
                {result === 'saved' && face(s.keeperId)}
                {result === 'blocked' && markers.map((id) => face(id))}
              </View>
              <Text style={[styles.playNowText, result === 'goal' && styles.playNowGoal]}>{line}</Text>
            </View>
            <Text style={styles.reportLine}>{nameOf(s.shooterId)} walked {formatSteps(s.shooterSteps)} that day</Text>
          </View>
        );
      })()}

      {step != null && (
        <View style={styles.replayRow}>
          <Pressable
            style={styles.replayBtn}
            onPress={() => {
              if (playing) setPlaying(false);
              else if (showDay != null) startReplay(showDay);
            }}
            accessibilityRole="button"
          >
            {playing ? <PauseIcon size={14} color={colors.accent} weight="fill" /> : <PlayIcon size={14} color={colors.accent} weight="fill" />}
            <Text style={styles.replayText}>{playing ? 'Pause' : 'Replay again'}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setPlaying(false);
              setStep(null);
              setReplayDay(null);
            }}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={styles.replayDone}>Back to today</Text>
          </Pressable>
        </View>
      )}

      {/* Where things stand, in one line. */}
      {me && game.status !== 'final' && (
        <Text style={styles.status}>
          {statusLine()}
          {waiting > 0 && game.status === 'active' ? ` · ${waiting} haven’t joined` : ''}
        </Text>
      )}
      {me && game.status === 'active' && <SportBonusRow challengeId={game.challengeId} kind="soccer" userId={userId} />}

      {me && me.joined && game.status === 'active' && dayNo != null && (
        <PickRow
          value={shortPick()}
          picked={!!myPick}
          busy={tactics === null || picking}
          note={teamPicks.length > 0 ? `Your side: ${teamPicks.join(' · ')}` : null}
          sheetTitle={me.position === 'forward' ? 'Where to shoot' : me.position === 'keeper' ? 'Where to dive' : 'Who to mark'}
          sheetNote={`${SOCCER_PICK_PROMPT[me.position]} Hidden from the other side until tomorrow’s report.`}
        >
          {(close) => (
            <>
              {(me.position === 'forward' || me.position === 'keeper') && (
                <GoalMouth
                  mode={me.position === 'forward' ? 'aim' : 'dive'}
                  picked={(me.position === 'forward' ? myPick?.aim : myPick?.dive) ?? null}
                  disabled={picking || tactics === null}
                  onPick={(z) => {
                    pick(z);
                    close();
                  }}
                />
              )}
              {me.position === 'defender' && (
                <View style={styles.markRow}>
                  {theirForwards.filter((f) => f.joined).length === 0 ? (
                    <Text style={styles.note}>The other side has no forwards to mark.</Text>
                  ) : (
                    theirForwards
                      .filter((f) => f.joined)
                      .map((f) => {
                        const on = myPick?.markId === f.playerId;
                        const person = participants.find((x) => x.userId === f.playerId);
                        return (
                          <Pressable
                            key={f.playerId}
                            onPress={() => {
                              pick(f.playerId);
                              close();
                            }}
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
                              {person?.name ?? 'Forward'}
                            </Text>
                          </Pressable>
                        );
                      })
                  )}
                </View>
              )}
              <Text style={styles.note}>{myPickLine()}</Text>
              {myPick && (
                <Pressable
                  onPress={() => {
                    pick(null);
                    close();
                  }}
                  disabled={picking}
                  accessibilityRole="button"
                >
                  <Text style={styles.clear}>Clear my pick</Text>
                </Pressable>
              )}
            </>
          )}
        </PickRow>
      )}
      {pickError && <Text style={styles.error}>{pickError}</Text>}
      {game.status === 'final' && (
        <Text style={styles.note}>
          Full time, {us}–{them}. {game.winnerTeam == null ? 'A draw.' : game.winnerTeam === myTeam ? 'Your side won!' : 'Their side won.'}
        </Text>
      )}

      {matchDays.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={styles.reportTitle}>Match report</Text>
          {[...matchDays]
            .reverse()
            .slice(0, allDays ? undefined : 3)
            .map((d, i) => {
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
              const scorers = (mine: boolean) =>
                groupLines(goals.filter((g) => (g.team === myTeam) === mine).map((g) => nameOf(g.shooterId))).join(', ');
              const ours = scorers(true);
              const theirs = scorers(false);
              const summary = !ours && !theirs ? 'No goals.' : `Yours: ${ours || 'none'} · Theirs: ${theirs || 'none'}`;
              const lines = [
                ...marks.map((m) => `🛡 ${m.markers.map((id) => nameOf(id)).join(' & ')} marked ${nameOf(m.shooterId)}: ${m.on} of ${m.taken} on target.`),
                ...groupLines(
                  goals.map(
                    (g) =>
                      `⚽ ${nameOf(g.shooterId)} scored${g.aim ? ` ${SOCCER_ZONE_NAME[g.aim]}` : ''} on ${formatSteps(g.shooterSteps)}${
                        g.keeperId ? (g.dive ? `, ${nameOf(g.keeperId)} dove ${SOCCER_ZONE_NAME[g.dive]}` : ` past ${nameOf(g.keeperId)}`) : ''
                      }.`,
                  ),
                ),
                ...groupLines(
                  saves.map((sv) =>
                    sv.aim && sv.dive && sv.aim === sv.dive
                      ? `🧤 ${nameOf(sv.keeperId)} guessed ${nameOf(sv.shooterId)}’s shot to ${SOCCER_ZONE_NAME[sv.aim]} and saved it.`
                      : `🧤 ${nameOf(sv.keeperId)} saved ${nameOf(sv.shooterId)}’s shot${sv.aim ? ` to ${SOCCER_ZONE_NAME[sv.aim]}` : ''}.`,
                  ),
                ),
              ];
              return (
                <DayCard
                  key={d.dayNo}
                  title={`Day ${d.dayNo}`}
                  score={`${usDay}–${themDay}`}
                  summary={summary}
                  defaultOpen={i === 0}
                  replaying={step != null && showDay === d.dayNo}
                  onReplay={dayShots.length > 0 ? () => startReplay(d.dayNo) : undefined}
                >
                  <Text style={styles.reportLine}>
                    Your side {ourShots} shot{ourShots === 1 ? '' : 's'}, {ourOn} on target · theirs {theirShots}, {theirOn} on target.
                  </Text>
                  {lines.map((l, k) => (
                    <Text key={k} style={styles.reportLine}>
                      {l}
                    </Text>
                  ))}
                  <GameDayLine challengeId={game.challengeId} day={d.day} kind="soccer" nameOf={(id) => nameOf(id)} />
                </DayCard>
              );
            })}
          {!allDays && matchDays.length > 3 && (
            <Pressable onPress={() => setAllDays(true)} style={styles.earlier} accessibilityRole="button">
              <Text style={styles.clear}>Earlier days ({matchDays.length - 3})</Text>
            </Pressable>
          )}
        </View>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    status: { fontSize: 12.5, color: withAlpha(colors.text, 0.62) },
    earlier: { alignSelf: 'center', paddingVertical: 8 },
    header: { gap: 2 },
    meta: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.7), lineHeight: 18 },
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
    replayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    replayBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: withAlpha(colors.accent, 0.12) },
    replayText: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.accent },
    replayDone: { fontFamily: font.heading, fontSize: 13, color: withAlpha(colors.text, 0.6) },
    playNow: { gap: 6, padding: 10, borderRadius: 10, backgroundColor: withAlpha(colors.accent, 0.08) },
    playNowHead: { flexDirection: 'row', justifyContent: 'space-between' },
    playNowTitle: { fontFamily: font.heading, fontSize: 12.5, color: withAlpha(colors.text, 0.65) },
    playNowScore: { fontFamily: font.heading, fontSize: 13, color: colors.accentActive, fontVariant: ['tabular-nums'] },
    playNowRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    faces: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    vs: { fontSize: 11, color: withAlpha(colors.text, 0.5) },
    playNowText: { flex: 1, fontFamily: font.heading, fontSize: 14, color: colors.text, lineHeight: 19 },
    playNowGoal: { color: colors.accentActive },
  });
}
