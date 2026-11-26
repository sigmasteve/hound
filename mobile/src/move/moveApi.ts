import { supabase } from '../lib/supabase';
import { localDayKey } from '../fasting/fasting';
import { invalidateLoggedSamples } from '../workouts/loggedWorkouts';
import { cachedRead } from '../offline/cache';
import { enqueue, type OutboxItem } from '../offline/outbox';

// The client half of Move points (0270_move_points.sql). The server keeps
// the rates, times Hound's sessions, caps what's logged by hand and adds
// the points to Move points challenges; the phone only asks.

function client() {
  if (!supabase) throw new Error('Not connected to Hound.');
  return supabase;
}

async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);

export interface MoveItem {
  sourceId: string;
  name: string;
  activity: string;
  // 'device' (a watch or Health), 'hand' (logged by hand), 'hound' (timed
  // in Hound), 'covered' (timed in Hound, but a watch workout covers it).
  kind: 'device' | 'hand' | 'hound' | 'covered';
  occurredAt: string;
  minutes: number;
  countedMin: number;
  rate: number;
  pts: number;
  prs: number;
  ref: string | null;
}

export interface StrengthWeek {
  monday: string;
  days: number;
}

export interface StrengthGoal {
  target: number;
  thisWeek: number;
  streak: number;
  weeks: StrengthWeek[];
  // Whether you've set a goal yourself (else it's the starting 2).
  set: boolean;
}

export interface MyMove {
  pts: number;
  handCapMin: number;
  handMin: number;
  items: MoveItem[];
  strength: StrengthGoal;
}

function strength(d: any): StrengthGoal {
  return {
    target: num(d?.target) || 2,
    thisWeek: num(d?.this_week),
    streak: num(d?.streak),
    weeks: (d?.weeks ?? []).map((w: any) => ({ monday: String(w.monday), days: num(w.days) })),
    set: !!d?.set,
  };
}

// Nothing yet: for opening Move offline with no copy kept (0271).
export function emptyMove(): MyMove {
  return { pts: 0, handCapMin: 120, handMin: 0, items: [], strength: { target: 2, thisWeek: 0, streak: 0, weeks: [], set: false } };
}

// Null before 0270 is run.
export async function getMyMove(now = new Date()): Promise<MyMove | null> {
  try {
    // A kept copy when offline (0271).
    const d = await cachedRead('move:my', () => rpc<any>('my_move', { p_local_date: localDayKey(now) }));
    return {
      pts: num(d?.pts),
      handCapMin: num(d?.hand_cap_min) || 120,
      handMin: num(d?.hand_min),
      items: (d?.items ?? []).map((i: any) => ({
        sourceId: String(i.source_id),
        name: String(i.name ?? 'Workout'),
        activity: String(i.activity ?? 'other'),
        kind: i.kind,
        occurredAt: String(i.occurred_at),
        minutes: num(i.minutes),
        countedMin: num(i.counted_min),
        rate: num(i.rate),
        pts: num(i.pts),
        prs: num(i.prs),
        ref: i.ref ?? null,
      })),
      strength: strength(d?.strength),
    };
  } catch (e) {
    if (e instanceof Error && /my_move/.test(e.message)) return null;
    throw e;
  }
}

export async function startMoveSession(kind: 'routine' | 'strength', ref: string): Promise<{ id: string; startedAt: string }> {
  const d = await rpc<any>('move_session_start', { p_kind: kind, p_ref: ref });
  return { id: String(d.id), startedAt: String(d.started_at) };
}

export async function cancelMoveSession(id: string): Promise<void> {
  await rpc('move_session_cancel', { p_id: id });
}

export interface LoggedSet {
  exercise: string;
  setNo: number;
  weightLb: number | null;
  reps: number;
}

export interface MovePR {
  exercise: string;
  weightLb: number | null;
  reps: number;
  prevWeightLb: number | null;
  prevReps: number | null;
}

export interface MoveFinish {
  minutes: number;
  pts: number;
  activity: string;
  prs: MovePR[];
  today: number;
  strength: StrengthGoal;
}

export async function finishMoveSession(id: string, minutes: number, hard: boolean, sets: LoggedSet[] | null, now = new Date()): Promise<MoveFinish> {
  const d = await rpc<any>('move_session_finish', {
    p_id: id,
    p_minutes: minutes,
    p_hard: hard,
    p_sets: sets ? sets.map((s) => ({ exercise: s.exercise, set_no: s.setNo, weight_lb: s.weightLb, reps: s.reps })) : null,
    p_local_date: localDayKey(now),
  });
  // So Goals and today's workouts pick it up.
  invalidateLoggedSamples();
  return {
    minutes: num(d?.minutes),
    pts: num(d?.pts),
    activity: String(d?.activity ?? 'strength_light'),
    prs: (d?.prs ?? []).map((p: any) => ({
      exercise: String(p.exercise),
      weightLb: p.weight_lb === null || p.weight_lb === undefined ? null : num(p.weight_lb),
      reps: num(p.reps),
      prevWeightLb: p.prev_weight_lb === null || p.prev_weight_lb === undefined ? null : num(p.prev_weight_lb),
      prevReps: p.prev_reps === null || p.prev_reps === undefined ? null : num(p.prev_reps),
    })),
    today: num(d?.today),
    strength: strength(d?.strength),
  };
}

export async function setStrengthTarget(target: number, now = new Date()): Promise<StrengthGoal> {
  return strength(await rpc<any>('move_set_strength_target', { p_target: target, p_local_date: localDayKey(now) }));
}

export interface ExerciseHistory {
  exercise: string;
  lastWeightLb: number | null;
  lastReps: number | null;
  bestWeightLb: number | null;
}

export async function getExerciseHistory(): Promise<Record<string, ExerciseHistory>> {
  const d = (await cachedRead('move:exercises', () => rpc<any>('move_exercise_history'))) ?? {};
  const out: Record<string, ExerciseHistory> = {};
  for (const [k, v] of Object.entries<any>(d)) {
    out[k] = {
      exercise: String(v.exercise),
      lastWeightLb: v.last_weight_lb === null ? null : num(v.last_weight_lb),
      lastReps: v.last_reps === null ? null : num(v.last_reps),
      bestWeightLb: v.best_weight_lb === null ? null : num(v.best_weight_lb),
    };
  }
  return out;
}

// ── Rates and Admin ──

export interface MoveRate {
  activity: string;
  label: string;
  perMin: number;
  sort: number;
}

export async function getMoveRates(): Promise<{ rates: MoveRate[]; handCapMin: number }> {
  return cachedRead('move:rates', async () => {
    const [r, c] = await Promise.all([
      client().from('move_rates').select('activity, label, per_min, sort').order('sort'),
      client().from('move_config').select('hand_cap_min').eq('id', true).single(),
    ]);
    if (r.error) throw new Error(r.error.message);
    return {
      rates: (r.data ?? []).map((x: any) => ({ activity: x.activity, label: x.label, perMin: num(x.per_min), sort: num(x.sort) })),
      handCapMin: num(c.data?.hand_cap_min) || 120,
    };
  });
}

export async function setMoveConfig(p: { rates?: Record<string, number>; handCapMin?: number }): Promise<void> {
  await rpc('admin_set_move_config', {
    p: { ...(p.rates ? { rates: p.rates } : {}), ...(p.handCapMin !== undefined ? { hand_cap_min: p.handCapMin } : {}) },
  });
}

export interface MoveOverview {
  timedPeople: number;
  timedPeople7d: number;
  routines7d: number;
  strengthLogs7d: number;
  topRoutines: { ref: string; n: number }[];
  prs7d: number;
  peopleWithActivity7d: number;
  minutes7d: { device: number; hand: number; hound: number };
  byActivity7d: Record<string, number>;
  goals: Record<string, number>;
  moveChallengesLive: number;
  moveChallenges: number;
  handCapMin: number;
}

export async function getMoveOverview(): Promise<MoveOverview> {
  const d = await rpc<any>('admin_move_overview');
  return {
    timedPeople: num(d?.timed_people),
    timedPeople7d: num(d?.timed_people_7d),
    routines7d: num(d?.routines_7d),
    strengthLogs7d: num(d?.strength_logs_7d),
    topRoutines: (d?.top_routines ?? []).map((x: any) => ({ ref: String(x.ref), n: num(x.n) })),
    prs7d: num(d?.prs_7d),
    peopleWithActivity7d: num(d?.people_with_activity_7d),
    minutes7d: { device: num(d?.minutes_7d?.device), hand: num(d?.minutes_7d?.hand), hound: num(d?.minutes_7d?.hound) },
    byActivity7d: d?.by_activity_7d ?? {},
    goals: d?.goals ?? {},
    moveChallengesLive: num(d?.move_challenges_live),
    moveChallenges: num(d?.move_challenges),
    handCapMin: num(d?.hand_cap_min),
  };
}

// Whether a challenge counts Move points (0270), read on its own so the
// shared challenge reads still work before 0270 is run.
const countsCache = new Map<string, Promise<'steps' | 'move'>>();
export function challengeCounts(challengeId: string): Promise<'steps' | 'move'> {
  let p = countsCache.get(challengeId);
  if (!p) {
    p = Promise.resolve(client().from('challenges').select('counts').eq('id', challengeId).maybeSingle()).then(({ data, error }) =>
      !error && (data as any)?.counts === 'move' ? 'move' : 'steps',
    );
    countsCache.set(challengeId, p);
  }
  return p;
}

// A routine or strength log timed on the phone while Hound's server
// couldn't be reached (0271): waits in the outbox and syncs later, checked
// by move_offline_session when it arrives.
export function saveSessionOffline(s: {
  kind: 'routine' | 'strength';
  ref: string;
  startedAt: Date;
  endedAt: Date;
  minutes: number;
  hard: boolean;
  sets: LoggedSet[] | null;
  label: string;
}): Promise<OutboxItem> {
  return enqueue(
    'move_offline_session',
    {
      kind: s.kind,
      ref: s.ref,
      started_at: s.startedAt.toISOString(),
      ended_at: s.endedAt.toISOString(),
      minutes: s.minutes,
      hard: s.hard,
      sets: s.sets ? s.sets.map((x) => ({ exercise: x.exercise, set_no: x.setNo, weight_lb: x.weightLb, reps: x.reps })) : null,
      local_date: localDayKey(s.endedAt),
    },
    s.label,
  );
}

// ── Movement snacks (0275) ──

export type SnackWindow = 'morning' | 'midday' | 'afternoon' | 'evening';

export const SNACK_WINDOWS: { id: SnackWindow; label: string; from: number; to: number }[] = [
  { id: 'morning', label: 'Morning', from: 9, to: 11 },
  { id: 'midday', label: 'Midday', from: 12, to: 14 },
  { id: 'afternoon', label: 'Afternoon', from: 15, to: 17 },
  { id: 'evening', label: 'Evening', from: 18, to: 20 },
];

export interface Snack {
  id: string;
  startedAt: string;
  expiresAt: string;
  steps: number;
  minutes: number;
}

export interface SnackToday {
  done: number;
  paid: number;
  bones: number;
  open: Snack | null;
}

export interface MySnacks {
  enabled: boolean;
  windows: SnackWindow[];
  steps: number;
  minutes: number;
  bones: number;
  maxDay: number;
  today: SnackToday;
}

function snack(d: any): Snack | null {
  if (!d?.id) return null;
  return { id: String(d.id), startedAt: String(d.started_at), expiresAt: String(d.expires_at), steps: num(d.steps), minutes: num(d.minutes) };
}

function snackToday(d: any): SnackToday {
  return { done: num(d?.done), paid: num(d?.paid), bones: num(d?.bones), open: snack(d?.open) };
}

// Null before 0275 is run.
export async function getMySnacks(now = new Date()): Promise<MySnacks | null> {
  try {
    const d = await rpc<any>('my_move_snacks', { p_local_date: localDayKey(now) });
    return {
      enabled: !!d?.enabled,
      windows: (d?.windows ?? []) as SnackWindow[],
      steps: num(d?.steps) || 250,
      minutes: num(d?.minutes) || 10,
      bones: num(d?.bones),
      maxDay: num(d?.max_day),
      today: snackToday(d?.today),
    };
  } catch (e) {
    if (e instanceof Error && /my_move_snacks/.test(e.message)) return null;
    throw e;
  }
}

export async function setSnackSettings(enabled: boolean, windows: SnackWindow[]): Promise<void> {
  await rpc('move_snack_settings', { p_enabled: enabled, p_windows: windows });
}

export async function startSnack(source: 'nudge' | 'self', now = new Date()): Promise<{ snack: Snack; today: SnackToday }> {
  const d = await rpc<any>('move_snack_start', { p_local_date: localDayKey(now), p_source: source });
  return { snack: snack(d)!, today: snackToday(d?.today) };
}

export async function finishSnack(id: string, steps: number): Promise<{ bones: number; today: SnackToday }> {
  const d = await rpc<any>('move_snack_finish', { p_id: id, p_steps: Math.round(steps) });
  return { bones: num(d?.bones), today: snackToday(d?.today) };
}

// ── Move together (0275) ──

export interface PackPerson {
  id: string;
  name: string;
  initials: string;
  iconId: string | null;
  frameId: string | null;
  backgroundId: string | null;
}

function person(p: any): PackPerson {
  return {
    id: String(p?.id ?? ''),
    name: String(p?.name ?? 'Someone'),
    initials: String(p?.initials ?? '?'),
    iconId: p?.icon_id ?? null,
    frameId: p?.frame_id ?? null,
    backgroundId: p?.background_id ?? null,
  };
}

// invited: not in yet; waiting: in, not started; going: doing it; done;
// out: joined but didn't start in the hour, or stopped part way.
export type PackState = 'invited' | 'waiting' | 'going' | 'done' | 'out';

export interface MovePackMember {
  person: PackPerson;
  me: boolean;
  state: PackState;
  startedAt: string | null;
  finishedAt: string | null;
  bones: number;
}

export interface MovePack {
  id: string;
  routineRef: string;
  routineName: string;
  minutes: number;
  createdBy: string;
  joinUntil: string;
  bonus: number;
  members: MovePackMember[];
}

export async function startMovePack(routineRef: string, routineName: string, minutes: number, invite: string[]): Promise<string> {
  return String(await rpc('move_pack_start', { p_routine: routineRef, p_name: routineName, p_minutes: minutes, p_invite: invite }));
}

export async function joinMovePack(packId: string): Promise<void> {
  await rpc('move_pack_join', { p_pack: packId });
}

export async function declineMovePack(packId: string): Promise<void> {
  await rpc('move_pack_decline', { p_pack: packId });
}

export async function movePackBegan(packId: string, sessionId: string): Promise<void> {
  await rpc('move_pack_began', { p_pack: packId, p_session: sessionId });
}

export async function movePackDone(packId: string): Promise<number> {
  const d = await rpc<any>('move_pack_done', { p_pack: packId });
  return num(d?.bones);
}

export async function getMovePack(packId: string): Promise<MovePack> {
  const d = await rpc<any>('move_pack', { p_pack: packId });
  return {
    id: String(d.id),
    routineRef: String(d.routine_ref),
    routineName: String(d.routine_name),
    minutes: num(d.minutes),
    createdBy: String(d.created_by),
    joinUntil: String(d.join_until),
    bonus: num(d.bonus),
    members: (d.members ?? []).map((m: any) => ({
      person: person(m.person),
      me: !!m.me,
      state: m.state as PackState,
      startedAt: m.started_at ?? null,
      finishedAt: m.finished_at ?? null,
      bones: num(m.bones),
    })),
  };
}

export interface MovePackInvite {
  packId: string;
  routineName: string;
  routineRef: string;
  from: PackPerson;
  joinUntil: string;
  joined: number;
}

// Empty before 0275 is run.
export async function getMovePackWaiting(): Promise<MovePackInvite[]> {
  try {
    const d = await rpc<any>('move_pack_waiting');
    return (d ?? []).map((x: any) => ({
      packId: String(x.pack_id),
      routineName: String(x.routine_name),
      routineRef: String(x.routine_ref),
      from: person(x.from),
      joinUntil: String(x.join_until),
      joined: num(x.joined),
    }));
  } catch {
    return [];
  }
}

// ── Admin (0275) ──

export interface MoveSocialOverview {
  config: { snackSteps: number; snackMinutes: number; snackBones: number; snackMaxDay: number; togetherBones: number };
  snacksOn: number;
  snackWindows: Record<string, number>;
  snacksTried: number;
  snacks7d: number;
  snacksDone7d: number;
  snacksNudge7d: number;
  snackPeople7d: number;
  snackBones7d: number;
  packs7d: number;
  packsPaid7d: number;
  packPeople7d: number;
  packTried: number;
  packBones7d: number;
  packRoutines7d: Record<string, number>;
}

export async function getMoveSocialOverview(): Promise<MoveSocialOverview> {
  const d = await rpc<any>('admin_move_social_overview');
  const c = d?.config ?? {};
  return {
    config: {
      snackSteps: num(c.snack_steps),
      snackMinutes: num(c.snack_minutes),
      snackBones: num(c.snack_bones),
      snackMaxDay: num(c.snack_max_day),
      togetherBones: num(c.together_bones),
    },
    snacksOn: num(d?.snacks_on),
    snackWindows: d?.snack_windows ?? {},
    snacksTried: num(d?.snacks_tried),
    snacks7d: num(d?.snacks_7d),
    snacksDone7d: num(d?.snacks_done_7d),
    snacksNudge7d: num(d?.snacks_nudge_7d),
    snackPeople7d: num(d?.snack_people_7d),
    snackBones7d: num(d?.snack_bones_7d),
    packs7d: num(d?.packs_7d),
    packsPaid7d: num(d?.packs_paid_7d),
    packPeople7d: num(d?.pack_people_7d),
    packTried: num(d?.pack_tried),
    packBones7d: num(d?.pack_bones_7d),
    packRoutines7d: d?.pack_routines_7d ?? {},
  };
}

export async function setMoveSocialConfig(p: Partial<Record<'snack_steps' | 'snack_minutes' | 'snack_bones' | 'snack_max_day' | 'together_bones', number>>): Promise<void> {
  await rpc('admin_set_move_social_config', { p });
}
