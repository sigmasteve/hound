import type { Participant } from './types';

// Deliberately pure, dependency-free (no supabase/RN imports) — same
// discipline streak.ts and board.ts's isHuntConcluded/tagGroupGoalMet
// already follow, so this stays trivially testable and safe to run in
// any environment.

// The 9 squares of a Variety Bingo card, in a fixed order shared by every
// participant (this isn't a randomized-per-player bingo card — the game
// is "log this variety," not luck of the draw). Kept in sync by hand with
// 0052_bingo_progress.sql's own check constraint; nothing generates one
// from the other.
export type BingoCategory =
  | 'run'
  | 'walk_hike'
  | 'cycling'
  | 'swim'
  | 'strength'
  | 'yoga_pilates'
  | 'hiit_cardio'
  | 'sports'
  | 'other';

export const BINGO_CATEGORIES: BingoCategory[] = [
  'run',
  'walk_hike',
  'cycling',
  'swim',
  'strength',
  'yoga_pilates',
  'hiit_cardio',
  'sports',
  'other',
];

export const BINGO_CATEGORY_LABEL: Record<BingoCategory, string> = {
  run: 'Run',
  walk_hike: 'Walk / Hike',
  cycling: 'Cycling',
  swim: 'Swim',
  strength: 'Strength',
  yoga_pilates: 'Yoga / Pilates',
  hiit_cardio: 'HIIT / Cardio',
  sports: 'Sports',
  other: 'Other',
};

// Checked in this exact order (first match wins) against a workout's raw
// name — HealthKit's own activity names (see health/iosProvider.ts's
// workoutActivityName) and Health Connect's exercise titles are free text
// with no small fixed set this could switch on directly, so this is a
// best-effort keyword classifier in the same spirit as the existing
// /run|walk|jog|hike/i heuristic deviceSync.ts already uses for a hunt's
// gps_distance fallback — not a guarantee, just a reasonable guess from a
// name. 'other' is the catch-all for anything that matches none of these
// (a genuinely unrecognized name, or a workout type this list doesn't
// cover) — it's still a real, fillable square, not an error state.
const CATEGORY_PATTERNS: [BingoCategory, RegExp][] = [
  ['swim', /swim/i],
  ['cycling', /cycl|\bbik(e|ing)\b|\bspin(ning)?\b/i],
  ['yoga_pilates', /yoga|pilates|\bbarre\b/i],
  ['hiit_cardio', /\bhiit\b|interval|elliptical|\brow(ing)?\b|\bstair/i],
  ['strength', /strength|\bweight|lifting|crossfit|functional|\bcore\b/i],
  ['sports', /basketball|soccer|football|tennis|golf|hockey|baseball|volleyball|badminton|squash|climb|kickbox|boxing|martial|dance/i],
  ['walk_hike', /\bwalk|\bhik(e|ing)\b|\btrek\b/i],
  ['run', /\brun|\bjog|\bsprint\b|marathon|\btrack\b/i],
];

export function classifyWorkout(name: string): BingoCategory {
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(name)) return category;
  }
  return 'other';
}

// Whether a square filled itself from real-time device classification, or
// a person explicitly picked a workout from today's history and told the
// app which square it means — see bingoApi.ts's recordBingoProgress and
// 0053_bingo_manual_link.sql's own comment for why this exists: some
// future card's categories (a Strength card's Arms/Legs/Chest/Back) have
// no automatic signal at all, only a person's own say-so.
export type BingoFillSource = 'auto' | 'manual';

// One row per category a participant has ever filled for a given
// challenge — see bingoApi.ts's listBingoProgress, backed by
// 0052/0053/0054_bingo_progress's upsert-once-per-category shape.
// workoutName/workoutAt/workoutKey are set for both fill sources (see
// syncBingoProgressFromDevice), not just a manual link — null only for a
// row written before 0053/0054 existed. workoutKey is the workout's own
// stable id (WorkoutSample.id — HealthKit's real w.uuid, Health Connect's
// own record id), the thing 0054_bingo_workout_key.sql's anti-double-link
// index actually keys on — workoutAt is display-only now, not a real
// identity (see that migration's own comment for why a timestamp turned
// out not to be safe for this).
export interface BingoProgressRow {
  userId: string;
  category: BingoCategory;
  firstLoggedAt: string;
  source: BingoFillSource;
  workoutName: string | null;
  workoutAt: string | null;
  workoutKey: string | null;
}

export interface BingoCard {
  userId: string;
  name: string;
  initials: string;
  filled: Set<BingoCategory>;
  // The full row per filled category, for anything that wants to show
  // which workout actually filled a square (e.g. "Legs — linked to Leg
  // day, 6:15pm") — filled is just this map's own keys, kept as a
  // separate Set since most callers (the leaderboard, Home's mini
  // preview) only ever need the count, not the detail.
  entries: Map<BingoCategory, BingoProgressRow>;
  squaresFilled: number;
  blackout: boolean;
}

// Folds already-fetched participants + bingo_progress rows into one card
// per participant — mirrors computeStreakStatus's own "pure function over
// already-fetched rows, called fresh on every load" shape. Bots are
// deliberately never included: a bot's steps/distance are simulated
// numbers (botSimulation.ts), never a real, classifiable workout — same
// reasoning Tag excludes them for (0045_tag_game_state.sql).
export function computeBingoCards(participants: Participant[], rows: BingoProgressRow[]): Map<string, BingoCard> {
  const byUser = new Map<string, Map<BingoCategory, BingoProgressRow>>();
  for (const row of rows) {
    const entries = byUser.get(row.userId) ?? new Map<BingoCategory, BingoProgressRow>();
    entries.set(row.category, row);
    byUser.set(row.userId, entries);
  }
  const cards = new Map<string, BingoCard>();
  for (const p of participants) {
    const entries = byUser.get(p.userId) ?? new Map<BingoCategory, BingoProgressRow>();
    cards.set(p.userId, {
      userId: p.userId,
      name: p.name,
      initials: p.initials,
      filled: new Set(entries.keys()),
      entries,
      squaresFilled: entries.size,
      blackout: entries.size === BINGO_CATEGORIES.length,
    });
  }
  return cards;
}
