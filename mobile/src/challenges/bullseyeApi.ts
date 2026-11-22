import { supabase } from '../lib/supabase';
import { toConditions as toShotConditions, type LongShotWind } from './longshotApi';

// The client half of Bullseye (0249), archery on Long Shot's engine. The
// server counts the arrows from steps, sets the day's field (the air, the
// breeze, Balloon and Moon days), flies every arrow and keeps the sight
// tape; the phone draws the field, the flags, the pin's sway
// (bullseyeSway, like bullseye_sway) and the drifting balloons
// (bullseyeBalloon, like bullseye_balloon) with the same formulas.

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

export type BullseyeTargetKind = 'face' | 'clout' | 'balloon' | 'gold';
export type BullseyeArrow = 'light' | 'standard' | 'heavy';

export interface BullseyeConditions {
  world: 'earth' | 'moon';
  balloons: boolean;
  far: number;
  helper: boolean;
  bounty: boolean;
  tempF: number;
  air: number;
  wind: LongShotWind;
  drift: { amp: number; period: number; phase: number } | null;
}

export interface BullseyeTarget {
  id: string;
  dist: number;
  face: number;
  stars: number;
  kind: BullseyeTargetKind;
  mark: number;
  learned: boolean;
  tof: number;
  apex: number;
  wind10Cm: number;
  bestToday: number | null;
}

export interface BullseyeBow {
  id: string;
  name: string;
  fps: number;
  sight: boolean;
  starBonus: number;
  sway: number;
  unlockSteps: number;
  unlocked: boolean;
  at70: { apex: number; wind10Cm: number };
  apex90: number;
}

export interface BullseyeEndArrow {
  target: string;
  ring: number;
  x: boolean;
  popped: boolean;
  robin: boolean;
  points: number;
  xCm: number;
  yCm: number;
}

export interface BullseyeRow {
  rank: number;
  tied: boolean;
  userId: string;
  name: string;
  points: number;
  golds: number;
  arrows: number;
  bestEnd: number;
  robinHoods: number;
  me: boolean;
}

export interface BullseyeGame {
  settings: { stepsPerEnd: number; maxEnds: number; arrowsPerEnd: number; workoutMin: number; robinHood: number; bountyBones: number; fullDrawMs: number };
  name: string;
  isGlobal: boolean;
  dayNo: number;
  days: number;
  over: boolean;
  players: number;
  pool: number;
  prizes: { places: number[]; rest: number | null; restMin: number };
  conditions: BullseyeConditions;
  goldTaker: { name: string; me: boolean; bones: number } | null;
  targets: BullseyeTarget[];
  bows: BullseyeBow[];
  ends: { endNo: number; total: number; arrows: BullseyeEndArrow[] }[];
  me: {
    joined: boolean;
    points: number;
    rank: number;
    golds: number;
    arrows: number;
    bestEnd: number;
    robinHoods: number;
    bow: string;
    arrow: BullseyeArrow;
    gameSteps: number;
    shotDays: number;
  };
  today: { steps: number; fromSteps: number; workoutMin: number; steady: boolean; carried: number; used: number; left: number; nextAt: number | null };
  board: BullseyeRow[];
  feed: { name: string; dist: number; target: string; ring: number; x: boolean; robin: boolean; popped: boolean; gold: boolean; points: number }[];
}

export function toBullseyeConditions(c: any): BullseyeConditions {
  const base = toShotConditions({ ...c, place: 'sea' });
  return {
    world: c?.world === 'moon' ? 'moon' : 'earth',
    balloons: !!c?.balloons,
    far: num(c?.far) || 150,
    helper: !!c?.helper,
    bounty: c?.bounty !== false,
    tempF: num(c?.tempF),
    air: num(c?.air),
    wind: base.wind,
    drift: c?.drift ? { amp: num(c.drift.amp), period: num(c.drift.period), phase: num(c.drift.phase) } : null,
  };
}

const toArrow = (a: unknown): BullseyeArrow => (a === 'light' || a === 'heavy' ? a : 'standard');

export function toBullseyeGame(d: any): BullseyeGame {
  const s = d?.settings ?? {};
  const me = d?.me ?? {};
  const t = d?.today ?? {};
  return {
    settings: {
      stepsPerEnd: num(s.stepsPerEnd) || 1500,
      maxEnds: num(s.maxEnds) || 6,
      arrowsPerEnd: num(s.arrowsPerEnd) || 3,
      workoutMin: num(s.workoutMin) || 20,
      robinHood: num(s.robinHood),
      bountyBones: num(s.bountyBones),
      fullDrawMs: num(s.fullDrawMs) || 900,
    },
    name: String(d?.name ?? 'Bullseye'),
    isGlobal: !!d?.isGlobal,
    dayNo: num(d?.dayNo),
    days: num(d?.days),
    over: !!d?.over,
    players: num(d?.players),
    pool: num(d?.pool),
    prizes: { places: ((d?.prizes?.places ?? []) as unknown[]).map(num), rest: numOrNull(d?.prizes?.rest), restMin: num(d?.prizes?.restMin) },
    conditions: toBullseyeConditions(d?.conditions),
    goldTaker: d?.goldTaker ? { name: String(d.goldTaker.name ?? ''), me: !!d.goldTaker.me, bones: num(d.goldTaker.bones) } : null,
    targets: ((d?.targets ?? []) as any[]).map((x) => ({
      id: String(x.id),
      dist: num(x.dist),
      face: num(x.face),
      stars: num(x.stars),
      kind: (['face', 'clout', 'balloon', 'gold'].includes(x.kind) ? x.kind : 'face') as BullseyeTargetKind,
      mark: num(x.mark),
      learned: !!x.learned,
      tof: num(x.tof),
      apex: num(x.apex),
      wind10Cm: num(x.wind10Cm),
      bestToday: numOrNull(x.bestToday),
    })),
    bows: ((d?.bows ?? []) as any[]).map((b) => ({
      id: String(b.id),
      name: String(b.name),
      fps: num(b.fps),
      sight: !!b.sight,
      starBonus: num(b.starBonus),
      sway: num(b.sway),
      unlockSteps: num(b.unlockSteps),
      unlocked: !!b.unlocked,
      at70: { apex: num(b.at70?.apex), wind10Cm: num(b.at70?.wind10Cm) },
      apex90: num(b.apex90),
    })),
    ends: ((d?.ends ?? []) as any[]).map((e) => ({
      endNo: num(e.endNo),
      total: num(e.total),
      arrows: ((e.arrows ?? []) as any[]).map((a) => ({
        target: String(a.target),
        ring: num(a.ring),
        x: !!a.x,
        popped: !!a.popped,
        robin: !!a.robin,
        points: num(a.points),
        xCm: num(a.xCm),
        yCm: num(a.yCm),
      })),
    })),
    me: {
      joined: !!me.joined,
      points: num(me.points),
      rank: num(me.rank) || 1,
      golds: num(me.golds),
      arrows: num(me.arrows),
      bestEnd: num(me.bestEnd),
      robinHoods: num(me.robinHoods),
      bow: String(me.bow ?? 'recurve'),
      arrow: toArrow(me.arrow),
      gameSteps: num(me.gameSteps),
      shotDays: num(me.shotDays),
    },
    today: {
      steps: num(t.steps),
      fromSteps: num(t.fromSteps),
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
      golds: num(r.golds),
      arrows: num(r.arrows),
      bestEnd: num(r.bestEnd),
      robinHoods: num(r.robinHoods),
      me: !!r.me,
    })),
    feed: ((d?.feed ?? []) as any[]).map((f) => ({
      name: String(f.name ?? ''),
      dist: num(f.dist),
      target: String(f.target ?? ''),
      ring: num(f.ring),
      x: !!f.x,
      robin: !!f.robin,
      popped: !!f.popped,
      gold: !!f.gold,
      points: num(f.points),
    })),
  };
}

export async function getBullseye(challengeId: string, steps?: number | null): Promise<BullseyeGame> {
  return toBullseyeGame(await rpc('bullseye_state', { p_challenge_id: challengeId, p_steps: steps ?? null }));
}

export interface BullseyeAim {
  aimId: number;
  seed: number;
  amp: number;
  target: string;
  dist: number;
  face: number;
  stars: number;
  kind: BullseyeTargetKind;
  sight: boolean;
  mark: number;
  learned: boolean;
  tof: number;
  apex: number;
  helperXCm: number | null;
  fullDrawMs: number;
  conditions: BullseyeConditions;
}

export async function aimBullseye(challengeId: string, target: string): Promise<BullseyeAim> {
  const d = await rpc<any>('bullseye_aim', { p_challenge_id: challengeId, p_target: target });
  return {
    aimId: num(d?.aimId),
    seed: num(d?.seed),
    amp: num(d?.amp),
    target: String(d?.target),
    dist: num(d?.dist),
    face: num(d?.face),
    stars: num(d?.stars),
    kind: (['face', 'clout', 'balloon', 'gold'].includes(d?.kind) ? d.kind : 'face') as BullseyeTargetKind,
    sight: d?.sight !== false,
    mark: num(d?.mark),
    learned: !!d?.learned,
    tof: num(d?.tof),
    apex: num(d?.apex),
    helperXCm: d?.helper ? num(d.helper.xCm) : null,
    fullDrawMs: num(d?.fullDrawMs) || 900,
    conditions: toBullseyeConditions(d?.conditions),
  };
}

export interface BullseyeResult {
  target: string;
  kind: BullseyeTargetKind;
  dist: number;
  face: number;
  stars: number;
  ring: number;
  x: boolean;
  popped: boolean;
  robin: boolean;
  gold: boolean;
  goldBones: number;
  points: number;
  message: string;
  xCm: number;
  yCm: number;
  balloon: { xCm: number; yCm: number };
  mark: number;
  hold: { x: number; y: number };
  sway: { x: number; y: number };
  drawMs: number;
  windMph: number;
  tof: number;
  apex: number;
  fps: number;
  endNo: number;
  arrowNo: number;
  endTotal: number;
  left: number;
  total: number;
}

export async function shootBullseye(challengeId: string, aimId: number, holdX: number, holdY: number, drawMs: number): Promise<BullseyeResult> {
  const d = await rpc<any>('bullseye_shoot', {
    p_challenge_id: challengeId,
    p_aim_id: aimId,
    p_hold_x: Math.round(holdX * 100) / 100,
    p_hold_y: Math.round(holdY * 100) / 100,
    p_draw_ms: Math.max(0, Math.round(drawMs)),
  });
  return {
    target: String(d?.target),
    kind: (['face', 'clout', 'balloon', 'gold'].includes(d?.kind) ? d.kind : 'face') as BullseyeTargetKind,
    dist: num(d?.dist),
    face: num(d?.face),
    stars: num(d?.stars),
    ring: num(d?.ring),
    x: !!d?.x,
    popped: !!d?.popped,
    robin: !!d?.robin,
    gold: !!d?.gold,
    goldBones: num(d?.goldBones),
    points: num(d?.points),
    message: String(d?.message ?? ''),
    xCm: num(d?.xCm),
    yCm: num(d?.yCm),
    balloon: { xCm: num(d?.balloon?.xCm), yCm: num(d?.balloon?.yCm) },
    mark: num(d?.mark),
    hold: { x: num(d?.hold?.x), y: num(d?.hold?.y) },
    sway: { x: num(d?.sway?.x), y: num(d?.sway?.y) },
    drawMs: num(d?.drawMs),
    windMph: num(d?.windMph),
    tof: num(d?.tof),
    apex: num(d?.apex),
    fps: num(d?.fps),
    endNo: num(d?.endNo),
    arrowNo: num(d?.arrowNo),
    endTotal: num(d?.endTotal),
    left: num(d?.left),
    total: num(d?.total),
  };
}

export async function setBullseyeLoadout(challengeId: string, bow: string, arrow: BullseyeArrow): Promise<void> {
  await rpc('bullseye_loadout', { p_challenge_id: challengeId, p_bow: bow, p_arrow: arrow });
}

export async function setupBullseye(
  challengeId: string,
  opts: { far: 30 | 70 | 150; moon: 'none' | 'sat'; balloons: 'none' | 'wed'; helper: boolean; bounty: boolean },
  pool?: number | null,
): Promise<void> {
  await rpc('bullseye_setup', {
    p_challenge_id: challengeId,
    p_far: opts.far,
    p_moon: opts.moon,
    p_balloons: opts.balloons,
    p_helper: opts.helper,
    p_bounty: opts.bounty,
    p_pool: pool ?? null,
  });
}

// ── The same formulas as the server ──

// bullseye_sway: the pin's sway (mils) t ms into a draw.
export function bullseyeSway(seed: number, amp: number, t: number): { x: number; y: number } {
  const s = Math.abs(seed);
  const ph = [0, 1, 2, 3].map((i) => ((Math.floor(s / 32 ** i) % 32) / 32) * 2 * Math.PI);
  const f = t < 1200 ? 1 : t < 3500 ? 0.4 : Math.min(3, 0.4 + (t - 3500) / 1500);
  const a = amp * f;
  return {
    x: a * (0.62 * Math.sin((2 * Math.PI * t) / 1300 + ph[0]) + 0.38 * Math.sin((2 * Math.PI * t) / 530 + ph[1])),
    y: a * (0.62 * Math.sin((2 * Math.PI * t) / 1600 + ph[2]) + 0.38 * Math.sin((2 * Math.PI * t) / 610 + ph[3])),
  };
}

// Where the draw is: drawing, steady (the window to let go), tiring.
export function bullseyeDrawPhase(t: number, fullDrawMs: number): 'drawing' | 'steady' | 'tiring' {
  if (t < Math.max(fullDrawMs, 1200)) return 'drawing';
  return t < 3500 ? 'steady' : 'tiring';
}

// bullseye_balloon: where a balloon is (cm from its spot) at a moment.
export function bullseyeBalloon(c: BullseyeConditions, target: string, at: number): { x: number; y: number } {
  const d = c.drift;
  const i = target === 'b30' ? 0 : target === 'b50' ? 1 : target === 'b70' ? 2 : 3;
  if (!d || !['b30', 'b50', 'b70', 'gold'].includes(target)) return { x: 0, y: 0 };
  const s = at / 1000;
  const per = d.period + i * 1.7;
  return {
    x: d.amp * (1 - i * 0.12) * Math.sin((2 * Math.PI * s) / per + d.phase + i * 1.9),
    y: 12 * Math.sin((2 * Math.PI * s) / (per * 0.43) + i),
  };
}

// ── For Needs you, Today and the challenge page ──

export function bullseyeWaiting(g: BullseyeGame | null): number {
  if (!g || g.over || !g.me.joined || g.dayNo < 1 || g.dayNo > g.days) return 0;
  return g.today.left;
}

const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export function bullseyeHeadline(name: string, g: BullseyeGame | null): string {
  if (!g) return name;
  const left = bullseyeWaiting(g);
  return `${g.me.points} points · ${ord(g.me.rank)}${left > 0 ? ` · ${left} ${left === 1 ? 'arrow' : 'arrows'} ready` : ''}`;
}

export function targetName(t: { dist: number; kind: BullseyeTargetKind }): string {
  if (t.kind === 'clout') return `Flag ${t.dist} m`;
  if (t.kind === 'gold') return `Gold balloon`;
  if (t.kind === 'balloon') return `Balloon ${t.dist} m`;
  return `${t.dist} m`;
}

export const ARROWS: { id: BullseyeArrow; name: string; note: string }[] = [
  { id: 'light', name: 'Light carbon', note: 'flatter, blows more' },
  { id: 'standard', name: 'Standard', note: 'in between' },
  { id: 'heavy', name: 'Heavy wood', note: 'steady, drops more' },
];

// ── Admin ──

export interface BullseyeOverview {
  games: number;
  live: number;
  helperGames: number;
  tried: number;
  active7d: number;
  arrows7d: number;
  golds7d: number;
  robins7d: number;
  pops7d: number;
  moon7d: number;
  gold7d: number;
  goldBones: number;
  targets: { target: string; dist: number; arrows: number; golds: number }[];
  bows: { id: string; name: string; arrows: number }[];
}

export async function getBullseyeOverview(): Promise<BullseyeOverview> {
  const d = await rpc<any>('admin_bullseye_overview', {});
  return {
    games: num(d?.games),
    live: num(d?.live),
    helperGames: num(d?.helperGames),
    tried: num(d?.tried),
    active7d: num(d?.active7d),
    arrows7d: num(d?.arrows7d),
    golds7d: num(d?.golds7d),
    robins7d: num(d?.robins7d),
    pops7d: num(d?.pops7d),
    moon7d: num(d?.moon7d),
    gold7d: num(d?.gold7d),
    goldBones: num(d?.goldBones),
    targets: ((d?.targets ?? []) as any[]).map((x) => ({ target: String(x.target), dist: num(x.dist), arrows: num(x.arrows), golds: num(x.golds) })),
    bows: ((d?.bows ?? []) as any[]).map((b) => ({ id: String(b.id), name: String(b.name), arrows: num(b.arrows) })),
  };
}

export function bullseyeSummary(o: BullseyeOverview): string {
  if (o.tried === 0) return o.games > 0 ? `${o.games} ${o.games === 1 ? 'game' : 'games'}, no arrows yet` : 'No games yet';
  return `${o.active7d} shooting this week · ${o.tried} ever`;
}
