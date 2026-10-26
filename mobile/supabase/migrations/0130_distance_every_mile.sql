-- Hound: a miles Distance pool can count every mile.
--
-- A Distance pool measured in miles added up logged workouts only
-- (deviceSync.ts): a walk you didn't start as a workout never counted,
-- although Today shows it in your miles. "Hike the Appalachian Trail"
-- asks for 2,190 miles from the whole app, and most of anyone's miles
-- aren't workouts. The creator now picks what counts:
--
--   distance_source  'workouts'  logged workouts' distance (as before;
--                                null reads the same)
--                    'all'       the phone's miles for the day, the
--                                number on Today, as a solo Journey's
--                                "count every mile" does (0120)
--
-- Only a miles pool (kind 'distance', unit 'miles') carries it. A
-- running pool can be switched with an update to the column; the next
-- sync on each phone rewrites its days from the other source.
--
-- publish_global_challenge takes it; list_global_challenges returns it.
--
-- Run this once, after 0129, in the SQL Editor.
--
-- Undo, if needed: drop the column and re-run both functions from
-- 0126 and 0122 (dropping these first).

alter table public.challenges
  add column distance_source text check (distance_source in ('workouts', 'all'));

drop function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text, text);

create or replace function public.publish_global_challenge(
  p_name text,
  p_kind public.challenge_kind,
  p_duration_days int,
  p_starts_at timestamptz,
  p_join_closes_at timestamptz,
  p_daily_goal_steps int default null,
  p_distance_goal_unit text default null,
  p_distance_goal_mi numeric default null,
  p_distance_goal_steps int default null,
  p_bingo_card_type text default null,
  p_course_id text default null,
  p_distance_source text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  ends timestamptz;
  new_id uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only an admin can publish a global challenge.';
  end if;
  if p_kind not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist') then
    raise exception 'That kind of challenge can''t be global — pick Step Race, Daily Streak, Distance, Bingo, 75 Day, Journey or Accountability.';
  end if;
  if p_duration_days is null or p_duration_days < 1 or p_duration_days > 365 then
    raise exception 'A global challenge runs between 1 and 365 days.';
  end if;
  if p_starts_at is null or p_starts_at < now() - interval '1 day' then
    raise exception 'Pick a start date from today on.';
  end if;
  ends := p_starts_at + make_interval(days => p_duration_days);
  if p_join_closes_at is null or p_join_closes_at <= now() or p_join_closes_at > ends then
    raise exception 'Joining has to close after now and no later than the challenge ends.';
  end if;
  if p_kind = 'streak' and coalesce(p_daily_goal_steps, 0) <= 0 then
    raise exception 'A Daily Streak needs a daily step goal.';
  end if;
  if p_kind = 'distance' and not (
    (p_distance_goal_unit = 'miles' and coalesce(p_distance_goal_mi, 0) > 0)
    or (p_distance_goal_unit = 'steps' and coalesce(p_distance_goal_steps, 0) > 0)
  ) then
    raise exception 'A Distance challenge needs a group target.';
  end if;
  if p_kind = 'journey' and (p_course_id is null or coalesce(p_distance_goal_mi, 0) <= 0) then
    raise exception 'A Journey needs a course.';
  end if;
  if p_distance_source is not null and p_distance_source not in ('workouts', 'all') then
    raise exception 'Miles count from logged workouts or every mile.';
  end if;

  insert into public.challenges (
    name, kind, created_by, duration_days, starts_at, ends_at,
    daily_goal_steps, distance_goal_unit, distance_goal_mi, distance_goal_steps, bingo_card_type, course_id,
    distance_source, is_global, join_closes_at
  ) values (
    trim(p_name), p_kind, auth.uid(), p_duration_days, p_starts_at, ends,
    case when p_kind = 'streak' then p_daily_goal_steps end,
    case when p_kind = 'distance' then p_distance_goal_unit when p_kind = 'journey' then 'miles' end,
    case when (p_kind = 'distance' and p_distance_goal_unit = 'miles') or p_kind = 'journey' then p_distance_goal_mi end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'steps' then p_distance_goal_steps end,
    case when p_kind = 'bingo' then coalesce(p_bingo_card_type, 'variety') end,
    case when p_kind = 'journey' then p_course_id end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'miles' then p_distance_source end,
    true, p_join_closes_at
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text, text, text) from public, anon;
grant execute on function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text, text, text) to authenticated;

drop function public.list_global_challenges(boolean);

create or replace function public.list_global_challenges(p_include_ended boolean default false)
returns table (
  id uuid,
  name text,
  kind public.challenge_kind,
  duration_days int,
  starts_at timestamptz,
  ends_at timestamptz,
  join_closes_at timestamptz,
  created_at timestamptz,
  daily_goal_steps int,
  distance_goal_unit text,
  distance_goal_mi numeric,
  distance_goal_steps int,
  bingo_card_type text,
  participant_count int,
  joined boolean,
  course_id text,
  distance_source text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, c.kind, c.duration_days, c.starts_at, c.ends_at, c.join_closes_at, c.created_at,
    c.daily_goal_steps, c.distance_goal_unit, c.distance_goal_mi, c.distance_goal_steps, c.bingo_card_type,
    (select count(*)::int from public.challenge_participants cp where cp.challenge_id = c.id),
    exists (select 1 from public.challenge_participants cp where cp.challenge_id = c.id and cp.user_id = auth.uid()),
    c.course_id,
    c.distance_source
  from public.challenges c
  where c.is_global
    and auth.uid() is not null
    and (c.ends_at > now() or p_include_ended)
  order by case when p_include_ended then c.created_at end desc, c.starts_at asc
  limit 50;
$$;

revoke execute on function public.list_global_challenges(boolean) from public, anon;
grant execute on function public.list_global_challenges(boolean) to authenticated;
