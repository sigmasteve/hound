import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getAutoJoinOverview, playedPct, type AutoJoinOverview } from '../challenges/autoJoinApi';

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
}

// Admin → Overview → Status → New users in Global challenges (0222): how
// many new accounts were put in, how many played within 3 days, who left,
// late joins, and whether they're still around a week later compared
// with the accounts from before it shipped.
export function AutoJoinAdminCard({ onChanged }: { onChanged?: (o: AutoJoinOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<AutoJoinOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getAutoJoinOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onChanged?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_auto_join_overview/.test(e.message)
              ? 'Run 0222_auto_join_globals.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the numbers.',
          ),
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['This week', `${data.new7d.toLocaleString()} new accounts · ${data.people7d.toLocaleString()} auto-joined into ${data.challenges7d.toLocaleString()} ${data.challenges7d === 1 ? 'challenge' : 'challenges'}`],
        ['Played within 3 days', `${data.played.toLocaleString()} of ${data.eligiblePlayed.toLocaleString()} (${playedPct(data)}): synced steps, a kick, a swing or a shot`],
        ['Left', `${data.leftOne.toLocaleString()} left one (${pct(data.leftOne, data.peopleAll)}) · ${data.leftAll.toLocaleString()} left all of them`],
        ['Joined late (after the window closed)', `${data.late7d.toLocaleString()} this week`],
        [
          'Still syncing steps a week later',
          `${data.weekLaterAuto == null ? '–' : `${data.weekLaterAuto}%`} auto-joined · ${data.weekLaterBefore == null ? '–' : `${data.weekLaterBefore}%`} of new accounts the month before`,
        ],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>New users in Global challenges</Text>
      <Text style={styles.note}>
        New accounts join the open Global challenges on their first open of Today: up to 3, not 75 Day or Accountability, and late during their first 7 days.
      </Text>
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
          {data.byChallenge.length > 0 && (
            <View style={[styles.row, { gap: 6 }]}>
              <Text style={styles.label}>By challenge, this week</Text>
              {data.byChallenge.map((c) => (
                <View key={c.name} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text style={styles.small}>
                    {c.joined} in · {c.left} left · {c.played} played
                  </Text>
                </View>
              ))}
            </View>
          )}
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
    small: { fontSize: 13.5, color: colors.text },
  });
}
