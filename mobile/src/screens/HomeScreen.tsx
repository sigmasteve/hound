import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AppleLogoIcon,
  ArrowsClockwiseIcon,
  CrosshairIcon,
  FootprintsIcon,
  HeartbeatIcon,
  PathIcon,
  PawPrintIcon,
  ScalesIcon,
  SneakerMoveIcon,
  TrophyIcon,
  WarningIcon,
} from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ProgressBar } from '../components/ProgressBar';
import { Tag } from '../components/Tag';
import { text } from '../theme/text';
import { color, font, TINT_A, TINT_N } from '../theme/tokens';
import { useHealthProvider } from '../health/HealthContext';
import type { HealthSnapshot } from '../health/types';
import { CHALLENGE_TYPES, RACE_BOARD } from '../data/sampleData';
import type { MainTab } from '../navigation/types';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { supabaseChallengesProvider } from '../challenges/supabaseChallenges';
import {
  buildBoard,
  hasHeadStartElapsed,
  headStartEndDayKey,
  huntEffectiveMetric,
  isChallengeFinished,
  withHuntCatches,
  type BoardEntry,
} from '../challenges/board';
import { daysElapsedFraction } from '../challenges/botSimulation';
import { boardSortFor } from '../challenges/scoring';
import { ordinal } from '../challenges/present';
import type { Challenge, LeaderboardEntry } from '../challenges/types';

function timeAgo(d: Date | null): string {
  if (!d) return '—';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)}h ago`;
}

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
function heroCopy(primary: PrimaryChallenge, userId: string | null): { eyebrow: string; headline: string } {
  const { challenge, board } = primary;
  const daysElapsed = Math.min(
    challenge.durationDays,
    Math.max(1, Math.floor((Date.now() - new Date(challenge.startsAt).getTime()) / 86_400_000) + 1),
  );
  const kindLabel = CHALLENGE_TYPES.find((t) => t.id === challenge.kind)?.name ?? challenge.kind;
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
      return { eyebrow, headline: `${rival.name} caught you. The hunt's over.` };
    }
    if (rival.role === 'zombie') {
      return { eyebrow, headline: `You caught ${rival.name}! The hunt's over.` };
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
  const [snap, setSnap] = useState<HealthSnapshot | null>(null);
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

  const reload = useCallback(() => {
    health.getSnapshot().then(setSnap);
  }, [health]);

  useEffect(reload, [reload]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      // Whichever challenge the user explicitly highlighted from its own
      // detail screen (see ChallengeDetailScreen's "Highlight on Today
      // screen" toggle) wins, as long as it hasn't ended — falling back
      // to the most recently created still-active one otherwise, same as
      // before that feature existed.
      const highlighted = await supabaseChallengesProvider.getHighlightedChallenge();
      const active =
        highlighted && new Date(highlighted.endsAt).getTime() > Date.now()
          ? highlighted
          : (await supabaseChallengesProvider.listMyChallenges()).find((c) => new Date(c.endsAt).getTime() > Date.now());
      if (!active) return;
      // A hunt with a head start needs one extra fetch — everyone's
      // total as of the day the head start ended — so the Hunter's
      // effective progress (huntEffectiveMetric) can be measured from
      // there instead of from zero. Skipped otherwise; nothing to credit.
      const needsHeadStart = active.kind === 'hunt' && !!active.headStartDays;
      const [participants, leaderboard, bots, headStartLeaderboard] = await Promise.all([
        supabaseChallengesProvider.listParticipants(active.id),
        supabaseChallengesProvider.getLeaderboard(active.id),
        supabaseChallengesProvider.listBots(active.id),
        needsHeadStart
          ? supabaseChallengesProvider.getLeaderboard(active.id, headStartEndDayKey(active))
          : Promise.resolve<LeaderboardEntry[]>([]),
      ]);
      const sortBy = boardSortFor(active);
      const rawBoard = buildBoard(
        participants,
        leaderboard,
        bots,
        daysElapsedFraction(active),
        sortBy,
        active,
        headStartLeaderboard,
      );
      const board = active.kind === 'hunt' ? withHuntCatches(rawBoard, sortBy, active) : rawBoard;
      if (!cancelled) setPrimary({ challenge: active, board });
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

  const hero = primary ? heroCopy(primary, user?.id ?? null) : null;
  const openPrimary = primary ? () => onOpenChallenge(primary.challenge.id) : onOpenHunt;

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
          <Text style={text.eyebrow}>{hero?.eyebrow ?? 'TUESDAY · WEEK 3 OF THE HUNT'}</Text>
          <Text style={[text.h2, styles.heroTitle]}>{hero?.headline ?? 'Marcus is 7.4 mi behind you.'}</Text>
        </View>
        <Button
          label={primary ? 'View challenge' : 'Open the chase'}
          variant="primary"
          icon={<CrosshairIcon size={15} color={color.accent} />}
          onPress={openPrimary}
        />
      </View>

      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <AppleLogoIcon size={14} color={color.text} weight="fill" />
          <Text style={styles.badgeLabel}>Apple Health</Text>
          <View style={[styles.dot, { backgroundColor: color.green }]} />
          <Text style={styles.badgeMuted}>{timeAgo(snap?.lastSyncedAt ?? null)}</Text>
        </View>
        <Pressable style={styles.syncBtn} onPress={reload}>
          <ArrowsClockwiseIcon size={13} color={color.accent} />
          <Text style={styles.syncLabel}>Sync now</Text>
        </Pressable>
      </View>

      {/* "Nudge" and friend-staleness detection need a real cross-device
          integration that doesn't exist yet — this stays sample-only
          content, not something to fake for a real challenge. */}
      {!primary && (
        <Card style={styles.staleCard} elevated={false}>
          <View style={styles.staleRow}>
            <WarningIcon size={18} color={color.amber} weight="fill" />
            <View style={styles.staleText}>
              <Text style={styles.staleTitle}>Theo&rsquo;s Pixel hasn&rsquo;t reported since Sunday</Text>
              <Text style={styles.staleBody}>
                His step race total is frozen at 41,208. Scores stay provisional until Health Connect
                catches up.
              </Text>
            </View>
          </View>
        </Card>
      )}

      <View style={styles.tileGrid}>
        <MetricTile
          label="Steps"
          Icon={FootprintsIcon}
          value={(snap?.stepsToday ?? 0).toLocaleString()}
          sub={`${Math.round(((snap?.stepsToday ?? 0) / (snap?.stepsGoal ?? 10000)) * 100)}% of ${(snap?.stepsGoal ?? 10000).toLocaleString()} · ${snap?.source ?? ''}`}
          pct={((snap?.stepsToday ?? 0) / (snap?.stepsGoal ?? 10000)) * 100}
          onPress={() => onGoTab('metrics')}
        />
        <MetricTile
          label="Distance"
          Icon={PathIcon}
          value={`${(snap?.distanceTodayMi ?? 0).toFixed(1)} mi`}
          sub="1 walk, 1 run logged"
          pct={63}
          onPress={() => onGoTab('metrics')}
        />
        <MetricTile
          label="Resting HR"
          Icon={HeartbeatIcon}
          value={snap?.restingHeartRateBpm != null ? `${snap.restingHeartRateBpm} bpm` : '—'}
          sub="Down 3 bpm over 30 days"
          pct={42}
          barColor={color.accent600}
          onPress={() => onGoTab('metrics')}
        />
        <MetricTile
          label="Weight"
          Icon={ScalesIcon}
          value={snap?.latestWeightLb != null ? `${snap.latestWeightLb} lb` : '—'}
          sub="Last entry Sunday · Withings"
          pct={28}
          barColor={color.accent600}
          onPress={() => onGoTab('metrics')}
        />
      </View>

      <View style={styles.cardsRow}>
        {primary ? (
          primary.challenge.kind === 'hunt' && primary.board.length === 2 ? (
            <LiveHuntCard primary={primary} userId={user?.id ?? null} onOpen={openPrimary} />
          ) : (
            <LiveLeaderboardCard primary={primary} userId={user?.id ?? null} onOpen={openPrimary} />
          )
        ) : (
          <>
            <Card style={styles.huntCard} elevated={false}>
              <View style={styles.huntHeader}>
                <PawPrintIcon size={15} color={color.accent300} weight="fill" />
                <Text style={styles.huntTitle}>The Hunt · Jordan vs Marcus</Text>
                <Tag label="day 9 / 21" variant="outline" />
              </View>
              <View style={styles.huntTrack}>
                <View style={styles.huntTrackLine} />
                <View style={[styles.huntMarker, styles.hunterMarker, { left: '58%' }]}>
                  <SneakerMoveIcon size={14} color={color.neutral200} />
                </View>
                <View style={[styles.huntMarker, styles.huntedMarker, { left: '78%' }]}>
                  <SneakerMoveIcon size={14} color={color.accent100} weight="fill" />
                </View>
              </View>
              <View style={styles.huntStatsRow}>
                <Text style={styles.huntLead}>
                  7.4 mi<Text style={styles.huntLeadSuffix}> lead</Text>
                </Text>
                <Text style={styles.huntNote}>Marcus logged 6.1 mi yesterday. Shrinking fast.</Text>
              </View>
              <Button label="See the tally" variant="primary" small onPress={onOpenHunt} />
            </Card>

            <Card style={styles.raceCard} elevated={false}>
              <View style={styles.raceHeader}>
                <TrophyIcon size={15} color={color.accent} />
                <Text style={styles.raceTitle}>March Step Race</Text>
                <Text style={styles.raceMeta}>5 friends · 4 days left</Text>
              </View>
              {RACE_BOARD.map((row) => (
                <View key={row.rank} style={styles.raceRow}>
                  <Text style={styles.raceRank}>{row.rank}</Text>
                  <Avatar initials={row.initials} tint={row.tint} size={24} fontSize={10} />
                  <Text style={styles.raceName}>{row.name}</Text>
                  <ProgressBar pct={row.pct} fillColor={row.bar} height={3} trackColor={color.neutral900} />
                  <Text style={[styles.raceSteps, row.highlight && { color: color.accent200 }]}>
                    {row.steps}
                  </Text>
                </View>
              ))}
              <Button label="Full leaderboard" variant="ghost" small onPress={() => onGoTab('challenges')} />
            </Card>
          </>
        )}
      </View>
    </ScrollView>
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
}: {
  primary: PrimaryChallenge;
  userId: string | null;
  onOpen: () => void;
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
                ? `${rival.name} caught you — the hunt's over.`
                : `You caught ${rival.name} — the hunt's over.`}
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

// Any real challenge that isn't a clean two-way hunt (a step race, streak,
// distance pool, or a hunt with a bot added on top of a real rival) — a
// ranked list scaled to whoever's currently leading, same shape as the
// sample race card.
function LiveLeaderboardCard({
  primary,
  userId,
  onOpen,
}: {
  primary: PrimaryChallenge;
  userId: string | null;
  onOpen: () => void;
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
            <Text style={styles.raceName}>{isMe ? 'You' : row.name}</Text>
            <ProgressBar
              pct={(metric(row) / maxMetric) * 100}
              fillColor={isMe ? color.accent200 : '#796cbf'}
              height={3}
              trackColor={color.neutral900}
            />
            <Text style={[styles.raceSteps, isMe && { color: color.accent200 }]}>
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
}: {
  label: string;
  Icon: React.ComponentType<any>;
  value: string;
  sub: string;
  pct: number;
  barColor?: string;
  onPress: () => void;
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

const styles = StyleSheet.create({
  container: { padding: 16, gap: 20, paddingBottom: 48 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroRow: { gap: 14 },
  heroText: { gap: 6 },
  heroTitle: { fontSize: 28 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: color.surface,
  },
  badgeLabel: { fontSize: 12, color: color.text },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeMuted: { fontSize: 12, color: 'rgba(233,233,237,0.55)' },
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingVertical: 4 },
  syncLabel: { fontSize: 12, color: color.accent, fontFamily: font.heading },
  staleCard: { backgroundColor: '#2a2115', flexDirection: 'row' },
  staleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flex: 1 },
  staleText: { flex: 1, gap: 2 },
  staleTitle: { fontFamily: font.heading, fontSize: 14, color: color.text },
  staleBody: { fontSize: 13, color: 'rgba(233,233,237,0.78)' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: 10,
    padding: 14,
    borderRadius: 8,
    backgroundColor: color.surface,
  },
  tileLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  tileLabel: { fontSize: 11, letterSpacing: 1, color: color.accent },
  tileValue: { fontFamily: font.heading, fontSize: 28, color: color.text },
  tileSub: { fontSize: 12, color: 'rgba(233,233,237,0.55)' },
  cardsRow: { gap: 12 },
  huntCard: { backgroundColor: '#232a54', gap: 12, padding: 16 },
  huntHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  huntTitle: { fontFamily: font.heading, fontSize: 16, color: color.text, flex: 1 },
  huntTrack: { height: 44, borderRadius: 8, justifyContent: 'center' },
  huntTrackLine: { height: 1, backgroundColor: color.divider },
  huntMarker: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    top: 7,
  },
  hunterMarker: { backgroundColor: color.neutral800 },
  huntedMarker: { backgroundColor: color.accent800, borderWidth: 1, borderColor: color.accent },
  huntStatsRow: { gap: 4 },
  huntLead: { fontFamily: font.heading, fontSize: 24, color: color.text },
  huntLeadSuffix: { fontSize: 13, color: 'rgba(233,233,237,0.65)', fontFamily: font.body },
  huntNote: { fontSize: 12.5, color: 'rgba(233,233,237,0.55)' },
  raceCard: { padding: 16, gap: 10 },
  raceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  raceTitle: { fontFamily: font.heading, fontSize: 16, color: color.text, flex: 1 },
  raceMeta: { fontSize: 12, color: 'rgba(233,233,237,0.55)' },
  raceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  raceRank: { width: 14, fontSize: 12, color: 'rgba(233,233,237,0.55)' },
  raceName: { fontSize: 13.5, color: color.text, width: 62 },
  raceSteps: { fontSize: 12.5, color: color.text, width: 56, textAlign: 'right' },
});
