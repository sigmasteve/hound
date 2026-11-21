import { supabase } from '../lib/supabase';
import { toWin, type SlotBet, type SlotLines, type SlotWin } from './slots';

// The client half of Paw Slots (0242). The server counts the spins from
// steps, picks the stops, pays the lines and holds the Paw Coins; the
// phone sends its own step count for today with every look.

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

export interface SlotsSettings {
  stepsPerSpin: number;
  maxStepSpins: number;
  workoutMin: number;
  workoutSpins: number;
  carryMax: number;
  buyPrice: number;
  buyCap: number;
  finishDays: number;
}

export interface SlotsRow {
  rank: number;
  tied: boolean;
  userId: string;
  name: string;
  coins: number;
  team: string | null;
  me: boolean;
}

export interface SlotsTeamRow {
  team: string;
  rank: number;
  members: number;
  total: number;
  avg: number;
  mine: boolean;
  bones: number;
}

export interface SlotsFeedItem {
  name: string;
  best: number;
  bet: number;
  lines: number;
  coins: number;
  wins: SlotWin[];
  at: string;
}

export interface SlotsGame {
  settings: SlotsSettings;
  name: string;
  isGlobal: boolean;
  dayNo: number;
  days: number;
  endsAt: string;
  over: boolean;
  teams: number;
  players: number;
  pool: number;
  prizes: { places: number[]; rest: number | null; restMin: number };
  teamPrizes: number[];
  me: { coins: number; rank: number; team: string | null; joined: boolean; spinDays: number; presses: number };
  today: {
    steps: number;
    fromSteps: number;
    workoutMin: number;
    workoutSpins: number;
    carried: number;
    bought: number;
    used: number;
    left: number;
    nextAt: number | null;
    buyLeft: number;
  };
  board: SlotsRow[];
  teamBoard: SlotsTeamRow[];
  mates: { name: string; coins: number; me: boolean }[];
  feed: SlotsFeedItem[];
}

export function toSlotsGame(d: any): SlotsGame {
  const s = d?.settings ?? {};
  const t = d?.today ?? {};
  const m = d?.me ?? {};
  return {
    settings: {
      stepsPerSpin: num(s.stepsPerSpin) || 500,
      maxStepSpins: num(s.maxStepSpins) || 20,
      workoutMin: num(s.workoutMin) || 20,
      workoutSpins: num(s.workoutSpins),
      carryMax: num(s.carryMax),
      buyPrice: num(s.buyPrice) || 3,
      buyCap: num(s.buyCap),
      finishDays: num(s.finishDays) || 5,
    },
    name: String(d?.name ?? ''),
    isGlobal: !!d?.isGlobal,
    dayNo: num(d?.dayNo),
    days: num(d?.days),
    endsAt: String(d?.endsAt ?? ''),
    over: !!d?.over,
    teams: num(d?.teams),
    players: num(d?.players),
    pool: num(d?.pool),
    prizes: {
      places: ((d?.prizes?.places ?? []) as unknown[]).map(num),
      rest: d?.prizes?.rest == null ? null : num(d.prizes.rest),
      restMin: num(d?.prizes?.restMin),
    },
    teamPrizes: ((d?.teamPrizes ?? []) as unknown[]).map(num),
    me: {
      coins: num(m.coins),
      rank: num(m.rank) || 1,
      team: m.team ?? null,
      joined: !!m.joined,
      spinDays: num(m.spinDays),
      presses: num(m.presses),
    },
    today: {
      steps: num(t.steps),
      fromSteps: num(t.fromSteps),
      workoutMin: num(t.workoutMin),
      workoutSpins: num(t.workoutSpins),
      carried: num(t.carried),
      bought: num(t.bought),
      used: num(t.used),
      left: num(t.left),
      nextAt: t.nextAt == null ? null : num(t.nextAt),
      buyLeft: num(t.buyLeft),
    },
    board: ((d?.board ?? []) as any[]).map((r) => ({
      rank: num(r.rank),
      tied: !!r.tied,
      userId: String(r.userId),
      name: String(r.name ?? 'A hound'),
      coins: num(r.coins),
      team: r.team ?? null,
      me: !!r.me,
    })),
    teamBoard: ((d?.teamBoard ?? []) as any[]).map((r) => ({
      team: String(r.team),
      rank: num(r.rank),
      members: num(r.members),
      total: num(r.total),
      avg: num(r.avg),
      mine: !!r.mine,
      bones: num(r.bones),
    })),
    mates: ((d?.mates ?? []) as any[]).map((r) => ({ name: String(r.name ?? 'A hound'), coins: num(r.coins), me: !!r.me })),
    feed: ((d?.feed ?? []) as any[]).map((r) => ({
      name: String(r.name ?? 'A hound'),
      best: num(r.best),
      bet: num(r.bet) || 1,
      lines: num(r.lines) || 1,
      coins: num(r.coins),
      wins: ((r.wins ?? []) as any[]).map(toWin),
      at: String(r.at ?? ''),
    })),
  };
}

export async function getSlots(challengeId: string, steps?: number | null): Promise<SlotsGame> {
  return toSlotsGame(await rpc('slots_state', { p_challenge_id: challengeId, p_steps: steps ?? null }));
}

export interface SlotsSpinResult {
  stops: [number, number, number];
  wins: SlotWin[];
  base: number;
  won: number;
  coins: number;
  left: number;
}

export async function spinSlots(challengeId: string, lines: SlotLines, bet: SlotBet): Promise<SlotsSpinResult> {
  const d = await rpc<any>('slots_spin', { p_challenge_id: challengeId, p_lines: lines, p_bet: bet });
  const st = ((d?.stops ?? [0, 0, 0]) as unknown[]).map(num);
  return {
    stops: [st[0] ?? 0, st[1] ?? 0, st[2] ?? 0],
    wins: ((d?.wins ?? []) as any[]).map(toWin),
    base: num(d?.base),
    won: num(d?.won),
    coins: num(d?.coins),
    left: num(d?.left),
  };
}

export async function buySlots(challengeId: string, spins: number): Promise<{ coins: number; left: number }> {
  const d = await rpc<any>('slots_buy', { p_challenge_id: challengeId, p_spins: spins });
  return { coins: num(d?.coins), left: num(d?.left) };
}

// Right after Create: solo or 2 to 4 packs, and (an admin's Global) the pool.
export async function setupSlots(challengeId: string, teams: number, pool?: number | null): Promise<void> {
  await rpc('slots_setup', { p_challenge_id: challengeId, p_teams: teams, p_pool: pool ?? null });
}

// Spins ready to play today, for Needs you and the challenge page.
export function slotsWaiting(g: SlotsGame | null): number {
  if (!g || g.over || !g.me.joined || g.dayNo < 1 || g.dayNo > g.days) return 0;
  return g.today.left;
}

export function slotsHeadline(name: string, g: SlotsGame | null): string {
  if (!g) return name;
  const left = slotsWaiting(g);
  const place = g.teams >= 2 ? '' : ` · ${g.me.rank}${g.me.rank === 1 ? 'st' : g.me.rank === 2 ? 'nd' : g.me.rank === 3 ? 'rd' : 'th'}`;
  return `${g.me.coins.toLocaleString('en-US')} Paw Coins${place}${left > 0 ? ` · ${left} ${left === 1 ? 'spin' : 'spins'} ready` : ''}`;
}

// ── Admin ──

export interface SlotsOverview {
  live: number;
  liveGlobal: number;
  all: number;
  teamGames: number;
  joined: number;
  playedEver: number;
  players7d: number;
  presses7d: number;
  spinsUsed7d: number;
  coinsWon7d: number;
  hits7d: number;
  byLines7d: { l1: number; l3: number; l5: number };
  byBet7d: { b1: number; b2: number; b3: number; b5: number };
  jackpots7d: number;
  bigWins7d: number;
  buyers7d: number;
  bought7d: number;
  coinsSpent7d: number;
  carried7d: number;
  bonesPaid: number;
  topPlayers7d: { name: string; presses: number; coins: number }[];
  settings: Record<string, number>;
}

export async function getSlotsOverview(): Promise<SlotsOverview> {
  const d = await rpc<any>('admin_slots_overview', {});
  return {
    live: num(d.live),
    liveGlobal: num(d.liveGlobal),
    all: num(d.all),
    teamGames: num(d.teamGames),
    joined: num(d.joined),
    playedEver: num(d.playedEver),
    players7d: num(d.players7d),
    presses7d: num(d.presses7d),
    spinsUsed7d: num(d.spinsUsed7d),
    coinsWon7d: num(d.coinsWon7d),
    hits7d: num(d.hits7d),
    byLines7d: { l1: num(d.byLines7d?.l1), l3: num(d.byLines7d?.l3), l5: num(d.byLines7d?.l5) },
    byBet7d: { b1: num(d.byBet7d?.b1), b2: num(d.byBet7d?.b2), b3: num(d.byBet7d?.b3), b5: num(d.byBet7d?.b5) },
    jackpots7d: num(d.jackpots7d),
    bigWins7d: num(d.bigWins7d),
    buyers7d: num(d.buyers7d),
    bought7d: num(d.bought7d),
    coinsSpent7d: num(d.coinsSpent7d),
    carried7d: num(d.carried7d),
    bonesPaid: num(d.bonesPaid),
    topPlayers7d: ((d.topPlayers7d ?? []) as any[]).map((r) => ({ name: String(r.name ?? ''), presses: num(r.presses), coins: num(r.coins) })),
    settings: (d.settings ?? {}) as Record<string, number>,
  };
}

export function slotsSummary(o: SlotsOverview): string {
  if (o.all === 0) return 'No games yet';
  return `${o.live} live · ${o.players7d} played this week · ${o.presses7d.toLocaleString('en-US')} presses`;
}
