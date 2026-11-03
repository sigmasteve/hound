import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getWalksOverview, type WalksOverview } from '../admin/walksOverview';

function pct(part: number, whole: number): string {
  return whole > 0 ? ` (${Math.round((part / whole) * 100)}%)` : '';
}

// Admin → Walks (0161): walks spotted from steps, what they found, and
// the collection book and diary. Reloads each time Admin comes into view.
export function WalksAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<WalksOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getWalksOverview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_walks_overview/.test(e.message)
              ? 'Run 0161_hound_walks.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the walk numbers.',
          ),
        );
    }, []),
  );

  const t = data?.byTime7d;
  const rows: [string, string][] = data
    ? [
        ['Have had a walk spotted', `${data.walkersEver}`],
        ['Walked in the last 7 days', `${data.walkers7d}${pct(data.walkers7d, data.walkersEver)}`],
        [
          'Walks, last 7 days',
          `${data.walks7d.toLocaleString()}${
            data.walks7d > 0 ? ` · about ${data.avgMinutes7d} min and ${data.avgSteps7d.toLocaleString()} steps each` : ''
          }`,
        ],
        ['When, last 7 days', t ? `Morning ${t.morning} · Lunch ${t.lunchtime} · Afternoon ${t.afternoon} · Evening ${t.evening} · Late ${t.late}` : ''],
        ['Have found something', `${data.findersEver} · ${data.finds7d} finds in the last 7 days`],
        ['Opened the collection book, last 7 days', `${data.bookOpeners7d}`],
        ['Read their diary, last 7 days', `${data.diaryReaders7d}${pct(data.diaryReaders7d, data.walkersEver)}`],
        ['Shared a diary week, last 7 days', `${data.diaryShares7d}`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Walks</Text>
      <Text style={styles.footNote}>
        Walks are spotted on the phone from steps in 15-minute buckets: 10 minutes or more of steady steps. Each finished
        walk finds something, up to 5 a day.
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
          {data.findsByKind.length > 0 && (
            <View style={styles.row}>
              <Text style={styles.label}>Finds, all time</Text>
              {data.findsByKind.map((k) => (
                <Text key={k.id} style={styles.person}>
                  {k.name} <Text style={styles.label}>· {k.rarity} · {k.count}</Text>
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
