import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { BOUNTY_BONES_CHOICES, BOUNTY_STEP_CHOICES } from '../bounties/bountiesApi';

// Pick a step target and how many Bones go on it. The Bones come off
// your balance now and come back if nobody hits it by midnight.
export function PostBountyModal({
  currencyName,
  posting,
  onPost,
  onClose,
}: {
  currencyName: string;
  posting: boolean;
  onPost: (targetSteps: number, bones: number) => void;
  onClose: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [steps, setSteps] = useState(15000);
  const [bones, setBones] = useState(25);

  const chips = <T extends number>(values: T[], selected: T, onPick: (v: T) => void, label: (v: T) => string) => (
    <View style={styles.chips}>
      {values.map((v) => (
        <Pressable
          key={v}
          onPress={() => onPick(v)}
          style={[styles.chip, v === selected && styles.chipOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: v === selected }}
        >
          <Text style={[styles.chipText, v === selected && styles.chipTextOn]}>{label(v)}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={text.eyebrow}>NEW BOUNTY</Text>
          <Text style={styles.title}>
            First to {steps.toLocaleString('en-US')} steps today gets {bones} {currencyName}
          </Text>

          <Text style={styles.label}>Steps</Text>
          {chips(BOUNTY_STEP_CHOICES, steps, setSteps, (v) => `${v / 1000}k`)}

          <Text style={styles.label}>{currencyName}</Text>
          {chips(BOUNTY_BONES_CHOICES, bones, setBones, (v) => String(v))}

          <Text style={styles.note}>
            Your friends get a heads-up. The {currencyName} come off your balance now and come back if nobody hits it by
            midnight.
          </Text>

          <View style={styles.buttons}>
            <Button label="Not now" onPress={onClose} disabled={posting} />
            <Button
              label={posting ? 'Posting…' : `Post for ${bones} ${currencyName}`}
              variant="primary"
              onPress={() => onPost(steps, bones)}
              disabled={posting}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 380,
      gap: 10,
      padding: 22,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    title: {
      fontFamily: font.headingSemibold,
      fontSize: 20,
      color: colors.text,
    },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6), marginTop: 4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.2),
    },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    chipTextOn: { color: '#ffffff' },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.6), marginTop: 4 },
    buttons: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 8,
    },
  });
}
