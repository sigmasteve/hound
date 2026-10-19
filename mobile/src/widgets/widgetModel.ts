import { formatAmount, goalTitle, localDayKey, weekStart, type GoalMetric, type GoalProgress } from '../goals/goals';
import type { Kennel } from '../kennel/kennelApi';

// The home screen widgets (from 0.11.0): your hound and today's goals,
// and on iPhone, steps on the Lock Screen. A widget can't read health data
// or call Hound itself, so the app hands it everything ready to show:
// whenever Today has fresh numbers, and from background sync while Hound
// is closed. The layouts are in ios/ and android/.

export interface WidgetGoal {
  title: string;
  metric: GoalMetric;
  // "8,432" and "10,000": the widget only shows text.
  value: string;
  target: string;
  pct: number; // 0-100
  done: boolean;
  daily: boolean;
}

export interface WidgetData {
  // False until the app has saved anything: the widget says to open Hound.
  ready: boolean;
  houndName: string;
  // "Biscuit is happy"
  moodLine: string;
  // Your hound as a picture (WidgetHound): a file on iPhone, data on
  // Android. Null shows the paw.
  houndImage: string | null;
  steps: number;
  stepsText: string;
  // Today's steps goal, when there is a daily one.
  stepsGoal: number | null;
  stepsGoalText: string | null;
  stepsPct: number; // 0-100
  goals: WidgetGoal[];
  done: number;
  total: number;
  streak: number;
  // Which day and week the numbers are for (local), so a widget still
  // showing yesterday's resets at midnight (forNow).
  dayKey: string;
  weekKey: string;
}

export const EMPTY_WIDGET_DATA: WidgetData = {
  ready: false,
  houndName: 'Your hound',
  moodLine: 'Open Hound to set this up',
  houndImage: null,
  steps: 0,
  stepsText: '0',
  stepsGoal: null,
  stepsGoalText: null,
  stepsPct: 0,
  goals: [],
  done: 0,
  total: 0,
  streak: 0,
  dayKey: '',
  weekKey: '',
};

const MOOD_WORD: Record<Kennel['mood'], string> = {
  happy: 'happy',
  okay: 'doing okay',
  hungry: 'hungry',
  sleepy: 'sleepy',
};

// The numbers from today's goal progress (the same GoalProgress Today
// and background sync work out).
export function numbersFromProgress(progress: GoalProgress[], stepsToday: number, now: Date = new Date()) {
  const stepsGoal = progress.find((p) => p.goal.metric === 'steps' && p.goal.period === 'day')?.goal.target ?? null;
  const goals: WidgetGoal[] = progress.map((p) => ({
    title: goalTitle(p.goal),
    metric: p.goal.metric,
    value: formatAmount(p.goal.metric, p.value),
    target: formatAmount(p.goal.metric, p.goal.target),
    pct: Math.min(100, Math.round(p.pct)),
    done: p.done,
    daily: p.goal.period === 'day',
  }));
  return {
    steps: stepsToday,
    stepsText: stepsToday.toLocaleString('en-US'),
    stepsGoal,
    stepsGoalText: stepsGoal === null ? null : stepsGoal.toLocaleString('en-US'),
    stepsPct: stepsGoal ? Math.min(100, Math.round((stepsToday / stepsGoal) * 100)) : 0,
    goals,
    done: goals.filter((g) => g.done).length,
    total: goals.length,
    dayKey: localDayKey(now),
    weekKey: localDayKey(weekStart(now)),
  };
}

export function houndFields(kennel: Kennel) {
  return { houndName: kennel.name, moodLine: `${kennel.name} is ${MOOD_WORD[kennel.mood]}` };
}

// What the widget should show at `now`: on a new day, daily goals (and
// steps) start again from zero, and on a new week, weekly goals too.
export function forNow(data: WidgetData, now: Date = new Date()): WidgetData {
  if (!data.ready) return data;
  const newDay = data.dayKey !== localDayKey(now);
  const newWeek = data.weekKey !== localDayKey(weekStart(now));
  if (!newDay && !newWeek) return data;
  const goals = data.goals.map((g) =>
    (g.daily && newDay) || (!g.daily && newWeek) ? { ...g, value: '0', pct: 0, done: false } : g,
  );
  return {
    ...data,
    steps: newDay ? 0 : data.steps,
    stepsText: newDay ? '0' : data.stepsText,
    stepsPct: newDay ? 0 : data.stepsPct,
    goals,
    done: goals.filter((g) => g.done).length,
  };
}
