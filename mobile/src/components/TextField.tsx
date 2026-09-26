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
  multiline,
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
      <View style={[styles.row, multiline && styles.rowMultiline, error && styles.rowError]}>
        {icon}
        <TextInput
          placeholderTextColor={withAlpha(colors.text, 0.4)}
          style={[styles.input, multiline && styles.inputMultiline]}
          secureTextEntry={secureToggle ? hidden : inputProps.secureTextEntry}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : undefined}
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
    // Centering vertically (the single-line default) looks wrong once a
    // field can grow past one line — align to the top instead, and give
    // the row its own vertical padding since minHeight alone would just
    // stretch a short value to the middle of a tall box.
    rowMultiline: { alignItems: 'flex-start', paddingVertical: 10 },
    input: { flex: 1, color: colors.text, fontSize: 15, fontFamily: font.body, paddingVertical: space[2] },
    // ~3 lines at this fontSize/line-height, so a multiline field never
    // renders shorter than that even empty or with a one-line value.
    inputMultiline: { minHeight: 60, paddingVertical: 0 },
    error: { fontSize: 12, color: colors.amber, marginTop: 4 },
  });
}
