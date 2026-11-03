import { supabase } from '../lib/supabase';

// Admin → Water (0154_admin_water_overview.sql): how many people use the
// water tracker (0153), and how.
export interface WaterOverview {
  withGoal: number;
  active: number;
  activeWithGoal: number;
  added7d: number;
  cups: number;
  ml: number;
  sipReminders: number;
  logged24h: number;
  logged7d: number;
  glasses7d: number;
  avgDayMl: number;
  waterDays7d: number;
  badges: { first: number; seven: number; thirty: number };
  newest: { name: string; addedAt: string }[];
}

export async function getWaterOverview(): Promise<WaterOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_water_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    withGoal: n(d.with_goal),
    active: n(d.active),
    activeWithGoal: n(d.active_with_goal),
    added7d: n(d.added_7d),
    cups: n(d.cups),
    ml: n(d.ml),
    sipReminders: n(d.sip_reminders),
    logged24h: n(d.logged_24h),
    logged7d: n(d.logged_7d),
    glasses7d: n(d.glasses_7d),
    avgDayMl: n(d.avg_day_ml),
    waterDays7d: n(d.water_days_7d),
    badges: { first: n(d.badges?.water_first), seven: n(d.badges?.water_7), thirty: n(d.badges?.water_30) },
    newest: ((d.newest ?? []) as any[]).map((r) => ({ name: r.name ?? 'Someone', addedAt: r.added_at })),
  };
}
