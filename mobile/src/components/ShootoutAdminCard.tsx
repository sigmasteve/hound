import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getShootoutOverview, ZONE_NAMES, type ShootoutOverview } from '../challenges/shootoutApi';

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
}

// Admin → Overview → Games → Hound Shootout (0221): how many Shootouts,
// who joined and who's kicking, kicks and goals this week and how they
// went (saved, held, over or wide), top bins, perfect strikes, golden
// balls, workout pace, where people aim, and the prizes paid.
export function ShootoutAdminCard({ onChanged }: { onChanged?: (o: ShootoutOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<ShootoutOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getShootoutOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onChanged?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_shootout_overview/.test(e.message)
              ? 'Run 0220 and 0221_shootout.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Shootout numbers.',
          ),
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const aimed = data ? data.zones7d.reduce((a, b) => a + b, 0) : 0;
  const rows: [string, string][] = data
    ? [
        ['Shootouts', `${data.live} live · ${data.all} ever`],
        ['Tried it', `${data.kickedEver.toLocaleString()} have taken a kick · ${data.joined.toLocaleString()} joined`],
        ['This week', `${data.kicked7d.toLocaleString()} kicking (${pct(data.kicked7d, data.joined)} of those in) · ${data.kicks7d.toLocaleString()} kicks`],
        ['Scored', `${data.scored7d.toLocaleString()} of ${data.kicks7d.toLocaleString()} (${pct(data.scored7d, data.kicks7d)}) · ${data.goals7d.toLocaleString()} goals counted`],
        ['Top bins', `${data.topBins7d.toLocaleString()} this week`],
        ['How the rest went', `${data.saved7d.toLocaleString()} saved · ${data.held7d.toLocaleString()} too soft · ${data.off7d.toLocaleString()} over or wide`],
        ['Perfect strikes', `${data.perfect7d.toLocaleString()} (${pct(data.perfect7d, data.kicks7d)} of kicks)`],
        ['Golden balls', `${data.goldenScored7d.toLocaleString()} scored this week`],
        ['Workout pace', `${data.paced7d.toLocaleString()} kicks with a strength workout behind them`],
        ['Where they aim', aimed > 0 ? data.zones7d.map((n, i) => `${ZONE_NAMES[i]} ${pct(n, aimed)}`).join(' · ') : '–'],
        ['Prizes paid', `${data.prizeBonesAll.toLocaleString()} Bones, all time`],
        ['Per player', data.avgGoals == null ? '–' : `${data.avgGoals.toFixed(1)} goals on average`],
        ['Longest streak ever', data.bestStreakEver ? `${data.bestStreakEver.name} · ${data.bestStreakEver.streak} in a row` : '–'],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Hound Shootout</Text>
      <Text style={styles.note}>
        A Global Hound Challenge: publish it from Create (Global) with the Hound Shootout template. Steps buy the kicks, 1 per 1,000, up to 20 a day.
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
