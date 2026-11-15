import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getDerbyOverview, type DerbyOverview } from '../challenges/derbyApi';

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
}

// Admin → Overview → Games → Home Run Derby (0211): how many Derbies, who
// joined and who's swinging, swings and home runs this week, Moonshots,
// golden balls thrown and hit, and the sponsor's sign.
export function DerbyAdminCard({ onChanged }: { onChanged?: (o: DerbyOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<DerbyOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getDerbyOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onChanged?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_derby_overview/.test(e.message)
              ? 'Run 0210 and 0211_derby.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Derby numbers.',
          ),
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['Derbies', `${data.live} live · ${data.all} ever`],
        ['Players', `${data.joined.toLocaleString()} joined · ${data.swung7d.toLocaleString()} swung this week (${pct(data.swung7d, data.joined)})`],
        ['This week', `${data.swings7d.toLocaleString()} swings · ${data.hrs7d.toLocaleString()} home runs (${pct(data.hrs7d, data.swings7d)} of swings)`],
        ['Moonshots', `${data.moonshots7d.toLocaleString()} this week (475+ ft)`],
        ['Golden balls', `${data.goldenThrown7d.toLocaleString()} thrown · ${data.goldenHit7d.toLocaleString()} hit out (${pct(data.goldenHit7d, data.goldenThrown7d)})`],
        ['Sponsor sign', `${data.signHits7d.toLocaleString()} hits · ${data.sponsorBones7d.toLocaleString()} Bones from sponsors`],
        ['Per player', data.avgHrs == null ? '–' : `${data.avgHrs.toFixed(1)} home runs on average`],
        ['Longest ever', data.longestEver ? `${data.longestEver.name} · ${data.longestEver.ft} ft` : '–'],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Home Run Derby</Text>
      <Text style={styles.note}>
        A Global Hound Challenge: publish it from Create (Global) with the Hound Home Run Derby template. Steps buy the swings, 1 per 1,000, up to 20 a day.
      </Text>
      {error ? (
        <Text style={styles.note}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <View style={{ gap: 0 }}>
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
