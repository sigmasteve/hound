import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_KIND_ICON } from '../data/challengeIcons';
import type { AutoJoinCard, AutoJoinedChallenge } from '../challenges/autoJoinApi';

// "You're in" (0222): the Global challenges a new account was put in, on
// Today where the Global challenges sit, until Got it. Each row says
// where the challenge stands and what to do now (in green when something
// is waiting), with Leave, then Undo. Mockup:
// claude.ai/artifact/3yH2t6bnCr8Qu1B4TS717x.

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five'];
const DAY = 86_400_000;

// What there is to do in each kind, when nothing's waiting.
const DO_NOW: Partial<Record<string, string>> = {
  steps: 'Just walk: every step counts',
  streak: 'Hit the goal every day to stay in',
  distance: 'Every mile adds to everyone’s total',
  bingo: 'Your steps and workouts fill your card',
  journey: 'Your walks move you along the course',
  houndopoly: 'Your steps move you round the board',
  doors: 'Open today’s door',
  packs: 'Vote where your pack marches today',
  golf: 'Your steps are yards: play a hole',
  derby: 'Your steps buy the swings: 1 per 1,000',
  shootout: 'Your steps buy the kicks: 1 per 1,000',
  titlebout: 'A new opponent every day: 1 action per 1,500 steps',
};

function weekday(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long' });
}

function metaLine(c: AutoJoinedChallenge, now: number): string {
  const start = Date.parse(c.startsAt);
  const end = Date.parse(c.endsAt);
  if (now < start) return `Starts ${weekday(c.startsAt)} · ${c.durationDays} ${c.durationDays === 1 ? 'day' : 'days'}`;
  const day = Math.min(c.durationDays, Math.floor((now - start) / DAY) + 1);
  const left = Math.ceil((end - now) / DAY);
  const ends = left <= 6 ? `ends ${weekday(c.endsAt)}` : `${left} days left`;
  return `Day ${day} of ${c.durationDays} · ${ends} · ${c.field.toLocaleString()} in`;
}

export function YoureInCard({
  card,
  waiting,
  onLeave,
  onUndo,
  onGotIt,
  onOpen,
}: {
  card: AutoJoinCard;
  // What's waiting in each challenge (Needs you's line), by id.
  waiting: Map<string, string>;
  onLeave: (c: AutoJoinedChallenge) => Promise<void>;
  onUndo: (c: AutoJoinedChallenge) => Promise<void>;
  onGotIt: () => void;
  onOpen: (c: AutoJoinedChallenge) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState<string | null>(null);
  const now = Date.now();
  const inCount = card.challenges.filter((c) => c.joined).length;
  const headline =
    inCount === 0
      ? 'You’ve left them all. That’s fine.'
      : `You’re in ${WORDS[inCount] ?? inCount} challenge${inCount === 1 ? '' : 's'} everyone’s playing`;

  const act = (c: AutoJoinedChallenge, fn: (c: AutoJoinedChallenge) => Promise<void>) => {
    setBusy(c.id);
    fn(c).finally(() => setBusy(null));
  };

  return (
    <View style={styles.card} accessibilityLabel="You're in">
      <View style={{ gap: 4 }}>
        <Text style={styles.kicker}>WELCOME TO HOUND · YOU’RE IN</Text>
        <Text style={styles.headline}>{headline}</Text>
        <Text style={styles.sub}>Everyone on Hound plays these. Your steps count from today, so you’re already on the board.</Text>
      </View>
      {card.challenges.map((c) => {
        const Icon = CHALLENGE_KIND_ICON[c.kind] ?? CHALLENGE_KIND_ICON.steps;
        const left = !c.joined;
        const ready = !left ? waiting.get(c.id) : undefined;
        const upcoming = now < Date.parse(c.startsAt);
        const todo = left
          ? 'Undo to get back in'
          : ready ?? (upcoming ? `Your first go comes ${weekday(c.startsAt)}` : (DO_NOW[c.kind] ?? 'Open it to see how it works'));
        return (
          <View key={c.id} style={[styles.row, left && styles.rowLeft]}>
            <Pressable
              style={({ pressed }) => [styles.rowMain, pressed && !left && { opacity: 0.8 }]}
              onPress={() => !left && onOpen(c)}
              disabled={left}
              accessibilityRole="button"
              accessibilityLabel={`Open ${c.name}`}
            >
              <View style={[styles.icon, left && styles.iconLeft]}>
                <Icon size={20} color={left ? withAlpha(colors.text, 0.4) : colors.accentActive} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={[styles.name, left && styles.nameLeft]} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text style={styles.meta} numberOfLines={2}>
                  {left ? 'You left it' : metaLine(c, now)}
                </Text>
                <Text style={[styles.todo, ready ? { color: colors.green } : null, left && { color: withAlpha(colors.text, 0.45) }]} numberOfLines={2}>
                  {todo}
                </Text>
              </View>
            </Pressable>
            <Pressable
              style={({ pressed }) => [left ? styles.undo : styles.leave, pressed && { opacity: 0.8 }]}
              onPress={() => act(c, left ? onUndo : onLeave)}
              disabled={busy !== null}
              accessibilityRole="button"
              accessibilityLabel={left ? `Undo leaving ${c.name}` : `Leave ${c.name}`}
            >
              {busy === c.id ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Text style={[styles.leaveText, left && { color: colors.accentActive }]}>{left ? 'Undo' : 'Leave'}</Text>
              )}
            </Pressable>
          </View>
        );
      })}
      <Text style={styles.foot}>Leave any you don’t want. There are more to join under Challenges.</Text>
      <Pressable style={({ pressed }) => [styles.gotIt, pressed && { opacity: 0.85 }]} onPress={onGotIt} accessibilityRole="button">
        <Text style={styles.gotItText}>{inCount === 0 ? 'Done' : 'Got it'}</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: {
      gap: 12,
      padding: 16,
      borderRadius: 18,
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: withAlpha(colors.accent, 0.55),
    },
    kicker: { fontSize: 11.5, letterSpacing: 1.2, fontFamily: font.headingSemibold, color: colors.accentActive },
    headline: { fontSize: 20, lineHeight: 25, fontFamily: font.headingSemibold, color: colors.text },
    sub: { fontSize: 13.5, lineHeight: 19, color: withAlpha(colors.text, 0.72) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 10,
      borderRadius: 14,
      backgroundColor: withAlpha(colors.text, 0.04),
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.08),
    },
    rowLeft: { backgroundColor: 'transparent' },
    rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
    icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(colors.accent, 0.18) },
    iconLeft: { backgroundColor: withAlpha(colors.text, 0.06) },
    name: { fontSize: 15, fontFamily: font.headingSemibold, color: colors.text },
    nameLeft: { color: withAlpha(colors.text, 0.5), textDecorationLine: 'line-through' },
    meta: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    todo: { fontSize: 12.5, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.82) },
    leave: {
      minWidth: 64,
      height: 44,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.18),
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
    },
    undo: { minWidth: 64, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, backgroundColor: withAlpha(colors.accent, 0.2) },
    leaveText: { fontSize: 14, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.8) },
    foot: { fontSize: 12.5, lineHeight: 18, color: withAlpha(colors.text, 0.6) },
    gotIt: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green },
    gotItText: { fontSize: 16, fontFamily: font.headingSemibold, color: '#1b1d29' },
  });
}
