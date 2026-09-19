import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { font, radius, space, withAlpha, type Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

type Variant = 'primary' | 'secondary' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'secondary',
  icon,
  trailingIcon,
  block,
  small,
  style,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  block?: boolean;
  small?: boolean;
  style?: ViewStyle;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const { styles, variantStyles, variantText } = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        small && styles.small,
        block && styles.block,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon}
      <Text style={[styles.label, variantText[variant], small && styles.smallLabel]}>{label}</Text>
      {trailingIcon}
    </Pressable>
  );
}

function makeStyles(colors: Palette) {
  const styles = StyleSheet.create({
    base: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: space[2],
      paddingHorizontal: space[3] * 1.2,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: 'transparent',
      alignSelf: 'flex-start',
    },
    small: { paddingVertical: 6, paddingHorizontal: 10 },
    block: { alignSelf: 'stretch' },
    pressed: { opacity: 0.8 },
    disabled: { opacity: 0.45 },
    label: { fontFamily: font.heading, fontSize: 14 },
    smallLabel: { fontSize: 12.5 },
  });

  const variantStyles: Record<Variant, ViewStyle> = {
    primary: { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.12) },
    secondary: { borderColor: colors.divider, backgroundColor: 'transparent' },
    ghost: { borderColor: 'transparent', backgroundColor: 'transparent', paddingHorizontal: 4 },
  };

  const variantText = StyleSheet.create({
    primary: { color: colors.accent },
    secondary: { color: colors.text },
    ghost: { color: colors.accent },
  });

  return { styles, variantStyles, variantText };
}
