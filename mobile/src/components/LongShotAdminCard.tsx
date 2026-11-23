import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getLongShotOverview, type LongShotOverview } from '../challenges/longshotApi';

// Admin → Long Shot (0247): who's tried it and who shoots now, rounds and
// hits by plate, the rifles people pick, gold plates rung and Moon days.
export function LongShotAdminCard({ onChanged }: { onChanged?: (o: LongShotOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<LongShotOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getLongShotOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onChanged?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_longshot_overview/.test(e.message)
              ? 'Run 0246 and 0247 to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Long Shot numbers.',
          ),
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const n = (v: number) => v.toLocaleString('en-US');
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–');
  const rows: [string, string][] = data
    ? [
        ['Games', `${data.live} live · ${data.games} ever`],
        ['Shooters', `${n(data.active7d)} this week · ${n(data.tried)} ever fired · ${n(data.cards)} with a data card`],
        ['Rounds this week', `${n(data.rounds7d)} · ${pct(data.hits7d, data.rounds7d)} hit · ${n(data.moon7d)} on the Moon`],
        ['Hit rate by plate', data.plates.length ? data.plates.map((p) => `${n(p.dist)}: ${pct(p.hits, p.shots)}`).join(' · ') : '–'],
        ['Rifles this week', data.rifles.length ? data.rifles.map((r) => `${r.name} ${pct(r.shots, data.rounds7d)}`).join(' · ') : '–'],
        ['Gold plates', `${data.gold7d} rung this week · ${n(data.goldBones)} Bones paid ever`],
        ['Rounds from workouts', data.workoutRoundsToday ? `${n(data.workoutRoundsToday)} today, by ${n(data.workoutPeopleToday)}` : 'None today'],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Long Shot</Text>
      <Text style={styles.footNote}>
        Rounds from steps, plates out to 3,000 yards. If the far plates are almost never hit, the wind or the sway may be too much; if the near ones
        are nearly always, they may be too easy.
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
