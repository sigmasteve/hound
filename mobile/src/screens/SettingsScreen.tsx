import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AndroidLogoIcon, ArrowsClockwiseIcon, AppleLogoIcon, ScalesIcon, SignOutIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { RadioPill, ToggleRow } from '../components/Selectable';
import { SegmentedControl } from '../components/SegmentedControl';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { ALERT_DEFS, SOURCES } from '../data/sampleData';
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
  const [alerts, setAlerts] = useState(ALERT_DEFS.map((a) => a.defaultOn));
  const [conflict, setConflict] = useState<'device' | 'apple' | 'ask'>('device');
  const [units, setUnits] = useState<'imperial' | 'metric'>('imperial');

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

      <Card style={{ gap: 14 }} elevated={false}>
        <Text style={text.h4}>Conflicts</Text>
        <Text style={styles.footNote}>When two sources report the same day, Hound keeps one. Pick which wins.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <RadioPill label="Highest-fidelity device" selected={conflict === 'device'} onPress={() => setConflict('device')} />
          <RadioPill label="Apple Health first" selected={conflict === 'apple'} onPress={() => setConflict('apple')} />
          <RadioPill label="Ask me each time" selected={conflict === 'ask'} onPress={() => setConflict('ask')} />
        </View>
        <View style={{ gap: 5 }}>
          <Text style={styles.footNote}>Units</Text>
          <SegmentedControl
            value={units}
            onChange={setUnits}
            options={[
              { value: 'imperial', label: 'Miles / lb' },
              { value: 'metric', label: 'Km / kg' },
            ]}
          />
        </View>
      </Card>

      <Card style={{ gap: 14 }} elevated={false}>
        <Text style={text.h4}>Alerts</Text>
        {ALERT_DEFS.map((a, i) => (
          <ToggleRow
            key={a.label}
            label={a.label}
            note={a.note}
            value={alerts[i]}
            onChange={(v) => setAlerts((cur) => cur.map((x, j) => (j === i ? v : x)))}
          />
        ))}
      </Card>

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
