import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { BoxingGloveIcon, PlayIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Card } from './Card';
import { usePinnedAction } from './PinnedAction';
import { RingReplay } from './RingReplay';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getBoutReplay, GUARDS, punchName, setGuard, type BoutGuard, type BoutLive, type BoutReplay } from '../challenges/boutApi';

// Hound Bout (0225) on its challenge page: last night's round (with its
// replay: both hounds, punch by punch, attacking and defending), the
// scorecard, your guard for today, today's power and fight camp, and the
// action pinned to the bottom: Slip N incoming first, then Throw your
// punches.

const ME_COLOR = '#ffd8b0';

export function BoutCard({
  challengeId,
  live,
  sponsorName,
  onRing,
  onChanged,
}: {
  challengeId: string;
  live: BoutLive | null;
  sponsorName: string | null;
  onRing: (mode: 'throw' | 'slip') => void;
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [guard, setGuardState] = useState<BoutGuard | null>(null);
  const [replayRound, setReplayRound] = useState<number | null>(null);
  useEffect(() => {
    if (live) setGuardState(live.guard);
  }, [live]);

  const active = !!live && live.status === 'active';
  const incoming = live?.combos ?? 0;
  const pinned = usePinnedAction(
    active && live && live.canAct
      ? incoming > 0
        ? { label: `Face ${incoming} incoming`, onPress: () => onRing('slip') }
        : live.day.left > 0
          ? { label: `Throw an exchange · ${live.day.left} left`, onPress: () => onRing('throw') }
          : null
      : null,
  );

  if (!live) {
    return (
      <Card elevated={false}>
        <ActivityIndicator color={colors.accent} />
      </Card>
    );
  }

  const opp = live.opponent?.name.split(' ')[0] ?? 'Your opponent';
  const totals = live.card.reduce((t, r) => ({ mine: t.mine + r.mine, theirs: t.theirs + r.theirs }), { mine: 0, theirs: 0 });
  const final = live.status === 'final';
  const won = final && live.winner === live.me;
  const headline = final
    ? live.method === 'draw'
      ? `A draw, ${totals.mine}–${totals.theirs}`
      : won
        ? live.method === 'ko'
          ? `You won by KO in round ${live.koRound}`
          : `You won on the cards, ${totals.mine}–${totals.theirs}`
        : live.method === 'ko'
          ? `${opp} won by KO in round ${live.koRound}`
          : `${opp} won on the cards, ${totals.theirs}–${totals.mine}`
    : live.last
      ? live.last.mine > live.last.theirs
        ? `You took round ${live.last.round}, ${live.last.mine}–${live.last.theirs}`
        : live.last.mine < live.last.theirs
          ? `${opp} took round ${live.last.round}, ${live.last.theirs}–${live.last.mine}`
          : `Round ${live.last.round} was even, ${live.last.mine}–${live.last.theirs}`
      : live.round < 1
        ? `The first bell rings soon`
        : `Round ${live.round}: the first bell`;
  const l = live.last;
  const landed = l
    ? (['jab', 'hook', 'up'] as const)
        .filter((k) => (l.myLanded[k] ?? 0) > 0)
        .map((k) => `${l.myLanded[k]} ${punchName(k).toLowerCase()}${(l.myLanded[k] ?? 0) === 1 ? '' : 's'}`)
        .join(' · ')
    : '';

  const pickGuard = (g: BoutGuard) => {
    setGuardState(g);
    setGuard(challengeId, g)
      .then(onChanged)
      .catch(() => setGuardState(live.guard));
  };
  const rounds = Array.from({ length: live.rounds }, (_, i) => i + 1);

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Text style={styles.kicker}>
          HOUND BOUT · {live.rounds} ROUNDS{active && live.round >= 1 ? ` · ROUND ${Math.min(live.rounds, live.round)} TODAY` : final ? ' · FINAL' : ''}
        </Text>
        <Text style={styles.title}>You vs {live.opponent?.name ?? 'an empty corner'}</Text>
      </View>

      <Card style={{ gap: 10 }} elevated={false}>
        <View style={styles.rowBetween}>
          <Text style={[styles.kicker, { color: '#a6e3b8' }]}>{final ? 'THE RESULT' : l ? `LAST NIGHT · ROUND ${l.round}` : 'THE FIGHT'}</Text>
          {l && (
            <Pressable onPress={() => setReplayRound(replayRound === l.round ? null : l.round)} hitSlop={8} accessibilityRole="button" style={styles.replayBtn}>
              <PlayIcon size={13} color={colors.accentActive} weight="fill" />
              <Text style={styles.link}>{replayRound === l.round ? 'Hide replay' : 'Replay'}</Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.headline}>{headline}</Text>
        {l && (
          <View style={styles.twoUp}>
            <View style={styles.stat}>
              <Text style={styles.small}>You landed</Text>
              <Text style={[styles.statBig, { color: ME_COLOR }]}>{l.myPoints} pts</Text>
              <Text style={styles.small}>{landed || 'nothing clean'}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.small}>{opp} landed</Text>
              <Text style={styles.statBig}>{l.theirPoints} pts</Text>
              <Text style={styles.small}>You slipped {l.slipped} of {l.theirThrough}</Text>
            </View>
          </View>
        )}
        {l && (l.myDown > 0 || l.theirDown > 0 || l.theirGuard) && (
          <Text style={styles.small}>
            {[
              l.theirDown > 0 ? `You put ${opp} down ${l.theirDown === 1 ? 'once' : `${l.theirDown} times`}.` : null,
              l.myDown > 0 ? `${opp} put you down ${l.myDown === 1 ? 'once' : `${l.myDown} times`}.` : null,
              l.theirGuard ? `${opp} had a ${l.theirGuard} guard up.` : null,
            ]
              .filter(Boolean)
              .join(' ')}
          </Text>
        )}
        {replayRound != null && <BoutReplayView challengeId={challengeId} round={replayRound} oppName={opp} apron={sponsorName ?? 'Hound Bout'} />}
      </Card>

      <Card style={{ gap: 6 }} elevated={false}>
        <View style={styles.cardRow}>
          <Text style={[styles.cell, styles.cellName, styles.head]}>ROUND</Text>
          {rounds.map((r) => (
            <Pressable key={r} style={styles.cellWrap} onPress={() => live.card.some((c) => c.round === r) && setReplayRound(r)} accessibilityRole="button" accessibilityLabel={`Replay round ${r}`}>
              <Text style={[styles.cell, styles.head]}>{r}</Text>
            </Pressable>
          ))}
          <Text style={[styles.cell, styles.cellTotal, styles.head]}>TOTAL</Text>
        </View>
        {(['mine', 'theirs'] as const).map((side) => (
          <View key={side} style={[styles.cardRow, styles.cardLine]}>
            <Text style={[styles.cell, styles.cellName, side === 'mine' && { color: ME_COLOR }]} numberOfLines={1}>
              {side === 'mine' ? 'You' : opp}
            </Text>
            {rounds.map((r) => {
              const c = live.card.find((x) => x.round === r);
              const now = active && r === live.round && !c;
              return (
                <View key={r} style={styles.cellWrap}>
                  <Text style={[styles.cell, now ? { color: '#f0a37a', fontSize: 11.5 } : !c && { color: withAlpha(colors.text, 0.35) }]}>
                    {c ? c[side] : now ? 'now' : '–'}
                  </Text>
                </View>
              );
            })}
            <Text style={[styles.cell, styles.cellTotal]}>{totals[side]}</Text>
          </View>
        ))}
        {live.card.length > 0 && <Text style={styles.small}>Tap a round to replay it.</Text>}
      </Card>

      {active && (
        <Card style={{ gap: 10 }} elevated={false}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Your guard today</Text>
            <Text style={styles.small}>{opp} can’t see it</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {GUARDS.map((g) => {
              const on = guard === g.id;
              return (
                <Pressable key={g.id} onPress={() => pickGuard(g.id)} style={[styles.guard, on && styles.guardOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text style={[styles.guardText, on && { color: ME_COLOR }]}>{g.name}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.body}>{GUARDS.find((g) => g.id === guard)?.line} It stays up until you change it.</Text>
        </Card>
      )}

      {active && (live.day.strength || live.day.cardio || live.stars > 0) && (
        <Card style={styles.powerCard} elevated={false}>
          <BoxingGloveIcon size={22} color={ME_COLOR} />
          <Text style={[styles.body, { flex: 1 }]}>
            {[
              live.stars > 0 ? `${live.stars} ${live.stars === 1 ? 'star' : 'stars'}: arm a Star punch in the ring for double points.` : null,
              live.day.strength ? 'Power today: two power punches that land in one combination is a knockdown.' : null,
              live.day.cardio ? 'Cardio: 2 extra actions today.' : null,
            ]
              .filter(Boolean)
              .join(' ')}
          </Text>
        </Card>
      )}

      {active && !pinned && (
        <View style={{ gap: 8 }}>
          {incoming > 0 && (
            <Pressable onPress={() => onRing('slip')} style={[styles.play, { backgroundColor: '#f08a24' }]} accessibilityRole="button">
              <Text style={styles.playText}>Slip {incoming} incoming</Text>
            </Pressable>
          )}
          <Pressable onPress={() => onRing('throw')} disabled={!live.canAct} style={[styles.play, !live.canAct && styles.playOff]} accessibilityRole="button">
            <Text style={[styles.playText, !live.canAct && { color: withAlpha(colors.text, 0.6), fontSize: 13.5 }]}>
              {live.canAct ? `Throw an exchange · ${live.day.left} left` : (live.reason ?? 'Not now')}
            </Text>
          </Pressable>
        </View>
      )}
      {active && (
        <Text style={styles.small}>
          {live.day.steps.toLocaleString()} steps today · {live.day.earned} actions · {live.day.used} used
          {live.day.nextAt != null ? ` · next at ${live.day.nextAt.toLocaleString()}` : ''}
        </Text>
      )}
    </View>
  );
}

// A scored round, replayed in the ring: every punch either hound threw, in
// order, and how it ended (missed, blocked, slipped, landed, down).
// The Title Bout (0227) passes its own loader (a fight by id), its label,
// and, for a title fight you're watching, the near corner's name.
export function BoutReplayView({
  challengeId,
  round,
  oppName,
  apron,
  load,
  meName = 'You',
  label,
}: {
  challengeId: string;
  round: number;
  oppName: string;
  apron: string;
  load?: () => Promise<BoutReplay>;
  meName?: string;
  label?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rep, setRep] = useState<BoutReplay | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRep(null);
    (load ? load() : getBoutReplay(challengeId, round))
      .then(setRep)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the replay.'));
    // load is a new function each render; the round (or fight) is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId, round, label]);
  if (error) return <Text style={styles.small}>{error}</Text>;
  if (!rep) return <ActivityIndicator color={colors.accent} />;
  // The new ring (0230): both hounds moving, combinations, slips, counters, the count.
  return <RingReplay punches={rep.punches} me={rep.me} meName={meName} oppName={oppName} apron={apron} label={label ?? `Round ${round}`} />;
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 20, color: colors.text },
    headline: { fontFamily: font.headingSemibold, fontSize: 18, lineHeight: 23, color: colors.text },
    cardTitle: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    link: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.accentActive },
    replayBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
    twoUp: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, borderRadius: 12, padding: 10, gap: 3, backgroundColor: withAlpha(colors.text, 0.05) },
    statBig: { fontFamily: font.headingSemibold, fontSize: 19, color: colors.text },
    small: { fontSize: 12, lineHeight: 17, color: withAlpha(colors.text, 0.62) },
    body: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.8) },
    cardRow: { flexDirection: 'row', alignItems: 'center' },
    cardLine: { paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.12) },
    head: { fontSize: 11, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.55) },
    cellWrap: { flex: 1, alignItems: 'center', minHeight: 28, justifyContent: 'center' },
    cell: { textAlign: 'center', fontSize: 14, fontFamily: font.headingSemibold, color: colors.text },
    cellName: { width: 64, textAlign: 'left' },
    cellTotal: { width: 48 },
    guard: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(colors.text, 0.05), borderWidth: 2, borderColor: 'transparent' },
    guardOn: { borderColor: ME_COLOR, backgroundColor: withAlpha(ME_COLOR, 0.14) },
    guardText: { fontFamily: font.headingSemibold, fontSize: 14.5, color: colors.text },
    powerCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    play: { minHeight: 48, borderRadius: 12, backgroundColor: '#7fd39b', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
    playOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    playText: { fontFamily: font.headingSemibold, fontSize: 15, color: '#161826', textAlign: 'center' },
    replayRing: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#1d2133' },
    replayScore: {
      position: 'absolute',
      right: 8,
      top: 8,
      backgroundColor: 'rgba(15,17,28,0.82)',
      color: '#fff',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      fontSize: 12,
      fontFamily: font.headingSemibold,
      overflow: 'hidden',
    },
    replayLine: {
      position: 'absolute',
      left: 8,
      right: 8,
      bottom: 8,
      textAlign: 'center',
      backgroundColor: 'rgba(15,17,28,0.85)',
      color: '#fff',
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 6,
      fontSize: 13,
      fontFamily: font.headingSemibold,
      overflow: 'hidden',
    },
  });
}
