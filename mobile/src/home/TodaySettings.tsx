import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { ToggleRow } from '../components/Selectable';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha, type Palette } from '../theme/tokens';
import { TODAY_EXTRAS, setTodayExtra, useTodayExtras } from './todayExtras';
import { useHolidayEffectsPref } from '../holiday/HolidayContext';

// Settings → Today: whether your newest challenge is featured when none
// is pinned (the toggle's state lives with Settings, which loads it), and
// the same extras as Customize Today (0278), saved for the account.
export function TodaySettings({
  featureNewest,
  onToggleFeatureNewest,
}: {
  featureNewest: boolean | null;
  onToggleFeatureNewest: (next: boolean) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const extras = useTodayExtras();
  const [holidayEffects, setHolidayEffects] = useHolidayEffectsPref();

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
      <Text style={styles.note}>Extras on Today, off until you turn them on:</Text>
      {TODAY_EXTRAS.map((x) => (
        <ToggleRow
          key={x.id}
          label={x.label}
          note={x.detail}
          value={extras[x.id]}
          onChange={(v) => {
            setTodayExtra(x.id, v).catch(() => {});
          }}
        />
      ))}
      {/* 0184: a holiday theme's falling snow, leaves or confetti. The
          rest of the decorations stay. */}
      {extras.holiday && (
      <ToggleRow
        label="Holiday snow and confetti"
        note={holidayEffects ? 'Falling on Today during a holiday' : 'Off: just the decorations'}
        value={holidayEffects}
        onChange={setHolidayEffects}
      />
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
  });
}
