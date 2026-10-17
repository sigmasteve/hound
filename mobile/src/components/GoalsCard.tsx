import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  BarbellIcon,
  CheckCircleIcon,
  FireIcon,
  FootprintsIcon,
  PathIcon,
  ShieldCheckIcon,
  TimerIcon,
} from 'phosphor-react-native';
import { Button } from './Button';
import { Card } from './Card';
import { GoalTrail, type TrailAvatar } from './GoalTrail';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { formatAmount, goalTitle, pacePct, progressLine, type GoalMetric, type GoalProgress } from '../goals/goals';
import { SHIELD_MAX, type GoalStreak } from '../goals/goalStreakApi';

const ICONS: Record<GoalMetric, React.ComponentType<any>> = {
  steps: FootprintsIcon,
  distance_mi: PathIcon,
  workouts: BarbellIcon,
  workout_minutes: TimerIcon,
};

// What the streak line says: how many days in a row, and what today
// adds. Only for someone with a daily goal.
function streakText(s: GoalStreak, currencyName: string): { title: string; detail: string } {
  const next = s.streak + 1;
  const pays = `+${s.nextBones} ${currencyName}`;
  if (s.streak === 0) return { title: 'Start a streak', detail: `Hit every daily goal today: ${pays}.` };
  const title = s.streak === 1 ? '1 goal day' : `${s.streak} days in a row`;
  if (s.hitToday) return { title, detail: `Back tomorrow for day ${next}.` };
  if (s.shieldCovering) return { title, detail: `Yesterday was missed: a shield covers it once today's goals are done.` };
  return { title, detail: `Hit today's goals for day ${next}: ${pays}.` };
}

// The shield line under the streak: how many you hold, and whether this
// week's cover is already used.
function shieldText(s: GoalStreak): string {
  const held = s.shields === 0 ? 'No shields' : s.shields === 1 ? '1 shield' : `${s.shields} shields`;
  return s.shields > 0 && s.shieldCooldown && !s.shieldCovering ? `${held} · used one this week` : held;
}

// Today's first card: every goal, where you are on it, and what's left.
// The heading says whether the Hound is still on you.
export function GoalsCard({
  progress,
  streak,
  currencyName,
  onBuyShield,
  avatar,
  needsSetup,
  onOpenGoal,
  onEdit,
  onSetGoals,
}: {
  progress: GoalProgress[];
  // Goal days in a row (0099_goal_streaks.sql); null until it loads.
  streak: GoalStreak | null;
  currencyName: string;
  // Spends Bones on a Streak Shield (asks first); null hides the button.
  onBuyShield: (() => void) | null;
  // You, running each goal's trail (GoalTrail).
  avatar: TrailAvatar;
  // Goals nobody has chosen yet (the starters): offer to set them.
  needsSetup: boolean;
  onOpenGoal: (p: GoalProgress) => void;
  onEdit: () => void;
  onSetGoals: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const done = progress.filter((p) => p.done).length;
  const allDone = progress.length > 0 && done === progress.length;
  const streakLine =
    streak && progress.some((p) => p.goal.period === 'day') ? streakText(streak, currencyName) : null;

  return (
    <Card style={{ gap: 14 }} elevated={false}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>{allDone ? "The Hound's off your back" : "The Hound's on you"}</Text>
          <Text style={styles.subtitle}>
            {progress.length === 0
              ? 'Set a goal and Hound will keep you on it.'
              : allDone
                ? 'Every goal is done. Nice work.'
                : `${done} of ${progress.length} goals done`}
          </Text>
        </View>
        {!needsSetup && (
          <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button">
            <Text style={styles.edit}>{progress.length === 0 ? 'Add a goal' : 'Edit'}</Text>
          </Pressable>
        )}
      </View>

      {streakLine && streak && (
        <View style={styles.streak}>
          <View style={styles.streakRow}>
            <FireIcon size={20} color={streak.streak > 0 ? colors.amber : withAlpha(colors.text, 0.4)} weight="fill" />
            <View style={{ flex: 1 }}>
              <Text style={styles.streakTitle}>{streakLine.title}</Text>
              <Text style={styles.streakDetail}>{streakLine.detail}</Text>
            </View>
            {streak.best > streak.streak && <Text style={styles.best}>Best {streak.best}</Text>}
          </View>
          <View style={styles.shieldRow}>
            <ShieldCheckIcon
              size={16}
              color={streak.shields > 0 ? colors.accentActive : withAlpha(colors.text, 0.4)}
              weight={streak.shields > 0 ? 'fill' : 'regular'}
            />
            <Text style={styles.shieldText} numberOfLines={1}>
              {shieldText(streak)}
            </Text>
            {onBuyShield && streak.shields < SHIELD_MAX && (
              <Pressable onPress={onBuyShield} hitSlop={8} accessibilityRole="button">
                <Text style={styles.shieldBuy}>
                  Get one · {streak.shieldCost} {currencyName}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {needsSetup && (
        <View style={styles.setup}>
          <Text style={styles.setupText}>These are starter goals. Make them yours.</Text>
          <Button label="Set your goals" variant="primary" small onPress={onSetGoals} />
        </View>
      )}

      {progress.map((p) => {
        const Icon = ICONS[p.goal.metric];
        const pace = pacePct(p.goal);
        const houndOnYou = !p.done && pace > p.pct;
        return (
          <Pressable
            key={p.goal.id}
            onPress={() => onOpenGoal(p)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
          >
            <View style={styles.rowTop}>
              <Icon size={15} color={colors.accent} />
              <Text style={styles.goalName} numberOfLines={1}>
                {goalTitle(p.goal)}
              </Text>
              {p.done && <CheckCircleIcon size={16} color={colors.green} weight="fill" />}
            </View>
            <View style={styles.valueRow}>
              <Text style={styles.value}>{formatAmount(p.goal.metric, p.value)}</Text>
              <Text style={styles.target}> / {formatAmount(p.goal.metric, p.goal.target)}</Text>
              <Text
                style={[styles.status, p.done && { color: colors.green }, houndOnYou && { color: colors.amber }]}
                numberOfLines={1}
              >
                {progressLine(p)}
              </Text>
            </View>
            <GoalTrail pct={p.pct} done={p.done} pace={p.done ? null : pace} avatar={avatar} />
          </Pressable>
        );
      })}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    title: { fontFamily: font.headingSemibold, fontSize: 18, color: colors.text },
    subtitle: { fontSize: 13, color: withAlpha(colors.text, 0.6) },
    edit: { fontFamily: font.heading, fontSize: 14, color: colors.accentActive, paddingTop: 2 },
    row: { gap: 6 },
    setup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 12,
      borderRadius: 10,
      backgroundColor: withAlpha(colors.accent, 0.1),
    },
    setupText: { flex: 1, fontSize: 13, color: colors.text },
    streak: {
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: withAlpha(colors.amber, 0.1),
    },
    streakTitle: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    streakDetail: { fontSize: 12.5, color: withAlpha(colors.text, 0.65) },
    best: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    streakRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    shieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.1),
    },
    shieldText: { flex: 1, fontSize: 12.5, color: withAlpha(colors.text, 0.7) },
    shieldBuy: { fontFamily: font.heading, fontSize: 13, color: colors.accentActive },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    goalName: { flex: 1, fontSize: 13, color: withAlpha(colors.text, 0.75) },
    valueRow: { flexDirection: 'row', alignItems: 'baseline' },
    value: { fontFamily: font.heading, fontSize: 24, color: colors.text },
    target: { fontSize: 14, color: withAlpha(colors.text, 0.55) },
    status: { flex: 1, textAlign: 'right', fontSize: 12.5, color: withAlpha(colors.text, 0.6), marginLeft: 8 },
  });
}
