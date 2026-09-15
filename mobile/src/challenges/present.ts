import { botToLeaderboardEntry, botToParticipant } from './botSimulation';
import { CHALLENGE_TYPES, type ChallengeCard } from '../data/sampleData';
import { TINT_A, TINT_N } from '../theme/tokens';
import type { Challenge, ChallengeBot, LeaderboardEntry, Participant } from './types';

// Turns a raw challenge + who's in it + what they've logged into the same
// display shape src/data/sampleData.ts hand-authors for the sample
// content — ChallengesScreen.tsx's <ChallengeRow> renders either without
// caring which one it got. Keeping this formatting out of
// supabaseChallenges.ts means the provider only ever returns plain rows.
export function toChallengeCard(
  challenge: Challenge,
  participants: Participant[],
  leaderboard: LeaderboardEntry[],
  bots: ChallengeBot[],
  currentUserId: string | null,
): ChallengeCard {
  const typeDef = CHALLENGE_TYPES.find((t) => t.id === challenge.kind);
  const kindLabel = typeDef?.name ?? challenge.kind;
  const tint = typeDef?.tint ?? TINT_N;
  const iconColor = typeDef?.iconColor ?? '#e9e9ed';

  const daysElapsed = Math.min(
    challenge.durationDays,
    Math.max(1, Math.floor((Date.now() - new Date(challenge.startsAt).getTime()) / 86_400_000) + 1),
  );

  // Bots count as people for the summary card too — a bot always has
  // "logged" something (its steps are simulated, not recorded), so it
  // belongs in both the head-count and the leaderboard used for rank.
  const allParticipants = [...participants, ...bots.map(botToParticipant)];
  const allLeaderboard = [...leaderboard, ...bots.map((b) => botToLeaderboardEntry(b, daysElapsed))];

  const peopleCount = allParticipants.length;
  const sub = `Day ${daysElapsed} of ${challenge.durationDays} · ${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}`;

  // Nothing calls recordProgress() yet (see README "What's not
  // implemented"), so a freshly created challenge always has an empty
  // leaderboard even though it has participants — this is the honest
  // "no one's logged anything yet" state, not a bug to paper over.
  let stat = '—';
  let statLabel = 'no data yet';
  if (allLeaderboard.length > 0) {
    const ranked = [...allLeaderboard].sort((a, b) => b.totalSteps - a.totalSteps);
    const myRank = currentUserId ? ranked.findIndex((p) => p.userId === currentUserId) : -1;
    if (myRank >= 0) {
      stat = ordinal(myRank + 1);
      statLabel = `of ${ranked.length} · ${ranked[myRank].totalSteps.toLocaleString()} steps`;
    } else {
      stat = String(ranked.length);
      statLabel = ranked.length === 1 ? 'person logging' : 'people logging';
    }
  }

  return {
    id: challenge.id,
    name: challenge.name,
    kind: challenge.kind,
    kindLabel,
    sub,
    stat,
    statLabel,
    tint,
    iconColor,
    people: allParticipants.slice(0, 4).map((p) => ({
      initials: p.initials,
      tint: p.userId === currentUserId ? TINT_A : TINT_N,
    })),
    // Opens the generic ChallengeDetailScreen — HuntScreen is one
    // specific hardcoded storyline, not a template real challenges of
    // any kind can share, so this never points there.
    target: 'detail',
  };
}

export function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}
