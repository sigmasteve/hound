import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

// Radio pill used in "What counts" / "Conflicts" / "Units" rows.
export function RadioPill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} style={styles.pill}>
      <View style={[styles.dot, selected && styles.dotOn]} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

// Toggle row used in Alerts settings.
export function ToggleRow({
  label,
  note,
  value,
  onChange,
}: {
  label: string;
  note: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable style={styles.toggleRow} onPress={() => onChange(!value)}>
      <View style={[styles.checkbox, value && styles.checkboxOn]} />
      <Text style={[styles.label, styles.toggleLabel]}>{label}</Text>
      <Text style={styles.note}>{note}</Text>
    </Pressable>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      borderRadius: 8,
    },
    dot: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 1.5,
      borderColor: colors.divider,
    },
    dotOn: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    label: { fontFamily: font.body, fontSize: 14, color: colors.text },
    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    // Label keeps its natural width; note takes whatever's left and wraps
    // instead of overflowing the card when it's a long description (e.g.
    // Appearance's "Light mode") rather than a short paired value (e.g.
    // Alerts' "Sent to this device").
    toggleLabel: { flexShrink: 0 },
    checkbox: {
      width: 18,
      height: 18,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: colors.divider,
    },
    checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    note: { fontSize: 12, color: withAlpha(colors.text, 0.55), flex: 1, textAlign: 'right' },
  });
}
