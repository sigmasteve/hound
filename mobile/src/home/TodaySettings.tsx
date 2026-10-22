import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { ToggleRow } from '../components/Selectable';
import { SegmentedControl } from '../components/SegmentedControl';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha, type Palette } from '../theme/tokens';
import { setGoalsTileStyle, useGoalsTileStyle, type GoalsTileStyle } from './todayPrefs';

// Settings → Today: how the goals tile shows your goals, and whether
// your newest challenge is featured when none is pinned (the toggle's
// state lives with Settings, which loads it).
export function TodaySettings({
  featureNewest,
  onToggleFeatureNewest,
}: {
  featureNewest: boolean | null;
  onToggleFeatureNewest: (next: boolean) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tileStyle = useGoalsTileStyle();
  if (!tileStyle && featureNewest === null) return null;

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Today</Text>
      {featureNewest !== null && (
        <ToggleRow
          label="Newest challenge on Today"
          note={featureNewest ? 'Featured when you haven’t pinned one' : 'Only a pinned challenge is featured'}
          value={featureNewest}
          onChange={onToggleFeatureNewest}
        />
      )}
      {tileStyle && (
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>Goals tile</Text>
        <SegmentedControl<GoalsTileStyle>
          options={[
            { value: 'rings', label: 'Rings' },
            { value: 'trails', label: 'Hound trails' },
          ]}
          value={tileStyle}
          onChange={setGoalsTileStyle}
        />
        <Text style={styles.note}>
          {tileStyle === 'rings'
            ? 'One ring per goal, with your numbers beside them.'
            : 'You run each goal’s trail to the bone, with the Hound pacing behind.'}
        </Text>
      </View>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    label: { fontSize: 14, color: colors.text },
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
  });
}
