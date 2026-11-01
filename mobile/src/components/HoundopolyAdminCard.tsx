import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { BuildingsIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { Card } from './Card';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha, type Palette } from '../theme/tokens';
import { getHoundopolySettings, setHoundopolySettings } from '../challenges/houndopolyApi';
import type { HoundopolySettings } from '../challenges/houndopoly';

const FIELDS: { key: keyof HoundopolySettings; label: string; min: number; max: number }[] = [
  { key: 'startCash', label: 'Starting cash', min: 100, max: 100000 },
  { key: 'passStartCash', label: 'Passing Start pays', min: 0, max: 10000 },
  { key: 'vetCost', label: 'The Vet costs', min: 0, max: 10000 },
  { key: 'dogHouseSteps', label: 'Steps for a roll at all', min: 0, max: 50000 },
  { key: 'twoDiceSteps', label: 'Steps for two dice', min: 1, max: 60000 },
  { key: 'threeDiceSteps', label: 'Steps for three dice', min: 2, max: 80000 },
];

// Admin → Hound'opoly (0136_houndopoly.sql): the game's knobs. Changes
// apply from the next roll, in every game.
export function HoundopolyAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getHoundopolySettings()
        .then((s) => setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(s[f.key])]))))
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the settings.'));
    }, []),
  );

  const save = async () => {
    if (!values) return;
    const next: Partial<HoundopolySettings> = {};
    for (const f of FIELDS) {
      const n = Number(values[f.key]);
      if (!Number.isInteger(n) || n < f.min || n > f.max) {
        setError(`${f.label} is a whole number from ${f.min.toLocaleString()} to ${f.max.toLocaleString()}.`);
        return;
      }
      next[f.key] = n;
    }
    if (!(next.dogHouseSteps! < next.twoDiceSteps! && next.twoDiceSteps! < next.threeDiceSteps!)) {
      setError('The dice tiers have to go up: a roll at all, then two dice, then three.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const current = await getHoundopolySettings();
      await setHoundopolySettings({ ...current, ...(next as HoundopolySettings) });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.header}>
        <BuildingsIcon size={18} color={colors.accentActive} weight="fill" />
        <Text style={text.h4}>Hound&rsquo;opoly</Text>
      </View>
      <Text style={styles.note}>
        The board game&rsquo;s numbers, for every game from the next roll on. Rent stays a tenth of a square&rsquo;s price,
        doubled with a whole colour group.
      </Text>
      {!values ? (
        error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <ActivityIndicator color={colors.accent} />
        )
      ) : (
        <>
          {FIELDS.map((f) => (
            <TextField
              key={f.key}
              label={f.label}
              value={values[f.key]}
              onChangeText={(v) => {
                setValues((cur) => ({ ...(cur ?? {}), [f.key]: v }));
                setSaved(false);
              }}
              keyboardType="number-pad"
              maxLength={6}
            />
          ))}
          {error && <Text style={styles.error}>{error}</Text>}
          {saved && !error && <Text style={styles.success}>Saved.</Text>}
          <Button label={saving ? 'Saving…' : 'Save'} variant="primary" disabled={saving} onPress={save} />
        </>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.7) },
    error: { fontSize: 13, color: colors.amber },
    success: { fontSize: 13, color: colors.green },
  });
}
