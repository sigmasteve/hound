import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import { AndroidLogoIcon, ArrowsClockwiseIcon, AppleLogoIcon, ScalesIcon, SignOutIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ToggleRow } from '../components/Selectable';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { SOURCES } from '../data/sampleData';
import { useHealthProvider } from '../health/HealthContext';
import type { HealthSnapshot } from '../health/types';
import { useAuth } from '../auth/AuthContext';
import type { AuthProviderId } from '../auth/types';
import { isSupabaseConfigured } from '../lib/supabase';
import * as notifications from '../notifications/supabaseNotifications';
import { setUseUsername, setUsername } from '../profiles/supabaseProfile';
import { getOrganization, leaveOrganization, redeemOrganizationInvite } from '../organizations/supabaseOrganizations';
import type { Organization } from '../organizations/types';

const USERNAME_FORMAT = /^[A-Za-z0-9_]{3,20}$/;

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

// app.json's own "version" — bump that alongside every APK cut on the
// download page (see site/download.html) to keep the two in sync;
// nothing enforces that automatically. Never null in a real build (only
// Constants.expoConfig itself can be, e.g. some bare/dev-client setups),
// but falls back rather than showing "undefined" on the one screen
// meant to make this legible to whoever's reporting a bug.
const APP_VERSION = Constants.expoConfig?.version ?? 'unknown';

export function SettingsScreen() {
  const health = useHealthProvider();
  const { user, signOut, updateUser } = useAuth();
  const { colors, text, mode, setMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Seeded from the signed-in user, not a separate fetch — profiles.username
  // /use_username (0030_username.sql) already come back on sign-in (see
  // supabaseAuth.ts's userFromSession), so there's nothing else to load.
  const [usernameInput, setUsernameInput] = useState(user?.username ?? '');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [savingUsername, setSavingUsername] = useState(false);
  const [savingUseUsername, setSavingUseUsername] = useState(false);

  const saveUsername = async () => {
    if (!user?.id) return;
    const trimmed = usernameInput.trim();
    if (trimmed && !USERNAME_FORMAT.test(trimmed)) {
      setUsernameError('3–20 letters, numbers, or underscores.');
      return;
    }
    setUsernameError(null);
    setSavingUsername(true);
    try {
      await setUsername(user.id, trimmed || null);
      // Clearing the username makes "use it in challenges" meaningless —
      // turn that back off too rather than leaving a stale true with
      // nothing left to show.
      if (!trimmed && user.useUsername) await setUseUsername(user.id, false);
      updateUser({ username: trimmed || null, useUsername: trimmed ? user.useUsername : false });
    } catch (e) {
      setUsernameError(e instanceof Error ? e.message : 'Could not save that — try again.');
    } finally {
      setSavingUsername(false);
    }
  };

  const toggleUseUsername = async (next: boolean) => {
    if (!user?.id) return;
    setSavingUseUsername(true);
    try {
      await setUseUsername(user.id, next);
      updateUser({ useUsername: next });
    } catch {
      // No dedicated error UI for this toggle — same as every other
      // plain on/off preference on this screen.
    } finally {
      setSavingUseUsername(false);
    }
  };
  // Organization membership — see GitHub issue #158. No org yet shows a
  // join-by-code form (redeem_organization_invite); already in one shows
  // who and a way out (leave_organization). Managing an org you admin
  // (invite code, members, labels) lives in OrgDetailScreen instead,
  // reached via TopNav's own org icon — this card is just the individual
  // member's own join/leave, the same way the account row above is your
  // own account, not account administration.
  const [org, setOrg] = useState<Organization | null>(null);
  const [orgLoadError, setOrgLoadError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured || !user?.organizationId) {
        setOrg(null);
        return;
      }
      getOrganization(user.organizationId)
        .then(setOrg)
        .catch((e) => setOrgLoadError(e instanceof Error ? e.message : 'Could not load your organization.'));
    }, [user?.organizationId]),
  );

  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const submitJoin = async () => {
    const code = inviteCodeInput.trim();
    if (!code) {
      setJoinError('Enter an invite code.');
      return;
    }
    setJoinError(null);
    setJoining(true);
    try {
      const organizationId = await redeemOrganizationInvite(code);
      const joined = await getOrganization(organizationId);
      setOrg(joined);
      setInviteCodeInput('');
      updateUser({ organizationId, orgRole: 'member' });
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'Could not join with that code.');
    } finally {
      setJoining(false);
    }
  };

  const [leaving, setLeaving] = useState(false);
  const confirmLeave = () => {
    Alert.alert(
      `Leave ${org?.name ?? 'this organization'}?`,
      "You'll need a new invite code to join again — challenges and friends you already have are unaffected.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setLeaving(true);
            try {
              await leaveOrganization();
              setOrg(null);
              updateUser({ organizationId: null, orgRole: null });
            } catch (e) {
              Alert.alert('Could not leave', e instanceof Error ? e.message : 'Try again.');
            } finally {
              setLeaving(false);
            }
          },
        },
      ],
    );
  };

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

  // Two of the three Alerts, each its own Push + Email pair — see
  // notifications/types.ts's own comment on why the third (proximity)
  // isn't part of this shape.
  const [staleDataPushEnabled, setStaleDataPushEnabledState] = useState<boolean | null>(null);
  const [staleDataEmailEnabled, setStaleDataEmailEnabledState] = useState<boolean | null>(null);
  const [dailyStandingsPushEnabled, setDailyStandingsPushEnabledState] = useState<boolean | null>(null);
  const [dailyStandingsEmailEnabled, setDailyStandingsEmailEnabledState] = useState<boolean | null>(null);
  const [savingAlert, setSavingAlert] = useState<
    'staleDataPush' | 'staleDataEmail' | 'dailyStandingsPush' | 'dailyStandingsEmail' | null
  >(null);

  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured || !user?.id) return;
      notifications
        .getAlertPreferences(user.id)
        .then((prefs) => {
          setStaleDataPushEnabledState(prefs.staleDataPushEnabled);
          setStaleDataEmailEnabledState(prefs.staleDataEmailEnabled);
          setDailyStandingsPushEnabledState(prefs.dailyStandingsPushEnabled);
          setDailyStandingsEmailEnabledState(prefs.dailyStandingsEmailEnabled);
        })
        .catch(() => {
          // Same "leave it unresolved rather than guess" reasoning the
          // login-reminder fetch above uses.
        });
    }, [user?.id]),
  );

  const toggleStaleDataPush = async (next: boolean) => {
    if (!user?.id) return;
    setSavingAlert('staleDataPush');
    try {
      await notifications.setStaleDataPushEnabled(user.id, next);
      setStaleDataPushEnabledState(next);
    } catch (err) {
      Alert.alert('Stale data alert', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingAlert(null);
    }
  };

  const toggleStaleDataEmail = async (next: boolean) => {
    if (!user?.id) return;
    setSavingAlert('staleDataEmail');
    try {
      await notifications.setStaleDataEmailEnabled(user.id, next);
      setStaleDataEmailEnabledState(next);
    } catch (err) {
      Alert.alert('Stale data alert', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingAlert(null);
    }
  };

  const toggleDailyStandingsPush = async (next: boolean) => {
    if (!user?.id) return;
    setSavingAlert('dailyStandingsPush');
    try {
      await notifications.setDailyStandingsPushEnabled(user.id, next);
      setDailyStandingsPushEnabledState(next);
    } catch (err) {
      Alert.alert('Daily standings alert', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingAlert(null);
    }
  };

  const toggleDailyStandingsEmail = async (next: boolean) => {
    if (!user?.id) return;
    setSavingAlert('dailyStandingsEmail');
    try {
      await notifications.setDailyStandingsEmailEnabled(user.id, next);
      setDailyStandingsEmailEnabledState(next);
    } catch (err) {
      Alert.alert('Daily standings alert', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingAlert(null);
    }
  };

  // "Fire it now" buttons for the three cron-driven notification jobs —
  // only ever rendered for user?.isAdmin below, a real database-set flag
  // (see 0021_admin_flag.sql), same gate the Edge Functions themselves
  // enforce (see each one's own comment) alongside the cron job's own
  // service-role call. Deliberately not also gated on __DEV__: that's
  // only ever true through Metro's own dev server, not an installed
  // TestFlight/production build, which is how this app actually gets
  // tested day to day. Lets the two new Alerts toggles (and Login
  // reminders) get tested in minutes instead of waiting for tomorrow's
  // schedule.
  const [triggering, setTriggering] = useState<'login' | 'staleData' | 'dailyStandings' | null>(null);

  const runTrigger = async (
    which: 'login' | 'staleData' | 'dailyStandings',
    fn: () => Promise<Record<string, unknown>>,
  ) => {
    setTriggering(which);
    try {
      const result = await fn();
      Alert.alert('Sent', JSON.stringify(result));
    } catch (err) {
      Alert.alert('Could not trigger', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setTriggering(null);
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

      {isSupabaseConfigured && user && (
        <Card style={{ gap: 14 }} elevated={false}>
          <Text style={text.h4}>Organization</Text>
          {user.organizationId ? (
            <>
              {orgLoadError && <Text style={styles.footNoteError}>{orgLoadError}</Text>}
              {org ? (
                <Text style={styles.footNote}>
                  You&rsquo;re a {user.orgRole === 'admin' ? 'admin' : 'member'} of {org.name} (
                  {org.kind === 'school' ? 'school' : 'company'}).
                </Text>
              ) : (
                !orgLoadError && <Text style={styles.footNote}>Loading…</Text>
              )}
              <Button
                label={leaving ? 'Leaving…' : 'Leave organization'}
                small
                variant="secondary"
                disabled={leaving}
                onPress={confirmLeave}
              />
            </>
          ) : (
            <>
              <Text style={styles.footNote}>Have an invite code from a school or company? Enter it here to join.</Text>
              <TextField
                label="Invite code"
                value={inviteCodeInput}
                onChangeText={setInviteCodeInput}
                placeholder="e.g. 7K3PQMXR"
                autoCapitalize="characters"
                autoCorrect={false}
                error={joinError ?? undefined}
              />
              <Button
                label={joining ? 'Joining…' : 'Join'}
                variant="secondary"
                small
                disabled={joining || !inviteCodeInput.trim()}
                onPress={submitJoin}
              />
            </>
          )}
        </Card>
      )}

      {isSupabaseConfigured && user && (
        <Card style={{ gap: 14 }} elevated={false}>
          <Text style={text.h4}>Username</Text>
          <Text style={styles.footNote}>
            Show a username instead of your real name in challenge leaderboards and invites.
          </Text>
          <TextField
            label="Username"
            value={usernameInput}
            onChangeText={setUsernameInput}
            placeholder="NightRunner99"
            autoCapitalize="none"
            autoCorrect={false}
            error={usernameError ?? undefined}
          />
          <Button
            label={savingUsername ? 'Saving…' : 'Save username'}
            variant="secondary"
            small
            disabled={savingUsername || usernameInput.trim() === (user.username ?? '')}
            onPress={saveUsername}
          />
          {user.username ? (
            <ToggleRow
              label="Use username in challenges"
              note={savingUseUsername ? 'Saving…' : 'Instead of your real name'}
              value={!!user.useUsername}
              onChange={toggleUseUsername}
            />
          ) : (
            <Text style={styles.footNote}>Set a username above to enable this.</Text>
          )}
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

      {isSupabaseConfigured &&
        staleDataPushEnabled !== null &&
        staleDataEmailEnabled !== null &&
        dailyStandingsPushEnabled !== null &&
        dailyStandingsEmailEnabled !== null && (
          <Card style={{ gap: 16 }} elevated={false}>
            <Text style={text.h4}>Alerts</Text>
            {/* A third alert ("Someone closes within 2 miles of me")
                belongs here too, but needs live GPS tracking this app
                doesn't have any infrastructure for yet — left out
                rather than shown wired to nothing. See
                notifications/types.ts. */}
            <View style={{ gap: 10 }}>
              <Text style={styles.alertGroupLabel}>A friend's data goes stale mid-challenge — all challenges</Text>
              <ToggleRow
                label="Push notification"
                note={savingAlert === 'staleDataPush' ? 'Saving…' : 'Sent to this device'}
                value={staleDataPushEnabled}
                onChange={toggleStaleDataPush}
              />
              <ToggleRow
                label="Email"
                note={savingAlert === 'staleDataEmail' ? 'Saving…' : user?.email ?? ''}
                value={staleDataEmailEnabled}
                onChange={toggleStaleDataEmail}
              />
            </View>
            <View style={{ gap: 10 }}>
              <Text style={styles.alertGroupLabel}>Daily standings at 8pm — step races</Text>
              <ToggleRow
                label="Push notification"
                note={savingAlert === 'dailyStandingsPush' ? 'Saving…' : 'Sent to this device'}
                value={dailyStandingsPushEnabled}
                onChange={toggleDailyStandingsPush}
              />
              <ToggleRow
                label="Email"
                note={savingAlert === 'dailyStandingsEmail' ? 'Saving…' : user?.email ?? ''}
                value={dailyStandingsEmailEnabled}
                onChange={toggleDailyStandingsEmail}
              />
            </View>
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

      {isSupabaseConfigured && user?.isAdmin && (
        <Card style={{ gap: 10 }} elevated={false}>
          <Text style={text.h4}>Developer tools</Text>
          <Text style={styles.footNote}>
            Fire a notification job right now instead of waiting for its daily schedule.
          </Text>
          <Button
            label={triggering === 'login' ? 'Sending…' : 'Test: Login reminders'}
            small
            disabled={triggering !== null}
            onPress={() => runTrigger('login', notifications.triggerLoginReminders)}
          />
          <Button
            label={triggering === 'staleData' ? 'Sending…' : 'Test: Stale data alert'}
            small
            disabled={triggering !== null}
            onPress={() => runTrigger('staleData', notifications.triggerStaleDataAlerts)}
          />
          <Button
            label={triggering === 'dailyStandings' ? 'Sending…' : 'Test: Daily standings'}
            small
            disabled={triggering !== null}
            onPress={() => runTrigger('dailyStandings', notifications.triggerDailyStandings)}
          />
        </Card>
      )}

      <Text style={styles.versionNote}>Hound v{APP_VERSION}</Text>
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
    footNoteError: { fontSize: 12.5, color: colors.amber },
    alertGroupLabel: { fontSize: 13.5, color: colors.text, fontFamily: font.heading },
    versionNote: { fontSize: 12, color: withAlpha(colors.text, 0.4), textAlign: 'center', marginTop: 4 },
  });
}
