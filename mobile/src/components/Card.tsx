import React, { useMemo } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { radius, space, type Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

export function Card({
  children,
  style,
  elevated = true,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  elevated?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={[styles.card, elevated && styles.ring, style]}>{children}</View>;
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: space[3],
      gap: space[2],
    },
    ring: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.ring.sm,
    },
  });
}
