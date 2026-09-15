import { botInitials, simulateBotSteps } from './botSimulation';
import type { ChallengeBot, LeaderboardEntry, Participant } from './types';

export interface BoardEntry {
  userId: string;
  name: string;
  initials: string;
  totalSteps: number;
  totalDistanceMi: number;
  isBot: boolean;
}

// Merges real participants (joined with whatever they've actually logged)
// and bots (whose steps are simulated, never logged) into one ranked list.
// Shared by ChallengeDetailScreen and HomeScreen so "how do we combine
// these two very different kinds of rows" only has one implementation.
export function buildBoard(
  participants: Participant[],
  leaderboard: LeaderboardEntry[],
  bots: ChallengeBot[],
  daysElapsed: number,
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
      };
    }),
    ...bots.map((b) => ({
      userId: b.id,
      name: b.name,
      initials: botInitials(b.name),
      totalSteps: simulateBotSteps(b.id, b.fitnessLevel, daysElapsed),
      totalDistanceMi: 0,
      isBot: true,
    })),
  ];
  return rows.sort((a, b) => b.totalSteps - a.totalSteps);
}
