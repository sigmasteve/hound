import type { BingoCardType, Participant } from './types';

// Deliberately pure, dependency-free (no supabase/RN imports) — same
// discipline streak.ts and board.ts's isHuntConcluded/tagGroupGoalMet
// already follow, so this stays trivially testable and safe to run in
// any environment.

// BingoCardType itself lives in types.ts (see its own comment there) —
// this re-exports it so every other file can keep importing bingo.ts for
// anything bingo-related without also needing to know it actually lives
// in types.ts underneath.
export type { BingoCardType } from './types';

export const DEFAULT_BINGO_CARD_TYPE: BingoCardType = 'variety';

export const BINGO_CARD_TYPE_NAME: Record<BingoCardType, string> = {
  variety: 'Variety',
  strength: 'Strength',
  sports: 'Sports',
};

export const BINGO_CARD_TYPE_DESC: Record<BingoCardType, string> = {
  variety: 'Log 9 different kinds of workouts — a run, a swim, a lift, whatever you can find.',
  strength: 'A push/pull/legs-style split — mostly filled by linking your own lifts by hand, since a workout’s own activity type never says which muscles it worked.',
  sports: 'A card of individual sports — basketball, tennis, soccer, and more.',
};

// Every category across every card type, in a single flat union — no
// two types ever share a slug except 'other' (see below), so a value is
// unambiguous without also carrying its card type alongside it. Kept in
// sync by hand with 0055_bingo_card_types.sql's own check constraint;
// nothing generates one from the other.
export type BingoCategory =
  // Variety
  | 'run'
  | 'walk_hike'
  | 'cycling'
  | 'swim'
  | 'strength'
  | 'yoga_pilates'
  | 'hiit_cardio'
  | 'sports'
  | 'other'
  // Strength (push/pull/legs split, not muscle groups)
  | 'push'
  | 'pull'
  | 'legs'
  | 'core'
  | 'upper'
  | 'lower'
  | 'full_body'
  | 'cardio_strength'
  // Sports
  | 'basketball'
  | 'soccer'
  | 'tennis'
  | 'golf'
  | 'baseball_softball'
  | 'volleyball'
  | 'hockey'
  | 'combat_sports';

// Every card has exactly 9 squares regardless of type — used wherever
// something needs "the" count without caring which categories they are
// (computeBingoCards' own blackout check, "X of 9 squares" copy).
export const BINGO_SQUARE_COUNT = 9;

// The 9 squares for each card type, in a fixed order shared by every
// participant (this isn't a randomized-per-player bingo card — the game
// is "log this variety," not luck of the draw).
export const BINGO_CARD_CATEGORIES: Record<BingoCardType, BingoCategory[]> = {
  variety: ['run', 'walk_hike', 'cycling', 'swim', 'strength', 'yoga_pilates', 'hiit_cardio', 'sports', 'other'],
  strength: ['push', 'pull', 'legs', 'core', 'upper', 'lower', 'full_body', 'cardio_strength', 'other'],
  sports: ['basketball', 'soccer', 'tennis', 'golf', 'baseball_softball', 'volleyball', 'hockey', 'combat_sports', 'other'],
};

export function categoriesForCardType(cardType: BingoCardType): BingoCategory[] {
  return BINGO_CARD_CATEGORIES[cardType];
}

// One flat map covering every category across every type — safe because
// no two types share a slug (see BingoCategory's own comment), so there's
// no ambiguity in looking up a label without also knowing the card type.
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
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  core: 'Core',
  upper: 'Upper',
  lower: 'Lower',
  full_body: 'Full Body',
  cardio_strength: 'Cardio-Strength',
  basketball: 'Basketball',
  soccer: 'Soccer',
  tennis: 'Tennis',
  golf: 'Golf',
  baseball_softball: 'Baseball / Softball',
  volleyball: 'Volleyball',
  hockey: 'Hockey',
  combat_sports: 'Combat Sports',
};

// Checked in this exact order (first match wins) against a workout's raw
// name — HealthKit's own activity names (see health/iosProvider.ts's
// workoutActivityName) and Health Connect's exercise titles are free text
// with no small fixed set this could switch on directly, so this is a
// best-effort keyword classifier in the same spirit as the existing
// /run|walk|jog|hike/i heuristic deviceSync.ts already uses for a hunt's
// gps_distance fallback — not a guarantee, just a reasonable guess from a
// name. 'other' is the catch-all for anything that matches none of these
// (a genuinely unrecognized name, or a workout type this card's own list
// doesn't cover) — it's still a real, fillable square, not an error
// state; for Strength especially, 'other' (via a generic "Functional/
// Traditional Strength Training" name with no muscle-group hint at all)
// is the expected common case, not a rare miss — that card leans on
// manual linking far more than auto-classification.
const VARIETY_PATTERNS: [BingoCategory, RegExp][] = [
  ['swim', /swim/i],
  ['cycling', /cycl|\bbik(e|ing)\b|\bspin(ning)?\b/i],
  ['yoga_pilates', /yoga|pilates|\bbarre\b/i],
  ['hiit_cardio', /\bhiit\b|interval|elliptical|\brow(ing)?\b|\bstair/i],
  ['strength', /strength|\bweight|lifting|crossfit|functional|\bcore\b/i],
  ['sports', /basketball|soccer|football|tennis|golf|hockey|baseball|volleyball|badminton|squash|climb|kickbox|boxing|martial|dance/i],
  ['walk_hike', /\bwalk|\bhik(e|ing)\b|\btrek\b/i],
  ['run', /\brun|\bjog|\bsprint\b|marathon|\btrack\b/i],
];

// HealthKit/Health Connect have no muscle-group signal on a workout at
// all (only an activity type like "Functional Strength Training") — this
// only ever catches a workout someone named descriptively themselves
// ("Leg day," "Push workout"), which is the exception, not the rule.
const STRENGTH_PATTERNS: [BingoCategory, RegExp][] = [
  ['full_body', /full.?body|total.?body/i],
  ['cardio_strength', /\bhiit\b|crossfit|\bcircuit\b|\binterval/i],
  ['push', /\bpush\b|\bchest\b|\bbench\b|\btricep/i],
  ['pull', /\bpull\b|\bback\b|\brow(ing)?\b|\blat(s)?\b|\bbicep/i],
  ['legs', /\bleg(s)?\b|\bsquat/i],
  ['core', /\bcore\b|\bab(s)?\b|\bplank/i],
  ['upper', /\bupper\b/i],
  ['lower', /\blower\b/i],
];

// Unlike Strength, HealthKit's own activity type already names individual
// sports directly (workoutActivityName title-cases the enum key — a
// basketball session really does come through as "Basketball") — this
// mostly just needs to recognize the name it's already given, not guess.
const SPORTS_PATTERNS: [BingoCategory, RegExp][] = [
  ['basketball', /basketball/i],
  ['soccer', /soccer/i],
  ['tennis', /tennis/i],
  ['golf', /golf/i],
  ['baseball_softball', /baseball|softball/i],
  ['volleyball', /volleyball/i],
  ['hockey', /hockey/i],
  ['combat_sports', /boxing|kickbox|martial|wrestl/i],
];

const CATEGORY_PATTERNS_BY_TYPE: Record<BingoCardType, [BingoCategory, RegExp][]> = {
  variety: VARIETY_PATTERNS,
  strength: STRENGTH_PATTERNS,
  sports: SPORTS_PATTERNS,
};

export function classifyWorkout(name: string, cardType: BingoCardType): BingoCategory {
  for (const [category, pattern] of CATEGORY_PATTERNS_BY_TYPE[cardType]) {
    if (pattern.test(name)) return category;
  }
  return 'other';
}

// Whether a square filled itself from real-time device classification, or
// a person explicitly picked a workout from today's history and told the
// app which square it means — see bingoApi.ts's recordBingoProgress and
// 0053_bingo_manual_link.sql's own comment for why this exists: a
// Strength card's own categories have no automatic signal at all, only a
// person's own say-so.
export type BingoFillSource = 'auto' | 'manual';

// One row per category a participant has ever filled for a given
// challenge — see bingoApi.ts's listBingoProgress, backed by
// 0052/0053/0054/0055_bingo_progress's upsert-once-per-category shape.
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
// reasoning Tag excludes them for (0045_tag_game_state.sql). Doesn't need
// to know the challenge's own card type — every type has exactly
// BINGO_SQUARE_COUNT squares, so "how many filled" and "is that all of
// them" never depend on which 9 categories they actually are.
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
      blackout: entries.size === BINGO_SQUARE_COUNT,
    });
  }
  return cards;
}
