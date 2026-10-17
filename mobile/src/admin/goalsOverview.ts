import { supabase } from '../lib/supabase';

// Admin → Goals (0098_admin_goals_overview.sql, with streaks from
// 0099_goal_streaks.sql): how goals and the Hound are being used, over
// everyone who's opened Hound in the last 14 days.
export interface GoalsOverview {
  active: number;
  goalsSet: number;
  customGoals: number;
  levels: { gentle: number; persistent: number; relentless: number; off: number };
  phoneScheduled: number;
  backups24h: number;
  stepsHit: number;
  stepsTracked: number;
  streaking: number;
  goalDays7d: number;
}

export async function getGoalsOverview(): Promise<GoalsOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_goals_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    active: n(d.active),
    goalsSet: n(d.goals_set),
    customGoals: n(d.custom_goals),
    levels: {
      gentle: n(d.levels?.gentle),
      persistent: n(d.levels?.persistent),
      relentless: n(d.levels?.relentless),
      off: n(d.levels?.off),
    },
    phoneScheduled: n(d.phone_scheduled),
    backups24h: n(d.backups_24h),
    stepsHit: n(d.steps_hit),
    stepsTracked: n(d.steps_tracked),
    streaking: n(d.streaking),
    goalDays7d: n(d.goal_days_7d),
  };
}
