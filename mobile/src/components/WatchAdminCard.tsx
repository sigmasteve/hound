import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { supabase } from '../lib/supabase';

// Admin → Apple Watch (0189): who's linked a watch, who uses it, and the
// water added from the wrist.
export interface WatchOverview {
  linked: number;
  people: number;
  seen24h: number;
  seen7d: number;
  opens7d: number;
  waterTaps7d: number;
  waterPeople7d: number;
}

export async function getWatchOverview(): Promise<WatchOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_watch_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    linked: n(d.linked),
    people: n(d.people),
    seen24h: n(d.seen_24h),
    seen7d: n(d.seen_7d),
    opens7d: n(d.opens_7d),
    waterTaps7d: n(d.water_taps_7d),
    waterPeople7d: n(d.water_people_7d),
  };
}

export function watchSummary(o: WatchOverview): string {
  return `${o.people} with a watch linked · ${o.seen7d} this week`;
}

export function WatchAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<WatchOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getWatchOverview()
        .then((o) => {
          setData(o);
          setError(null);
        })
        .catch((e) =>
          setError(e instanceof Error && /admin_watch_overview/.test(e.message) ? 'Run 0189_apple_watch.sql to see these.' : e instanceof Error ? e.message : 'Could not load.'),
        );
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['Watches linked', `${data.linked} by ${data.people} ${data.people === 1 ? 'person' : 'people'}`],
        ['Used', `${data.seen24h} in the last day · ${data.seen7d} this week · ${data.opens7d} opens this week`],
        ['Water from the wrist (7 days)', `${data.waterTaps7d} glasses by ${data.waterPeople7d} ${data.waterPeople7d === 1 ? 'person' : 'people'}`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Apple Watch</Text>
      <Text style={styles.footNote}>Hound on the wrist: goals, water and the streak. People link a watch with the code it shows (Settings → Apple Watch).</Text>
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
