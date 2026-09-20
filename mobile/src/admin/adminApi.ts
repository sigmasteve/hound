import { supabase } from '../lib/supabase';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export interface AdminUserSummary {
  id: string;
  name: string;
  initials: string;
  email: string;
  isAdmin: boolean;
  lastActiveAt: string | null;
  createdAt: string;
}

export interface AdminUserOverview {
  activeChallengesCount: number;
  // Null means never — either genuinely no sync yet, or (per
  // admin_user_overview's own comment) this is only ever set by a
  // progress_snapshots write, so someone who's never joined a challenge
  // reads the same as someone who has one but hasn't synced.
  lastHealthSyncAt: string | null;
}

// profiles.select is open to any signed-in user (0001_challenges_schema.sql)
// so this is a plain client-side query, same as supabaseFriends.ts's own
// email lookup — no RPC needed for search or the platform-wide count.
export async function searchUsers(query: string): Promise<AdminUserSummary[]> {
  const client = requireClient();
  const trimmed = query.trim();
  let q = client
    .from('profiles')
    .select('id, name, initials, email, is_admin, last_active_at, created_at')
    .order('is_admin', { ascending: false })
    .order('name', { ascending: true })
    .limit(25);
  if (trimmed) q = q.or(`name.ilike.%${trimmed}%,email.ilike.%${trimmed}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    initials: row.initials,
    email: row.email,
    isAdmin: row.is_admin,
    lastActiveAt: row.last_active_at,
    createdAt: row.created_at,
  }));
}

export async function getTotalUserCount(): Promise<number> {
  const client = requireClient();
  const { count, error } = await client.from('profiles').select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

interface AdminUserOverviewRow {
  active_challenges_count: number | string | null;
  last_health_sync_at: string | null;
}

export async function getUserOverview(userId: string): Promise<AdminUserOverview> {
  const client = requireClient();
  const { data, error } = await client.rpc('admin_user_overview', { target_user_id: userId }).single();
  if (error) throw new Error(error.message);
  const row = data as unknown as AdminUserOverviewRow;
  return {
    activeChallengesCount: Number(row.active_challenges_count ?? 0),
    lastHealthSyncAt: row.last_health_sync_at,
  };
}

// Deleting an auth.users row needs the service role key (auth.admin.* is
// never something the app's own anon/publishable key can do — same
// reasoning as every other admin.* Supabase API), so this goes through
// the admin-delete-user Edge Function rather than a direct client call.
// profiles.id cascades off auth.users (0001_challenges_schema.sql), so
// the function only has to delete the auth user — everything hanging off
// their profile row (friendships, kudos, progress_snapshots, challenges
// they only participated in) cascades with it. See that function's own
// comment for the one thing that doesn't cascade: challenges they
// *created*, which blocks the delete with a clear error instead of
// silently destroying other people's shared challenge data.
export async function deleteUser(userId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.functions.invoke('admin-delete-user', { body: { userId } });
  if (error) {
    // A non-2xx response only ever surfaces as this generic message
    // (FunctionsHttpError) unless the actual JSON body — where
    // admin-delete-user's real "why" lives, e.g. the created-challenges
    // block — is read back out of it.
    const context = (error as { context?: Response }).context;
    const detail = await context
      ?.clone()
      .json()
      .then((body) => (typeof body?.error === 'string' ? body.error : null))
      .catch(() => null);
    throw new Error(detail ?? error.message);
  }
}
