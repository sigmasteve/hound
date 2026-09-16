import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { toChallengeCard } from '../challenges/present';
import type { ChallengeInvite } from '../challenges/types';
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
        const [participants, leaderboard, bots] = await Promise.all([
          supabaseChallengesProvider.listParticipants(c.id),
          supabaseChallengesProvider.getLeaderboard(c.id),
          supabaseChallengesProvider.listBots(c.id),
        ]);
        return toChallengeCard(c, participants, leaderboard, bots, user?.id ?? null);
      }),
    );
    setLiveCards(cards);
  };

  const loadInvites = async (): Promise<void> => {
    setLiveInvites(await supabaseChallengesProvider.listMyChallengeInvites());
  };

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      const [challenges, invites] = await Promise.all([
        supabaseChallengesProvider.listMyChallenges(),
        supabaseChallengesProvider.listMyChallengeInvites(),
      ]);
      const cards = await Promise.all(
        challenges.map(async (c) => {
          const [participants, leaderboard, bots] = await Promise.all([
            supabaseChallengesProvider.listParticipants(c.id),
            supabaseChallengesProvider.getLeaderboard(c.id),
            supabaseChallengesProvider.listBots(c.id),
          ]);
          return toChallengeCard(c, participants, leaderboard, bots, user?.id ?? null);
        }),
      );
      if (!cancelled) {
        setLiveCards(cards);
        setLiveInvites(invites);
      }
    })().catch(() => {
      // Stay on the sample fallback on any failure — this screen never
      // shows an error state, it just quietly doesn't upgrade.
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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

  const challenges = liveCards ?? CHALLENGES;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={text.h2}>Challenges</Text>
        <Button label="New challenge" variant="primary" small icon={<PlusCircleIcon size={14} color={color.accent} />} onPress={onCreate} />
      </View>

      {liveInvites === null ? (
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

      {challenges.map((c) => (
        <ChallengeRow
          key={c.id}
          c={c}
          onPress={
            c.target === 'hunt' ? onOpenHunt : c.target === 'detail' ? () => onOpenChallenge(c.id) : undefined
          }
        />
      ))}

      {liveCards && liveCards.length === 0 && (
        <Text style={styles.emptyNote}>No challenges yet — start one above.</Text>
      )}

      <Text style={styles.finishedLabel}>Finished</Text>
      <View style={styles.finishedRow}>
        <MedalIcon size={20} color={color.neutral500} weight="fill" />
        <Text style={styles.finishedTitle}>February Step Race</Text>
        <Text style={styles.finishedMeta}>You placed 2nd of 6 · 287,410 steps</Text>
      </View>
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
