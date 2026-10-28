import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { GoalStepper } from './GoalStepper';
import { RadioPill } from './Selectable';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useGoals } from '../goals/GoalsContext';
import { useGoalHistory } from '../goals/useGoalHistory';
import { HOUND_LEVELS } from '../goals/hound';
import type { HoundLevel } from '../goals/goalsApi';
import { describeGoal, formatAmount, METRIC_NAMES, suggestTarget } from '../goals/goals';

// Goal setup, right on Today: the goals you have (the three starters, for
// a new account) with a − / + for each, what you've been averaging where
// the phone has the data, and how hard to hound you. Open on a new
// account's first visit; everyone else opens it from the goals card's
// "Set your goals" button.
export function GoalSetupCard({
  onDone,
  onMoreOptions,
  canDismiss,
}: {
  onDone: () => void;
  onMoreOptions: () => void;
  canDismiss: boolean;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { goals, houndLevel, updateGoal, setHoundLevel, markGoalsSet } = useGoals();
  const history = useGoalHistory();

  const [targets, setTargets] = useState<Record<string, number>>({});
  const [level, setLevel] = useState<HoundLevel>(houndLevel);
  const [saving, setSaving] = useState(false);
  useEffect(() => setLevel(houndLevel), [houndLevel]);

  const targetFor = (id: string, fallback: number) => targets[id] ?? fallback;

  const save = async () => {
    setSaving(true);
    try {
      await Promise.all(
        goals.filter((g) => targets[g.id] !== undefined && targets[g.id] !== g.target).map((g) => updateGoal(g.id, { target: targets[g.id] })),
      );
      if (level !== houndLevel) await setHoundLevel(level);
      await markGoalsSet();
      onDone();
    } catch (err) {
      Alert.alert('Your goals', err instanceof Error ? err.message : 'Something went wrong.');
      setSaving(false);
    }
  };

  const levelInfo = HOUND_LEVELS.find((l) => l.id === level);

  return (
    <Card style={{ gap: 16 }} elevated={false}>
      <View style={{ gap: 4 }}>
        <Text style={text.h4}>What should Hound hold you to?</Text>
        <Text style={styles.note}>Set your goals and Hound reminds you until they&rsquo;re done. You can change them any time.</Text>
      </View>

      {goals.map((g) => {
        const value = targetFor(g.id, g.target);
        const suggestion = history ? suggestTarget(g.metric, g.period, g.activity, history) : null;
        return (
          <View key={g.id} style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name} numberOfLines={1}>
                {g.label ?? `${METRIC_NAMES[g.metric]} ${g.period === 'day' ? 'a day' : 'a week'}`}
              </Text>
              <Text style={styles.note} numberOfLines={2}>
                {suggestion
                  ? `You average ${
                      g.metric === 'workouts' ? Math.round(suggestion.average * 10) / 10 : formatAmount(g.metric, suggestion.average)
                    }`
                  : describeGoal({ ...g, target: value })}
              </Text>
            </View>
            <GoalStepper metric={g.metric} value={value} onChange={(v) => setTargets((cur) => ({ ...cur, [g.id]: v }))} />
          </View>
        );
      })}

      <View style={{ gap: 8 }}>
        <Text style={styles.label}>How hard should Hound hound you?</Text>
        <View style={styles.wrap}>
          {HOUND_LEVELS.map((l) => (
            <RadioPill key={l.id} label={l.name} selected={level === l.id} onPress={() => setLevel(l.id)} />
          ))}
        </View>
        {levelInfo && <Text style={styles.note}>{levelInfo.detail}.</Text>}
      </View>

      <View style={styles.actions}>
        <Pressable onPress={onMoreOptions} hitSlop={8} accessibilityRole="button" style={{ flex: 1 }}>
          <Text style={styles.link}>Add your own goal</Text>
        </Pressable>
        {canDismiss && <Button label="Not now" variant="ghost" small onPress={onDone} />}
        <Button label={saving ? 'Saving…' : 'Save goals'} variant="primary" small disabled={saving} onPress={save} />
      </View>
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    name: { fontFamily: font.heading, fontSize: 14.5, color: colors.text },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    label: { fontSize: 12, letterSpacing: 0.4, color: withAlpha(colors.text, 0.55) },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    link: { fontFamily: font.heading, fontSize: 14, color: colors.accentActive },
  });
}
