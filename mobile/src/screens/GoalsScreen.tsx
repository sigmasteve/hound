import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MinusIcon, PlusIcon, TrashIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { RadioPill } from '../components/Selectable';
import { SegmentedControl } from '../components/SegmentedControl';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useHealthProvider } from '../health/HealthContext';
import type { DailyStepsWithDate, WorkoutSample } from '../health/types';
import { useGoals } from '../goals/GoalsContext';
import { HOUND_LEVELS } from '../goals/hound';
import {
  ACTIVITIES,
  ACTIVITY_NAMES,
  defaultTarget,
  describeGoal,
  formatAmount,
  MAX_GOALS,
  METRIC_NAMES,
  metricTakesActivity,
  roundTarget,
  suggestTarget,
  type Goal,
  type GoalActivity,
  type GoalMetric,
  type GoalPeriod,
} from '../goals/goals';

const METRICS: GoalMetric[] = ['steps', 'distance_mi', 'workouts', 'workout_minutes'];

const STEP: Record<GoalMetric, number> = { steps: 500, distance_mi: 0.5, workouts: 1, workout_minutes: 5 };

function nudge(metric: GoalMetric, value: number, dir: 1 | -1): number {
  return roundTarget(metric, value + STEP[metric] * dir);
}

// Your goals, and how hard the Hound reminds you about them. Opened from
// the You tab and from the goals card on Today.
export function GoalsScreen() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { goals, houndLevel, setHoundLevel, updateGoal, removeGoal, addGoal } = useGoals();
  const health = useHealthProvider();

  // The last four weeks, for "you average…" suggestions.
  const [history, setHistory] = useState<{ days: DailyStepsWithDate[]; workouts: WorkoutSample[] } | null>(null);
  useEffect(() => {
    const since = new Date();
    since.setDate(since.getDate() - 29);
    Promise.all([health.getDailyStepsSince(since), health.getRecentWorkouts(200)])
      .then(([days, workouts]) => setHistory({ days, workouts }))
      .catch(() => setHistory({ days: [], workouts: [] }));
  }, [health]);

  const [adding, setAdding] = useState(false);

  const changeLevel = async (level: typeof houndLevel) => {
    try {
      await setHoundLevel(level);
    } catch (err) {
      Alert.alert('Hounding', err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={[text.h2, { fontSize: 24 }]}>Goals</Text>

      <Card style={{ gap: 12 }} elevated={false}>
        <Text style={text.h4}>How hard should Hound hound you?</Text>
        {HOUND_LEVELS.map((l) => {
          const on = houndLevel === l.id;
          return (
            <Pressable
              key={l.id}
              onPress={() => changeLevel(l.id)}
              style={[styles.levelRow, on && styles.levelRowOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <View style={[styles.dot, on && styles.dotOn]} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.levelName}>{l.name}</Text>
                <Text style={styles.levelDetail}>{l.detail}</Text>
              </View>
            </Pressable>
          );
        })}
        <Text style={styles.footNote}>
          Reminders stop for the day once your goals are done. If you don&rsquo;t open Hound all day, you get one at 9 PM.
        </Text>
      </Card>

      <Card style={{ gap: 14 }} elevated={false}>
        <Text style={text.h4}>Your goals</Text>
        {goals.length === 0 && <Text style={styles.footNote}>No goals yet. Add one below.</Text>}
        {goals.map((g) => (
          <GoalRow
            key={g.id}
            goal={g}
            styles={styles}
            colors={colors}
            onChange={(target) => updateGoal(g.id, { target }).catch(() => {})}
            onRemove={() =>
              Alert.alert('Remove this goal?', g.label ?? describeGoal(g), [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => removeGoal(g.id).catch(() => {}) },
              ])
            }
          />
        ))}
        {!adding && goals.length < MAX_GOALS && (
          <Button
            label="Add your own goal"
            variant="secondary"
            icon={<PlusIcon size={14} color={colors.accent} />}
            onPress={() => setAdding(true)}
          />
        )}
        {goals.length >= MAX_GOALS && <Text style={styles.footNote}>That&rsquo;s the most goals you can have at once.</Text>}
      </Card>

      {adding && (
        <NewGoalCard
          history={history}
          styles={styles}
          colors={colors}
          onCancel={() => setAdding(false)}
          onSave={async (draft) => {
            await addGoal(draft);
            setAdding(false);
          }}
        />
      )}
    </ScrollView>
  );
}

function Stepper({
  metric,
  value,
  onChange,
  styles,
  colors,
}: {
  metric: GoalMetric;
  value: number;
  onChange: (v: number) => void;
  styles: GoalsStyles;
  colors: Palette;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(nudge(metric, value, -1))}
        style={styles.stepButton}
        hitSlop={6}
        accessibilityLabel="Less"
      >
        <MinusIcon size={14} color={colors.accentActive} />
      </Pressable>
      <Text style={styles.stepValue}>{formatAmount(metric, value)}</Text>
      <Pressable
        onPress={() => onChange(nudge(metric, value, 1))}
        style={styles.stepButton}
        hitSlop={6}
        accessibilityLabel="More"
      >
        <PlusIcon size={14} color={colors.accentActive} />
      </Pressable>
    </View>
  );
}

function GoalRow({
  goal,
  onChange,
  onRemove,
  styles,
  colors,
}: {
  goal: Goal;
  onChange: (target: number) => void;
  onRemove: () => void;
  styles: GoalsStyles;
  colors: Palette;
}) {
  // Saved a moment after the last tap, so a run of taps is one save.
  const [draft, setDraft] = useState(goal.target);
  useEffect(() => setDraft(goal.target), [goal.target]);
  useEffect(() => {
    if (draft === goal.target) return;
    const t = setTimeout(() => onChange(draft), 700);
    return () => clearTimeout(t);
  }, [draft]);

  return (
    <View style={styles.goalRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.goalName} numberOfLines={1}>
          {goal.label ?? METRIC_NAMES[goal.metric]}
        </Text>
        <Text style={styles.goalDetail} numberOfLines={1}>
          {describeGoal({ ...goal, target: draft })}
        </Text>
      </View>
      <Stepper metric={goal.metric} value={draft} onChange={setDraft} styles={styles} colors={colors} />
      <Pressable onPress={onRemove} hitSlop={8} accessibilityLabel="Remove goal">
        <TrashIcon size={16} color={withAlpha(colors.text, 0.5)} />
      </Pressable>
    </View>
  );
}

function NewGoalCard({
  history,
  onSave,
  onCancel,
  styles,
  colors,
}: {
  history: { days: DailyStepsWithDate[]; workouts: WorkoutSample[] } | null;
  onSave: (draft: Omit<Goal, 'id' | 'sort'>) => Promise<void>;
  onCancel: () => void;
  styles: GoalsStyles;
  colors: Palette;
}) {
  const { text } = useTheme();
  const [metric, setMetric] = useState<GoalMetric>('workouts');
  const [period, setPeriod] = useState<GoalPeriod>('week');
  const [activity, setActivity] = useState<GoalActivity | null>(null);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const suggestion = useMemo(
    () => (history ? suggestTarget(metric, period, metricTakesActivity(metric) ? activity : null, history) : null),
    [history, metric, period, activity],
  );
  const [target, setTarget] = useState(defaultTarget('workouts', 'week'));
  // A fresh choice starts from the suggestion, or a sensible default.
  useEffect(() => {
    setTarget(suggestion?.suggested ?? defaultTarget(metric, period));
  }, [metric, period, activity, suggestion?.suggested]);

  const draft = { metric, period, target, activity: metricTakesActivity(metric) ? activity : null, label: label.trim() || null };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } catch (err) {
      Alert.alert('Add a goal', err instanceof Error ? err.message : 'Something went wrong.');
      setSaving(false);
    }
  };

  return (
    <Card style={{ gap: 14 }} elevated={false}>
      <Text style={text.h4}>Your own goal</Text>

      <View style={{ gap: 8 }}>
        <Text style={styles.fieldLabel}>What counts</Text>
        <View style={styles.wrap}>
          {METRICS.map((m) => (
            <RadioPill key={m} label={METRIC_NAMES[m]} selected={metric === m} onPress={() => setMetric(m)} />
          ))}
        </View>
      </View>

      {metricTakesActivity(metric) && (
        <View style={{ gap: 8 }}>
          <Text style={styles.fieldLabel}>Which workouts</Text>
          <View style={styles.wrap}>
            <RadioPill label="Any" selected={activity === null} onPress={() => setActivity(null)} />
            {ACTIVITIES.map((a) => (
              <RadioPill key={a} label={ACTIVITY_NAMES[a]} selected={activity === a} onPress={() => setActivity(a)} />
            ))}
          </View>
        </View>
      )}

      <View style={{ gap: 8 }}>
        <Text style={styles.fieldLabel}>How often</Text>
        <SegmentedControl
          options={[
            { value: 'day', label: 'Every day' },
            { value: 'week', label: 'Every week' },
          ]}
          value={period}
          onChange={setPeriod}
        />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={styles.fieldLabel}>Target</Text>
        <View style={styles.targetRow}>
          <Text style={styles.goalDetail}>{describeGoal(draft)}</Text>
          <Stepper metric={metric} value={target} onChange={setTarget} styles={styles} colors={colors} />
        </View>
        <Text style={styles.footNote}>
          {history === null
            ? 'Looking at your last four weeks…'
            : suggestion
              ? `Your last four weeks: about ${
                  metric === 'workouts' ? Math.round(suggestion.average * 10) / 10 : formatAmount(metric, suggestion.average)
                } ${
                  period === 'day' ? 'a day' : 'a week'
                }. Hound suggests ${formatAmount(metric, suggestion.suggested)}, a little more than that.`
              : 'Hound hasn’t seen enough of this in your data yet to suggest a target.'}
        </Text>
      </View>

      <TextField label="Name (optional)" value={label} onChangeText={setLabel} maxLength={40} placeholder={describeGoal(draft)} />

      <View style={styles.actions}>
        <Button label="Cancel" variant="ghost" onPress={onCancel} />
        <Button label={saving ? 'Saving…' : 'Add goal'} variant="primary" disabled={saving} onPress={save} />
      </View>
    </Card>
  );
}

type GoalsStyles = ReturnType<typeof makeStyles>;

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 16, paddingBottom: 48 },
    levelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    levelRowOn: { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.1) },
    dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: withAlpha(colors.text, 0.4) },
    dotOn: { borderColor: colors.accent, backgroundColor: colors.accent },
    levelName: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    levelDetail: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    goalRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    goalName: { fontFamily: font.heading, fontSize: 14.5, color: colors.text },
    goalDetail: { flex: 1, fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    stepButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.accent, 0.14),
    },
    stepValue: { minWidth: 64, textAlign: 'center', fontFamily: font.heading, fontSize: 14, color: colors.text },
    fieldLabel: { fontSize: 12, letterSpacing: 0.4, color: withAlpha(colors.text, 0.55) },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    targetRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  });
}
