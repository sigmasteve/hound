import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getTagOverview, type TagOverview } from '../tag/tagChaseApi';

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
}

// Admin → Tag (0181): daily chases running, how the days go, and which
// head starts people pick.
export function TagAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<TagOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getTagOverview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_tag_overview/.test(e.message)
              ? 'Run 0181_tag_chase.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Tag numbers.',
          ),
        );
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['Chases', `${data.running} running · ${data.upcoming} coming up · ${data.finished} finished`],
        ['Playing now', `${data.players} ${data.players === 1 ? 'person' : 'people'}`],
        [
          'Days settled this week',
          `${data.days7d} · ${data.tags7d} tags · ${data.escapes7d} got away · ${pct(data.noTagDays7d, data.days7d)} with no tag`,
        ],
        [
          'Head starts picked',
          ['1000', '2000', '3000'].map((h) => `${Number(h).toLocaleString()}: ${data.headStarts[h] ?? 0}`).join(' · '),
        ],
        ['Old-style games still running', String(data.oldRunning)],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Game of Tag</Text>
      <Text style={styles.footNote}>
        The daily chase: one hound IT a day, everyone else with a head start. Lots of days with no tag means the head start
        is too big for the group.
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
