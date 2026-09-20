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
  { label: string; desc: string; dailyStepsRange: [number, number]; dailyMilesRange: [number, number] }
> = {
  casual: { label: 'Casual', desc: '2,500–7,000 steps/day', dailyStepsRange: [2500, 7000], dailyMilesRange: [1.5, 3.5] },
  active: { label: 'Active', desc: '6,500–12,000 steps/day', dailyStepsRange: [6500, 12000], dailyMilesRange: [3, 6] },
  athletic: { label: 'Athletic', desc: '10,000–16,000 steps/day', dailyStepsRange: [10000, 16000], dailyMilesRange: [5, 9] },
  elite: { label: 'Elite', desc: '15,000–23,000 steps/day', dailyStepsRange: [15000, 23000], dailyMilesRange: [8, 13] },
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
// steps (or miles) climb through the day the way a real synced total
// would instead of jumping to a full day's total the instant the day
// starts. `seedKey` is folded into every day's seed rather than just the
// bot id, so two metrics simulated for the same bot (steps and distance)
// draw from independent random streams instead of both landing on the
// same percentile of their own range every day.
function simulateBotMetric(seedKey: string, range: [number, number], daysElapsed: number): number {
  const [min, max] = range;
  const fullDays = Math.floor(daysElapsed);
  const todayFraction = daysElapsed - fullDays;

  let total = 0;
  for (let day = 0; day < fullDays; day++) {
    const rand = pseudoRandom(hashSeed(`${seedKey}:${day}`));
    total += min + rand * (max - min);
  }
  if (todayFraction > 0) {
    const rand = pseudoRandom(hashSeed(`${seedKey}:${fullDays}`));
    total += (min + rand * (max - min)) * todayFraction;
  }
  return total;
}

export function simulateBotSteps(botId: string, fitnessLevel: BotFitnessLevel, daysElapsed: number): number {
  return Math.round(simulateBotMetric(botId, BOT_FITNESS_LEVELS[fitnessLevel].dailyStepsRange, daysElapsed));
}

// A fixed steps-per-mile conversion would be fabricated precision — real
// pace varies by activity, not by a universal ratio — so distance gets its
// own seeded daily range per fitness level instead of being derived from
// simulateBotSteps. That makes a bot's steps and distance independent
// random draws rather than correlated, but a challenge is only ever
// scored on one metric at a time, so nothing ever shows both side by side
// for the same bot. Not rounded, unlike steps — real logged distance is
// never a whole number either, and every caller already formats this with
// toFixed(1).
export function simulateBotDistance(botId: string, fitnessLevel: BotFitnessLevel, daysElapsed: number): number {
  return simulateBotMetric(`${botId}:mi`, BOT_FITNESS_LEVELS[fitnessLevel].dailyMilesRange, daysElapsed);
}

// Fractional day count for bot simulation specifically — the integer
// "Day X of Y" every screen displays always rounds up to a whole day (a
// challenge started 5 minutes ago still reads "Day 1"), but a bot's
// steps need the actual fraction of *today* (real clock time-of-day,
// midnight to midnight) that's elapsed, the same way a real device's
// step count works: checking at 5pm shows roughly 5/24 of a day's steps
// regardless of what time you happened to install the app. This is
// deliberately NOT "time since the challenge started" — a challenge
// created at 4:45pm should immediately reflect that it's already 72%
// through today, not treat 4:45pm as a fresh midnight and restart a
// rolling 24h window from there. Clamped to the challenge's duration so
// a finished challenge's bots stop accumulating.
export function daysElapsedFraction(challenge: Challenge): number {
  const start = new Date(challenge.startsAt);
  const now = new Date();
  const startOfCreationDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const fullCalendarDaysElapsed = Math.floor((now.getTime() - startOfCreationDay.getTime()) / 86_400_000);
  const timeOfDayFraction = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86_400;
  const elapsed = fullCalendarDaysElapsed + timeOfDayFraction;
  return Math.min(challenge.durationDays, Math.max(0, elapsed));
}

export function botToParticipant(bot: ChallengeBot): Participant {
  // A bot has no Home screen of its own to highlight anything on.
  return { userId: bot.id, name: bot.name, initials: botInitials(bot.name), role: bot.role, highlighted: false };
}

export function botToLeaderboardEntry(bot: ChallengeBot, daysElapsed: number): LeaderboardEntry {
  return {
    userId: bot.id,
    name: bot.name,
    initials: botInitials(bot.name),
    totalSteps: simulateBotSteps(bot.id, bot.fitnessLevel, daysElapsed),
    totalDistanceMi: simulateBotDistance(bot.id, bot.fitnessLevel, daysElapsed),
  };
}
