import { supabase } from '../lib/supabase';
import { isMissingFunction } from '../lib/rpcFallback';
import { displayInitials, displayName } from '../profiles/displayName';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export interface AdminUserSummary {
  id: string;
  // The real name/initials — used for the delete-confirmation alert and
  // carried into AdminUserDetailScreen, which always shows the real
  // identity behind an account regardless of that account's own
  // username preference (admin tooling is support/moderation, not
  // another player). displayName/displayInitials below are what the
  // search list itself renders, same as everywhere else a challenge
  // context shows someone else's identity.
  name: string;
  initials: string;
  displayName: string;
  displayInitials: string;
  email: string;
  isAdmin: boolean;
  lastActiveAt: string | null;
  createdAt: string;
  // From profiles.organization_id (0035_organizations.sql) — used by the
  // org-management screen's "add member" search to grey out/block anyone
  // already in an org, same constraint admin_add_org_member itself
  // enforces server-side; this is just so that shows up before the tap
  // instead of only as a thrown error after.
  organizationId: string | null;
  // This user's own equipped cosmetics (profiles.equipped_frame_id/
  // equipped_background_id/equipped_icon_id) — straight through to
  // Avatar's own props, same reasoning GitHub issue #229's first
  // fast-follow already applies to every other list of other people's
  // avatars (leaderboards, Friends, challenge participants).
  frameId: string | null;
  backgroundId: string | null;
  iconId: string | null;
}

export interface AdminUserOverview {
  activeChallengesCount: number;
  // Null means never — either genuinely no sync yet, or (per
  // admin_user_overview's own comment) this is only ever set by a
  // progress_snapshots write, so someone who's never joined a challenge
  // reads the same as someone who has one but hasn't synced.
  lastHealthSyncAt: string | null;
  // auth.users.banned_until, straight through — null/past means not
  // banned, 'infinity' or any future timestamp means banned. See
  // isBanned() below for the one bit of parsing that needs: Postgres's
  // 'infinity' timestamptz doesn't parse as a JS Date.
  bannedUntil: string | null;
}

export function isBanned(bannedUntil: string | null): boolean {
  if (!bannedUntil) return false;
  if (bannedUntil === 'infinity') return true;
  return new Date(bannedUntil).getTime() > Date.now();
}

// Platform admins only. Email addresses aren't readable by signed-in
// users (0092_hide_private_profile_columns.sql), so this goes through
// admin_search_users() (0091), which checks for an admin; before 0091 has
// run, the old direct query still works.
export async function searchUsers(query: string): Promise<AdminUserSummary[]> {
  const client = requireClient();
  const trimmed = query.trim();
  const { data: rpcRows, error: rpcError } = await client.rpc('admin_search_users', { p_query: trimmed });
  if (!rpcError) return ((rpcRows ?? []) as AdminUserRow[]).map(rowToSummary);
  if (!isMissingFunction(rpcError)) throw new Error(rpcError.message);
  let q = client
    .from('profiles')
    .select(
      'id, name, initials, username, use_username, email, is_admin, last_active_at, created_at, organization_id, equipped_frame_id, equipped_background_id, equipped_icon_id',
    )
    .order('is_admin', { ascending: false })
    .order('name', { ascending: true })
    .limit(25);
  if (trimmed) q = q.or(`name.ilike.%${trimmed}%,username.ilike.%${trimmed}%,email.ilike.%${trimmed}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as AdminUserRow[]).map(rowToSummary);
}

interface AdminUserRow {
  id: string;
  name: string;
  initials: string;
  username: string | null;
  use_username: boolean;
  email: string;
  is_admin: boolean;
  last_active_at: string | null;
  created_at: string;
  organization_id: string | null;
  equipped_frame_id: string | null;
  equipped_background_id: string | null;
  equipped_icon_id: string | null;
}

function rowToSummary(row: AdminUserRow): AdminUserSummary {
  const displayable = { name: row.name, username: row.username, useUsername: row.use_username };
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    displayName: displayName(displayable),
    displayInitials: displayInitials({ ...displayable, initials: row.initials }),
    email: row.email,
    isAdmin: row.is_admin,
    lastActiveAt: row.last_active_at,
    createdAt: row.created_at,
    organizationId: row.organization_id,
    frameId: row.equipped_frame_id,
    backgroundId: row.equipped_background_id,
    iconId: row.equipped_icon_id,
  };
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
  banned_until: string | null;
}

export async function getUserOverview(userId: string): Promise<AdminUserOverview> {
  const client = requireClient();
  const { data, error } = await client.rpc('admin_user_overview', { target_user_id: userId }).single();
  if (error) throw new Error(error.message);
  const row = data as unknown as AdminUserOverviewRow;
  return {
    activeChallengesCount: Number(row.active_challenges_count ?? 0),
    lastHealthSyncAt: row.last_health_sync_at,
    bannedUntil: row.banned_until,
  };
}

// durationDays omitted (or 'forever') falls through to admin_ban_user's
// own default — a 100-year ban_duration, not literal SQL NULL passed as
// an interval, which PostgREST can't cast — see 0031_admin_ban_user.sql.
export async function banUser(userId: string, durationDays?: number): Promise<void> {
  const client = requireClient();
  const params: { target_user_id: string; ban_duration?: string } = { target_user_id: userId };
  if (durationDays != null) params.ban_duration = `${durationDays} days`;
  const { error } = await client.rpc('admin_ban_user', params);
  if (error) throw new Error(error.message);
}

export async function unbanUser(userId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('admin_unban_user', { target_user_id: userId });
  if (error) throw new Error(error.message);
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
