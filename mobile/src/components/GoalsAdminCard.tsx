import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getGoalsOverview, type GoalsOverview } from '../admin/goalsOverview';

function pct(part: number, whole: number): string {
  return whole > 0 ? ` (${Math.round((part / whole) * 100)}%)` : '';
}

// Admin → Goals: whether goals and the Hound are being used, over
// everyone who's opened Hound in the last 14 days. Reloads each time
// Admin comes into view.
export function GoalsAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<GoalsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getGoalsOverview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not load goal numbers.'));
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['Set their own goals', `${data.goalsSet} of ${data.active}${pct(data.goalsSet, data.active)}`],
        ['Added a goal of their own', `${data.customGoals}`],
        [
          'Hounding',
          `Gentle ${data.levels.gentle} · Persistent ${data.levels.persistent} · Relentless ${data.levels.relentless} · Off ${data.levels.off}`,
        ],
        ['Hit their steps goal yesterday', `${data.stepsHit} of ${data.stepsTracked}${pct(data.stepsHit, data.stepsTracked)}`],
        ['Phones scheduling today’s reminders', `${data.phoneScheduled}`],
        ['9 PM backup reminders, last 24 hours', `${data.backups24h}`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Goals</Text>
      <Text style={styles.footNote}>
        Everyone who&rsquo;s opened Hound in the last 14 days. &ldquo;Hit their steps goal&rdquo; counts people whose
        steps reached Hound yesterday (UTC). A phone scheduling its own reminders means the 9 PM backup stays quiet
        for that person.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        rows.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    row: {
      gap: 2,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.07),
    },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
  });
}
