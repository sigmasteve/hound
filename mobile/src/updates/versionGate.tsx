import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { HoundArt } from '../kennel/HoundArt';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { currentApp, getInstallSource, type InstallSource } from '../admin/appVersions';

// The minimum app version (0188_min_app_version.sql). Below it, Hound
// shows "Update Hound" with the App Store or download link instead of
// the app, so a new native build can become the one everyone's on.
// Checked when the app opens and whenever it comes back to the front,
// once signed in. Admins can continue past it.

export const APP_STORE_URL = 'https://apps.apple.com/app/id6816764199';
export const ANDROID_DOWNLOAD_URL = 'https://houndchallenge.net/get';
// Hound on Google Play (live since Nov 2026). Play installs update there;
// a website APK can't be updated by Play, so it goes to /get, which says
// how to move over.
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=app.hound.mobile';
const PLAY_MARKET_URL = 'market://details?id=app.hound.mobile';

// "0.11.0" < "0.12.0" < "0.12.1" < "1.0.0". Missing parts count as 0.
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function getMinAppVersion(): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('app_version_gate').select('min_version').eq('id', true).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.min_version as string | null) ?? null;
}

export async function setMinAppVersion(version: string | null): Promise<void> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { error } = await supabase.rpc('admin_set_min_app_version', { p_version: version ?? '' });
  if (error) throw new Error(error.message);
}

// Whether this installed build is below the minimum. Unknown versions
// (web, or a build too old to say) are never blocked.
export function isBelow(installed: string | null, min: string | null): boolean {
  return !!installed && !!min && compareVersions(installed, min) < 0;
}

export function VersionGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [min, setMin] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);
  const installed = currentApp().appVersion;

  const check = useCallback(() => {
    if (!user?.id || Platform.OS === 'web') return;
    getMinAppVersion()
      .then(setMin)
      .catch(() => {
        // Before 0188 has run, or offline: never block on a failed check.
      });
  }, [user?.id]);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  if (!user || skipped || !isBelow(installed, min)) return <>{children}</>;
  return <UpdateRequired installed={installed!} min={min!} isAdmin={!!user.isAdmin} onSkip={() => setSkipped(true)} />;
}

export function UpdateRequired({ installed, min, isAdmin, onSkip }: { installed: string; min: string; isAdmin: boolean; onSkip: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const ios = Platform.OS === 'ios';
  const [source, setSource] = useState<InstallSource | null>(null);
  useEffect(() => {
    if (!ios) getInstallSource().then(setSource);
  }, [ios]);
  const fromPlay = !ios && source === 'play';
  const open = () => {
    if (ios) Linking.openURL(APP_STORE_URL).catch(() => {});
    else if (fromPlay) Linking.openURL(PLAY_MARKET_URL).catch(() => Linking.openURL(PLAY_STORE_URL).catch(() => {}));
    else Linking.openURL(ANDROID_DOWNLOAD_URL).catch(() => {});
  };
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <HoundArt rank="hunter" mood="happy" neckId="bandana_red" size={150} animate />
        <Text style={[text.h2, styles.center]}>Time to update Hound</Text>
        <Text style={[styles.note, styles.center]}>
          Hound {min} is here, and this version ({installed}) can&rsquo;t keep up with it. Update to keep your streak, challenges and hound
          going: everything is saved and waiting for you.
        </Text>
      </View>
      <View style={styles.buttons}>
        <Button
          label={ios ? 'Update in the App Store' : fromPlay ? 'Update on Google Play' : 'Get the new version'}
          variant="primary"
          block
          onPress={open}
        />
        {!ios && !fromPlay && (
          <Text style={[styles.small, styles.center]}>
            Hound is on Google Play now. Uninstall this copy, install Hound from Google Play and sign in the same way as before:
            everything is saved to your account.
          </Text>
        )}
        {isAdmin && <Button label="Continue anyway (admin)" variant="ghost" block onPress={onSkip} />}
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg, padding: 24 },
    body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
    center: { textAlign: 'center' },
    note: { fontSize: 16, lineHeight: 23, color: withAlpha(colors.text, 0.72) },
    small: { fontSize: 13, color: withAlpha(colors.text, 0.6), fontFamily: font.body },
    buttons: { gap: 10, paddingBottom: 12 },
  });
}
