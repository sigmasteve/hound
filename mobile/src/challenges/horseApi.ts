import { supabase } from '../lib/supabase';
import { HORSE_SHOTS, type HorseShotId, type HorseWord } from './hoops';

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
  };
}

export async function getHorse(challengeId: string): Promise<HorseGame | null> {
  const d = await rpc<any>('horse_view', { p_challenge_id: challengeId });
  return d ? toHorseGame(d) : null;
}

export async function setupHorse(challengeId: string, word: HorseWord): Promise<void> {
  await rpc('horse_setup', { p_challenge_id: challengeId, p_word: word });
}

export async function setHorseShot(challengeId: string, shot: HorseShotId): Promise<void> {
  await rpc('horse_set_shot', { p_challenge_id: challengeId, p_shot: shot });
}

export async function advanceHorse(challengeId: string): Promise<number> {
  return num(await rpc('horse_advance', { p_challenge_id: challengeId }));
}
