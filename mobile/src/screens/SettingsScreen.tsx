import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AndroidLogoIcon, ArrowsClockwiseIcon, AppleLogoIcon, ScalesIcon, SignOutIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ToggleRow } from '../components/Selectable';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { SOURCES } from '../data/sampleData';
import { useHealthProvider } from '../health/HealthContext';
import type { HealthSnapshot } from '../health/types';
import { useAuth } from '../auth/AuthContext';
import type { AuthProviderId } from '../auth/types';
import { isSupabaseConfigured } from '../lib/supabase';
import * as notifications from '../notifications/supabaseNotifications';

const SOURCE_ICON: Record<string, React.ComponentType<any>> = {
  'Apple Health': AppleLogoIcon,
  'Health Connect': AndroidLogoIcon,
};

// Moved here from HomeScreen, which used to show this device's own real
// sync status (formerly a badge + "Sync now" button above Today's metric
// tiles) — that's data-source management, so it belongs in the
// "Connected sources" card below instead. Home kept the metric tiles
// themselves (Steps/Distance), which still read from their own snapshot.
function timeAgo(d: Date | null): string {
  if (!d) return '—';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)}h ago`;
}

const PROVIDER_LABEL: Record<AuthProviderId, string> = {
  google: 'Google',
  facebook: 'Facebook',
  apple: 'Apple',
  email: 'Email & password',
};

export function SettingsScreen() {
  const health = useHealthProvider();
  const { user, signOut } = useAuth();
  const { colors, text, mode, setMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // This device's own real sync status, for whichever "Connected sources"
  // row matches health.platformLabel below — every other row there is
  // still SOURCES' static sample data (a different, pre-existing gap;
  // not what moved here from Home).
  const [snap, setSnap] = useState<HealthSnapshot | null>(null);
  const reloadSnap = useCallback(() => {
    health.getSnapshot().then(setSnap);
  }, [health]);
  useFocusEffect(reloadSnap);

  // Login-reminder preferences live on the real profiles row — there's no
  // sample-fallback version of this like other screens have, since
  // without a real backend there's nothing to check someone into daily.
  // null while unresolved (mirrors HomeScreen's loadingPrimary) so the
  // toggles don't flash a default before the real values load.
  const [pushEnabled, setPushEnabledState] = useState<boolean | null>(null);
  const [emailEnabled, setEmailEnabledState] = useState<boolean | null>(null);
  const [savingChannel, setSavingChannel] = useState<'push' | 'email' | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured || !user?.id) return;
      notifications
        .getPreferences(user.id)
        .then((prefs) => {
          setPushEnabledState(prefs.pushEnabled);
          setEmailEnabledState(prefs.emailEnabled);
        })
        .catch(() => {
          // Leave the toggles unresolved (still hidden, see the render
          // below) rather than guessing a default.
        });
    }, [user?.id]),
  );

  // Two of the three Alerts toggles — see notifications/types.ts's own
  // comment on why the third (proximity) isn't part of this shape.
  const [staleDataEnabled, setStaleDataEnabledState] = useState<boolean | null>(null);
  const [dailyStandingsEnabled, setDailyStandingsEnabledState] = useState<boolean | null>(null);
  const [savingAlert, setSavingAlert] = useState<'staleData' | 'dailyStandings' | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured || !user?.id) return;
      notifications
        .getAlertPreferences(user.id)
        .then((prefs) => {
          setStaleDataEnabledState(prefs.staleDataEnabled);
          setDailyStandingsEnabledState(prefs.dailyStandingsEnabled);
        })
        .catch(() => {
          // Same "leave it unresolved rather than guess" reasoning the
          // login-reminder fetch above uses.
        });
    }, [user?.id]),
  );

  const toggleStaleData = async (next: boolean) => {
    if (!user?.id) return;
    setSavingAlert('staleData');
    try {
      await notifications.setStaleDataAlertEnabled(user.id, next);
      setStaleDataEnabledState(next);
    } catch (err) {
      Alert.alert('Stale data alert', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingAlert(null);
    }
  };

  const toggleDailyStandings = async (next: boolean) => {
    if (!user?.id) return;
    setSavingAlert('dailyStandings');
    try {
      await notifications.setDailyStandingsAlertEnabled(user.id, next);
      setDailyStandingsEnabledState(next);
    } catch (err) {
      Alert.alert('Daily standings alert', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingAlert(null);
    }
  };

  const togglePush = async (next: boolean) => {
    if (!user?.id) return;
    setSavingChannel('push');
    try {
      await notifications.setPushEnabled(user.id, next);
      setPushEnabledState(next);
    } catch (err) {
      Alert.alert('Push reminders', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingChannel(null);
    }
  };

  const toggleEmail = async (next: boolean) => {
    if (!user?.id) return;
    setSavingChannel('email');
    try {
      await notifications.setEmailEnabled(user.id, next);
      setEmailEnabledState(next);
    } catch (err) {
      Alert.alert('Email reminders', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingChannel(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={text.h2}>Data & account</Text>

      <Card style={{ gap: 14 }} elevated={false}>
        <Text style={text.h4}>Appearance</Text>
        <ToggleRow
          label="Light mode"
          note="Use a bright background with dark text instead of Hound's usual dark theme"
          value={mode === 'light'}
          onChange={(v) => setMode(v ? 'light' : 'dark')}
        />
      </Card>

      {user && (
        <Card style={styles.accountRow} elevated={false}>
          <Avatar initials={user.initials} tint={colors.accent800} size={40} fontSize={14} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.sourceName}>{user.name}</Text>
            <Text style={styles.footNote}>
              {user.email} · Signed in with {PROVIDER_LABEL[user.provider]}
            </Text>
          </View>
          <Button
            label="Log out"
            small
            icon={<SignOutIcon size={14} color={colors.text} />}
            onPress={signOut}
          />
        </Card>
      )}

      <Card style={{ gap: 12 }} elevated={false}>
        <Text style={text.h4}>Connected sources</Text>
        {SOURCES.map((s) => {
          const Icon = SOURCE_ICON[s.name] ?? ScalesIcon;
          const isThisDevicesPlatform = s.name === health.platformLabel;
          return (
            <View key={s.name} style={styles.sourceRow}>
              <View style={[styles.sourceIcon, { backgroundColor: s.tint }]}>
                <Icon size={18} color={colors.text} weight={s.name === 'Apple Health' ? 'fill' : 'regular'} />
              </View>
              <View style={{ flex: 1, gap: 2, minWidth: 130 }}>
                <Text style={styles.sourceName}>{s.name}</Text>
                {isThisDevicesPlatform ? (
                  <Text style={[styles.sourceStatus, { color: color.green }]}>
                    Synced {timeAgo(snap?.lastSyncedAt ?? null)}
                  </Text>
                ) : (
                  <Text style={[styles.sourceStatus, { color: s.statusColor }]}>{s.status}</Text>
                )}
              </View>
              <Text style={styles.sourceScope}>{s.scope}</Text>
              {isThisDevicesPlatform ? (
                <Pressable style={styles.syncBtn} onPress={reloadSnap}>
                  <ArrowsClockwiseIcon size={13} color={colors.accent} />
                  <Text style={styles.syncLabel}>Sync now</Text>
                </Pressable>
              ) : (
                <Button label={s.action} small variant="secondary" />
              )}
            </View>
          );
        })}
        <Text style={styles.footNote}>
          Hound reads steps, workouts, distance, heart rate and weight. It never writes back to
          either platform.
        </Text>
      </Card>

      {isSupabaseConfigured && staleDataEnabled !== null && dailyStandingsEnabled !== null && (
        <Card style={{ gap: 14 }} elevated={false}>
          <Text style={text.h4}>Alerts</Text>
          {/* A third alert ("Someone closes within 2 miles of me")
              belongs here too, but needs live GPS tracking this app
              doesn't have any infrastructure for yet — left out rather
              than shown wired to nothing. See notifications/types.ts. */}
          <ToggleRow
            label="A friend's data goes stale mid-challenge"
            note={savingAlert === 'staleData' ? 'Saving…' : 'All challenges'}
            value={staleDataEnabled}
            onChange={toggleStaleData}
          />
          <ToggleRow
            label="Daily standings at 8pm"
            note={savingAlert === 'dailyStandings' ? 'Saving…' : 'Step races'}
            value={dailyStandingsEnabled}
            onChange={toggleDailyStandings}
          />
        </Card>
      )}

      {isSupabaseConfigured && pushEnabled !== null && emailEnabled !== null && (
        <Card style={{ gap: 14 }} elevated={false}>
          <Text style={text.h4}>Login reminders</Text>
          <Text style={styles.footNote}>
            If you haven&rsquo;t opened Hound today, we&rsquo;ll nudge you before the day&rsquo;s over.
          </Text>
          <ToggleRow
            label="Push notification"
            note={savingChannel === 'push' ? 'Saving…' : 'Sent to this device'}
            value={pushEnabled}
            onChange={togglePush}
          />
          <ToggleRow
            label="Email"
            note={savingChannel === 'email' ? 'Saving…' : user?.email ?? ''}
            value={emailEnabled}
            onChange={toggleEmail}
          />
        </Card>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 14, paddingBottom: 48 },
    accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    sourceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.07),
      flexWrap: 'wrap',
    },
    sourceIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    sourceName: { fontSize: 14.5, color: colors.text },
    sourceStatus: { fontSize: 12 },
    sourceScope: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingVertical: 4 },
    syncLabel: { fontSize: 12, color: colors.accent, fontFamily: font.heading },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
  });
}
