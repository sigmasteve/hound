import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha, type Palette } from '../theme/tokens';

// The one "this whole page/section hasn't loaded anything yet" spinner
// — a bare ActivityIndicator with nothing else on screen can read as
// frozen rather than working. The label underneath is the only thing
// telling those two apart. Doesn't handle its own centering/flex —
// every call site already wraps this in a container sized for that
// (a full-screen View, a SafeAreaView, a list's own loading row), so
// this only ever needs to stack the spinner and label together.
export function LoadingView({ style }: { style?: ViewStyle }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.wrap, style]}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.label}>Loading</Text>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    wrap: { alignItems: 'center', gap: 8 },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
  });
}
