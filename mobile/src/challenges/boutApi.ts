import { supabase } from '../lib/supabase';

// Hound Bout (0224_bout_kind.sql, 0225_bout.sql): boxing, one on one, a
// round a day. Each 1,000 steps today is an action (up to 20, plus 2 after
// a cardio workout): throw a punch or slip one. A punch is timed on a
// meter (jab 1, hook 2, uppercut 3; the green narrows with the points)
// and meets the other's guard (high stops hooks, body stops uppercuts,
// counter catches jabs and hits back); a perfect one gets through
// anything. What gets through waits as "incoming" for the other to slip
// until the round's scored the next morning: points landed win the round
// 10-9, three power punches in a row put them down (two after a strength
// workout), three down in a round or four in the fight is a KO. The
// server decides everything.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);

export type BoutPunchKind = 'jab' | 'hook' | 'up';
export type BoutGuard = 'high' | 'body' | 'counter';
export type BoutQuality = 'perfect' | 'clean' | 'miss';

export const PUNCHES: { id: BoutPunchKind; name: string; points: number }[] = [
  { id: 'jab', name: 'Jab', points: 1 },
  { id: 'hook', name: 'Hook', points: 2 },
  { id: 'up', name: 'Uppercut', points: 3 },
];
export const punchName = (p: BoutPunchKind) => PUNCHES.find((x) => x.id === p)?.name ?? 'Punch';

export const GUARDS: { id: BoutGuard; name: string; line: string }[] = [
  { id: 'high', name: 'High', line: 'Blocks hooks to the head. Uppercuts come up underneath it.' },
  { id: 'body', name: 'Body', line: 'Blocks uppercuts. Hooks get round it.' },
  { id: 'counter', name: 'Counter', line: 'Catches jabs and hits back for 1 each, but every other punch that gets through scores 1 more.' },
];

export interface BoutPunch {
  id: number;
  by: string;
  round: number;
  punch: BoutPunchKind;
  quality: BoutQuality;
  blocked: boolean;
  countered: boolean;
  points: number;
  slip: 'slipped' | 'missed' | 'taken' | null;
  landed: boolean | null;
  knockdown: boolean;
  at: string;
}

export interface BoutRoundCard {
  round: number;
  mine: number;
  theirs: number;
  myPoints: number;
  theirPoints: number;
  myDown: number;
  theirDown: number;
  ko: boolean;
}

export interface BoutDay {
  steps: number;
  earned: number;
  used: number;
  left: number;
  nextAt: number | null;
  cardio: boolean;
  strength: boolean;
  camp: boolean;
  campWorkout: string | null;
  kdNeeds: number;
}

export interface BoutLive {
  status: 'active' | 'final';
  rounds: number;
  roundsPlayed: number;
  round: number;
  winner: string | null;
  method: 'ko' | 'decision' | 'draw' | null;
  koRound: number | null;
  me: string;
  opponent: { id: string; name: string; initials: string; iconId: string | null } | null;
  day: BoutDay;
  widths: Record<BoutPunchKind, number> & { perfectShare: number };
  slipWidths: Record<BoutPunchKind, number>;
  guard: BoutGuard;
  run: number;
  downs: number;
  tally: { mine: number; theirs: number };
  incoming: BoutPunch[];
  thrown: BoutPunch[];
  card: BoutRoundCard[];
  last: {
    round: number;
    mine: number;
    theirs: number;
    myPoints: number;
    theirPoints: number;
    myDown: number;
    theirDown: number;
    myLanded: Partial<Record<BoutPunchKind, number>>;
    slipped: number;
    theirThrough: number;
    theirGuard: BoutGuard | null;
  } | null;
  canAct: boolean;
  reason: string | null;
}

export function toPunch(p: any): BoutPunch {
  return {
    id: num(p?.id),
    by: p?.by,
    round: num(p?.round),
    punch: (p?.punch ?? 'jab') as BoutPunchKind,
    quality: (p?.quality ?? 'clean') as BoutQuality,
    blocked: !!p?.blocked,
    countered: !!p?.countered,
    points: num(p?.points),
    slip: p?.slip ?? null,
    landed: p?.landed == null ? null : !!p.landed,
    knockdown: !!p?.knockdown,
    at: p?.at ?? '',
  };
}

export function toBoutLive(d: any): BoutLive {
  const dy = d?.day ?? {};
  const w = d?.widths ?? {};
  const sw = d?.slip_widths ?? {};
  const l = d?.last;
  return {
    status: d?.status === 'final' ? 'final' : 'active',
    rounds: num(d?.rounds) || 5,
    roundsPlayed: num(d?.rounds_played),
    round: num(d?.round),
    winner: d?.winner ?? null,
    method: d?.method ?? null,
    koRound: d?.ko_round == null ? null : num(d.ko_round),
    me: d?.me,
    opponent: d?.opponent
      ? { id: d.opponent.id, name: d.opponent.name ?? 'Your opponent', initials: d.opponent.initials ?? '?', iconId: d.opponent.icon_id ?? null }
      : null,
    day: {
      steps: num(dy.steps),
      earned: num(dy.earned),
      used: num(dy.used),
      left: num(dy.left),
      nextAt: dy.next_at == null ? null : num(dy.next_at),
      cardio: !!dy.cardio,
      strength: !!dy.strength,
      camp: !!dy.camp,
      campWorkout: dy.camp_workout ?? null,
      kdNeeds: num(dy.kd_needs) || 3,
    },
    widths: { jab: num(w.jab) || 14, hook: num(w.hook) || 9, up: num(w.up) || 5, perfectShare: num(w.perfect_share) || 0.35 },
    slipWidths: { jab: num(sw.jab) || 7, hook: num(sw.hook) || 10, up: num(sw.up) || 12 },
    guard: (d?.guard ?? 'high') as BoutGuard,
    run: num(d?.run),
    downs: num(d?.downs),
    tally: { mine: num(d?.tally?.mine), theirs: num(d?.tally?.theirs) },
    incoming: ((d?.incoming ?? []) as any[]).map(toPunch),
    thrown: ((d?.thrown ?? []) as any[]).map(toPunch),
    card: ((d?.card ?? []) as any[]).map((r) => ({
      round: num(r.round),
      mine: num(r.mine),
      theirs: num(r.theirs),
      myPoints: num(r.my_points),
      theirPoints: num(r.their_points),
      myDown: num(r.my_down),
      theirDown: num(r.their_down),
      ko: !!r.ko,
    })),
    last: l
      ? {
          round: num(l.round),
          mine: num(l.mine),
          theirs: num(l.theirs),
          myPoints: num(l.my_points),
          theirPoints: num(l.their_points),
          myDown: num(l.my_down),
          theirDown: num(l.their_down),
          myLanded: (l.my_landed ?? {}) as Partial<Record<BoutPunchKind, number>>,
          slipped: num(l.slipped),
          theirThrough: num(l.their_through),
          theirGuard: l.their_guard ?? null,
        }
      : null,
    canAct: !!d?.can_act,
    reason: d?.reason ?? null,
  };
}

export async function getBoutLive(challengeId: string): Promise<BoutLive> {
  return toBoutLive(await rpc('bout_live', { p_challenge_id: challengeId }));
}

export interface BoutThrow {
  id: number;
  punch: BoutPunchKind;
  quality: BoutQuality;
  blocked: boolean;
  countered: boolean;
  points: number;
  guard: BoutGuard | null;
  run: number;
  downs: number;
  kdNeeds: number;
  left: number;
  message: string;
}

// pos: where the meter stopped, 0-100 (50 the middle).
export async function throwPunch(challengeId: string, punch: BoutPunchKind, pos: number): Promise<BoutThrow> {
  const d = await rpc<any>('bout_throw', { p_challenge_id: challengeId, p_punch: punch, p_pos: Math.round(pos * 10) / 10 });
  return {
    id: num(d?.id),
    punch: (d?.punch ?? punch) as BoutPunchKind,
    quality: (d?.quality ?? 'miss') as BoutQuality,
    blocked: !!d?.blocked,
    countered: !!d?.countered,
    points: num(d?.points),
    guard: d?.guard ?? null,
    run: num(d?.run),
    downs: num(d?.downs),
    kdNeeds: num(d?.kd_needs) || 3,
    left: num(d?.left),
    message: d?.message ?? '',
  };
}

// Slip an incoming punch (pos 0-100), or take it (null: no action spent).
export async function slipPunch(challengeId: string, punchId: number, pos: number | null): Promise<{ slip: 'slipped' | 'missed' | 'taken'; left: number; message: string }> {
  const d = await rpc<any>('bout_slip', { p_challenge_id: challengeId, p_punch_id: punchId, p_pos: pos == null ? null : Math.round(pos * 10) / 10 });
  return { slip: d?.slip ?? 'taken', left: num(d?.left), message: d?.message ?? '' };
}

export async function setGuard(challengeId: string, guard: BoutGuard): Promise<void> {
  await rpc('bout_set_guard', { p_challenge_id: challengeId, p_guard: guard });
}

export async function setupBout(challengeId: string, rounds: number): Promise<void> {
  await rpc('bout_setup', { p_challenge_id: challengeId, p_rounds: rounds });
}

export interface BoutReplay {
  round: number;
  me: string;
  punches: BoutPunch[];
}

export async function getBoutReplay(challengeId: string, round: number): Promise<BoutReplay> {
  const d = await rpc<any>('bout_replay', { p_challenge_id: challengeId, p_round: round });
  return { round: num(d?.round), me: d?.me, punches: ((d?.punches ?? []) as any[]).map(toPunch) };
}

// ── Admin ──

export interface BoutOverview {
  live: number;
  all: number;
  fighters: number;
  threwEver: number;
  threw7d: number;
  punches7d: number;
  byPunch7d: Partial<Record<BoutPunchKind, number>>;
  missed7d: number;
  blocked7d: number;
  perfect7d: number;
  slipsTried7d: number;
  slipped7d: number;
  knockdownsAll: number;
  byMethod: Partial<Record<'ko' | 'decision' | 'draw', number>>;
  guards7d: Partial<Record<BoutGuard, number>>;
}

export async function getBoutOverview(): Promise<BoutOverview> {
  const d = await rpc<any>('admin_bout_overview');
  return {
    live: num(d?.fights_live),
    all: num(d?.fights_all),
    fighters: num(d?.fighters_all),
    threwEver: num(d?.threw_ever),
    threw7d: num(d?.threw_7d),
    punches7d: num(d?.punches_7d),
    byPunch7d: d?.by_punch_7d ?? {},
    missed7d: num(d?.missed_7d),
    blocked7d: num(d?.blocked_7d),
    perfect7d: num(d?.perfect_7d),
    slipsTried7d: num(d?.slips_tried_7d),
    slipped7d: num(d?.slipped_7d),
    knockdownsAll: num(d?.knockdowns_all),
    byMethod: d?.by_method ?? {},
    guards7d: d?.guards_7d ?? {},
  };
}

export function boutSummary(o: BoutOverview): string {
  if (o.all === 0) return 'No fights yet';
  return `${o.live} live · ${o.threw7d.toLocaleString()} throwing this week · ${o.knockdownsAll.toLocaleString()} knockdowns`;
}
