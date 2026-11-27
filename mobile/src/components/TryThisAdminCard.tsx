import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { supabase } from '../lib/supabase';

// Admin → Overview → Status → Try this (0281): Today's one-at-a-time
// Global challenge (shown, See it, Join, Not now) and your hound's strip.

export interface TryThisOverview {
  taps: Record<string, { people: number; n: number }>;
  steppedAside: number;
  joinedGlobal7d: number;
  houndTop: number;
}

export function tryThisSummary(d: TryThisOverview): string {
  const seen = d.taps.try_seen?.people ?? 0;
  const joined = d.taps.try_join?.people ?? 0;
  return `${seen} saw it this week · ${joined} joined from it`;
}

const ROWS: { id: string; label: string; unit: string }[] = [
  { id: 'try_seen', label: 'Saw Try this', unit: 'days' },
  { id: 'try_open', label: 'Tapped See it', unit: 'taps' },
  { id: 'try_join', label: 'Tapped Join', unit: 'taps' },
  { id: 'try_dismiss', label: 'Tapped Not now', unit: 'taps' },
  { id: 'hound_strip', label: 'Tapped the hound strip', unit: 'taps' },
];

export function TryThisAdminCard({ onChanged }: { onChanged?: (d: TryThisOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<TryThisOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useFocusEffect(
    useCallback(() => {
      if (!supabase) return;
      supabase.rpc('admin_try_this_overview').then(({ data: d, error: e }) => {
        if (e) {
          setError(/admin_try_this_overview/.test(e.message) ? 'Run 0281_try_this.sql first.' : e.message);
          return;
        }
        const raw = (d ?? {}) as any;
        const o: TryThisOverview = {
          taps: Object.fromEntries(Object.entries<any>(raw.taps_7d ?? {}).map(([k, v]) => [k, { people: Number(v.people), n: Number(v.n) }])),
          steppedAside: Number(raw.stepped_aside ?? 0),
          joinedGlobal7d: Number(raw.joined_global_7d ?? 0),
          houndTop: Number(raw.hound_top ?? 0),
        };
        setData(o);
        setError(null);
        changed.current?.(o);
      });
    }, []),
  );

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Try this & your hound</Text>
      <Text style={styles.footNote}>
        Today shows one Global challenge at a time (kinds people haven’t played first), and your hound as a strip at the bottom. Last 7 days.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          {ROWS.map((r) => {
            const v = data.taps[r.id] ?? { people: 0, n: 0 };
            return (
              <View key={r.id} style={styles.row}>
                <Text style={styles.label}>{r.label}</Text>
                <Text style={styles.value}>
                  {v.people} {v.people === 1 ? 'person' : 'people'} · {v.n} {r.unit}
                </Text>
              </View>
            );
          })}
          <View style={styles.row}>
            <Text style={styles.label}>Joined any Global (from anywhere)</Text>
            <Text style={styles.value}>{data.joinedGlobal7d}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Stepped aside for a week (three Not nows)</Text>
            <Text style={styles.value}>{data.steppedAside}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Have their hound at the top</Text>
            <Text style={styles.value}>{data.houndTop}</Text>
          </View>
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
