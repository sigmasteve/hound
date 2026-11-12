import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import {
  clearMaintenance,
  getMaintenanceOverview,
  minutesBetween,
  readStatusFile,
  setMaintenance,
  setMaintenanceNow,
  whenLabel,
  type MaintenanceOverview,
} from '../maintenance/maintenance';

// Admin → Maintenance (0190): schedule a window before changing the
// server, so phones show the maintenance screen instead of "can't reach
// its server", and Today gives a heads-up from 6 hours before. "Maintenance
// now" shows the screen to everyone while the server is up.

export function maintenanceSummary(o: MaintenanceOverview): string {
  if (o.nowOn) return 'On now: everyone sees the maintenance screen';
  if (o.startsAt && o.endsAt && o.endsAt.getTime() > Date.now()) {
    return `${whenLabel(o.startsAt)} · ${minutesBetween(o.startsAt, o.endsAt)} min · ${o.seen} saw the heads-up`;
  }
  return 'Nothing scheduled';
}

const LENGTHS = [5, 10, 30, 60];

// "9", "9pm", "9:30 pm", "21:30" → hours and minutes.
function parseTime(s: string): { h: number; m: number } | null {
  const v = s.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!v) return null;
  let h = Number(v[1]);
  const m = Number(v[2] ?? 0);
  const ap = v[3];
  if (m > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap.startsWith('p') && h !== 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
  } else if (h > 23) return null;
  return { h, m };
}

export function MaintenanceAdminCard({ onChanged }: { onChanged?: (o: MaintenanceOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<MaintenanceOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('Making Hound faster.');
  const [day, setDay] = useState<0 | 1>(0);
  const [time, setTime] = useState('9:00 pm');
  const [length, setLength] = useState(10);
  const [saving, setSaving] = useState(false);
  const [statusFile, setStatusFile] = useState<string>('checking…');
  // A ref, so a new onChanged from the parent doesn't reload in a loop.
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(() => {
    getMaintenanceOverview()
      .then((o) => {
        setData(o);
        setError(null);
        changed.current?.(o);
        if (o.message) setMessage(o.message);
      })
      .catch((e) =>
        setError(e instanceof Error && /admin_maintenance_overview/.test(e.message) ? 'Run 0190_maintenance.sql to use this.' : e instanceof Error ? e.message : 'Could not load.'),
      );
    readStatusFile().then((f) => setStatusFile(!f ? 'couldn’t read it' : f.maintenance ? `maintenance${f.message ? `: “${f.message}”` : ''}` : 'normal'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const startsAt = useMemo(() => {
    const t = parseTime(time);
    if (!t) return null;
    const d = new Date();
    d.setDate(d.getDate() + day);
    d.setHours(t.h, t.m, 0, 0);
    return d;
  }, [day, time]);

  const run = async (fn: () => Promise<void>) => {
    setSaving(true);
    try {
      await fn();
      load();
    } catch (e) {
      Alert.alert('Maintenance', e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const scheduled = data?.startsAt && data.endsAt && data.endsAt.getTime() > Date.now() ? data : null;

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Maintenance</Text>
      <Text style={styles.footNote}>
        Before changing the server: schedule it here. Today shows a heads-up from 6 hours before, and during the window phones that can’t reach Hound
        show the maintenance screen instead of “can’t reach its server”.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          {scheduled && (
            <View style={styles.current}>
              <Text style={styles.currentTitle}>
                Scheduled: {whenLabel(scheduled.startsAt!)} · {minutesBetween(scheduled.startsAt!, scheduled.endsAt!)} min
              </Text>
              {!!scheduled.message && <Text style={styles.footNote}>“{scheduled.message}”</Text>}
              <Text style={styles.footNote}>{scheduled.seen} {scheduled.seen === 1 ? 'person has' : 'people have'} seen the heads-up</Text>
            </View>
          )}
          <TextField label="Message" value={message} onChangeText={setMessage} maxLength={200} placeholder="Making Hound faster." />
          <Text style={styles.label}>Starts</Text>
          <View style={styles.chips}>
            {(['Today', 'Tomorrow'] as const).map((l, i) => (
              <Pressable key={l} onPress={() => setDay(i as 0 | 1)} style={[styles.chip, day === i && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: day === i }}>
                <Text style={styles.chipText}>{l}</Text>
              </Pressable>
            ))}
          </View>
          <TextField label="At (your time)" value={time} onChangeText={setTime} placeholder="9:00 pm" autoCapitalize="none" error={startsAt ? undefined : 'Like 9:00 pm or 21:00'} />
          <Text style={styles.label}>How long (minutes)</Text>
          <View style={styles.chips}>
            {LENGTHS.map((n) => (
              <Pressable key={n} onPress={() => setLength(n)} style={[styles.chip, length === n && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: length === n }}>
                <Text style={styles.chipText}>{n}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.buttons}>
            <View style={{ flex: 1 }}>
              <Button
                label={scheduled ? 'Save changes' : 'Save schedule'}
                variant="primary"
                block
                onPress={saving || !startsAt ? undefined : () => run(() => setMaintenance(message, startsAt!, length))}
              />
            </View>
            {scheduled && <Button label="Cancel it" variant="ghost" onPress={saving ? undefined : () => run(clearMaintenance)} />}
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.value}>Maintenance now</Text>
              <Text style={styles.footNote}>Everyone sees the maintenance screen, even while the server is up. Admins can continue past it.</Text>
            </View>
            <Switch
              value={data.nowOn}
              disabled={saving}
              onValueChange={(on) =>
                on
                  ? Alert.alert('Maintenance now?', 'Everyone (except admins) sees the maintenance screen until you turn it off.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Turn on', style: 'destructive', onPress: () => run(() => setMaintenanceNow(true)) },
                    ])
                  : run(() => setMaintenanceNow(false))
              }
              trackColor={{ true: colors.amber }}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Website status file (houndchallenge.net/status.json)</Text>
            <Text style={styles.value}>{statusFile}</Text>
            <Text style={styles.footNote}>For phones that never saw the schedule. Ask Claude: “maintenance on, back by 9:10”, and merge the PR.</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Heads-up seen, all windows</Text>
            <Text style={styles.value}>
              {data.seenAll} times over {data.windows} {data.windows === 1 ? 'window' : 'windows'}
            </Text>
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
    current: { borderRadius: 12, padding: 12, gap: 4, backgroundColor: withAlpha(colors.amber, 0.12) },
    currentTitle: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    chip: {
      minWidth: 56,
      minHeight: 40,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.15),
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipOn: { borderColor: colors.accent, borderWidth: 1.5, backgroundColor: withAlpha(colors.accent, 0.12) },
    chipText: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    buttons: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
    row: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
  });
}
