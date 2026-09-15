export type ChallengeKind = 'hunt' | 'steps' | 'streak' | 'distance';

export interface Challenge {
  id: string;
  name: string;
  kind: ChallengeKind;
  createdBy: string;
  durationDays: number;
  startsAt: string;
  endsAt: string;
  dailyGoalSteps: number | null;
}

export interface LeaderboardEntry {
  userId: string;
  name: string;
  initials: string;
  totalSteps: number;
  totalDistanceMi: number;
}

export interface Participant {
  userId: string;
  name: string;
  initials: string;
}

// A bot never signs in and never calls recordProgress() — its steps are
// simulated on read from its id and level (see
// src/challenges/botSimulation.ts), not stored day by day.
export type BotFitnessLevel = 'casual' | 'active' | 'athletic' | 'elite';

export interface ChallengeBot {
  id: string;
  challengeId: string;
  name: string;
  fitnessLevel: BotFitnessLevel;
}

export interface CreateChallengeInput {
  name: string;
  kind: ChallengeKind;
  durationDays: number;
  dailyGoalSteps?: number;
  bots?: { name: string; fitnessLevel: BotFitnessLevel }[];
}

export interface ChallengesProvider {
  // Raw rows only — screens that need display strings (colors, "day 9 of
  // 21", tint per person) compute them from these via
  // src/challenges/present.ts rather than the provider doing it, so a
  // real backend and the sample-data fallback can share one formatter.
  listMyChallenges(): Promise<Challenge[]>;
  getChallenge(challengeId: string): Promise<Challenge>;
  // Every participant, regardless of whether they've recorded any
  // progress yet — a freshly created challenge has participants (at
  // least its creator) but an empty leaderboard, since nothing calls
  // recordProgress() yet (see README "What's not implemented").
  listParticipants(challengeId: string): Promise<Participant[]>;
  listBots(challengeId: string): Promise<ChallengeBot[]>;
  getLeaderboard(challengeId: string): Promise<LeaderboardEntry[]>;
  createChallenge(input: CreateChallengeInput): Promise<Challenge>;
  recordProgress(challengeId: string, steps: number, distanceMi: number): Promise<void>;
}
