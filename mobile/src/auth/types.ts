export type AuthProviderId = 'google' | 'facebook' | 'apple' | 'email';

export interface AuthUser {
  // The real Supabase auth.users id when signed in via supabaseAuth.ts —
  // src/challenges/present.ts needs this to tell "me" apart from other
  // participants. mockAuth.ts sets a placeholder since nothing real
  // reads challenge data on that path (isSupabaseConfigured gates it).
  id: string;
  name: string;
  email: string;
  initials: string;
  provider: AuthProviderId;
  // From profiles.is_admin (see 0021_admin_flag.sql) — false for every
  // account until someone sets it directly in the database; there's no
  // in-app way to become an admin, on purpose. Nothing branches on this
  // yet — it exists so a feature that needs "is this signed-in user an
  // admin" has a real answer to check, not a screen this session builds.
  isAdmin: boolean;
  // From profiles.username / use_username (see 0030_username.sql) —
  // optional (not every backend populates them) rather than required
  // like the fields above, so mockAuth.ts's placeholder users don't need
  // updating just to carry an always-null/false pair. See
  // src/profiles/displayName.ts for where these actually get used.
  username?: string | null;
  useUsername?: boolean;
  // From profiles.organization_id / org_role (see
  // 0035_organizations.sql) — null/undefined means an "individual"
  // profile with no org. There's no in-app way to set these directly
  // either (same revoked-column shape as is_admin): they only change via
  // the RPCs in src/organizations/supabaseOrganizations.ts. See GitHub
  // issue #158 for the design this is the first piece of.
  organizationId?: string | null;
  orgRole?: 'member' | 'admin' | null;
}

export type AuthStatus = 'signedOut' | 'signedIn';

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}
