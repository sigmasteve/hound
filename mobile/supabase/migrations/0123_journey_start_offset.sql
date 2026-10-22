-- Hound: a Journey counts from the moment it starts, not from midnight.
--
-- Miles are kept per day (daily_miles), so until now a Journey begun at
-- 4 pm counted the whole day, miles walked before the switch included;
-- switching courses on a day with 5 miles already walked put 5 miles on
-- the new course at once. Now start_journey records how far the day had
-- got when the Journey began (start_workout_mi, start_all_mi: what the
-- phone measured, or failing that the day as last synced) and
-- journey_miles takes that off the first day. Only the first day: the
-- offset never eats into later days, and never takes a day below zero.
--
-- Run this once, after 0122, in the SQL Editor. Older app versions call
-- start_journey without the two new arguments and get the synced day.

alter table public.journeys
  add column if not exists start_workout_mi numeric(6, 2) not null default 0
    check (start_workout_mi between 0 and 150),
  add column if not exists start_all_mi numeric(6, 2) not null default 0
    check (start_all_mi between 0 and 150);

comment on column public.journeys.start_workout_mi is
  'Workout miles the start day already had when the journey began; taken off its first day.';
comment on column public.journeys.start_all_mi is
  'All walking and running miles the start day already had when the journey began; taken off its first day.';

-- Miles on a journey so far: every day from its start, less what the
-- start day already had when it began.
create or replace function public.journey_miles(j public.journeys)
returns numeric
language sql
stable
security definer set search_path = public
as $$
  with d as (
    select m.day,
      case when j.count_all_miles then greatest(m.all_mi, m.workout_mi) else m.workout_mi end as mi
    from public.daily_miles m
    where m.user_id = j.user_id and m.day >= j.started_on
  )
  select coalesce(sum(d.mi), 0)
    - least(
        case when j.count_all_miles then greatest(j.start_all_mi, j.start_workout_mi) else j.start_workout_mi end,
        coalesce((select f.mi from d f where f.day = j.started_on), 0))
  from d;
$$;

revoke execute on function public.journey_miles(public.journeys) from public, anon, authenticated;

-- The same start_journey, plus the day's miles so far as the phone
-- measured them at that moment. Null (or an older app) means: use the
-- day as last synced.
drop function if exists public.start_journey(text, text, numeric, date);

create or replace function public.start_journey(
  p_course_id text,
  p_course_name text,
  p_course_miles numeric,
  p_local_date date,
  p_workout_mi numeric default null,
  p_all_mi numeric default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  synced public.daily_miles;
  new_id uuid;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  select * into synced from public.daily_miles m where m.user_id = me and m.day = p_local_date;
  update public.journeys j set ended_at = now()
    where j.user_id = me and j.finished_at is null and j.ended_at is null;
  insert into public.journeys (user_id, course_id, course_name, course_miles, started_on, start_workout_mi, start_all_mi)
    values (me, p_course_id, p_course_name, p_course_miles, p_local_date,
      least(150, greatest(0, coalesce(p_workout_mi, synced.workout_mi, 0))),
      least(150, greatest(0, coalesce(p_all_mi, synced.all_mi, 0))))
    returning id into new_id;
  return new_id;
end;
$$;

revoke execute on function public.start_journey(text, text, numeric, date, numeric, numeric) from public, anon;
grant execute on function public.start_journey(text, text, numeric, date, numeric, numeric) to authenticated;

-- Undo, if needed (0120's start_journey and journey_miles come back by
-- running their definitions from that file again):
--   drop function public.start_journey(text, text, numeric, date, numeric, numeric);
--   alter table public.journeys drop column start_workout_mi, drop column start_all_mi;
