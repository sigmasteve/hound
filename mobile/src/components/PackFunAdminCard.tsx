import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getPackFunOverview, setPackFunConfig, type PackFunConfig, type PackFunOverview } from '../packFun/packFunApi';

// Admin → Pack Fun (0192): how it's used, and the Bones it gives. Every
// amount here is live for the next award; the daily cap is per person
// over the last 24 hours, across every Pack Fun.
const FIELDS: { key: keyof PackFunConfig; label: string; note: string; max: number }[] = [
  { key: 'daily_cap', label: 'Daily cap', note: 'Most Bones one person can get from Pack Fun in 24 hours', max: 5000 },
  { key: 'trail_first_bones', label: 'Scent trail, first right', note: 'Whoever solves it first', max: 500 },
  { key: 'trail_answer_bones', label: 'Scent trail, right after', note: 'Each right answer after the first', max: 500 },
  { key: 'flash_win_bones', label: 'Dash win', note: 'Most steps in a Dash', max: 500 },
  { key: 'push_bonus_bones', label: 'Pack push made', note: 'Each person, when the pack hits the total', max: 500 },
  { key: 'finish_bonus_bones', label: 'Finishing', note: 'Each person with enough steps at the end', max: 500 },
  { key: 'bone_find_bones', label: 'Bone on the map', note: 'Walking to one and picking it up', max: 500 },
  { key: 'finish_min_steps', label: 'Steps to finish', note: 'Steps needed for the finishing Bones', max: 50000 },
  { key: 'trail_every_steps', label: 'Scent trail every', note: 'Pack steps between puzzles', max: 50000 },
  { key: 'trail_minutes', label: 'Scent trail open for', note: 'Minutes to answer', max: 30 },
];

export function PackFunAdminCard({ onChanged }: { onChanged?: (o: PackFunOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<PackFunOverview | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(() => {
    getPackFunOverview()
      .then((o) => {
        setData(o);
        setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, String(o.config[f.key] ?? '')])));
        setError(null);
        changed.current?.(o);
      })
      .catch((e) =>
        setError(e instanceof Error && /admin_pack_fun_overview/.test(e.message) ? 'Run 0192_pack_fun.sql to see these.' : e instanceof Error ? e.message : 'Could not load.'),
      );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const dirty = data ? FIELDS.some((f) => draft[f.key] !== String(data.config[f.key] ?? '')) : false;

  const save = async (patch: Partial<PackFunConfig>) => {
    setSaving(true);
    try {
      await setPackFunConfig(patch);
      load();
    } catch (e) {
      Alert.alert('Pack Fun', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const saveAmounts = () => {
    const patch: Record<string, number> = {};
    for (const f of FIELDS) {
      const n = Number(draft[f.key]);
      if (!Number.isFinite(n) || n < 0 || n > f.max || Math.round(n) !== n) {
        Alert.alert('Pack Fun', `${f.label}: a whole number from 0 to ${f.max.toLocaleString()}.`);
        return;
      }
      if (f.key === 'trail_every_steps' && n < 200) {
        Alert.alert('Pack Fun', 'Scent trails: at least 200 pack steps apart.');
        return;
      }
      if (f.key === 'trail_minutes' && n < 1) {
        Alert.alert('Pack Fun', 'Scent trails need at least a minute to answer.');
        return;
      }
      patch[f.key] = n;
    }
    save(patch as Partial<PackFunConfig>);
  };

  const stats: [string, string][] = data
    ? [
        ['Live right now', `${data.liveNow}`],
        ['Started this week', `${data.started7d} · ${data.startedAll} ever`],
        ['People this week', `${data.people7d} · ${data.peopleAll} ever · ${data.avgPack.toFixed(1)} per pack`],
        ['With the live map', `${data.withMap7d} this week`],
        ['Scent trails this week', `${data.trails7d} · ${data.trailsSolved7d} solved`],
        ['Flash challenges this week', `${data.flashes7d}`],
        ['Map bones picked up', `${data.bonesFound7d} this week`],
        ['Bones given this week', `${data.bonesGiven7d.toLocaleString()}`],
        ['Held back by the cap', `${data.bonesCapped7d.toLocaleString()} Bones · ${data.peopleAtCap7d} ${data.peopleAtCap7d === 1 ? 'person' : 'people'} hit it`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Pack Fun</Text>
      <Text style={styles.footNote}>
        Live sessions for groups out together. Bones only start once two people have joined, and nobody gets more than the daily cap from Pack Fun in 24 hours.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.value}>Pack Fun is on</Text>
              <Text style={styles.label}>Off: nobody can start a new one. Live ones carry on.</Text>
            </View>
            <Switch value={data.config.enabled} disabled={saving} onValueChange={(v) => save({ enabled: v })} trackColor={{ true: colors.accent }} />
          </View>
          {stats.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value}>{value}</Text>
            </View>
          ))}
          <Text style={[styles.value, { paddingTop: 6 }]}>Bones and timing</Text>
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
                maxLength={5}
                accessibilityLabel={f.label}
              />
            </View>
          ))}
          <Button label={saving ? 'Saving…' : 'Save'} variant="primary" block onPress={dirty && !saving ? saveAmounts : undefined} disabled={!dirty || saving} />
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
