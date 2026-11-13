import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getGolfOverview, setGolfConfig, type GolfConfig, type GolfOverview } from '../challenges/golfApi';
import { golfCourseName } from '../challenges/golf';

// Admin → Golf (0200): how it's played, and the numbers behind the
// banks and the Bones, live for the next shot or settle.
const FIELDS: { key: Exclude<keyof GolfConfig, 'enabled'>; label: string; note: string; min: number; max: number }[] = [
  { key: 'steps_per_yard', label: 'Steps a yard', note: 'Steps that bank one yard (10: a 250-yard drive is 2,500 steps)', min: 1, max: 100 },
  { key: 'strength_mult', label: 'Strength', note: 'Power for each minute of strength training', min: 0, max: 10 },
  { key: 'golf_mult', label: 'Golf', note: 'Power for each minute of a golf workout', min: 0, max: 10 },
  { key: 'other_mult', label: 'Other workouts', note: 'Power for each minute of anything else', min: 0, max: 10 },
  { key: 'max_power', label: 'Most power a shot', note: 'The top power chip, in % extra carry', min: 0, max: 100 },
  { key: 'skin_bones', label: 'A skin', note: 'Bones for winning a hole in Skins', min: 0, max: 500 },
  { key: 'win_bones', label: 'Winning', note: 'The winner of a round', min: 0, max: 500 },
  { key: 'play_bones', label: 'Playing', note: 'Everyone who finished the round', min: 0, max: 500 },
];

export function GolfAdminCard({ onChanged }: { onChanged?: (o: GolfOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<GolfOverview | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(() => {
    getGolfOverview()
      .then((o) => {
        setData(o);
        setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, String(o.config[f.key])])));
        setError(null);
        changed.current?.(o);
      })
      .catch((e) =>
        setError(e instanceof Error && /admin_golf_overview/.test(e.message) ? 'Run 0199, 0200 and 0201 to see these.' : e instanceof Error ? e.message : 'Could not load.'),
      );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const dirty = data ? FIELDS.some((f) => draft[f.key] !== String(data.config[f.key])) : false;

  const save = async (patch: Partial<GolfConfig>) => {
    setSaving(true);
    try {
      await setGolfConfig(patch);
      load();
    } catch (e) {
      Alert.alert('Golf', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const saveNumbers = () => {
    const patch: Partial<GolfConfig> = {};
    for (const f of FIELDS) {
      const n = Number(draft[f.key]);
      if (!Number.isFinite(n) || Math.round(n) !== n || n < f.min || n > f.max) {
        Alert.alert('Golf', `${f.label}: a whole number from ${f.min.toLocaleString()} to ${f.max.toLocaleString()}.`);
        return;
      }
      patch[f.key] = n;
    }
    save(patch);
  };

  const stats: [string, string][] = data
    ? [
        ['Games on now', `${data.gamesLive}`],
        ['Games started', `${data.games7d} this week · ${data.gamesAll} ever`],
        ['People playing this week', `${data.players7d}`],
        ['Shots this week', `${data.shots7d.toLocaleString()} · ${data.holes7d} holes finished`],
        ['Birdies this week', `${data.birdies7d} · ${data.eagles7d} eagles · ${data.holeInOnesAll} ${data.holeInOnesAll === 1 ? 'hole' : 'holes'} in one ever`],
        ['Average to par a hole', data.avgToPar7d == null ? '–' : `${data.avgToPar7d > 0 ? '+' : ''}${data.avgToPar7d.toFixed(2)}`],
        [
          'The Hound Open',
          data.open
            ? `${data.open.live} on now · ${data.open.players.toLocaleString()} playing · ${data.open.finished.toLocaleString()} finished · ${data.open.gamesAll} ever`
            : 'None yet',
        ],
        ['Taking their own shots', data.handsOnShare == null ? '–' : `${Math.round(data.handsOnShare * 100)}% of players`],
        ['Spent this week', `${data.yardsSpent7d.toLocaleString()} yards · ${data.powerSpent7d.toLocaleString()} power`],
        [
          'Courses',
          Object.entries(data.byCourse).length
            ? Object.entries(data.byCourse)
                .map(([k, n]) => `${golfCourseName(k)} ${n}`)
                .join(' · ')
            : 'None yet',
        ],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Golf</Text>
      <Text style={styles.footNote}>Steps bank yards, workouts bank power, and you take every shot.</Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.value}>New games can be made</Text>
              <Text style={styles.label}>Off: new games can’t be set up. Games on now play to the end.</Text>
            </View>
            <Switch value={data.config.enabled} disabled={saving} onValueChange={(v) => save({ enabled: v })} trackColor={{ true: colors.accent }} />
          </View>
          {stats.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value}>{value}</Text>
            </View>
          ))}
          <Text style={[styles.value, { paddingTop: 6 }]}>Banks and Bones</Text>
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
                maxLength={4}
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

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    row: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    field: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
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
