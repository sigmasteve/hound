import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { ClipboardTextIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { Card } from './Card';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha, type Palette } from '../theme/tokens';
import { getChecklistMaxItems, setChecklistMaxItems } from '../challenges/checklistApi';

// Admin → Accountability lists (0126_checklist.sql): how many shared
// items a creator can put on a list. Six unless changed here.
export function ChecklistAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [loaded, setLoaded] = useState(false);
  const [maxInput, setMaxInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getChecklistMaxItems()
        .then((n) => {
          setMaxInput(String(n));
          setLoaded(true);
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the setting.'));
    }, []),
  );

  const save = async () => {
    const n = Number(maxInput);
    if (!Number.isInteger(n) || n < 1 || n > 12) {
      setError('Items on a list is a whole number from 1 to 12.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setChecklistMaxItems(n);
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
        <ClipboardTextIcon size={18} color={colors.accentActive} weight="fill" />
        <Text style={text.h4}>Accountability lists</Text>
      </View>
      <Text style={styles.note}>
        How many shared items the creator of an Accountability challenge can put on the list. Each person can
        always add one line of their own on top. Lists already written keep their items.
      </Text>
      {!loaded ? (
        error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <ActivityIndicator color={colors.accent} />
        )
      ) : (
        <>
          <TextField
            label="Items on a list"
            value={maxInput}
            onChangeText={(v) => {
              setMaxInput(v);
              setSaved(false);
            }}
            keyboardType="number-pad"
            maxLength={2}
          />
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
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.7), lineHeight: 18 },
    error: { fontSize: 12.5, color: colors.amber },
    success: { fontSize: 12.5, color: colors.green },
  });
}
