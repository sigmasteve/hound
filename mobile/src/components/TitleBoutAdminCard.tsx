import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getTitleBoutOverview, type TitleBoutOverview } from '../challenges/titleBoutApi';

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
}

// Admin → Overview → Games → Title Bout (0227): how many joined, have
// fought and are fighting this week, the fights (KOs, sparring hounds),
// who comes back, the picks and how many were right, and the champions.
export function TitleBoutAdminCard({ onChanged }: { onChanged?: (o: TitleBoutOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<TitleBoutOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getTitleBoutOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onChanged?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_titlebout_overview/.test(e.message)
              ? 'Run 0226 and 0227_titlebout.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Title Bout numbers.',
          ),
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['Title Bouts', `${data.live} live · ${data.all} ever`],
        ['Tried it', `${data.joined.toLocaleString()} joined · ${data.foughtEver.toLocaleString()} have fought · ${data.fought7d.toLocaleString()} fighting this week`],
        ['Fights this week', `${data.fights7d.toLocaleString()} · ${data.kos7d.toLocaleString()} KOs · ${data.sparring7d.toLocaleString()} against a sparring hound`],
        ['Punches this week', data.punches7d.toLocaleString()],
        ['Came back', data.cameBack == null ? '–' : `${data.cameBack}% of fighters fought 3+ days · ${data.fiveDays.toLocaleString()} fought 5+`],
        ['Picks', `${data.picks.toLocaleString()} made · ${data.picksRight.toLocaleString()} right (${pct(data.picksRight, data.picks)})`],
        ['Champions', data.champions.length > 0 ? data.champions.slice(0, 5).map((c) => `${c.name} (${c.method === 'ko' ? 'KO' : 'cards'})`).join(' · ') : '–'],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Title Bout</Text>
      <Text style={styles.note}>The global Hound Bout: five days on the ladder, then the top two fight for the belt while everyone picks a champion.</Text>
      {error ? (
        <Text style={styles.note}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <View>
          {rows.map(([k, v]) => (
            <View key={k} style={styles.row}>
              <Text style={styles.label}>{k}</Text>
              <Text style={styles.value}>{v}</Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.7) },
    row: { paddingVertical: 8, gap: 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.12) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.headingSemibold, fontSize: 14.5, color: colors.text },
  });
}
