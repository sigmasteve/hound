import { botToLeaderboardEntry, botToParticipant, daysElapsedFraction } from './botSimulation';
import { buildBoard, headStartDaysLeft, isChallengeFinished, withHuntCatches } from './board';
import { boardSortFor } from './scoring';
import { CHALLENGE_TYPES, type ChallengeCard } from '../data/sampleData';
import { TINT_A, TINT_N } from '../theme/tokens';
import type { Challenge, ChallengeBot, HuntRole, LeaderboardEntry, Participant } from './types';

// Shared by ChallengeDetailScreen's leaderboard — one place mapping a
// HuntRole to what its <Tag> looks like, so a caught 'zombie' row doesn't
// need its own bespoke ternary next to the existing hunter/hunted one.
export const HUNT_ROLE_LABEL: Record<HuntRole, string> = {
  hunter: 'Hunter',
  hunted: 'Hunted',
  zombie: 'Zombie',
};

export const HUNT_ROLE_TAG_VARIANT: Record<HuntRole, 'accent' | 'neutral' | 'outline'> = {
  hunter: 'accent',
  hunted: 'neutral',
  zombie: 'outline',
};

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
  // Only needed for a hunt with a head start — see buildBoard's own
  // param of the same name. Defaults to none, which is correct for
  // every other case (nothing to credit).
  headStartLeaderboard: LeaderboardEntry[] = [],
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
  const allLeaderboard = [...leaderboard, ...bots.map((b) => botToLeaderboardEntry(b, daysElapsedFraction(challenge)))];

  const peopleCount = allParticipants.length;
  const sub = `Day ${daysElapsed} of ${challenge.durationDays} · ${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}`;

  // Nothing calls recordProgress() yet (see README "What's not
  // implemented"), so a freshly created challenge always has an empty
  // leaderboard even though it has participants — this is the honest
  // "no one's logged anything yet" state, not a bug to paper over.
  let stat = '—';
  let statLabel = 'no data yet';
  const distanceGoal =
    challenge.kind === 'distance'
      ? challenge.distanceGoalUnit === 'steps'
        ? challenge.distanceGoalSteps
        : challenge.distanceGoalMi
      : null;
  if (distanceGoal) {
    // A distance pool isn't a ranked leaderboard at all — everyone's
    // steps or miles (whichever unit its creator picked — see
    // CreateScreen.tsx) add up toward the one shared goal, so the
    // card's stat is the group's combined progress, not this user's own
    // rank.
    if (challenge.distanceGoalUnit === 'steps') {
      const groupTotalSteps = allLeaderboard.reduce((sum, p) => sum + p.totalSteps, 0);
      stat = groupTotalSteps.toLocaleString();
      statLabel = `of ${distanceGoal.toLocaleString()} steps goal`;
    } else {
      const groupTotalMi = allLeaderboard.reduce((sum, p) => sum + p.totalDistanceMi, 0);
      stat = groupTotalMi.toFixed(1);
      statLabel = `of ${distanceGoal} mi goal`;
    }
  } else if (allLeaderboard.length > 0) {
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

  // See isChallengeFinished (src/challenges/board.ts) — a hunt finishes
  // the moment there's nobody left to chase, however many scheduled days
  // remain; anything else just runs out its clock.
  const sortBy = boardSortFor(challenge);
  const board = withHuntCatches(
    buildBoard(participants, leaderboard, bots, daysElapsedFraction(challenge), sortBy, challenge, headStartLeaderboard),
    sortBy,
    challenge,
  );
  const finished = isChallengeFinished(challenge, board);

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
    finished,
    headStartDaysLeft: headStartDaysLeft(challenge),
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
