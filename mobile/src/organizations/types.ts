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
}
