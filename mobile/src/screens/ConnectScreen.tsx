import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AndroidLogoIcon, AppleLogoIcon, PawPrintIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useHealthProvider } from '../health/HealthContext';
import type { HealthAuthStatus } from '../health/types';

// Where to manage/revoke access once it's already granted — the OS is
// the only place that lives, there's no in-app disconnect. Shown instead
// of re-running requestAuthorization() for an already-authorized status,
// since re-requesting an already-granted permission just resolves
// instantly with no dialog and nothing visibly happens, which used to
// read as this screen silently doing nothing (or a bug) rather than "you
// already did this."
const MANAGE_INSTRUCTIONS: Record<'ios' | 'android', string> = {
  ios: 'Already connected. To review or revoke access, open Settings → Privacy & Security → Health → Hound on this device.',
  android:
    'Already connected. To review or revoke access, open the Health Connect app → Data and access → App permissions → Hound on this device.',
};

export function ConnectScreen({ onDone }: { onDone: () => void }) {
  const health = useHealthProvider();
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [connecting, setConnecting] = useState<'apple' | 'android' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Re-checked on every focus, not just on mount — this screen can be
  // revisited after the person went and changed something in the OS's
  // own settings, and the button/status here should reflect that instead
  // of whatever was true the first time this screen mounted.
  const [authStatus, setAuthStatus] = useState<HealthAuthStatus | null>(null);

  useFocusEffect(
    useCallback(() => {
      health.getAuthorizationStatus().then(setAuthStatus);
    }, [health]),
  );

  const alreadyAuthorized = authStatus === 'authorized' && health.platform !== 'mock';

  const connect = async () => {
    if (alreadyAuthorized) {
      setStatus(MANAGE_INSTRUCTIONS[health.platform === 'ios' ? 'ios' : 'android']);
      return;
    }
    setConnecting(Platform.OS === 'ios' ? 'apple' : 'android');
    const result = await health.requestAuthorization();
    setConnecting(null);
    setAuthStatus(result);
    if (result === 'authorized') {
      onDone();
    } else {
      setStatus(
        health.platform === 'mock'
          ? 'Running on sample data — build a dev client to connect a real device.'
          : `Health access ${result}. You can grant it from your device Settings and try again.`,
      );
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.badge}>
        <PawPrintIcon size={26} color={colors.accent} weight="fill" />
      </View>
      <Text style={[text.h2, styles.title]}>Hound needs your health data</Text>
      <Text style={styles.body}>
        Connect the platform your phone already uses. Your friends connect theirs. Hound lines the
        numbers up so a Pixel and an iPhone can race fairly.
      </Text>

      <View style={styles.cardsRow}>
        <Card style={styles.platformCard} elevated={false}>
          <AppleLogoIcon size={24} color={colors.text} weight="fill" />
          <Text style={styles.platformName}>Apple Health</Text>
          <Text style={styles.platformSub}>iPhone, Apple Watch</Text>
          <Button
            label={connecting === 'apple' ? 'Connecting…' : Platform.OS === 'ios' && alreadyAuthorized ? 'Connected ✓' : 'Connect'}
            variant={Platform.OS === 'ios' && alreadyAuthorized ? 'secondary' : 'primary'}
            block
            small
            disabled={connecting !== null || Platform.OS !== 'ios'}
            onPress={connect}
          />
          {connecting === 'apple' && <ActivityIndicator color={colors.accent} />}
        </Card>
        <Card style={styles.platformCard} elevated={false}>
          <AndroidLogoIcon size={24} color={colors.text} />
          <Text style={styles.platformName}>Health Connect</Text>
          <Text style={styles.platformSub}>Pixel, Samsung Health</Text>
          <Button
            label={
              connecting === 'android' ? 'Connecting…' : Platform.OS === 'android' && alreadyAuthorized ? 'Connected ✓' : 'Connect'
            }
            variant={Platform.OS === 'android' && alreadyAuthorized ? 'secondary' : 'primary'}
            block
            small
            disabled={connecting !== null || Platform.OS !== 'android'}
            onPress={connect}
          />
          {connecting === 'android' && <ActivityIndicator color={colors.accent} />}
        </Card>
      </View>

      {status && <Text style={styles.status}>{status}</Text>}

      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Read-only, five metrics</Text>
        <Text style={styles.noticeBody}>
          Steps · Workouts · Distance · Heart rate · Weight. Nothing else is requested, nothing is
          written back, and you can revoke it from your phone&rsquo;s settings at any time.
        </Text>
      </View>

      <Button label="Skip for now" variant="ghost" small onPress={onDone} style={styles.skip} />
    </ScrollView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, paddingTop: 24, gap: 20, alignItems: 'center', paddingBottom: 48 },
    badge: {
      width: 52,
      height: 52,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { textAlign: 'center' },
    body: { textAlign: 'center', fontSize: 15, color: withAlpha(colors.text, 0.78), maxWidth: 420 },
    cardsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, width: '100%' },
    platformCard: { flexBasis: '46%', flexGrow: 1, gap: 10, padding: 18 },
    platformName: { fontFamily: font.heading, fontSize: 16, color: colors.text },
    platformSub: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    status: { fontSize: 12.5, color: colors.amber, textAlign: 'center' },
    notice: {
      width: '100%',
      padding: 14,
      borderRadius: 8,
      backgroundColor: withAlpha(colors.accent, 0.09),
      gap: 6,
    },
    // On a wash of the accent color over this theme's own page bg, not a
    // fixed dark chip — accent200 (near-white) reads fine over Dark's own
    // near-black wash but goes invisible over Light's near-white one. See
    // tokens.ts's own comment on accentActive (added for TopNav's active
    // tab and Home's leaderboard highlight — same bug, same fix).
    noticeTitle: { fontFamily: font.heading, fontSize: 12.5, color: colors.accentActive },
    noticeBody: { fontSize: 12.5, lineHeight: 18, color: colors.accentActive },
    skip: { alignSelf: 'center' },
  });
}
