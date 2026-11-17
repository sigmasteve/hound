import type { ChallengeKind } from '../data/sampleData';
import type { ChallengeUnlockGates } from './unlockGatesApi';

// "Earned by playing" (bones_earned_total) against the locked games
// (challenge_unlock_gates). Bought Bones never count (0066); goal days,
// goal weeks, the daily bonus, Bone Dig, badges and finishing setup do
// (0217), as do challenges and level ups. The server refuses to create a
// locked game too (0217), so this is only what the app shows.

// The next game to open: the smallest gate still above what you've
// earned. Null when every game is open (or nothing is locked).
export function nextUnlock(
  gates: ChallengeUnlockGates,
  earned: number,
): { kind: ChallengeKind; bones: number; toGo: number } | null {
  let best: { kind: ChallengeKind; bones: number } | null = null;
  for (const [kind, bones] of Object.entries(gates) as [ChallengeKind, number][]) {
    if (bones > earned && (!best || bones < best.bones)) best = { kind, bones };
  }
  return best ? { ...best, toGo: best.bones - earned } : null;
}

// How far along, 0..1.
export function unlockShare(earned: number, bones: number): number {
  return bones > 0 ? Math.max(0, Math.min(1, earned / bones)) : 1;
}

// The "earned by playing" green for text and icons: the palette's green
// reads on the dark theme; on the light one it needs a deeper shade.
export function earnedGreen(colors: { surface: string; green: string }): string {
  return colors.surface === '#ffffff' ? '#2f7a4c' : colors.green;
}
