import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon, RobotIcon, TrashIcon, TrophyIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ProgressBar } from '../components/ProgressBar';
import { Tag } from '../components/Tag';
import { TextField } from '../components/TextField';
import { ToggleRow } from '../components/Selectable';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { CHALLENGE_KIND_ICON } from '../data/challengeIcons';
import { supabaseChallengesProvider } from '../challenges/supabaseChallenges';
import {
  buildBoard,
  headStartDaysLeft as computeHeadStartDaysLeft,
  headStartBaselineDayKey,
  huntEffectiveMetric,
  withHuntCatches,
} from '../challenges/board';
import { daysElapsedFraction } from '../challenges/botSimulation';
import { boardSortFor, usesDeviceSteps, usesDistanceRanking, usesWorkoutDistance } from '../challenges/scoring';
import { huntKindName, huntRoleLabel, HUNT_ROLE_TAG_VARIANT } from '../challenges/present';
import type { Challenge, ChallengeBot, Participant, LeaderboardEntry } from '../challenges/types';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import type { Friend } from '../friends/types';
import { useAuth } from '../auth/AuthContext';
import { useHealthProvider } from '../health/HealthContext';
import { useLabels } from '../labels/LabelsContext';

// The generic detail view for a real, Supabase-backed challenge of any
// kind — there's no per-kind template yet (HuntScreen is one specific
// hardcoded storyline, not reusable), so this renders the same for every
// kind: who's in it, who's logged what, and a way to log your own
// progress. A 'steps' challenge, a 'hunt' scored on device steps or
// workout distance, and a 'distance' pool (once its group target has a
// unit — see usesDeviceSteps/usesWorkoutDistance in scoring.ts) are the
// exceptions — they have a real, unambiguous device number to draw from,
// so they auto-sync from HealthKit/Health Connect instead of showing the
// manual form. Fetches by id itself rather than taking pre-loaded data as
// props, so it works from any entry point.
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
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { labels } = useLabels();
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
  // Only exists to make formatEndsLabel's countdown actually tick once a
  // challenge is in its last 24 hours — every 30s is plenty of
  // resolution for a minutes-level countdown, and doesn't need to be
  // running at all the rest of the time this screen is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [stepsInput, setStepsInput] = useState('');
  const [distanceInput, setDistanceInput] = useState('');
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logSuccess, setLogSuccess] = useState(false);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  // Every friend with a pending invite to this challenge — hydrated from
  // listSentChallengeInvites() on every load() (see below), not just
  // flipped locally after tapping "Invite" in this session, so a friend
  // invited at creation time reads "Remind" from the very first render.
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      // The challenge itself has to resolve first — whether a
      // head-start-baseline fetch is even worth making depends on its
      // own kind/headStartDays, which isn't known until this returns.
      const c = await supabaseChallengesProvider.getChallenge(challengeId);
      const needsHeadStart = c.kind === 'hunt' && !!c.headStartDays;
      const [p, l, b, f, hs, sentInvites] = await Promise.all([
        supabaseChallengesProvider.listParticipants(challengeId),
        supabaseChallengesProvider.getLeaderboard(challengeId),
        supabaseChallengesProvider.listBots(challengeId),
        supabaseFriendsProvider.listFriends(),
        needsHeadStart
          ? supabaseChallengesProvider.getLeaderboard(challengeId, headStartBaselineDayKey(c))
          : Promise.resolve<LeaderboardEntry[]>([]),
        supabaseChallengesProvider.listSentChallengeInvites(challengeId),
      ]);
      setChallenge(c);
      setParticipants(p);
      setLeaderboard(l);
      setBots(b);
      setFriends(f);
      setHeadStartLeaderboard(hs);
      setInvitedIds(new Set(sentInvites));
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

  const remindFriend = async (friend: Friend) => {
    setInvitingId(friend.userId);
    try {
      await supabaseChallengesProvider.remindChallengeInvite(challengeId, friend.userId);
    } catch (e) {
      Alert.alert('Could not send reminder', e instanceof Error ? e.message : 'Try again.');
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
        // Day-level, like startDayKey/endCap above — not `w.when >= since`
        // (the challenge's precise creation timestamp). A workout logged
        // earlier the same calendar day, before the challenge existed by
        // a few seconds or hours, is still today's real activity; the
        // steps branch below already gets this right by clamping to
        // startDayKey instead of trusting a raw timestamp, and this one
        // needs the same treatment for the same reason.
        const inRange = workouts.filter((w) => dateKey(w.when) >= startDayKey);
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
      await load();
    } catch {
      // Silent — this only ever runs automatically in the background now
      // (see the auto-sync effect below); there's no "Your progress" card
      // left to surface an error on, and the next successful sync (this
      // same effect, next time the screen loads) supersedes a failed one
      // anyway.
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
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (loadError || !challenge) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container}>
          <Button label="All challenges" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />
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
  const endsLabel = formatEndsLabel(challenge.endsAt, now);

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
  // it stops counting toward catching up (see huntEffectiveMetric) —
  // the Hunter's own leaderboard row already shows that credited number
  // now, not their raw total (see board.map below), so this doesn't
  // need to spell out a second, bigger number nobody on this screen can
  // actually see anymore — just why the Hunter's own number might read
  // lower than they'd expect from their real day.
  const hunterRow = board.find((r) => r.role === 'hunter');
  const formatMetric = (value: number) =>
    scoredByDistance ? `${value.toFixed(1)} mi` : `${Math.round(value).toLocaleString()} steps`;
  const hunterEffectiveNote =
    challenge.kind === 'hunt' && !!challenge.headStartDays && headStartDaysLeft === 0 && hunterRow
      ? `Head start credit applied — steps the ${labels.hunter} logged before it ended don't count toward catching up.`
      : null;
  // One progress bar per Hunted/Zombie participant, showing how much of
  // the *gap* the Hunter's effective progress (huntEffectiveMetric, not
  // their raw total — same reasoning as the leaderboard's own sort order
  // above) has actually closed. A Zombie always reads as fully caught
  // (100%), matching withHuntCatches' own catch condition exactly rather
  // than recomputing something that could drift from it.
  const chaseRows =
    challenge.kind === 'hunt' && hunterRow
      ? board
          .filter((r) => r.role === 'hunted' || r.role === 'zombie')
          .map((r) => {
            const theirTotal = scoredByDistance ? r.totalDistanceMi : r.totalSteps;
            const hunterMetric = huntEffectiveMetric(hunterRow, sortBy);
            const pct = r.role === 'zombie' ? 100 : theirTotal > 0 ? Math.min(100, (hunterMetric / theirTotal) * 100) : 0;
            return { row: r, pct, hunterMetric, theirTotal };
          })
      : [];

  const invitableFriends = friends.filter(
    (f) => f.status === 'accepted' && !participants.some((p) => p.userId === f.userId),
  );
  // Same condition as hunterEffectiveNote's own: once a hunt's head
  // start has genuinely elapsed, a freshly invited friend would join
  // with no head start credit of their own — the same unfair "instant
  // target" a late Hunted would face for real. acceptChallengeInvite
  // enforces this server-side too (see supabaseChallenges.ts) — this is
  // just what keeps the inviter from sending a doomed invite in the
  // first place.
  const huntHeadStartLocked = challenge.kind === 'hunt' && !!challenge.headStartDays && headStartDaysLeft === 0;

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
      <Button label="All challenges" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />

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
            <Tag
              label={challenge.kind === 'hunt' ? huntKindName(labels) : (typeDef?.name ?? challenge.kind)}
              variant={challenge.kind === 'hunt' ? 'accent' : 'neutral'}
            />
            <Text style={styles.headerMeta}>
              Day {daysElapsed} of {challenge.durationDays} · {endsLabel}
            </Text>
          </View>
        </View>
      </View>

      <ToggleRow
        label="Highlight on Home"
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
            fillColor={colors.accent}
            height={6}
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
          <TrophyIcon size={16} color={colors.accent} />
          <Text style={text.h4}>Leaderboard</Text>
        </View>
        {headStartDaysLeft > 0 && (
          <Text style={styles.footNote}>
            Head start: the {labels.hunter}&rsquo;s total won&rsquo;t count toward a catch for{' '}
            {headStartDaysLeft} more {headStartDaysLeft === 1 ? 'day' : 'days'}.
          </Text>
        )}
        {hunterEffectiveNote && <Text style={styles.footNote}>{hunterEffectiveNote}</Text>}
        {board.map((row, i) => {
          // The Hunter's row shows their credited progress
          // (huntEffectiveMetric), not their raw total — showing 50,610
          // here while the Chase progress card below says only 34,895 of
          // it counts is confusing on its own screen: two different
          // numbers for the same person, only one of which means
          // anything toward a catch. huntEffectiveMetric already no-ops
          // for every non-Hunter role, so this is exactly the raw total
          // for everyone else on the board.
          const displaySteps = challenge.kind === 'hunt' ? huntEffectiveMetric(row, 'steps') : row.totalSteps;
          const displayMi = challenge.kind === 'hunt' ? huntEffectiveMetric(row, 'distance') : row.totalDistanceMi;
          return (
            <View key={row.userId} style={styles.boardRow}>
              <Text style={styles.boardRank}>{i + 1}</Text>
              <Avatar initials={row.initials} tint={row.userId === user?.id ? TINT_A : TINT_N} size={30} fontSize={11} />
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                <Text style={styles.boardName}>{row.name}</Text>
                {row.isBot && <RobotIcon size={13} color={withAlpha(colors.text, 0.55)} />}
                {row.role && <Tag label={huntRoleLabel(row.role, labels)} variant={HUNT_ROLE_TAG_VARIANT[row.role]} />}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {scoredByDistance ? (
                  <Text style={styles.boardSteps}>{displayMi.toFixed(1)} mi</Text>
                ) : (
                  <>
                    <Text style={styles.boardSteps}>{displaySteps.toLocaleString()} steps</Text>
                    {displayMi > 0 && <Text style={styles.boardDistance}>{displayMi.toFixed(1)} mi</Text>}
                  </>
                )}
              </View>
            </View>
          );
        })}
        {board.length === 0 && <Text style={styles.footNote}>No participants found.</Text>}
      </Card>

      {chaseRows.length > 0 && (
        <Card style={{ gap: 12 }} elevated={false}>
          <Text style={text.h4}>Chase progress</Text>
          <Text style={styles.footNote}>
            How much of each gap the {labels.hunter}&rsquo;s actually closed since the head start
            ended — not just the raw numbers above.
          </Text>
          {chaseRows.map(({ row, pct, hunterMetric, theirTotal }) => (
            <View key={row.userId} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={styles.friendName}>{row.name}</Text>
                <Text style={styles.footNote}>
                  {row.role === 'zombie' ? 'Caught' : `${formatMetric(hunterMetric)} of ${formatMetric(theirTotal)}`}
                </Text>
              </View>
              <ProgressBar
                pct={pct}
                fillColor={row.role === 'zombie' ? colors.amber : colors.accent}
                height={6}
              />
            </View>
          ))}
        </Card>
      )}

      {/* A device-synced challenge (usesDeviceSteps/usesWorkoutDistance)
          gets no card here at all — syncFromDevice already runs
          automatically in the background (see the auto-sync effect
          above) once Health Connect/HealthKit is connected, so there's
          nothing for this screen to show or for the person to trigger
          manually. */}
      {!usesDeviceSteps(challenge) && !usesWorkoutDistance(challenge) && (
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
        {huntHeadStartLocked ? (
          <Text style={styles.footNote}>
            This hunt&rsquo;s head start has already ended — a newly invited friend would join with
            no head start of their own, so new invites are closed for the rest of this hunt.
          </Text>
        ) : invitableFriends.length === 0 ? (
          <Text style={styles.footNote}>
            {friends.length === 0
              ? 'Add friends from the Friends tab, then invite them here.'
              : 'Everyone you’re friends with is already in this challenge.'}
          </Text>
        ) : (
          invitableFriends.map((f) => {
            const invited = invitedIds.has(f.userId);
            const busy = invitingId === f.userId;
            return (
              <View key={f.userId} style={styles.inviteFriendRow}>
                <Avatar initials={f.initials} tint={TINT_N} size={30} fontSize={11} />
                <Text style={[styles.friendName, { flex: 1 }]}>{f.name}</Text>
                <Button
                  label={busy ? (invited ? 'Reminding…' : 'Inviting…') : invited ? 'Remind' : 'Invite'}
                  variant={invited ? 'ghost' : 'secondary'}
                  small
                  disabled={busy}
                  onPress={() => (invited ? remindFriend(f) : inviteFriend(f))}
                />
              </View>
            );
          })
        )}
      </Card>

      {challenge.createdBy === user?.id && (
        <Pressable onPress={confirmDelete} disabled={deleting} style={styles.deleteRow}>
          <TrashIcon size={14} color={colors.amber} />
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

// "ends Sep 19" reads fine when that's tomorrow, but is genuinely
// ambiguous the day a challenge ends *today* — nothing about a bare
// date says whether there are 30 minutes or 20 hours left. Once a
// challenge is inside its last 24 hours, this switches to a live
// countdown instead ("Ends in 3h 12m"), ticking down via the caller's
// own `now` (see the component's 30s-interval effect) rather than
// freezing at whatever value it had on the last full reload.
function formatEndsLabel(endsAt: string, now: number): string {
  const msLeft = new Date(endsAt).getTime() - now;
  if (msLeft > 24 * 3_600_000) {
    return `ends ${new Date(endsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }
  if (msLeft <= 0) return 'ended';
  const hours = Math.floor(msLeft / 3_600_000);
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000);
  return hours > 0 ? `ends in ${hours}h ${minutes}m` : `ends in ${Math.max(1, minutes)}m`;
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 16, paddingBottom: 48 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    headerRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
    headerIcon: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    headerMeta: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    leaderboardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    groupTotal: { fontFamily: font.heading, fontSize: 24, color: colors.text },
    boardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.07),
    },
    boardRank: { width: 16, fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    boardName: { flex: 1, fontSize: 14, color: colors.text, fontFamily: font.body },
    boardSteps: { fontSize: 14, color: colors.text, fontFamily: font.heading },
    boardDistance: { fontSize: 11, color: withAlpha(colors.text, 0.55) },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    inviteFriendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    friendName: { fontSize: 14, color: colors.text, fontFamily: font.body },
    loadError: { fontSize: 12.5, color: colors.amber, textAlign: 'center' },
    successNote: { fontSize: 12.5, color: colors.green, textAlign: 'center' },
    deleteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      marginTop: 4,
    },
    deleteLabel: { fontSize: 13, color: colors.amber, fontFamily: font.heading },
  });
}
