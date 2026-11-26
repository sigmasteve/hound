import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { supabase } from '../lib/supabase';

// Admin → Apple Watch (0189): who's linked a watch, who uses it, and the
// water added from the wrist; since 0274 fasts and activities from the
// wrist, and taps on the phone's widgets (Fasting, Log activity).
export interface WatchOverview {
  linked: number;
  people: number;
  seen24h: number;
  seen7d: number;
  opens7d: number;
  waterTaps7d: number;
  waterPeople7d: number;
  fastStarts7d: number;
  fastEnds7d: number;
  fastPeople7d: number;
  activities7d: number;
  activityPeople7d: number;
  widgetTaps7d: Record<string, number>;
  widgetPeople7d: number;
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
    fastStarts7d: n(d.fast_starts_7d),
    fastEnds7d: n(d.fast_ends_7d),
    fastPeople7d: n(d.fast_people_7d),
    activities7d: n(d.activities_7d),
    activityPeople7d: n(d.activity_people_7d),
    widgetTaps7d: d.widget_taps_7d ?? {},
    widgetPeople7d: n(d.widget_people_7d),
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
        [
          'Fasting from the wrist (7 days)',
          `${data.fastStarts7d} started · ${data.fastEnds7d} ended, by ${data.fastPeople7d} ${data.fastPeople7d === 1 ? 'person' : 'people'}`,
        ],
        ['Activities logged from the wrist (7 days)', `${data.activities7d} by ${data.activityPeople7d} ${data.activityPeople7d === 1 ? 'person' : 'people'}`],
        [
          'Phone widget taps (7 days)',
          `Fasting ${data.widgetTaps7d.fasting ?? 0} · Log activity ${data.widgetTaps7d.activity ?? 0}, by ${data.widgetPeople7d} ${data.widgetPeople7d === 1 ? 'person' : 'people'}`,
        ],
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
