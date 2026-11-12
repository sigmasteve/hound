import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowClockwiseIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { HoundArt } from '../kennel/HoundArt';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { checkServer, timeLabel, type ServerState } from './maintenance';

// In front of the whole app (App.tsx): "Hound can't reach its server" or
// the maintenance screen, instead of a "Loading" that never ends
// (maintenance.ts has the order of checks). Hound itself shows straight
// away while the first check runs, so a normal open waits for nothing.
const RETRY_SECONDS = 15;

export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<ServerState | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [checking, setChecking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RETRY_SECONDS);
  const busy = useRef(false);

  const check = useCallback(async () => {
    if (busy.current || Platform.OS === 'web') return;
    busy.current = true;
    setChecking(true);
    try {
      const next = await checkServer();
      setState(next);
      if (next.kind === 'ok' || !(next.kind === 'maintenance' && next.now)) setSkipped(false);
    } finally {
      busy.current = false;
      setChecking(false);
      setSecondsLeft(RETRY_SECONDS);
    }
  }, []);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  const blocked = !!state && state.kind !== 'ok' && !skipped;

  // While a screen is up: count down and try again.
  useEffect(() => {
    if (!blocked) return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          check();
          return RETRY_SECONDS;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [blocked, check]);

  if (!state || state.kind === 'ok' || skipped) return <>{children}</>;
  return (
    <ServerScreen
      state={state}
      checking={checking}
      secondsLeft={secondsLeft}
      onRetry={check}
      onSkip={state.kind === 'maintenance' && state.now && user?.isAdmin ? () => setSkipped(true) : undefined}
    />
  );
}

export function ServerScreen({
  state,
  checking,
  secondsLeft,
  onRetry,
  onSkip,
}: {
  state: Exclude<ServerState, { kind: 'ok' }>;
  checking: boolean;
  secondsLeft: number;
  onRetry: () => void;
  onSkip?: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const maintenance = state.kind === 'maintenance';
  const until = maintenance ? state.until : null;
  const back = until && until.getTime() > Date.now() ? `Back by about ${timeLabel(until)}, usually sooner.` : 'Back soon.';

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        {maintenance ? (
          <HoundArt rank="hunter" mood="okay" headId="hat_beanie" size={150} animate />
        ) : (
          <HoundArt rank="hunter" mood="sleepy" pose="lie" size={160} animate />
        )}
        {maintenance && <Text style={styles.eyebrow}>MAINTENANCE</Text>}
        <Text style={[text.h2, styles.center]}>{maintenance ? 'Hound is getting a tune-up' : 'Hound can’t reach its server'}</Text>
        <Text style={[styles.note, styles.center]}>
          {maintenance
            ? `${state.message ? `${state.message} ` : ''}${back}`
            : 'It isn’t answering right now. Your steps are safe in Health and will count as soon as it’s back.'}
        </Text>
        {maintenance && (
          <View style={styles.safeBox}>
            <Text style={styles.safeTitle}>Your steps are safe</Text>
            <Text style={styles.safeLine}>They stay in Health and count toward today’s challenges and goals once Hound is back.</Text>
          </View>
        )}
        <View style={styles.retryRow}>
          <ArrowClockwiseIcon size={16} weight="bold" color={colors.accent} />
          <Text style={styles.small}>
            {checking ? 'Checking…' : maintenance ? `Opens by itself when it’s back · next try in ${secondsLeft}s` : `Trying again in ${secondsLeft} seconds`}
          </Text>
        </View>
      </View>
      <View style={styles.buttons}>
        <Button label={checking ? 'Checking…' : 'Try again'} variant="primary" block onPress={checking ? undefined : onRetry} />
        {!maintenance && (
          <Text style={[styles.small, styles.center]} onPress={() => Linking.openURL('https://houndchallenge.net').catch(() => {})}>
            Still stuck after a few minutes? <Text style={styles.link}>houndchallenge.net</Text> says what’s going on.
          </Text>
        )}
        {onSkip && <Button label="Continue anyway (admin)" variant="ghost" block onPress={onSkip} />}
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg, padding: 24 },
    body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
    center: { textAlign: 'center' },
    eyebrow: { fontFamily: font.heading, fontSize: 12, letterSpacing: 1.2, color: colors.amber },
    note: { fontSize: 16, lineHeight: 23, color: withAlpha(colors.text, 0.72) },
    safeBox: { alignSelf: 'stretch', borderRadius: 14, backgroundColor: withAlpha(colors.text, 0.06), padding: 14, gap: 4 },
    safeTitle: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    safeLine: { fontSize: 14, lineHeight: 20, color: withAlpha(colors.text, 0.65) },
    retryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    small: { fontSize: 13, color: withAlpha(colors.text, 0.6), fontFamily: font.body },
    link: { color: colors.accentActive, fontFamily: font.heading },
    buttons: { gap: 10, paddingBottom: 12 },
  });
}
