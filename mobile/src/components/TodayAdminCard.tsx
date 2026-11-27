import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { supabase } from '../lib/supabase';
import { TODAY_EXTRAS, type TodayExtra } from '../home/todayExtras';

// Admin → Overview → Status → Customize Today (0278): Today opens on the
// basics; how many have turned extras on, which ones, and how much Your
// day's rings get tapped.

export interface TodayOverview {
  customized: number;
  saved: number;
  customized7d: number;
  extras: Record<TodayExtra, number>;
  taps7d: Record<string, { people: number; taps: number }>;
  tappedEver: number;
}

export function todaySummary(d: TodayOverview): string {
  const yourDay = d.taps7d.steps?.people ?? 0;
  return `${d.customized} with an extra on · ${yourDay} tapped Your day this week`;
}

const TAPS: { id: string; label: string }[] = [
  { id: 'steps', label: 'Steps & workouts' },
  { id: 'fasting', label: 'Fasting' },
  { id: 'move', label: 'Move' },
  { id: 'water', label: 'Water' },
  { id: 'customize', label: 'Opened Customize Today' },
  // Today's one line (0283): its links, and the days the hound said it.
  { id: 'line_steps', label: 'One line: steps link' },
  { id: 'line_fast', label: 'One line: fast link' },
  { id: 'line_games', label: 'One line: games link' },
  { id: 'line_starter', label: 'One line: first week link' },
  { id: 'line_streak', label: 'One line: streak link' },
  { id: 'line_hound', label: 'One line: hound link' },
  { id: 'line_spoken', label: 'One line: the hound said it' },
];

export function TodayAdminCard({ onChanged }: { onChanged?: (d: TodayOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<TodayOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useFocusEffect(
    useCallback(() => {
      if (!supabase) return;
      supabase.rpc('admin_today_overview').then(({ data: d, error: e }) => {
        if (e) {
          setError(/admin_today_overview/.test(e.message) ? 'Run 0278_today_prefs.sql first.' : e.message);
          return;
        }
        const raw = (d ?? {}) as any;
        const o: TodayOverview = {
          customized: Number(raw.customized ?? 0),
          saved: Number(raw.saved ?? 0),
          customized7d: Number(raw.customized_7d ?? 0),
          extras: Object.fromEntries(
            TODAY_EXTRAS.map((x) => x.id).map((k) => [k, Number(raw.extras?.[k] ?? 0)]),
          ) as Record<TodayExtra, number>,
          taps7d: Object.fromEntries(
            Object.entries<any>(raw.taps_7d ?? {}).map(([k, v]) => [k, { people: Number(v.people), taps: Number(v.taps) }]),
          ),
          tappedEver: Number(raw.tapped_ever ?? 0),
        };
        setData(o);
        setError(null);
        changed.current?.(o);
      });
    }, []),
  );

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Customize Today</Text>
      <Text style={styles.footNote}>
        Today opens on Your day, Needs you and your challenges. The extras are off for everyone until they turn one on (Customize Today at the
        bottom of Today, or Settings → Today).
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>With an extra on</Text>
            <Text style={styles.value}>
              {data.customized} · {data.saved} ever changed one · {data.customized7d} changed in 7 days
            </Text>
          </View>
          {TODAY_EXTRAS.map((x) => (
            <View key={x.id} style={styles.row}>
              <Text style={styles.label}>{x.label}</Text>
              <Text style={styles.value}>{data.extras[x.id]} on</Text>
            </View>
          ))}
          <Text style={[styles.label, { marginTop: 4 }]}>Your day and the one line, last 7 days ({data.tappedEver} have ever tapped)</Text>
          {TAPS.map((t) => {
            const v = data.taps7d[t.id] ?? { people: 0, taps: 0 };
            return (
              <View key={t.id} style={styles.row}>
                <Text style={styles.label}>{t.label}</Text>
                <Text style={styles.value}>
                  {v.people} {v.people === 1 ? 'person' : 'people'} · {v.taps} taps
                </Text>
              </View>
            );
          })}
        </>
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
