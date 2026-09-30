-- Hound: every participant counts a challenge from the same calendar day,
-- in their own time zone.
--
-- A challenge starts at midnight in its creator's time zone (starts_at).
-- Each phone used to work out the first day from that moment in its own
-- time zone, so for someone west of the creator it came out a day early:
-- a challenge starting Oct 1 at midnight Eastern is 11 PM Sep 30 in
-- Central, and Central phones counted their Sep 30 steps. Now the
-- challenge carries its first calendar day (start_day, Oct 1) and every
-- phone counts its own Oct 1, Oct 2, … through the last day.
--
--   start_day  the challenge's first day, as the creator saw it. The app
--              sets it right after creating a challenge; until it does
--              (or for an older app), it's the start date in US Eastern
--              time, where most challenges are created.
--   last day   start_day + duration_days - 1
--
-- progress_snapshots now ignores any day outside that range, so a phone
-- on an older app can't add days that don't belong, and the stray days
-- already recorded on challenges still running are removed.
--
-- Run this once, after 0001-0084, in the SQL Editor.

alter table public.challenges add column start_day date;

update public.challenges
  set start_day = (starts_at at time zone 'America/New_York')::date
  where start_day is null;

create or replace function public.challenges_default_start_day()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.start_day is null then
    new.start_day := (new.starts_at at time zone 'America/New_York')::date;
  end if;
  return new;
end;
$$;

create trigger challenges_default_start_day
  before insert on public.challenges
  for each row execute procedure public.challenges_default_start_day();

-- The creator's phone sets the real first day just after creating the
-- challenge. Only the creator, and only within a day of the default, so
-- it can fix a time-zone difference but not move a challenge.
create or replace function public.set_challenge_start_day(p_challenge_id uuid, p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.challenges;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if c.id is null or c.created_by <> auth.uid() then
    raise exception 'Only the creator can do that.';
  end if;
  if p_day is null or abs(p_day - (c.starts_at at time zone 'UTC')::date) > 1 then
    raise exception 'That day doesn''t match the challenge''s start.';
  end if;
  update public.challenges set start_day = p_day where id = p_challenge_id;
  -- Days recorded before the fix that no longer belong.
  delete from public.progress_snapshots ps
    where ps.challenge_id = p_challenge_id
      and (ps.day < p_day or ps.day > p_day + c.duration_days - 1);
end;
$$;

revoke execute on function public.set_challenge_start_day(uuid, date) from public, anon;
grant execute on function public.set_challenge_start_day(uuid, date) to authenticated;

-- A day outside the challenge is skipped quietly (no error), so an older
-- app's sync still succeeds for the days that do count.
create or replace function public.progress_snapshots_in_range()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  first_day date;
  days int;
begin
  select c.start_day, c.duration_days into first_day, days
    from public.challenges c where c.id = new.challenge_id;
  if first_day is not null and (new.day < first_day or new.day > first_day + days - 1) then
    return null;
  end if;
  return new;
end;
$$;

create trigger progress_snapshots_in_range
  before insert or update on public.progress_snapshots
  for each row execute procedure public.progress_snapshots_in_range();

-- Clean up challenges still running (finished ones keep their results).
delete from public.progress_snapshots ps
  using public.challenges c
  where c.id = ps.challenge_id
    and c.ends_at > now()
    and (ps.day < c.start_day or ps.day > c.start_day + c.duration_days - 1);
