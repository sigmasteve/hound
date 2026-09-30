import { supabase } from '../lib/supabase';

// Admin → Push reach: who a server push can actually get to
// (0081_push_permission.sql).
//   reachable     a phone is registered — pushes arrive
//   pending       allowed on their phone, registers on their next open
//   denied        turned off on their phone
//   not_asked     their phone has never been asked
//   unknown       their app hasn't reported yet (an older update)
export type PushReach = 'reachable' | 'pending' | 'denied' | 'not_asked' | 'unknown';

export interface PushReachRow {
  userId: string;
  name: string;
  reach: PushReach;
}

export const REACH_ORDER: PushReach[] = ['reachable', 'pending', 'not_asked', 'denied', 'unknown'];

export const REACH_LABEL: Record<PushReach, string> = {
  reachable: 'Can get push',
  pending: 'Allowed — registers next open',
  not_asked: 'Not asked yet',
  denied: 'Turned off on their phone',
  unknown: 'Not reported yet',
};

export const REACH_NOTE: Record<PushReach, string> = {
  reachable: 'Friend requests, turns, standings and reminders reach them.',
  pending: 'Their phone allows it; the app registers it the next time they open Hound.',
  not_asked: 'Today asks them once they have a friend or a challenge.',
  denied: 'Only their phone’s Settings can turn it back on — Hound’s Settings shows them how.',
  unknown: 'Their app predates this — they’ll show up after opening the latest update.',
};

export function pushReach(permission: string | null, hasToken: boolean): PushReach {
  if (hasToken) return 'reachable';
  if (permission === 'granted') return 'pending';
  if (permission === 'denied') return 'denied';
  if (permission === 'undetermined') return 'not_asked';
  return 'unknown';
}

export async function listPushReach(): Promise<PushReachRow[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('admin_push_reach');
  if (error) throw new Error(error.message);
  return ((data ?? []) as { user_id: string; name: string; push_permission: string | null; has_token: boolean }[]).map(
    (r) => ({ userId: r.user_id, name: r.name, reach: pushReach(r.push_permission, r.has_token) }),
  );
}

// One person, for their admin detail page. Null if it can't be loaded.
export async function getUserPushReach(userId: string): Promise<PushReach | null> {
  try {
    return (await listPushReach()).find((r) => r.userId === userId)?.reach ?? null;
  } catch {
    return null;
  }
}
