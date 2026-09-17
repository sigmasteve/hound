import { botInitials, simulateBotSteps } from './botSimulation';
import type { Challenge, ChallengeBot, HuntRole, LeaderboardEntry, Participant } from './types';

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
// `daysElapsed` should be daysElapsedFraction(challenge)
// (src/challenges/botSimulation.ts) so bots accumulate through the
// current day instead of jumping to a full day's steps the instant it
// starts.
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

// Once the Hunter's own cumulative total reaches a Hunted participant's,
// that Hunted row displays as 'zombie' — caught, no longer being chased.
// Doesn't yet account for the Hunted's head start (CreateScreen's
// head-start slider is still purely decorative — see README "Hunter &
// Hunted: real scoring and roles"), so this is "closed the whole gap
// from zero," not "closed a real head-start advantage"; revisit once
// that slider actually writes a number somewhere.
//
// A real participant's 'zombie' role, once it appears here, gets
// persisted permanently by the caught person's own client (see
// ChallengeDetailScreen's catch-detection effect and
// ChallengesProvider.markCaught) — so for them this function is really
// "notice it," not "decide it fresh every time." A bot has no client of
// its own to persist anything through, so its 'zombie' status here is
// simply recomputed from scratch on every call instead, the same way
// every other bot number in this file already is.
export function withHuntCatches(board: BoardEntry[], sortBy: 'steps' | 'distance'): BoardEntry[] {
  const hunter = board.find((r) => r.role === 'hunter');
  if (!hunter) return board;
  const hunterMetric = sortBy === 'distance' ? hunter.totalDistanceMi : hunter.totalSteps;
  return board.map((r) => {
    if (r.role !== 'hunted') return r;
    const metric = sortBy === 'distance' ? r.totalDistanceMi : r.totalSteps;
    // `metric > 0` matters at the very start of a hunt, before anyone's
    // logged anything: both totals are 0 there, and 0 <= 0 would
    // otherwise catch every Hunted participant the instant the hunt is
    // created.
    return metric > 0 && metric <= hunterMetric ? { ...r, role: 'zombie' as const } : r;
  });
}

// A hunt with nobody left to chase — every Hunted participant (there has
// to be at least one) is already a Zombie. Requires `board` to already
// have gone through withHuntCatches; doesn't check challenge.kind itself
// since a non-hunt board never has any 'hunted'/'zombie' roles to find in
// the first place, so this is naturally false for one.
export function isHuntConcluded(board: BoardEntry[]): boolean {
  const hunted = board.filter((r) => r.role === 'hunted' || r.role === 'zombie');
  return hunted.length > 0 && hunted.every((r) => r.role === 'zombie');
}

// The one "is this challenge over" check shared by toChallengeCard
// (src/challenges/present.ts, for the Challenges screen's Finished
// section) and HomeScreen's hero card (for switching from "your
// standing" to "who won") — a hunt ends the moment isHuntConcluded is
// true, however many scheduled days are left; anything else just runs
// out its clock.
export function isChallengeFinished(challenge: Challenge, board: BoardEntry[]): boolean {
  if (challenge.kind === 'hunt' && isHuntConcluded(board)) return true;
  return new Date(challenge.endsAt).getTime() <= Date.now();
}
