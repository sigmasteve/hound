import React, { useEffect, useMemo, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SneakerMoveIcon, XIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useHealthProvider } from './HealthContext';

// "Hound can't see your steps", across the top of Today. When Hound isn't
// allowed to read steps (on iPhone, Steps turned off for Hound in
// Health), Health doesn't say so: it just returns nothing, which looks
// like 0 steps, and every challenge sits at 0 while the phone "syncs".
// So: three days and today with no steps at all means Hound almost
// certainly can't see them. "x" hides it until tomorrow.
const DISMISS_KEY = 'hound:health-zero-dismissed';
const ZERO_DAYS = 3;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function useHealthZero(): { show: boolean; dismiss: () => void } {
  const health = useHealthProvider();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const dismissed = await AsyncStorage.getItem(DISMISS_KEY).catch(() => null);
        if (dismissed === dayKey(new Date())) return setShow(false);
        // A locked iPhone can't read Health at all: not the same thing.
        if (health.canReadNow && !(await health.canReadNow())) return;
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        since.setDate(since.getDate() - ZERO_DAYS);
        const days = await health.getDailyStepsSince(since);
        const total = days.reduce((n, d) => n + (d.steps || 0), 0);
        if (!cancelled) setShow(total === 0);
      } catch {
        // Can't tell: say nothing.
      }
    };
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [health]);

  const dismiss = () => {
    setShow(false);
    AsyncStorage.setItem(DISMISS_KEY, dayKey(new Date())).catch(() => {});
  };
  return { show, dismiss };
}

export function HealthZeroBanner() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const health = useHealthProvider();
  const { show, dismiss } = useHealthZero();
  if (!show) return null;

  const ios = Platform.OS === 'ios';
  const fix = () => {
    if (!ios) {
      if (health.openSettings) health.openSettings();
      else Linking.openSettings().catch(() => {});
      return;
    }
    Alert.alert(
      'Let Hound see your steps',
      'In the Health app, tap your picture (top right) → Apps → Hound, and turn on Steps, Walking + Running Distance and Workouts. Then come back to Hound: your steps fill in on every challenge.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Health', onPress: () => Linking.openURL('x-apple-health://').catch(() => {}) },
      ],
    );
  };

  return (
    <View style={styles.bar}>
      <SneakerMoveIcon size={18} weight="bold" color={colors.amber} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Hound can’t see your steps</Text>
        <Text style={styles.line}>
          {ios ? 'Apple Health' : 'Health Connect'} has shown 0 steps for {ZERO_DAYS} days, so your challenges are stuck at 0.
        </Text>
      </View>
      <Pressable onPress={fix} style={styles.button} hitSlop={6} accessibilityRole="button" accessibilityLabel="Fix step access">
        <Text style={styles.buttonText}>Fix it</Text>
      </Pressable>
      <Pressable onPress={dismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel="Hide until tomorrow">
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
      backgroundColor: withAlpha(colors.amber, 0.16),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.amber, 0.45),
    },
    title: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    line: { fontSize: 12, color: withAlpha(colors.text, 0.7) },
    button: {
      minWidth: 64,
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.amber,
    },
    buttonText: { fontFamily: font.heading, fontSize: 13, color: '#1c1b2e' },
  });
}
