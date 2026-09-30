import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import {
  AndroidLogoIcon,
  ArrowsClockwiseIcon,
  AppleLogoIcon,
  CaretRightIcon,
  ScalesIcon,
  SignOutIcon,
  XIcon,
} from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ToggleRow } from '../components/Selectable';
import { ProgressBar } from '../components/ProgressBar';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { useGoals } from '../goals/GoalsContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { SOURCES } from '../data/sampleData';
import { useHealthProvider } from '../health/HealthContext';
import type { HealthSnapshot } from '../health/types';
import { useAuth } from '../auth/AuthContext';
import type { AuthProviderId } from '../auth/types';
import { isSupabaseConfigured } from '../lib/supabase';
import { APP_VERSION } from '../lib/appVersion';
import * as notifications from '../notifications/supabaseNotifications';
import {
  getLocalRemindersEnabled,
  getReminderPermission,
  setLocalRemindersEnabled,
} from '../notifications/localReminders';
import { setUseUsername, setUsername } from '../profiles/supabaseProfile';
import { getOrganization, leaveOrganization, redeemOrganizationInvite } from '../organizations/supabaseOrganizations';
import { getMyHoundScore, type HoundScore } from '../challenges/scoreApi';
import { levelProgressForXp } from '../challenges/leveling';
import { getMyEquippedCosmetics, type EquippedCosmetics } from '../cosmetics/cosmeticsApi';
import { listAchievements, listEarnedAchievements } from '../achievements/achievementsApi';
import type { Organization } from '../organizations/types';
import { getDiscoverable, setDiscoverable } from '../friends/discovery';
import {
  askForPush,
  getPushPermission,
  openPhoneSettings,
  syncPushRegistration,
  type PushPermission,
} from '../notifications/pushPermission';

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

export function SettingsScreen({
  onOpenLocker,
  onOpenAchievements,
}: {
  onOpenLocker: () => void;
  onOpenAchievements: () => void;
}) {
  const health = useHealthProvider();
  const { user, signOut, updateUser } = useAuth();
  const { colors, text, mode, setMode } = useTheme();
  const { stepsGoal, distanceGoalMi, setStepsGoal, setDistanceGoalMi } = useGoals();
  // Shown while a slider is mid-drag; the goal itself only saves on release.
  const [stepsDraft, setStepsDraft] = useState<number | null>(null);
  const [distanceDraft, setDistanceDraft] = useState<number | null>(null);
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

  // Whether this account shows up in Friends → Find people (0080). Null
  // until loaded, or before 0080 has run — the toggle stays hidden then.
  const [discoverable, setDiscoverableState] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isSupabaseConfigured || !user?.id) return;
    getDiscoverable(user.id).then(setDiscoverableState);
  }, [user?.id]);
  const toggleDiscoverable = (next: boolean) => {
    if (!user?.id) return;
    setDiscoverableState(next);
    setDiscoverable(user.id, next).catch(() => setDiscoverableState(!next));
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

  // Null covers both "hasn't loaded yet" and "failed to load" — same
  // "never show a confident wrong number" reasoning as every other
  // real-data fetch in this app. The card below just doesn't render
  // rather than showing a guessed 0, which could otherwise misread as a
  // genuine (if unfortunate) score.
  const [houndScore, setHoundScore] = useState<HoundScore | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured || !user?.id) {
        setHoundScore(null);
        return;
      }
      getMyHoundScore(user.id)
        .then(setHoundScore)
        .catch(() => setHoundScore(null));
    }, [user?.id]),
  );

  // "N of M" on the Achievements row — hidden until it loads (or if it
  // can't), rather than a guessed count.
  const [achievementCounts, setAchievementCounts] = useState<{ earned: number; total: number } | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured || !user?.id) return;
      Promise.all([listAchievements(), listEarnedAchievements(user.id)])
        .then(([all, mine]) => setAchievementCounts({ earned: all.filter((a) => mine.has(a.id)).length, total: all.length }))
        .catch(() => setAchievementCounts(null));
    }, [user?.id]),
  );

  // Same null-means-unresolved-or-failed shape as houndScore above — the
  // account row's Avatar below just renders its plain default look until
  // this actually resolves, rather than a guessed empty state.
  const [equipped, setEquipped] = useState<EquippedCosmetics | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured || !user?.id) {
        setEquipped(null);
        return;
      }
      getMyEquippedCosmetics(user.id)
        .then(setEquipped)
        .catch(() => setEquipped(null));
    }, [user?.id]),
  );

  // A one-line explainer under the Hound Score card, dismissed for good
  // once tapped away — same local (AsyncStorage), per-device, shown-once
  // shape as ChallengeDetailScreen's own Tag/Chase explainers, just an
  // X-dismiss row (HomeScreen's own version-update banner) rather than a
  // whole card with a "Got it" button, since this is one sentence, not a
  // multi-paragraph mechanic to teach.
  const SCORE_EXPLAINER_DISMISSED_KEY = 'houndScoreExplainerDismissed';
  const [showScoreExplainer, setShowScoreExplainer] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      AsyncStorage.getItem(SCORE_EXPLAINER_DISMISSED_KEY)
        .then((dismissed) => {
          if (!cancelled && dismissed !== 'true') setShowScoreExplainer(true);
        })
        .catch(() => {
          // Best-effort — if this can't be read, just don't show it
          // rather than risk showing it every single time.
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );
  const dismissScoreExplainer = () => {
    setShowScoreExplainer(false);
    AsyncStorage.setItem(SCORE_EXPLAINER_DISMISSED_KEY, 'true').catch(() => {
      // Best-effort — worst case it shows again next time.
    });
  };

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

  // The phone's own notification setting (src/notifications/
  // pushPermission.ts). The toggles below are Hound's preferences — they
  // read as on by default — but nothing reaches a phone that hasn't
  // allowed notifications, so say so. Re-checked when coming back from
  // the phone's Settings, and registers the phone if they turned it on
  // there.
  const [phonePush, setPhonePush] = useState<PushPermission | null>(null);
  const phonePushRef = useRef<PushPermission | null>(null);
  const [askingPush, setAskingPush] = useState(false);
  useFocusEffect(
    useCallback(() => {
      const check = () =>
        getPushPermission().then((p) => {
          const prev = phonePushRef.current;
          if (p === 'granted' && prev && prev !== 'granted' && user?.id) syncPushRegistration(user.id);
          phonePushRef.current = p;
          setPhonePush(p);
        });
      check();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') check();
      });
      return () => sub.remove();
    }, [user?.id]),
  );
  const turnOnPhonePush = async () => {
    if (!user?.id) return;
    setAskingPush(true);
    const p = await askForPush(user.id);
    phonePushRef.current = p;
    setPhonePush(p);
    setAskingPush(false);
  };

  // On-device reminders (src/notifications/localReminders.ts) — a device
  // preference, not a profiles column, since they're scheduled locally
  // per phone. Reads as on only when both the preference and the OS
  // permission allow it, so a denied permission never shows a toggle
  // that looks on but delivers nothing.
  const [localRemindersOn, setLocalRemindersOn] = useState<boolean | null>(null);
  const [savingLocalReminders, setSavingLocalReminders] = useState(false);
  useFocusEffect(
    useCallback(() => {
      Promise.all([getLocalRemindersEnabled(), getReminderPermission()])
        .then(([enabled, permission]) => setLocalRemindersOn(enabled && permission === 'granted'))
        .catch(() => setLocalRemindersOn(false));
    }, []),
  );
  const toggleLocalReminders = async (next: boolean) => {
    setSavingLocalReminders(true);
    try {
      await setLocalRemindersEnabled(next);
      setLocalRemindersOn(next);
    } catch (err) {
      Alert.alert('Daily reminders', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingLocalReminders(false);
    }
  };

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

  // The six toggles above used to show as two separate cards with no
  // single on/off switch — every user had to visit three group headers
  // just to turn push (or email) off entirely. These two "everything at
  // once" toggles drive all three category toggles together; the
  // category-level controls still exist underneath, in "Advanced", for
  // anyone who wants push for one thing but not another.
  const [notificationsAdvancedExpanded, setNotificationsAdvancedExpanded] = useState(false);
  const [masterToggling, setMasterToggling] = useState<'push' | 'email' | null>(null);
  const allPushEnabled = pushEnabled === true && staleDataPushEnabled === true && dailyStandingsPushEnabled === true;
  const allEmailEnabled =
    emailEnabled === true && staleDataEmailEnabled === true && dailyStandingsEmailEnabled === true;

  const toggleMasterPush = async (next: boolean) => {
    setMasterToggling('push');
    await Promise.all([togglePush(next), toggleStaleDataPush(next), toggleDailyStandingsPush(next)]);
    setMasterToggling(null);
  };

  const toggleMasterEmail = async (next: boolean) => {
    setMasterToggling('email');
    await Promise.all([toggleEmail(next), toggleStaleDataEmail(next), toggleDailyStandingsEmail(next)]);
    setMasterToggling(null);
  };

  const levelProgress = levelProgressForXp(houndScore?.xpTotal ?? 0);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={text.h2}>Data & account</Text>

      {houndScore && (
        <Card style={{ gap: 12 }} elevated={false}>
          <View style={styles.scoreHeader}>
            <View style={{ gap: 2 }}>
              <Text style={styles.scoreLabel}>Hound Score</Text>
              <Text style={styles.scoreValue}>{houndScore.houndScore.toLocaleString()}</Text>
            </View>
            <View style={styles.levelBadge}>
              <Text style={styles.levelBadgeText}>Lv {levelProgress.level}</Text>
            </View>
          </View>
          <View style={{ gap: 4 }}>
            <ProgressBar pct={levelProgress.pctToNextLevel} fillColor={color.accent} height={5} />
            <Text style={styles.footNote}>
              {levelProgress.xpIntoLevel.toLocaleString()} /{' '}
              {(levelProgress.xpIntoLevel + levelProgress.xpToNextLevel).toLocaleString()} XP to level{' '}
              {levelProgress.level + 1}
            </Text>
          </View>
          {showScoreExplainer && (
            <View style={styles.scoreExplainerRow}>
              <Text style={styles.scoreExplainerText}>
                Hound Score reflects how much you&rsquo;ve played and won, across challenges. Level and XP track your
                participation, as well as rankings (win, lose, or draw).
              </Text>
              <Pressable onPress={dismissScoreExplainer} hitSlop={8}>
                <XIcon size={14} color={withAlpha(colors.text, 0.5)} />
              </Pressable>
            </View>
          )}
          <Pressable style={styles.lockerRow} onPress={onOpenLocker}>
            <Text style={styles.lockerRowLabel}>Customize your look</Text>
            <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
          </Pressable>
          <Pressable style={styles.lockerRow} onPress={onOpenAchievements}>
            <Text style={[styles.lockerRowLabel, { flex: 1 }]}>Achievements</Text>
            {achievementCounts && (
              <Text style={styles.achievementCount}>
                {achievementCounts.earned} of {achievementCounts.total}
              </Text>
            )}
            <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
          </Pressable>
        </Card>
      )}

      <Card style={{ gap: 14 }} elevated={false}>
        <Text style={text.h4}>Appearance</Text>
        <ToggleRow
          label="Light mode"
          note="Use a bright background with dark text instead of Hound's usual dark theme"
          value={mode === 'light'}
          onChange={(v) => setMode(v ? 'light' : 'dark')}
        />
      </Card>

      <Card style={{ gap: 14 }} elevated={false}>
        <Text style={text.h4}>Daily goals</Text>
        <View style={{ gap: 4 }}>
          <View style={styles.goalRow}>
            <Text style={styles.sourceName}>Steps</Text>
            <Text style={styles.goalValue}>{(stepsDraft ?? stepsGoal).toLocaleString()}</Text>
          </View>
          <Slider
            minimumValue={2_000}
            maximumValue={30_000}
            step={500}
            value={stepsGoal}
            onValueChange={(v) => setStepsDraft(Math.round(v))}
            onSlidingComplete={(v) => {
              setStepsGoal(Math.round(v));
              setStepsDraft(null);
            }}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.neutral700}
            thumbTintColor={colors.accent}
          />
        </View>
        <View style={{ gap: 4 }}>
          <View style={styles.goalRow}>
            <Text style={styles.sourceName}>Distance</Text>
            <Text style={styles.goalValue}>{distanceDraft ?? distanceGoalMi} mi</Text>
          </View>
          <Slider
            minimumValue={0.5}
            maximumValue={15}
            step={0.5}
            value={distanceGoalMi}
            onValueChange={(v) => setDistanceDraft(Math.round(v * 2) / 2)}
            onSlidingComplete={(v) => {
              setDistanceGoalMi(Math.round(v * 2) / 2);
              setDistanceDraft(null);
            }}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.neutral700}
            thumbTintColor={colors.accent}
          />
        </View>
        <Text style={styles.footNote}>Home&rsquo;s Steps and Distance bars fill toward these each day.</Text>
      </Card>

      {user && (
        <Card style={styles.accountRow} elevated={false}>
          <Avatar
            initials={user.initials}
            tint={colors.accent800}
            size={40}
            fontSize={14}
            frameId={equipped?.frameId}
            backgroundId={equipped?.backgroundId}
            iconId={equipped?.iconId}
          />
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
          {discoverable !== null && (
            <ToggleRow
              label="Show me in Find people"
              note={discoverable ? 'Friends can search for you' : 'Hidden from search'}
              value={discoverable}
              onChange={toggleDiscoverable}
            />
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
        pushEnabled !== null &&
        emailEnabled !== null &&
        staleDataPushEnabled !== null &&
        staleDataEmailEnabled !== null &&
        dailyStandingsPushEnabled !== null &&
        dailyStandingsEmailEnabled !== null && (
          <Card style={{ gap: 16 }} elevated={false}>
            <Text style={text.h4}>Notifications</Text>
            <Text style={styles.footNote}>
              Covers login reminders, Tag catch alerts, stale-data alerts, and daily standings.
            </Text>
            {phonePush === 'denied' && (
              <View style={styles.phonePushNote}>
                <Text style={styles.phonePushText}>
                  Notifications are turned off for Hound on this phone, so pushes can&rsquo;t reach you. Turn them on
                  in your phone&rsquo;s Settings.
                </Text>
                <Button label="Open Settings" small variant="secondary" onPress={openPhoneSettings} />
              </View>
            )}
            {phonePush === 'undetermined' && (
              <View style={styles.phonePushNote}>
                <Text style={styles.phonePushText}>
                  This phone isn&rsquo;t set up for push yet, so pushes can&rsquo;t reach you.
                </Text>
                <Button
                  label={askingPush ? 'Turning on…' : 'Turn on'}
                  small
                  variant="primary"
                  disabled={askingPush}
                  onPress={turnOnPhonePush}
                />
              </View>
            )}
            <ToggleRow
              label="Push notifications"
              note={masterToggling === 'push' ? 'Saving…' : 'Sent to this device'}
              value={allPushEnabled}
              onChange={toggleMasterPush}
            />
            <ToggleRow
              label="Email notifications"
              note={masterToggling === 'email' ? 'Saving…' : user?.email ?? ''}
              value={allEmailEnabled}
              onChange={toggleMasterEmail}
            />
            {localRemindersOn !== null && (
              <ToggleRow
                label="Daily reminders"
                note={savingLocalReminders ? 'Saving…' : 'Your daily bonus and anything still waiting on you'}
                value={localRemindersOn}
                onChange={toggleLocalReminders}
              />
            )}

            <Pressable
              style={styles.collapsibleHeader}
              onPress={() => setNotificationsAdvancedExpanded((e) => !e)}
            >
              <Text style={styles.collapsibleTitle}>Advanced</Text>
              <CaretRightIcon
                size={16}
                color={withAlpha(colors.text, 0.5)}
                style={{ transform: [{ rotate: notificationsAdvancedExpanded ? '90deg' : '0deg' }] }}
              />
            </Pressable>

            {notificationsAdvancedExpanded && (
              <View style={{ gap: 16 }}>
                <View style={{ gap: 10 }}>
                  <Text style={styles.alertGroupLabel}>
                    Login reminders &amp; Tag catch alerts — if you haven&rsquo;t opened Hound today, or
                    someone catches you in Tag
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
                </View>
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
              </View>
            )}
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
    phonePushNote: {
      gap: 10,
      padding: 12,
      borderRadius: 12,
      backgroundColor: withAlpha(colors.amber, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.amber, 0.4),
      alignItems: 'flex-start',
    },
    phonePushText: { fontSize: 12.5, color: colors.text },
    scoreHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    scoreLabel: { fontSize: 12, letterSpacing: 0.5, color: withAlpha(colors.text, 0.55) },
    scoreValue: { fontFamily: font.headingSemibold, fontSize: 26, color: colors.text },
    levelBadge: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: withAlpha(color.accent, 0.14),
    },
    levelBadgeText: { fontFamily: font.heading, fontSize: 13, color: color.accent },
    scoreExplainerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    scoreExplainerText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.65) },
    lockerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    lockerRowLabel: { fontSize: 14, color: colors.text, fontFamily: font.heading },
    achievementCount: { fontSize: 12.5, color: withAlpha(colors.text, 0.55), marginRight: 6 },
    goalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    goalValue: { fontSize: 14.5, color: colors.accent, fontFamily: font.heading },
    footNoteError: { fontSize: 12.5, color: colors.amber },
    alertGroupLabel: { fontSize: 13.5, color: colors.text, fontFamily: font.heading },
    collapsibleHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    collapsibleTitle: { fontSize: 15, fontFamily: font.heading, color: colors.text },
    versionNote: { fontSize: 12, color: withAlpha(colors.text, 0.4), textAlign: 'center', marginTop: 4 },
  });
}
