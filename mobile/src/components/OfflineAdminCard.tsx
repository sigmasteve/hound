import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { supabase } from '../lib/supabase';
import { refreshOfflineEnabled } from '../offline/offlineConfig';

// Admin → Overview → Status → Offline mode (0271): the switch (off by
// default), how much a day can be timed offline, and how syncing went
// this week: what came in late, how late, and what a rule turned down.

export interface OfflineOverview {
  enabled: boolean;
  houndCapMin: number;
  ops7d: number;
  people7d: number;
  byOp7d: Record<string, number>;
  lateOps7d: number;
  medianLateMin: number | null;
  overHour7d: number;
  offlineSessions7d: number;
  failures7d: number;
  topFailures: { message: string; n: number }[];
}

const OP_NAME: Record<string, string> = {
  move_offline_session: 'sessions',
  log_workout: 'logged workouts',
  fasting_start: 'fast starts',
  fasting_end: 'fast ends',
  log_water: 'water',
};

export function offlineSummary(d: OfflineOverview): string {
  return d.enabled ? `On · ${d.lateOps7d} synced late this week${d.failures7d ? ` · ${d.failures7d} turned down` : ''}` : 'Off';
}

async function rpc(fn: string, args: Record<string, unknown> = {}): Promise<any> {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export function OfflineAdminCard({ onChanged }: { onChanged?: (d: OfflineOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<OfflineOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cap, setCap] = useState('180');
  const [busy, setBusy] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(() => {
    rpc('admin_offline_overview')
      .then((d: any) => {
        const o: OfflineOverview = {
          enabled: !!d?.enabled,
          houndCapMin: Number(d?.hound_cap_min ?? 180),
          ops7d: Number(d?.ops_7d ?? 0),
          people7d: Number(d?.people_7d ?? 0),
          byOp7d: d?.by_op_7d ?? {},
          lateOps7d: Number(d?.late_ops_7d ?? 0),
          medianLateMin: d?.median_late_min == null ? null : Number(d.median_late_min),
          overHour7d: Number(d?.over_hour_7d ?? 0),
          offlineSessions7d: Number(d?.offline_sessions_7d ?? 0),
          failures7d: Number(d?.failures_7d ?? 0),
          topFailures: (d?.top_failures ?? []).map((f: any) => ({ message: String(f.message), n: Number(f.n) })),
        };
        setData(o);
        setCap(String(o.houndCapMin));
        setError(null);
        changed.current?.(o);
      })
      .catch((e) =>
        setError(e instanceof Error && /admin_offline_overview/.test(e.message) ? 'Run 0271_offline_sync.sql first.' : e instanceof Error ? e.message : 'Could not load.'),
      );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await rpc('admin_set_offline_config', { p: patch });
      await refreshOfflineEnabled();
      load();
    } catch (e) {
      Alert.alert('Couldn’t save that', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const rows: [string, string, boolean?][] = data
    ? [
        [
          'Synced, 7 days',
          `${data.ops7d} from ${data.people7d} ${data.people7d === 1 ? 'person' : 'people'}${
            Object.keys(data.byOp7d).length
              ? ': ' +
                Object.entries(data.byOp7d)
                  .map(([k, n]) => `${n} ${OP_NAME[k] ?? k}`)
                  .join(' · ')
              : ''
          }`,
        ],
        [
          'Came in late (done offline)',
          data.lateOps7d ? `${data.lateOps7d} · median ${data.medianLateMin ?? '—'} min late · ${data.overHour7d} over an hour` : '0',
        ],
        ['Sessions timed offline, 7 days', `${data.offlineSessions7d}`],
        [
          'Turned down by a rule, 7 days',
          data.failures7d ? `${data.failures7d}: ${data.topFailures.map((f) => `${f.message} (${f.n})`).join(' · ')}` : '0',
          data.failures7d > 0,
        ],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Offline mode</Text>
      <Text style={styles.footNote}>
        With no connection, routines, strength logs, Log a workout, fasting and water save on the phone and sync when it’s back; Today, Move and
        Fasting show what they last loaded. A blip doesn’t count: offline means the server didn’t answer for about 10 seconds. Things already waiting
        still sync if it’s turned off.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.value}>Offline mode on</Text>
              <Text style={styles.label}>Phones pick this up when they next open the app.</Text>
            </View>
            <Switch
              value={data.enabled}
              disabled={busy}
              onValueChange={(v) => save({ enabled: v })}
              trackColor={{ true: colors.accent, false: withAlpha(colors.text, 0.2) }}
            />
          </View>
          <TextField label="Minutes a day that can be timed offline" value={cap} onChangeText={setCap} keyboardType="number-pad" />
          <Button
            label="Save minutes"
            small
            disabled={busy || cap === String(data.houndCapMin)}
            onPress={() => {
              const n = Number(cap);
              if (!Number.isInteger(n) || n < 0 || n > 1440) {
                Alert.alert('Minutes', 'Enter whole minutes from 0 to 1,440.');
                return;
              }
              save({ hound_cap_min: n });
            }}
          />
          {rows.map(([label, value, warn]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.label}>{label}</Text>
              <Text style={[styles.value, warn && { color: colors.amber }]}>{value}</Text>
            </View>
          ))}
        </>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    row: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
  });
}
