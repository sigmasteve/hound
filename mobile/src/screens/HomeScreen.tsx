import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ArrowsClockwiseIcon,
  CaretRightIcon,
  CrosshairIcon,
  FlagCheckeredIcon,
  FootprintsIcon,
  PathIcon,
  PawPrintIcon,
  PlusCircleIcon,
  SneakerMoveIcon,
  TrophyIcon,
  UserPlusIcon,
} from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ProgressBar } from '../components/ProgressBar';
import { Tag } from '../components/Tag';
import { useTheme } from '../theme/ThemeContext';
import { color, font, TINT_A, TINT_N, toneColor, withAlpha, type Palette } from '../theme/tokens';
import { useHealthProvider } from '../health/HealthContext';
import type { HealthSnapshot, WorkoutSample } from '../health/types';
import { computeReadiness, READINESS_COPY } from '../health/readiness';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { CHALLENGE_KIND_ICON } from '../data/challengeIcons';
import type { MainTab } from '../navigation/types';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { supabaseChallengesProvider } from '../challenges/supabaseChallenges';
import {
  buildBoard,
  hasHeadStartElapsed,
  headStartBaselineDayKey,
  huntEffectiveMetric,
  isChallengeFinished,
  pickPrimaryChallenge,
  withHuntCatches,
  type BoardEntry,
} from '../challenges/board';
import { daysElapsedFraction } from '../challenges/botSimulation';
import { boardSortFor } from '../challenges/scoring';
import { huntKindName, ordinal } from '../challenges/present';
import type { Challenge, LeaderboardEntry } from '../challenges/types';
import { useLabels } from '../labels/LabelsContext';
import { DEFAULT_HUNT_LABELS, type HuntLabels } from '../labels/types';

interface PrimaryChallenge {
  challenge: Challenge;
  board: BoardEntry[];
}

// Whether a two-way hunt's lead should read in miles or steps depends on
// what it's actually scored on (see src/challenges/scoring.ts) — a
// device_steps hunt has totalDistanceMi stuck at 0 (recordProgress only
// gets real distance from HealthKit's own snapshot, which a steps-scored
// sync still writes, but a hunt's *lead* should track whatever it's
// actually racing on, not just whichever field happens to be nonzero).
//
// Uses huntEffectiveMetric, not the raw totals — once a head start has
// ended, the Hunter's side of this needs to read as "what they've closed
// since then," or this headline would flatly contradict withHuntCatches'
// own catch condition (e.g. showing "2,000 steps behind" for a Hunter
// who, credit included, still has 20,000 to go).
function huntLeadMetric(
  me: BoardEntry,
  rival: BoardEntry,
  challenge: Challenge,
): { lead: number; unit: 'mi' | 'steps'; meTotal: number; rivalTotal: number } {
  const sortBy = boardSortFor(challenge);
  const meMetric = huntEffectiveMetric(me, sortBy);
  const rivalMetric = huntEffectiveMetric(rival, sortBy);
  const unit = sortBy === 'distance' ? 'mi' : 'steps';
  return { lead: meMetric - rivalMetric, unit, meTotal: meMetric, rivalTotal: rivalMetric };
}

function formatLead(value: number, unit: 'mi' | 'steps'): string {
  return unit === 'mi' ? `${value.toFixed(1)} mi` : `${Math.round(value).toLocaleString()} steps`;
}

// The headline sentence + eyebrow for whichever real challenge Home
// decided to lead with — "Marcus is 7.4 mi behind you" was hand-authored
// for one specific hardcoded matchup, so a real version has to cover
// however many kinds of standing a real challenge can actually be in: a
// two-way gap (hunt, in whatever unit it's scored on), a rank in a bigger
// field, or nobody having logged anything yet.
function heroCopy(
  primary: PrimaryChallenge,
  userId: string | null,
  labels: HuntLabels = DEFAULT_HUNT_LABELS,
): { eyebrow: string; headline: string } {
  const { challenge, board } = primary;
  const daysElapsed = Math.min(
    challenge.durationDays,
    Math.max(1, Math.floor((Date.now() - new Date(challenge.startsAt).getTime()) / 86_400_000) + 1),
  );
  const kindLabel = challenge.kind === 'hunt' ? huntKindName() : CHALLENGE_TYPES.find((t) => t.id === challenge.kind)?.name ?? challenge.kind;
  const eyebrow = `DAY ${daysElapsed} OF ${challenge.durationDays} · ${kindLabel.toUpperCase()}`;

  const me = userId ? board.find((r) => r.userId === userId) : undefined;
  const rival = board.find((r) => r.userId !== userId);
  const finished = isChallengeFinished(challenge, board);

  // A two-person hunt concluded by an actual catch gets its own, more
  // personal wording ("X caught you") — everything else that's finished
  // (a multi-Hunted hunt with nobody left to chase, or any challenge
  // whose clock simply ran out) falls through to the generic "who won"
  // announcement below instead of this screen's usual "your standing"
  // framing.
  if (challenge.kind === 'hunt' && board.length === 2 && me && rival) {
    if (me.role === 'zombie') {
      return { eyebrow, headline: `${rival.name} caught you. The chase is over.` };
    }
    if (rival.role === 'zombie') {
      return { eyebrow, headline: `You caught ${rival.name}! The chase is over.` };
    }
    if (!finished && !hasHeadStartElapsed(challenge)) {
      // The Hunter's real, already-logged total still exists during head
      // start — it just doesn't count toward a catch yet (see
      // withHuntCatches) — so this replaces the lead/behind framing below
      // rather than showing a number that would otherwise read as an
      // ongoing race nobody's actually allowed to close yet.
      const daysLeft = Math.max(1, Math.ceil((challenge.headStartDays ?? 0) - daysElapsedFraction(challenge)));
      const dayWord = daysLeft === 1 ? 'day' : 'days';
      if (me.role === 'hunter') {
        return { eyebrow, headline: `${rival.name} has a ${daysLeft}-${dayWord} head start left.` };
      }
      return { eyebrow, headline: `Your head start ends in ${daysLeft} ${dayWord} — log while you can.` };
    }
    if (!finished) {
      const { lead, unit, meTotal, rivalTotal } = huntLeadMetric(me, rival, challenge);
      if (meTotal === 0 && rivalTotal === 0) {
        return { eyebrow, headline: `${challenge.name} just started — no ${unit === 'mi' ? 'miles' : 'steps'} logged yet.` };
      }
      const relation = lead >= 0 ? 'behind you' : 'ahead of you';
      return { eyebrow, headline: `${rival.name} is ${formatLead(Math.abs(lead), unit)} ${relation}.` };
    }
    // A 2-person hunt whose scheduled end passed without either side
    // ever being caught — falls through to "who won" below rather than
    // repeating the lead/behind framing on something that's already over.
  }

  // The viewer's own catch, for a hunt with more than one Hunted — the
  // 2-person branch above already covers that case (there, being caught
  // and the hunt ending are the same event). Here they aren't: Blaze or
  // Micah might still be out there even though you're a Zombie, so this
  // doesn't say "the chase is over" — just what happened to *you*. Checked
  // before the generic rank/"who won" framing below, which would
  // otherwise still report a stale rank for someone who's already out of
  // the running.
  if (challenge.kind === 'hunt' && me?.role === 'zombie' && !finished) {
    return {
      eyebrow,
      headline: `You've been caught — you're ${labels.zombie} now. ${challenge.name} continues without you.`,
    };
  }

  // board is already sorted descending by whichever metric this
  // challenge is scored on (see buildBoard) — for a concluded hunt
  // specifically, the Hunter's total is guaranteed to be at least every
  // caught Hunted's, so board[0] is always the Hunter there too, with no
  // separate hunter-lookup needed.
  if (finished && board.some((r) => r.totalSteps > 0 || r.totalDistanceMi > 0)) {
    const winner = board[0];
    return {
      eyebrow,
      headline: winner.userId === userId ? `You won ${challenge.name}!` : `${winner.name} won ${challenge.name}.`,
    };
  }

  if (!me || board.every((r) => r.totalSteps === 0)) {
    return { eyebrow, headline: `${challenge.name} — no one's logged anything yet.` };
  }
  const rank = board.findIndex((r) => r.userId === userId) + 1;
  return { eyebrow, headline: `You're ${ordinal(rank)} of ${board.length} in ${challenge.name}.` };
}

export function HomeScreen({
  onOpenHunt,
  onOpenChallenge,
  onGoTab,
}: {
  onOpenHunt: () => void;
  onOpenChallenge: (challengeId: string) => void;
  onGoTab: (tab: MainTab) => void;
}) {
  const { user } = useAuth();
  const health = useHealthProvider();
  const { colors, text } = useTheme();
  const { labels } = useLabels();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [snap, setSnap] = useState<HealthSnapshot | null>(null);
  const [workouts, setWorkouts] = useState<WorkoutSample[]>([]);
  // null = either no real active challenge to headline, or the fetch
  // below hasn't resolved yet — same "never break the screen, just fall
  // back" pattern ChallengesScreen uses for its own list. Distinct from
  // loadingPrimary below: this screen used to show the sample "Marcus"
  // content immediately and swap it out once the real fetch resolved,
  // which on a slow connection reads as "the app briefly shows someone
  // else's fake data" rather than "loading" — loadingPrimary lets the
  // render below tell those two states apart.
  const [primary, setPrimary] = useState<PrimaryChallenge | null>(null);
  // Only true when there's actually something async to wait for —
  // starts false when Supabase isn't configured, since the sample
  // fallback is the real, permanent content in that case, not a
  // placeholder for a fetch that's about to happen.
  const [loadingPrimary, setLoadingPrimary] = useState(isSupabaseConfigured);
  // Null until the fetch below resolves (or forever, unconfigured) —
  // the "N active · N finished" row stays hidden rather than showing a
  // misleading 0/0 while this is still loading.
  const [challengeCounts, setChallengeCounts] = useState<{ active: number; finished: number; invited: number } | null>(
    null,
  );

  const reload = useCallback(() => {
    health.getSnapshot().then(setSnap);
    // Same fetch MetricsScreen's own readiness card runs off — a big
    // enough window (50 most recent) to cover computeReadiness's 28-day
    // chronic baseline, not just today.
    health.getRecentWorkouts(50).then(setWorkouts);
  }, [health]);

  useEffect(reload, [reload]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      // pickPrimaryChallenge is the single source of truth for "which
      // challenge does Today show" — ChallengesScreen calls the exact
      // same function to mark that one in its own list, so the two
      // screens can't quietly disagree about it.
      const [highlighted, challenges, invites] = await Promise.all([
        supabaseChallengesProvider.getHighlightedChallenge(),
        supabaseChallengesProvider.listMyChallenges(),
        // Same list ChallengesScreen's own invite cards come from — a
        // pending invite isn't in `challenges` at all yet (see
        // supabaseChallenges.ts's listMyChallenges, fixed to no longer
        // include one just because it's visible under RLS), so this is
        // a separate count, not part of the active/finished split below.
        supabaseChallengesProvider.listMyChallengeInvites(),
      ]);
      const primaryId = pickPrimaryChallenge(challenges, highlighted)?.id ?? null;

      // One board per challenge, not just the primary one — needed for
      // the "N active · N finished" summary below the hero. Built from
      // the same isChallengeFinished ChallengesScreen's own active/
      // Finished split already uses, so this can't quietly disagree with
      // what tapping through to Challenges actually shows (a hunt
      // concluded early by a catch counts as finished here too, not just
      // one whose scheduled end passed). Every challenge's own
      // participants/leaderboard/bots is fetched exactly once here and
      // reused below for whichever one turns out to be primary, rather
      // than fetching that one a second time.
      const results = await Promise.all(
        challenges.map(async (c) => {
          const needsHeadStart = c.kind === 'hunt' && !!c.headStartDays;
          const [participants, leaderboard, bots, headStartLeaderboard] = await Promise.all([
            supabaseChallengesProvider.listParticipants(c.id),
            supabaseChallengesProvider.getLeaderboard(c.id),
            supabaseChallengesProvider.listBots(c.id),
            needsHeadStart
              ? supabaseChallengesProvider.getLeaderboard(c.id, headStartBaselineDayKey(c))
              : Promise.resolve<LeaderboardEntry[]>([]),
          ]);
          const sortBy = boardSortFor(c);
          const rawBoard = buildBoard(participants, leaderboard, bots, daysElapsedFraction(c), sortBy, c, headStartLeaderboard);
          const board = c.kind === 'hunt' ? withHuntCatches(rawBoard, sortBy, c) : rawBoard;
          return { challenge: c, board, finished: isChallengeFinished(c, board) };
        }),
      );
      if (cancelled) return;
      setChallengeCounts({
        active: results.filter((r) => !r.finished).length,
        finished: results.filter((r) => r.finished).length,
        invited: invites.length,
      });
      const primaryResult = results.find((r) => r.challenge.id === primaryId);
      if (primaryResult) setPrimary({ challenge: primaryResult.challenge, board: primaryResult.board });
    })()
      .catch(() => {
        // Stay on the sample fallback on any failure.
      })
      .finally(() => {
        if (!cancelled) setLoadingPrimary(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const readiness = useMemo(() => computeReadiness(workouts), [workouts]);

  const hero = primary ? heroCopy(primary, user?.id ?? null, labels) : null;
  // No real challenge to open yet — sends a brand-new user (or the
  // unconfigured sandbox) to where "New challenge" actually lives,
  // instead of the old fallback of opening the hardcoded Hunt demo as if
  // it were this user's own chase.
  const openPrimary = primary ? () => onOpenChallenge(primary.challenge.id) : () => onGoTab('challenges');

  // While the real fetch above is still in flight, show a spinner instead
  // of the sample "Marcus" content — that content used to render first and
  // get swapped out once real data arrived, which on a slow connection
  // reads as a flash of someone else's fake progress rather than a loading
  // state.
  if (loadingPrimary) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator color={color.accent} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.heroRow}>
        <View style={styles.heroText}>
          <Text style={text.eyebrow}>{hero?.eyebrow ?? 'GET STARTED'}</Text>
          <Text style={[text.h2, styles.heroTitle]}>
            {hero?.headline ?? 'Start a challenge to see your progress here.'}
          </Text>
        </View>
        <Button
          label={primary ? 'View challenge' : 'New challenge'}
          variant="primary"
          icon={
            primary ? (
              <CrosshairIcon size={15} color={color.accent} />
            ) : (
              <PlusCircleIcon size={15} color={color.accent} />
            )
          }
          onPress={openPrimary}
        />
      </View>

      {/* Hidden until the counts fetch resolves (or never, unconfigured/
          no challenges at all) — see challengeCounts' own state comment.
          Exists for the same reason ChallengesScreen splits its own list
          into "active" and "Finished": once there are more than a
          handful of challenges, it's not obvious at a glance how many
          are still actually running versus just sitting there finished. */}
      {challengeCounts && challengeCounts.active + challengeCounts.finished + challengeCounts.invited > 0 && (
        <Pressable style={styles.countsRow} onPress={() => onGoTab('challenges')}>
          <FlagCheckeredIcon size={13} color={color.accent} />
          <Text style={styles.countsText}>
            {challengeCounts.active} active · {challengeCounts.finished} finished
            {/* Called out in accentActive, not the row's own plain text
                color — the whole point of surfacing this count here is
                so a pending invite (which otherwise only shows as a
                card at the top of the Challenges tab) is visible at a
                glance from Today too, without opening that tab first. */}
            {challengeCounts.invited > 0 && (
              <Text style={styles.countsInvited}> · {challengeCounts.invited} invited</Text>
            )}
          </Text>
          <CaretRightIcon size={12} color={withAlpha(colors.text, 0.4)} />
        </Pressable>
      )}

      {/* Resting HR and Weight moved to the Data tab (MetricsScreen already
          has its own dedicated "Heart rate"/"Weight" views with real
          7-day charts) — Today only keeps the two metrics that matter
          for a challenge in progress. */}
      <View style={styles.tileGrid}>
        <MetricTile
          label="Steps"
          Icon={FootprintsIcon}
          value={(snap?.stepsToday ?? 0).toLocaleString()}
          sub={`${Math.round(((snap?.stepsToday ?? 0) / (snap?.stepsGoal ?? 10000)) * 100)}% of ${(snap?.stepsGoal ?? 10000).toLocaleString()} · ${snap?.source ?? ''}`}
          pct={((snap?.stepsToday ?? 0) / (snap?.stepsGoal ?? 10000)) * 100}
          onPress={() => onGoTab('metrics')}
          styles={styles}
        />
        <MetricTile
          label="Distance"
          Icon={PathIcon}
          value={`${(snap?.distanceTodayMi ?? 0).toFixed(1)} mi`}
          sub="1 walk, 1 run logged"
          pct={63}
          onPress={() => onGoTab('metrics')}
          styles={styles}
        />
      </View>

      {/* One-line pointer to the Data tab's own Readiness card (see the
          readiness plan doc) — Home is the screen someone actually opens
          daily, so the signal gets a glance here even though the real
          detail (reasoning, component breakdown) only lives on Data. */}
      <Pressable style={styles.readinessChip} onPress={() => onGoTab('metrics')}>
        <View style={[styles.readinessDot, { backgroundColor: toneColor(READINESS_COPY[readiness.label].tone, colors) }]} />
        <Text style={styles.readinessChipText} numberOfLines={1}>
          {READINESS_COPY[readiness.label].title}
        </Text>
        <CaretRightIcon size={12} color={withAlpha(colors.text, 0.4)} />
      </Pressable>

      <View style={styles.cardsRow}>
        {primary ? (
          primary.challenge.kind === 'hunt' && primary.board.length === 2 ? (
            <LiveHuntCard primary={primary} userId={user?.id ?? null} onOpen={openPrimary} styles={styles} />
          ) : primary.challenge.kind === 'hunt' ? (
            <LiveMultiHuntCard primary={primary} userId={user?.id ?? null} onOpen={openPrimary} styles={styles} />
          ) : (
            <LiveLeaderboardCard primary={primary} userId={user?.id ?? null} onOpen={openPrimary} styles={styles} colors={colors} />
          )
        ) : (
          <GettingStartedCards onGoTab={onGoTab} styles={styles} />
        )}
      </View>
    </ScrollView>
  );
}

// Shown in place of a live challenge card whenever there's no real one
// to headline — a brand-new user with nothing yet, or Supabase
// unconfigured. Replaces the old hardcoded "Jordan vs Marcus" hunt +
// "March Step Race" cards, which rendered as if they were this user's
// own history with nothing marking them as sample — exactly the
// "fabricated data indistinguishable from real data" problem
// ChallengesScreen's empty state fixed, except here there's no real
// history to fall back to being honest about, so the honest content is
// an explanation of what the app can actually do instead.
function GettingStartedCards({ onGoTab, styles }: { onGoTab: (tab: MainTab) => void; styles: HomeStyles }) {
  const { labels } = useLabels();
  return (
    <>
      <Card style={styles.onboardCard} elevated={false}>
        <View style={styles.onboardHeader}>
          <TrophyIcon size={15} color={color.accent} />
          <Text style={styles.onboardTitle}>Ways to compete</Text>
        </View>
        <Text style={styles.onboardBody}>
          Every challenge here runs on real logged steps or distance. Pick a kind and invite people in.
        </Text>
        <View style={styles.typeList}>
          {CHALLENGE_TYPES.map((t) => {
            const Icon = CHALLENGE_KIND_ICON[t.id];
            return (
              <View key={t.id} style={styles.typeRow}>
                <View style={[styles.typeIcon, { backgroundColor: t.tint }]}>
                  <Icon size={16} color={t.iconColor} weight={t.id === 'hunt' ? 'fill' : 'regular'} />
                </View>
                <View style={styles.typeText}>
                  <Text style={styles.typeName}>{t.id === 'hunt' ? huntKindName() : t.name}</Text>
                  <Text style={styles.typeDesc}>{t.desc}</Text>
                </View>
              </View>
            );
          })}
        </View>
        <Button
          label="New challenge"
          variant="primary"
          small
          icon={<PlusCircleIcon size={14} color={color.accent} />}
          onPress={() => onGoTab('challenges')}
        />
      </Card>

      <Card style={styles.onboardCard} elevated={false}>
        <View style={styles.onboardHeader}>
          <ArrowsClockwiseIcon size={15} color={color.accent} />
          <Text style={styles.onboardTitle}>Your data syncs automatically</Text>
        </View>
        <Text style={styles.onboardBody}>
          Connect Apple Health or Health Connect once and every step-based challenge backfills and
          keeps updating on its own — no manual logging needed for steps.
        </Text>
        <Button label="Manage data sources" variant="ghost" small onPress={() => onGoTab('metrics')} />
      </Card>

      <Card style={styles.onboardCard} elevated={false}>
        <View style={styles.onboardHeader}>
          <UserPlusIcon size={15} color={color.accent} />
          <Text style={styles.onboardTitle}>Bring your friends in</Text>
        </View>
        <Text style={styles.onboardBody}>
          Find a friend by email and invite them straight into a challenge — that's how a {labels.hunter}{' '}
          and {labels.hunted} end up chasing each other.
        </Text>
        <Button label="Find friends" variant="ghost" small onPress={() => onGoTab('friends')} />
      </Card>
    </>
  );
}

// A real two-way hunt, laid out the same as the sample card: a track with
// both racers' positions and a lead/behind readout. Positions are a
// proportional stand-in for "who's ahead by how much" (clamped so the gap
// stays readable), not a literal distance-to-pixel mapping.
function LiveHuntCard({
  primary,
  userId,
  onOpen,
  styles,
}: {
  primary: PrimaryChallenge;
  userId: string | null;
  onOpen: () => void;
  styles: HomeStyles;
}) {
  const { challenge, board } = primary;
  const me = board.find((r) => r.userId === userId);
  const rival = board.find((r) => r.userId !== userId);
  if (!me || !rival) return null;

  const daysElapsed = Math.min(
    challenge.durationDays,
    Math.max(1, Math.floor((Date.now() - new Date(challenge.startsAt).getTime()) / 86_400_000) + 1),
  );
  // Once either side is 'zombie' the chase is over — the marker gap and
  // lead/behind readout below stop meaning anything the moment that's
  // true, so both collapse to "caught" instead of stale numbers.
  const caught = me.role === 'zombie' || rival.role === 'zombie';
  const { lead, unit, rivalTotal } = huntLeadMetric(me, rival, challenge);
  // Same "readable gap, not a literal scale" idea in either unit — 1 mi
  // moves the marker 2 points, 250 steps moves it 1 point, both clamped
  // to the same readable range.
  const gapPct = caught ? 0 : Math.min(40, Math.max(4, Math.abs(lead) * (unit === 'mi' ? 2 : 1 / 250)));
  const meLeft = lead >= 0 ? 78 : 78 - gapPct;
  const rivalLeft = lead >= 0 ? 78 - gapPct : 78;

  return (
    <Card style={styles.huntCard} elevated={false}>
      <View style={styles.huntHeader}>
        <PawPrintIcon size={15} color={color.accent300} weight="fill" />
        <Text style={styles.huntTitle}>{challenge.name}</Text>
        <Tag label={caught ? 'Caught' : `day ${daysElapsed} / ${challenge.durationDays}`} variant="outline" />
      </View>
      <View style={styles.huntTrack}>
        <View style={styles.huntTrackLine} />
        <View style={[styles.huntMarker, styles.hunterMarker, { left: `${rivalLeft}%` }]}>
          <SneakerMoveIcon size={14} color={color.neutral200} />
        </View>
        <View style={[styles.huntMarker, styles.huntedMarker, { left: `${meLeft}%` }]}>
          <SneakerMoveIcon size={14} color={color.accent100} weight="fill" />
        </View>
      </View>
      <View style={styles.huntStatsRow}>
        {caught ? (
          <>
            <Text style={styles.huntLead}>{me.role === 'zombie' ? 'Caught' : 'Got them!'}</Text>
            <Text style={styles.huntNote}>
              {me.role === 'zombie'
                ? `${rival.name} caught you — the chase is over.`
                : `You caught ${rival.name} — the chase is over.`}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.huntLead}>
              {formatLead(Math.abs(lead), unit)}
              <Text style={styles.huntLeadSuffix}> {lead >= 0 ? 'lead' : 'behind'}</Text>
            </Text>
            <Text style={styles.huntNote}>
              {rival.name} has logged {formatLead(rivalTotal, unit)} so far.
            </Text>
          </>
        )}
      </View>
      <Button label="See the tally" variant="primary" small onPress={onOpen} />
    </Card>
  );
}

// A hunt with more than one Hunted (bots, multiple friends, or both) —
// LiveHuntCard's own two-person "open road between you" framing doesn't
// generalize to more than one rival on a fixed scale, so this puts
// every Hunted/Zombie participant on one shared 0-100% track instead,
// each positioned by how much of their own gap the Hunter's real
// effective progress (huntEffectiveMetric — the same number
// ChallengeDetailScreen's own "Chase progress" card already computes,
// condensed for Home) has actually closed. 100% always means caught,
// regardless of that person's own total, so pucks stay comparable to
// each other even though they're each being chased toward a different
// number.
function LiveMultiHuntCard({
  primary,
  userId,
  onOpen,
  styles,
}: {
  primary: PrimaryChallenge;
  userId: string | null;
  onOpen: () => void;
  styles: HomeStyles;
}) {
  const { labels } = useLabels();
  const { challenge, board } = primary;
  const hunter = board.find((r) => r.role === 'hunter');
  if (!hunter) return null;

  const sortBy = boardSortFor(challenge);
  const unit: 'mi' | 'steps' = sortBy === 'distance' ? 'mi' : 'steps';
  const hunterMetric = huntEffectiveMetric(hunter, sortBy);
  const targets = board
    .filter((r) => r.role === 'hunted' || r.role === 'zombie')
    .map((row) => {
      const total = sortBy === 'distance' ? row.totalDistanceMi : row.totalSteps;
      const pct = row.role === 'zombie' ? 100 : total > 0 ? Math.min(100, (hunterMetric / total) * 100) : 0;
      return { row, total, pct, gap: Math.max(0, total - hunterMetric) };
    });
  // The headline and the spotlighted puck both feature whoever's
  // genuinely closest to being caught — a Zombie is never "closest," it
  // already happened, so this only ever looks at who's still Hunted.
  const stillOut = targets.filter((t) => t.row.role === 'hunted').sort((a, b) => b.pct - a.pct);
  const closest = stillOut[0];
  const closestName = closest?.row.userId === userId ? 'you' : closest?.row.name;
  const hunterIsMe = hunter.userId === userId;
  const hunterName = hunterIsMe ? 'You' : hunter.name;
  const caughtCount = targets.length - stillOut.length;

  const daysElapsed = Math.min(
    challenge.durationDays,
    Math.max(1, Math.floor((Date.now() - new Date(challenge.startsAt).getTime()) / 86_400_000) + 1),
  );
  const concluded = targets.length > 0 && stillOut.length === 0;

  // Most people read left to right, and the Hunter is the one *behind*,
  // doing the chasing — so it anchors the left edge (HUNTER_POS), not
  // the finish line on the right. A still-Hunted target's own pct (0 =
  // hasn't been touched, approaching 100 = about to be caught) maps
  // backward from there: the safest sits out near the right edge, and
  // closing the gap pulls their puck leftward, toward the Hunter — but
  // never quite reaching or passing it, since that position would read
  // as "about to be caught," not "already caught." A Zombie isn't on
  // that gradient at all: it jumps to a fixed spot *behind* the Hunter
  // (CAUGHT_POS, left of HUNTER_POS) the instant withHuntCatches flips
  // them, the same way the Hunter has visibly already passed them by in
  // a real chase, rather than sitting just short of the Hunter forever.
  const HUNTER_POS = 8;
  const CAUGHT_POS = 2;
  const trackPosFor = (pct: number) => 90 - (Math.min(100, Math.max(0, pct)) / 100) * 76;

  return (
    <Card style={styles.huntCard} elevated={false}>
      <View style={styles.huntHeader}>
        <PawPrintIcon size={15} color={color.accent300} weight="fill" />
        <Text style={styles.huntTitle}>{challenge.name}</Text>
        <Tag label={concluded ? 'Caught everyone' : `day ${daysElapsed} / ${challenge.durationDays}`} variant="outline" />
      </View>

      {!closest ? (
        <Text style={styles.huntNote}>
          {concluded
            ? `The ${labels.hunter}'s caught everyone — the chase is over.`
            : 'No one to chase yet.'}
        </Text>
      ) : (
        <>
          <View style={styles.huntStatsRow}>
            <Text style={styles.huntLead}>
              <Text style={styles.huntLeadSuffix}>{hunterName} {hunterIsMe ? 'need' : 'needs'} </Text>
              {formatLead(closest.gap, unit)}
              <Text style={styles.huntLeadSuffix}> left to catch {closestName}</Text>
            </Text>
            <Text style={styles.huntNote}>
              {caughtCount > 0
                ? `${caughtCount} of ${targets.length} already caught.`
                : `${targets.length} still out there.`}
            </Text>
          </View>
          <View style={styles.multiTrack}>
            <View style={styles.multiTrackDots}>
              {Array.from({ length: 18 }).map((_, i) => (
                <View key={i} style={styles.multiTrackDot} />
              ))}
            </View>
            {targets.map((t) => {
              const caught = t.row.role === 'zombie';
              return (
                <View
                  key={t.row.userId}
                  style={[
                    styles.multiPuck,
                    caught ? styles.multiPuckCaught : t.row.userId === closest.row.userId && styles.multiPuckSpotlight,
                    { left: `${caught ? CAUGHT_POS : trackPosFor(t.pct)}%` },
                  ]}
                >
                  <Avatar initials={t.row.initials} tint={caught ? color.neutral800 : TINT_N} size={22} fontSize={9} />
                  {/* A literal strikethrough, not just the dimmed
                      opacity above — "caught" should read at a glance,
                      not just as a slightly-fainter avatar next to
                      everyone else's. */}
                  {caught && <View style={styles.multiPuckStrike} />}
                </View>
              );
            })}
            {/* Amber + paw print, not the same neutral gray a caught
                Zombie's puck already uses — the Hunter needs its own
                unmistakable color so it doesn't read as just another
                (caught) participant. Fixed at the left edge, ahead of
                every Zombie's own fixed CAUGHT_POS — see trackPosFor's
                own comment for why. */}
            <View style={[styles.multiPuck, styles.multiHunterPuck, { left: `${HUNTER_POS}%` }]}>
              <PawPrintIcon size={14} color="#232a54" weight="fill" />
            </View>
          </View>
        </>
      )}
      <Button label="See the tally" variant="primary" small onPress={onOpen} />
    </Card>
  );
}

// Any real challenge that isn't a hunt at all (a step race, streak, or
// distance pool) — a ranked list scaled to whoever's currently leading,
// same shape as the sample race card.
function LiveLeaderboardCard({
  primary,
  userId,
  onOpen,
  styles,
  colors,
}: {
  primary: PrimaryChallenge;
  userId: string | null;
  onOpen: () => void;
  styles: HomeStyles;
  colors: Palette;
}) {
  const { challenge, board } = primary;
  const top = board.slice(0, 4);
  const scoredByDistance = boardSortFor(challenge) === 'distance';
  const metric = (r: BoardEntry) => (scoredByDistance ? r.totalDistanceMi : r.totalSteps);
  const maxMetric = Math.max(1, ...board.map(metric));
  const daysLeft = Math.max(0, Math.ceil((new Date(challenge.endsAt).getTime() - Date.now()) / 86_400_000));

  return (
    <Card style={styles.raceCard} elevated={false}>
      <View style={styles.raceHeader}>
        <TrophyIcon size={15} color={color.accent} />
        <Text style={styles.raceTitle}>{challenge.name}</Text>
        <Text style={styles.raceMeta}>
          {board.length} {board.length === 1 ? 'person' : 'people'} · {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
        </Text>
      </View>
      {top.map((row, i) => {
        const isMe = row.userId === userId;
        return (
          <View key={row.userId} style={styles.raceRow}>
            <Text style={styles.raceRank}>{i + 1}</Text>
            <Avatar initials={row.initials} tint={isMe ? TINT_A : TINT_N} size={24} fontSize={10} />
            <Text style={styles.raceName} numberOfLines={1}>
              {isMe ? 'You' : row.name}
            </Text>
            <View style={styles.raceBarWrap}>
              <ProgressBar
                pct={(metric(row) / maxMetric) * 100}
                fillColor={isMe ? colors.accentActive : '#796cbf'}
                height={3}
              />
            </View>
            <Text style={[styles.raceSteps, isMe && { color: colors.accentActive }]}>
              {scoredByDistance ? `${row.totalDistanceMi.toFixed(1)} mi` : row.totalSteps.toLocaleString()}
            </Text>
          </View>
        );
      })}
      {top.length === 0 && <Text style={styles.tileSub}>No one&rsquo;s logged anything yet.</Text>}
      <Button label="Full leaderboard" variant="ghost" small onPress={onOpen} />
    </Card>
  );
}

function MetricTile({
  label,
  Icon,
  value,
  sub,
  pct,
  barColor = color.accent,
  onPress,
  styles,
}: {
  label: string;
  Icon: React.ComponentType<any>;
  value: string;
  sub: string;
  pct: number;
  barColor?: string;
  onPress: () => void;
  styles: HomeStyles;
}) {
  return (
    <Pressable style={styles.tile} onPress={onPress}>
      <View style={styles.tileLabelRow}>
        <Icon size={14} color={color.accent} />
        <Text style={styles.tileLabel}>{label.toUpperCase()}</Text>
      </View>
      <Text style={styles.tileValue}>{value}</Text>
      <ProgressBar pct={pct} fillColor={barColor} />
      <Text style={styles.tileSub}>{sub}</Text>
    </Pressable>
  );
}

// The hunt card's own background used to be a fixed, hand-tuned dark navy
// regardless of theme, so it'd keep reading as a branded highlight
// instead of turning white like every other card in Light mode — but a
// permanently-dark card sitting in an otherwise-light screen just read as
// broken, not "branded." An accent wash over this theme's own `colors.bg`
// keeps the same "this card is special" pop in both themes (a muted
// purple-navy tint in Dark mode, a pale lavender in Light mode) without
// abandoning the theme, and its own text/divider styles below
// (huntTitle through multiTrackDot) go back to the theme-following
// `colors` param to match — HuntScreen's progressCard and
// ChallengesScreen's inviteCard get the same treatment, for the same
// reason.
function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 20, paddingBottom: 48 },
    loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    heroRow: { gap: 14 },
    heroText: { gap: 6 },
    heroTitle: { fontSize: 28 },
    countsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 7,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: colors.surface,
    },
    countsText: { fontSize: 12.5, color: colors.text, fontFamily: font.heading },
    countsInvited: { color: colors.accentActive },
    readinessChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    readinessDot: { width: 8, height: 8, borderRadius: 4 },
    readinessChipText: { flex: 1, fontSize: 13.5, fontFamily: font.heading, color: colors.text },
    onboardCard: { padding: 16, gap: 10 },
    onboardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    onboardTitle: { fontFamily: font.heading, fontSize: 15, color: colors.text, flex: 1 },
    onboardBody: { fontSize: 13, color: withAlpha(colors.text, 0.7), lineHeight: 18 },
    typeList: { gap: 10, marginTop: 2 },
    typeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    typeIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    typeText: { flex: 1, gap: 1 },
    typeName: { fontFamily: font.heading, fontSize: 13.5, color: colors.text },
    typeDesc: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    tile: {
      flexBasis: '47%',
      flexGrow: 1,
      gap: 10,
      padding: 14,
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    tileLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    tileLabel: { fontSize: 11, letterSpacing: 1, color: colors.accent },
    tileValue: { fontFamily: font.heading, fontSize: 28, color: colors.text },
    tileSub: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    cardsRow: { gap: 12 },
    // Fixed, hand-tuned dark background regardless of theme — the same
    // "always-dark spotlight card" reasoning as HuntScreen's progressCard
    // (see that file's own comment). Everything drawn on top of it below
    // (huntTitle through multiTrackDot) uses the fixed dark `color` import
    // rather than this theme-following `colors` param, for the same
    // reason: in Light mode, `colors.text`/`colors.divider` flip to their
    // near-black light-mode values, which would read as invisible against
    // this card's permanently-dark navy.
    huntCard: {
      backgroundColor: withAlpha(colors.accent, 0.14),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.4),
      gap: 12,
      padding: 16,
    },
    huntHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    huntTitle: { fontFamily: font.heading, fontSize: 16, color: colors.text, flex: 1 },
    huntTrack: { height: 44, borderRadius: 8, justifyContent: 'center' },
    huntTrackLine: { height: 1, backgroundColor: colors.divider },
    huntMarker: {
      position: 'absolute',
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      top: 7,
    },
    hunterMarker: { backgroundColor: colors.neutral800 },
    huntedMarker: { backgroundColor: colors.accent800, borderWidth: 1, borderColor: colors.accent },
    huntStatsRow: { gap: 4 },
    huntLead: { fontFamily: font.heading, fontSize: 24, color: colors.text },
    huntLeadSuffix: { fontSize: 13, color: withAlpha(colors.text, 0.65), fontFamily: font.body },
    huntNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    multiTrack: { height: 36, justifyContent: 'center' },
    multiTrackDots: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    multiTrackDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.divider },
    multiPuck: { position: 'absolute', top: 3 },
    multiPuckSpotlight: { borderRadius: 15, borderWidth: 1.5, borderColor: colors.accent, padding: 1.5 },
    multiPuckCaught: { opacity: 0.6 },
    multiPuckStrike: {
      position: 'absolute',
      top: 10,
      left: 0,
      width: 22,
      height: 2,
      borderRadius: 1,
      backgroundColor: colors.amber,
    },
    multiHunterPuck: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.amber,
      alignItems: 'center',
      justifyContent: 'center',
    },
    raceCard: { padding: 16, gap: 10 },
    raceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    raceTitle: { fontFamily: font.heading, fontSize: 16, color: colors.text, flex: 1 },
    raceMeta: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    raceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
    raceRank: { width: 14, fontSize: 12, color: withAlpha(colors.text, 0.55) },
    raceName: { fontSize: 13.5, color: colors.text, width: 62 },
    raceBarWrap: { flex: 1, minWidth: 0 },
    raceSteps: { fontSize: 12.5, color: colors.text, width: 56, textAlign: 'right' },
  });
}

type HomeStyles = ReturnType<typeof makeStyles>;
