import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon, CheckCircleIcon, MagnifyingGlassIcon, RobotIcon, TrashIcon, TrophyIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ProgressBar } from '../components/ProgressBar';
import { Tag } from '../components/Tag';
import { TagRadar, type TagRadarMember } from '../components/TagRadar';
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
  inviteWindowClosed,
  withHuntCatches,
} from '../challenges/board';
import { daysElapsedFraction } from '../challenges/botSimulation';
import { syncChallengeProgressFromDevice } from '../challenges/deviceSync';
import { boardSortFor, usesDeviceSteps, usesDistanceRanking, usesWorkoutDistance } from '../challenges/scoring';
import { formatStartsLabel, hasStarted, huntKindName, huntRoleLabel, HUNT_ROLE_TAG_VARIANT } from '../challenges/present';
import type { Challenge, ChallengeBot, Participant, LeaderboardEntry, TagRound } from '../challenges/types';
import {
  checkTagCatch,
  getTagRound,
  listTagMembers,
  selectTagTarget,
  settleTagTimeout,
  TAG_TIME_LIMIT_MINUTES,
  type TagMember,
} from '../challenges/tagApi';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import type { Friend } from '../friends/types';
import { friendEligible } from '../friends/eligibility';
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
  const { labelsForOrg } = useLabels();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  // This challenge's own words, not the viewer's — see LabelsContext's
  // own comment on why those can differ (a platform admin viewing
  // someone else's org's challenge, or a global challenge for someone
  // who happens to be in an org).
  const labels = labelsForOrg(challenge?.organizationId);
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

  // Game of Tag's own live state — both stay empty for any other kind.
  // tagRound is null until load() resolves for a 'tag' challenge, or if
  // this isn't one at all.
  const [tagRound, setTagRound] = useState<TagRound | null>(null);
  const [tagMembers, setTagMembers] = useState<TagMember[]>([]);
  const [selectingTargetId, setSelectingTargetId] = useState<string | null>(null);
  const [tagActionError, setTagActionError] = useState<string | null>(null);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  // Every friend with a pending invite to this challenge — hydrated from
  // listSentChallengeInvites() on every load() (see below), not just
  // flipped locally after tapping "Invite" in this session, so a friend
  // invited at creation time reads "Remind" from the very first render.
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [friendSearch, setFriendSearch] = useState('');

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      // The challenge itself has to resolve first — whether a
      // head-start-baseline fetch is even worth making depends on its
      // own kind/headStartDays, which isn't known until this returns.
      const c = await supabaseChallengesProvider.getChallenge(challengeId);
      const needsHeadStart = c.kind === 'hunt' && !!c.headStartDays;
      const needsTag = c.kind === 'tag';
      // Settled before the round itself is fetched, not after — so a
      // stalled turn (15 real minutes with no catch) has already moved
      // on by the time this same load() reads who's IT, rather than
      // showing a round that's about to change out from under it.
      if (needsTag) await settleTagTimeout(challengeId).catch(() => {});
      const [p, l, b, f, hs, sentInvites, tagRoundResult, tagMembersResult] = await Promise.all([
        supabaseChallengesProvider.listParticipants(challengeId),
        supabaseChallengesProvider.getLeaderboard(challengeId),
        supabaseChallengesProvider.listBots(challengeId),
        supabaseFriendsProvider.listFriends(),
        needsHeadStart
          ? supabaseChallengesProvider.getLeaderboard(challengeId, headStartBaselineDayKey(c))
          : Promise.resolve<LeaderboardEntry[]>([]),
        supabaseChallengesProvider.listSentChallengeInvites(challengeId),
        needsTag ? getTagRound(challengeId) : Promise.resolve(null),
        needsTag ? listTagMembers(challengeId) : Promise.resolve([]),
      ]);
      setChallenge(c);
      setParticipants(p);
      setLeaderboard(l);
      setBots(b);
      setFriends(f);
      setHeadStartLeaderboard(hs);
      setInvitedIds(new Set(sentInvites));
      setTagRound(tagRoundResult);
      setTagMembers(tagMembersResult);
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

  // Notices "I've closed the gap" while IT — mirrors the hunt
  // catch-detection effect above, just server-verified instead of
  // computed client-side: tag_check_catch itself re-checks IT's own
  // current total against the target's snapshot from scratch (see
  // tagApi.ts), so this never trusts anything read here. Runs on every
  // load, harmless either way — once a catch actually lands, load()
  // re-fetches a round where this user is no longer IT, and this
  // effect's own guard below stops doing anything further.
  useEffect(() => {
    if (!challenge || challenge.kind !== 'tag' || !user?.id) return;
    if (!tagRound || tagRound.itUserId !== user.id || !tagRound.targetUserId) return;
    checkTagCatch(challenge.id)
      .then((caught) => {
        if (caught) load();
      })
      .catch(() => {});
  }, [challenge, tagRound, user?.id, load]);

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
      // A hunt's Hunter is fixed at creation (CreateScreen's own
      // roleFor) and never changes later — anyone invited after that
      // joins as Hunted. Without this, a friend added post-creation got
      // role: null, which reads as no tag at all rather than "Runner",
      // and (via huntEffectiveMetric/withHuntCatches) never counts as
      // someone the Hunter can actually catch.
      const role = challenge?.kind === 'hunt' ? 'hunted' : undefined;
      await supabaseChallengesProvider.inviteFriendToChallenge(challengeId, friend.userId, role);
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

  const pickTagTarget = async (targetUserId: string) => {
    setTagActionError(null);
    setSelectingTargetId(targetUserId);
    try {
      await selectTagTarget(challengeId, targetUserId);
      await load();
    } catch (e) {
      setTagActionError(e instanceof Error ? e.message : 'Could not pick that person — try again.');
    } finally {
      setSelectingTargetId(null);
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
  // see deviceSync.ts's own comment for what/why. Re-running this on
  // every sync is deliberate and harmless (it's an upsert): it catches
  // up a challenge someone joined after it started, or picks back up
  // correctly after a few days of not opening the app, without a
  // separate "first ever sync" code path.
  const syncFromDevice = useCallback(async () => {
    if (!challenge) return;
    await syncChallengeProgressFromDevice(challenge, health);
    await load();
  }, [challenge, health, load]);

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
  const started = hasStarted(challenge, now);
  const daysElapsed = Math.min(challenge.durationDays, Math.floor((Date.now() - new Date(challenge.startsAt).getTime()) / 86_400_000) + 1);
  const endsLabel = formatEndsLabel(challenge.endsAt, now);
  // Before the challenge actually begins (CreateScreen's 'tomorrow' start
  // option, or any other future starts_at), "Day 1 of N" would read as
  // if it had already started — see hasStarted's own comment.
  const dayLabel = started ? `Day ${daysElapsed} of ${challenge.durationDays}` : formatStartsLabel(challenge.startsAt, now);

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

  // Same org-vs-global partition CreateScreen's own friend picker
  // applies at creation time (see friends/eligibility.ts) — an org
  // challenge only ever gets more of that org's own members invited
  // into it later, and a global one only ever gets people outside
  // whichever org is relevant here. That "relevant org" is the
  // challenge's own for an org challenge (whoever's inviting, it stays
  // that org's challenge), or the inviter's own org for a global one
  // (matching CreateScreen's own "global excludes my org" rule) —
  // falling back to no restriction at all when neither exists, same as
  // someone with no org sees in the wizard.
  const challengeOrgId = challenge?.organizationId ?? null;
  const orgIdForEligibility = challengeOrgId ?? user?.organizationId ?? null;
  const invitableFriends = friends.filter(
    (f) =>
      f.status === 'accepted' &&
      !participants.some((p) => p.userId === f.userId) &&
      (!orgIdForEligibility || friendEligible(f, challengeOrgId ? 'org' : 'global', orgIdForEligibility)),
  );
  // Case-insensitive substring match, applied after the eligibility
  // filter above — this narrows an already-invitable list down further,
  // it never brings back someone who's already in the challenge.
  const searchedFriends = friendSearch.trim()
    ? invitableFriends.filter((f) => f.name.toLowerCase().includes(friendSearch.trim().toLowerCase()))
    : invitableFriends;
  // Same window inviteFriendToChallenge/acceptChallengeInvite enforce
  // server-side (see supabaseChallenges.ts and inviteWindowClosed's own
  // comment) — this is just what keeps the inviter from sending a doomed
  // invite in the first place.
  const inviteLocked = inviteWindowClosed(challenge);

  // A distance pool isn't ranked at all — everyone's steps or miles
  // (whichever unit its creator picked — see CreateScreen.tsx's "Group
  // target" picker) add up toward one shared target, so this reads as
  // the group's combined progress rather than who's ahead of whom. A
  // 'tag' game reuses this exact same field for its own shared target
  // (see 0045_tag_game_state.sql) — unlike a distance pool, reaching it
  // actually ends the game (isChallengeFinished/tagGroupGoalMet in
  // board.ts), not just a cosmetic badge.
  const distanceGoal =
    challenge.kind === 'distance' || challenge.kind === 'tag'
      ? challenge.distanceGoalUnit === 'steps'
        ? challenge.distanceGoalSteps
        : challenge.distanceGoalMi
      : null;
  const groupTotal = board.reduce(
    (sum, r) => sum + (challenge.distanceGoalUnit === 'steps' ? r.totalSteps : r.totalDistanceMi),
    0,
  );
  const goalMet = !!distanceGoal && groupTotal >= distanceGoal;

  // Game of Tag's own status. tagMinutesLeft floors at 0 rather than
  // going negative once a round's genuinely stalled past its limit —
  // load()'s own settleTagTimeout call already resolves that on the
  // very next load, so this only ever reads low-but-not-negative for
  // the brief window between the clock running out and this screen
  // next refreshing.
  const tagMinutesLeft = tagRound
    ? Math.max(0, Math.ceil(TAG_TIME_LIMIT_MINUTES - (now - new Date(tagRound.roundStartedAt).getTime()) / 60_000))
    : 0;
  const iAmTagIt = !!tagRound && tagRound.itUserId === user?.id;
  // The one person I can't pick — whoever tagged me last (no
  // tag-backs). Doesn't matter at all unless I'm actually IT with
  // nobody picked yet, but harmless to compute either way.
  const myLastTaggedBy = tagMembers.find((m) => m.userId === user?.id)?.lastTaggedBy ?? null;
  const tagTargetableMembers = tagMembers.filter((m) => m.userId !== user?.id && m.userId !== myLastTaggedBy);
  const tagItMember = tagRound ? tagMembers.find((m) => m.userId === tagRound.itUserId) : undefined;
  const tagTargetMember = tagRound?.targetUserId ? tagMembers.find((m) => m.userId === tagRound.targetUserId) : undefined;
  const myTagMetric = board.find((r) => r.userId === user?.id);
  const myTagMetricValue = myTagMetric
    ? challenge.distanceGoalUnit === 'steps'
      ? myTagMetric.totalSteps
      : myTagMetric.totalDistanceMi
    : 0;
  const tagCatchPct =
    tagRound?.targetSnapshotMetric && tagRound.targetSnapshotMetric > 0
      ? Math.min(100, (myTagMetricValue / tagRound.targetSnapshotMetric) * 100)
      : 0;

  // It's own current total, for every non-It member's radar distance
  // below — the actual target's ring uses the frozen snapshot instead
  // (the real number tag_check_catch is comparing against), everyone
  // else is just today's live gap, recomputed on every load like the
  // rest of this board.
  const tagItBoardRow = tagRound ? board.find((r) => r.userId === tagRound.itUserId) : undefined;
  const tagItTotal = tagItBoardRow
    ? challenge.distanceGoalUnit === 'steps'
      ? tagItBoardRow.totalSteps
      : tagItBoardRow.totalDistanceMi
    : 0;
  const tagRadarMembers: TagRadarMember[] = tagRound
    ? tagMembers
        .filter((m) => m.userId !== tagRound.itUserId)
        .map((m) => {
          const row = board.find((r) => r.userId === m.userId);
          const theirTotal = row ? (challenge.distanceGoalUnit === 'steps' ? row.totalSteps : row.totalDistanceMi) : 0;
          const isTarget = tagRound.targetUserId === m.userId;
          const distance =
            isTarget && tagRound.targetSnapshotMetric != null
              ? Math.max(0, tagRound.targetSnapshotMetric - tagItTotal)
              : Math.abs(theirTotal - tagItTotal);
          return {
            userId: m.userId,
            initials: m.initials,
            name: m.userId === user?.id ? 'You' : m.name,
            distance,
            isTarget,
            isMe: m.userId === user?.id,
          };
        })
    : [];

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
              label={challenge.kind === 'hunt' ? huntKindName() : (typeDef?.name ?? challenge.kind)}
              variant={challenge.kind === 'hunt' ? 'accent' : 'neutral'}
            />
            <Text style={styles.headerMeta}>
              {dayLabel} · {endsLabel}
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
        <Card style={[{ gap: 10 }, goalMet ? styles.goalMetCard : {}]} elevated={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={text.h4}>Group progress</Text>
            {goalMet && (
              <View style={styles.goalMetBadge}>
                <CheckCircleIcon size={14} color={colors.green} weight="fill" />
                <Text style={styles.goalMetLabel}>Goal reached</Text>
              </View>
            )}
          </View>
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
            fillColor={goalMet ? colors.green : colors.accent}
            height={6}
          />
          <Text style={styles.footNote}>
            {challenge.kind === 'tag'
              ? goalMet
                ? 'The group hit its target — this game is over.'
                : `Everyone’s logged ${challenge.distanceGoalUnit === 'steps' ? 'steps' : 'miles'} count toward this one shared target — once the group reaches it, the game ends, whoever’s It at the time.`
              : goalMet
                ? 'The group hit its target — anything still logged from here just adds to the total.'
                : `Everyone’s logged ${challenge.distanceGoalUnit === 'steps' ? 'steps' : 'miles'} count toward this one shared target — it’s the whole group against the goal, not against each other.`}
          </Text>
        </Card>
      )}

      {challenge.kind === 'tag' && tagRound && (
        <Card style={{ gap: 12 }} elevated={false}>
          <Text style={text.h4}>Tag status</Text>
          <TagRadar
            itInitials={tagItMember?.initials ?? '?'}
            itName={tagItMember?.name ?? 'Someone'}
            isMeIt={iAmTagIt}
            members={tagRadarMembers}
            colors={colors}
            formatDistance={formatMetric}
          />
          {iAmTagIt && !tagRound.targetUserId ? (
            <>
              <Text style={styles.footNote}>
                You&rsquo;re It — pick who to tag. {tagMinutesLeft > 0 ? `${tagMinutesLeft} min left to pick and catch them.` : 'Time’s almost up.'}
              </Text>
              {tagActionError && <Text style={styles.loadError}>{tagActionError}</Text>}
              {tagTargetableMembers.length === 0 ? (
                <Text style={styles.footNote}>Nobody eligible to tag yet — wait for more people to join.</Text>
              ) : (
                tagTargetableMembers.map((m) => (
                  <View key={m.userId} style={styles.inviteFriendRow}>
                    <Avatar initials={m.initials} tint={TINT_N} size={30} fontSize={11} />
                    <Text style={[styles.friendName, { flex: 1 }]}>{m.name}</Text>
                    <Button
                      label={selectingTargetId === m.userId ? 'Picking…' : 'Tag'}
                      small
                      disabled={selectingTargetId !== null}
                      onPress={() => pickTagTarget(m.userId)}
                    />
                  </View>
                ))
              )}
            </>
          ) : iAmTagIt && tagRound.targetUserId ? (
            <>
              <Text style={styles.footNote}>
                Chasing {tagTargetMember?.name ?? 'someone'} —{' '}
                {tagMinutesLeft > 0 ? `${tagMinutesLeft} min left to catch them.` : 'time’s almost up.'}
              </Text>
              <ProgressBar pct={tagCatchPct} fillColor={colors.accent} height={6} />
              <Text style={styles.footNote}>
                {formatMetric(myTagMetricValue)} of {formatMetric(tagRound.targetSnapshotMetric ?? 0)} needed to catch them.
              </Text>
            </>
          ) : (
            <Text style={styles.footNote}>
              {tagItMember?.name ?? 'Someone'} is It
              {tagRound.targetUserId
                ? `, chasing ${tagTargetMember?.userId === user?.id ? 'you' : tagTargetMember?.name ?? 'someone'}.`
                : ' and hasn’t picked a target yet.'}
            </Text>
          )}
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
        {inviteLocked ? (
          <Text style={styles.footNote}>
            {challenge.kind === 'hunt' && challenge.headStartDays
              ? `This chase’s head start has already ended — a newly invited friend would join with no head start of their own, so new invites are closed for the rest of this chase.`
              : `It’s been more than 24 hours since this challenge started, so new invites are closed — joining this late would give someone an unfair read on where everyone else already stands.`}
          </Text>
        ) : invitableFriends.length === 0 ? (
          <Text style={styles.footNote}>
            {friends.length === 0
              ? 'Add friends from the Friends tab, then invite them here.'
              : 'Everyone you’re friends with is already in this challenge.'}
          </Text>
        ) : (
          <>
            <TextField
              label="Search friends"
              value={friendSearch}
              onChangeText={setFriendSearch}
              placeholder="Search by name"
              icon={<MagnifyingGlassIcon size={16} color={withAlpha(colors.text, 0.5)} />}
              autoCapitalize="none"
            />
            {searchedFriends.length === 0 ? (
              <Text style={styles.footNote}>No friends match “{friendSearch.trim()}”.</Text>
            ) : (
              searchedFriends.map((f) => {
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
          </>
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
    goalMetCard: {
      borderWidth: 1,
      borderColor: withAlpha(colors.green, 0.5),
      backgroundColor: withAlpha(colors.green, 0.1),
    },
    goalMetBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    goalMetLabel: { fontSize: 12, fontFamily: font.heading, color: colors.green },
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
