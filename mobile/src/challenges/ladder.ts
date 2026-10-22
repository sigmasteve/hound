import { BACKGROUNDS, FRAMES, ICONS } from '../cosmetics/catalog';
import { levelProgressForXp, xpForLevel } from './leveling';
import { RANKS, type Rank } from './ranks';

// The ladder ahead: every level where something changes, with what it
// brings. Pure data from the ranks, the XP curve and the Locker catalog,
// so the ladder sheet (HoundLadderSheet), the Kennel's "What's next" and
// the level-up moment all tell the same story. No Supabase/RN imports,
// same discipline as leveling.ts.

export interface LadderStep {
  level: number;
  // Total XP it takes to get there.
  xp: number;
  // The rank reached at this level, when one is.
  rank: Rank | null;
  // Everything else: Locker items and badges.
  unlocks: string[];
}

// What your hound gains with each rank (HoundArt: it grows with the
// first two, is full grown as an Alpha, and a Legend glows).
export const RANK_GAINS: Record<Rank['id'], string> = {
  pup: 'a pup',
  tracker: 'grows bigger',
  hunter: 'grows bigger again',
  alpha: 'full grown',
  legend: 'a golden aura',
};

// How XP is earned (0100_faster_leveling.sql).
export const XP_SOURCES = 'Open Hound +5 · a goal day +10 · a goal week +25 · a finished challenge about +25';

let cached: LadderStep[] | null = null;

export function houndLadder(): LadderStep[] {
  if (cached) return cached;
  const steps = new Map<number, LadderStep>();
  const at = (level: number): LadderStep => {
    let s = steps.get(level);
    if (!s) {
      s = { level, xp: xpForLevel(level), rank: null, unlocks: [] };
      steps.set(level, s);
    }
    return s;
  };
  for (const r of RANKS) if (r.minLevel > 0) at(r.minLevel).rank = r;
  for (const item of [...FRAMES, ...BACKGROUNDS, ...ICONS]) {
    if (item.unlockXp !== null) at(levelProgressForXp(item.unlockXp).level).unlocks.push(item.name);
  }
  // The two level achievements (achievements/achievementIcons.ts).
  at(5).unlocks.push('Level 5 badge');
  at(10).unlocks.push('Level 10 badge');
  cached = [...steps.values()].sort((a, b) => a.level - b.level);
  return cached;
}

// The steps still ahead of a level, nearest first.
export function stepsAfter(level: number, count = Infinity): LadderStep[] {
  return houndLadder()
    .filter((s) => s.level > level)
    .slice(0, count);
}

// "Hunter (grows bigger again) · Ocean · Level 10 badge"
export function stepLabel(step: LadderStep): string {
  const parts = step.rank ? [`${step.rank.name} (${RANK_GAINS[step.rank.id]})`] : [];
  return [...parts, ...step.unlocks].join(' · ');
}
