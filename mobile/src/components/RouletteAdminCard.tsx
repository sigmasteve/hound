import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getRouletteOverview, type RouletteOverview } from '../challenges/rouletteApi';

// Admin → Hound Roulette (0236): who spins, which stakes they pick and
// make, banking and rides lost, and the Raids and Duels between them.
export function RouletteAdminCard({ onChanged }: { onChanged?: (o: RouletteOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<RouletteOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getRouletteOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onChanged?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_roulette_overview/.test(e.message)
              ? 'Run 0235 and 0236 to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Roulette numbers.',
          ),
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const made = (k: string) => {
    const s = data?.stakes[k];
    return s && s.spins ? `${s.spins} (${Math.round((100 * s.done) / s.spins)}% made)` : '0';
  };
  const tasks = data
    ? Object.entries(data.tasks)
        .sort((a, b) => b[1].spins - a[1].spins)
        .map(([k, v]) => `${k} ${v.spins ? Math.round((100 * v.done) / v.spins) : 0}%`)
        .join(' · ')
    : '';
  const rows: [string, string][] = data
    ? [
        ['Games', `${data.live} live · ${data.finished} finished · ${data.players} ${data.players === 1 ? 'player' : 'players'} ever`],
        ['Spinning', `${data.spinners7d} this week (${data.spins7d} spins) · ${data.spinsToday} today · ${data.everSpun} ever`],
        ['Stakes this week', `Safe ${made('safe')} · Bold ${made('bold')} · All in ${made('allin')}`],
        ['Tasks made this week', tasks || '–'],
        ['Specials this week', `${data.specials7d.free} Free Days · ${data.specials7d.double} Doubles · ${data.specials7d.pick} Pick Yours`],
        ['Banking this week', `${data.banks7d} banks, ${data.banked7d} points · ${data.ridesLost7d} rides lost (${data.pointsLost7d} points)`],
        [
          'Raids this week',
          `${data.raids7d.sent} sent · ${data.raids7d.won} took a ride (${data.raids7d.taken} points) · ${data.raids7d.held} held off · ${data.raids7d.void} banked first`,
        ],
        [
          'Duels this week',
          `${data.duels7d.called} called · ${data.duels7d.accepted} accepted (${data.duels7d.staked} staked) · ${data.duels7d.declined} turned down · ${data.duels7d.expired} unanswered · ${data.duels7d.decided} won, ${data.duels7d.level} level`,
        ],
        ['Prizes', `${data.bandanas} Lucky ${data.bandanas === 1 ? 'Bandana' : 'Bandanas'} · ${data.bonesPaid.toLocaleString('en-US')} Bones paid at the end`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Hound Roulette</Text>
      <Text style={styles.footNote}>
        A spin a day, a task from the wheel. Points only from tasks, out only as Bones and the Lucky Bandana. If All in is made far less often than Bold, its
        targets are too steep.
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
    row: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
  });
}
