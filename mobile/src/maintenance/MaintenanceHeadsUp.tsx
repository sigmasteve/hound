import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WrenchIcon, XIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getMaintenanceWindow, headsUpActive, markMaintenanceSeen, minutesBetween, whenLabel, type MaintenanceWindow } from './maintenance';

// Across the top of Today, above the announcement banner, from a few
// hours before an Admin maintenance window until it ends (0190). "x"
// hides it for that window. Showing it counts as seen, once per window,
// for Admin → Maintenance.
export function MaintenanceHeadsUp() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [window, setWindow] = useState<MaintenanceWindow | null>(null);
  const [hidden, setHidden] = useState(true);

  const load = useCallback(() => {
    getMaintenanceWindow()
      .then(setWindow)
      .catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => sub.remove();
  }, [load]);

  const key = window?.startsAt ? window.startsAt.toISOString() : null;
  const active = headsUpActive(window);

  useEffect(() => {
    if (!key || !active) {
      setHidden(true);
      return;
    }
    let cancelled = false;
    AsyncStorage.multiGet([`maintenance:hidden:${key}`, `maintenance:seen:${key}`])
      .then(([[, h], [, s]]) => {
        if (cancelled) return;
        setHidden(h === '1');
        if (s !== '1' && window?.startsAt) {
          markMaintenanceSeen(window.startsAt)
            .then(() => AsyncStorage.setItem(`maintenance:seen:${key}`, '1'))
            .catch(() => {});
        }
      })
      .catch(() => setHidden(false));
    return () => {
      cancelled = true;
    };
  }, [key, active, window?.startsAt]);

  if (!active || hidden || !window?.startsAt || !window.endsAt) return null;
  const started = Date.now() >= window.startsAt.getTime();
  const minutes = minutesBetween(window.startsAt, window.endsAt);
  const length = minutes >= 60 ? `About ${Math.round(minutes / 6) / 10} hours` : `About ${minutes} minutes`;

  return (
    <View style={styles.bar}>
      <WrenchIcon size={18} weight="bold" color={colors.amber} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title}>{started ? 'Hound tune-up happening now' : `Hound tune-up ${whenLabel(window.startsAt).replace(/^(\w)/, (c) => c.toLowerCase())}`}</Text>
        <Text style={styles.line}>
          {window.message ? `${window.message} ` : ''}
          {length}. Your steps still count, they’ll catch up after.
        </Text>
      </View>
      <Pressable
        onPress={() => {
          setHidden(true);
          if (key) AsyncStorage.setItem(`maintenance:hidden:${key}`, '1').catch(() => {});
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Hide"
      >
        <XIcon size={16} color={withAlpha(colors.text, 0.6)} />
      </Pressable>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: withAlpha(colors.amber, 0.14),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.amber, 0.45),
    },
    title: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    line: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.7) },
  });
}
