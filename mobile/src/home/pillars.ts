import type { MyFasting } from '../fasting/fastingApi';
import type { HoundUse } from '../onboarding/welcomeApi';

// Hound's three pillars: steps & workouts (always), Fasting and Move.
// Today's Your day and the You tab show Fasting and Move for the people
// who use them, by the same rule (the streamlining, Steve Nov 2026).
const MOVE_USES: HoundUse[] = ['activities', 'strength', 'workouts'];
const NEW_USES: HoundUse[] = ['steps', 'fasting', 'water', 'friends', ...MOVE_USES];

// Fasting: once you've started a fast (and said you're 16 or older), or
// before a first fast if you ticked Intermittent fasting; never for
// under-16s.
export function fastingPillar(fasting: MyFasting | null, uses: HoundUse[] | null): boolean {
  return !!fasting && fasting.age !== 'under' && (fasting.startedAny ? fasting.age === 'ok' : !!uses?.includes('fasting'));
}

// Move: if you ticked Activities, Strength or Workouts, already have Move
// points today, or answered before those checkboxes existed.
export function movePillar(uses: HoundUse[] | null, movePts: number | null): boolean {
  return (movePts ?? 0) > 0 || !uses || uses.some((u) => MOVE_USES.includes(u)) || !uses.some((u) => NEW_USES.includes(u));
}
