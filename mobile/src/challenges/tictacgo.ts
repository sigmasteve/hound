import type { WorkoutSample } from '../health/types';
import { classifyWorkout } from './bingo';

// Pure game rules for Tic-Tac-Go — no Supabase/RN imports, same as
// bingo.ts and streak.ts. The server (0057_tictacgo_game.sql) owns turn
// order, the 24-hour limit and win/draw detection; this file owns what
// each square's goal means and whether some activity meets it.

export type TicTacGoDifficulty = 'easy' | 'medium' | 'advanced';

export const TICTACGO_DIFFICULTIES: TicTacGoDifficulty[] = ['easy', 'medium', 'advanced'];

export const TICTACGO_DIFFICULTY_NAME: Record<TicTacGoDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  advanced: 'Advanced',
};

export const TICTACGO_DIFFICULTY_DESC: Record<TicTacGoDifficulty, string> = {
  easy: 'Short walks, a few thousand steps, 15-minute workouts — a square a day is very doable.',
  medium: 'Around 10K steps, 2-mile runs, 30-minute workouts.',
  advanced: '15K+ steps, 5K runs, hour-long sessions — every square is a real effort.',
};

export const TICTACGO_TURN_HOURS = 24;

type GoalKind =
  | 'steps'
  | 'walk_mi'
  | 'run_mi'
  | 'walk_min'
  | 'any_min'
  | 'strength_min'
  | 'cardio_min'
  | 'yoga_min'
  | 'outdoor_min';

export interface TicTacGoGoal {
  id: string;
  // Short enough to fit a board square.
  label: string;
  // Spelled out for the claim panel.
  detail: string;
  kind: GoalKind;
  target: number;
}

function goal(id: string, label: string, detail: string, kind: GoalKind, target: number): TicTacGoGoal {
  return { id, label, detail, kind, target };
}

// Every square on a board comes from one difficulty's pool — never mixed,
// so an Easy game can't hand anyone an Advanced square. Each pool has
// more goals than squares, so boards differ game to game. Deliberately no
// swimming or cycling: not everyone has a pool or a bike, and a square
// one player physically can't claim isn't a fair square. Goal ids are
// what the server stores (tictacgo_games.goals) — never rename one.
export const TICTACGO_POOLS: Record<TicTacGoDifficulty, TicTacGoGoal[]> = {
  easy: [
    goal('steps_3000', '3K steps', 'Walk 3,000 steps', 'steps', 3000),
    goal('steps_5000', '5K steps', 'Walk 5,000 steps', 'steps', 5000),
    goal('walk_mi_1', 'Walk 1 mi', 'A walk of at least 1 mile', 'walk_mi', 1),
    goal('run_mi_0_5', 'Run ½ mi', 'A run of at least half a mile', 'run_mi', 0.5),
    goal('walk_min_20', '20-min walk', 'A walk of at least 20 minutes', 'walk_min', 20),
    goal('any_min_15', '15-min workout', 'Any workout of at least 15 minutes', 'any_min', 15),
    goal('strength_min_15', '15-min strength', 'A strength workout of at least 15 minutes', 'strength_min', 15),
    goal('cardio_min_15', '15-min cardio', 'A cardio workout of at least 15 minutes (running, HIIT, elliptical…)', 'cardio_min', 15),
    goal('yoga_min_10', '10-min yoga', 'Yoga, pilates or stretching for at least 10 minutes', 'yoga_min', 10),
    goal('outdoor_any', 'Outdoor workout', 'Any workout done outdoors', 'outdoor_min', 0),
  ],
  medium: [
    goal('steps_8000', '8K steps', 'Walk 8,000 steps', 'steps', 8000),
    goal('steps_10000', '10K steps', 'Walk 10,000 steps', 'steps', 10000),
    goal('walk_mi_3', 'Walk 3 mi', 'A walk of at least 3 miles', 'walk_mi', 3),
    goal('run_mi_2', 'Run 2 mi', 'A run of at least 2 miles', 'run_mi', 2),
    goal('walk_min_45', '45-min walk', 'A walk of at least 45 minutes', 'walk_min', 45),
    goal('any_min_45', '45-min workout', 'Any workout of at least 45 minutes', 'any_min', 45),
    goal('strength_min_30', '30-min strength', 'A strength workout of at least 30 minutes', 'strength_min', 30),
    goal('cardio_min_30', '30-min cardio', 'A cardio workout of at least 30 minutes (running, HIIT, elliptical…)', 'cardio_min', 30),
    goal('yoga_min_30', '30-min yoga', 'Yoga, pilates or stretching for at least 30 minutes', 'yoga_min', 30),
    goal('outdoor_min_30', '30-min outdoors', 'A workout of at least 30 minutes done outdoors', 'outdoor_min', 30),
  ],
  advanced: [
    goal('steps_15000', '15K steps', 'Walk 15,000 steps', 'steps', 15000),
    goal('steps_20000', '20K steps', 'Walk 20,000 steps', 'steps', 20000),
    goal('walk_mi_6', 'Walk 6 mi', 'A walk of at least 6 miles', 'walk_mi', 6),
    goal('run_mi_3_1', 'Run a 5K', 'A run of at least 3.1 miles', 'run_mi', 3.1),
    goal('run_mi_5', 'Run 5 mi', 'A run of at least 5 miles', 'run_mi', 5),
    goal('any_min_60', '60-min workout', 'Any workout of at least 60 minutes', 'any_min', 60),
    goal('strength_min_45', '45-min strength', 'A strength workout of at least 45 minutes', 'strength_min', 45),
    goal('cardio_min_60', '60-min cardio', 'A cardio workout of at least 60 minutes (running, HIIT, elliptical…)', 'cardio_min', 60),
    goal('yoga_min_45', '45-min yoga', 'Yoga, pilates or stretching for at least 45 minutes', 'yoga_min', 45),
    goal('outdoor_min_60', '60-min outdoors', 'A workout of at least 60 minutes done outdoors', 'outdoor_min', 60),
  ],
};

const GOALS_BY_ID = new Map<string, TicTacGoGoal>(
  Object.values(TICTACGO_POOLS).flatMap((pool) => pool.map((g) => [g.id, g] as const)),
);

// Null for an id this build doesn't know (a newer build added it) — the
// board shows the square as unclaimable rather than crashing.
export function goalById(id: string): TicTacGoGoal | null {
  return GOALS_BY_ID.get(id) ?? null;
}

// 9 goals from one difficulty's pool, in random positions.
export function drawBoard(difficulty: TicTacGoDifficulty): string[] {
  const ids = TICTACGO_POOLS[difficulty].map((g) => g.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, 9);
}

// Beyond bingo's own classifier: HealthKit names like "Mixed Cardio" or
// "Dance" and stretching types like "Flexibility" or "Mind And Body"
// don't match its keyword lists, but plainly count here.
function isCardio(w: WorkoutSample): boolean {
  const category = classifyWorkout(w.name, 'variety');
  return (
    category === 'hiit_cardio' ||
    category === 'run' ||
    category === 'cycling' ||
    category === 'swim' ||
    /cardio|dance|jump ?rope|kickbox/i.test(w.name)
  );
}

function isYoga(w: WorkoutSample): boolean {
  return (
    classifyWorkout(w.name, 'variety') === 'yoga_pilates' ||
    /stretch|flexibility|mind and body|cooldown|recovery/i.test(w.name)
  );
}

// Same fallback deviceSync.ts uses for 'gps_distance' challenges: trust
// the platform's own indoor/outdoor flag when it has one (iOS), and only
// guess from the name when it doesn't (Android, older iOS workouts).
function isOutdoor(w: WorkoutSample): boolean {
  return w.isOutdoor ?? /run|walk|jog|hike/i.test(w.name);
}

function matchesType(g: TicTacGoGoal, w: WorkoutSample): boolean {
  const category = classifyWorkout(w.name, 'variety');
  switch (g.kind) {
    case 'walk_mi':
    case 'walk_min':
      return category === 'walk_hike';
    case 'run_mi':
      return category === 'run';
    case 'strength_min':
      return category === 'strength';
    case 'cardio_min':
      return isCardio(w);
    case 'yoga_min':
      return isYoga(w);
    case 'outdoor_min':
      return isOutdoor(w);
    case 'any_min':
      return true;
    case 'steps':
      return false;
  }
}

// How much of the goal one workout covers, in the goal's own unit.
function workoutAmount(g: TicTacGoGoal, w: WorkoutSample): number {
  return g.kind === 'walk_mi' || g.kind === 'run_mi' ? (w.distanceMi ?? 0) : (w.durationMin ?? 0);
}

export interface TurnActivity {
  // Steps since the turn began (HealthProvider.getStepsSince).
  steps: number;
  // Only workouts that started at or after the turn began.
  workouts: WorkoutSample[];
}

export interface GoalCheck {
  met: boolean;
  // "4,210 of 5,000 steps", "Met by Running at 7:10 AM", "No run yet this turn"…
  status: string;
}

function formatAmount(g: TicTacGoGoal, n: number): string {
  if (g.kind === 'steps') return n.toLocaleString();
  if (g.kind === 'walk_mi' || g.kind === 'run_mi') return `${(Math.floor(n * 10) / 10).toString()} mi`;
  return `${Math.floor(n)} min`;
}

const TYPE_NOUN: Record<GoalKind, string> = {
  steps: 'steps',
  walk_mi: 'walk',
  walk_min: 'walk',
  run_mi: 'run',
  any_min: 'workout',
  strength_min: 'strength workout',
  cardio_min: 'cardio workout',
  yoga_min: 'yoga or stretching session',
  outdoor_min: 'outdoor workout',
};

// One workout has to meet a workout goal on its own — two 10-minute walks
// don't make a 20-minute walk. Step goals are the running total since the
// turn began.
export function checkGoal(g: TicTacGoGoal, activity: TurnActivity): GoalCheck {
  if (g.kind === 'steps') {
    return {
      met: activity.steps >= g.target,
      status: `${activity.steps.toLocaleString()} of ${g.target.toLocaleString()} steps this turn`,
    };
  }

  const candidates = activity.workouts.filter((w) => matchesType(g, w));
  if (candidates.length === 0) return { met: false, status: `No ${TYPE_NOUN[g.kind]} yet this turn` };

  const best = candidates.reduce((a, b) => (workoutAmount(g, b) > workoutAmount(g, a) ? b : a));
  const amount = workoutAmount(g, best);
  const time = best.when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (amount >= g.target) return { met: true, status: `Met by ${best.name} at ${time}` };
  return {
    met: false,
    status: `Best so far: ${formatAmount(g, amount)} of ${formatAmount(g, g.target)}`,
  };
}

// Server stores the winning line 1-based; everything in the app is 0-based.
export function toZeroBasedLine(line: number[] | null): number[] | null {
  return line ? line.map((i) => i - 1) : null;
}

export function turnDeadline(turnStartedAt: string): Date {
  return new Date(new Date(turnStartedAt).getTime() + TICTACGO_TURN_HOURS * 3_600_000);
}

// "18h 20m left", "45m left".
export function formatTimeLeft(deadline: Date, now: number = Date.now()): string {
  const ms = Math.max(0, deadline.getTime() - now);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m left` : `${Math.max(1, minutes)}m left`;
}
