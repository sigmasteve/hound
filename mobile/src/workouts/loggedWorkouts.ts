import { supabase } from '../lib/supabase';
import type { HealthProvider, WorkoutSample } from '../health/types';

// Workouts logged by hand (0204_logged_workouts.sql), for people without a
// watch: up to 2 a day, 5 to 90 minutes, today or yesterday. On the server
// a logged workout is a workout_history row with source 'manual' whose
// duration_min is worth half (so the sports games, Golf power and prize
// Globals count half) and whose logged_min is what was entered. On the
// phone, where goals, Bingo, 75 Day and the rest count workouts from
// Health, they're merged in at their full minutes (withLoggedWorkouts).
// Never a distance or a heart rate.

export type LoggedType =
  | 'strength'
  | 'walk'
  | 'run'
  | 'cycle'
  | 'yoga'
  | 'hiit'
  | 'basketball'
  | 'soccer'
  | 'golf'
  | 'tennis'
  | 'swim'
  | 'other';

// The chips, in the sheet's order, and the name the server writes for each
// (so the games' own name patterns know a strength workout or a game day).
export const LOGGED_TYPES: { id: LoggedType; label: string; name: string }[] = [
  { id: 'strength', label: 'Strength', name: 'Traditional Strength Training' },
  { id: 'walk', label: 'Walk', name: 'Walking' },
  { id: 'run', label: 'Run', name: 'Running' },
  { id: 'cycle', label: 'Cycling', name: 'Cycling' },
  { id: 'yoga', label: 'Yoga', name: 'Yoga' },
  { id: 'hiit', label: 'HIIT', name: 'High Intensity Interval Training' },
  { id: 'basketball', label: 'Basketball', name: 'Basketball' },
  { id: 'soccer', label: 'Soccer', name: 'Soccer' },
  { id: 'golf', label: 'Golf', name: 'Golf' },
  { id: 'tennis', label: 'Tennis', name: 'Tennis' },
  { id: 'swim', label: 'Swim', name: 'Swimming' },
  { id: 'other', label: 'Other', name: 'Other' },
];

export const MANUAL_SOURCE = 'manual';

export function loggedTypeLabel(type: string): string {
  return LOGGED_TYPES.find((t) => t.id === type)?.label ?? 'Workout';
}

// A workout the phone shows as logged by hand.
export function isLoggedWorkout(w: Pick<WorkoutSample, 'source'>): boolean {
  return w.source === MANUAL_SOURCE;
}

function client() {
  if (!supabase) throw new Error('Not connected to Hound.');
  return supabase;
}

const num = (v: unknown) => Number(v ?? 0);

export interface LoggedWorkout {
  sourceId: string;
  type: LoggedType;
  name: string;
  minutes: number;
  // What it's worth in the games and prizes (half, by default).
  countsAs: number;
  startedAt: Date;
  endedAt: Date;
  localDay: string;
  // Until when it can still be undone; null once it stands.
  undoUntil: Date | null;
  undone: boolean;
  replaced: boolean;
}

export interface MyLoggedWorkouts {
  enabled: boolean;
  blocked: boolean;
  // Days until a new account can log; 0 when it can.
  opensInDays: number;
  perDay: number;
  minMin: number;
  maxMin: number;
  // 1: today or yesterday; 0: today only.
  backDays: number;
  // What a logged minute is worth in the games and prizes, as a percent.
  valuePct: number;
  // How long a log can be undone, in minutes.
  undoMinutes: number;
  leftToday: number;
  leftYesterday: number;
  logs: LoggedWorkout[];
}

function toLogged(r: any): LoggedWorkout {
  return {
    sourceId: String(r.source_id),
    type: (r.type ?? 'other') as LoggedType,
    name: r.name ?? 'Workout',
    minutes: num(r.minutes),
    countsAs: num(r.counts_as),
    startedAt: new Date(r.started_at),
    endedAt: new Date(r.ended_at),
    localDay: String(r.local_day ?? ''),
    undoUntil: r.undo_until ? new Date(r.undo_until) : null,
    undone: !!r.undone,
    replaced: !!r.replaced,
  };
}

export async function getMyLoggedWorkouts(): Promise<MyLoggedWorkouts> {
  const { data, error } = await client().rpc('my_logged_workouts');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  return {
    enabled: d.enabled !== false,
    blocked: !!d.blocked,
    opensInDays: num(d.opens_in_days),
    perDay: num(d.per_day) || 2,
    minMin: num(d.min_min) || 5,
    maxMin: num(d.max_min) || 90,
    backDays: d.back_days == null ? 1 : num(d.back_days),
    valuePct: d.value_pct == null ? 50 : num(d.value_pct),
    undoMinutes: d.undo_minutes == null ? 15 : num(d.undo_minutes),
    leftToday: num(d.left_today),
    leftYesterday: num(d.left_yesterday),
    logs: ((d.logs ?? []) as any[]).map(toLogged),
  };
}

export interface LogResult {
  sourceId: string;
  type: LoggedType;
  name: string;
  minutes: number;
  countsAs: number;
  startedAt: Date;
  endedAt: Date;
  localDay: string;
  leftToday: number;
  undoUntil: Date | null;
}

// Throws the server's sentence ("That's 2 logged today. More tomorrow.").
export async function logWorkout(input: { type: LoggedType; minutes: number; endedAt: Date; phoneSteps: number | null }): Promise<LogResult> {
  const { data, error } = await client().rpc('log_workout', {
    p_type: input.type,
    p_minutes: input.minutes,
    p_ended_at: input.endedAt.toISOString(),
    p_phone_steps: input.phoneSteps,
  });
  if (error) throw new Error(error.message);
  invalidateLoggedSamples();
  const r = (data ?? {}) as any;
  return {
    sourceId: String(r.source_id),
    type: (r.type ?? input.type) as LoggedType,
    name: r.name ?? '',
    minutes: num(r.minutes) || input.minutes,
    countsAs: num(r.counts_as),
    startedAt: new Date(r.started_at),
    endedAt: new Date(r.ended_at),
    localDay: String(r.local_day ?? ''),
    leftToday: num(r.left_today),
    undoUntil: r.undo_until ? new Date(r.undo_until) : null,
  };
}

export async function undoLoggedWorkout(sourceId: string): Promise<void> {
  const { error } = await client().rpc('undo_logged_workout', { p_source_id: sourceId });
  if (error) throw new Error(error.message);
  invalidateLoggedSamples();
}

// The phone's steps over a workout's time, when Health can read a window
// (sent with a walk or run so Admin can spot one with almost no steps).
export async function phoneStepsBetween(health: HealthProvider, start: Date, end: Date): Promise<number | null> {
  if (!health.getStepBuckets || health.platform === 'mock') return null;
  try {
    const buckets = await health.getStepBuckets(start, end);
    return Math.round(buckets.reduce((s, b) => s + (b.steps || 0), 0));
  } catch {
    return null;
  }
}

// ── Merging into the phone's workouts ──

// Logged workouts (not undone, not replaced) as the phone's workouts, at
// their full minutes. Read straight from workout_history (your own rows,
// which you can always read), so goals' four-week history sees older ones
// too. Cached for a minute; logging or undoing clears it.
let cache: { at: number; rows: Promise<WorkoutSample[]> } | null = null;

export function invalidateLoggedSamples(): void {
  cache = null;
}

async function readLoggedSamples(): Promise<WorkoutSample[]> {
  if (!supabase) return [];
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) return [];
  const { data, error } = await supabase
    .from('workout_history')
    .select('source_id, name, occurred_at, logged_min, duration_min')
    .eq('source', MANUAL_SOURCE)
    .order('occurred_at', { ascending: false })
    .limit(300);
  if (error || !data) return [];
  return (data as any[]).map((r) => ({
    id: String(r.source_id),
    name: String(r.name ?? 'Workout'),
    when: new Date(r.occurred_at),
    source: MANUAL_SOURCE,
    durationMin: num(r.logged_min ?? r.duration_min) || undefined,
  }));
}

export function loggedSamples(): Promise<WorkoutSample[]> {
  if (!cache || Date.now() - cache.at > 60_000) {
    cache = { at: Date.now(), rows: readLoggedSamples().catch(() => []) };
  }
  return cache.rows;
}

const endOf = (w: WorkoutSample) => w.when.getTime() + (w.durationMin ?? 0) * 60_000;

// The phone's workouts plus the logged ones, newest first. A logged one
// that overlaps a workout from Health is left out (the server replaces it
// with the real one once that syncs).
export function mergeLogged(device: WorkoutSample[], logged: WorkoutSample[], limit: number): WorkoutSample[] {
  const real = device.filter((w) => !isLoggedWorkout(w));
  const kept = logged.filter(
    (l) => !real.some((d) => l.when.getTime() < Math.max(endOf(d), d.when.getTime() + 60_000) && d.when.getTime() < endOf(l)),
  );
  return [...real, ...kept].sort((a, b) => b.when.getTime() - a.when.getTime()).slice(0, limit);
}

// Wraps a Health provider so every read of recent workouts includes the
// logged ones. Applied once, where the provider is resolved
// (health/index.ts), so every screen and the background sync see the same
// list.
export function withLoggedWorkouts(provider: HealthProvider): HealthProvider {
  const read = provider.getRecentWorkouts.bind(provider);
  const wrapped: HealthProvider = Object.create(provider);
  wrapped.getRecentWorkouts = async (limit: number) => {
    const [device, logged] = await Promise.all([read(limit), loggedSamples()]);
    return mergeLogged(device, logged, limit);
  };
  return wrapped;
}

// ── Admin ──

export interface WorkoutLogConfig {
  enabled: boolean;
  per_day: number;
  min_min: number;
  max_min: number;
  back_days: number;
  value_pct: number;
  new_account_days: number;
  undo_minutes: number;
}

export interface WorkoutLogOverview {
  config: WorkoutLogConfig;
  people7d: number;
  logs7d: number;
  minutes7d: number;
  share7d: number;
  undone7d: number;
  replaced7d: number;
  byType: Record<string, number>;
  flagged: { userId: string; name: string; why: string; blocked: boolean }[];
  blocked: { userId: string; name: string }[];
}

export async function getWorkoutLogOverview(): Promise<WorkoutLogOverview> {
  const { data, error } = await client().rpc('admin_workout_log_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const c = d.config ?? {};
  return {
    config: {
      enabled: c.enabled !== false,
      per_day: num(c.per_day),
      min_min: num(c.min_min),
      max_min: num(c.max_min),
      back_days: num(c.back_days),
      value_pct: num(c.value_pct),
      new_account_days: num(c.new_account_days),
      undo_minutes: num(c.undo_minutes),
    },
    people7d: num(d.people_7d),
    logs7d: num(d.logs_7d),
    minutes7d: num(d.minutes_7d),
    share7d: Number(d.share_7d ?? 0),
    undone7d: num(d.undone_7d),
    replaced7d: num(d.replaced_7d),
    byType: Object.fromEntries(Object.entries((d.by_type ?? {}) as Record<string, unknown>).map(([k, v]) => [k, num(v)])),
    flagged: ((d.flagged ?? []) as any[]).map((f) => ({ userId: f.user_id, name: f.name ?? 'Someone', why: f.why ?? '', blocked: !!f.blocked })),
    blocked: ((d.blocked ?? []) as any[]).map((b) => ({ userId: b.user_id, name: b.name ?? 'Someone' })),
  };
}

export async function setWorkoutLogConfig(patch: Partial<WorkoutLogConfig>): Promise<void> {
  const { error } = await client().rpc('admin_set_workout_log_config', { p: patch });
  if (error) throw new Error(error.message);
}

export async function blockWorkoutLogging(userId: string, block: boolean): Promise<void> {
  const { error } = await client().rpc('admin_block_workout_logging', { p_user: userId, p_block: block });
  if (error) throw new Error(error.message);
}

// Admin → Overview's fold line: "38 logging · 9% of workouts this week".
export function workoutLogSummary(o: WorkoutLogOverview): string {
  if (!o.config.enabled) return 'Logging is paused';
  if (o.logs7d === 0) return 'No one has logged one this week';
  return `${o.people7d} logging · ${Math.round(o.share7d * 100)}% of workouts this week`;
}
