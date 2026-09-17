import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon, ArrowsClockwiseIcon, RobotIcon, TrashIcon, TrophyIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ProgressBar } from '../components/ProgressBar';
import { Tag } from '../components/Tag';
import { TextField } from '../components/TextField';
import { ToggleRow } from '../components/Selectable';
import { text } from '../theme/text';
import { color, font, TINT_A, TINT_N } from '../theme/tokens';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { CHALLENGE_KIND_ICON } from '../data/challengeIcons';
import { supabaseChallengesProvider } from '../challenges/supabaseChallenges';
import {
  buildBoard,
  headStartDaysLeft as computeHeadStartDaysLeft,
  headStartEndDayKey,
  huntEffectiveMetric,
  withHuntCatches,
} from '../challenges/board';
import { daysElapsedFraction } from '../challenges/botSimulation';
import { boardSortFor, usesDeviceSteps, usesDistanceRanking, usesWorkoutDistance } from '../challenges/scoring';
import { HUNT_ROLE_LABEL, HUNT_ROLE_TAG_VARIANT } from '../challenges/present';
import type { Challenge, ChallengeBot, Participant, LeaderboardEntry } from '../challenges/types';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import type { Friend } from '../friends/types';
import { useAuth } from '../auth/AuthContext';
import { useHealthProvider } from '../health/HealthContext';

// The generic detail view for a real, Supabase-backed challenge of any
// kind — there's no per-kind template yet (HuntScreen is one specific
// hardcoded storyline, not reusable), so this renders the same for every
// kind: who's in it, who's logged what, and a way to log your own
// progress. A 'steps' challenge, and a 'hunt' scored on device steps or
// workout distance, are the exceptions — they have a real, unambiguous
// device number to draw from, so they auto-sync from HealthKit/Health
// Connect instead of showing the manual form. Fetches by id itself rather
// than taking pre-loaded data as props, so it works from any entry point.
export function ChallengeDetailScreen({
  challengeId,
  onBack,
  onGoHome,
}: {
  challengeId: string;
  onBack: () => void;
  onGoHome: () => void;
}) {
  const { user } = useAuth();
  const health = useHealthProvider();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [bots, setBots] = useState<ChallengeBot[]>([]);
  // Everyone's total as of the day the Hunted's head start ended — only
  // ever populated for a hunt with one (see load()); stays [] otherwise,
  // which buildBoard already treats as "nothing to credit."
  const [headStartLeaderboard, setHeadStartLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [stepsInput, setStepsInput] = useState('');
  const [distanceInput, setDistanceInput] = useState('');
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logSuccess, setLogSuccess] = useState(false);

  const [deviceSyncing, setDeviceSyncing] = useState(false);
  const [deviceSyncedAt, setDeviceSyncedAt] = useState<Date | null>(null);
  const [deviceSyncError, setDeviceSyncError] = useState<string | null>(null);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  // Friends invited this session but not yet reflected in `friends`
  // (accepting isn't instant, and this screen has no way to tell a
  // friend accepted a challenge invite vs. just hasn't yet) — purely a
  // local "Invited" label flip, not a source of truth.
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      // The challenge itself has to resolve first — whether a
      // head-start-baseline fetch is even worth making depends on its
      // own kind/headStartDays, which isn't known until this returns.
      const c = await supabaseChallengesProvider.getChallenge(challengeId);
      const needsHeadStart = c.kind === 'hunt' && !!c.headStartDays;
      const [p, l, b, f, hs] = await Promise.all([
        supabaseChallengesProvider.listParticipants(challengeId),
        supabaseChallengesProvider.getLeaderboard(challengeId),
        supabaseChallengesProvider.listBots(challengeId),
        supabaseFriendsProvider.listFriends(),
        needsHeadStart
          ? supabaseChallengesProvider.getLeaderboard(challengeId, headStartEndDayKey(c))
          : Promise.resolve<LeaderboardEntry[]>([]),
      ]);
      setChallenge(c);
      setParticipants(p);
      setLeaderboard(l);
      setBots(b);
      setFriends(f);
      setHeadStartLeaderboard(hs);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this challenge.');
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    load();
  }, [load]);

  // Notices "I've just been caught" and persists it — see
  // ChallengesProvider.markCaught and withHuntCatches for why this is the
  // caught person's own client doing the writing (only their own
  // participant row is theirs to update) rather than the Hunter's. Runs
  // on every load, not just the first — harmless, since it only ever
  // acts while this user's own stored role is still 'hunted'; once
  // markCaught lands and load() re-fetches, `mine.role` is 'zombie' and
  // this becomes a no-op.
  useEffect(() => {
    if (!challenge || challenge.kind !== 'hunt' || !user?.id) return;
    const mine = participants.find((p) => p.userId === user.id);
    if (mine?.role !== 'hunted') return;
    const sortBy = boardSortFor(challenge);
    const rawBoard = buildBoard(
      participants,
      leaderboard,
      bots,
      daysElapsedFraction(challenge),
      sortBy,
      challenge,
      headStartLeaderboard,
    );
    const caught = withHuntCatches(rawBoard, sortBy, challenge).find((r) => r.userId === user.id);
    if (caught?.role === 'zombie') {
      supabaseChallengesProvider.markCaught(challenge.id).then(load).catch(() => {});
    }
  }, [challenge, participants, leaderboard, bots, headStartLeaderboard, user?.id, load]);

  const [deleting, setDeleting] = useState(false);
  const [togglingHighlight, setTogglingHighlight] = useState(false);

  const toggleHighlight = async (next: boolean) => {
    setTogglingHighlight(true);
    try {
      await supabaseChallengesProvider.setHighlighted(challengeId, next);
      await load();
    } catch (e) {
      Alert.alert('Could not update', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setTogglingHighlight(false);
    }
  };

  const inviteFriend = async (friend: Friend) => {
    setInvitingId(friend.userId);
    try {
      await supabaseChallengesProvider.inviteFriendToChallenge(challengeId, friend.userId);
      setInvitedIds((cur) => new Set(cur).add(friend.userId));
    } catch (e) {
      // "Already invited" isn't really a failure from here — still mark
      // it, so the button reads the same either way.
      if (e instanceof Error && e.message === 'Already invited.') {
        setInvitedIds((cur) => new Set(cur).add(friend.userId));
      } else {
        Alert.alert('Could not invite', e instanceof Error ? e.message : 'Try again.');
      }
    } finally {
      setInvitingId(null);
    }
  };

  const confirmDelete = () => {
    if (!challenge) return;
    Alert.alert(
      'Delete this challenge?',
      `This removes "${challenge.name}" and everyone's progress in it for good. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await supabaseChallengesProvider.deleteChallenge(challengeId);
              onBack();
            } catch (e) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : 'Try again.');
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  // Backfills this challenge's entire progress from real device history —
  // every calendar day from when it started through today, not just
  // today — using the same upsert-by-day recordProgress() the manual form
  // uses, just filled in from the device instead of typed in. Re-running
  // this on every sync is deliberate and harmless (it's an upsert): it
  // catches up a challenge someone joined after it started, or picks back
  // up correctly after a few days of not opening the app, without a
  // separate "first ever sync" code path. Which number depends on what
  // this challenge is scored on: a plain step count, or distance summed
  // from logged workouts. The health abstraction has no true
  // GPS-verified flag, so 'gps_distance' is approximated as workouts
  // whose name reads like a run or walk — a treadmill session or a
  // phone-in-a-drawer walk would still slip through if its name happens
  // to match, which is a real limitation, not a hidden bug.
  const syncFromDevice = useCallback(async () => {
    if (!challenge) return;
    setDeviceSyncError(null);
    setDeviceSyncing(true);
    try {
      const since = new Date(challenge.startsAt);
      // Local-calendar day keys throughout — startDayKey/endCap have to
      // compare against dateKey()'s local dates the same way todayKey
      // does, or a day just outside the challenge's real range can slip
      // through (or a real one get excluded) at the UTC/local boundary.
      const startDayKey = dateKey(since);
      const endCap = dateKey(new Date(challenge.endsAt));
      const todayKey = dateKey(new Date());

      if (usesWorkoutDistance(challenge)) {
        // Enough of a lookback to plausibly cover the whole challenge —
        // getRecentWorkouts() takes a count, not a date range, so this
        // over-fetches slightly and filters client-side instead.
        const workouts = await health.getRecentWorkouts(200);
        const inRange = workouts.filter((w) => w.when >= since);
        const relevant =
          challenge.scoringMethod === 'gps_distance' ? inRange.filter((w) => /run|walk|jog|hike/i.test(w.name)) : inRange;

        const byDay = new Map<string, number>();
        for (const w of relevant) {
          const key = dateKey(w.when);
          if (key > endCap) continue;
          byDay.set(key, (byDay.get(key) ?? 0) + (w.distanceMi ?? 0));
        }
        // Today always gets an explicit (possibly zero) row, same as
        // before this backfilled past days too — otherwise a day with no
        // matching workout yet would just never get synced at all.
        if (!byDay.has(todayKey) && todayKey <= endCap) byDay.set(todayKey, 0);

        await Promise.all(
          Array.from(byDay.entries()).map(([day, distanceMi]) =>
            supabaseChallengesProvider.recordProgress(challengeId, 0, distanceMi, day),
          ),
        );
      } else {
        // getDailyStepsSince(since) is asked for history back to the
        // challenge's start, but still gets clamped to
        // [startDayKey, endCap] here rather than trusted as-is — a
        // provider can hand back a bucket just outside that range (a
        // day before the challenge existed, one past its end) and
        // that's never real progress for it. A past day with no actual
        // device data (0 steps and 0 distance) is dropped rather than
        // written as an explicit zero — that's "nothing recorded", not
        // "recorded a zero" — except today, which always gets a row so
        // the screen doesn't look unsynced before you've taken a step.
        const daily = (await health.getDailyStepsSince(since)).filter(
          (d) =>
            d.date >= startDayKey &&
            d.date <= endCap &&
            (d.date === todayKey || d.steps > 0 || d.distanceMi > 0),
        );
        await Promise.all(
          daily.map((d) => supabaseChallengesProvider.recordProgress(challengeId, d.steps, d.distanceMi, d.date)),
        );
      }
      setDeviceSyncedAt(new Date());
      await load();
    } catch (e) {
      setDeviceSyncError(e instanceof Error ? e.message : 'Could not sync — try again.');
    } finally {
      setDeviceSyncing(false);
    }
  }, [challenge, challengeId, health, load]);

  // Auto-sync once whenever a challenge that draws from the device
  // finishes loading — keyed on id/kind/scoringMethod (not the whole
  // `challenge` object, which is a fresh reference every reload) so
  // syncFromDevice's own load() call doesn't re-trigger this.
  useEffect(() => {
    if (challenge && (usesDeviceSteps(challenge) || usesWorkoutDistance(challenge))) {
      syncFromDevice();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.id, challenge?.kind, challenge?.scoringMethod]);

  const logProgress = async () => {
    const steps = Number(stepsInput);
    if (!Number.isFinite(steps) || steps < 0) {
      setLogError('Enter a whole number of steps.');
      return;
    }
    const distanceMi = distanceInput.trim() ? Number(distanceInput) : 0;
    if (!Number.isFinite(distanceMi) || distanceMi < 0) {
      setLogError('Enter a valid distance, or leave it blank.');
      return;
    }
    setLogError(null);
    setLogSuccess(false);
    setLogging(true);
    try {
      await supabaseChallengesProvider.recordProgress(challengeId, Math.round(steps), distanceMi);
      setLogSuccess(true);
      setStepsInput('');
      setDistanceInput('');
      await load();
    } catch (e) {
      setLogError(e instanceof Error ? e.message : 'Could not save that — try again.');
    } finally {
      setLogging(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={[styles.container, styles.centered]}>
        <ActivityIndicator color={color.accent} />
      </SafeAreaView>
    );
  }

  if (loadError || !challenge) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container}>
          <Button label="All challenges" variant="ghost" small icon={<ArrowLeftIcon size={13} color={color.accent} />} onPress={onBack} />
          <Text style={styles.loadError}>{loadError ?? 'This challenge could not be found.'}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const typeDef = CHALLENGE_TYPES.find((t) => t.id === challenge.kind);
  const Icon = CHALLENGE_KIND_ICON[challenge.kind];
  const daysElapsed = Math.min(
    challenge.durationDays,
    Math.max(1, Math.floor((Date.now() - new Date(challenge.startsAt).getTime()) / 86_400_000) + 1),
  );
  const endsLabel = new Date(challenge.endsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const myHighlighted = participants.find((p) => p.userId === user?.id)?.highlighted ?? false;

  const scoredByDistance = usesDistanceRanking(challenge);
  const sortBy = boardSortFor(challenge);
  const rawBoard = buildBoard(
    participants,
    leaderboard,
    bots,
    daysElapsedFraction(challenge),
    sortBy,
    challenge,
    headStartLeaderboard,
  );
  const board = (challenge.kind === 'hunt' ? withHuntCatches(rawBoard, sortBy, challenge) : rawBoard).map((row) => ({
    ...row,
    name: row.userId === user?.id ? 'You' : row.name,
  }));

  // Days left in the Hunted's head start, for the leaderboard note below
  // — 0 once it's run out or this hunt never had one.
  const headStartDaysLeft = computeHeadStartDaysLeft(challenge);

  // Once the head start has run out, whatever the Hunter logged during
  // it stops counting toward catching up (see huntEffectiveMetric) — a
  // plain leaderboard row showing their full total wouldn't explain why
  // they still haven't caught anyone despite a higher number, so this
  // spells out what actually counts.
  const hunterRow = board.find((r) => r.role === 'hunter');
  const hunterEffectiveNote =
    challenge.kind === 'hunt' && !!challenge.headStartDays && headStartDaysLeft === 0 && hunterRow
      ? `Head start credit applied — only ${
          scoredByDistance
            ? `${huntEffectiveMetric(hunterRow, sortBy).toFixed(1)} mi`
            : `${Math.round(huntEffectiveMetric(hunterRow, sortBy)).toLocaleString()} steps`
        } of the Hunter's total counts toward catching up.`
      : null;

  const syncStatusText = deviceSyncing
    ? 'Syncing…'
    : deviceSyncError
      ? deviceSyncError
      : deviceSyncedAt
        ? 'Synced just now'
        : 'Not synced yet';

  const syncDescription =
    challenge.kind === 'hunt' && challenge.scoringMethod === 'gps_distance'
      ? `Distance from today’s runs and walks auto-syncs from ${health.platformLabel}.`
      : challenge.kind === 'hunt' && challenge.scoringMethod === 'any_workout'
        ? `Distance from every workout logged today auto-syncs from ${health.platformLabel}.`
        : `Steps auto-sync from ${health.platformLabel} — no manual entry needed.`;

  const invitableFriends = friends.filter(
    (f) => f.status === 'accepted' && !participants.some((p) => p.userId === f.userId),
  );

  // A distance pool isn't ranked at all — everyone's steps or miles
  // (whichever unit its creator picked — see CreateScreen.tsx's "Group
  // target" picker) add up toward one shared target, so this reads as
  // the group's combined progress rather than who's ahead of whom.
  const distanceGoal =
    challenge.kind === 'distance'
      ? challenge.distanceGoalUnit === 'steps'
        ? challenge.distanceGoalSteps
        : challenge.distanceGoalMi
      : null;
  const groupTotal = board.reduce(
    (sum, r) => sum + (challenge.distanceGoalUnit === 'steps' ? r.totalSteps : r.totalDistanceMi),
    0,
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={styles.container}>
      <Button label="All challenges" variant="ghost" small icon={<ArrowLeftIcon size={13} color={color.accent} />} onPress={onBack} />

      <View style={styles.headerRow}>
        <Pressable
          style={[styles.headerIcon, { backgroundColor: typeDef?.tint ?? TINT_N }]}
          onPress={onGoHome}
          hitSlop={8}
        >
          <Icon size={22} color={typeDef?.iconColor ?? '#e9e9ed'} weight={challenge.kind === 'hunt' ? 'fill' : 'regular'} />
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[text.h2, { fontSize: 24 }]}>{challenge.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag label={typeDef?.name ?? challenge.kind} variant={challenge.kind === 'hunt' ? 'accent' : 'neutral'} />
            <Text style={styles.headerMeta}>
              Day {daysElapsed} of {challenge.durationDays} · ends {endsLabel}
            </Text>
          </View>
        </View>
      </View>

      <ToggleRow
        label="Highlight on Today screen"
        note="Feature this challenge on your Home screen"
        value={myHighlighted}
        onChange={togglingHighlight ? () => {} : toggleHighlight}
      />

      {distanceGoal && (
        <Card style={{ gap: 10 }} elevated={false}>
          <Text style={text.h4}>Group progress</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={styles.groupTotal}>
              {challenge.distanceGoalUnit === 'steps' ? groupTotal.toLocaleString() : groupTotal.toFixed(1) + ' mi'}
            </Text>
            <Text style={styles.footNote}>
              of {challenge.distanceGoalUnit === 'steps' ? distanceGoal.toLocaleString() : `${distanceGoal} mi`} goal
            </Text>
          </View>
          <ProgressBar
            pct={Math.min(100, (groupTotal / distanceGoal) * 100)}
            fillColor={color.accent}
            height={6}
            trackColor={color.neutral900}
          />
          <Text style={styles.footNote}>
            Everyone&rsquo;s logged {challenge.distanceGoalUnit === 'steps' ? 'steps' : 'miles'} count
            toward this one shared target — it&rsquo;s the whole group against the goal, not against
            each other.
          </Text>
        </Card>
      )}

      <Card style={{ gap: 12 }} elevated={false}>
        <View style={styles.leaderboardHeader}>
          <TrophyIcon size={16} color={color.accent} />
          <Text style={text.h4}>Leaderboard</Text>
        </View>
        {headStartDaysLeft > 0 && (
          <Text style={styles.footNote}>
            Head start: the Hunter&rsquo;s total won&rsquo;t count toward a catch for{' '}
            {headStartDaysLeft} more {headStartDaysLeft === 1 ? 'day' : 'days'}.
          </Text>
        )}
        {hunterEffectiveNote && <Text style={styles.footNote}>{hunterEffectiveNote}</Text>}
        {board.map((row, i) => (
          <View key={row.userId} style={styles.boardRow}>
            <Text style={styles.boardRank}>{i + 1}</Text>
            <Avatar initials={row.initials} tint={row.userId === user?.id ? TINT_A : TINT_N} size={30} fontSize={11} />
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <Text style={styles.boardName}>{row.name}</Text>
              {row.isBot && <RobotIcon size={13} color="rgba(233,233,237,0.55)" />}
              {row.role && <Tag label={HUNT_ROLE_LABEL[row.role]} variant={HUNT_ROLE_TAG_VARIANT[row.role]} />}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {scoredByDistance ? (
                <Text style={styles.boardSteps}>{row.totalDistanceMi.toFixed(1)} mi</Text>
              ) : (
                <>
                  <Text style={styles.boardSteps}>{row.totalSteps.toLocaleString()} steps</Text>
                  {row.totalDistanceMi > 0 && <Text style={styles.boardDistance}>{row.totalDistanceMi.toFixed(1)} mi</Text>}
                </>
              )}
            </View>
          </View>
        ))}
        {board.length === 0 && <Text style={styles.footNote}>No participants found.</Text>}
      </Card>

      {usesDeviceSteps(challenge) || usesWorkoutDistance(challenge) ? (
        <Card style={{ gap: 10 }} elevated={false}>
          <Text style={text.h4}>Your progress</Text>
          <Text style={styles.footNote}>{syncDescription}</Text>
          <View style={styles.syncRow}>
            <View style={[styles.dot, { backgroundColor: deviceSyncError ? color.amber : color.green }]} />
            <Text style={styles.footNote}>{syncStatusText}</Text>
            <Pressable style={styles.syncBtn} onPress={syncFromDevice} disabled={deviceSyncing}>
              <ArrowsClockwiseIcon size={13} color={color.accent} />
              <Text style={styles.syncLabel}>Sync now</Text>
            </Pressable>
          </View>
        </Card>
      ) : (
        <Card style={{ gap: 14 }} elevated={false}>
          <Text style={text.h4}>Log your progress</Text>
          <Text style={styles.footNote}>
            Manual entry for now — Hound doesn&rsquo;t automatically sync your HealthKit/Health Connect
            steps into this kind of challenge yet.
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TextField
              label="Steps today"
              value={stepsInput}
              onChangeText={setStepsInput}
              placeholder="8,432"
              keyboardType="number-pad"
              style={{ flex: 1 }}
            />
            <TextField
              label="Distance (mi)"
              value={distanceInput}
              onChangeText={setDistanceInput}
              placeholder="optional"
              keyboardType="decimal-pad"
              style={{ flex: 1 }}
            />
          </View>
          {logError && <Text style={styles.loadError}>{logError}</Text>}
          {logSuccess && !logError && <Text style={styles.successNote}>Saved.</Text>}
          <Button
            label={logging ? 'Saving…' : 'Save'}
            variant="primary"
            block
            disabled={logging || !stepsInput.trim()}
            onPress={logProgress}
          />
        </Card>
      )}

      <Card style={{ gap: 10 }} elevated={false}>
        <Text style={text.h4}>Invite a friend</Text>
        {invitableFriends.length === 0 ? (
          <Text style={styles.footNote}>
            {friends.length === 0
              ? 'Add friends from the Friends tab, then invite them here.'
              : 'Everyone you’re friends with is already in this challenge.'}
          </Text>
        ) : (
          invitableFriends.map((f) => {
            const invited = invitedIds.has(f.userId);
            return (
              <View key={f.userId} style={styles.inviteFriendRow}>
                <Avatar initials={f.initials} tint={TINT_N} size={30} fontSize={11} />
                <Text style={[styles.friendName, { flex: 1 }]}>{f.name}</Text>
                <Button
                  label={invited ? 'Invited' : invitingId === f.userId ? 'Inviting…' : 'Invite'}
                  variant={invited ? 'ghost' : 'secondary'}
                  small
                  disabled={invited || invitingId === f.userId}
                  onPress={() => inviteFriend(f)}
                />
              </View>
            );
          })
        )}
      </Card>

      {challenge.createdBy === user?.id && (
        <Pressable onPress={confirmDelete} disabled={deleting} style={styles.deleteRow}>
          <TrashIcon size={14} color={color.amber} />
          <Text style={styles.deleteLabel}>{deleting ? 'Deleting…' : 'Delete challenge'}</Text>
        </Pressable>
      )}
    </ScrollView>
    </SafeAreaView>
  );
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  headerIcon: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  headerMeta: { fontSize: 12.5, color: 'rgba(233,233,237,0.55)' },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  syncLabel: { fontSize: 12, color: color.accent, fontFamily: font.heading },
  leaderboardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupTotal: { fontFamily: font.heading, fontSize: 24, color: color.text },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(233,233,237,0.07)',
  },
  boardRank: { width: 16, fontSize: 12.5, color: 'rgba(233,233,237,0.55)' },
  boardName: { flex: 1, fontSize: 14, color: color.text, fontFamily: font.body },
  boardSteps: { fontSize: 14, color: color.text, fontFamily: font.heading },
  boardDistance: { fontSize: 11, color: 'rgba(233,233,237,0.55)' },
  footNote: { fontSize: 12.5, color: 'rgba(233,233,237,0.55)' },
  inviteFriendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  friendName: { fontSize: 14, color: color.text, fontFamily: font.body },
  loadError: { fontSize: 12.5, color: color.amber, textAlign: 'center' },
  successNote: { fontSize: 12.5, color: color.green, textAlign: 'center' },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: 4,
  },
  deleteLabel: { fontSize: 13, color: color.amber, fontFamily: font.heading },
});
