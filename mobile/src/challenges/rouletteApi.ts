import { supabase } from '../lib/supabase';
import type { RouletteFeedItem, RouletteSegment, RouletteStake, RouletteTask } from './roulette';

// The client half of Hound Roulette (0236). The server spins the wheel,
// scores the tasks, holds the points and settles Raids and Duels; the
// phone reports its own step count (as Daily Doors does).

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);

export interface RouletteSpin {
  stake: RouletteStake;
  segment: RouletteSegment;
  task: RouletteTask | null;
  target: number | null;
  double: boolean;
  status: 'open' | 'done' | 'missed';
  points: number;
  progress: number | null;
}

export interface RouletteRow {
  userId: string;
  name: string;
  banked: number;
  ride: number;
  rideDays: number;
  today: RouletteSpin | null;
  raidedBy: string | null;
}

export interface RouletteDuel {
  id: number;
  status: 'open' | 'on' | 'declined' | 'expired' | 'done';
  stake: number;
  // The viewer called it.
  mine: boolean;
  otherId: string;
  other: string;
  myDay: string | null;
  myAvg: number | null;
  mySteps: number | null;
  theirAvg: number | null;
  theirSteps: number | null;
  won: boolean | null;
  push: boolean;
  createdAt: string;
}

export interface RouletteSettings {
  safe: number;
  bold: number;
  raidCost: number;
  raidCap: number;
  duelMin: number;
  duelMax: number;
  bonesPerPoint: number;
  bonesCap: number;
  finishBones: number;
}

export interface RouletteGame {
  firstDay: string;
  days: number;
  today: string;
  dayNo: number;
  settled: boolean;
  // Why you can't spin now (null: you can).
  reason: string | null;
  banked: number;
  ride: number;
  rideDays: number;
  mult: number;
  bankValue: number;
  avg: number;
  spin: RouletteSpin | null;
  picks: Record<'steps' | 'workout' | 'water' | 'walk' | 'cheer', number>;
  board: RouletteRow[];
  raidOnMe: { by: string; cost: number } | null;
  myRaid: { target: string; name: string; status: string; points: number } | null;
  duels: RouletteDuel[];
  feed: RouletteFeedItem[];
  settings: RouletteSettings;
}

function toSpin(s: any): RouletteSpin | null {
  if (!s) return null;
  return {
    stake: s.stake,
    segment: s.segment,
    task: s.task ?? null,
    target: s.target == null ? null : num(s.target),
    double: !!s.double,
    status: s.status,
    points: num(s.points),
    progress: s.progress == null ? null : num(s.progress),
  };
}

export function toRouletteGame(d: any): RouletteGame {
  return {
    firstDay: d.firstDay,
    days: num(d.days),
    today: d.today,
    dayNo: num(d.dayNo),
    settled: !!d.settled,
    reason: d.reason ?? null,
    banked: num(d.banked),
    ride: num(d.ride),
    rideDays: num(d.rideDays),
    mult: num(d.mult) || 1,
    bankValue: num(d.bankValue),
    avg: num(d.avg),
    spin: toSpin(d.spin),
    picks: {
      steps: num(d.picks?.steps),
      workout: num(d.picks?.workout),
      water: num(d.picks?.water),
      walk: num(d.picks?.walk),
      cheer: num(d.picks?.cheer),
    },
    board: ((d.board ?? []) as any[]).map((r) => ({
      userId: r.userId,
      name: r.name ?? 'Someone',
      banked: num(r.banked),
      ride: num(r.ride),
      rideDays: num(r.rideDays),
      today: toSpin(r.today),
      raidedBy: r.raidedBy ?? null,
    })),
    raidOnMe: d.raidOnMe ? { by: d.raidOnMe.by, cost: num(d.raidOnMe.cost) } : null,
    myRaid: d.myRaid ? { target: d.myRaid.target, name: d.myRaid.name, status: d.myRaid.status, points: num(d.myRaid.points) } : null,
    duels: ((d.duels ?? []) as any[]).map((x) => ({
      id: num(x.id),
      status: x.status,
      stake: num(x.stake),
      mine: !!x.mine,
      otherId: x.otherId,
      other: x.other ?? 'Someone',
      myDay: x.myDay ?? null,
      myAvg: x.myAvg == null ? null : num(x.myAvg),
      mySteps: x.mySteps == null ? null : num(x.mySteps),
      theirAvg: x.theirAvg == null ? null : num(x.theirAvg),
      theirSteps: x.theirSteps == null ? null : num(x.theirSteps),
      won: x.won ?? null,
      push: !!x.push,
      createdAt: x.createdAt,
    })),
    feed: ((d.feed ?? []) as any[]).map((e) => ({
      kind: e.kind,
      userId: e.userId,
      name: e.name ?? 'Someone',
      otherId: e.otherId ?? null,
      other: e.other ?? null,
      points: num(e.points),
      detail: e.detail ?? null,
      at: e.at,
    })),
    settings: {
      safe: num(d.settings?.safe) || 1,
      bold: num(d.settings?.bold) || 3,
      raidCost: num(d.settings?.raidCost) || 2,
      raidCap: num(d.settings?.raidCap) || 25,
      duelMin: num(d.settings?.duelMin) || 2,
      duelMax: num(d.settings?.duelMax) || 25,
      bonesPerPoint: num(d.settings?.bonesPerPoint),
      bonesCap: num(d.settings?.bonesCap),
      finishBones: num(d.settings?.finishBones),
    },
  };
}

export async function getRoulette(challengeId: string): Promise<RouletteGame> {
  return toRouletteGame(await rpc('roulette_state', { p_challenge_id: challengeId }));
}

// The phone's own count for a day (today, or yesterday before a spin).
export async function claimRouletteSteps(challengeId: string, day: string, steps: number): Promise<boolean> {
  return !!(await rpc('roulette_claim_steps', { p_challenge_id: challengeId, p_day: day, p_steps: Math.max(0, Math.round(steps)) }));
}

export async function spinRoulette(challengeId: string, stake: RouletteStake): Promise<RouletteGame> {
  return toRouletteGame(await rpc('roulette_spin', { p_challenge_id: challengeId, p_stake: stake }));
}

export async function pickRouletteTask(challengeId: string, task: RouletteTask): Promise<RouletteGame> {
  return toRouletteGame(await rpc('roulette_pick', { p_challenge_id: challengeId, p_task: task }));
}

export async function bankRoulette(challengeId: string): Promise<RouletteGame> {
  return toRouletteGame(await rpc('roulette_bank', { p_challenge_id: challengeId }));
}

export async function raidRoulette(challengeId: string, target: string): Promise<RouletteGame> {
  return toRouletteGame(await rpc('roulette_raid', { p_challenge_id: challengeId, p_target: target }));
}

export async function callRouletteDuel(challengeId: string, opponent: string, stake: number): Promise<RouletteGame> {
  return toRouletteGame(await rpc('roulette_duel_call', { p_challenge_id: challengeId, p_opponent: opponent, p_stake: stake }));
}

export async function answerRouletteDuel(duelId: number, accept: boolean): Promise<RouletteGame> {
  return toRouletteGame(await rpc('roulette_duel_answer', { p_duel_id: duelId, p_accept: accept }));
}

// Waiting on the viewer: today's spin, or a Duel call to answer.
export function rouletteWaiting(g: RouletteGame | null): { spin: boolean; duel: RouletteDuel | null } {
  if (!g) return { spin: false, duel: null };
  return { spin: g.reason == null && !g.spin, duel: g.duels.find((d) => d.status === 'open' && !d.mine) ?? null };
}

export function rouletteHeadline(name: string, g: RouletteGame | null): string {
  if (!g) return name;
  const place = g.board.findIndex((r) => r.banked <= g.banked) + 1;
  if (g.settled) return `${name}: ${g.banked} banked`;
  const w = rouletteWaiting(g);
  if (w.duel) return `${w.duel.other.split(' ')[0]} called you out for ${w.duel.stake}`;
  if (g.raidOnMe) return `${g.raidOnMe.by.split(' ')[0]} is raiding your ride`;
  if (w.spin) return g.ride > 0 ? `${g.ride} riding · spin today’s wheel` : 'Spin today’s wheel';
  return `${g.banked} banked · ${place ? `#${place}` : ''}`.trim();
}

export interface RouletteOverview {
  live: number;
  finished: number;
  players: number;
  everSpun: number;
  spinners7d: number;
  spins7d: number;
  spinsToday: number;
  stakes: Record<string, { spins: number; done: number; missed: number }>;
  tasks: Record<string, { spins: number; done: number }>;
  specials7d: { free: number; double: number; pick: number };
  banks7d: number;
  banked7d: number;
  ridesLost7d: number;
  pointsLost7d: number;
  raids7d: { sent: number; won: number; held: number; void: number; pending: number; taken: number };
  duels7d: { called: number; accepted: number; declined: number; expired: number; decided: number; level: number; staked: number };
  bandanas: number;
  bonesPaid: number;
}

export async function getRouletteOverview(): Promise<RouletteOverview> {
  const d = await rpc<any>('admin_roulette_overview', {});
  const o = (x: any) => x ?? {};
  return {
    live: num(d.live),
    finished: num(d.finished),
    players: num(d.players),
    everSpun: num(d.everSpun),
    spinners7d: num(d.spinners7d),
    spins7d: num(d.spins7d),
    spinsToday: num(d.spinsToday),
    stakes: o(d.stakes),
    tasks: o(d.tasks),
    specials7d: { free: num(d.specials7d?.free), double: num(d.specials7d?.double), pick: num(d.specials7d?.pick) },
    banks7d: num(d.banks7d),
    banked7d: num(d.banked7d),
    ridesLost7d: num(d.ridesLost7d),
    pointsLost7d: num(d.pointsLost7d),
    raids7d: {
      sent: num(d.raids7d?.sent),
      won: num(d.raids7d?.won),
      held: num(d.raids7d?.held),
      void: num(d.raids7d?.void),
      pending: num(d.raids7d?.pending),
      taken: num(d.raids7d?.taken),
    },
    duels7d: {
      called: num(d.duels7d?.called),
      accepted: num(d.duels7d?.accepted),
      declined: num(d.duels7d?.declined),
      expired: num(d.duels7d?.expired),
      decided: num(d.duels7d?.decided),
      level: num(d.duels7d?.level),
      staked: num(d.duels7d?.staked),
    },
    bandanas: num(d.bandanas),
    bonesPaid: num(d.bonesPaid),
  };
}

export function rouletteSummary(o: RouletteOverview): string {
  if (o.live + o.finished === 0) return 'No games yet';
  return `${o.live} live · ${o.spinners7d} spun this week · ${o.raids7d.sent} Raids, ${o.duels7d.called} Duels`;
}
