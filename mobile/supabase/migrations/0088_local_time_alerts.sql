-- Hound: reminders and alerts arrive in each person's own evening.
--
-- The login reminder (0010), stale-data alert and daily standings (0025)
-- each ran once a day at a fixed UTC hour: 9 PM UTC is 4 PM in Central
-- time and 2:30 AM in India. Now:
--
--   profiles.time_zone  the phone's time zone (IANA name, e.g.
--                       'America/Chicago'), reported by the app on every
--                       open. Anything Postgres doesn't recognize is
--                       stored as null. Null means US Eastern.
--   the three jobs      run every hour; each one only sends to people
--                       for whom it's currently that alert's hour:
--                         login reminder   9 PM local
--                         stale data       6 PM local
--                         daily standings  8 PM local
--                       and "today" means the person's own calendar day.
--   alert_deliveries    one row per alert actually sent to someone, so a
--                       person gets each alert at most once on their own
--                       day (the old per-challenge guards assumed one
--                       send time for everyone).
--
-- Run this once, after 0001-0087, in the SQL Editor. The schedules of
-- the three existing jobs are changed in place, so their URLs and keys
-- stay as you set them up.

alter table public.profiles add column time_zone text;

grant update (time_zone) on public.profiles to authenticated;

create or replace function public.profiles_valid_time_zone()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.time_zone is not null
    and not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    new.time_zone := null;
  end if;
  return new;
end;
$$;

create trigger profiles_valid_time_zone
  before insert or update of time_zone on public.profiles
  for each row execute procedure public.profiles_valid_time_zone();

create table public.alert_deliveries (
  kind text not null check (kind in ('stale_data', 'daily_standings')),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  -- Who the alert is about (stale data: the person who went quiet).
  -- The zero id when it's about no one in particular.
  subject_id uuid not null default '00000000-0000-0000-0000-000000000000',
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  -- The recipient's own calendar day.
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (kind, challenge_id, subject_id, recipient_id, day)
);

alter table public.alert_deliveries enable row level security;
-- No policies: only the alert functions (service role) use it.

-- Every hour, a few minutes past, instead of once a day.
select cron.alter_job(job_id := j.jobid, schedule := s.schedule)
from cron.job j
join (values
  ('hound-daily-login-reminder', '7 * * * *'),
  ('hound-stale-data-alert', '9 * * * *'),
  ('hound-daily-standings-alert', '11 * * * *')
) as s (jobname, schedule) on s.jobname = j.jobname;
