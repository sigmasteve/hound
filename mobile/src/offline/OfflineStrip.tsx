import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CloudSlashIcon, CloudArrowUpIcon, WarningCircleIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useNetState } from './network';
import { useOfflineEnabled } from './offlineConfig';
import { dismissFailures, useOutbox } from './outbox';
import { newestSaved } from './cache';

// Offline mode's strip (0271), on Today, Move and Fasting:
//   offline          "Offline · last updated 9:41 AM · 2 waiting to sync"
//   back, syncing    "Syncing 2…" (only once something has waited 5 s, so a
//                    blip that syncs at once never shows anything)
//   turned down      "1 couldn't sync: <why>"  OK
// Nothing at all while online with nothing waiting, or with offline mode
// off in Admin.
export function OfflineStrip({ cacheKeys = [] }: { cacheKeys?: string[] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const on = useOfflineEnabled();
  const net = useNetState();
  const { pending, failed } = useOutbox();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (pending.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, [pending.length]);

  if (!on) return null;
  const oldestWait = pending.length ? now - new Date(pending[0].doneAt).getTime() : 0;
  const saved = newestSaved(cacheKeys);
  const n = pending.length;

  if (net === 'offline') {
    return (
      <View style={[styles.strip, { backgroundColor: withAlpha(colors.text, 0.07) }]} accessibilityRole="alert">
        <CloudSlashIcon size={16} color={withAlpha(colors.text, 0.7)} weight="bold" />
        <Text style={styles.text}>
          Offline
          {saved ? ` · last updated ${new Date(saved).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
          {n > 0 ? ` · ${n} waiting to sync` : ' · what you do is saved on your phone'}
        </Text>
      </View>
    );
  }
  if (failed.length > 0) {
    const f = failed[failed.length - 1];
    return (
      <View style={[styles.strip, { backgroundColor: withAlpha(colors.amber, 0.14) }]} accessibilityRole="alert">
        <WarningCircleIcon size={16} color={colors.amber} weight="bold" />
        <Text style={[styles.text, { flex: 1 }]} numberOfLines={3}>
          {failed.length === 1 ? `${f.label} couldn’t sync: ${f.message}` : `${failed.length} couldn’t sync. Latest: ${f.label}: ${f.message}`}
        </Text>
        <Pressable onPress={dismissFailures} hitSlop={8} accessibilityRole="button">
          <Text style={styles.ok}>OK</Text>
        </Pressable>
      </View>
    );
  }
  if (n > 0 && oldestWait > 5000) {
    return (
      <View style={[styles.strip, { backgroundColor: withAlpha(colors.accent, 0.1) }]}>
        <CloudArrowUpIcon size={16} color={colors.accentActive} weight="bold" />
        <Text style={styles.text}>Syncing {n}…</Text>
      </View>
    );
  }
  return null;
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    strip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
    text: { fontSize: 13, lineHeight: 18, color: colors.text, fontFamily: font.body },
    ok: { fontSize: 13.5, fontFamily: font.headingSemibold, color: colors.accentActive },
  });
}
