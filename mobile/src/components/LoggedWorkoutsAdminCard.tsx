import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import {
  blockWorkoutLogging,
  getWorkoutLogOverview,
  loggedTypeLabel,
  setWorkoutLogConfig,
  type WorkoutLogConfig,
  type WorkoutLogOverview,
} from '../workouts/loggedWorkouts';

// Admin → Logged workouts (0204): how many people log workouts by hand,
// who's worth a look (at the limit most days, or a walk with almost no
// steps), turning logging off for one person, and the rules.
type NumKey = Exclude<keyof WorkoutLogConfig, 'enabled' | 'value_pct'>;
const FIELDS: { key: NumKey; label: string; note: string; min: number; max: number }[] = [
  { key: 'per_day', label: 'A day', note: 'Workouts someone can log in a day', min: 0, max: 5 },
  { key: 'min_min', label: 'Shortest', note: 'Minutes', min: 1, max: 60 },
  { key: 'max_min', label: 'Longest', note: 'Minutes', min: 10, max: 240 },
  { key: 'back_days', label: 'How far back', note: '1 = today or yesterday, 0 = today only', min: 0, max: 1 },
  { key: 'new_account_days', label: 'New accounts wait', note: 'Days before a new account can log', min: 0, max: 60 },
  { key: 'undo_minutes', label: 'Undo for', note: 'Minutes after logging', min: 0, max: 60 },
];
const VALUES: { pct: number; label: string }[] = [
  { pct: 0, label: 'None' },
  { pct: 50, label: 'Half' },
  { pct: 100, label: 'Full' },
];

export function LoggedWorkoutsAdminCard({ onChanged }: { onChanged?: (o: WorkoutLogOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<WorkoutLogOverview | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(() => {
    getWorkoutLogOverview()
      .then((o) => {
        setData(o);
        setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, String(o.config[f.key])])));
        setError(null);
        changed.current?.(o);
      })
      .catch((e) =>
        setError(
          e instanceof Error && /admin_workout_log_overview/.test(e.message)
            ? 'Run 0204_logged_workouts.sql to see these.'
            : e instanceof Error
              ? e.message
              : 'Could not load.',
        ),
      );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const save = async (patch: Partial<WorkoutLogConfig>) => {
    setSaving(true);
    try {
      await setWorkoutLogConfig(patch);
      load();
    } catch (e) {
      Alert.alert('Logged workouts', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const dirty = data ? FIELDS.some((f) => draft[f.key] !== String(data.config[f.key])) : false;
  const saveNumbers = () => {
    const patch: Partial<WorkoutLogConfig> = {};
    for (const f of FIELDS) {
      const n = Number(draft[f.key]);
      if (!Number.isFinite(n) || Math.round(n) !== n || n < f.min || n > f.max) {
        Alert.alert('Logged workouts', `${f.label}: a whole number from ${f.min} to ${f.max}.`);
        return;
      }
      patch[f.key] = n;
    }
    save(patch);
  };

  const block = (userId: string, name: string, on: boolean) => {
    const go = async () => {
      try {
        await blockWorkoutLogging(userId, on);
        load();
      } catch (e) {
        Alert.alert('Logged workouts', e instanceof Error ? e.message : 'Try again.');
      }
    };
    if (!on) {
      go();
      return;
    }
    Alert.alert('Turn off logging?', `${name} won’t be able to log workouts by hand. Workouts from a watch or their phone still count.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Turn off', style: 'destructive', onPress: go },
    ]);
  };

  const byType = data
    ? Object.entries(data.byType)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${loggedTypeLabel(k)} ${n}`)
        .join(' · ')
    : '';

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Logged workouts</Text>
      <Text style={styles.footNote}>
        For people without a watch. A logged workout counts in full for goals, Doors and streaks, and at the value below in the sports games,
        Golf power and Global prizes. Never steps or miles.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={styles.tiles}>
            <Tile value={String(data.people7d)} label="people logging" styles={styles} />
            <Tile value={String(data.logs7d)} label="workouts logged" styles={styles} />
            <Tile value={`${Math.round(data.share7d * 100)}%`} label="of all workouts" styles={styles} />
          </View>
          <Text style={styles.label}>
            This week · {data.minutes7d.toLocaleString()} min · {data.undone7d} undone · {data.replaced7d} replaced by a watch
          </Text>
          {byType ? <Text style={styles.label}>Most logged: {byType}</Text> : null}

          <Text style={[styles.value, { paddingTop: 6 }]}>Worth a look</Text>
          {data.flagged.length === 0 && <Text style={styles.label}>No one right now.</Text>}
          {data.flagged.map((f) => (
            <View key={f.userId + f.why} style={styles.personRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.value}>{f.name}</Text>
                <Text style={styles.label}>{f.blocked ? 'Logging turned off for them' : f.why}</Text>
              </View>
              <Pressable
                onPress={() => block(f.userId, f.name, !f.blocked)}
                style={[styles.blockBtn, f.blocked ? styles.unblockBtn : null]}
                accessibilityRole="button"
              >
                <Text style={[styles.blockText, f.blocked ? styles.unblockText : null]}>{f.blocked ? 'Turn back on' : 'Turn off logging'}</Text>
              </Pressable>
            </View>
          ))}
          {data.blocked.filter((b) => !data.flagged.some((f) => f.userId === b.userId)).length > 0 && (
            <>
              <Text style={[styles.value, { paddingTop: 6 }]}>Logging off</Text>
              {data.blocked
                .filter((b) => !data.flagged.some((f) => f.userId === b.userId))
                .map((b) => (
                  <View key={b.userId} style={styles.personRow}>
                    <Text style={[styles.value, { flex: 1 }]}>{b.name}</Text>
                    <Pressable onPress={() => block(b.userId, b.name, false)} style={[styles.blockBtn, styles.unblockBtn]} accessibilityRole="button">
                      <Text style={[styles.blockText, styles.unblockText]}>Turn back on</Text>
                    </Pressable>
                  </View>
                ))}
            </>
          )}

          <Text style={[styles.value, { paddingTop: 6 }]}>Settings</Text>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.value}>Logging is on</Text>
              <Text style={styles.label}>Off: nobody can log a new one. Ones already logged stay.</Text>
            </View>
            <Switch value={data.config.enabled} disabled={saving} onValueChange={(v) => save({ enabled: v })} trackColor={{ true: colors.accent }} />
          </View>
          <View style={styles.field}>
            <View style={{ flex: 1 }}>
              <Text style={styles.value}>Worth in games and prizes</Text>
              <Text style={styles.label}>For workouts logged from now on</Text>
            </View>
            <View style={styles.segment}>
              {VALUES.map((v) => {
                const on = data.config.value_pct === v.pct;
                return (
                  <Pressable
                    key={v.pct}
                    disabled={saving}
                    onPress={() => save({ value_pct: v.pct })}
                    style={[styles.segBtn, on && styles.segOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.segText, on && styles.segTextOn]}>{v.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {FIELDS.map((f) => (
            <View key={f.key} style={styles.field}>
              <View style={{ flex: 1 }}>
                <Text style={styles.value}>{f.label}</Text>
                <Text style={styles.label}>{f.note}</Text>
              </View>
              <TextInput
                style={styles.input}
                value={draft[f.key] ?? ''}
                onChangeText={(v) => setDraft((d) => ({ ...d, [f.key]: v.replace(/[^0-9]/g, '') }))}
                keyboardType="number-pad"
                maxLength={3}
                accessibilityLabel={f.label}
              />
            </View>
          ))}
          <Button label={saving ? 'Saving…' : 'Save'} variant="primary" block onPress={dirty && !saving ? saveNumbers : undefined} disabled={!dirty || saving} />
        </>
      )}
    </Card>
  );
}

function Tile({ value, label, styles }: { value: string; label: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    tiles: { flexDirection: 'row', gap: 8 },
    tile: { flex: 1, borderRadius: 12, padding: 10, backgroundColor: withAlpha(colors.text, 0.05) },
    tileValue: { fontFamily: font.headingSemibold, fontSize: 18, color: colors.text },
    personRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.07),
    },
    blockBtn: { minHeight: 36, borderRadius: 9, paddingHorizontal: 10, justifyContent: 'center', backgroundColor: 'rgba(229,72,77,0.18)' },
    unblockBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: withAlpha(colors.text, 0.18) },
    blockText: { fontFamily: font.headingSemibold, fontSize: 12, color: '#ff8a8f' },
    unblockText: { color: colors.text },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.07),
    },
    segment: { flexDirection: 'row', gap: 4, backgroundColor: withAlpha(colors.text, 0.06), borderRadius: 10, padding: 3 },
    segBtn: { minHeight: 34, minWidth: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
    segOn: { backgroundColor: colors.text },
    segText: { fontFamily: font.headingSemibold, fontSize: 12.5, color: withAlpha(colors.text, 0.75) },
    segTextOn: { color: colors.bg },
    input: {
      width: 84,
      minHeight: 40,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.18),
      paddingHorizontal: 10,
      textAlign: 'right',
      fontFamily: font.headingSemibold,
      fontSize: 15,
      color: colors.text,
      backgroundColor: colors.bg,
    },
  });
}
