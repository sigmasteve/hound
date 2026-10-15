import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MinusIcon, PlusIcon } from 'phosphor-react-native';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { formatAmount, roundTarget, type GoalMetric } from '../goals/goals';

const STEP: Record<GoalMetric, number> = { steps: 500, distance_mi: 0.5, workouts: 1, workout_minutes: 5 };

// − value + for a goal's target, in that metric's own steps (500 steps,
// half a mile, one workout, five minutes).
export function GoalStepper({
  metric,
  value,
  onChange,
}: {
  metric: GoalMetric;
  value: number;
  onChange: (v: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const nudge = (dir: 1 | -1) => onChange(roundTarget(metric, value + STEP[metric] * dir));
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => nudge(-1)} style={styles.button} hitSlop={6} accessibilityLabel="Less">
        <MinusIcon size={14} color={colors.accentActive} />
      </Pressable>
      <Text style={styles.value}>{formatAmount(metric, value)}</Text>
      <Pressable onPress={() => nudge(1)} style={styles.button} hitSlop={6} accessibilityLabel="More">
        <PlusIcon size={14} color={colors.accentActive} />
      </Pressable>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    button: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.accent, 0.14),
    },
    value: { minWidth: 64, textAlign: 'center', fontFamily: font.heading, fontSize: 14, color: colors.text },
  });
}
