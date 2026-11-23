import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { usePinnedAction } from './PinnedAction';
import { feedLine, stakeName, taskTitle } from '../challenges/roulette';
import {
  answerRouletteDuel,
  callRouletteDuel,
  raidRoulette,
  rouletteWaiting,
  type RouletteDuel,
  type RouletteGame,
  type RouletteRow,
} from '../challenges/rouletteApi';

// Hound Roulette on the challenge page (0236): your ride and banked
// points, a Duel call to answer, the standings (with Raid and Duel on
// everyone else), Duels under way, and what's happened on the wheel.
// The wheel itself is RouletteScreen; "Spin today's wheel" or "Answer
// the Duel" pins to the bottom of the page.
export function RouletteCard({
  challengeId,
  game,
  userId,
  onSpin,
  onChanged,
}: {
  challengeId: string;
  game: RouletteGame | null;
  userId: string | null;
  onSpin: () => void;
  onChanged: (g: RouletteGame) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  // The row whose Duel stakes are open.
  const [dueling, setDueling] = useState<string | null>(null);
  const waiting = rouletteWaiting(game);

  const act = async (fn: () => Promise<RouletteGame>) => {
    if (busy) return;
    setBusy(true);
    try {
      onChanged(await fn());
      setDueling(null);
    } catch (e) {
      Alert.alert('Hound Roulette', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const answer = (d: RouletteDuel, accept: boolean) => act(() => answerRouletteDuel(d.id, accept));

  const pinned = usePinnedAction(
    waiting.duel
      ? {
          label: `Answer ${waiting.duel.other.split(' ')[0]}’s Duel · ${waiting.duel.stake}`,
          onPress: () => {
            const d = waiting.duel!;
            Alert.alert(
              `${d.other.split(' ')[0]} called you out`,
              `${d.stake} points each, on tomorrow’s steps against your own averages. Most above their average takes both.`,
              [
                { text: 'Turn it down', style: 'destructive', onPress: () => answer(d, false) },
                { text: 'Not yet', style: 'cancel' },
                { text: `Accept · ${d.stake}`, onPress: () => answer(d, true) },
              ],
            );
          },
        }
      : waiting.spin
        ? { label: game && game.ride > 0 ? `Spin today’s wheel · ${game.ride} riding` : 'Spin today’s wheel', onPress: onSpin }
        : null,
  );

  if (!game) {
    return (
      <Card style={{ gap: 8 }} elevated={false}>
        <Text style={text.h4}>Hound Roulette</Text>
        <ActivityIndicator color={colors.accent} />
      </Card>
    );
  }

  const s = game.settings;
  const raidSent = !!game.myRaid;
  const myDuels = game.duels.filter((d) => d.status === 'on' || (d.status === 'open' && d.mine));
  const results = game.duels.filter((d) => d.status === 'done');
  const live = !game.settled && game.dayNo >= 1 && game.dayNo <= game.days;

  const raidable = (r: RouletteRow) =>
    live && !raidSent && !r.raidedBy && r.ride >= 2 && r.today?.status !== 'done' && game.banked >= s.raidCost;
  const duelStakes = (r: RouletteRow) =>
    [2, 5, 10, 25].filter((n) => n >= s.duelMin && n <= s.duelMax && n <= game.banked && n <= r.banked);
  const inDuel = (r: RouletteRow) => game.duels.some((d) => (d.status === 'open' || d.status === 'on') && d.otherId === r.userId);

  const todayChip = (r: RouletteRow): { text: string; tone: 'done' | 'live' | 'wait' | 'out' } => {
    const t = r.today;
    if (!t) return { text: live ? 'Not spun yet' : '–', tone: 'wait' };
    if (t.status === 'done') return { text: `${stakeName(t.stake)} · ${t.task === 'free' ? 'Free Day' : taskTitle(t.task, t.target)} · done`, tone: 'done' };
    if (t.status === 'missed') return { text: 'Missed', tone: 'out' };
    if (!t.task) return { text: `${stakeName(t.stake)} · picking`, tone: 'live' };
    const prog = t.progress != null && t.target ? ` · ${Math.min(100, Math.round((100 * t.progress) / t.target))}%` : '';
    return { text: `${stakeName(t.stake)} · ${taskTitle(t.task, t.target)}${prog}`, tone: 'live' };
  };

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={text.h4}>Hound Roulette</Text>
          <Text style={styles.small}>
            {game.settled ? 'It’s over: final standings.' : live ? `Day ${game.dayNo} of ${game.days}` : game.dayNo < 1 ? 'Starts soon' : 'Results tomorrow'}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.big}>{game.banked}</Text>
          <Text style={styles.small}>banked{game.ride > 0 ? ` · ${game.ride} riding × ${game.mult}` : ''}</Text>
        </View>
      </View>

      {game.raidOnMe && (
        <View style={styles.alert}>
          <Text style={styles.alertText}>{game.raidOnMe.by.split(' ')[0]} is raiding your ride: make today’s task, or they take it.</Text>
        </View>
      )}

      {waiting.duel && (
        <View style={styles.duelCall}>
          <Text style={styles.duelText}>
            {waiting.duel.other.split(' ')[0]} called you out for {waiting.duel.stake} points: tomorrow’s steps, each against your own average. Most above it takes both.
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => answer(waiting.duel!, true)} disabled={busy} style={[styles.btn, styles.btnGo]} accessibilityRole="button">
              <Text style={styles.btnGoText}>Accept · {waiting.duel.stake}</Text>
            </Pressable>
            <Pressable onPress={() => answer(waiting.duel!, false)} disabled={busy} style={[styles.btn, styles.btnQuiet]} accessibilityRole="button">
              <Text style={styles.btnQuietText}>Turn it down</Text>
            </Pressable>
          </View>
        </View>
      )}

      {!pinned && waiting.spin && (
        <Pressable onPress={onSpin} style={[styles.btn, styles.btnGo]} accessibilityRole="button">
          <Text style={styles.btnGoText}>Spin today’s wheel</Text>
        </Pressable>
      )}
      {!waiting.spin && live && (
        <Pressable onPress={onSpin} style={[styles.btn, styles.btnQuiet]} accessibilityRole="button">
          <Text style={styles.btnQuietText}>{game.spin ? `Today: ${game.spin.task ? taskTitle(game.spin.task, game.spin.target, game.spin.double) : 'pick yours'}` : 'Open the wheel'}</Text>
        </Pressable>
      )}

      <View style={{ gap: 2 }}>
        <View style={styles.boardHead}>
          <Text style={[styles.colHead, { flex: 1 }]}>STANDINGS</Text>
          <Text style={[styles.colHead, { width: 70, textAlign: 'right' }]}>RIDING</Text>
          <Text style={[styles.colHead, { width: 54, textAlign: 'right' }]}>BANKED</Text>
        </View>
        {game.board.map((r, i) => {
          const me = r.userId === userId;
          const chip = todayChip(r);
          const stakes = me ? [] : duelStakes(r);
          const canDuel = live && !me && stakes.length > 0 && !inDuel(r);
          const canRaid = !me && raidable(r);
          return (
            <View key={r.userId} style={[styles.row, me && styles.rowMe]}>
              <View style={styles.rowTop}>
                <Text style={styles.rank}>{i + 1}</Text>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {me ? 'You' : r.name}
                    {r.raidedBy ? `  · raided by ${r.raidedBy.split(' ')[0]}` : ''}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.chip,
                      chip.tone === 'done' ? styles.chipDone : chip.tone === 'live' ? styles.chipLive : chip.tone === 'out' ? styles.chipOut : null,
                    ]}
                  >
                    {chip.text}
                  </Text>
                </View>
                <Text style={styles.riding}>{r.ride > 0 ? `${r.ride} × ${Math.min(3, 1 + 0.5 * Math.max(0, r.rideDays - 1))}` : '–'}</Text>
                <Text style={styles.banked}>{r.banked}</Text>
              </View>
              {(canRaid || canDuel) && (
                <View style={styles.rowActs}>
                  {canRaid && (
                    <Pressable
                      onPress={() =>
                        Alert.alert(
                          `Raid ${r.name.split(' ')[0]}?`,
                          `It costs ${s.raidCost} of your banked points. If they miss today’s task, their ride of ${r.ride} comes to you (up to ${s.raidCap}) with your ${s.raidCost} back. If they make it, your ${s.raidCost} go to them.`,
                          [
                            { text: 'Not now', style: 'cancel' },
                            { text: `Raid · ${s.raidCost}`, onPress: () => act(() => raidRoulette(challengeId, r.userId)) },
                          ],
                        )
                      }
                      disabled={busy}
                      style={[styles.mini, styles.miniRaid]}
                      accessibilityRole="button"
                    >
                      <Text style={styles.miniText}>Raid · {s.raidCost}</Text>
                    </Pressable>
                  )}
                  {canDuel && dueling !== r.userId && (
                    <Pressable onPress={() => setDueling(r.userId)} style={[styles.mini, styles.miniDuel]} accessibilityRole="button">
                      <Text style={styles.miniText}>Duel</Text>
                    </Pressable>
                  )}
                  {canDuel &&
                    dueling === r.userId &&
                    stakes.map((n) => (
                      <Pressable
                        key={n}
                        onPress={() => act(() => callRouletteDuel(challengeId, r.userId, n))}
                        disabled={busy}
                        style={[styles.mini, styles.miniDuel]}
                        accessibilityRole="button"
                        accessibilityLabel={`Call ${r.name} out for ${n} points`}
                      >
                        <Text style={styles.miniText}>For {n}</Text>
                      </Pressable>
                    ))}
                  {canDuel && dueling === r.userId && (
                    <Pressable onPress={() => setDueling(null)} style={[styles.mini, styles.miniQuiet]} accessibilityRole="button">
                      <Text style={styles.miniText}>Not now</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </View>

      {myDuels.length > 0 && (
        <View style={styles.box}>
          <Text style={styles.colHead}>DUELS</Text>
          {myDuels.map((d) => (
            <Text key={d.id} style={styles.line}>
              {d.status === 'open'
                ? `You called ${d.other.split(' ')[0]} out for ${d.stake}: waiting for an answer.`
                : `Against ${d.other.split(' ')[0]} for ${d.stake}: ${d.myDay === game.today ? 'today' : 'tomorrow'} is the step-off. Beat ${
                    d.myAvg != null ? d.myAvg.toLocaleString('en-US') : 'your average'
                  } by more than they beat theirs.`}
            </Text>
          ))}
          {results.slice(0, 2).map((d) => (
            <Text key={d.id} style={styles.line}>
              {d.push
                ? `Dead level with ${d.other.split(' ')[0]}: your ${d.stake} came back.`
                : d.won
                  ? `You beat ${d.other.split(' ')[0]}: ${pct(d.mySteps, d.myAvg)} of your average to their ${pct(d.theirSteps, d.theirAvg)}. +${d.stake}.`
                  : `${d.other.split(' ')[0]} won: ${pct(d.theirSteps, d.theirAvg)} of their average to your ${pct(d.mySteps, d.myAvg)}. −${d.stake}.`}
            </Text>
          ))}
        </View>
      )}

      {game.feed.length > 0 && (
        <View style={styles.box}>
          <Text style={styles.colHead}>ON THE WHEEL</Text>
          {game.feed
            .map((e) => ({ e, t: feedLine(e, userId) }))
            .filter((x) => x.t)
            .slice(0, 6)
            .map(({ e, t }, i) => (
              <Text key={`${e.at}:${i}`} style={styles.line}>
                {t}
              </Text>
            ))}
        </View>
      )}

      <Text style={styles.small}>
        Safe +{s.safe} · Bold +{s.bold} · All in doubles your ride. Each day riding adds ×0.5 when you bank, up to ×3. Miss a task and the ride’s gone; banked
        points are safe. Raid someone for {s.raidCost}, or call them out for {s.duelMin} to {s.duelMax}. At the end, most banked wins the Lucky Bandana for
        their hound, and every banked point is a Bone (up to {s.bonesCap}).
      </Text>
    </Card>
  );
}

function pct(steps: number | null, avg: number | null): string {
  if (steps == null || !avg) return '–';
  return `${Math.round((100 * steps) / avg)}%`;
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    headRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    big: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    small: { fontSize: 12, lineHeight: 17, color: withAlpha(colors.text, 0.62) },
    alert: { borderRadius: 12, padding: 10, backgroundColor: withAlpha('#e05b5b', 0.16), borderWidth: 1, borderColor: withAlpha('#e05b5b', 0.45) },
    alertText: { fontSize: 13, fontFamily: font.headingSemibold, color: colors.text },
    duelCall: { borderRadius: 12, padding: 10, gap: 8, backgroundColor: withAlpha('#4f7be0', 0.14), borderWidth: 1, borderColor: withAlpha('#4f7be0', 0.45) },
    duelText: { fontSize: 13, lineHeight: 18, color: colors.text },
    btn: { minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, flexGrow: 1 },
    btnGo: { backgroundColor: '#f08a24' },
    btnGoText: { fontFamily: font.headingSemibold, fontSize: 15, color: '#161826' },
    btnQuiet: { backgroundColor: withAlpha(colors.text, 0.08) },
    btnQuietText: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    boardHead: { flexDirection: 'row', gap: 8, paddingHorizontal: 4, paddingBottom: 4 },
    colHead: { fontFamily: font.headingSemibold, fontSize: 11, letterSpacing: 0.6, color: withAlpha(colors.text, 0.6) },
    row: { paddingVertical: 8, paddingHorizontal: 4, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.1) },
    rowMe: { backgroundColor: withAlpha(colors.text, 0.05), borderRadius: 10 },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rank: { minWidth: 16, fontFamily: font.headingSemibold, fontSize: 13, color: withAlpha(colors.text, 0.55) },
    name: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    chip: {
      alignSelf: 'flex-start',
      maxWidth: '100%',
      borderRadius: 999,
      overflow: 'hidden',
      paddingHorizontal: 8,
      paddingVertical: 2,
      fontSize: 11,
      fontFamily: font.headingSemibold,
      color: withAlpha(colors.text, 0.75),
      backgroundColor: withAlpha(colors.text, 0.08),
    },
    chipDone: { backgroundColor: withAlpha('#7fd39b', 0.22), color: colors.text },
    chipLive: { backgroundColor: withAlpha('#4f7be0', 0.22), color: colors.text },
    chipOut: { backgroundColor: withAlpha('#e05b5b', 0.22), color: colors.text },
    riding: { width: 70, textAlign: 'right', fontFamily: font.headingSemibold, fontSize: 13, color: '#c99a1a' },
    banked: { width: 54, textAlign: 'right', fontFamily: font.headingSemibold, fontSize: 18, color: colors.text },
    rowActs: { flexDirection: 'row', gap: 6, paddingLeft: 24, flexWrap: 'wrap' },
    mini: { minHeight: 36, borderRadius: 10, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
    miniRaid: { backgroundColor: withAlpha('#e05b5b', 0.2) },
    miniDuel: { backgroundColor: withAlpha('#4f7be0', 0.2) },
    miniQuiet: { backgroundColor: withAlpha(colors.text, 0.08) },
    miniText: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.text },
    box: { gap: 6, borderRadius: 12, padding: 10, backgroundColor: withAlpha(colors.text, 0.05) },
    line: { fontSize: 13, lineHeight: 18, color: colors.text },
  });
}
