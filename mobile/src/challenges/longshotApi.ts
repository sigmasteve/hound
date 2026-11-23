import { supabase } from '../lib/supabase';

// The client half of Long Shot (0247). The server counts the rounds from
// steps, sets the day's range (the air and the wind, the same for
// everyone), flies every round and keeps the data card; the phone draws
// the range, the wind flags and the reticle's sway with the same formulas
// (longshotSway, longshotFlagWind) so what you see is what's judged.

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
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

export type LongShotWorld = 'earth' | 'moon';
export type LongShotPlace = 'sea' | 'desert' | 'mountain';
export type LongShotMoon = 'none' | 'sat' | 'all';

export interface LongShotWind {
  mph: number;
  from: 'left' | 'right' | 'none';
  gust: number;
  period: number;
  phase: number;
  near: number;
  mid: number;
  far: number;
}

export interface LongShotConditions {
  world: LongShotWorld;
  place: LongShotPlace;
  far: number;
  bounty: boolean;
  gold: number;
  tempF: number;
  altitudeFt: number;
  rho: number;
  wind: LongShotWind;
}

export interface LongShotPlate {
  dist: number;
  size: number;
  pts: number;
  gold: boolean;
  hitToday: boolean;
}

export interface LongShotRifle {
  id: string;
  name: string;
  bullet: string;
  barrels: number[];
  refBarrel: number;
  unlockSteps: number;
  unlocked: boolean;
  mv: number;
  fpsInch: number;
  sway: number;
  at1000: { drop: number; wind10: number };
  drops: number[];
  subsonicAt: number | null;
}

export interface LongShotCardRow {
  dist: number;
  elev: number;
  book: number;
  learned: boolean;
  wind10: number;
  tof: number;
}

export interface LongShotRow {
  rank: number;
  tied: boolean;
  userId: string;
  name: string;
  points: number;
  hits: number;
  shots: number;
  longest: number;
  me: boolean;
}

export interface LongShotGame {
  // workoutRoundMin / workoutMaxMin (0255): a round per that many workout
  // minutes, counting up to the max.
  settings: {
    stepsPerRound: number;
    maxRounds: number;
    carryMax: number;
    workoutMin: number;
    workoutRoundMin: number;
    workoutMaxMin: number;
    coldBore: number;
    bountyBones: number;
    finishDays: number;
  };
  name: string;
  isGlobal: boolean;
  dayNo: number;
  days: number;
  endsAt: string;
  over: boolean;
  players: number;
  pool: number;
  prizes: { places: number[]; rest: number | null; restMin: number };
  conditions: LongShotConditions;
  goldTaker: { name: string; me: boolean; dist: number; bones: number } | null;
  plates: LongShotPlate[];
  rifles: LongShotRifle[];
  card: LongShotCardRow[];
  me: {
    joined: boolean;
    points: number;
    rank: number;
    hits: number;
    shots: number;
    longest: number;
    caliber: string;
    barrel: number;
    gameSteps: number;
    shotDays: number;
  };
  today: { steps: number; fromSteps: number; fromWorkout: number; workoutMin: number; steady: boolean; carried: number; used: number; left: number; nextAt: number | null };
  board: LongShotRow[];
  feed: { name: string; dist: number; center: boolean; gold: boolean; points: number; at: string }[];
  recent: { dist: number; hit: boolean; center: boolean; points: number; xIn: number; yIn: number; at: string }[];
}

function toWind(w: any): LongShotWind {
  return {
    mph: num(w?.mph),
    from: w?.from === 'left' || w?.from === 'right' ? w.from : 'none',
    gust: num(w?.gust),
    period: num(w?.period) || 30,
    phase: num(w?.phase),
    near: num(w?.near) || 1,
    mid: num(w?.mid) || 1,
    far: num(w?.far) || 1,
  };
}

export function toConditions(c: any): LongShotConditions {
  return {
    world: c?.world === 'moon' ? 'moon' : 'earth',
    place: c?.place === 'sea' || c?.place === 'mountain' ? c.place : 'desert',
    far: num(c?.far) || 3000,
    bounty: c?.bounty !== false,
    gold: num(c?.gold),
    tempF: num(c?.tempF),
    altitudeFt: num(c?.altitudeFt),
    rho: num(c?.rho),
    wind: toWind(c?.wind),
  };
}

export function toLongShotGame(d: any): LongShotGame {
  const s = d?.settings ?? {};
  const me = d?.me ?? {};
  const t = d?.today ?? {};
  return {
    settings: {
      stepsPerRound: num(s.stepsPerRound) || 1000,
      maxRounds: num(s.maxRounds) || 15,
      carryMax: num(s.carryMax),
      workoutMin: num(s.workoutMin) || 20,
      workoutRoundMin: num(s.workoutRoundMin) || 20,
      workoutMaxMin: s.workoutMaxMin == null ? 100 : num(s.workoutMaxMin),
      coldBore: num(s.coldBore),
      bountyBones: num(s.bountyBones),
      finishDays: num(s.finishDays),
    },
    name: String(d?.name ?? 'Long Shot'),
    isGlobal: !!d?.isGlobal,
    dayNo: num(d?.dayNo),
    days: num(d?.days),
    endsAt: String(d?.endsAt ?? ''),
    over: !!d?.over,
    players: num(d?.players),
    pool: num(d?.pool),
    prizes: {
      places: ((d?.prizes?.places ?? []) as unknown[]).map(num),
      rest: numOrNull(d?.prizes?.rest),
      restMin: num(d?.prizes?.restMin),
    },
    conditions: toConditions(d?.conditions),
    goldTaker: d?.goldTaker ? { name: String(d.goldTaker.name ?? ''), me: !!d.goldTaker.me, dist: num(d.goldTaker.dist), bones: num(d.goldTaker.bones) } : null,
    plates: ((d?.plates ?? []) as any[]).map((p) => ({ dist: num(p.dist), size: num(p.size), pts: num(p.pts), gold: !!p.gold, hitToday: !!p.hitToday })),
    rifles: ((d?.rifles ?? []) as any[]).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      bullet: String(r.bullet ?? ''),
      barrels: ((r.barrels ?? []) as unknown[]).map(num),
      refBarrel: num(r.refBarrel),
      unlockSteps: num(r.unlockSteps),
      unlocked: !!r.unlocked,
      mv: num(r.mv),
      fpsInch: num(r.fpsInch),
      sway: num(r.sway),
      at1000: { drop: num(r.at1000?.drop), wind10: num(r.at1000?.wind10) },
      drops: ((r.drops ?? []) as unknown[]).map(num),
      subsonicAt: numOrNull(r.subsonicAt),
    })),
    card: ((d?.card ?? []) as any[]).map((c) => ({
      dist: num(c.dist),
      elev: num(c.elev),
      book: num(c.book),
      learned: !!c.learned,
      wind10: num(c.wind10),
      tof: num(c.tof),
    })),
    me: {
      joined: !!me.joined,
      points: num(me.points),
      rank: num(me.rank) || 1,
      hits: num(me.hits),
      shots: num(me.shots),
      longest: num(me.longest),
      caliber: String(me.caliber ?? '65'),
      barrel: num(me.barrel) || 24,
      gameSteps: num(me.gameSteps),
      shotDays: num(me.shotDays),
    },
    today: {
      steps: num(t.steps),
      fromSteps: num(t.fromSteps),
      fromWorkout: num(t.fromWorkout),
      workoutMin: num(t.workoutMin),
      steady: !!t.steady,
      carried: num(t.carried),
      used: num(t.used),
      left: num(t.left),
      nextAt: numOrNull(t.nextAt),
    },
    board: ((d?.board ?? []) as any[]).map((r) => ({
      rank: num(r.rank),
      tied: !!r.tied,
      userId: String(r.userId),
      name: String(r.name ?? 'A hound'),
      points: num(r.points),
      hits: num(r.hits),
      shots: num(r.shots),
      longest: num(r.longest),
      me: !!r.me,
    })),
    feed: ((d?.feed ?? []) as any[]).map((f) => ({ name: String(f.name ?? ''), dist: num(f.dist), center: !!f.center, gold: !!f.gold, points: num(f.points), at: String(f.at ?? '') })),
    recent: ((d?.recent ?? []) as any[]).map((f) => ({
      dist: num(f.dist),
      hit: !!f.hit,
      center: !!f.center,
      points: num(f.points),
      xIn: num(f.xIn),
      yIn: num(f.yIn),
      at: String(f.at ?? ''),
    })),
  };
}

export async function getLongShot(challengeId: string, steps?: number | null): Promise<LongShotGame> {
  return toLongShotGame(await rpc('longshot_state', { p_challenge_id: challengeId, p_steps: steps ?? null }));
}

export interface LongShotAim {
  aimId: number;
  seed: number;
  amp: number;
  dist: number;
  size: number;
  pts: number;
  dial: number;
  learned: boolean;
  conditions: LongShotConditions;
}

export async function aimLongShot(challengeId: string, dist: number): Promise<LongShotAim> {
  const d = await rpc<any>('longshot_aim', { p_challenge_id: challengeId, p_dist: dist });
  return {
    aimId: num(d?.aimId),
    seed: num(d?.seed),
    amp: num(d?.amp),
    dist: num(d?.dist),
    size: num(d?.size),
    pts: num(d?.pts),
    dial: num(d?.dial),
    learned: !!d?.learned,
    conditions: toConditions(d?.conditions),
  };
}

export interface LongShotResult {
  hit: boolean;
  center: boolean;
  points: number;
  coldBore: boolean;
  gold: boolean;
  goldBones: number;
  message: string;
  dist: number;
  size: number;
  impact: { xIn: number; yIn: number; xMil: number; yMil: number };
  dial: number;
  hold: { x: number; y: number };
  sway: { x: number; y: number };
  windMph: number;
  tof: number;
  vEnd: number;
  muzzle: number;
  dropMil: number;
  learned: number | null;
  left: number;
  total: number;
}

export async function fireLongShot(challengeId: string, aimId: number, holdX: number, holdY: number, tMs: number): Promise<LongShotResult> {
  const d = await rpc<any>('longshot_fire', {
    p_challenge_id: challengeId,
    p_aim_id: aimId,
    p_hold_x: Math.round(holdX * 100) / 100,
    p_hold_y: Math.round(holdY * 100) / 100,
    p_t: Math.max(0, Math.round(tMs)),
  });
  return {
    hit: !!d?.hit,
    center: !!d?.center,
    points: num(d?.points),
    coldBore: !!d?.coldBore,
    gold: !!d?.gold,
    goldBones: num(d?.goldBones),
    message: String(d?.message ?? ''),
    dist: num(d?.dist),
    size: num(d?.size),
    impact: { xIn: num(d?.impact?.xIn), yIn: num(d?.impact?.yIn), xMil: num(d?.impact?.xMil), yMil: num(d?.impact?.yMil) },
    dial: num(d?.dial),
    hold: { x: num(d?.hold?.x), y: num(d?.hold?.y) },
    sway: { x: num(d?.sway?.x), y: num(d?.sway?.y) },
    windMph: num(d?.windMph),
    tof: num(d?.tof),
    vEnd: num(d?.vEnd),
    muzzle: num(d?.muzzle),
    dropMil: num(d?.dropMil),
    learned: numOrNull(d?.learned),
    left: num(d?.left),
    total: num(d?.total),
  };
}

export async function setLongShotLoadout(challengeId: string, caliber: string, barrel: number): Promise<void> {
  await rpc('longshot_loadout', { p_challenge_id: challengeId, p_caliber: caliber, p_barrel: barrel });
}

export async function setupLongShot(
  challengeId: string,
  opts: { place: LongShotPlace; far: 1000 | 2000 | 3000; moon: LongShotMoon; bounty: boolean },
  pool?: number | null,
): Promise<void> {
  await rpc('longshot_setup', {
    p_challenge_id: challengeId,
    p_place: opts.place,
    p_far: opts.far,
    p_moon: opts.moon,
    p_bounty: opts.bounty,
    p_pool: pool ?? null,
  });
}

// ── The same formulas as the server ──

// longshot_sway: the reticle's sway (mils) t ms into an aim.
// When arms start to tire in the scope (longshot_sway's 15000, 0254).
export const LONGSHOT_TIRE_MS = 15000;

export function longshotSway(seed: number, amp: number, t: number): { x: number; y: number } {
  const s = Math.abs(seed);
  const ph = [0, 1, 2, 3].map((i) => ((Math.floor(s / 32 ** i) % 32) / 32) * 2 * Math.PI);
  const cyc = t % 4500;
  const breath = cyc >= 2800 && cyc < 4200 ? 0.35 : 1;
  // Arms tire after 15 s held (0254; was 9 s).
  const tired = Math.min(2.5, 1 + Math.max(0, t - LONGSHOT_TIRE_MS) / 6000);
  const a = amp * breath * tired;
  return {
    x: a * (0.62 * Math.sin((2 * Math.PI * t) / 1700 + ph[0]) + 0.38 * Math.sin((2 * Math.PI * t) / 690 + ph[1])),
    y: a * (0.62 * Math.sin((2 * Math.PI * t) / 2100 + ph[2]) + 0.38 * Math.sin((2 * Math.PI * t) / 810 + ph[3])),
  };
}

// Where the breath is: 'pause' is the quiet window to fire in.
export function longshotBreath(t: number): { phase: 'breathe' | 'pause'; k: number; tired: boolean } {
  const cyc = t % 4500;
  return { phase: cyc >= 2800 && cyc < 4200 ? 'pause' : 'breathe', k: cyc / 4500, tired: t > LONGSHOT_TIRE_MS };
}

// One flag's wind (mph, + from the left) at a moment: the day's gusts
// times how strong it is there.
export function longshotFlagWind(w: LongShotWind, at: number, where: 'near' | 'mid' | 'far'): number {
  if (w.from === 'none') return 0;
  const sign = w.from === 'left' ? 1 : -1;
  return sign * w.mph * (1 + w.gust * Math.sin((2 * Math.PI * (at / 1000)) / w.period + w.phase)) * w[where];
}

// ── For Needs you, Today and the challenge page ──

export function longshotWaiting(g: LongShotGame | null): number {
  if (!g || g.over || !g.me.joined || g.dayNo < 1 || g.dayNo > g.days) return 0;
  return g.today.left;
}

const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export function longshotHeadline(name: string, g: LongShotGame | null): string {
  if (!g) return name;
  const left = longshotWaiting(g);
  return `${g.me.points} points · ${ord(g.me.rank)}${left > 0 ? ` · ${left} ${left === 1 ? 'round' : 'rounds'} ready` : ''}`;
}

export const PLACE_NAMES: Record<LongShotPlace, string> = { sea: 'Sea level', desert: 'The desert', mountain: 'The mountain' };

export function yd(n: number): string {
  return `${n.toLocaleString('en-US')} yd`;
}

// ── Admin ──

export interface LongShotOverview {
  games: number;
  live: number;
  tried: number;
  active7d: number;
  rounds7d: number;
  hits7d: number;
  moon7d: number;
  gold7d: number;
  goldBones: number;
  plates: { dist: number; shots: number; hits: number }[];
  rifles: { id: string; name: string; shots: number }[];
  cards: number;
  // 0255: rounds from today's workouts, and by how many.
  workoutRoundsToday: number;
  workoutPeopleToday: number;
}

export async function getLongShotOverview(): Promise<LongShotOverview> {
  const d = await rpc<any>('admin_longshot_overview', {});
  return {
    games: num(d?.games),
    live: num(d?.live),
    tried: num(d?.tried),
    active7d: num(d?.active7d),
    rounds7d: num(d?.rounds7d),
    hits7d: num(d?.hits7d),
    moon7d: num(d?.moon7d),
    gold7d: num(d?.gold7d),
    goldBones: num(d?.goldBones),
    plates: ((d?.plates ?? []) as any[]).map((p) => ({ dist: num(p.dist), shots: num(p.shots), hits: num(p.hits) })),
    rifles: ((d?.rifles ?? []) as any[]).map((r) => ({ id: String(r.id), name: String(r.name), shots: num(r.shots) })),
    cards: num(d?.cards),
    workoutRoundsToday: num(d?.workoutRoundsToday),
    workoutPeopleToday: num(d?.workoutPeopleToday),
  };
}

export function longshotSummary(o: LongShotOverview): string {
  if (o.tried === 0) return o.games > 0 ? `${o.games} ${o.games === 1 ? 'game' : 'games'}, no rounds yet` : 'No games yet';
  return `${o.active7d} shooting this week · ${o.tried} ever`;
}
