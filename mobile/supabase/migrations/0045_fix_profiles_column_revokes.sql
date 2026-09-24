-- Fixes a real, live security gap found while testing 0044's own
-- column-level revoke: `revoke update (col) on t from authenticated`
-- cannot narrow a role's existing TABLE-level UPDATE grant — Postgres
-- tracks column- and table-level ACLs separately, and the broader one
-- always wins. Supabase's own default project template already grants
-- `authenticated` a blanket UPDATE on every public table, specifically
-- so RLS alone is meant to be the real gate — nothing in this repo's
-- own migrations ever grants that access itself, so it can only be
-- coming from there. Verified locally (a throwaway Postgres with a
-- hand-rolled stand-in for auth.users/auth.uid()/authenticated+anon,
-- same method 0044's own commit message describes): a direct client
-- update of a "revoked" column succeeded anyway.
--
-- This affects three previously-merged columns on public.profiles,
-- each using exactly this (non-functional) pattern:
--   - is_admin (0021_admin_flag.sql) — the platform-admin flag itself.
--     If this was ever actually exploitable, it means any signed-in
--     user could PATCH their own is_admin to true directly.
--   - is_default_friend (0034_default_first_friend.sql) — lower
--     stakes, but the same real gap.
--   - organization_id, org_role (0035_organizations.sql) — forging
--     your way into any organization, or granting yourself its admin
--     role, without ever going through redeem_organization_invite or
--     an actual admin's own RPCs.
--
-- The fix is the same one 0044 itself landed with: revoke UPDATE on
-- the whole table first, then explicitly re-grant only the columns
-- real client code updates directly today (everything else this repo
-- writes to profiles already goes through a security-definer RPC, so
-- nothing else needs a grant at all) — deny-by-default rather than
-- allow-all-minus-a-few. is_admin/is_default_friend/organization_id/
-- org_role are deliberately left off this list: there is still no
-- in-app way to set any of them directly, same as originally intended,
-- except this now actually holds.
--
-- Run this once, after 0044, in the SQL Editor.

revoke update on public.profiles from authenticated, anon;

grant update (
  username,
  use_username,
  notify_push_enabled,
  notify_email_enabled,
  alert_stale_data_push_enabled,
  alert_stale_data_email_enabled,
  alert_daily_standings_push_enabled,
  alert_daily_standings_email_enabled,
  last_active_at
) on public.profiles to authenticated;
