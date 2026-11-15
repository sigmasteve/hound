import { supabase } from '../lib/supabase';
import { HORSE_SHOTS, type HorseShotId, type HorseWord } from './hoops';
import { parseCalls, parseSpot, type HorseCall, type HorseSpot } from './horseLive';

// The client-facing half of H-O-R-S-E — see 0196_horse.sql.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export interface HorsePlayer {
  userId: string;
  name: string;
  initials: string;
  iconId: string | null;
  frameId: string | null;
  backgroundId: string | null;
  letters: string;
  stepsToday: number;
}

export interface HorseTurn {
  dayNo: number;
  setter: string;
  shot: HorseShotId;
  target: number;
  setterSteps: number;
  made: boolean;
  matcherSteps: number | null;
  matched: boolean | null;
  letterTo: string | null;
}

export interface HorseGame {
  status: 'upcoming' | 'live' | 'final';
  firstDay: string | null;
  dayNo: number;
  days: number;
  word: HorseWord;
  setter: string | null;
  me: string | null;
  players: HorsePlayer[];
  shot: { id: HorseShotId; name: string; target: number };
  shots: { id: HorseShotId; name: string; target: number }[];
  history: HorseTurn[];
  winner: string | null;
  // 0209: call your shot. Turn by turn, 24 hours a turn; hands-off games
  // keep the daily step targets above.
  handsOn: boolean;
  live: HorseLive | null;
  // The last few shots taken by hand.
  recent: HorseLiveShot[];
}

// ── Call your shot (0209) ──

export interface HorseLiveShot {
  by: string;
  kind: 'set' | 'match';
  spot: HorseSpot;
  calls: HorseCall[];
  made: boolean;
  swish: boolean;
  // A turn that ran out (a match not taken counts as a miss).
  timeout: boolean;
  stars: number;
  description: string;
  highlight: boolean;
  at: string | null;
}

export interface HorseLive {
  handsOn: boolean;
  status: 'live' | 'final';
  word: HorseWord;
  // Letters taken, by player id.
  letters: Record<string, number>;
  me: string | null;
  them: { id: string; name: string } | null;
  turn: { user: string | null; kind: 'set' | 'match'; endsAt: string | null; mine: boolean; shotsLeft: number } | null;
  // The shot to match, once one's set.
  // overChair is fixed when it's set: the matcher shoots over the same chair.
  pending: { by: string; spot: HorseSpot; calls: HorseCall[]; overChair: boolean; stars: number; description: string; at: string | null } | null;
  steps: number;
  bestDay: number;
  tries: number;
  nextTryAt: number | null;
  unlocks: { kind: string; name: string; need: number; unlocked: boolean; feet: number }[];
  obstacle: { u: number; v: number } | null;
  steady: number;
  stakes: { recipe: string; name: string; bones: number; paid: boolean } | null;
  winner: string | null;
  last: HorseLiveShot | null;
  canShoot: boolean;
  // Why not, in the server's words ("Ann's turn.", "No tries ready: the
  // next comes at 10,000 steps."): shown as is.
  reason: string | null;
}

export interface HorseShotResult {
  made: boolean;
  swish: boolean;
  notNet: boolean;
  window: number;
  stars: number;
  description: string;
  highlight: boolean;
  letterTo: string | null;
  gameOver: boolean;
  winner: string | null;
  turn: HorseLive['turn'];
  message: string;
  tries: number;
}

export interface HorsePreview {
  window: number;
  stars: number;
  feet: number;
  overChair: boolean;
  description: string;
  // The server's name for the spot ("Free-throw line", "Deep top of the
  // key"), its scene, and why it can't be shot from yet (or null).
  spotName: string;
  scene: 'in' | 'out';
  locked: string | null;
}

function toLiveShot(x: any): HorseLiveShot {
  return {
    by: x?.by ?? '',
    kind: x?.kind === 'match' ? 'match' : 'set',
    spot: parseSpot(x?.spot),
    calls: parseCalls(x?.calls),
    made: !!x?.made,
    swish: !!x?.swish,
    timeout: !!x?.timeout,
    stars: num(x?.stars),
    description: x?.description ?? '',
    highlight: !!x?.highlight,
    at: x?.at ?? null,
  };
}

function toTurn(t: any): HorseLive['turn'] {
  if (!t) return null;
  return {
    user: t.user ?? null,
    kind: t.kind === 'match' ? 'match' : 'set',
    endsAt: t.ends_at ?? null,
    mine: !!t.mine,
    shotsLeft: num(t.shots_left) || 1,
  };
}

export function toHorseLive(d: any): HorseLive {
  const letters: Record<string, number> = {};
  for (const [k, n] of Object.entries((d?.letters ?? {}) as Record<string, unknown>)) letters[k] = num(n);
  return {
    handsOn: d?.hands_on !== false,
    status: d?.status === 'final' ? 'final' : 'live',
    word: d?.word === 'PIG' ? 'PIG' : 'HORSE',
    letters,
    me: d?.me ?? null,
    them: d?.them ? { id: d.them.id, name: d.them.name ?? 'Your opponent' } : null,
    turn: toTurn(d?.turn),
    pending: d?.pending
      ? {
          by: d.pending.by ?? '',
          spot: parseSpot(d.pending.spot),
          calls: parseCalls(d.pending.calls),
          overChair: !!d.pending.over_chair,
          stars: num(d.pending.stars),
          description: d.pending.description ?? '',
          at: d.pending.at ?? null,
        }
      : null,
    steps: num(d?.steps),
    bestDay: num(d?.best_day),
    tries: num(d?.tries),
    nextTryAt: d?.next_try_at == null ? null : num(d.next_try_at),
    unlocks: ((d?.unlocks ?? []) as any[]).map((u) => ({ kind: u.kind, name: u.name ?? u.kind, need: num(u.need), unlocked: !!u.unlocked, feet: num(u.feet) })),
    obstacle: d?.obstacle ? { u: num(d.obstacle.u), v: num(d.obstacle.v) } : null,
    steady: num(d?.steady) || 1,
    stakes: d?.stakes ? { recipe: d.stakes.recipe, name: d.stakes.name ?? 'a treat', bones: num(d.stakes.bones), paid: !!d.stakes.paid } : null,
    winner: d?.winner ?? null,
    last: d?.last ? toLiveShot(d.last) : null,
    canShoot: !!d?.can_shoot,
    reason: d?.reason ?? null,
  };
}

export async function getHorseLive(challengeId: string): Promise<HorseLive> {
  return toHorseLive(await rpc<any>('horse_live', { p_challenge_id: challengeId }));
}

function spotArg(spot: HorseSpot): Record<string, unknown> {
  return spot.kind === 'floor' ? { kind: 'floor', u: Math.round(spot.u * 1000) / 1000, v: Math.round(spot.v * 1000) / 1000 } : { kind: spot.kind };
}

export async function previewHorseShot(challengeId: string, spot: HorseSpot, calls: HorseCall[]): Promise<HorsePreview> {
  const d = await rpc<any>('horse_preview', { p_challenge_id: challengeId, p_spot: spotArg(spot), p_calls: calls });
  return {
    window: num(d?.window),
    stars: num(d?.stars),
    feet: num(d?.feet),
    overChair: !!d?.over_chair,
    description: d?.description ?? '',
    spotName: d?.spot_name ?? '',
    scene: d?.scene === 'out' ? 'out' : 'in',
    locked: d?.locked ?? null,
  };
}

// One shot: the meter's offset from the middle (−0.5 early/short … 0.5
// late/long). When matching, the spot and calls are the set shot's.
export async function shootHorse(challengeId: string, spot: HorseSpot, calls: HorseCall[], timing: number): Promise<HorseShotResult> {
  const d = await rpc<any>('horse_shoot', {
    p_challenge_id: challengeId,
    p_spot: spotArg(spot),
    p_calls: calls,
    p_timing: Math.max(-0.5, Math.min(0.5, Math.round(timing * 10000) / 10000)),
  });
  return {
    made: !!d?.made,
    swish: !!d?.swish,
    notNet: !!d?.not_net,
    window: num(d?.window),
    stars: num(d?.stars),
    description: d?.description ?? '',
    highlight: !!d?.highlight,
    letterTo: d?.letter_to ?? null,
    gameOver: !!d?.game_over,
    winner: d?.winner ?? null,
    turn: toTurn(d?.turn),
    message: d?.message ?? '',
    tries: num(d?.tries),
  };
}

const num = (v: unknown) => Number(v ?? 0);

export function toHorseGame(d: any): HorseGame {
  const shots = ((d.shots ?? []) as any[]).length
    ? (d.shots as any[]).map((s) => ({ id: s.id, name: s.name, target: num(s.target) }))
    : HORSE_SHOTS;
  const shotId: HorseShotId = d.shot?.id ?? 'three';
  const fallback = shots.find((s) => s.id === shotId) ?? shots[2];
  return {
    status: d.status ?? 'upcoming',
    firstDay: d.first_day ?? null,
    dayNo: num(d.day_no),
    days: num(d.days) || 14,
    word: d.word === 'PIG' ? 'PIG' : 'HORSE',
    setter: d.setter ?? null,
    me: d.me ?? null,
    players: ((d.players ?? []) as any[]).map((p) => ({
      userId: p.user_id,
      name: p.name ?? 'Someone',
      initials: p.initials ?? '?',
      iconId: p.icon_id ?? null,
      frameId: p.frame_id ?? null,
      backgroundId: p.background_id ?? null,
      letters: p.letters ?? '',
      stepsToday: num(p.steps_today),
    })),
    shot: d.shot ? { id: d.shot.id, name: d.shot.name ?? fallback.name, target: num(d.shot.target) || fallback.target } : fallback,
    shots,
    history: ((d.history ?? []) as any[]).map((h) => ({
      dayNo: num(h.day_no),
      setter: h.setter,
      shot: h.shot,
      target: num(h.target),
      setterSteps: num(h.setter_steps),
      made: !!h.made,
      matcherSteps: h.matcher_steps == null ? null : num(h.matcher_steps),
      matched: h.matched == null ? null : !!h.matched,
      letterTo: h.letter_to ?? null,
    })),
    winner: d.winner ?? null,
    handsOn: !!d.hands_on,
    live: d.live ? toHorseLive(d.live) : null,
    recent: ((d.recent ?? d.live_shots ?? []) as any[]).map(toLiveShot),
  };
}

export async function getHorse(challengeId: string): Promise<HorseGame | null> {
  const d = await rpc<any>('horse_view', { p_challenge_id: challengeId });
  return d ? toHorseGame(d) : null;
}

// Hands-on games (0209) take the stakes too: a treat recipe the loser
// bakes for the winner's hound, or none.
export async function setupHorse(challengeId: string, word: HorseWord, opts?: { handsOn?: boolean; stakes?: string | null }): Promise<void> {
  const args: Record<string, unknown> = { p_challenge_id: challengeId, p_word: word };
  if (opts?.handsOn) {
    args.p_hands_on = true;
    args.p_stakes = opts.stakes ?? null;
  }
  await rpc('horse_setup', args);
}

export async function setHorseShot(challengeId: string, shot: HorseShotId): Promise<void> {
  await rpc('horse_set_shot', { p_challenge_id: challengeId, p_shot: shot });
}

export async function advanceHorse(challengeId: string): Promise<number> {
  return num(await rpc('horse_advance', { p_challenge_id: challengeId }));
}
