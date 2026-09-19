import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { EyeIcon, EyeSlashIcon } from 'phosphor-react-native';
import { font, radius, space, withAlpha, type Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

export function TextField({
  label,
  icon,
  secureToggle,
  error,
  style,
  ...inputProps
}: {
  label: string;
  icon?: React.ReactNode;
  secureToggle?: boolean;
  error?: string;
} & TextInputProps) {
  const [hidden, setHidden] = useState(!!secureToggle);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={style}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.row, error && styles.rowError]}>
        {icon}
        <TextInput
          placeholderTextColor={withAlpha(colors.text, 0.4)}
          style={styles.input}
          secureTextEntry={secureToggle ? hidden : inputProps.secureTextEntry}
          {...inputProps}
        />
        {secureToggle && (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
            {hidden ? (
              <EyeIcon size={18} color={withAlpha(colors.text, 0.55)} />
            ) : (
              <EyeSlashIcon size={18} color={withAlpha(colors.text, 0.55)} />
            )}
          </Pressable>
        )}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    label: { fontSize: 12, color: withAlpha(colors.text, 0.7), marginBottom: 5 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    rowError: { borderColor: colors.amber },
    input: { flex: 1, color: colors.text, fontSize: 15, fontFamily: font.body, paddingVertical: space[2] },
    error: { fontSize: 12, color: colors.amber, marginTop: 4 },
  });
}
