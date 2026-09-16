import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AndroidLogoIcon, AppleLogoIcon, ScalesIcon, SignOutIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { RadioPill, ToggleRow } from '../components/Selectable';
import { SegmentedControl } from '../components/SegmentedControl';
import { text } from '../theme/text';
import { color, font } from '../theme/tokens';
import { ALERT_DEFS, SOURCES } from '../data/sampleData';
import { useHealthProvider } from '../health/HealthContext';
import { useAuth } from '../auth/AuthContext';
import type { AuthProviderId } from '../auth/types';
import { isSupabaseConfigured } from '../lib/supabase';
import * as notifications from '../notifications/supabaseNotifications';

const SOURCE_ICON: Record<string, React.ComponentType<any>> = {
  'Apple Health': AppleLogoIcon,
  'Health Connect': AndroidLogoIcon,
  'Withings Scale': ScalesIcon,
};

const PROVIDER_LABEL: Record<AuthProviderId, string> = {
  google: 'Google',
  facebook: 'Facebook',
  apple: 'Apple',
  email: 'Email & password',
};

export function SettingsScreen() {
  const health = useHealthProvider();
  const { user, signOut } = useAuth();
  const [alerts, setAlerts] = useState(ALERT_DEFS.map((a) => a.defaultOn));
  const [conflict, setConflict] = useState<'device' | 'apple' | 'ask'>('device');
  const [units, setUnits] = useState<'imperial' | 'metric'>('imperial');

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

      {user && (
        <Card style={styles.accountRow} elevated={false}>
          <Avatar initials={user.initials} tint={color.accent800} size={40} fontSize={14} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.sourceName}>{user.name}</Text>
            <Text style={styles.footNote}>
              {user.email} · Signed in with {PROVIDER_LABEL[user.provider]}
            </Text>
          </View>
          <Button
            label="Log out"
            small
            icon={<SignOutIcon size={14} color={color.text} />}
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
                <Icon size={18} color={color.text} weight={s.name === 'Apple Health' ? 'fill' : 'regular'} />
              </View>
              <View style={{ flex: 1, gap: 2, minWidth: 130 }}>
                <Text style={styles.sourceName}>{s.name}</Text>
                <Text style={[styles.sourceStatus, { color: s.statusColor }]}>{s.status}</Text>
              </View>
              <Text style={styles.sourceScope}>{s.scope}</Text>
              <Button label={s.action} small variant={isThisDevicesPlatform ? 'primary' : 'secondary'} />
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

const styles = StyleSheet.create({
  container: { padding: 16, gap: 14, paddingBottom: 48 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(233,233,237,0.07)',
    flexWrap: 'wrap',
  },
  sourceIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sourceName: { fontSize: 14.5, color: color.text },
  sourceStatus: { fontSize: 12 },
  sourceScope: { fontSize: 12, color: 'rgba(233,233,237,0.55)' },
  footNote: { fontSize: 12.5, color: 'rgba(233,233,237,0.55)' },
});
