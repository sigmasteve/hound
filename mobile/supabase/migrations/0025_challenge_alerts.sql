-- Wires up two of SettingsScreen's three "Alerts" toggles for real,
-- reusing the same pg_cron + pg_net + Edge Function pattern
-- 0010_login_reminders.sql established. The third ("Someone closes
-- within 2 miles of me") needs live GPS tracking — this app has no
-- location library, no background-location permissions, and none of
-- the battery/privacy/App-Store-review work that comes with it, so
-- it's deliberately left unwired and hidden from the UI rather than
-- built partially. Revisit as its own scoped project.

alter table public.profiles
  add column alert_stale_data_enabled boolean not null default true,
  add column alert_daily_standings_enabled boolean not null default false;

-- Guards against re-notifying the same "this person's gone stale" fact
-- more than once a day, per (challenge, the participant who went
-- stale) — same reasoning profiles.last_login_reminder_sent_at guards
-- against a re-run double-sending, just keyed by more than one column
-- since this fact isn't about a single user's own reminder.
create table public.stale_data_alerts_sent (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  stale_user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (challenge_id, stale_user_id, day)
);

alter table public.stale_data_alerts_sent enable row level security;
-- No app-facing policy — only send-stale-data-alerts (service role,
-- see that function) ever reads or writes this table.

-- Same idea, one row per (challenge, day) rather than per stale user —
-- there's no per-participant "fact" here to dedupe, just "have I
-- already sent this challenge's standings today."
create table public.daily_standings_sent (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (challenge_id, day)
);

alter table public.daily_standings_sent enable row level security;

-- TODO(timezone): both schedules below fire at one fixed UTC hour for
-- every challenge/user, same starting-point caveat as
-- 0010_login_reminders.sql's own TODO — "8pm" in the daily-standings
-- toggle's own label means UTC here, not each participant's local
-- evening. Revisit alongside that TODO.
--
-- Replace <project-ref> below with your project's ref before running
-- this migration — same one-time step 0010 itself needed.
select cron.schedule(
  'hound-stale-data-alert',
  '0 18 * * *', -- 6pm UTC daily
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-stale-data-alerts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'hound-daily-standings-alert',
  '0 20 * * *', -- 8pm UTC daily, matching the toggle's own label
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-daily-standings',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
