import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { supabase } from '../lib/supabase';
import { USE_CHOICES } from '../onboarding/UsesStep';

// Admin → Overview → Status → What people use Hound for (0272): the
// wizard's checkboxes, how many tick each, and how many of them have tried
// it and use it now (the last 7 days).

export interface UsesOverview {
  answered: number;
  answered30d: number;
  new30d: number;
  uses: Record<string, { ticked: number; tried: number; now: number }>;
  fastingTileWaiting: number;
}

export function usesSummary(d: UsesOverview): string {
  const top = Object.entries(d.uses)
    .sort((a, b) => b[1].ticked - a[1].ticked)
    .slice(0, 2)
    .map(([k, v]) => `${USE_CHOICES.find((c) => c.id === k)?.name ?? k} ${v.ticked}`);
  return `${d.answered} answered${top.length ? ` · ${top.join(' · ')}` : ''}`;
}

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '—');

export function UsesAdminCard({ onChanged }: { onChanged?: (d: UsesOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<UsesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useFocusEffect(
    useCallback(() => {
      if (!supabase) return;
      supabase
        .rpc('admin_uses_overview')
        .then(({ data: d, error: e }) => {
          if (e) {
            setError(/admin_uses_overview/.test(e.message) ? 'Run 0272_hound_uses_v2.sql first.' : e.message);
            return;
          }
          const o: UsesOverview = {
            answered: Number((d as any)?.answered ?? 0),
            answered30d: Number((d as any)?.answered_30d ?? 0),
            new30d: Number((d as any)?.new_30d ?? 0),
            uses: Object.fromEntries(
              Object.entries<any>((d as any)?.uses ?? {}).map(([k, v]) => [k, { ticked: Number(v.ticked), tried: Number(v.tried), now: Number(v.now) }]),
            ),
            fastingTileWaiting: Number((d as any)?.fasting_tile_waiting ?? 0),
          };
          setData(o);
          setError(null);
          changed.current?.(o);
        });
    }, []),
  );

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>What people use Hound for</Text>
      <Text style={styles.footNote}>
        The welcome wizard’s checkboxes (also in Settings). Tried: has ever done it. Now: did it in the last 7 days. Ticking Intermittent fasting
        puts Fasting in Your day on Today before a first fast.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Answered</Text>
            <Text style={styles.value}>
              {data.answered} · {data.answered30d} of {data.new30d} new in 30 days ({pct(data.answered30d, data.new30d)})
            </Text>
          </View>
          {USE_CHOICES.map((c) => {
            const u = data.uses[c.id] ?? { ticked: 0, tried: 0, now: 0 };
            return (
              <View key={c.id} style={styles.row}>
                <Text style={styles.label}>{c.name}</Text>
                <Text style={styles.value}>
                  {u.ticked} ticked · {u.tried} tried ({pct(u.tried, u.ticked)}) · {u.now} now ({pct(u.now, u.ticked)})
                </Text>
              </View>
            );
          })}
          <View style={styles.row}>
            <Text style={styles.label}>Fasting in Your day, waiting on a first fast</Text>
            <Text style={styles.value}>{data.fastingTileWaiting}</Text>
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
