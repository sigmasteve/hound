import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
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
    // The chosen one is outlined and filled so it can't be mistaken for
    // the others in either theme.
    optOn: {
      backgroundColor: withAlpha(colors.accent, 0.2),
      borderWidth: 1.5,
      borderLeftWidth: 1.5,
      borderColor: colors.accent,
      borderLeftColor: colors.accent,
      borderRadius: radius.md,
    },
    label: { fontFamily: font.body, fontSize: 13, color: withAlpha(colors.text, 0.7) },
    labelOn: { color: colors.accent, fontFamily: font.headingSemibold },
  });
}
