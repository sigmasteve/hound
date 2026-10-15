import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BarbellIcon, CheckCircleIcon, FootprintsIcon, PathIcon, TimerIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { Card } from './Card';
import { ProgressBar } from './ProgressBar';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { formatAmount, goalTitle, progressLine, type GoalMetric, type GoalProgress } from '../goals/goals';

const ICONS: Record<GoalMetric, React.ComponentType<any>> = {
  steps: FootprintsIcon,
  distance_mi: PathIcon,
  workouts: BarbellIcon,
  workout_minutes: TimerIcon,
};

// Today's first card: every goal, where you are on it, and what's left.
// The heading says whether the Hound is still on you.
export function GoalsCard({
  progress,
  needsSetup,
  onOpenGoal,
  onEdit,
  onSetGoals,
}: {
  progress: GoalProgress[];
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

      {needsSetup && (
        <View style={styles.setup}>
          <Text style={styles.setupText}>These are starter goals. Make them yours.</Text>
          <Button label="Set your goals" variant="primary" small onPress={onSetGoals} />
        </View>
      )}

      {progress.map((p) => {
        const Icon = ICONS[p.goal.metric];
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
              <Text style={[styles.status, p.done && { color: colors.green }]} numberOfLines={1}>
                {progressLine(p)}
              </Text>
            </View>
            <ProgressBar pct={p.pct} fillColor={p.done ? colors.green : colors.accent} height={5} />
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
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    goalName: { flex: 1, fontSize: 13, color: withAlpha(colors.text, 0.75) },
    valueRow: { flexDirection: 'row', alignItems: 'baseline' },
    value: { fontFamily: font.heading, fontSize: 24, color: colors.text },
    target: { fontSize: 14, color: withAlpha(colors.text, 0.55) },
    status: { flex: 1, textAlign: 'right', fontSize: 12.5, color: withAlpha(colors.text, 0.6), marginLeft: 8 },
  });
}
