import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getHoopsOverview, setHoopsConfig, type HoopsConfig, type HoopsOverview } from '../challenges/hoopsApi';

// Admin → Hoops & H-O-R-S-E (0195, 0196): how they're played, and the
// Bones and bot steps, live for the next game to settle.
const FIELDS: { key: Exclude<keyof HoopsConfig, 'enabled'>; label: string; note: string; min: number; max: number }[] = [
  { key: 'win_bones', label: 'Winning', note: 'Each person on the winning side (or the H-O-R-S-E winner)', min: 0, max: 500 },
  { key: 'play_bones', label: 'Playing', note: 'Everyone who played a game to the end', min: 0, max: 500 },
  { key: 'bot_steps', label: 'Bot steps', note: 'What a Hoops bot walks a day (give or take 1,500)', min: 1000, max: 20000 },
];

export function HoopsAdminCard({ onChanged }: { onChanged?: (o: HoopsOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<HoopsOverview | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(() => {
    getHoopsOverview()
      .then((o) => {
        setData(o);
        setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, String(o.config[f.key])])));
        setError(null);
        changed.current?.(o);
      })
      .catch((e) =>
        setError(e instanceof Error && /admin_hoops_overview/.test(e.message) ? 'Run 0194, 0195 and 0196 to see these.' : e instanceof Error ? e.message : 'Could not load.'),
      );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const dirty = data ? FIELDS.some((f) => draft[f.key] !== String(data.config[f.key])) : false;

  const save = async (patch: Partial<HoopsConfig>) => {
    setSaving(true);
    try {
      await setHoopsConfig(patch);
      load();
    } catch (e) {
      Alert.alert('Hoops', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const saveNumbers = () => {
    const patch: Partial<HoopsConfig> = {};
    for (const f of FIELDS) {
      const n = Number(draft[f.key]);
      if (!Number.isFinite(n) || Math.round(n) !== n || n < f.min || n > f.max) {
        Alert.alert('Hoops', `${f.label}: a whole number from ${f.min.toLocaleString()} to ${f.max.toLocaleString()}.`);
        return;
      }
      patch[f.key] = n;
    }
    save(patch);
  };

  const stats: [string, string][] = data
    ? [
        ['Hoops on now', `${data.hoopsLive}`],
        ['Hoops started', `${data.hoops7d} this week · ${data.hoopsAll} ever`],
        ['People playing Hoops this week', `${data.players7d}`],
        ['Shots this week', `${data.shots7d.toLocaleString()} · ${data.dunks7d} dunks · ${data.onFire7d} on fire`],
        ['H-O-R-S-E on now', `${data.horseLive}`],
        ['H-O-R-S-E started', `${data.horse7d} this week · ${data.horseAll} ever`],
        ['Bones given this week', `${data.bones7d.toLocaleString()}`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Hoops &amp; H-O-R-S-E</Text>
      <Text style={styles.footNote}>Basketball on steps, a quarter a day, and the one-on-one letters game.</Text>
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
          <Text style={[styles.value, { paddingTop: 6 }]}>Bones and bots</Text>
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
