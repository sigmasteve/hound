import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { supabase } from '../lib/supabase';
import { CHALLENGE_TYPES } from '../data/sampleData';

// Admin → Overview → Status → Up next (0279): Today's one next turn and
// Play your turns (games one after another), and who quiets which
// challenges. Quieting a lot of one kind says it nags.

export interface UpNextOverview {
  taps: Record<string, { people: number; n: number }>;
  playedEver: number;
  quietPeople: number;
  quietChallenges: number;
  quietKinds: Record<string, number>;
}

export function upNextSummary(d: UpNextOverview): string {
  const played = d.taps.play_start?.people ?? 0;
  return `${played} played their turns this week · ${d.quietChallenges} quieted`;
}

const ROWS: { id: string; label: string; unit: string }[] = [
  { id: 'upnext', label: 'Tapped a turn’s button (or Play your turns)', unit: 'taps' },
  { id: 'play_start', label: 'Started Play your turns', unit: 'runs' },
  { id: 'play_turn', label: 'Games opened from it', unit: 'games' },
  { id: 'play_done', label: 'Played to the end', unit: 'runs' },
  { id: 'play_stop', label: 'Stopped part way', unit: 'runs' },
];

export function UpNextAdminCard({ onChanged }: { onChanged?: (d: UpNextOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<UpNextOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useFocusEffect(
    useCallback(() => {
      if (!supabase) return;
      supabase.rpc('admin_upnext_overview').then(({ data: d, error: e }) => {
        if (e) {
          setError(/admin_upnext_overview/.test(e.message) ? 'Run 0279_up_next.sql first.' : e.message);
          return;
        }
        const raw = (d ?? {}) as any;
        const o: UpNextOverview = {
          taps: Object.fromEntries(Object.entries<any>(raw.taps_7d ?? {}).map(([k, v]) => [k, { people: Number(v.people), n: Number(v.n) }])),
          playedEver: Number(raw.played_ever ?? 0),
          quietPeople: Number(raw.quiet_people ?? 0),
          quietChallenges: Number(raw.quiet_challenges ?? 0),
          quietKinds: Object.fromEntries(Object.entries<any>(raw.quiet_kinds ?? {}).map(([k, v]) => [k, Number(v)])),
        };
        setData(o);
        setError(null);
        changed.current?.(o);
      });
    }, []),
  );

  const kindName = (k: string) => CHALLENGE_TYPES.find((t) => t.id === k)?.name ?? k;

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Up next</Text>
      <Text style={styles.footNote}>
        Today shows the one most urgent turn (live-clock games first) and Play your turns, which opens each waiting game one after another.
        Last 7 days.
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
            <Text style={styles.label}>Have ever played their turns</Text>
            <Text style={styles.value}>{data.playedEver}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Quiet this one (running challenges)</Text>
            <Text style={styles.value}>
              {data.quietChallenges} quieted by {data.quietPeople} {data.quietPeople === 1 ? 'person' : 'people'}
            </Text>
            {Object.keys(data.quietKinds).length > 0 && (
              <Text style={styles.label}>
                {Object.entries(data.quietKinds)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, n]) => `${kindName(k)} ${n}`)
                  .join(' · ')}
              </Text>
            )}
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
