import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { Tag } from '../components/Tag';
import { useTheme } from '../theme/ThemeContext';
import { color, font, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_TYPES, type ChallengeCard } from '../data/sampleData';
import { CHALLENGE_KIND_ICON, DEFAULT_CHALLENGE_ICON } from '../data/challengeIcons';
import { isSupabaseConfigured } from '../lib/supabase';
import { supabaseChallengesProvider } from '../challenges/supabaseChallenges';
import { headStartBaselineDayKey, pickPrimaryChallenge } from '../challenges/board';
import { huntKindName, toChallengeCard } from '../challenges/present';
import { useLabels } from '../labels/LabelsContext';
import type { Challenge, ChallengeInvite, LeaderboardEntry } from '../challenges/types';
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
  onOpenHunt,
  onOpenChallenge,
  onCreate,
}: {
  onOpenHunt: () => void;
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
  const [liveCards, setLiveCards] = useState<ChallengeCard[] | null>(null);
  // Every challenge whose schedule has already ended (see loadChallenges
  // below) — kept as raw Challenge rows, not fetched into full cards,
  // until "Finished" is actually expanded. Classified from
  // listMyChallenges()'s own endsAt with no extra network call: a
  // challenge past its own endsAt is finished regardless of kind (see
  // isChallengeFinished, board.ts), so nothing here needs the
  // participants/leaderboard/bots fetch just to know that much.
  const [finishedRawChallenges, setFinishedRawChallenges] = useState<Challenge[]>([]);
  // null = not fetched yet for this batch of finishedRawChallenges (see
  // the lazy-fetch effect below) — every entry gets a placeholderFinishedCard
  // instead in the meantime. Reset on every loadChallenges() call, same
  // "refreshes on every focus" convention the rest of this screen
  // already has, so a challenge that just crossed into "finished" isn't
  // stuck showing stale data forever.
  const [finishedCardOverrides, setFinishedCardOverrides] = useState<Map<string, ChallengeCard> | null>(null);
  const [loadingFinishedDetails, setLoadingFinishedDetails] = useState(false);
  // Same convention, independently, for challenge invites.
  const [liveInvites, setLiveInvites] = useState<ChallengeInvite[] | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  // Whichever challenge Home is currently showing as its own hero card —
  // pickPrimaryChallenge (src/challenges/board.ts) is the one place that
  // decision gets made, so this list can mark the exact same row instead
  // of a parallel guess. Null both before the first fetch resolves and
  // when nothing qualifies (no active challenges at all).
  const [primaryChallengeId, setPrimaryChallengeId] = useState<string | null>(null);
  // Collapsed by default — the medal tally is the headline, the finished
  // challenges themselves are detail you dig into, same "summary first,
  // list on demand" shape as MetricsScreen's Today's Workouts card.
  const [finishedExpanded, setFinishedExpanded] = useState(false);

  const loadChallenges = async (): Promise<void> => {
    const [challenges, highlighted] = await Promise.all([
      supabaseChallengesProvider.listMyChallenges(),
      supabaseChallengesProvider.getHighlightedChallenge(),
    ]);
    setPrimaryChallengeId(pickPrimaryChallenge(challenges, highlighted)?.id ?? null);
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
    const cards = await Promise.all(
      stillScheduled.map(async (c) => {
        // A hunt with a head start needs one extra fetch — everyone's
        // total as of the day the head start ended, not just now — to
        // correctly tell whether it's already concluded (see
        // toChallengeCard/withHuntCatches). Skipped for anything else,
        // since there's nothing to credit.
        const needsHeadStart = c.kind === 'hunt' && !!c.headStartDays;
        const [participants, leaderboard, bots, headStartLeaderboard] = await Promise.all([
          supabaseChallengesProvider.listParticipants(c.id),
          supabaseChallengesProvider.getLeaderboard(c.id),
          supabaseChallengesProvider.listBots(c.id),
          needsHeadStart
            ? supabaseChallengesProvider.getLeaderboard(c.id, headStartBaselineDayKey(c))
            : Promise.resolve<LeaderboardEntry[]>([]),
        ]);
        return toChallengeCard(
          c,
          participants,
          leaderboard,
          bots,
          user?.id ?? null,
          headStartLeaderboard,
          labelsForOrg(c.organizationId),
        );
      }),
    );
    setLiveCards(cards);
    setFinishedRawChallenges(pastSchedule);
    setFinishedCardOverrides(null);
  };

  const loadInvites = async (): Promise<void> => {
    setLiveInvites(await supabaseChallengesProvider.listMyChallengeInvites());
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
    Promise.all(
      finishedRawChallenges.map(async (c) => {
        const needsHeadStart = c.kind === 'hunt' && !!c.headStartDays;
        const [participants, leaderboard, bots, headStartLeaderboard] = await Promise.all([
          supabaseChallengesProvider.listParticipants(c.id),
          supabaseChallengesProvider.getLeaderboard(c.id),
          supabaseChallengesProvider.listBots(c.id),
          needsHeadStart
            ? supabaseChallengesProvider.getLeaderboard(c.id, headStartBaselineDayKey(c))
            : Promise.resolve<LeaderboardEntry[]>([]),
        ]);
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
  // Tally by the same `c.stat` ordinal FinishedRow/medalColorFor already
  // read — '1st'/'2nd'/'3rd' get their own medal, everything else (4th+,
  // or '—' when nobody ever logged anything) lands in "Other".
  const medalCounts = finishedChallenges.reduce(
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
          {challenges.map((c) => (
            <ChallengeRow
              key={c.id}
              c={c}
              isPrimary={c.id === primaryChallengeId}
              styles={styles}
              colors={colors}
              onPress={
                c.target === 'hunt' ? onOpenHunt : c.target === 'detail' ? () => onOpenChallenge(c.id) : undefined
              }
            />
          ))}

          {challenges.length === 0 && (
            <Text style={styles.emptyNote}>No challenges yet — start one above.</Text>
          )}

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
        </>
      )}
    </ScrollView>
  );
}

function ChallengeRow({
  c,
  isPrimary,
  onPress,
  styles,
  colors,
}: {
  c: ChallengeCard;
  isPrimary?: boolean;
  onPress?: () => void;
  styles: ChallengesStyles;
  colors: Palette;
}) {
  // c.kind is real server data, not this build's own CHALLENGE_TYPES
  // list — a kind newer than this build (see DEFAULT_CHALLENGE_ICON's
  // own comment) falls back rather than crashing this whole screen.
  const Icon = CHALLENGE_KIND_ICON[c.kind] ?? DEFAULT_CHALLENGE_ICON;
  return (
    <Pressable style={[styles.row, isPrimary && styles.rowPrimary]} onPress={onPress}>
      <View style={[styles.rowIcon, { backgroundColor: c.tint }]}>
        <Icon size={21} color={c.iconColor} weight={c.kind === 'hunt' ? 'fill' : 'regular'} />
      </View>
      <View style={{ flex: 1, gap: 3, minWidth: 140 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text style={styles.rowName}>{c.name}</Text>
          <Tag label={c.kindLabel} variant={c.kind === 'hunt' ? 'accent' : 'neutral'} />
          {!!c.headStartDaysLeft && (
            <Tag
              label={`Head start · ${c.headStartDaysLeft}d left`}
              variant="amber"
            />
          )}
          {/* The one card whose own numbers are what Today's hero/
              leaderboard card is currently showing — see
              pickPrimaryChallenge (src/challenges/board.ts), the single
              place that decision is made for both screens. A house icon
              to echo the Today tab's own icon (see TopNav), not another
              color of the kind/head-start tags above, so it reads as "is
              shown there" rather than as one more property of the
              challenge itself. */}
          {isPrimary && (
            <View style={styles.primaryBadge}>
              <HouseIcon size={11} color={colors.accent200} weight="fill" />
              <Text style={styles.primaryBadgeText}>On Today</Text>
            </View>
          )}
        </View>
        <Text style={styles.rowSub}>{c.sub}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={styles.rowStat}>{c.stat}</Text>
        <Text style={styles.rowStatLabel}>{c.statLabel}</Text>
      </View>
      <CaretRightIcon size={16} color={withAlpha(colors.text, 0.5)} />
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
          {c.stat === '—' ? c.statLabel : `You placed ${c.stat} ${c.statLabel}`}
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
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 16,
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    // A visible border, not just a tag, so which card Today is showing
    // reads at a glance scrolling past the whole list — the badge alone
    // (see primaryBadge below) is easy to miss next to the kind/head-start
    // tags already competing for attention on the same line.
    rowPrimary: { borderWidth: 1, borderColor: colors.accent700 },
    rowIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    rowName: { fontFamily: font.heading, fontSize: 16, color: colors.text },
    primaryBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 3,
      paddingHorizontal: 10,
      borderRadius: 6,
      backgroundColor: colors.accent800,
    },
    primaryBadgeText: { fontSize: 11, letterSpacing: 0.3, color: colors.accent200 },
    rowSub: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    rowStat: { fontFamily: font.heading, fontSize: 18, color: colors.text },
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
