import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getSportBonusOverview, setSportBonusConfig, type SportBonusOverview } from '../challenges/sportBonusApi';
import type { SportBonusConfig } from '../challenges/sportBonus';

// Admin → Sports bonuses (0198): strength workouts and game days in the
// six sports games, how often they're used, and the numbers behind them.
// The make chance is stored as a share (0.08) and edited as a percent.
type NumKey = Exclude<keyof SportBonusConfig, 'enabled'>;
const FIELDS: { key: NumKey; label: string; note: string; min: number; max: number; percent?: boolean }[] = [
  { key: 'strength_first_min', label: 'First strength bonus', note: 'Minutes of strength for the first bonus', min: 5, max: 120 },
  { key: 'strength_extra_min', label: 'Each bonus after', note: 'Minutes more for each one after that', min: 5, max: 120 },
  { key: 'strength_max', label: 'Most strength bonuses', note: 'A day, per person', min: 0, max: 5 },
  { key: 'game_day_min', label: 'Game day', note: 'Minutes of the game’s own sport', min: 5, max: 180 },
  { key: 'game_day_make', label: 'Game day boost', note: 'Percent added to the make, hit or on-target chance', min: 0, max: 30, percent: true },
  { key: 'horse_strength_steps', label: 'H-O-R-S-E: strength', note: 'Steps each strength bonus counts for', min: 0, max: 10000 },
  { key: 'horse_game_day_steps', label: 'H-O-R-S-E: game day', note: 'Steps a basketball game day counts for', min: 0, max: 15000 },
];

const SPORT_NAMES: Record<string, string> = { basketball: 'Basketball', soccer: 'Soccer', baseball: 'Baseball', cricket: 'Cricket', racquet: 'Racquet sports' };

export function SportBonusAdminCard({ onChanged }: { onChanged?: (o: SportBonusOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<SportBonusOverview | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const shown = (cfg: SportBonusConfig, f: (typeof FIELDS)[number]) => String(f.percent ? Math.round(cfg[f.key] * 100) : cfg[f.key]);

  const load = useCallback(() => {
    getSportBonusOverview()
      .then((o) => {
        setData(o);
        setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, shown(o.config, f)])));
        setError(null);
        changed.current?.(o);
      })
      .catch((e) =>
        setError(e instanceof Error && /admin_sport_bonus_overview/.test(e.message) ? 'Run 0198_sport_bonuses.sql to see these.' : e instanceof Error ? e.message : 'Could not load.'),
      );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const dirty = data ? FIELDS.some((f) => draft[f.key] !== shown(data.config, f)) : false;

  const save = async (patch: Partial<SportBonusConfig>) => {
    setSaving(true);
    try {
      await setSportBonusConfig(patch);
      load();
    } catch (e) {
      Alert.alert('Sports bonuses', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const saveNumbers = () => {
    const patch: Partial<SportBonusConfig> = {};
    for (const f of FIELDS) {
      const n = Number(draft[f.key]);
      if (!Number.isFinite(n) || Math.round(n) !== n || n < f.min || n > f.max) {
        Alert.alert('Sports bonuses', `${f.label}: a whole number from ${f.min.toLocaleString()} to ${f.max.toLocaleString()}.`);
        return;
      }
      patch[f.key] = f.percent ? n / 100 : n;
    }
    save(patch);
  };

  const stats: [string, string][] = data
    ? [
        ['Strength bonuses this week', `${data.strength7d} · ${data.strengthPeople7d} ${data.strengthPeople7d === 1 ? 'person' : 'people'}`],
        ['Game days this week', `${data.gameDays7d} · ${data.gameDayPeople7d} ${data.gameDayPeople7d === 1 ? 'person' : 'people'}`],
        [
          'Game days by sport',
          Object.entries(data.bySport)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${SPORT_NAMES[k] ?? k} ${n}`)
            .join(' · ') || 'None yet',
        ],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Sports bonuses</Text>
      <Text style={styles.footNote}>
        In Soccer, Cricket, Baseball, Rally, Hoops and H-O-R-S-E: a strength workout adds shots or power, and playing the game’s real sport makes it a game day.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.value}>Bonuses are on</Text>
              <Text style={styles.label}>Off: workouts stop counting from the next day played.</Text>
            </View>
            <Switch value={data.config.enabled} disabled={saving} onValueChange={(v) => save({ enabled: v })} trackColor={{ true: colors.accent }} />
          </View>
          {stats.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value}>{value}</Text>
            </View>
          ))}
          <Text style={[styles.value, { paddingTop: 6 }]}>The numbers</Text>
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
