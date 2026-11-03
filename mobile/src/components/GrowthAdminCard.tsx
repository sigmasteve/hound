import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getGrowthOverview, traitInfo, type GrowthOverview } from '../growth/growth';

// Admin → Growth (0165): fitness levels, puppies and grown hounds,
// traits earned, and birthdays. Hounds active in the last 30 days.
export function GrowthAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<GrowthOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getGrowthOverview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_growth_overview/.test(e.message)
              ? 'Run 0165_hound_growth.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the growth numbers.',
          ),
        );
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['Hounds active in the last 30 days', `${data.hounds}`],
        ['Fitness levels', data.byFitness.map((f) => `${f.level}: ${f.count}`).join(' · ') || 'None yet'],
        ['Puppy · young · grown', `${data.byStage.puppy} · ${data.byStage.young} · ${data.byStage.grown}`],
        ['Have a trait', `${data.withTrait} · ${data.traits7d} earned in the last 7 days`],
        ['Birthdays', `${data.birthdaysSet} picked their own · ${data.birthdaysToday} today`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Growth</Text>
      <Text style={styles.footNote}>
        Fitness goes 1 to 10 with active days (5,000 steps) ever. Hounds from before 0165 are grown; new ones grow up at
        100,000 and 400,000 steps.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value}>{value}</Text>
            </View>
          ))}
          {data.byTrait.length > 0 && (
            <View style={styles.row}>
              <Text style={styles.label}>Traits earned</Text>
              {data.byTrait.map((t) => (
                <Text key={t.id} style={styles.person}>
                  {traitInfo(t.id).name} <Text style={styles.label}>· {t.count}</Text>
                </Text>
              ))}
            </View>
          )}
        </>
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
    person: { fontFamily: font.heading, fontSize: 14, color: colors.text },
  });
}
