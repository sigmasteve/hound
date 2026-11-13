import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Card } from './Card';
import { Avatar } from './Avatar';
import { HoopsCourt } from './HoopsCourt';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import {
  HOOPS_DEFENSE_NAME,
  HOOPS_DEFENSE_NOTE,
  HOOPS_MAX_SHOTS_A_DAY,
  HOOPS_SHOTS,
  HOOPS_SHOT_NAME,
  HOOPS_SHOT_POINTS,
  HOOPS_TEAM_COLOR,
  HOOPS_TEAM_TEXT,
  formatSteps,
  hoopsPlayWords,
  hoopsShotsFor,
  hoopsStepsToNext,
  pct,
  type HoopsDefense,
  type HoopsShot,
  type HoopsTeam,
} from '../challenges/hoops';
import {
  hoopsDefenderOf,
  setHoopsShot,
  voteHoopsDefense,
  type HoopsEvent,
  type HoopsGame,
  type HoopsPlayer,
} from '../challenges/hoopsApi';

// A game of Hoops on the challenge page (0195): the scoreboard and line
// score, the court replaying last night's quarter, every play with why
// it went the way it did, your shots today with your shot and the team's
// defense, and the lineup and box score.
export function HoopsCard({
  challengeId,
  game,
  stepsToday,
  onChanged,
}: {
  challengeId: string;
  game: HoopsGame | null;
  // The phone's steps today, which can be ahead of the server's.
  stepsToday: number | null;
  onChanged: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [play, setPlay] = useState<{ event: HoopsEvent; n: number } | null>(null);
  const [replayAt, setReplayAt] = useState<number | null>(null);
  const [allPlays, setAllPlays] = useState(false);
  const [tab, setTab] = useState<'today' | 'box'>('today');
  const [shot, setShot] = useState<HoopsShot | null>(null);
  const [vote, setVote] = useState<HoopsDefense | null>(null);

  // Replaying: one play every 3 seconds, then stop.
  const events = game?.last?.events ?? [];
  useEffect(() => {
    if (replayAt == null) return;
    const e = events[replayAt];
    if (!e) {
      setReplayAt(null);
      setPlay(null);
      return;
    }
    setPlay((cur) => ({ event: e, n: (cur?.n ?? 0) + 1 }));
    const t = setTimeout(() => setReplayAt((i) => (i == null ? null : i + 1)), 3200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayAt]);

  if (!game) {
    return (
      <Card elevated={false}>
        <Text style={styles.note}>Setting up the court…</Text>
      </Card>
    );
  }

  const byId = new Map(game.players.map((p) => [p.id, p]));
  const me = game.me ? (byId.get(game.me) ?? null) : null;
  const first = (id: string | null) => {
    if (!id) return 'Someone';
    if (id === game.me) return 'You';
    return (byId.get(id)?.name ?? 'Someone').split(' ')[0];
  };
  // Mid-sentence: "you", not "You".
  const who = (id: string | null) => (id === game.me ? 'you' : first(id));
  const teamName = (t: HoopsTeam) => game.teams[t].name;
  const myShot = shot ?? me?.shot ?? 'drive';
  const myVote = vote ?? game.myVote;
  const myStepsToday = Math.max(me?.stepsToday ?? 0, stepsToday ?? 0);
  const myShots = hoopsShotsFor(myStepsToday, game.shotSteps);
  const toNext = hoopsStepsToNext(myStepsToday, game.shotSteps);
  const defender = me ? hoopsDefenderOf(game, me.id) : null;
  const live = game.status === 'live';
  const final = game.status === 'final';
  const nextLabel = game.line.find((l) => !l.played)?.label ?? null;

  const pickShot = async (s: HoopsShot) => {
    setShot(s);
    try {
      await setHoopsShot(challengeId, s);
      onChanged();
    } catch (e) {
      setShot(null);
      Alert.alert('Couldn’t save your shot', e instanceof Error ? e.message : 'Try again.');
    }
  };
  const pickVote = async (d: HoopsDefense) => {
    setVote(d);
    try {
      await voteHoopsDefense(challengeId, d);
      onChanged();
    } catch (e) {
      setVote(null);
      Alert.alert('Couldn’t save your vote', e instanceof Error ? e.message : 'Try again.');
    }
  };

  // Why a play went the way it did, in a few words.
  const why = (e: HoopsEvent): string => {
    const d = e.defender ? who(e.defender) : null;
    if (e.kind === 'ft') return d ? `Fouled: out-walked ${d} ${formatSteps(e.shooterSteps)} to ${formatSteps(e.defenderSteps)}` : 'Fouled';
    if (e.kind === 'putback') return `Offensive rebound: ${teamName(e.team)} walked more`;
    const bits: string[] = [];
    if (e.dunk) bits.push(`A ${formatSteps(e.shooterSteps)}-step day: drives are dunks`);
    else if (d) {
      bits.push(
        e.shooterSteps >= e.defenderSteps
          ? `Out-walked ${d} ${formatSteps(e.shooterSteps)} to ${formatSteps(e.defenderSteps)}`
          : `${d === 'you' ? 'You' : d} out-walked ${who(e.shooter)} ${formatSteps(e.defenderSteps)} to ${formatSteps(e.shooterSteps)}`,
      );
    }
    if (e.defense === 'paint' && e.kind === 'drive') bits.push('into a packed paint');
    if (e.defense === 'arc' && e.kind === 'three') bits.push('against a guarded arc');
    if (e.onFire) bits.push('on fire');
    if (!e.made && e.rebound) bits.push(`rebound: ${teamName(e.rebound)}`);
    return bits.join(' · ');
  };

  const shownPlays = allPlays ? events : events.slice(0, 5);
  const teams: HoopsTeam[] = ['home', 'away'];

  return (
    <View style={{ gap: 12 }}>
      {/* Scoreboard and line score. */}
      <View style={styles.board}>
        <View style={styles.boardTop}>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.teamRow}>
              <View style={[styles.swatch, { backgroundColor: HOOPS_TEAM_COLOR.home }]} />
              <Text style={styles.teamName} numberOfLines={1}>
                {game.teams.home.name}
              </Text>
            </View>
            <Text style={styles.small}>{me?.team === 'home' ? 'You' : `${game.players.filter((p) => p.team === 'home').length} players`}</Text>
          </View>
          <View style={styles.scores}>
            <Text style={[styles.score, { color: HOOPS_TEAM_TEXT.home }]}>{game.teams.home.score}</Text>
            <Text style={styles.dash}>–</Text>
            <Text style={[styles.score, { color: HOOPS_TEAM_TEXT.away }]}>{game.teams.away.score}</Text>
          </View>
          <View style={{ flex: 1, gap: 2, alignItems: 'flex-end' }}>
            <View style={styles.teamRow}>
              <Text style={styles.teamName} numberOfLines={1}>
                {game.teams.away.name}
              </Text>
              <View style={[styles.swatch, { backgroundColor: HOOPS_TEAM_COLOR.away }]} />
            </View>
            <Text style={styles.small}>{me?.team === 'away' ? 'You' : `${game.players.filter((p) => p.team === 'away').length} players`}</Text>
          </View>
        </View>
        <View style={styles.line}>
          <View style={styles.lineRow}>
            <Text style={[styles.lineCell, styles.lineName]} />
            {game.line.map((l) => (
              <Text key={l.period} style={[styles.lineCell, l.label === nextLabel && !final && styles.lineNow]}>
                {l.label}
              </Text>
            ))}
          </View>
          {teams.map((t) => (
            <View key={t} style={styles.lineRow}>
              <Text style={[styles.lineCell, styles.lineName, { color: HOOPS_TEAM_TEXT[t] }]} numberOfLines={1}>
                {game.teams[t].name}
              </Text>
              {game.line.map((l) => (
                <Text key={l.period} style={styles.lineCell}>
                  {l.played ? l[t] : ''}
                </Text>
              ))}
            </View>
          ))}
        </View>
        <Text style={styles.status}>
          {final
            ? game.winner
              ? `Final: ${teamName(game.winner)} win`
              : 'Final: a tie'
            : game.status === 'upcoming'
              ? 'Tip-off tonight at midnight'
              : nextLabel
                ? `${nextLabel} is on today. It plays tonight at midnight.`
                : 'Playing tonight at midnight.'}
        </Text>
      </View>

      {/* The court, replaying last night. */}
      <View>
        <HoopsCourt game={game} play={play} />
        {play && (
          <View style={styles.replayTag} pointerEvents="none">
            <Text style={styles.replayTagText}>
              REPLAY · {game.last?.label}  <Text style={styles.replayTagSub}>{hoopsPlayWords({ ...play.event, on_fire: play.event.onFire }, first(play.event.shooter))}</Text>
            </Text>
          </View>
        )}
        {game.last && events.length > 0 && (
          <Pressable
            style={styles.watch}
            onPress={() => (replayAt == null ? setReplayAt(0) : (setReplayAt(null), setPlay(null)))}
            accessibilityRole="button"
          >
            <Text style={styles.watchText}>{replayAt == null ? `Watch ${game.last.label}` : 'Stop'}</Text>
          </Pressable>
        )}
      </View>

      {/* Last night. */}
      {game.last && (
        <Card style={styles.card} elevated={false}>
          <View style={styles.rowBetween}>
            <Text style={styles.kicker}>LAST NIGHT · {game.last.label}</Text>
            <Text style={styles.small}>
              {game.teams.home.name} {game.last.home} · {game.teams.away.name} {game.last.away}
            </Text>
          </View>
          {events.length === 0 && <Text style={styles.note}>Nobody walked enough for a shot.</Text>}
          {shownPlays.map((e) => (
            <Pressable key={e.seq} style={styles.play} onPress={() => setPlay((cur) => ({ event: e, n: (cur?.n ?? 0) + 1 }))} accessibilityRole="button">
              <View style={[styles.playDot, { backgroundColor: HOOPS_TEAM_COLOR[e.team] }]} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.playText}>{hoopsPlayWords({ ...e, on_fire: e.onFire }, first(e.shooter))}</Text>
                {why(e) ? <Text style={styles.small}>{why(e)}</Text> : null}
              </View>
              <Text style={[styles.playPts, { color: e.made ? HOOPS_TEAM_TEXT[e.team] : withAlpha(colors.text, 0.35) }]}>{e.made ? `+${e.pts}` : 'miss'}</Text>
            </Pressable>
          ))}
          {events.length > 5 && (
            <Pressable onPress={() => setAllPlays((v) => !v)} hitSlop={8} accessibilityRole="button">
              <Text style={styles.link}>{allPlays ? 'Show fewer' : `All ${events.length} plays`}</Text>
            </Pressable>
          )}
        </Card>
      )}

      {/* Your quarter. */}
      {me && !final && (
        <Card style={styles.card} elevated={false}>
          <Text style={styles.kicker}>YOUR {nextLabel ?? 'DAY'}</Text>
          <View style={styles.rowBetween}>
            <Text style={styles.big}>
              {formatSteps(myStepsToday)} <Text style={styles.small}>steps</Text>
            </Text>
            <Text style={[styles.shotsCount, { color: HOOPS_TEAM_TEXT[me.team] }]}>
              {myShots} {myShots === 1 ? 'shot' : 'shots'}
            </Text>
          </View>
          <View style={styles.bars} accessible accessibilityLabel={`${myShots} of ${HOOPS_MAX_SHOTS_A_DAY} shots earned`}>
            {Array.from({ length: HOOPS_MAX_SHOTS_A_DAY }, (_, i) => {
              const filled = i < myShots;
              const part = i === myShots && toNext != null ? 1 - toNext / game.shotSteps : 0;
              return (
                <View key={i} style={styles.bar}>
                  <View style={[styles.barFill, { width: filled ? '100%' : `${Math.round(part * 100)}%`, backgroundColor: HOOPS_TEAM_COLOR[me.team], opacity: filled ? 1 : 0.55 }]} />
                </View>
              );
            })}
          </View>
          <Text style={styles.small}>
            A shot every {formatSteps(game.shotSteps)} steps, up to {HOOPS_MAX_SHOTS_A_DAY} a day.
            {toNext != null ? ` Your next at ${formatSteps(myStepsToday + toNext)}.` : ' All five earned.'}
          </Text>

          {live || game.status === 'upcoming' ? (
            <>
              <Text style={styles.label}>Your shot today</Text>
              <View style={styles.chips}>
                {HOOPS_SHOTS.map((s) => {
                  const on = myShot === s;
                  const odds = game.myOdds?.[s];
                  return (
                    <Pressable
                      key={s}
                      onPress={() => pickShot(s)}
                      style={[styles.chip, on && { borderColor: HOOPS_TEAM_COLOR[me.team], borderWidth: 2, backgroundColor: withAlpha(HOOPS_TEAM_COLOR[me.team], 0.14) }]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={styles.chipTitle}>{HOOPS_SHOT_NAME[s]}</Text>
                      <Text style={styles.chipSub}>
                        {HOOPS_SHOT_POINTS[s]} pts{odds != null ? ` · ${pct(odds)}` : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.small}>
                {defender
                  ? `The odds are for today so far. They go up as you out-walk ${defender.name.split(' ')[0]}, who’s guarding you (${formatSteps(defender.stepsToday)} so far), and change with ${teamName(defender.team)}’ defense.`
                  : 'The odds are for today so far, and go up the more you walk.'}
              </Text>

              <Text style={styles.label}>Team defense tonight</Text>
              <View style={styles.chips}>
                {(['paint', 'arc'] as HoopsDefense[]).map((d) => {
                  const on = myVote === d;
                  const n = game.teamVotes[d] + (vote && vote !== game.myVote ? (d === vote ? 1 : d === game.myVote ? -1 : 0) : 0);
                  return (
                    <Pressable
                      key={d}
                      onPress={() => pickVote(d)}
                      style={[styles.chip, on && { borderColor: HOOPS_TEAM_COLOR[me.team], borderWidth: 2, backgroundColor: withAlpha(HOOPS_TEAM_COLOR[me.team], 0.14) }]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={styles.chipTitle}>{HOOPS_DEFENSE_NAME[d]}</Text>
                      <Text style={styles.chipSub}>
                        {HOOPS_DEFENSE_NOTE[d]} · {Math.max(0, n)} {Math.max(0, n) === 1 ? 'vote' : 'votes'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.small}>The team votes; most votes by midnight wins. Guard what they shoot and their shots get harder.</Text>
            </>
          ) : null}
        </Card>
      )}

      {/* Lineup today, or the box score. */}
      <Card style={styles.card} elevated={false}>
        <View style={styles.tabs}>
          {(['today', 'box'] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
              <Text style={styles.tabText}>{t === 'today' ? (final ? 'Last day' : 'Today so far') : 'Box score'}</Text>
            </Pressable>
          ))}
        </View>
        {teams.map((t) => {
          const list = game.players.filter((p) => p.team === t).sort((a, b) => (tab === 'box' ? b.pts - a.pts : b.stepsToday - a.stepsToday));
          return (
            <View key={t} style={{ gap: 6 }}>
              <Text style={[styles.kicker, { color: HOOPS_TEAM_TEXT[t] }]}>{game.teams[t].name.toUpperCase()}</Text>
              {tab === 'box' && (
                <View style={styles.boxRow}>
                  <Text style={[styles.boxName, styles.boxHead]} />
                  <Text style={[styles.boxNum, styles.boxHead]}>FG</Text>
                  <Text style={[styles.boxNum, styles.boxHead]}>3PT</Text>
                  <Text style={[styles.boxNum, styles.boxHead]}>FT</Text>
                  <Text style={[styles.boxNum, styles.boxHead]}>PTS</Text>
                </View>
              )}
              {list.map((p) =>
                tab === 'box' ? (
                  <View key={p.id} style={styles.boxRow}>
                    <Text style={styles.boxName} numberOfLines={1}>
                      {p.id === game.me ? 'You' : p.name}
                    </Text>
                    <Text style={styles.boxNum}>
                      {p.fgMade}/{p.fgAtt}
                    </Text>
                    <Text style={styles.boxNum}>
                      {p.threeMade}/{p.threeAtt}
                    </Text>
                    <Text style={styles.boxNum}>
                      {p.ftMade}/{p.ftAtt}
                    </Text>
                    <Text style={[styles.boxNum, styles.boxPts]}>{p.pts}</Text>
                  </View>
                ) : (
                  <LineupRow key={p.id} p={p} me={p.id === game.me} shotSteps={game.shotSteps} styles={styles} colors={colors} />
                ),
              )}
            </View>
          );
        })}
      </Card>
      <Text style={[text.body, styles.note]}>
        Your steps take the shots, your shot pick decides what kind, and out-walking whoever’s guarding you makes them fall. Rebounds go to the side that walked more.
      </Text>
    </View>
  );
}

function LineupRow({ p, me, shotSteps, styles, colors }: { p: HoopsPlayer; me: boolean; shotSteps: number; styles: Styles; colors: Palette }) {
  const shots = hoopsShotsFor(p.stepsToday, shotSteps);
  return (
    <View style={styles.lineup}>
      <Avatar
        initials={p.initials}
        tint={p.bot ? colors.neutral800 : p.team === 'home' ? '#7a4416' : '#26407a'}
        size={34}
        fontSize={12}
        frameId={p.frameId}
        backgroundId={p.backgroundId}
        iconId={p.iconId}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.lineupName, me && { fontFamily: font.headingSemibold }]} numberOfLines={1}>
          {me ? 'You' : p.name}
          {p.bot ? ' (bot)' : !p.joined ? ' (invited)' : ''}
        </Text>
        <Text style={styles.small}>
          {HOOPS_SHOT_NAME[p.shot]} · {p.pts} pts
        </Text>
      </View>
      <Text style={styles.lineupSteps}>{formatSteps(p.stepsToday)}</Text>
      <View style={[styles.pill, shots > 0 ? { backgroundColor: withAlpha(HOOPS_TEAM_COLOR[p.team], 0.2) } : null]}>
        <Text style={[styles.pillText, shots > 0 ? { color: HOOPS_TEAM_TEXT[p.team] } : null]}>
          {shots} {shots === 1 ? 'shot' : 'shots'}
        </Text>
      </View>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    board: { borderRadius: 16, padding: 14, gap: 10, backgroundColor: '#0f111c' },
    boardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    teamRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    swatch: { width: 10, height: 10, borderRadius: 3 },
    teamName: { color: '#e9e9ed', fontFamily: font.headingSemibold, fontSize: 14, flexShrink: 1 },
    scores: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    score: { fontFamily: font.headingSemibold, fontSize: 38, fontVariant: ['tabular-nums'] },
    dash: { color: 'rgba(233,233,237,0.4)', fontSize: 18 },
    line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(233,233,237,0.12)', paddingTop: 6, gap: 3 },
    lineRow: { flexDirection: 'row', alignItems: 'center' },
    lineCell: { flex: 1, textAlign: 'center', fontSize: 12, color: 'rgba(233,233,237,0.7)', fontVariant: ['tabular-nums'] },
    lineName: { flex: 2.2, textAlign: 'left' },
    lineNow: { color: '#ffffff', fontFamily: font.headingSemibold },
    status: { fontSize: 12.5, color: 'rgba(233,233,237,0.65)' },
    small: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.62) },
    note: { fontSize: 13.5, lineHeight: 19, color: withAlpha(colors.text, 0.65) },
    replayTag: { position: 'absolute', left: 10, bottom: 10, right: 90, backgroundColor: 'rgba(15,17,28,0.82)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    replayTagText: { color: '#ffd8b0', fontSize: 11.5, fontFamily: font.headingSemibold, letterSpacing: 0.3 },
    replayTagSub: { color: 'rgba(233,233,237,0.8)', fontFamily: font.body },
    watch: { position: 'absolute', right: 10, bottom: 10, minHeight: 34, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(15,17,28,0.82)', justifyContent: 'center' },
    watchText: { color: '#e9e9ed', fontFamily: font.headingSemibold, fontSize: 12.5 },
    card: { gap: 10 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    play: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.08) },
    playDot: { width: 8, height: 8, borderRadius: 4 },
    playText: { fontSize: 14, lineHeight: 19, color: colors.text },
    playPts: { minWidth: 34, textAlign: 'right', fontFamily: font.headingSemibold, fontSize: 14 },
    link: { color: colors.accentActive, fontFamily: font.headingSemibold, fontSize: 14 },
    big: { fontFamily: font.headingSemibold, fontSize: 28, color: colors.text, fontVariant: ['tabular-nums'] },
    shotsCount: { fontFamily: font.headingSemibold, fontSize: 15 },
    bars: { flexDirection: 'row', gap: 6 },
    bar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: withAlpha(colors.text, 0.12), overflow: 'hidden' },
    barFill: { height: 8, borderRadius: 4 },
    label: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text, marginTop: 4 },
    chips: { flexDirection: 'row', gap: 8 },
    chip: { flex: 1, minHeight: 56, borderRadius: 12, borderWidth: 1, borderColor: withAlpha(colors.text, 0.16), padding: 8, alignItems: 'center', justifyContent: 'center' },
    chipTitle: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text, textAlign: 'center' },
    chipSub: { fontSize: 11.5, color: withAlpha(colors.text, 0.7), marginTop: 2, textAlign: 'center' },
    tabs: { flexDirection: 'row', gap: 8, padding: 4, borderRadius: 12, backgroundColor: withAlpha(colors.text, 0.06) },
    tab: { flex: 1, minHeight: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    tabOn: { backgroundColor: withAlpha(colors.accent, 0.25) },
    tabText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    lineup: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
    lineupName: { fontSize: 14.5, color: colors.text },
    lineupSteps: { fontSize: 13, color: withAlpha(colors.text, 0.7), fontVariant: ['tabular-nums'] },
    pill: { minWidth: 58, alignItems: 'center', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: withAlpha(colors.text, 0.08) },
    pillText: { fontFamily: font.headingSemibold, fontSize: 12, color: withAlpha(colors.text, 0.55) },
    boxRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 26 },
    boxName: { flex: 1, fontSize: 13.5, color: colors.text },
    boxHead: { fontSize: 11, color: withAlpha(colors.text, 0.5) },
    boxNum: { width: 44, textAlign: 'right', fontSize: 13, color: colors.text, fontVariant: ['tabular-nums'] },
    boxPts: { fontFamily: font.headingSemibold },
  });
}
