import { supabase } from '../lib/supabase';
import { localDayKey } from './goals';

// Goal streaks and the Bones they pay (0099_goal_streaks.sql). The phone
// says a day or week is done; the server decides whether it's new, how
// long the streak is and what it pays. Every call throws on failure.

export interface GoalStreak {
  // Goal days in a row, counting today or yesterday; 0 once it's broken.
  streak: number;
  best: number;
  hitToday: boolean;
  weekPaid: boolean;
  // What today's goal day pays (0 once it's paid), and a goal week.
  nextBones: number;
  weekBones: number;
}

export interface GoalDayClaim {
  awarded: boolean;
  bonesAwarded: number;
  streak: number;
  best: number;
}

function client() {
  if (!supabase) throw new Error('Goals need a connection to Hound.');
  return supabase;
}

export async function getGoalStreak(): Promise<GoalStreak> {
  const { data, error } = await client().rpc('my_goal_streak', { p_local_date: localDayKey(new Date()) }).single();
  if (error) throw new Error(error.message);
  const r = data as any;
  return {
    streak: r.streak,
    best: r.best_streak,
    hitToday: r.hit_today,
    weekPaid: r.week_paid,
    nextBones: r.next_bones,
    weekBones: r.week_bones,
  };
}

export async function claimGoalDay(): Promise<GoalDayClaim> {
  const { data, error } = await client().rpc('claim_goal_day', { p_local_date: localDayKey(new Date()) }).single();
  if (error) throw new Error(error.message);
  const r = data as any;
  return { awarded: r.awarded, bonesAwarded: r.bones_awarded, streak: r.streak, best: r.best_streak };
}

export async function claimGoalWeek(): Promise<{ awarded: boolean; bonesAwarded: number }> {
  const { data, error } = await client().rpc('claim_goal_week', { p_local_date: localDayKey(new Date()) }).single();
  if (error) throw new Error(error.message);
  const r = data as any;
  return { awarded: r.awarded, bonesAwarded: r.bones_awarded };
}

export interface GoalRewardConfig {
  dayBones: number;
  streakBones: number;
  weekBones: number;
}

export async function getGoalRewardConfig(): Promise<GoalRewardConfig> {
  const { data, error } = await client()
    .from('goal_reward_config')
    .select('day_bones, streak_bones, week_bones')
    .eq('id', true)
    .single();
  if (error) throw new Error(error.message);
  return { dayBones: data.day_bones, streakBones: data.streak_bones, weekBones: data.week_bones };
}

// Admin only: goal_reward_config's own RLS is the real check.
export async function setGoalRewardConfig(c: GoalRewardConfig): Promise<void> {
  const { error } = await client()
    .from('goal_reward_config')
    .update({ day_bones: c.dayBones, streak_bones: c.streakBones, week_bones: c.weekBones, updated_at: new Date().toISOString() })
    .eq('id', true);
  if (error) throw new Error(error.message);
}

// Which claims a set of goal progress has earned: every daily goal done,
// and every weekly goal done. False when there are none of that kind.
export function goalsEarned(progress: { goal: { period: 'day' | 'week' }; done: boolean }[]): { day: boolean; week: boolean } {
  const all = (period: 'day' | 'week') => {
    const ofPeriod = progress.filter((p) => p.goal.period === period);
    return ofPeriod.length > 0 && ofPeriod.every((p) => p.done);
  };
  return { day: all('day'), week: all('week') };
}
