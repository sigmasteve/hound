import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  CaretRightIcon,
  EnvelopeOpenIcon,
  MedalIcon,
  PlusCircleIcon,
} from 'phosphor-react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Tag } from '../components/Tag';
import { text } from '../theme/text';
import { color, font } from '../theme/tokens';
import { CHALLENGES, CHALLENGE_TYPES, type ChallengeCard } from '../data/sampleData';
import { CHALLENGE_KIND_ICON } from '../data/challengeIcons';
import { isSupabaseConfigured } from '../lib/supabase';
import { supabaseChallengesProvider } from '../challenges/supabaseChallenges';
import { headStartEndDayKey } from '../challenges/board';
import { toChallengeCard } from '../challenges/present';
import type { ChallengeInvite, LeaderboardEntry } from '../challenges/types';
import { useAuth } from '../auth/AuthContext';

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
  // null = still showing the sample fallback (either Supabase isn't
  // configured, or the real fetch hasn't resolved yet); once set, it
  // fully replaces the sample list — a real backend shouldn't keep
  // demo content around next to real data. Same "never break the
  // screen, just fall back" philosophy as src/health's mock fallback.
  const [liveCards, setLiveCards] = useState<ChallengeCard[] | null>(null);
  // Same null-means-fallback convention, for the hardcoded "Priya
  // invited you…" card — see the render below.
  const [liveInvites, setLiveInvites] = useState<ChallengeInvite[] | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const loadChallenges = async (): Promise<void> => {
    const challenges = await supabaseChallengesProvider.listMyChallenges();
    const cards = await Promise.all(
      challenges.map(async (c) => {
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
            ? supabaseChallengesProvider.getLeaderboard(c.id, headStartEndDayKey(c))
            : Promise.resolve<LeaderboardEntry[]>([]),
        ]);
        return toChallengeCard(c, participants, leaderboard, bots, user?.id ?? null, headStartLeaderboard);
      }),
    );
    setLiveCards(cards);
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
        // Stay on the sample fallback for challenges on any failure —
        // this screen never shows an error state, it just quietly
        // doesn't upgrade.
      });
      loadInvites().catch(() => {
        // Same, independently, for the invite card.
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

  // liveCards holds both still-running and finished real challenges
  // together (toChallengeCard decides `finished` per card — see
  // src/challenges/present.ts) — split them here so a caught hunt or a
  // challenge past its end date moves down to "Finished" instead of
  // lingering in the active list above it.
  const liveActive = liveCards?.filter((c) => !c.finished) ?? null;
  const liveFinished = liveCards?.filter((c) => c.finished) ?? null;
  const challenges = liveActive ?? CHALLENGES;

  // True only for the one transient state worth a spinner: a real
  // backend exists but its very first fetch (this mount, or the first
  // focus after one) hasn't resolved yet. Once `loadChallenges()`
  // resolves — success or failure — `liveCards` is set and stays
  // non-null for the rest of the screen's life, so this only ever shows
  // once, not on every refocus-triggered refetch. Never true at all
  // when Supabase isn't configured — there, the sample list below is the
  // real, permanent content, not a placeholder for a fetch that's about
  // to happen (same reasoning HomeScreen's loadingPrimary uses).
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

      {invitesLoading ? null : liveInvites === null ? (
        <Card style={styles.inviteCard} elevated={false}>
          <EnvelopeOpenIcon size={18} color={color.accent300} weight="fill" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.inviteTitle}>Priya invited you to &ldquo;Sunrise Streak&rdquo;</Text>
            <Text style={styles.inviteSub}>30 minutes of movement before 9am · 14 days · starts Monday</Text>
          </View>
          <View style={{ gap: 6 }}>
            <Button label="Join" variant="primary" small />
            <Button label="Decline" small />
          </View>
        </Card>
      ) : (
        liveInvites.map((invite) => (
          <Card key={invite.id} style={styles.inviteCard} elevated={false}>
            <EnvelopeOpenIcon size={18} color={color.accent300} weight="fill" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.inviteTitle}>
                {invite.inviterName} invited you to &ldquo;{invite.challengeName}&rdquo;
              </Text>
              <Text style={styles.inviteSub}>
                {CHALLENGE_TYPES.find((t) => t.id === invite.challengeKind)?.name ?? invite.challengeKind} ·{' '}
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
        ))
      )}

      {challengesLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={color.accent} />
        </View>
      ) : (
        <>
          {challenges.map((c) => (
            <ChallengeRow
              key={c.id}
              c={c}
              onPress={
                c.target === 'hunt' ? onOpenHunt : c.target === 'detail' ? () => onOpenChallenge(c.id) : undefined
              }
            />
          ))}

          {liveActive && liveActive.length === 0 && (
            <Text style={styles.emptyNote}>No challenges yet — start one above.</Text>
          )}

          <Text style={styles.finishedLabel}>Finished</Text>
          {liveFinished === null ? (
            <View style={styles.finishedRow}>
              <MedalIcon size={20} color={medalColorFor('2nd')} weight="fill" />
              <Text style={styles.finishedTitle}>February Step Race</Text>
              <Text style={styles.finishedMeta}>You placed 2nd of 6 · 287,410 steps</Text>
            </View>
          ) : liveFinished.length === 0 ? (
            <Text style={styles.emptyNote}>Nothing finished yet.</Text>
          ) : (
            liveFinished.map((c) => (
              <FinishedRow key={c.id} c={c} onPress={c.target === 'detail' ? () => onOpenChallenge(c.id) : undefined} />
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

function ChallengeRow({ c, onPress }: { c: ChallengeCard; onPress?: () => void }) {
  const Icon = CHALLENGE_KIND_ICON[c.kind];
  return (
    <Pressable style={styles.row} onPress={onPress}>
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
        </View>
        <Text style={styles.rowSub}>{c.sub}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={styles.rowStat}>{c.stat}</Text>
        <Text style={styles.rowStatLabel}>{c.statLabel}</Text>
      </View>
      <CaretRightIcon size={16} color="rgba(233,233,237,0.5)" />
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
function FinishedRow({ c, onPress }: { c: ChallengeCard; onPress?: () => void }) {
  return (
    <Pressable style={styles.finishedRow} onPress={onPress}>
      <MedalIcon size={20} color={medalColorFor(c.stat)} weight="fill" />
      <Text style={styles.finishedTitle}>{c.name}</Text>
      <Text style={styles.finishedMeta}>
        {c.stat === '—' ? c.statLabel : `You placed ${c.stat} ${c.statLabel}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 14, paddingBottom: 48 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 },
  inviteCard: { flexDirection: 'row', gap: 12, backgroundColor: '#2a2540', alignItems: 'center' },
  inviteTitle: { fontFamily: font.heading, fontSize: 14, color: color.text },
  inviteSub: { fontSize: 12.5, color: 'rgba(233,233,237,0.7)' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 8,
    backgroundColor: color.surface,
  },
  rowIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowName: { fontFamily: font.heading, fontSize: 16, color: color.text },
  rowSub: { fontSize: 12.5, color: 'rgba(233,233,237,0.55)' },
  rowStat: { fontFamily: font.heading, fontSize: 18, color: color.text },
  rowStatLabel: { fontSize: 11, color: 'rgba(233,233,237,0.55)' },
  emptyNote: { fontSize: 13, color: 'rgba(233,233,237,0.55)', textAlign: 'center', paddingVertical: 8 },
  loadingRow: { paddingVertical: 24, alignItems: 'center' },
  finishedLabel: { fontSize: 15, color: 'rgba(233,233,237,0.7)', marginTop: 8 },
  finishedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(35,37,50,0.6)',
  },
  finishedTitle: { flex: 1, fontSize: 14, color: color.text },
  finishedMeta: { fontSize: 12.5, color: 'rgba(233,233,237,0.55)' },
});
