export type OrganizationKind = 'school' | 'company';

export interface Organization {
  id: string;
  name: string;
  kind: OrganizationKind;
  // Only ever readable by that org's own members/admins and platform
  // admins — see organizations' own RLS in 0035_organizations.sql — so
  // this being present on a fetched Organization already implies the
  // caller was allowed to see it.
  inviteCode: string;
  createdBy: string | null;
  createdAt: string;
  // This org's own name for Bones (0060_bones_shop.sql's own column,
  // 0068_org_currency_name.sql's first writer) — null means it's never
  // set one, so every display falls back to "Bones" (see
  // currencyNameOrDefault below).
  currencyName: string | null;
}

// The one place "fall back to Bones" is spelled out — every screen that
// shows the currency name calls this instead of reading currencyName
// directly, so a future rename of the fallback itself (or a decision to
// source it differently) only has one call site to change.
export function currencyNameOrDefault(currencyName: string | null | undefined): string {
  return currencyName ?? 'Bones';
}

// One row of listOrgMembers — profiles.select is open to any signed-in
// user (0001_challenges_schema.sql), same as adminApi.ts's own
// AdminUserSummary, just scoped to one org and carrying org_role instead
// of the platform-wide is_admin flag.
export interface OrgMember {
  id: string;
  name: string;
  initials: string;
  displayName: string;
  displayInitials: string;
  email: string;
  orgRole: 'member' | 'admin';
}
