import { supabase } from '../lib/supabase';

// Achievements — see 0072_achievements.sql. The server decides what's
// earned (check_achievements evaluates every condition from its own
// data); the client only asks "anything new?" and reads the results.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  bones: number;
}

export interface NewlyEarnedAchievement {
  id: string;
  name: string;
  bones: number;
}

// Awards anything newly earned (and its Bones) and returns just those —
// empty on almost every call. Safe to call on every Home load.
export async function checkAchievements(): Promise<NewlyEarnedAchievement[]> {
  const { data, error } = await requireClient().rpc('check_achievements');
  if (error) throw new Error(error.message);
  return ((data ?? []) as { achievement_id: string; name: string; bones: number }[]).map((r) => ({
    id: r.achievement_id,
    name: r.name,
    bones: r.bones,
  }));
}

export async function listAchievements(): Promise<Achievement[]> {
  const { data, error } = await requireClient()
    .from('achievements')
    .select('id, name, description, bones')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Achievement[];
}

// Achievement id -> when it was earned. Works for the viewer's own id and
// for an accepted friend's (0072's select policy); anyone else reads empty.
export async function listEarnedAchievements(userId: string): Promise<Map<string, string>> {
  const { data, error } = await requireClient()
    .from('user_achievements')
    .select('achievement_id, earned_at')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [r.achievement_id as string, r.earned_at as string]));
}
