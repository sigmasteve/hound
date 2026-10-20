-- Hound: a sync that reads nothing can't wipe out a day's steps.
--
-- The app re-sends each day's steps and miles from the phone's health
-- data, overwriting that day's row. When the phone can't read its health
-- data (an iPhone locks Apple Health while the screen is locked, and
-- Android needs a separate permission to read Health Connect in the
-- background), the background sync from 0.10.2 read every day as 0 and
-- still sent today's 0. That replaced real steps with 0: on a weekly
-- global Step-Off, people with 9,000 steps dropped to 0 until they next
-- opened Hound.
--
-- Steps and miles for a day only ever grow as the day goes on, so a
-- change from some to none is a failed read, never real. From now on an
-- app write that would set a day's steps or miles to 0 keeps what was
-- there instead. Anything above 0 still replaces the old number as
-- before. The same goes for daily_step_totals (today's steps, behind
-- the daily and weekly step ranks).
--
-- Only writes from the app are affected. Admin and server-side changes
-- (the SQL Editor, Edge Functions) can still set a 0.
--
-- Run this once, after 0001-0114, in the SQL Editor. Days already
-- written as 0 come back the next time each person opens Hound, which
-- re-sends every day of their running challenges.

create or replace function public.progress_snapshots_keep_steps()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.steps = 0 and old.steps > 0 then
    new.steps := old.steps;
  end if;
  if new.distance_mi = 0 and old.distance_mi > 0 then
    new.distance_mi := old.distance_mi;
  end if;
  return new;
end;
$$;

-- Named to run after progress_snapshots_guard and _in_range (triggers
-- run in name order).
drop trigger if exists progress_snapshots_keep_steps on public.progress_snapshots;
create trigger progress_snapshots_keep_steps
  before update on public.progress_snapshots
  for each row execute procedure public.progress_snapshots_keep_steps();

create or replace function public.daily_step_totals_keep_steps()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') and new.steps = 0 and old.steps > 0 then
    new.steps := old.steps;
  end if;
  return new;
end;
$$;

drop trigger if exists daily_step_totals_keep_steps on public.daily_step_totals;
create trigger daily_step_totals_keep_steps
  before update on public.daily_step_totals
  for each row execute procedure public.daily_step_totals_keep_steps();

-- Undo, if needed:
--   drop trigger daily_step_totals_keep_steps on public.daily_step_totals;
--   drop function public.daily_step_totals_keep_steps();
--   drop trigger progress_snapshots_keep_steps on public.progress_snapshots;
--   drop function public.progress_snapshots_keep_steps();
