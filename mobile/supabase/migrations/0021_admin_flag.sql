-- Hound: the first sliver of admin support — a flag marking specific
-- accounts as able to do more than everyone else, so features that
-- genuinely need that distinction (global usage metrics, editing the
-- shared Chase labels without every signed-in user being able to — see
-- 0015_app_labels.sql's own comment calling out exactly this as real
-- follow-up work) have something real to check. Deliberately just the
-- flag itself here — no screen actually branches on it yet; that's
-- follow-up work once there's a first feature that needs it.
--
-- No in-app way to grant this, on purpose — the whole point is that a
-- regular signed-in user, including through the app's own client, can
-- never make themselves an admin. Run this directly in the SQL Editor
-- to promote someone:
--   update public.profiles set is_admin = true where email = 'you@example.com';
--
-- The revoke below is what actually enforces that: it's a Postgres
-- column-level privilege, layered underneath RLS's row-level policies,
-- not on top of them — "Users can update their own profile"
-- (0001_challenges_schema.sql) still lets someone update their own row,
-- but the authenticated/anon roles the app's client always connects as
-- now categorically cannot write to this one column regardless, the same
-- way RLS restricts which *rows* they can touch. Only a connection that
-- bypasses grants entirely (the SQL Editor, or the service_role key) can
-- flip it.
--
-- Run this once, after 0001-0020, in the SQL Editor.

alter table public.profiles add column is_admin boolean not null default false;

revoke update (is_admin) on public.profiles from authenticated, anon;
