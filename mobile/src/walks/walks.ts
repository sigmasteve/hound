import type { StepBucket } from '../health/types';

// Walks (0161_hound_walks.sql): your walks become the Hound's walks.
// Pure helpers: spotting walks in a day's 15-minute step buckets, their
// names, and how they read. The state lives in useHoundWalks.

export type FindRarity = 'common' | 'uncommon' | 'rare';
export type Season = 'autumn' | 'winter' | 'spring' | 'summer';

export interface FindKind {
  id: string;
  name: string;
  rarity: FindRarity;
  // Only found in this season; null is all year.
  season: Season | null;
}

export interface HoundWalk {
  id: string;
  // Local day, 'YYYY-MM-DD'.
  day: string;
  // Minutes after local midnight it started.
  startMinute: number;
  startedAt: Date;
  endedAt: Date;
  steps: number;
  distanceM: number | null;
  findId: string | null;
  // Still going: it finds something once it's over.
  walking: boolean;
}

export interface WalksData {
  walks: HoundWalk[];
  // How many of each kind you've found, ever.
  found: Map<string, { count: number; firstAt: Date | null }>;
  kinds: FindKind[];
  season: Season;
  // The day's step total, by local day.
  stepsByDay: Map<string, number>;
}

// A walk sent to save_hound_walks.
export interface SpottedWalk {
  start: Date;
  end: Date;
  startMinute: number;
  steps: number;
  distanceM: number;
}

// About 100 steps a minute at a walking pace, and 0.762 m (2.5 ft) a step.
const STEPS_PER_MINUTE = 100;
const METRES_PER_STEP = 0.762;
// A bucket counts toward a walk with at least this many steps in its 15
// minutes (5 minutes of walking).
const WALKING_BUCKET = 500;
// A walk is at least 10 minutes of walking.
const MIN_WALK_STEPS = 10 * STEPS_PER_MINUTE;

// Walks in a day's buckets: runs of back-to-back busy buckets, 10 minutes
// of walking or more. A walk's ends are trimmed to the minutes walked in
// its first and last buckets, at a walking pace, so a walk from 8:10 to
// 8:40 doesn't read as 8:00 to 8:45.
export function spotWalks(buckets: StepBucket[]): SpottedWalk[] {
  const sorted = [...buckets].sort((a, b) => a.start.getTime() - b.start.getTime());
  const runs: StepBucket[][] = [];
  let run: StepBucket[] = [];
  for (const b of sorted) {
    const prev = run.at(-1);
    if (b.steps >= WALKING_BUCKET && (!prev || b.start.getTime() - prev.end.getTime() <= 60_000)) {
      run.push(b);
    } else {
      if (run.length) runs.push(run);
      run = b.steps >= WALKING_BUCKET ? [b] : [];
    }
  }
  if (run.length) runs.push(run);

  const out: SpottedWalk[] = [];
  for (const r of runs) {
    const steps = r.reduce((n, b) => n + b.steps, 0);
    if (steps < MIN_WALK_STEPS) continue;
    const first = r[0];
    const last = r.at(-1)!;
    const bucketMs = (b: StepBucket) => b.end.getTime() - b.start.getTime();
    const walkedMs = (b: StepBucket) => Math.min(bucketMs(b), (b.steps / STEPS_PER_MINUTE) * 60_000);
    const start = r.length === 1 ? first.start : new Date(first.end.getTime() - walkedMs(first));
    const end = new Date((r.length === 1 ? first.start.getTime() : last.start.getTime()) + walkedMs(last));
    out.push({
      start,
      end,
      startMinute: start.getHours() * 60 + start.getMinutes(),
      steps,
      distanceM: Math.round(steps * METRES_PER_STEP),
    });
  }
  return out;
}

export type WalkTime = 'morning' | 'lunchtime' | 'afternoon' | 'evening' | 'late';

// The same cut-offs as admin_walks_overview.
export function walkTime(startMinute: number): WalkTime {
  if (startMinute >= 300 && startMinute < 660) return 'morning';
  if (startMinute >= 660 && startMinute < 840) return 'lunchtime';
  if (startMinute >= 840 && startMinute < 1020) return 'afternoon';
  if (startMinute >= 1020 && startMinute < 1260) return 'evening';
  return 'late';
}

const WALK_NAMES: Record<WalkTime, string> = {
  morning: 'Morning walk',
  lunchtime: 'Lunchtime walk',
  afternoon: 'Afternoon walk',
  evening: 'Evening walk',
  late: 'Late walk',
};

export function walkName(w: Pick<HoundWalk, 'startMinute'>): string {
  return WALK_NAMES[walkTime(w.startMinute)];
}

export function walkMinutes(w: Pick<HoundWalk, 'startedAt' | 'endedAt'>): number {
  return Math.max(1, Math.round((w.endedAt.getTime() - w.startedAt.getTime()) / 60_000));
}

export function walkMiles(w: Pick<HoundWalk, 'distanceM' | 'steps'>): number {
  const m = w.distanceM ?? w.steps * METRES_PER_STEP;
  return m / 1609.344;
}

// "1.3 mi · 24 min"
export function walkStats(w: HoundWalk): string {
  const mi = walkMiles(w);
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi · ${walkMinutes(w)} min`;
}

export const SEASON_NAMES: Record<Season, string> = {
  autumn: 'Autumn',
  winter: 'Winter',
  spring: 'Spring',
  summer: 'Summer',
};

export const RARITY_NAMES: Record<FindRarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
};

// "a pinecone", "an acorn", "sea glass"
export function findWithArticle(name: string): string {
  const lower = name.charAt(0).toLowerCase() + name.slice(1);
  if (/^(sea glass|clover)$/i.test(name)) return lower;
  if (/^(a|an|the) /i.test(lower)) return lower;
  return /^[aeiou]/i.test(lower) ? `an ${lower}` : `a ${lower}`;
}
