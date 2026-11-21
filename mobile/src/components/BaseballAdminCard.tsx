import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getBaseballOverview, type BaseballOverview } from '../challenges/baseballApi';

// A batting average the baseball way: .312.
function avg(v: number): string {
  return v >= 1 ? v.toFixed(3) : v.toFixed(3).replace(/^0/, '');
}

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
        // 0207: at-bats taken by hand.
        ...(data.live
          ? ([
              ['Games where people take their own at-bats', `${data.live.gamesHandsOn}`],
              [
                'Took their own at-bats this week',
                `${data.live.people7d} ${data.live.people7d === 1 ? 'person' : 'people'} · ${data.live.atBats7d} at-bats · ${data.live.pitches7d} pitches · ${data.live.hr7d} home runs`,
              ],
              ['Batting average this week', data.live.avg7d == null ? 'No at-bats by hand yet' : `${avg(data.live.avg7d)} by hand · ${data.live.autoAvg7d == null ? '–' : avg(data.live.autoAvg7d)} played for them`],
              // 0231: hit the ball, pitch to them, steal second.
              [
                'Swings tapped on the ball this week',
                `${data.live.tapped7d}${data.live.avgMiss7d == null ? '' : ` · ${data.live.avgMiss7d.toFixed(2)} off the ball on average`} · ${data.live.curveballs7d} curveballs thrown`,
              ],
              [
                'Pitched by hand this week',
                `${data.live.pitchers7d} ${data.live.pitchers7d === 1 ? 'pitcher' : 'pitchers'} · ${data.live.pitched7d} at-bats · ${data.live.pitchedK7d} strikeouts · ${data.live.pitchedHits7d} hits`,
              ],
              ['Corners painted this week', `${data.live.painted7d} of ${data.live.moundPitches7d} pitches${pct(data.live.painted7d, data.live.moundPitches7d)}`],
              [
                'Steal jumps this week',
                `${data.live.jumps7d} set · ${data.live.greatJumps7d} great · ${data.live.jumpSteals7d} run tonight, ${data.live.jumpSafe7d} safe`,
              ],
              ['Derby swings tapped on the ball this week', `${data.live.derbyTapped7d}`],
            ] as [string, string][])
          : []),
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
