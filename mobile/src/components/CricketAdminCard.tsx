import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getCricketOverview, type CricketOverview } from '../challenges/cricketApi';

// Admin → Cricket: matches and how they end, and (0234) the balls people
// bat and bowl by hand.
export function CricketAdminCard({ onChanged }: { onChanged?: (o: CricketOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<CricketOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getCricketOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onChanged?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_cricket_overview/.test(e.message)
              ? 'Run 0234_cricket_hands_on.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the cricket numbers.',
          ),
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['Matches', `${data.active} on now (${data.handsOn} batted and bowled by hand) · ${data.finished} finished`],
        ['How they ended', `${data.chased} chased · ${data.defended} defended · ${data.ties} tied`],
        ['Batted by hand this week', `${data.batters7d} ${data.batters7d === 1 ? 'person' : 'people'} · ${data.batBalls7d} balls · ${data.sixes7d} sixes, ${data.fours7d} fours, ${data.outsBatting7d} out`],
        ['Bowled by hand this week', `${data.bowlers7d} ${data.bowlers7d === 1 ? 'person' : 'people'} · ${data.bowlBalls7d} balls · ${data.wicketsBowling7d} wickets`],
        ['Used in the night’s over', `${data.used7d} of ${data.batBalls7d + data.bowlBalls7d} balls by hand`],
        [
          'Runs a ball this week',
          `${data.runsPerBallHand == null ? '–' : data.runsPerBallHand.toFixed(2)} by hand · ${data.runsPerBallRolled == null ? '–' : data.runsPerBallRolled.toFixed(2)} played for them`,
        ],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Cricket</Text>
      <Text style={styles.footNote}>One over a day. Rolled balls run about 1.2 a ball at level steps; a big gap by hand means the shot or delivery tables need another look.</Text>
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
    row: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
  });
}
