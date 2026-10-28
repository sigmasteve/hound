import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { useFocusEffect } from '@react-navigation/native';
import {
  CaretRightIcon,
  EnvelopeOpenIcon,
  HouseIcon,
  MedalIcon,
  PlusCircleIcon,
} from 'phosphor-react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { LoadingView } from '../components/LoadingView';
import { useTheme } from '../theme/ThemeContext';
import { color, font, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_TYPES, type ChallengeCard } from '../data/sampleData';
import { CHALLENGE_KIND_ICON, DEFAULT_CHALLENGE_ICON } from '../data/challengeIcons';
import { isSupabaseConfigured } from '../lib/supabase';
import { loadBoardInputs, supabaseChallengesProvider } from '../challenges/supabaseChallenges';
import { pickPrimaryChallenge } from '../challenges/board';
import { getFeatureNewest } from '../challenges/todayFeature';
import { huntKindName, toChallengeCard } from '../challenges/present';
import { settleChallengeScore } from '../challenges/scoreApi';
import { useLabels } from '../labels/LabelsContext';
import type { Challenge, ChallengeInvite } from '../challenges/types';
import { listGlobalChallenges } from '../challenges/globalChallenges';
import { computeStreakStatus } from '../challenges/streak';
import { listDailyProgress, listParticipantJoinDates } from '../challenges/streakApi';
import { getChallengeDays } from '../challenges/challengeDays';
import { getOrganization } from '../organizations/supabaseOrganizations';
import { useAuth } from '../auth/AuthContext';

// A minimal, fetch-free stand-in for a challenge whose schedule has
// already ended — used until (and unless) "Finished" is actually
// expanded (see the lazy-fetch effect below), so this screen's default
// load doesn't pay the same participants/leaderboard/bots fetch for
// every challenge someone's ever finished, only for what's still live.
// FinishedRow only ever reads name/stat/statLabel, so nothing else
// here needs to be real — same "—"/"no data yet" fallback shape
// toChallengeCard already uses for a challenge nobody's logged
// anything in yet.
// This screen fully unmounts and remounts on every tab switch away and
// back (MainScreen.tsx renders each tab conditionally — unlike Home,
// which stays mounted for the app's own lifetime; see that screen's own
// comment on the difference). Without this, every single switch back to
// Challenges reset every piece of state to null/empty, showing the full
// loading spinner and re-running the whole participants/leaderboard/bots
// fetch for every active challenge from scratch — even for a switch that
// happened half a second ago with nothing changed in between. A
// module-level variable (not React state) survives exactly that
// unmount/remount, since it isn't torn down until the JS engine itself
// is (app backgrounded or killed, not just a tab switch) — the next
// mount seeds its initial state from here instead of null, paints
// immediately, and the useFocusEffect fetch below still runs and
// silently corrects anything actually stale, same "keep showing the old
// good data while a fresh fetch is in flight" shape this screen already
// used for a same-mount refocus. Never read after the module first
// loads except to seed a fresh mount's initial state — nothing here
// substitutes for a real fetch.
let cachedChallengesState: {
  liveCards: ChallengeCard[];
  finishedRawChallenges: Challenge[];
  primaryChallengeId: string | null;
  groupById: Map<string, ChallengeGroup>;
  orgName: string | null;
} | null = null;

// The headings the active list is split under. Each only shows when it
// has an active challenge in it, and none show when everything is in one
// group.
type ChallengeGroup = 'global' | 'personal' | 'org';
const GROUP_ORDER: ChallengeGroup[] = ['global', 'personal', 'org'];
let cachedInvites: ChallengeInvite[] | null = null;

function placeholderFinishedCard(c: Challenge): ChallengeCard {
  const typeDef = CHALLENGE_TYPES.find((t) => t.id === c.kind);
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    kindLabel: c.kind === 'hunt' ? huntKindName() : (typeDef?.name ?? c.kind),
    sub: '',
    stat: '—',
    statLabel: 'tap to see final standings',
    tint: typeDef?.tint ?? TINT_N,
    iconColor: typeDef?.iconColor ?? '#e9e9ed',
    people: [],
    target: 'detail',
    finished: true,
  };
}

export function ChallengesScreen({
  onOpenChallenge,
  onCreate,
}: {
  onOpenChallenge: (challengeId: string) => void;
  onCreate: () => void;
}) {
  const { user } = useAuth();
  const { colors, text } = useTheme();
  const { labelsForOrg } = useLabels();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // null = no fetch has resolved yet, whether that's because Supabase
  // isn't configured (it never will) or because the real fetch just
  // hasn't come back (it will, shortly — see challengesLoading below).
  // Either way this screen never fabricates challenges to fill the gap
  // — an unconfigured backend and a configured-but-empty one render
  // identically, as honest empty states.
  const [liveCards, setLiveCards] = useState<ChallengeCard[] | null>(cachedChallengesState?.liveCards ?? null);
  // Every challenge whose schedule has already ended (see loadChallenges
  // below) — kept as raw Challenge rows, not fetched into full cards,
  // until "Finished" is actually expanded. Classified from
  // listMyChallenges()'s own endsAt with no extra network call: a
  // challenge past its own endsAt is finished regardless of kind (see
  // isChallengeFinished, board.ts), so nothing here needs the
  // participants/leaderboard/bots fetch just to know that much.
  const [finishedRawChallenges, setFinishedRawChallenges] = useState<Challenge[]>(
    cachedChallengesState?.finishedRawChallenges ?? [],
  );
  // null = not fetched yet for this batch of finishedRawChallenges (see
  // the lazy-fetch effect below) — every entry gets a placeholderFinishedCard
  // instead in the meantime. Reset on every loadChallenges() call, same
  // "refreshes on every focus" convention the rest of this screen
  // already has, so a challenge that just crossed into "finished" isn't
  // stuck showing stale data forever.
  const [finishedCardOverrides, setFinishedCardOverrides] = useState<Map<string, ChallengeCard> | null>(null);
  const [loadingFinishedDetails, setLoadingFinishedDetails] = useState(false);
  // Same convention, independently, for challenge invites.
  const [liveInvites, setLiveInvites] = useState<ChallengeInvite[] | null>(cachedInvites);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  // Whichever challenge Home is currently showing as its own hero card —
  // pickPrimaryChallenge (src/challenges/board.ts) is the one place that
  // decision gets made, so this list can mark the exact same row instead
  // of a parallel guess. Null both before the first fetch resolves and
  // when nothing qualifies (no active challenges at all).
  const [primaryChallengeId, setPrimaryChallengeId] = useState<string | null>(
    cachedChallengesState?.primaryChallengeId ?? null,
  );
  // Collapsed by default — the medal tally is the headline, the finished
  // challenges themselves are detail you dig into, same "summary first,
  // list on demand" shape as MetricsScreen's Today's Workouts card.
  const [finishedExpanded, setFinishedExpanded] = useState(false);
  const [groupById, setGroupById] = useState<Map<string, ChallengeGroup>>(
    cachedChallengesState?.groupById ?? new Map(),
  );
  const [orgName, setOrgName] = useState<string | null>(cachedChallengesState?.orgName ?? null);

  const loadChallenges = async (): Promise<void> => {
    const [challenges, highlighted, globals, featureNewest] = await Promise.all([
      supabaseChallengesProvider.listMyChallenges(),
      supabaseChallengesProvider.getHighlightedChallenge(),
      // Only used to tell which of your challenges are global; a failure
      // just files them under Personal.
      listGlobalChallenges().catch(() => []),
      getFeatureNewest(),
    ]);
    const globalIds = new Set(globals.map((g) => g.id));
    const groups = new Map<string, ChallengeGroup>(
      challenges.map((c) => [c.id, globalIds.has(c.id) ? 'global' : c.organizationId ? 'org' : 'personal']),
    );
    const orgId = challenges.find((c) => !globalIds.has(c.id) && c.organizationId)?.organizationId ?? null;
    const org = orgId ? await getOrganization(orgId).catch(() => null) : null;
    const primaryId = pickPrimaryChallenge(challenges, highlighted, featureNewest)?.id ?? null;
    setPrimaryChallengeId(primaryId);
    // Only a challenge whose schedule hasn't ended yet needs the full
    // participants/leaderboard/bots fetch here — one still genuinely
    // running (to show its real live stat), or a hunt/tag that *might*
    // have concluded early (withHuntCatches/tagGroupGoalMet, both
    // computed inside toChallengeCard, need the board to tell). Anything
    // already past its own endsAt is finished no matter what that fetch
    // would've returned (see isChallengeFinished, board.ts), so it's
    // deferred instead — see finishedRawChallenges/the lazy-fetch effect
    // below. Without this split, this screen used to pay three queries
    // for every challenge anyone had ever finished, on every single
    // visit, growing without bound the longer an account's history got.
    const now = Date.now();
    const stillScheduled = challenges.filter((c) => new Date(c.endsAt).getTime() > now);
    const pastSchedule = challenges.filter((c) => new Date(c.endsAt).getTime() <= now);
    // Every board in one request (loadBoardInputs, 0110_challenge_boards.sql),
    // including a hunt's head-start totals, which toChallengeCard needs
    // to tell whether it's already concluded.
    const boardInputs = await loadBoardInputs(stillScheduled);
    const cards = await Promise.all(
      stillScheduled.map(async (c) => {
        const { participants, leaderboard, bots, headStartLeaderboard } = boardInputs.get(c.id)!;
        const card = toChallengeCard(
          c,
          participants,
          leaderboard,
          bots,
          user?.id ?? null,
          headStartLeaderboard,
          labelsForOrg(c.organizationId),
        );
        // A Daily Streak shows whether you're still in, from its own
        // daily progress, rather than a rank by total steps.
        if (c.kind === 'streak' && user?.id) {
          try {
            const [dailyRows, joinDates, days] = await Promise.all([
              listDailyProgress(c.id),
              listParticipantJoinDates(c.id),
              getChallengeDays(c),
            ]);
            const statuses = computeStreakStatus(c, joinDates, dailyRows, days);
            const mine = statuses.get(user.id);
            const stillIn = [...statuses.values()].filter((st) => st.eliminatedOnDay === null).length;
            if (mine) {
              return {
                ...card,
                stat: mine.eliminatedOnDay ? 'Out' : 'Still in',
                statLabel: mine.eliminatedOnDay
                  ? `${stillIn} of ${statuses.size} still in`
                  : `${mine.streakDays}-day streak · ${stillIn} of ${statuses.size} in`,
              };
            }
          } catch {
            // Keep the goal line from toChallengeCard.
          }
        }
        return card;
      }),
    );
    setLiveCards(cards);
    setGroupById(groups);
    setOrgName(org?.name ?? null);
    setFinishedRawChallenges(pastSchedule);
    setFinishedCardOverrides(null);
    // Seeds the next mount's initial state (see cachedChallengesState's
    // own comment) — written only after a real fetch actually succeeded,
    // never speculatively.
    cachedChallengesState = {
      liveCards: cards,
      finishedRawChallenges: pastSchedule,
      primaryChallengeId: primaryId,
      groupById: groups,
      orgName: org?.name ?? null,
    };

    // Best-effort, unawaited — settle_challenge_score (0058_hound_score.sql)
    // no-ops instantly unless this exact challenge just genuinely
    // concluded and hasn't been awarded yet, same "safe to call
    // speculatively" shape as settleTagTimeout/settleTicTacGo. Limited to
    // stillScheduled (this call already just paid for their full board
    // fetch above) rather than every past-schedule challenge in an
    // account's whole history — ChallengeDetailScreen's own load() covers
    // settling an older one, the moment someone actually reopens it,
    // without reintroducing the unbounded per-visit cost this screen's
    // own lazy Finished-details fetch was built to avoid.
    for (const c of stillScheduled) {
      settleChallengeScore(c.id).catch(() => {});
    }
  };

  const loadInvites = async (): Promise<void> => {
    const invites = await supabaseChallengesProvider.listMyChallengeInvites();
    setLiveInvites(invites);
    // Same seed-the-next-mount purpose as cachedChallengesState above.
    cachedInvites = invites;
  };

  // useFocusEffect, not a plain mount-time useEffect: creating a challenge
  // pushes Create *on top of* Main in the stack rather than replacing it,
  // so returning from it (onFinish navigates back to the same, already-
  // mounted Main/ChallengesScreen instance) never remounts this screen —
  // a plain useEffect keyed on user?.id would only ever fetch once and
  // never see the challenge you just created. useFocusEffect instead
  // refetches every time this screen regains navigation focus (returning
  // from Create, from a challenge's detail screen, from Hunt, etc.),
  // which a mount-only effect can't do since nothing else here unmounts
  // and remounts it in that flow.
  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured) return;
      // Independent try/catch per fetch — these used to be bundled into
      // one Promise.all, which meant a failure in *either* silently
      // blocked *both* from ever upgrading past the sample fallback (e.g.
      // before 0009_challenge_invites.sql has been run against a
      // project, listMyChallengeInvites() throws and the real challenge
      // list never showed up either, even though it was fetched
      // successfully).
      loadChallenges().catch(() => {
        // Stay on the empty state for challenges on any failure — this
        // screen never shows an error state, it just quietly doesn't
        // upgrade.
      });
      loadInvites().catch(() => {
        // Same, independently, for invites.
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]),
  );

  const respondToInvite = async (invite: ChallengeInvite, accept: boolean) => {
    setRespondingId(invite.id);
    try {
      if (accept) await supabaseChallengesProvider.acceptChallengeInvite(invite.id);
      else await supabaseChallengesProvider.declineChallengeInvite(invite.id);
      await Promise.all([loadInvites(), accept ? loadChallenges() : Promise.resolve()]);
    } catch {
      // No error UI for this yet — a stale invite silently stops
      // responding rather than crashing; re-opening the tab re-fetches.
    } finally {
      setRespondingId(null);
    }
  };

  // Pays the real per-challenge fetch for finishedRawChallenges only
  // once the section is actually opened — never on this screen's
  // default load. Guarded on finishedCardOverrides already being set so
  // re-renders while expanded (or toggling closed and back open) don't
  // re-fetch; loadChallenges() resets it to null on every focus, so a
  // challenge that's just crossed into "finished" still gets picked up
  // the next time this runs.
  useEffect(() => {
    if (!finishedExpanded || finishedCardOverrides !== null) return;
    if (finishedRawChallenges.length === 0) {
      setFinishedCardOverrides(new Map());
      return;
    }
    let cancelled = false;
    setLoadingFinishedDetails(true);
    loadBoardInputs(finishedRawChallenges)
      .then((boardInputs) =>
        finishedRawChallenges.map((c) => {
          const { participants, leaderboard, bots, headStartLeaderboard } = boardInputs.get(c.id)!;
          return [
            c.id,
            toChallengeCard(c, participants, leaderboard, bots, user?.id ?? null, headStartLeaderboard, labelsForOrg(c.organizationId)),
          ] as const;
        }),
      )
      .then((entries) => {
        if (!cancelled) setFinishedCardOverrides(new Map(entries));
      })
      .catch(() => {
        // Stay on the placeholder cards for this batch on any failure —
        // same "never break the screen" convention as loadChallenges.
        if (!cancelled) setFinishedCardOverrides(new Map());
      })
      .finally(() => {
        if (!cancelled) setLoadingFinishedDetails(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedExpanded, finishedRawChallenges, finishedCardOverrides]);

  // liveCards holds both still-running and finished real challenges
  // together (toChallengeCard decides `finished` per card — see
  // src/challenges/present.ts) — split them here so a caught hunt or a
  // challenge past its end date moves down to "Finished" instead of
  // lingering in the active list above it. Defaults to empty, not
  // fabricated content — see the challengesLoading comment below for why
  // that's correct even before Supabase's first fetch resolves.
  const challenges = liveCards?.filter((c) => !c.finished) ?? [];
  const activeGroups = GROUP_ORDER.map((group) => ({
    group,
    cards: challenges.filter((c) => (groupById.get(c.id) ?? 'personal') === group),
  })).filter((g) => g.cards.length > 0);
  // Headings only help when there's more than one group to tell apart.
  const showGroupHeadings = activeGroups.length > 1;
  // The early-concluded ones already came back from the eager fetch
  // above (they were still schedule-active, so toChallengeCard ran on
  // them); everything else past its own schedule gets either its real,
  // lazily-fetched card (once finishedCardOverrides has it) or a
  // placeholder in the meantime — see placeholderFinishedCard's own
  // comment for why that's a safe stand-in for FinishedRow specifically.
  const finishedChallenges = [
    ...(liveCards?.filter((c) => c.finished) ?? []),
    ...finishedRawChallenges.map((c) => finishedCardOverrides?.get(c.id) ?? placeholderFinishedCard(c)),
  ];
  // Every finished challenge whose real stat is actually known — the
  // early-concluded ones (already resolved by the eager fetch above) plus
  // whichever past-schedule ones finishedCardOverrides has resolved so
  // far. Deliberately excludes an unresolved placeholder (stat: '—',
  // meaning "not fetched yet," not "nobody logged anything") — tallying
  // those into medalCounts as "Other" was the actual bug here: every
  // finished challenge silently miscounted as Other until Finished was
  // expanded once and its real placement came back. Better to undercount
  // honestly (and let it self-correct once resolved) than confidently
  // show a wrong breakdown.
  const resolvedFinishedChallenges = [
    ...(liveCards?.filter((c) => c.finished) ?? []),
    ...finishedRawChallenges.map((c) => finishedCardOverrides?.get(c.id)).filter((c): c is ChallengeCard => !!c),
  ];
  const unresolvedFinishedCount = finishedChallenges.length - resolvedFinishedChallenges.length;
  // Tally by the same `c.stat` ordinal FinishedRow/medalColorFor already
  // read — '1st'/'2nd'/'3rd' get their own medal, everything else (4th+,
  // or '—' when nobody ever logged anything) lands in "Other".
  const medalCounts = resolvedFinishedChallenges.reduce(
    (acc, c) => {
      if (c.stat === '1st') acc.gold += 1;
      else if (c.stat === '2nd') acc.silver += 1;
      else if (c.stat === '3rd') acc.bronze += 1;
      else acc.other += 1;
      return acc;
    },
    { gold: 0, silver: 0, bronze: 0, other: 0 },
  );

  // True only for the one transient state worth a spinner: a real
  // backend exists but its very first fetch (this mount, or the first
  // focus after one) hasn't resolved yet. Once `loadChallenges()`
  // resolves — success or failure — `liveCards` is set and stays
  // non-null for the rest of the screen's life, so this only ever shows
  // once, not on every refocus-triggered refetch. Never true at all when
  // Supabase isn't configured — there, `liveCards` will stay `null`
  // forever, but `challenges`/`finishedChallenges` above already default
  // to empty, so it renders the same honest "nothing yet" state as a
  // configured backend with no data, with no spinner needed for a fetch
  // that will never happen (same reasoning HomeScreen's loadingPrimary
  // uses).
  const challengesLoading = liveCards === null && isSupabaseConfigured;
  // Same reasoning, independently, for the invite card — it has its own
  // fetch and can resolve before or after loadChallenges().
  const invitesLoading = liveInvites === null && isSupabaseConfigured;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={text.h2}>Challenges</Text>
        <Button label="New challenge" variant="primary" small icon={<PlusCircleIcon size={14} color={color.accent} />} onPress={onCreate} />
      </View>

      {invitesLoading
        ? null
        : (liveInvites ?? []).map((invite) => (
          <Card key={invite.id} style={styles.inviteCard} elevated={false}>
            <EnvelopeOpenIcon size={18} color={color.accent300} weight="fill" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.inviteTitle}>
                {invite.inviterName} invited you to &ldquo;{invite.challengeName}&rdquo;
              </Text>
              <Text style={styles.inviteSub}>
                {invite.challengeKind === 'hunt'
                  ? huntKindName()
                  : CHALLENGE_TYPES.find((t) => t.id === invite.challengeKind)?.name ?? invite.challengeKind}{' '}
                ·{' '}
                {invite.durationDays} days
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              <Button
                label="Join"
                variant="primary"
                small
                disabled={respondingId === invite.id}
                onPress={() => respondToInvite(invite, true)}
              />
              <Button
                label="Decline"
                small
                disabled={respondingId === invite.id}
                onPress={() => respondToInvite(invite, false)}
              />
            </View>
          </Card>
        ))}

      {challengesLoading ? (
        <View style={styles.loadingRow}>
          <LoadingView />
        </View>
      ) : (
        <>
          {activeGroups.map(({ group, cards }) => (
            <View key={group} style={{ gap: 8 }}>
              {showGroupHeadings && (
                <View style={styles.groupHeading}>
                  <Text style={styles.groupTitle}>
                    {group === 'global' ? 'Global' : group === 'org' ? orgName ?? 'Organization' : 'Personal'}
                  </Text>
                  <Text style={styles.groupCount}>{cards.length}</Text>
                </View>
              )}
              <Card style={styles.listCard} elevated={false}>
                {cards.map((c, i) => (
                  <ChallengeRow
                    key={c.id}
                    c={c}
                    first={i === 0}
                    isPrimary={c.id === primaryChallengeId}
                    styles={styles}
                    colors={colors}
                    onPress={
                      c.target === 'detail' ? () => onOpenChallenge(c.id) : undefined
                    }
                  />
                ))}
              </Card>
            </View>
          ))}

          {challenges.length === 0 && (
            <Text style={styles.emptyNote}>No challenges yet — start one above.</Text>
          )}

          {/* Only once there's something in it: a new member's tab shouldn't open on an empty trophy case. */}
          {finishedChallenges.length > 0 && (
          <Card style={{ padding: 0, overflow: 'hidden' }} elevated={false}>
            <Pressable
              style={[styles.medalsHeader, finishedExpanded && styles.medalsHeaderOpen]}
              onPress={() => setFinishedExpanded((open) => !open)}
            >
              <View style={styles.medalsTitleRow}>
                <Text style={styles.finishedLabel}>Finished</Text>
                <Text style={styles.finishedCount}>{finishedChallenges.length}</Text>
                <CaretRightIcon
                  size={16}
                  color={withAlpha(colors.text, 0.5)}
                  style={finishedExpanded ? styles.medalsCaretOpen : undefined}
                />
              </View>
              <View style={styles.medalsRow}>
                <MedalTile tint={color.gold} count={medalCounts.gold} label="Gold" styles={styles} />
                <MedalTile tint={color.silver} count={medalCounts.silver} label="Silver" styles={styles} />
                <MedalTile tint={color.bronze} count={medalCounts.bronze} label="Bronze" styles={styles} />
                <MedalTile tint={color.neutral500} count={medalCounts.other} label="Other" styles={styles} />
              </View>
              {/* unresolvedFinishedCount is only ever nonzero before
                  Finished has been expanded at least once this visit (see
                  its own comment) — the placement for that many finished
                  challenges hasn't been fetched yet, so the tally above is
                  a real but partial count, not the final one. */}
              {unresolvedFinishedCount > 0 && (
                <Text style={styles.medalsPendingNote}>
                  Tap to count {unresolvedFinishedCount} more.
                </Text>
              )}
            </Pressable>
            {finishedExpanded && (
              <View style={styles.finishedList}>
                {finishedChallenges.length === 0 ? (
                  <Text style={styles.emptyNote}>Nothing finished yet.</Text>
                ) : (
                  finishedChallenges.map((c) => (
                    <FinishedRow
                      key={c.id}
                      c={c}
                      styles={styles}
                      onPress={c.target === 'detail' ? () => onOpenChallenge(c.id) : undefined}
                    />
                  ))
                )}
              </View>
            )}
          </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}

// Two lines: the name, then the type and where it's at, with your
// standing on the right. The type badge, head-start tag and "On Today"
// badge used to stack up on their own lines.
function ChallengeRow({
  c,
  first,
  isPrimary,
  onPress,
  styles,
  colors,
}: {
  c: ChallengeCard;
  first?: boolean;
  isPrimary?: boolean;
  onPress?: () => void;
  styles: ChallengesStyles;
  colors: Palette;
}) {
  // c.kind is real server data, not this build's own CHALLENGE_TYPES
  // list — a kind newer than this build (see DEFAULT_CHALLENGE_ICON's
  // own comment) falls back rather than crashing this whole screen.
  const Icon = CHALLENGE_KIND_ICON[c.kind] ?? DEFAULT_CHALLENGE_ICON;
  // Just the first part of each ("Day 14 of 31", "of 23"): the people
  // count and your total are on the challenge itself, and the full line
  // didn't fit next to the name.
  const firstPart = (t: string) => t.split(' · ')[0];
  const details = [c.kindLabel, firstPart(c.sub), c.headStartDaysLeft ? `head start ${c.headStartDaysLeft}d` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      style={({ pressed }) => [styles.row, !first && styles.rowDivider, pressed && { opacity: 0.7 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${c.name}${isPrimary ? ', on Today' : ''}`}
    >
      <View style={[styles.rowIcon, { backgroundColor: c.tint }]}>
        <Icon size={18} color={c.iconColor} weight={c.kind === 'hunt' ? 'fill' : 'regular'} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {/* The one Today is showing (see pickPrimaryChallenge). */}
          {isPrimary && <HouseIcon size={13} color={colors.accentActive} weight="fill" />}
          <Text style={[styles.rowName, { flexShrink: 1 }]} numberOfLines={1}>
            {c.name}
          </Text>
        </View>
        <Text style={styles.rowSub} numberOfLines={1}>
          {details}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 1, maxWidth: '36%' }}>
        <Text style={styles.rowStat} numberOfLines={1}>
          {c.stat}
        </Text>
        <Text style={styles.rowStatLabel} numberOfLines={1}>
          {firstPart(c.statLabel)}
        </Text>
      </View>
      <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
    </Pressable>
  );
}

// `c.stat` is an exact ordinal string ('1st', '2nd', '3rd', '4th', …)
// whenever the current user placed at all (see toChallengeCard's
// ordinal()) — only those top three get a medal color, everything
// 4th-or-worse (or the no-data '—' case) keeps the plain default.
function medalColorFor(stat: string): string {
  if (stat === '1st') return color.gold;
  if (stat === '2nd') return color.silver;
  if (stat === '3rd') return color.bronze;
  return color.neutral500;
}

// Same visual language as the hardcoded placeholder this replaces (a
// medal, a title, a "you placed Nth" line) — just populated from a real
// finished card instead. `c.stat` is '—' (see toChallengeCard) when
// nobody ever logged anything, which "You placed —" would read oddly
// for, so that case shows the plain statLabel ("no data yet") instead.
function FinishedRow({
  c,
  onPress,
  styles,
}: {
  c: ChallengeCard;
  onPress?: () => void;
  styles: ChallengesStyles;
}) {
  return (
    <Pressable style={styles.finishedRow} onPress={onPress}>
      <MedalIcon size={20} color={medalColorFor(c.stat)} weight="fill" />
      <View style={styles.finishedTextCol}>
        <Text style={styles.finishedTitle} numberOfLines={1}>
          {c.name}
        </Text>
        <Text style={styles.finishedMeta} numberOfLines={1}>
          {c.stat === '—'
            ? c.statLabel
            : /^\d+(st|nd|rd|th)$/.test(c.stat)
              ? `You placed ${c.stat} ${c.statLabel}`
              : `${c.stat} · ${c.statLabel}`}
        </Text>
      </View>
    </Pressable>
  );
}

// One of the four tally tiles in the Finished card's header — always
// visible (even at 0), so the header reads as "here's your record" at a
// glance before ever expanding the list below it.
function MedalTile({
  tint,
  count,
  label,
  styles,
}: {
  tint: string;
  count: number;
  label: string;
  styles: ChallengesStyles;
}) {
  return (
    <View style={styles.medalTile}>
      <MedalIcon size={16} color={tint} weight="fill" />
      <Text style={styles.medalTileValue}>{count}</Text>
      <Text style={styles.medalTileLabel}>{label}</Text>
    </View>
  );
}

// The invite card's own background is an accent wash over this theme's
// own colors, not a fixed hand-tuned tint — same "spotlight card that
// actually follows the theme" reasoning as HomeScreen's hunt card, see
// that file's own comment on its `huntCard` style.
function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 14, paddingBottom: 48 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 },
    inviteCard: {
      flexDirection: 'row',
      gap: 12,
      backgroundColor: withAlpha(colors.accent, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.4),
      alignItems: 'center',
    },
    inviteTitle: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    inviteSub: { fontSize: 12.5, color: withAlpha(colors.text, 0.7) },
    groupHeading: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 4, marginTop: 4 },
    groupTitle: { fontFamily: font.headingSemibold, fontSize: 13, letterSpacing: 0.6, color: withAlpha(colors.text, 0.7), textTransform: 'uppercase' },
    groupCount: { fontSize: 12.5, color: withAlpha(colors.text, 0.45) },
    listCard: { paddingVertical: 2, paddingHorizontal: 14 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
    rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    rowName: { fontFamily: font.heading, fontSize: 15.5, color: colors.text },
    rowSub: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    rowStat: { fontFamily: font.heading, fontSize: 16, color: colors.text },
    rowStatLabel: { fontSize: 11, color: withAlpha(colors.text, 0.55) },
    emptyNote: { fontSize: 13, color: withAlpha(colors.text, 0.55), textAlign: 'center', paddingVertical: 8 },
    loadingRow: { paddingVertical: 24, alignItems: 'center' },
    medalsHeader: { padding: 16, gap: 14 },
    // Only a real border while open, separating the tally from the list
    // below — collapsed, the header is the whole card, so a border here
    // would just be a stray line under empty space. Same reasoning as
    // MetricsScreen's workoutsHeaderOpen.
    medalsHeaderOpen: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.08),
    },
    medalsTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    finishedLabel: { flex: 1, fontFamily: font.heading, fontSize: 16, color: colors.text },
    finishedCount: { fontSize: 13, color: withAlpha(colors.text, 0.5) },
    medalsCaretOpen: { transform: [{ rotate: '90deg' }] },
    medalsRow: { flexDirection: 'row', gap: 8 },
    medalsPendingNote: { fontSize: 11.5, color: withAlpha(colors.text, 0.45) },
    medalTile: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    medalTileValue: { fontFamily: font.heading, fontSize: 18, color: colors.text },
    medalTileLabel: { fontSize: 10.5, letterSpacing: 0.5, color: withAlpha(colors.text, 0.55) },
    finishedList: { padding: 16, paddingTop: 12, gap: 10 },
    finishedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 14,
      borderRadius: 8,
      backgroundColor: withAlpha(colors.surface, 0.6),
    },
    // A row and its meta ("You placed 2nd of 3 · 70,164 steps") stacked
    // vertically, not side by side — RN's default flexShrink is 0 (unlike
    // the web's 1), so a long meta string sitting next to a flex:1 title
    // in the same row claimed its full width and squeezed the title down
    // to almost nothing, wrapping a name like "Let's get to 50K steps"
    // one or two characters per line.
    finishedTextCol: { flex: 1, gap: 2 },
    finishedTitle: { fontSize: 14, color: colors.text },
    finishedMeta: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
  });
}

type ChallengesStyles = ReturnType<typeof makeStyles>;
