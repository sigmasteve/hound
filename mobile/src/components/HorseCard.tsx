import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Card } from './Card';
import { Avatar } from './Avatar';
import { HoopsCourt } from './HoopsCourt';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { formatSteps, spelled, type HorseShotId } from '../challenges/hoops';
import { setHorseShot, type HorseGame, type HorsePlayer } from '../challenges/horseApi';
import type { HoopsGame } from '../challenges/hoopsApi';
import { GameDayLine, SportBonusRow, useGameDayIds } from './SportBonusRow';

const ME_COLOR = '#f08a24';
// Where each shot is taken from, on the half court (0 at the baseline).
const HORSE_SPOT: Record<HorseShotId, { x: number; y: number }> = {
  layup: { x: 0.5, y: 0.24 },
  free_throw: { x: 0.5, y: 0.42 },
  three: { x: 0.5, y: 0.66 },
  hook: { x: 0.3, y: 0.3 },
  half_court: { x: 0.5, y: 0.95 },
};
const THEM_COLOR = '#4f7ae5';

// A game of H-O-R-S-E on the challenge page (0196): both players and the
// letters they've taken, today's shot and its steps target, the setter's
// pick, both players' steps against the target, and every day so far.
export function HorseCard({
  challengeId,
  game,
  stepsToday,
  onChanged,
}: {
  challengeId: string;
  game: HorseGame | null;
  stepsToday: number | null;
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [shot, setShot] = useState<HorseShotId | null>(null);
  // Who's played real basketball today (0198), for the court's badges.
  const gameDayIds = useGameDayIds(challengeId, null);

  if (!game) {
    return (
      <Card elevated={false}>
        <Text style={styles.note}>Setting up the court…</Text>
      </Card>
    );
  }

  const me = game.players.find((p) => p.userId === game.me) ?? null;
  const them = game.players.find((p) => p.userId !== game.me) ?? null;
  const pair = [me ?? game.players[0], them ?? game.players[1]].filter(Boolean) as HorsePlayer[];
  const nameOf = (id: string | null) => (id === game.me ? 'You' : (game.players.find((p) => p.userId === id)?.name.split(' ')[0] ?? 'Someone'));
  const iSet = game.setter === game.me;
  const current = game.shots.find((s) => s.id === (shot ?? game.shot.id)) ?? game.shot;
  const live = game.status === 'live' || game.status === 'upcoming';
  const stepsOf = (p: HorsePlayer) => (p.userId === game.me ? Math.max(p.stepsToday, stepsToday ?? 0) : p.stepsToday);

  const pick = async (id: HorseShotId) => {
    setShot(id);
    try {
      await setHorseShot(challengeId, id);
      onChanged();
    } catch (e) {
      setShot(null);
      Alert.alert('Couldn’t set that shot', e instanceof Error ? e.message : 'Try again.');
    }
  };

  // The court, with just the two of them on it.
  const court: HoopsGame = {
    status: game.status,
    firstDay: game.firstDay,
    dayNo: game.dayNo,
    days: game.days,
    daysPerQuarter: 1,
    shotSteps: current.target,
    teams: { home: { name: me?.name ?? '', score: 0 }, away: { name: them?.name ?? '', score: 0 } },
    line: [],
    winner: null,
    me: game.me,
    players: pair.map((p, i) => ({
      id: p.userId,
      userId: p.userId,
      name: p.name,
      initials: p.initials,
      iconId: p.iconId,
      frameId: p.frameId,
      backgroundId: p.backgroundId,
      bot: false,
      joined: true,
      team: i === 0 ? 'home' : 'away',
      guarding: null,
      shot: 'three',
      stepsToday: p.stepsToday,
      shotsToday: 0,
      pts: 0,
      fgMade: 0,
      fgAtt: 0,
      threeMade: 0,
      threeAtt: 0,
      ftMade: 0,
      ftAtt: 0,
    })),
    myOdds: null,
    myVote: null,
    teamVotes: { paint: 0, arc: 0 },
    last: null,
  };

  return (
    <View style={{ gap: 12 }}>
      {/* The two of them and their letters. */}
      <View style={styles.board}>
        {pair.map((p, i) => (
          <View key={p.userId} style={styles.player}>
            <View style={[styles.ring, { borderColor: i === 0 ? ME_COLOR : THEM_COLOR }]}>
              <Avatar initials={p.initials} tint={i === 0 ? '#7a4416' : '#26407a'} size={48} fontSize={16} frameId={p.frameId} backgroundId={p.backgroundId} iconId={p.iconId} />
            </View>
            <Text style={styles.playerName} numberOfLines={1}>
              {p.userId === game.me ? 'You' : p.name.split(' ')[0]}
              {game.setter === p.userId && game.status !== 'final' ? ' · setting' : ''}
            </Text>
            <View style={styles.letters} accessible accessibilityLabel={`${p.letters.length} of ${game.word.length} letters: ${p.letters || 'none'}`}>
              {game.word.split('').map((l, k) => {
                const has = k < p.letters.length;
                return (
                  <View key={k} style={[styles.letter, has && styles.letterOn]}>
                    <Text style={[styles.letterText, has && styles.letterTextOn]}>{l}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.status}>
        {game.status === 'final'
          ? game.winner
            ? `${nameOf(game.winner)} ${game.winner === game.me ? 'win' : 'wins'}.`
            : 'A tie.'
          : `Day ${Math.max(1, game.dayNo)} of ${game.days} · first to spell ${spelled(game.word)} loses.`}
      </Text>

      <HoopsCourt game={court} compact spot={HORSE_SPOT[current.id] ?? HORSE_SPOT.three} gameDayIds={gameDayIds} />

      {/* Today's shot. */}
      {live && (
        <Card style={styles.card} elevated={false}>
          <Text style={styles.kicker}>TODAY’S SHOT</Text>
          <Text style={styles.big}>
            {current.name} · {formatSteps(current.target)} steps
          </Text>
          <Text style={styles.note}>
            {iSet
              ? `You’re setting. Walk ${formatSteps(current.target)} by midnight to make it, then ${nameOf(them?.userId ?? null)} has to match it or take a letter. Miss, and they set tomorrow.`
              : `${nameOf(game.setter)} is setting. If they make it, you need ${formatSteps(current.target)} too, or you take a letter.`}
          </Text>
          {iSet && (
            <View style={styles.shots}>
              {game.shots.map((s) => {
                const on = current.id === s.id;
                return (
                  <Pressable key={s.id} onPress={() => pick(s.id)} style={[styles.shotChip, on && styles.shotChipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <Text style={styles.shotName}>{s.name}</Text>
                    <Text style={styles.shotTarget}>{formatSteps(s.target)}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {pair.map((p, i) => {
            const n = stepsOf(p);
            const share = Math.min(1, n / current.target);
            return (
              <View key={p.userId} style={{ gap: 4 }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.rowText}>{p.userId === game.me ? 'You' : p.name.split(' ')[0]}</Text>
                  <Text style={styles.small}>
                    {formatSteps(n)} / {formatSteps(current.target)}
                    {n >= current.target ? ' · made' : ''}
                  </Text>
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.round(share * 100)}%`, backgroundColor: i === 0 ? ME_COLOR : THEM_COLOR }]} />
                </View>
              </View>
            );
          })}
          {me && <SportBonusRow challengeId={challengeId} kind="horse" userId={me.userId} />}
        </Card>
      )}

      {/* Every day so far. */}
      {game.history.length > 0 && (
        <Card style={styles.card} elevated={false}>
          <Text style={styles.kicker}>SO FAR</Text>
          {[...game.history].reverse().map((h) => {
            const shotName = game.shots.find((s) => s.id === h.shot)?.name ?? h.shot;
            const matcher = game.players.find((p) => p.userId !== h.setter)?.userId ?? null;
            const line = !h.made
              ? `${nameOf(h.setter)} missed: ${formatSteps(h.setterSteps)} of ${formatSteps(h.target)}. ${nameOf(matcher)} ${matcher === game.me ? 'set' : 'sets'} next.`
              : h.matched
                ? `${nameOf(h.setter)} made it (${formatSteps(h.setterSteps)}), and ${nameOf(matcher)} matched it (${formatSteps(h.matcherSteps ?? 0)}).`
                : `${nameOf(h.setter)} made it (${formatSteps(h.setterSteps)}). ${nameOf(matcher)} didn’t (${formatSteps(h.matcherSteps ?? 0)}): a letter.`;
            return (
              <View key={h.dayNo} style={styles.hist}>
                <Text style={styles.histDay}>Day {h.dayNo}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowText}>
                    {shotName} · {formatSteps(h.target)}
                  </Text>
                  <Text style={styles.small}>{line}</Text>
                  {game.firstDay ? (
                    <GameDayLine challengeId={challengeId} day={addDays(game.firstDay, h.dayNo - 1)} kind="horse" nameOf={(id) => nameOf(id)} />
                  ) : null}
                </View>
                {h.letterTo && <Text style={[styles.histLetter, { color: h.letterTo === game.me ? ME_COLOR : THEM_COLOR }]}>{h.letterTo === game.me ? 'You' : nameOf(h.letterTo)} +1</Text>}
              </View>
            );
          })}
        </Card>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    board: { flexDirection: 'row', gap: 10, borderRadius: 16, padding: 14, backgroundColor: '#0f111c' },
    player: { flex: 1, alignItems: 'center', gap: 6 },
    ring: { borderWidth: 3, borderRadius: 30, padding: 1 },
    playerName: { color: '#e9e9ed', fontFamily: font.headingSemibold, fontSize: 14 },
    letters: { flexDirection: 'row', gap: 4 },
    letter: { width: 24, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(233,233,237,0.08)' },
    letterOn: { backgroundColor: '#e5484d' },
    letterText: { fontFamily: font.headingSemibold, fontSize: 14, color: 'rgba(233,233,237,0.35)' },
    letterTextOn: { color: '#ffffff' },
    status: { fontSize: 13, color: withAlpha(colors.text, 0.65), textAlign: 'center' },
    card: { gap: 10 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    big: { fontFamily: font.headingSemibold, fontSize: 20, color: colors.text },
    note: { fontSize: 13.5, lineHeight: 19, color: withAlpha(colors.text, 0.7) },
    small: { fontSize: 12.5, color: withAlpha(colors.text, 0.62), fontVariant: ['tabular-nums'] },
    shots: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    shotChip: { minWidth: '30%', flexGrow: 1, minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: withAlpha(colors.text, 0.16), padding: 8, alignItems: 'center', justifyContent: 'center' },
    shotChipOn: { borderWidth: 2, borderColor: ME_COLOR, backgroundColor: withAlpha(ME_COLOR, 0.14) },
    shotName: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    shotTarget: { fontSize: 11.5, color: withAlpha(colors.text, 0.65), marginTop: 2 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    rowText: { fontSize: 14.5, color: colors.text },
    track: { height: 8, borderRadius: 4, backgroundColor: withAlpha(colors.text, 0.1), overflow: 'hidden' },
    fill: { height: 8, borderRadius: 4 },
    hist: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.08) },
    histDay: { width: 44, fontFamily: font.headingSemibold, fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    histLetter: { fontFamily: font.headingSemibold, fontSize: 12.5 },
  });
}

// YYYY-MM-DD plus n days.
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
