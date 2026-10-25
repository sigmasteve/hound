import { BINGO_CATEGORY_LABEL, classifyWorkout, type ClassicBingoCategory } from './bingo';
import { addDaysToKey, localDayKey } from './challengeDays';
import type { WorkoutSample } from '../health/types';

// Bingo that plays like real bingo (0117_hound_bingo.sql): the 'hound'
// card type. Pure, like bingo.ts.
//
//   - A card is 3x3 (a week or less), 4x4 H-U-N-T (8-20 days) or 5x5
//     H-O-U-N-D (21+ days). The server deals it, shuffled within each
//     column, into bingo_cards.
//   - No caller: doing a square marks it. One workout marks one square,
//     and one day's steps mark one step square, so a 30K day can't light
//     up the whole H column.
//   - A full row, column or diagonal is a BINGO. The server notes when it
//     first sees one, and that order decides 1st, 2nd and 3rd.

export type HoundSquare =
  | 'steps_8k'
  | 'steps_10k'
  | 'steps_12k'
  | 'steps_15k'
  | 'steps_20k'
  | 'run'
  | 'outdoor_walk'
  | 'hike'
  | 'bike'
  | 'miles_3'
  | 'run_walk_2mi'
  | 'before_7'
  | 'before_9'
  | 'lunch'
  | 'after_7pm'
  | 'weekend'
  | 'long_30'
  | 'long_45'
  | 'two_a_day'
  | 'three_in_row'
  | 'all_goals'
  | 'strength'
  | 'yoga_pilates'
  | 'hiit_cardio'
  | 'sports'
  | 'swim';

// What's in a dealt card: a square, or FREE.
export type CardCell = HoundSquare | 'free';

// How a square gets marked: by a day's steps (one step square a day), by
// one workout (one square a workout), or by something a whole day did.
export type SquareSource = 'steps' | 'workout' | 'day';

export interface SquareInfo {
  label: string;
  emoji: string;
  source: SquareSource;
  // What it takes, for the square's detail.
  hint: string;
  // Step squares: the day's steps it needs.
  steps?: number;
  // When a workout fits several open squares, the harder one goes first
  // if both get you equally close to a BINGO. Higher is harder.
  hardness: number;
}

export const SQUARES: Record<HoundSquare, SquareInfo> = {
  steps_8k: { label: '8k-step day', emoji: '👟', source: 'steps', steps: 8_000, hint: '8,000 steps in a day.', hardness: 1 },
  steps_10k: { label: '10k-step day', emoji: '👟', source: 'steps', steps: 10_000, hint: '10,000 steps in a day.', hardness: 2 },
  steps_12k: { label: '12.5k-step day', emoji: '👟', source: 'steps', steps: 12_500, hint: '12,500 steps in a day.', hardness: 3 },
  steps_15k: { label: '15k-step day', emoji: '👟', source: 'steps', steps: 15_000, hint: '15,000 steps in a day.', hardness: 4 },
  steps_20k: { label: '20k-step day', emoji: '👟', source: 'steps', steps: 20_000, hint: '20,000 steps in a day.', hardness: 5 },
  run: { label: 'Run', emoji: '🏃', source: 'workout', hint: 'Any run or jog.', hardness: 2 },
  outdoor_walk: { label: 'Outdoor walk 20+ min', emoji: '🌳', source: 'workout', hint: 'A walk outside, 20 minutes or more.', hardness: 1 },
  hike: { label: 'Hike', emoji: '🥾', source: 'workout', hint: 'A hike.', hardness: 4 },
  bike: { label: 'Bike ride', emoji: '🚴', source: 'workout', hint: 'A ride, outside or on a bike indoors.', hardness: 3 },
  miles_3: { label: '3+ miles in a day', emoji: '📏', source: 'day', hint: '3 miles walked or run in a day.', hardness: 2 },
  run_walk_2mi: { label: 'Run or walk 2+ mi', emoji: '🏃', source: 'workout', hint: 'One run or walk of 2 miles or more.', hardness: 2 },
  before_7: { label: 'Workout before 7am', emoji: '🌅', source: 'workout', hint: 'A workout that starts before 7am.', hardness: 4 },
  before_9: { label: 'Workout before 9am', emoji: '☀️', source: 'workout', hint: 'A workout that starts before 9am.', hardness: 3 },
  lunch: { label: 'Lunch workout', emoji: '🥪', source: 'workout', hint: 'A workout that starts between 11am and 2pm.', hardness: 3 },
  after_7pm: { label: 'Workout after 7pm', emoji: '🌙', source: 'workout', hint: 'A workout that starts at 7pm or later.', hardness: 2 },
  weekend: { label: 'Weekend workout', emoji: '📅', source: 'workout', hint: 'A logged workout on a Saturday or Sunday, your phone\'s time.', hardness: 1 },
  long_30: { label: '30+ min workout', emoji: '⏱️', source: 'workout', hint: 'One workout of 30 minutes or more.', hardness: 1 },
  long_45: { label: '45+ min workout', emoji: '⏱️', source: 'workout', hint: 'One workout of 45 minutes or more.', hardness: 3 },
  two_a_day: { label: '2 workouts in a day', emoji: '✌️', source: 'day', hint: 'Two workouts on the same day.', hardness: 4 },
  three_in_row: { label: '3 days in a row', emoji: '🔁', source: 'day', hint: 'A workout three days running.', hardness: 4 },
  all_goals: { label: 'All goals done', emoji: '🎯', source: 'day', hint: 'Every daily goal done in one day.', hardness: 3 },
  strength: { label: 'Strength', emoji: '🏋️', source: 'workout', hint: 'Weights, strength or functional training.', hardness: 2 },
  yoga_pilates: { label: 'Yoga / Pilates', emoji: '🧘', source: 'workout', hint: 'Yoga, Pilates or barre.', hardness: 3 },
  hiit_cardio: { label: 'HIIT / Cardio', emoji: '🔥', source: 'workout', hint: 'HIIT, intervals, rowing, elliptical or stairs.', hardness: 2 },
  sports: { label: 'Sports', emoji: '⚽', source: 'workout', hint: 'Any sport: basketball, tennis, soccer, climbing and more.', hardness: 3 },
  swim: { label: 'Swim', emoji: '🏊', source: 'workout', hint: 'A swim.', hardness: 5 },
};

// A square's name, for any card type's square.
export function squareLabel(square: string): string {
  return (SQUARES as Record<string, SquareInfo | undefined>)[square]?.label ?? BINGO_CATEGORY_LABEL[square as ClassicBingoCategory] ?? square;
}

export type CardSize = 3 | 4 | 5;

// Kept in sync by hand with 0117's hound_bingo_size.
export function cardSizeForDays(durationDays: number): CardSize {
  return durationDays <= 7 ? 3 : durationDays <= 20 ? 4 : 5;
}

// The column letters and what each column is about. A 3x3 has none.
export const CARD_COLUMNS: Record<4 | 5, { letter: string; name: string }[]> = {
  4: [
    { letter: 'H', name: 'Hustle' },
    { letter: 'U', name: 'Up and at it' },
    { letter: 'N', name: 'Nonstop' },
    { letter: 'T', name: 'Try it' },
  ],
  5: [
    { letter: 'H', name: 'Hustle' },
    { letter: 'O', name: 'Outside' },
    { letter: 'U', name: 'Up and at it' },
    { letter: 'N', name: 'Nonstop' },
    { letter: 'D', name: 'Do something different' },
  ],
};

export function isHoundCard(challenge: { kind: string; bingoCardType: string | null }): boolean {
  return challenge.kind === 'bingo' && challenge.bingoCardType === 'hound';
}

// ── Lines ────────────────────────────────────────────────────────────

// Every row, column and diagonal, as card indexes (0 is the top-left).
export function cardLines(size: number): number[][] {
  const lines: number[][] = [];
  const range = Array.from({ length: size }, (_, i) => i);
  for (const r of range) lines.push(range.map((c) => r * size + c));
  for (const c of range) lines.push(range.map((r) => r * size + c));
  lines.push(range.map((i) => i * size + i));
  lines.push(range.map((i) => i * size + (size - 1 - i)));
  return lines;
}

export function isMarked(card: CardCell[], i: number, marked: Set<string>): boolean {
  return card[i] === 'free' || marked.has(card[i]);
}

export interface LineStatus {
  // Full lines, as card indexes.
  done: number[][];
  // The fewest squares left on any one line; 0 once there's a BINGO.
  away: number;
}

export function lineStatus(card: CardCell[], marked: Set<string>): LineStatus {
  const size = Math.round(Math.sqrt(card.length));
  if (!size) return { done: [], away: 0 };
  const done: number[][] = [];
  let away = size;
  for (const line of cardLines(size)) {
    const left = line.filter((i) => !isMarked(card, i, marked)).length;
    if (left === 0) done.push(line);
    away = Math.min(away, left);
  }
  return { done, away };
}

// ── What a workout or a day earns ────────────────────────────────────

// The workout squares this one workout could mark. Times are the phone's
// own clock, the same as everything else on Today.
export function workoutFits(w: WorkoutSample): HoundSquare[] {
  const fits: HoundSquare[] = [];
  const type = classifyWorkout(w.name, 'variety');
  const isWalk = type === 'walk_hike' && !/\bhik(e|ing)\b|\btrek\b/i.test(w.name);
  const isHike = type === 'walk_hike' && !isWalk;
  if (type === 'run') fits.push('run');
  if (isWalk && (w.durationMin ?? 0) >= 20 && w.isOutdoor !== false) fits.push('outdoor_walk');
  if (isHike) fits.push('hike');
  if (type === 'cycling') fits.push('bike');
  if ((type === 'run' || type === 'walk_hike') && (w.distanceMi ?? 0) >= 2) fits.push('run_walk_2mi');
  if (type === 'strength' || type === 'yoga_pilates' || type === 'hiit_cardio' || type === 'sports' || type === 'swim') {
    fits.push(type);
  }
  const hour = w.when.getHours();
  if (hour < 7) fits.push('before_7');
  if (hour < 9) fits.push('before_9');
  if (hour >= 11 && hour < 14) fits.push('lunch');
  if (hour >= 19) fits.push('after_7pm');
  const weekday = w.when.getDay();
  if (weekday === 0 || weekday === 6) fits.push('weekend');
  const minutes = w.durationMin ?? 0;
  if (minutes >= 30) fits.push('long_30');
  if (minutes >= 45) fits.push('long_45');
  return fits;
}

// Squares where any workout can be linked by hand: what kind of workout
// it was is a guess from its name, so someone can say so themselves.
// Times, lengths and distances come from the workout itself.
export function canLinkAnyWorkout(square: HoundSquare): boolean {
  return ['run', 'outdoor_walk', 'hike', 'bike', 'strength', 'yoga_pilates', 'hiit_cardio', 'sports', 'swim'].includes(square);
}

export interface BingoDay {
  // 'YYYY-MM-DD', on this phone.
  day: string;
  steps: number;
  distanceMi: number;
  // Every daily goal done (null: no daily goals, or not known).
  allGoalsDone: boolean | null;
}

// A mark already on the card: which square, and what earned it
// (bingo_progress.workout_key: a workout's id, or a day key below).
export interface ExistingMark {
  square: string;
  key: string | null;
  source: 'auto' | 'manual';
}

export interface NewMark {
  square: HoundSquare;
  key: string;
  // What shows under the square: the workout, or the day.
  name: string;
  when: Date;
  day: string;
}

// A day's step mark moving up to a bigger step square (the day kept
// walking after it marked a smaller one).
export interface StepMove {
  key: string;
  from: HoundSquare;
  to: HoundSquare;
  name: string;
}

// The keys a day's own marks use, so each can happen once.
export const stepsKey = (day: string) => `steps:${day}`;
const dayKey = (square: HoundSquare, day: string) => `${square}:${day}`;

function dayDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

// Works out what a sync should mark. Everything already on the card
// stays put, except a day's step mark, which can move up to a bigger
// step square (never off a finished line). Then, in order:
//   1. Each day's steps mark the biggest open step square they reach.
//   2. Whole-day squares, the first day each is done.
//   3. Each new workout marks one open square it fits: the one that gets
//      a line closest to BINGO, the harder one on a tie.
export function planBingoMarks(
  card: CardCell[],
  existing: ExistingMark[],
  days: BingoDay[],
  workouts: WorkoutSample[],
): { marks: NewMark[]; moves: StepMove[] } {
  const onCard = new Set<string>(card.filter((c) => c !== 'free'));
  const marked = new Set(existing.map((e) => e.square));
  const usedKeys = new Set(existing.map((e) => e.key).filter((k): k is string => !!k));
  const marks: NewMark[] = [];
  const moves: StepMove[] = [];
  const add = (m: NewMark) => {
    marks.push(m);
    marked.add(m.square);
    usedKeys.add(m.key);
  };

  const stepSquares = (Object.keys(SQUARES) as HoundSquare[])
    .filter((s) => SQUARES[s].source === 'steps' && onCard.has(s))
    .sort((a, b) => (SQUARES[b].steps ?? 0) - (SQUARES[a].steps ?? 0));
  const sortedDays = [...days].sort((a, b) => a.day.localeCompare(b.day));

  // 1. Steps.
  for (const d of sortedDays) {
    const best = stepSquares.find((s) => !marked.has(s) && d.steps >= (SQUARES[s].steps ?? Infinity));
    if (!best) continue;
    const key = stepsKey(d.day);
    const name = `${d.steps.toLocaleString('en-US')} steps`;
    const current = existing.find((e) => e.key === key);
    if (!current) {
      add({ square: best, key, name, when: dayDate(d.day), day: d.day });
      continue;
    }
    const currentSteps = SQUARES[current.square as HoundSquare]?.steps ?? 0;
    if ((SQUARES[best].steps ?? 0) <= currentSteps) continue;
    // Don't pull a square out of a line that's already a BINGO.
    const { done } = lineStatus(card, marked);
    const at = card.indexOf(current.square as CardCell);
    if (done.some((line) => line.includes(at))) continue;
    moves.push({ key, from: current.square as HoundSquare, to: best, name });
    marked.delete(current.square);
    marked.add(best);
  }

  // 2. Whole days.
  const workoutDays = new Map<string, WorkoutSample[]>();
  for (const w of workouts) {
    const k = localDayKey(w.when);
    workoutDays.set(k, [...(workoutDays.get(k) ?? []), w]);
  }
  for (const d of sortedDays) {
    const dayMark = (square: HoundSquare, name: string) => {
      if (!onCard.has(square) || marked.has(square) || usedKeys.has(dayKey(square, d.day))) return;
      add({ square, key: dayKey(square, d.day), name, when: dayDate(d.day), day: d.day });
    };
    if (d.distanceMi >= 3) dayMark('miles_3', `${d.distanceMi.toFixed(1)} mi`);
    const n = workoutDays.get(d.day)?.length ?? 0;
    if (n >= 2) dayMark('two_a_day', `${n} workouts`);
    if (n >= 1 && workoutDays.has(addDaysToKey(d.day, -1)) && workoutDays.has(addDaysToKey(d.day, -2))) {
      dayMark('three_in_row', '3 days running');
    }
    if (d.allGoalsDone) dayMark('all_goals', 'All goals done');
  }

  // 3. Workouts, oldest first.
  const lines = cardLines(Math.round(Math.sqrt(card.length)));
  const closeness = (square: HoundSquare) => {
    const at = card.indexOf(square);
    return Math.max(...lines.filter((l) => l.includes(at)).map((l) => l.filter((i) => isMarked(card, i, marked)).length));
  };
  for (const w of [...workouts].sort((a, b) => a.when.getTime() - b.when.getTime())) {
    if (usedKeys.has(w.id)) continue;
    const open = workoutFits(w).filter((s) => onCard.has(s) && !marked.has(s));
    if (!open.length) continue;
    open.sort((a, b) => closeness(b) - closeness(a) || SQUARES[b].hardness - SQUARES[a].hardness);
    add({ square: open[0], key: w.id, name: w.name, when: w.when, day: localDayKey(w.when) });
  }

  return { marks, moves };
}

// ── Standings ────────────────────────────────────────────────────────

export interface HoundCardState {
  userId: string;
  card: CardCell[];
  marked: Set<string>;
  squaresMarked: number;
  lines: LineStatus;
  bingoAt: string | null;
  blackout: boolean;
  // 1, 2, 3... in the order BINGOs came in; null without one.
  place: number | null;
}

export interface BingoCardRow {
  userId: string;
  squares: CardCell[];
  bingoAt: string | null;
  blackoutAt: string | null;
}

// Everyone's card with what's marked on it, BINGOs first (in order),
// then by fewest squares away, then by most squares.
export function houndStandings(
  cards: BingoCardRow[],
  rows: { userId: string; category: string }[],
): HoundCardState[] {
  const byUser = new Map<string, Set<string>>();
  for (const r of rows) byUser.set(r.userId, (byUser.get(r.userId) ?? new Set()).add(r.category));
  const states = cards.map((c): HoundCardState => {
    const all = byUser.get(c.userId) ?? new Set<string>();
    const marked = new Set([...all].filter((s) => c.squares.includes(s as CardCell)));
    return {
      userId: c.userId,
      card: c.squares,
      marked,
      squaresMarked: marked.size,
      lines: lineStatus(c.squares, marked),
      bingoAt: c.bingoAt,
      blackout: !!c.blackoutAt,
      place: null,
    };
  });
  const bingos = states.filter((s) => s.bingoAt).sort((a, b) => a.bingoAt!.localeCompare(b.bingoAt!));
  bingos.forEach((s, i) => {
    s.place = i > 0 && bingos[i - 1].bingoAt === s.bingoAt ? bingos[i - 1].place : i + 1;
  });
  return states.sort(
    (a, b) =>
      (a.place ?? Infinity) - (b.place ?? Infinity) ||
      a.lines.away - b.lines.away ||
      b.squaresMarked - a.squaresMarked,
  );
}
