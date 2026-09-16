-- Hound: "did you log in today" tracking + a daily reminder for anyone
-- who hasn't, sent before the day is over.
--
-- Three pieces:
--   1. profiles gets a last_active_at the client touches on every app
--      open (not just a fresh sign-in — see src/auth/AuthContext.tsx),
--      plus per-user on/off switches for the two reminder channels.
--   2. device_push_tokens: one row per device that's registered for
--      push, so a user with two phones gets both nudged.
--   3. pg_cron + pg_net calling the send-login-reminders Edge Function
--      once a day. See that function for the actual send logic.
--
-- Run this once, after 0001-0009, in the SQL Editor.

alter table public.profiles
  add column last_active_at timestamptz,
  add column notify_push_enabled boolean not null default true,
  add column notify_email_enabled boolean not null default true,
  -- Guards against double-sending if the cron job below ever fires twice
  -- in the same day (a re-run after a transient failure, for instance) —
  -- send-login-reminders sets this after processing a user and re-checks
  -- it, rather than relying on the schedule alone to be exactly-once.
  add column last_login_reminder_sent_at timestamptz;

-- profiles' existing "Users can update their own profile" policy (see
-- 0001_challenges_schema.sql) has no explicit `with check`, which
-- Postgres defaults to the `using` clause (auth.uid() = id) — so these
-- new columns are already covered by it for the client updates in
-- src/notifications/supabaseNotifications.ts. No new policy needed here.

create table public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.device_push_tokens enable row level security;

create policy "Users manage their own push tokens"
  on public.device_push_tokens for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Scheduling: send-login-reminders needs to run once a day, with no
-- signed-in user driving it — pg_cron + pg_net let Postgres itself call
-- the Edge Function on a schedule, which is how Supabase's own docs
-- recommend triggering a function on a timer.
--
-- TODO(timezone): this fires at one fixed UTC hour for every user, which
-- was the deliberate starting point — it does NOT mean "before the end
-- of each user's own day". Doing that properly needs a per-user
-- timezone (captured from the device, like device_push_tokens.platform
-- is) and an hourly schedule that only nudges users for whom it's
-- currently evening locally. Revisit once that's worth the extra
-- moving parts.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- The Edge Function call needs a service-role key to run with no calling
-- user — that can't live in this SQL file (it'd be committed to the
-- repo). Store it once via the SQL Editor, then this schedule can read
-- it back:
--   select vault.create_secret('paste-your-service-role-key-here', 'service_role_key');
-- (Project Settings > API > service_role secret. Never ship this key in
-- the mobile app itself — see supabase/functions/send-invite-email for
-- the same reasoning about RESEND_API_KEY.)
--
-- Replace <project-ref> below with your project's ref (the subdomain in
-- your Supabase URL) before running this migration.
select cron.schedule(
  'hound-daily-login-reminder',
  '0 21 * * *', -- 9pm UTC daily — see the timezone TODO above
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-login-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
