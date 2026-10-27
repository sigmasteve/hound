import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { ArrowClockwiseIcon, XIcon } from 'phosphor-react-native';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useUpdateReady } from '../updates/updateReady';

// Across the top of Today when a new version has downloaded in the
// background (src/updates/updateReady.ts): Restart runs it now, about a
// second; "x" is "not now", and it applies on the next cold start anyway.
export function UpdateReadyBanner() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { ready, restarting, restart, dismiss } = useUpdateReady();
  if (!ready) return null;

  return (
    <View style={styles.bar}>
      <ArrowClockwiseIcon size={18} weight="bold" color={colors.accentActive} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>A new version of Hound is ready</Text>
        <Text style={styles.line}>Takes about a second.</Text>
      </View>
      <Pressable
        onPress={restarting ? undefined : restart}
        style={styles.button}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Restart Hound to get the new version"
      >
        {restarting ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.buttonText}>Restart</Text>}
      </Pressable>
      <Pressable onPress={dismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel="Not now">
        <XIcon size={16} color={withAlpha(colors.text, 0.6)} />
      </Pressable>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: withAlpha(colors.accent, 0.16),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.accent, 0.4),
    },
    title: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    line: { fontSize: 12, color: withAlpha(colors.text, 0.65) },
    button: {
      minWidth: 74,
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.accent,
    },
    buttonText: { fontFamily: font.heading, fontSize: 13, color: '#ffffff' },
  });
}
