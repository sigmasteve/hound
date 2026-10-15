import { supabase } from '../lib/supabase';
import type { Goal, GoalDraft } from './goals';

// Goals and hound settings on the server (0097_goals.sql). Every call
// throws on failure; GoalsContext decides what to do about it.

export type HoundLevel = 'off' | 'gentle' | 'persistent' | 'relentless';
export const DEFAULT_HOUND_LEVEL: HoundLevel = 'gentle';

function rowToGoal(r: any): Goal {
  return {
    id: r.id,
    metric: r.metric,
    period: r.period,
    target: Number(r.target),
    activity: r.activity ?? null,
    label: r.label ?? null,
    sort: r.sort ?? 0,
  };
}

function client() {
  if (!supabase) throw new Error('Goals need a connection to Hound.');
  return supabase;
}

// Adds the starter goals if this person has never had any, and says
// whether the account is new (under a week old).
export async function ensureStarterGoals(steps: number, distanceMi: number): Promise<boolean> {
  const { data, error } = await client().rpc('ensure_starter_goals', { p_steps: Math.round(steps), p_distance_mi: distanceMi });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function listGoals(userId: string): Promise<Goal[]> {
  const { data, error } = await client()
    .from('goals')
    .select('id, metric, period, target, activity, label, sort')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('sort')
    .order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToGoal);
}

export async function addGoal(userId: string, draft: GoalDraft, sort: number): Promise<Goal> {
  const { data, error } = await client()
    .from('goals')
    .insert({
      user_id: userId,
      metric: draft.metric,
      period: draft.period,
      target: draft.target,
      activity: draft.activity,
      label: draft.label?.trim() || null,
      sort,
    })
    .select('id, metric, period, target, activity, label, sort')
    .single();
  if (error) throw new Error(error.message);
  return rowToGoal(data);
}

export async function updateGoal(goalId: string, patch: Partial<GoalDraft>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.target !== undefined) row.target = patch.target;
  if (patch.label !== undefined) row.label = patch.label?.trim() || null;
  if (patch.period !== undefined) row.period = patch.period;
  if (patch.activity !== undefined) row.activity = patch.activity;
  const { error } = await client().from('goals').update(row).eq('id', goalId);
  if (error) throw new Error(error.message);
}

// Archived rather than deleted, so ensure_starter_goals still knows this
// person has had goals before.
export async function removeGoal(goalId: string): Promise<void> {
  const { error } = await client().from('goals').update({ archived_at: new Date().toISOString() }).eq('id', goalId);
  if (error) throw new Error(error.message);
}

export async function getHoundSettings(
  userId: string,
): Promise<{ level: HoundLevel; scheduledThrough: string | null; goalsSetAt: string | null; saved: boolean }> {
  const { data, error } = await client()
    .from('hound_settings')
    .select('level, scheduled_through, goals_set_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    level: (data?.level as HoundLevel) ?? DEFAULT_HOUND_LEVEL,
    scheduledThrough: data?.scheduled_through ?? null,
    goalsSetAt: data?.goals_set_at ?? null,
    saved: !!data,
  };
}

export async function saveHoundSettings(
  userId: string,
  patch: { level?: HoundLevel; scheduledThrough?: string | null; goalsSetAt?: string },
): Promise<void> {
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  if (patch.level !== undefined) row.level = patch.level;
  if (patch.scheduledThrough !== undefined) row.scheduled_through = patch.scheduledThrough;
  if (patch.goalsSetAt !== undefined) row.goals_set_at = patch.goalsSetAt;
  const { error } = await client().from('hound_settings').upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}
