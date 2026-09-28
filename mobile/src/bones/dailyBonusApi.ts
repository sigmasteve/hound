import { supabase } from '../lib/supabase';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export interface DailyBonusResult {
  // False when today's bonus was already claimed — every later call the
  // same day is a harmless no-op, so callers can fire this on every
  // open/focus/resume without tracking "did I already claim" themselves.
  awarded: boolean;
  bonesAwarded: number;
  streak: number;
  // What tomorrow's claim pays if the streak continues, and the current
  // every-7th-day amount — both from the admin-editable config, so the
  // popup and tomorrow's reminder never hardcode either.
  nextBones: number;
  weeklyBones: number;
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The caller's own local date, not UTC — "once a day" rolls over at the
// user's midnight. claim_daily_bonus (0070_daily_bonus.sql) bounds and
// de-duplicates it server-side; see that migration for why a spoofed
// clock can't stack claims.
export async function claimDailyBonus(): Promise<DailyBonusResult> {
  const { data, error } = await requireClient()
    .rpc('claim_daily_bonus', { p_local_date: localDateKey(new Date()) })
    .single();
  if (error) throw new Error(error.message);
  const row = data as { awarded: boolean; bones_awarded: number; streak: number; next_bones: number; weekly_bones: number };
  return {
    awarded: row.awarded,
    bonesAwarded: row.bones_awarded,
    streak: row.streak,
    nextBones: row.next_bones,
    weeklyBones: row.weekly_bones,
  };
}

export interface DailyBonusConfig {
  dailyBones: number;
  weeklyBones: number;
}

export async function getDailyBonusConfig(): Promise<DailyBonusConfig> {
  const { data, error } = await requireClient()
    .from('daily_bonus_config')
    .select('daily_bones, weekly_bones')
    .eq('id', true)
    .single();
  if (error) throw new Error(error.message);
  return { dailyBones: data.daily_bones, weeklyBones: data.weekly_bones };
}

// Admin-only — daily_bonus_config's own RLS is the real enforcement.
export async function setDailyBonusConfig(config: DailyBonusConfig): Promise<void> {
  const { error } = await requireClient()
    .from('daily_bonus_config')
    .update({ daily_bones: config.dailyBones, weekly_bones: config.weeklyBones, updated_at: new Date().toISOString() })
    .eq('id', true);
  if (error) throw new Error(error.message);
}
