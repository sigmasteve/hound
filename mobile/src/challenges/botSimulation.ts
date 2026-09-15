import type { BotFitnessLevel, Challenge, ChallengeBot, LeaderboardEntry, Participant } from './types';

// Bot presets are single first names, so `initialsFor` (built for "First
// Last" human names) would only ever return one letter — this always
// takes the first two characters instead, matching the two-letter avatars
// every other participant gets.
export function botInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export const BOT_FITNESS_LEVELS: Record<
  BotFitnessLevel,
  { label: string; desc: string; dailyStepsRange: [number, number] }
> = {
  casual: { label: 'Casual', desc: '2,500–7,000 steps/day', dailyStepsRange: [2500, 7000] },
  active: { label: 'Active', desc: '6,500–12,000 steps/day', dailyStepsRange: [6500, 12000] },
  athletic: { label: 'Athletic', desc: '10,000–16,000 steps/day', dailyStepsRange: [10000, 16000] },
  elite: { label: 'Elite', desc: '15,000–23,000 steps/day', dailyStepsRange: [15000, 23000] },
};

// One named preset per fitness level — picking a bot means picking one of
// these 4, not naming your own, so there's no free-text input or
// duplicate-name handling to worry about.
export const BOT_PRESETS: { id: string; name: string; fitnessLevel: BotFitnessLevel }[] = [
  { id: 'preset-casey', name: 'Casey', fitnessLevel: 'casual' },
  { id: 'preset-micah', name: 'Micah', fitnessLevel: 'active' },
  { id: 'preset-reese', name: 'Reese', fitnessLevel: 'athletic' },
  { id: 'preset-blaze', name: 'Blaze', fitnessLevel: 'elite' },
];

// Deterministic string hash + PRNG, seeded per (bot id, day) rather than
// carrying PRNG state across days — a bot has no backend job logging one
// day at a time, so its whole trajectory is recomputed from scratch on
// every read, and it has to come out identical every time regardless of
// call order or how many days have elapsed.
function hashSeed(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function pseudoRandom(seed: number): number {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// `daysElapsed` can be fractional (see daysElapsedFraction below) — every
// *complete* day (its integer part) counts in full, but the current,
// still-in-progress day is scaled by how far into it we are, so a bot's
// steps climb through the day the way a real synced step count would
// instead of jumping to a full day's total the instant the day starts.
export function simulateBotSteps(botId: string, fitnessLevel: BotFitnessLevel, daysElapsed: number): number {
  const [min, max] = BOT_FITNESS_LEVELS[fitnessLevel].dailyStepsRange;
  const fullDays = Math.floor(daysElapsed);
  const todayFraction = daysElapsed - fullDays;

  let total = 0;
  for (let day = 0; day < fullDays; day++) {
    const rand = pseudoRandom(hashSeed(`${botId}:${day}`));
    total += min + rand * (max - min);
  }
  if (todayFraction > 0) {
    const rand = pseudoRandom(hashSeed(`${botId}:${fullDays}`));
    total += (min + rand * (max - min)) * todayFraction;
  }
  return Math.round(total);
}

// Fractional day count for bot simulation specifically — the integer
// "Day X of Y" every screen displays always rounds up to a whole day (a
// challenge started 5 minutes ago still reads "Day 1"), but a bot's
// steps need the actual fraction of the current day that's elapsed.
// Clamped to the challenge's duration so a finished challenge's bots
// stop accumulating.
export function daysElapsedFraction(challenge: Challenge): number {
  const elapsed = (Date.now() - new Date(challenge.startsAt).getTime()) / 86_400_000;
  return Math.min(challenge.durationDays, Math.max(0, elapsed));
}

export function botToParticipant(bot: ChallengeBot): Participant {
  return { userId: bot.id, name: bot.name, initials: botInitials(bot.name), role: bot.role };
}

export function botToLeaderboardEntry(bot: ChallengeBot, daysElapsed: number): LeaderboardEntry {
  return {
    userId: bot.id,
    name: bot.name,
    initials: botInitials(bot.name),
    totalSteps: simulateBotSteps(bot.id, bot.fitnessLevel, daysElapsed),
    // Only steps are simulated — a made-up steps-per-mile conversion would
    // just be fabricated precision, so bots never show a distance.
    totalDistanceMi: 0,
  };
}
