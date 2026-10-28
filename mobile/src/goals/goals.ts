import { classifyWorkout, DEFAULT_BINGO_CARD_TYPE } from '../challenges/bingo';
import type { DailyStepsWithDate, WorkoutSample } from '../health/types';

// A goal (0097_goals.sql): a target for one metric, per day or per week,
// worked out from the phone's own health data.

export type GoalMetric = 'steps' | 'distance_mi' | 'workouts' | 'workout_minutes';
export type GoalPeriod = 'day' | 'week';
export type GoalActivity =
  | 'run'
  | 'walk_hike'
  | 'cycling'
  | 'swim'
  | 'strength'
  | 'yoga_pilates'
  | 'hiit_cardio'
  | 'sports';

export interface Goal {
  id: string;
  metric: GoalMetric;
  period: GoalPeriod;
  target: number;
  activity: GoalActivity | null;
  label: string | null;
  sort: number;
}

export type GoalDraft = Omit<Goal, 'id' | 'sort'>;

export const MAX_GOALS = 8;

export const METRIC_NAMES: Record<GoalMetric, string> = {
  steps: 'Steps',
  distance_mi: 'Distance',
  workouts: 'Workouts',
  workout_minutes: 'Workout minutes',
};

export const ACTIVITY_NAMES: Record<GoalActivity, string> = {
  run: 'Run',
  walk_hike: 'Walk or hike',
  cycling: 'Cycling',
  swim: 'Swim',
  strength: 'Strength',
  yoga_pilates: 'Yoga or Pilates',
  hiit_cardio: 'HIIT or cardio',
  sports: 'Sports',
};

export const ACTIVITIES = Object.keys(ACTIVITY_NAMES) as GoalActivity[];

export function metricTakesActivity(metric: GoalMetric): boolean {
  return metric === 'workouts' || metric === 'workout_minutes';
}

// Whole steps, workouts and minutes; miles to one decimal.
export function roundTarget(metric: GoalMetric, value: number): number {
  if (metric === 'distance_mi') return Math.max(0.5, Math.round(value * 2) / 2);
  if (metric === 'steps') return Math.max(500, Math.round(value / 500) * 500);
  if (metric === 'workout_minutes') return Math.max(5, Math.round(value / 5) * 5);
  return Math.max(1, Math.round(value));
}

export function formatAmount(metric: GoalMetric, value: number): string {
  if (metric === 'distance_mi') return `${(Math.round(value * 10) / 10).toLocaleString()} mi`;
  if (metric === 'steps') return Math.round(value).toLocaleString();
  if (metric === 'workout_minutes') return `${Math.round(value).toLocaleString()} min`;
  const n = Math.round(value);
  return `${n}`;
}

// What one workout of each kind is called in a sentence.
const ACTIVITY_NOUNS: Record<GoalActivity, [string, string]> = {
  run: ['run', 'runs'],
  walk_hike: ['walk', 'walks'],
  cycling: ['ride', 'rides'],
  swim: ['swim', 'swims'],
  strength: ['strength session', 'strength sessions'],
  yoga_pilates: ['yoga session', 'yoga sessions'],
  hiit_cardio: ['cardio session', 'cardio sessions'],
  sports: ['game', 'games'],
};

export function workoutWord(activity: GoalActivity | null, n: number): string {
  const [one, many] = activity ? ACTIVITY_NOUNS[activity] : ['workout', 'workouts'];
  return n === 1 ? one : many;
}

// "10,000 steps a day", "3 runs a week", "150 min of strength a week".
export function describeGoal(goal: Pick<Goal, 'metric' | 'period' | 'target' | 'activity'>): string {
  const per = goal.period === 'day' ? 'a day' : 'a week';
  const t = goal.target;
  switch (goal.metric) {
    case 'steps':
      return `${formatAmount('steps', t)} steps ${per}`;
    case 'distance_mi':
      return `${formatAmount('distance_mi', t)} ${per}`;
    case 'workouts':
      return `${t} ${workoutWord(goal.activity, t)} ${per}`;
    case 'workout_minutes':
      return `${formatAmount('workout_minutes', t)} of ${
        goal.activity ? ACTIVITY_NAMES[goal.activity].toLowerCase() : 'workouts'
      } ${per}`;
  }
}

export function goalTitle(goal: Goal): string {
  return goal.label ?? describeGoal(goal);
}

// ── Periods ──────────────────────────────────────────────────────────

export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Weeks start on Monday, local time.
export function weekStart(now: Date = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mondayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - mondayOffset);
  return d;
}

function periodStart(period: GoalPeriod, now: Date): Date {
  return period === 'day' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : weekStart(now);
}

// ── Progress ─────────────────────────────────────────────────────────

export interface GoalInputs {
  stepsToday: number;
  distanceTodayMi: number;
  // Every day this week so far, today included (getDailyStepsSince).
  // Empty when no goal needs it.
  weekDays: DailyStepsWithDate[];
  workouts: WorkoutSample[];
  now?: Date;
}

export interface GoalProgress {
  goal: Goal;
  value: number;
  done: boolean;
  pct: number; // 0-100
  remaining: number;
  // Weekly goals: whether you're short of where an even pace would put
  // you by today. Daily goals: whether there's anything left today.
  behind: boolean;
  // Weekly goals: days left this week, today included.
  daysLeft: number;
}

export function workoutMatches(w: WorkoutSample, activity: GoalActivity | null): boolean {
  if (!activity) return true;
  return classifyWorkout(w.name, DEFAULT_BINGO_CARD_TYPE) === activity;
}

export function goalValue(goal: Goal, inputs: GoalInputs): number {
  const now = inputs.now ?? new Date();
  const start = periodStart(goal.period, now);
  switch (goal.metric) {
    case 'steps':
      if (goal.period === 'day') return inputs.stepsToday;
      return sumWeek(inputs, now, (d) => d.steps, inputs.stepsToday);
    case 'distance_mi':
      if (goal.period === 'day') return inputs.distanceTodayMi;
      return sumWeek(inputs, now, (d) => d.distanceMi, inputs.distanceTodayMi);
    case 'workouts':
      return inputs.workouts.filter((w) => w.when >= start && w.when <= now && workoutMatches(w, goal.activity)).length;
    case 'workout_minutes':
      return inputs.workouts
        .filter((w) => w.when >= start && w.when <= now && workoutMatches(w, goal.activity))
        .reduce((sum, w) => sum + (w.durationMin ?? 0), 0);
  }
}

// The week's days, with today's own (fresher) snapshot number in place of
// whatever the daily history has for today.
function sumWeek(inputs: GoalInputs, now: Date, pick: (d: DailyStepsWithDate) => number, today: number): number {
  const startKey = localDayKey(weekStart(now));
  const todayKey = localDayKey(now);
  let sum = 0;
  for (const d of inputs.weekDays) {
    if (d.date >= startKey && d.date < todayKey) sum += pick(d);
  }
  return sum + today;
}

// Where an even pace would have you by now, as a percent of the goal:
// the Hound's spot on Today's goal trail. A day runs 7 AM to 10 PM local
// (before 7 the Hound hasn't set off; after 10 it's at the finish), a
// week Monday to Sunday.
const PACE_DAY_START_MIN = 7 * 60;
const PACE_DAY_END_MIN = 22 * 60;

export function pacePct(goal: Goal, now: Date = new Date()): number {
  let fraction: number;
  if (goal.period === 'day') {
    const minutes = now.getHours() * 60 + now.getMinutes();
    fraction = (minutes - PACE_DAY_START_MIN) / (PACE_DAY_END_MIN - PACE_DAY_START_MIN);
  } else {
    fraction = (now.getTime() - weekStart(now).getTime()) / (7 * 86_400_000);
  }
  return Math.max(0, Math.min(1, fraction)) * 100;
}

export function goalProgress(goal: Goal, inputs: GoalInputs): GoalProgress {
  const now = inputs.now ?? new Date();
  const value = goalValue(goal, inputs);
  const done = value >= goal.target;
  const remaining = Math.max(0, goal.target - value);
  const daysIntoWeek = ((now.getDay() + 6) % 7) + 1; // Monday = 1
  const daysLeft = goal.period === 'week' ? 8 - daysIntoWeek : 1;
  // Behind on a weekly goal means short of a whole amount an even pace
  // would have you at by today, so Monday morning with nothing done yet
  // isn't "behind".
  const behind =
    !done && (goal.period === 'day' || value < Math.floor(goal.target * (daysIntoWeek / 7)) || daysLeft === 1);
  return {
    goal,
    value,
    done,
    pct: Math.min(100, (value / goal.target) * 100),
    remaining,
    behind,
    daysLeft,
  };
}

// "3,800 to go", "1 more run this week", "Done".
export function progressLine(p: GoalProgress): string {
  if (p.done) return 'Done';
  const g = p.goal;
  const n = Math.ceil(p.remaining);
  const rest = g.metric === 'workouts' ? `${n} more ${workoutWord(g.activity, n)}` : `${formatAmount(g.metric, p.remaining)} to go`;
  if (g.period === 'day') return rest;
  return p.daysLeft === 1 ? `${rest}, last day` : `${rest} · ${p.daysLeft} days left`;
}

// ── Suggestions from the app's own data ──────────────────────────────

export interface GoalSuggestion {
  // The average over the last four weeks, per day or per week.
  average: number;
  // A little above the average, rounded.
  suggested: number;
}

const SUGGEST_DAYS = 28;

export function suggestTarget(
  metric: GoalMetric,
  period: GoalPeriod,
  activity: GoalActivity | null,
  history: { days: DailyStepsWithDate[]; workouts: WorkoutSample[]; now?: Date },
): GoalSuggestion | null {
  const now = history.now ?? new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - SUGGEST_DAYS);
  const sinceKey = localDayKey(since);
  const todayKey = localDayKey(now);
  let total = 0;
  if (metric === 'steps' || metric === 'distance_mi') {
    const days = history.days.filter((d) => d.date >= sinceKey && d.date < todayKey);
    if (days.length < 7) return null;
    total = days.reduce((s, d) => s + (metric === 'steps' ? d.steps : d.distanceMi), 0);
    const perDay = total / days.length;
    const average = period === 'day' ? perDay : perDay * 7;
    if (average <= 0) return null;
    return { average, suggested: roundTarget(metric, average * 1.1) };
  }
  const recent = history.workouts.filter((w) => w.when >= since && w.when < now && workoutMatches(w, activity));
  if (recent.length === 0) return null;
  total = metric === 'workouts' ? recent.length : recent.reduce((s, w) => s + (w.durationMin ?? 0), 0);
  const perDay = total / SUGGEST_DAYS;
  const average = period === 'day' ? perDay : perDay * 7;
  if (average <= 0) return null;
  const bump = metric === 'workouts' ? average + 0.5 : average * 1.1;
  return { average, suggested: roundTarget(metric, bump) };
}

// Sensible starting targets when there's no history to suggest from.
export function defaultTarget(metric: GoalMetric, period: GoalPeriod): number {
  const perDay: Record<GoalMetric, number> = { steps: 8000, distance_mi: 2, workouts: 1, workout_minutes: 30 };
  if (period === 'day') return perDay[metric];
  return { steps: 50000, distance_mi: 15, workouts: 3, workout_minutes: 150 }[metric];
}

// Whether every daily goal was met on `day` ('YYYY-MM-DD'), from the
// phone's own per-day steps and distance (getDailyStepsSince) and its
// recent workouts. Null when there's no daily goal or no data for that
// day. Built for the catch-up claim (useGoalStreak): a day finished late
// with Hound closed is otherwise never claimed.
export function goalsEarnedOn(goals: Goal[], day: string, days: DailyStepsWithDate[], workouts: WorkoutSample[]): boolean | null {
  const daily = goals.filter((g) => g.period === 'day');
  if (daily.length === 0) return null;
  const row = days.find((d) => d.date === day);
  if (!row) return null;
  const [y, m, d] = day.split('-').map(Number);
  const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999);
  const inputs: GoalInputs = { stepsToday: row.steps, distanceTodayMi: row.distanceMi, weekDays: [], workouts, now: endOfDay };
  return daily.every((g) => goalProgress(g, inputs).done);
}

// ── History ──────────────────────────────────────────────────────────
// Past days and weeks, scored from the phone's own per-day steps and
// distance (getDailyStepsSince) and its recent workouts, the way
// goalsEarnedOn does. Always against the goals as they are now: the
// server keeps no record of what a target was on a given day.

export interface GoalDaySummary {
  day: string; // YYYY-MM-DD
  // Every daily goal as it stood at the end of that day.
  progress: GoalProgress[];
  done: number;
  total: number;
  // False when the phone has no row for that day: before Hound was
  // connected, or further back than Health Connect keeps (about 30 days).
  hasData: boolean;
}

export function dayKeyOffset(base: Date, offsetDays: number): string {
  return localDayKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays));
}

export function endOfDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

export function goalDaySummary(goals: Goal[], day: string, days: DailyStepsWithDate[], workouts: WorkoutSample[]): GoalDaySummary {
  const daily = goals.filter((g) => g.period === 'day');
  const row = days.find((d) => d.date === day);
  if (!row) return { day, progress: [], done: 0, total: daily.length, hasData: false };
  const inputs: GoalInputs = { stepsToday: row.steps, distanceTodayMi: row.distanceMi, weekDays: [], workouts, now: endOfDay(day) };
  const progress = daily.map((g) => goalProgress(g, inputs));
  return { day, progress, done: progress.filter((p) => p.done).length, total: daily.length, hasData: true };
}

// A weekly goal as it stood at the end of the week starting `monday`, or
// as it stands now for the current week (with today's fresher snapshot
// numbers when given).
export function goalWeekProgress(
  goal: Goal,
  monday: Date,
  days: DailyStepsWithDate[],
  workouts: WorkoutSample[],
  live: { stepsToday: number; distanceTodayMi: number } | null,
  now: Date = new Date(),
): GoalProgress {
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 23, 59, 59, 999);
  const current = sunday >= now;
  const asOf = current ? now : sunday;
  const lastRow = days.find((d) => d.date === localDayKey(asOf));
  const today = current && live ? live : { stepsToday: lastRow?.steps ?? 0, distanceTodayMi: lastRow?.distanceMi ?? 0 };
  return goalProgress(goal, { ...today, weekDays: days, workouts, now: asOf });
}

// "Done", "1,200 over", "800 short": how a finished day's goal ended.
export function pastLine(p: GoalProgress): string {
  const g = p.goal;
  const amount = (n: number) => (g.metric === 'workouts' ? `${Math.round(n)} ${workoutWord(g.activity, Math.round(n))}` : formatAmount(g.metric, n));
  if (p.done) {
    const over = p.value - g.target;
    return over > 0 ? `${amount(over)} over` : 'Done';
  }
  return `${amount(p.remaining)} short`;
}

// "Saturday, Oct 25".
export function describeDay(day: string): string {
  return endOfDay(day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
