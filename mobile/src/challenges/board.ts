import { botInitials, simulateBotSteps } from './botSimulation';
import type { ChallengeBot, HuntRole, LeaderboardEntry, Participant } from './types';

export interface BoardEntry {
  userId: string;
  name: string;
  initials: string;
  totalSteps: number;
  totalDistanceMi: number;
  isBot: boolean;
  role: HuntRole | null;
}

// Merges real participants (joined with whatever they've actually logged)
// and bots (whose steps are simulated, never logged) into one ranked list.
// Shared by ChallengeDetailScreen and HomeScreen so "how do we combine
// these two very different kinds of rows" only has one implementation.
// `sortBy` matters for a hunt scored on workout distance rather than
// steps (see ChallengeDetailScreen's syncFromDevice) — everyone's
// totalSteps is 0 in that case, so ranking by steps would leave the board
// in an arbitrary order instead of by who's covered the most ground.
export function buildBoard(
  participants: Participant[],
  leaderboard: LeaderboardEntry[],
  bots: ChallengeBot[],
  daysElapsed: number,
  sortBy: 'steps' | 'distance' = 'steps',
): BoardEntry[] {
  const rows: BoardEntry[] = [
    ...participants.map((p) => {
      const entry = leaderboard.find((l) => l.userId === p.userId);
      return {
        userId: p.userId,
        name: p.name,
        initials: p.initials,
        totalSteps: entry?.totalSteps ?? 0,
        totalDistanceMi: entry?.totalDistanceMi ?? 0,
        isBot: false,
        role: p.role,
      };
    }),
    ...bots.map((b) => ({
      userId: b.id,
      name: b.name,
      initials: botInitials(b.name),
      totalSteps: simulateBotSteps(b.id, b.fitnessLevel, daysElapsed),
      // Bots only ever simulate steps — inventing a steps-to-miles
      // conversion for a distance-scored hunt would be fabricated
      // precision, so a bot always shows 0 distance.
      totalDistanceMi: 0,
      isBot: true,
      role: b.role,
    })),
  ];
  return rows.sort((a, b) => (sortBy === 'distance' ? b.totalDistanceMi - a.totalDistanceMi : b.totalSteps - a.totalSteps));
}
