import { supabase } from '../lib/supabase';
import type { WaterEntry, WaterGoal } from './water';

// Water on the server (0153_water.sql). Every call throws its message on
// failure; WaterContext decides what to do about it.

function client() {
  if (!supabase) throw new Error('Water needs a connection to Hound.');
  return supabase;
}

// Null when there's no water goal. Throws before 0153 has run, so the app
// can tell "none" from "not available yet".
export async function getWaterGoal(userId: string): Promise<WaterGoal | null> {
  const { data, error } = await client()
    .from('water_goals')
    .select('target_ml, glass_ml, units, sip_reminders')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as any;
  return { targetMl: r.target_ml, glassMl: r.glass_ml, units: r.units === 'ml' ? 'ml' : 'cups', sipReminders: !!r.sip_reminders };
}

export async function saveWaterGoal(userId: string, goal: WaterGoal): Promise<void> {
  const { error } = await client().from('water_goals').upsert(
    {
      user_id: userId,
      target_ml: goal.targetMl,
      glass_ml: goal.glassMl,
      units: goal.units,
      sip_reminders: goal.sipReminders,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(error.message);
}

export async function removeWaterGoal(userId: string): Promise<void> {
  const { error } = await client().from('water_goals').delete().eq('user_id', userId);
  if (error) throw new Error(error.message);
}

// Everything logged from `sinceDay` on, oldest first.
export async function listWaterLog(userId: string, sinceDay: string): Promise<WaterEntry[]> {
  const { data, error } = await client()
    .from('water_log')
    .select('id, day, ml, logged_at')
    .eq('user_id', userId)
    .gte('day', sinceDay)
    .order('logged_at', { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({ id: r.id, day: r.day, ml: r.ml, at: new Date(r.logged_at) }));
}

export async function logWater(day: string, ml: number): Promise<string> {
  const { data, error } = await client().rpc('log_water', { p_day: day, p_ml: Math.round(ml) });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function removeWaterEntry(id: string): Promise<void> {
  const { error } = await client().from('water_log').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// True when the day is newly counted.
export async function claimWaterDay(day: string): Promise<boolean> {
  const { data, error } = await client().rpc('claim_water_day', { p_day: day });
  if (error) throw new Error(error.message);
  return !!data;
}

export async function listWaterDays(userId: string, sinceDay: string): Promise<string[]> {
  const { data, error } = await client().from('water_days').select('day').eq('user_id', userId).gte('day', sinceDay);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { day: string }[]).map((r) => r.day);
}
