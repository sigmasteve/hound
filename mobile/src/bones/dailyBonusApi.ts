import { supabase } from '../lib/supabase';

export interface DailyBonusResult {
  // False when today's bonus was already claimed — every later call the
  // same day is a harmless no-op, so callers can fire this on every
  // open/focus/resume without tracking "did I already claim" themselves.
  awarded: boolean;
  bonesAwarded: number;
  streak: number;
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The caller's own local date, not UTC — "once a day" rolls over at the
// user's midnight. claim_daily_bonus (0070_daily_bonus.sql) bounds and
// de-duplicates it server-side; see that migration for why a spoofed
// clock can't stack claims.
export async function claimDailyBonus(): Promise<DailyBonusResult> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('claim_daily_bonus', { p_local_date: localDateKey(new Date()) }).single();
  if (error) throw new Error(error.message);
  const row = data as { awarded: boolean; bones_awarded: number; streak: number };
  return { awarded: row.awarded, bonesAwarded: row.bones_awarded, streak: row.streak };
}
