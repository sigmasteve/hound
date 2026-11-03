import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getWaterOverview, type WaterOverview } from '../admin/waterOverview';
import { CUP_ML, mlToOz } from '../water/water';

function pct(part: number, whole: number): string {
  return whole > 0 ? ` (${Math.round((part / whole) * 100)}%)` : '';
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Admin → Water: who's added a water goal and whether they log. Reloads
// each time Admin comes into view. Null before 0154 has run: says so.
export function WaterAdminCard({ onLoaded }: { onLoaded?: (d: WaterOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<WaterOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getWaterOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onLoaded?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_water_overview/.test(e.message)
              ? 'Run 0154_admin_water_overview.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the water numbers.',
          ),
        );
    }, [onLoaded]),
  );

  const rows: [string, string][] = data
    ? [
        ['Have a water goal', `${data.withGoal}${data.added7d > 0 ? ` · ${data.added7d} added in the last 7 days` : ''}`],
        ['Of everyone active in the last 14 days', `${data.activeWithGoal} of ${data.active}${pct(data.activeWithGoal, data.active)}`],
        ['Logged water, last 24 hours', `${data.logged24h}`],
        ['Logged water, last 7 days', `${data.logged7d}${pct(data.logged7d, data.withGoal)}`],
        [
          'Glasses logged, last 7 days',
          `${data.glasses7d.toLocaleString()}${
            data.avgDayMl > 0
              ? ` · about ${Math.round(data.avgDayMl / CUP_ML * 10) / 10} cups (${Math.round(mlToOz(data.avgDayMl))} oz) on a day they log`
              : ''
          }`,
        ],
        ['Water goals met, last 7 days', `${data.waterDays7d} days`],
        ['Show it in', `Cups ${data.cups} · Millilitres ${data.ml}`],
        ['Sip reminders on', `${data.sipReminders}${pct(data.sipReminders, data.withGoal)}`],
        ['Badges', `First Sip ${data.badges.first} · Well Watered ${data.badges.seven} · Watering Hole ${data.badges.thirty}`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Water</Text>
      <Text style={styles.footNote}>
        Everyone who&rsquo;s added a water goal. Glasses are the ones logged in Hound; water other apps put in Apple
        Health isn&rsquo;t counted here.
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
          {data.newest.length > 0 && (
            <View style={styles.row}>
              <Text style={styles.label}>Newest</Text>
              {data.newest.map((p, i) => (
                <Text key={`${p.name}-${i}`} style={styles.person}>
                  {p.name} <Text style={styles.label}>· {when(p.addedAt)}</Text>
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
