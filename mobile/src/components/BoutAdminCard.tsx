import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getBoutOverview, type BoutOverview } from '../challenges/boutApi';

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
}

// Admin → Overview → Games → Hound Bout (0225): fights, who has thrown a
// punch and who's throwing this week, the punches and how they went
// (missed, blocked, perfect), slips, knockdowns, how fights end, and the
// guards people pick.
export function BoutAdminCard({ onChanged }: { onChanged?: (o: BoutOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<BoutOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getBoutOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onChanged?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_bout_overview/.test(e.message)
              ? 'Run 0224 and 0225_bout.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Bout numbers.',
          ),
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const finals = data ? (data.byMethod.ko ?? 0) + (data.byMethod.decision ?? 0) + (data.byMethod.draw ?? 0) : 0;
  const guards = data ? (data.guards7d.high ?? 0) + (data.guards7d.body ?? 0) + (data.guards7d.counter ?? 0) : 0;
  const rows: [string, string][] = data
    ? [
        ['Fights', `${data.live} live · ${data.all} ever · ${data.fighters.toLocaleString()} fighters`],
        ['Tried it', `${data.threwEver.toLocaleString()} have thrown a punch · ${data.threw7d.toLocaleString()} this week`],
        [
          'Punches this week',
          `${data.punches7d.toLocaleString()}: ${data.byPunch7d.jab ?? 0} jabs · ${data.byPunch7d.hook ?? 0} hooks · ${data.byPunch7d.up ?? 0} uppercuts`,
        ],
        ['How they went', `${pct(data.missed7d, data.punches7d)} missed · ${pct(data.blocked7d, data.punches7d)} blocked · ${pct(data.perfect7d, data.punches7d)} perfect`],
        ['Slips this week', `${data.slipped7d.toLocaleString()} of ${data.slipsTried7d.toLocaleString()} tried (${pct(data.slipped7d, data.slipsTried7d)})`],
        ['Knockdowns', `${data.knockdownsAll.toLocaleString()}, all time`],
        ['How fights end', finals > 0 ? `${data.byMethod.ko ?? 0} KO · ${data.byMethod.decision ?? 0} on the cards · ${data.byMethod.draw ?? 0} draws` : '–'],
        [
          'Guards picked this week',
          guards > 0 ? `High ${pct(data.guards7d.high ?? 0, guards)} · Body ${pct(data.guards7d.body ?? 0, guards)} · Counter ${pct(data.guards7d.counter ?? 0, guards)}` : '–',
        ],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Hound Bout</Text>
      <Text style={styles.note}>One on one boxing, a round a day: punches and slips from steps, a guard, knockdowns and KOs.</Text>
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
