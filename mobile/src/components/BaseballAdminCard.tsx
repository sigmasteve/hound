import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getBaseballOverview, type BaseballOverview } from '../challenges/baseballApi';

function pct(part: number, whole: number): string {
  return whole > 0 ? ` (${Math.round((part / whole) * 100)}%)` : '';
}

// Admin → Baseball (0167): games, players and bots, the picks people
// make, and how the games play.
export function BaseballAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<BaseballOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getBaseballOverview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_baseball_overview/.test(e.message)
              ? 'Run 0166 and 0167_baseball.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the baseball numbers.',
          ),
        );
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['Games', `${data.active} on now · ${data.finished} finished`],
        ['Finished in extra innings · ties', `${data.extraInnings}${pct(data.extraInnings, data.finished)} · ${data.ties}`],
        ['People playing', `${data.players} · ${data.seats} seats, ${data.botSeats} of them bots`],
        ['Made a pick, last 7 days', `${data.pickers7d}`],
        ['Picks, last 7 days', `Aim ${data.picks7d.aim} · Shift ${data.picks7d.shift} · Approach ${data.picks7d.approach} · Steal ${data.picks7d.steal}`],
        ['Runs a game (both sides)', data.finished > 0 ? `${data.avgRuns}` : 'None finished yet'],
        ['Home runs · double plays', `${data.homeRuns} · ${data.doublePlays}`],
        ['Stolen bases · caught stealing', `${data.stolenBases} · ${data.caughtStealing}`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Baseball</Text>
      <Text style={styles.footNote}>
        One inning a day from everyone&rsquo;s steps. Tuned for about 7 runs a game at 8,000 steps a player; a big
        gap from that means the odds need another look.
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
