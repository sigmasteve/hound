import { supabase } from '../lib/supabase';
import { DEFAULT_SPORT_BONUS_CONFIG, type SportBonusConfig } from './sportBonus';

// Sport bonuses (0198_sport_bonuses.sql): who had a strength workout or
// played the real sport on a game's day, and Admin's numbers.

export interface SportBonusPlayer {
  userId: string;
  strengthMin: number;
  strength: number;
  gameDay: boolean;
  gameDayMin: number;
  workout: string | null;
}

export interface SportBonusDay {
  day: string;
  sport: string;
  enabled: boolean;
  players: SportBonusPlayer[];
}

function client() {
  if (!supabase) throw new Error('Not connected to Hound.');
  return supabase;
}

const num = (v: unknown) => Number(v ?? 0);

// Null day: the game's current day.
export async function getSportBonuses(challengeId: string, day?: string | null): Promise<SportBonusDay> {
  const { data, error } = await client().rpc('sport_bonuses', { p_challenge_id: challengeId, p_day: day ?? null });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  return {
    day: d.day,
    sport: d.sport ?? '',
    enabled: d.enabled !== false,
    players: ((d.players ?? []) as any[]).map((p) => ({
      userId: p.user_id,
      strengthMin: num(p.strength_min),
      strength: num(p.strength),
      gameDay: !!p.game_day,
      gameDayMin: num(p.game_day_min),
      workout: p.workout ?? null,
    })),
  };
}

// The amounts, for the words (readable by anyone signed in).
export async function getSportBonusConfig(): Promise<SportBonusConfig> {
  const { data, error } = await client().from('sport_bonus_config').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return { ...DEFAULT_SPORT_BONUS_CONFIG, ...((data ?? {}) as Partial<SportBonusConfig>) };
}

// ── Admin ──

export interface SportBonusOverview {
  config: SportBonusConfig;
  strength7d: number;
  strengthPeople7d: number;
  gameDays7d: number;
  gameDayPeople7d: number;
  bySport: Record<string, number>;
}

export async function getSportBonusOverview(): Promise<SportBonusOverview> {
  const { data, error } = await client().rpc('admin_sport_bonus_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  return {
    config: { ...DEFAULT_SPORT_BONUS_CONFIG, ...(d.config ?? {}) },
    strength7d: num(d.strength_7d),
    strengthPeople7d: num(d.strength_people_7d),
    gameDays7d: num(d.game_days_7d),
    gameDayPeople7d: num(d.game_day_people_7d),
    bySport: Object.fromEntries(Object.entries((d.by_sport ?? {}) as Record<string, unknown>).map(([k, v]) => [k, num(v)])),
  };
}

export async function setSportBonusConfig(patch: Partial<SportBonusConfig>): Promise<void> {
  const { error } = await client().rpc('admin_set_sport_bonus_config', { p: patch });
  if (error) throw new Error(error.message);
}

export function sportBonusSummary(o: SportBonusOverview): string {
  return `${o.strength7d} strength ${o.strength7d === 1 ? 'bonus' : 'bonuses'} · ${o.gameDays7d} game ${o.gameDays7d === 1 ? 'day' : 'days'} this week`;
}
