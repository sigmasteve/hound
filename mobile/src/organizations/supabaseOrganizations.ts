import { supabase } from '../lib/supabase';
import type { HuntLabels } from '../labels/types';
import type { Organization, OrganizationKind } from './types';

// The first backend-facing client API for the organization/cross-tenancy
// model — see 0035_organizations.sql / 0036_organization_labels.sql /
// 0037_challenge_org_scope.sql and GitHub issue #158 for the schema and
// design this wraps. No screen calls any of this yet — an org-management
// screen, an invite-redemption screen, and the Create wizard's org-vs-
// global friend picker are all real follow-up work once this backend
// foundation is in place, same "the flag exists before a screen needs
// it" shape is_admin (0021_admin_flag.sql) was built with.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

interface OrganizationRow {
  id: string;
  name: string;
  kind: OrganizationKind;
  invite_code: string;
  created_by: string | null;
  created_at: string;
}

function rowToOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    inviteCode: row.invite_code,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// RLS already restricts this to an org's own members/admins and platform
// admins (see 0035_organizations.sql) — a null result here means either
// the org doesn't exist or the caller isn't allowed to see it, which
// this deliberately doesn't distinguish, same as any other RLS-gated
// single-row fetch elsewhere in this app.
export async function getOrganization(id: string): Promise<Organization | null> {
  const client = requireClient();
  const { data, error } = await client.from('organizations').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToOrganization(data) : null;
}

// Platform-admin only (enforced server-side by admin_create_organization)
// — returns the new org's id so the caller can immediately bootstrap its
// first member via addOrgMember below.
export async function createOrganization(name: string, kind: OrganizationKind): Promise<string> {
  const client = requireClient();
  const { data, error } = await client.rpc('admin_create_organization', { name, kind });
  if (error) throw new Error(error.message);
  return data as string;
}

// The bootstrap/override path — platform-admin only. See
// admin_add_org_member's own comment in 0035_organizations.sql for why
// this is separate from redeemOrganizationInvite below.
export async function addOrgMember(
  targetUserId: string,
  organizationId: string,
  role: 'member' | 'admin' = 'member',
): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('admin_add_org_member', {
    target_user_id: targetUserId,
    organization_id: organizationId,
    role,
  });
  if (error) throw new Error(error.message);
}

// Self-serve join by code — throws if the caller is already in an
// organization (see redeem_organization_invite's own comment: leave
// first, no direct A→B move yet). Returns the joined org's id.
export async function redeemOrganizationInvite(code: string): Promise<string> {
  const client = requireClient();
  const { data, error } = await client.rpc('redeem_organization_invite', { code });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function leaveOrganization(): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('leave_organization');
  if (error) throw new Error(error.message);
}

// Callable by a platform admin, or by an existing admin of the same org
// promoting/demoting a fellow member — enforced server-side.
export async function setOrgMemberRole(targetUserId: string, role: 'member' | 'admin'): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('org_set_member_role', { target_user_id: targetUserId, role });
  if (error) throw new Error(error.message);
}

export async function regenerateOrgInviteCode(organizationId: string): Promise<string> {
  const client = requireClient();
  const { data, error } = await client.rpc('admin_regenerate_org_invite_code', { organization_id: organizationId });
  if (error) throw new Error(error.message);
  return data as string;
}

// Null means this org has never set its own labels — a future
// LabelsContext change should fall back to the existing global
// app_labels default in that case (see 0036_organization_labels.sql's
// own comment), not treat it as an error.
export async function getOrgLabels(organizationId: string): Promise<HuntLabels | null> {
  const client = requireClient();
  const { data, error } = await client
    .from('organization_labels')
    .select('hunter_label, hunted_label, zombie_label')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { hunter: data.hunter_label, hunted: data.hunted_label, zombie: data.zombie_label } : null;
}

// Callable by that org's own admin or a platform admin — enforced
// server-side. Upserts (org_set_labels), so this works the first time
// an org sets labels just as well as every time after.
export async function setOrgLabels(organizationId: string, labels: HuntLabels): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('org_set_labels', {
    organization_id: organizationId,
    hunter_label: labels.hunter,
    hunted_label: labels.hunted,
    zombie_label: labels.zombie,
  });
  if (error) throw new Error(error.message);
}
