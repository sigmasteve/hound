import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { font, radius, withAlpha, type Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.seg}>
      {options.map((opt, i) => {
        const on = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.opt, i > 0 && styles.divider, on && styles.optOn]}
          >
            <Text style={[styles.label, on && styles.labelOn]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    seg: {
      flexDirection: 'row',
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      overflow: 'hidden',
    },
    opt: { flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10 },
    divider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.divider },
    optOn: { backgroundColor: withAlpha(colors.accent, 0.12) },
    label: { fontFamily: font.body, fontSize: 13, color: colors.text },
    labelOn: { color: colors.accent, fontFamily: font.heading },
  });
}
