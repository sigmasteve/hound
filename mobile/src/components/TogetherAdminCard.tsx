import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getTogetherOverview, type TogetherOverview } from '../together/together';

// Admin → Together (0170): playdates, walks together, and who looks at
// the dog park. Reloads each time Admin comes into view.
export function TogetherAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<TogetherOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getTogetherOverview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_together_overview/.test(e.message)
              ? 'Run 0170_together.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the together numbers.',
          ),
        );
    }, []),
  );

  const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
  const rows: [string, string][] = data
    ? [
        ['Playdates, last 7 days', `${data.playdates7d} · ${people(data.playdatePeople7d)}`],
        ['Playdates ever', `${data.playdatesAll}`],
        ['Walks together, last 7 days', `${data.walksTogether7d} · ${people(data.walkersTogether7d)}`],
        ['Looked at the dog park, last 7 days', `${people(data.parkVisitors7d)} · ${data.parkOpens7d} person-days`],
        ['Have looked at the dog park', `${people(data.parkVisitorsAll)}`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Together</Text>
      <Text style={styles.footNote}>
        A playdate is a friend's hound over in your yard on a day you've both finished your goals. A walk together is two
        friends' walks overlapping by 10 minutes or more. The dog park shows friends' hounds that walked in the last day.
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
    person: { fontFamily: font.heading, fontSize: 14, color: colors.text },
  });
}
