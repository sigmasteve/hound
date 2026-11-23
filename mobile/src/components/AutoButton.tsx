import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';
import { font, withAlpha } from '../theme/tokens';

// "Auto" beside a game's main button (0256/0257): plays what's left for
// you at an ordinary level, after the screen asks. Orange on a light tint,
// readable in light and dark.
export function AutoButton({ onPress, disabled, label }: { onPress: () => void; disabled?: boolean; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, disabled && { opacity: 0.5 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.text}>Auto</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: withAlpha('#f08a24', 0.16),
    borderWidth: 1.5,
    borderColor: '#f08a24',
  },
  text: { fontFamily: font.headingSemibold, fontSize: 17, color: '#f08a24' },
});
