// Pure XP -> level math — no Supabase/RN imports, same discipline as
// bingo.ts/streak.ts. A person's level is never stored (see
// 0058_hound_score.sql's own comment): it's always derived fresh from
// profiles.xp_total through xpForLevel below, so it can never drift out
// of sync with the number it actually means.
//
// Curve: reaching level L takes 50 * L^2 total XP (level 1: 50, level 5:
// 1,250, level 10: 5,000, level 20: 20,000) — early levels come quickly
// (a couple of finished challenges), later ones need sustained play,
// classic increasing-threshold RPG shape.
export function xpForLevel(level: number): number {
  return 50 * level * level;
}

export interface LevelProgress {
  level: number;
  // XP earned since hitting the current level.
  xpIntoLevel: number;
  // XP still needed to reach the next level.
  xpToNextLevel: number;
  // xpIntoLevel / (xpIntoLevel + xpToNextLevel), for a progress bar.
  pctToNextLevel: number;
}

export function levelProgressForXp(xpTotal: number): LevelProgress {
  const xp = Math.max(0, xpTotal);
  let level = 0;
  while (xpForLevel(level + 1) <= xp) level++;
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  const span = ceiling - floor;
  return {
    level,
    xpIntoLevel: xp - floor,
    xpToNextLevel: ceiling - xp,
    pctToNextLevel: span > 0 ? ((xp - floor) / span) * 100 : 100,
  };
}
