import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaretRightIcon } from 'phosphor-react-native';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';

export interface ToastMessage {
  id: string;
  text: string;
  Icon?: React.ComponentType<any>;
  // Where tapping it goes, if anywhere.
  onPress?: () => void;
}

const VISIBLE_MS = 4500;
// With more waiting behind it, each one goes by quicker.
const BRIEF_MS = 2500;

// A small bar at the bottom of the screen for good news that doesn't need
// to stop anyone: the daily bonus, and any achievement or personal record
// that turns up after this app open has already had its one pop-up.
// Shows one message at a time; the parent keeps the queue and drops the
// first one when onDone fires.
export function Toast({ message, brief = false, onDone }: { message: ToastMessage; brief?: boolean; onDone: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    opacity.setValue(0);
    const show = Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true });
    show.start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => done.current());
    }, brief ? BRIEF_MS : VISIBLE_MS);
    return () => {
      show.stop();
      clearTimeout(timer);
    };
  }, [message.id, opacity, brief]);

  const { Icon } = message;
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + 16, opacity }]}
    >
      <Pressable
        style={styles.toast}
        onPress={() => {
          message.onPress?.();
          done.current();
        }}
        accessibilityRole={message.onPress ? 'button' : 'text'}
        accessibilityLiveRegion="polite"
      >
        {Icon && <Icon size={18} color={color.accent} weight="fill" />}
        <Text style={styles.text} numberOfLines={2}>
          {message.text}
        </Text>
        {message.onPress && <CaretRightIcon size={14} color={withAlpha(colors.text, 0.5)} />}
      </Pressable>
    </Animated.View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
    toast: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      maxWidth: 480,
      width: '100%',
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.45),
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    text: { flex: 1, fontFamily: font.heading, fontSize: 14, color: colors.text },
  });
}
