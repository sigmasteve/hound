-- Hound: the same start-day rule as 0085, for Variety Bingo and 75 Day.
--
-- 0085 made every challenge scored on daily steps or distance count the
-- same calendar days for everyone (start_day through start_day +
-- duration_days - 1, in each person's own time zone). Bingo and 75 Day
-- keep their progress in their own tables, so they still went by the
-- exact start moment: a Central-time player in an Oct 1 challenge
-- created in Eastern time could fill a Bingo square, or tick off a 75
-- Day checklist, with a workout from 11 PM Sep 30.
--
--   seventyfive_checkins  a day outside the challenge is skipped quietly,
--                         the same as progress_snapshots (0085).
--   bingo_progress        gains workout_day, the workout's calendar day
--                         on the player's phone. A workout outside the
--                         challenge's days is skipped quietly. An older
--                         app doesn't send it; its own check (the exact
--                         start moment) still applies, plus a loose one
--                         here that no time zone can be outside of.
--
-- On challenges still running, the stray 75 Day days are removed, and
-- auto-filled Bingo squares from the hours where time zones disagree
-- are cleared so the next sync fills them again, this time checked by
-- day. Squares someone linked by hand are left alone.
--
-- Run this once, after 0001-0085, in the SQL Editor.

-- ── 75 Day ───────────────────────────────────────────────────────────

create or replace function public.seventyfive_checkins_in_range()
returns trigger
language plpgsql
security definer
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

create trigger seventyfive_checkins_in_range
  before insert or update on public.seventyfive_checkins
  for each row execute procedure public.seventyfive_checkins_in_range();

delete from public.seventyfive_checkins sc
  using public.challenges c
  where c.id = sc.challenge_id
    and c.ends_at > now()
    and (sc.day < c.start_day or sc.day > c.start_day + c.duration_days - 1);

-- ── Variety Bingo ────────────────────────────────────────────────────

alter table public.bingo_progress add column workout_day date;

create or replace function public.bingo_progress_in_range()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first_day date;
  days int;
begin
  select c.start_day, c.duration_days into first_day, days
    from public.challenges c where c.id = new.challenge_id;
  if first_day is null then
    return new;
  end if;
  if new.workout_day is not null then
    if new.workout_day < first_day or new.workout_day > first_day + days - 1 then
      return null;
    end if;
  elsif new.workout_at is not null then
    -- Older app: no day sent. Outside these bounds it's outside the
    -- challenge everywhere — before the first day has begun anywhere
    -- (UTC+14), or after the last day has ended everywhere (UTC-12).
    if new.workout_at < (first_day::timestamp at time zone 'Etc/GMT-14')
      or new.workout_at >= ((first_day + days)::timestamp at time zone 'Etc/GMT+12') then
      return null;
    end if;
  end if;
  return new;
end;
$$;

create trigger bingo_progress_in_range
  before insert or update on public.bingo_progress
  for each row execute procedure public.bingo_progress_in_range();

-- Auto-filled squares from before this, in the hours where the old
-- start-moment check and a player's own calendar can disagree: before
-- the first day has begun in Hawaii, or after the last day has ended in
-- the far east (UTC+14). The next sync fills the real ones again.
delete from public.bingo_progress bp
  using public.challenges c
  where c.id = bp.challenge_id
    and c.ends_at > now()
    and bp.source = 'auto'
    and bp.workout_day is null
    and bp.workout_at is not null
    and (bp.workout_at < (c.start_day::timestamp at time zone 'Pacific/Honolulu')
      or bp.workout_at >= ((c.start_day + c.duration_days)::timestamp at time zone 'Etc/GMT-14'));

-- ── 0085's check on progress_snapshots ───────────────────────────────

-- These checks read the challenge as the database, not as whoever is
-- saving: a player who can't see the challenge row (row-level security)
-- mustn't slip past them. Same for 0085's.
create or replace function public.progress_snapshots_in_range()
returns trigger
language plpgsql
security definer
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

-- ── Setting the start day (0085) also tidies these ───────────────────

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
  delete from public.seventyfive_checkins sc
    where sc.challenge_id = p_challenge_id
      and (sc.day < p_day or sc.day > p_day + c.duration_days - 1);
  delete from public.bingo_progress bp
    where bp.challenge_id = p_challenge_id
      and (bp.workout_day < p_day or bp.workout_day > p_day + c.duration_days - 1);
end;
$$;

revoke execute on function public.set_challenge_start_day(uuid, date) from public, anon;
grant execute on function public.set_challenge_start_day(uuid, date) to authenticated;
