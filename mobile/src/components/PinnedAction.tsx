import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';

// Every action you can take is on screen without scrolling (Steve, Nov
// 2026: "the action always has to exist when the screen opens"). A game
// card with something ready for you (Take your shots, your at-bats, your
// H-O-R-S-E turn, your hole, the Derby) hands it to the challenge page,
// which pins it to the bottom of the screen; the card then leaves its own
// copy out. Without a page to pin to (a preview), the card keeps its own.

export type PinnedAction = { label: string; onPress: () => void } | null;

const PinContext = createContext<((a: PinnedAction) => void) | null>(null);
export const PinnedActionProvider = PinContext.Provider;

// Called by a card on every render with its action when it's ready (or
// null). Returns true when the page is showing it pinned, so the card can
// skip its own button.
export function usePinnedAction(action: PinnedAction): boolean {
  const pin = useContext(PinContext);
  const press = useRef(action?.onPress);
  press.current = action?.onPress;
  const label = action?.label ?? null;
  useEffect(() => {
    if (!pin) return;
    pin(label ? { label, onPress: () => press.current?.() } : null);
  }, [pin, label]);
  useEffect(() => {
    if (!pin) return;
    return () => pin(null);
  }, [pin]);
  return !!pin && !!label;
}

// The bar itself: over the bottom of the page, above the home indicator.
export const PINNED_ACTION_SPACE = 92;

export function PinnedActionBar({ action }: { action: PinnedAction }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  if (!action) return null;
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
      <Pressable onPress={action.onPress} style={styles.button} accessibilityRole="button">
        <Text style={styles.text} numberOfLines={1}>
          {action.label}
        </Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    bar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 16,
      paddingTop: 10,
      backgroundColor: withAlpha(colors.bg, 0.94),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    button: {
      height: 52,
      borderRadius: 14,
      backgroundColor: colors.green,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
    },
    text: { fontFamily: font.headingSemibold, fontSize: 17, color: '#1b1d29' },
  });
}
