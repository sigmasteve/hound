-- Hound: Journeys. Walk a famous course with your own miles: Windy City
-- 26.2, the Appalachian Trail and the rest (src/journeys/courses.ts has
-- the courses, their shapes and stops).
--
--   - daily_miles: each person's miles per day, as their phone counts
--     them. workout_mi is walks, runs and hikes they logged as workouts;
--     all_mi is every walking and running mile. Bike rides and swims
--     don't count. Until now distance was only kept per challenge.
--   - journeys: who's on which course, since when. One at a time;
--     starting another ends the current one. Miles count from the day
--     it started.
--   - check_journey_finish(): the app calls it after a sync. Once your
--     miles reach the course length it marks the journey finished and
--     pushes your friends ("Maya finished the Windy City 26.2 🏅").
--   - friends_on_course(): your friends on the same course, for the map.
--     Each friend's miles count from their own start; the shared race
--     comes later as a challenge.
--   - friends_course_counts(): how many friends are on each course, so
--     the picker can say "2 friends".
--
-- Milestone alerts along the way are the phone's own notifications; the
-- server only sees the finish.
--
-- Run this once, after 0119, in the SQL Editor. The finish push needs
-- the send-social-push function deployed again (journey_finished).

-- ── Miles per day ────────────────────────────────────────────────────

create table public.daily_miles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  workout_mi numeric(6, 2) not null default 0 check (workout_mi between 0 and 150),
  all_mi numeric(6, 2) not null default 0 check (all_mi between 0 and 150),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.daily_miles enable row level security;

create policy "Owners can view their daily miles"
  on public.daily_miles for select to authenticated
  using (user_id = auth.uid());

create policy "Owners can record their daily miles"
  on public.daily_miles for insert to authenticated
  with check (user_id = auth.uid());

create policy "Owners can update their daily miles"
  on public.daily_miles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.daily_miles from anon;

-- Same guard as 0115: a phone that couldn't read its health data reports
-- 0, which mustn't wipe out miles already synced for that day.
create or replace function public.daily_miles_keep_synced()
returns trigger
language plpgsql
as $$
begin
  if new.workout_mi = 0 and old.workout_mi > 0 then
    new.workout_mi := old.workout_mi;
  end if;
  if new.all_mi = 0 and old.all_mi > 0 then
    new.all_mi := old.all_mi;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.daily_miles_keep_synced() from public, anon, authenticated;

create trigger daily_miles_keep_synced
  before update on public.daily_miles
  for each row execute procedure public.daily_miles_keep_synced();

-- ── Journeys ─────────────────────────────────────────────────────────

create table public.journeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  course_id text not null check (course_id ~ '^[a-z0-9-]{2,40}$'),
  course_name text not null check (char_length(course_name) between 1 and 60),
  course_miles numeric(7, 2) not null check (course_miles > 0 and course_miles <= 5000),
  -- The phone's local date the journey started; miles count from it.
  started_on date not null,
  -- false: workout miles only (walks, runs, hikes). true: every
  -- walking and running mile.
  count_all_miles boolean not null default false,
  finished_at timestamptz,
  -- Set when someone stops a journey or starts another.
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index journeys_one_active on public.journeys (user_id)
  where finished_at is null and ended_at is null;
create index journeys_user_id on public.journeys (user_id);
create index journeys_course_active on public.journeys (course_id)
  where ended_at is null;

alter table public.journeys enable row level security;

create policy "Owners can view their journeys"
  on public.journeys for select to authenticated
  using (user_id = auth.uid());

revoke all on public.journeys from anon;
revoke insert, update, delete on public.journeys from authenticated;

-- Miles on a journey so far.
create or replace function public.journey_miles(j public.journeys)
returns numeric
language sql
stable
security definer set search_path = public
as $$
  select coalesce(sum(case when j.count_all_miles then greatest(m.all_mi, m.workout_mi) else m.workout_mi end), 0)
  from public.daily_miles m
  where m.user_id = j.user_id and m.day >= j.started_on;
$$;

revoke execute on function public.journey_miles(public.journeys) from public, anon, authenticated;

create or replace function public.start_journey(
  p_course_id text,
  p_course_name text,
  p_course_miles numeric,
  p_local_date date
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  new_id uuid;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  update public.journeys j set ended_at = now()
    where j.user_id = me and j.finished_at is null and j.ended_at is null;
  insert into public.journeys (user_id, course_id, course_name, course_miles, started_on)
    values (me, p_course_id, p_course_name, p_course_miles, p_local_date)
    returning id into new_id;
  return new_id;
end;
$$;

revoke execute on function public.start_journey(text, text, numeric, date) from public, anon;
grant execute on function public.start_journey(text, text, numeric, date) to authenticated;

create or replace function public.end_journey()
returns void
language sql
security definer set search_path = public
as $$
  update public.journeys j set ended_at = now()
    where j.user_id = auth.uid() and j.finished_at is null and j.ended_at is null;
$$;

revoke execute on function public.end_journey() from public, anon;
grant execute on function public.end_journey() to authenticated;

create or replace function public.set_journey_count_all(p_count_all boolean)
returns void
language sql
security definer set search_path = public
as $$
  update public.journeys j set count_all_miles = coalesce(p_count_all, false)
    where j.user_id = auth.uid() and j.finished_at is null and j.ended_at is null;
$$;

revoke execute on function public.set_journey_count_all(boolean) from public, anon;
grant execute on function public.set_journey_count_all(boolean) to authenticated;

-- Your current journey (or the one you just finished, until you start
-- another), with its miles, and how many courses you've finished.
create or replace function public.my_journey()
returns table (
  id uuid,
  course_id text,
  course_name text,
  course_miles numeric,
  started_on date,
  count_all_miles boolean,
  finished_at timestamptz,
  miles numeric,
  finished_count integer
)
language sql
stable
security definer set search_path = public
as $$
  select j.id, j.course_id, j.course_name, j.course_miles, j.started_on, j.count_all_miles, j.finished_at,
    public.journey_miles(j),
    (select count(*)::int from public.journeys f where f.user_id = auth.uid() and f.finished_at is not null)
  from public.journeys j
  where j.user_id = auth.uid() and j.ended_at is null
  order by (j.finished_at is null) desc, j.finished_at desc nulls first
  limit 1;
$$;

revoke execute on function public.my_journey() from public, anon;
grant execute on function public.my_journey() to authenticated;

-- Marks the caller's journey finished once its miles reach the course,
-- and tells their friends. True only on the call that finishes it.
create or replace function public.check_journey_finish()
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  j public.journeys;
  recipients uuid[];
begin
  if me is null then
    return false;
  end if;
  select * into j from public.journeys x
    where x.user_id = me and x.finished_at is null and x.ended_at is null
    for update;
  if not found or public.journey_miles(j) < j.course_miles then
    return false;
  end if;
  update public.journeys x set finished_at = now() where x.id = j.id;

  select coalesce(array_agg(x.friend), '{}') into recipients
  from (
    select case when f.requester_id = me then f.recipient_id else f.requester_id end as friend
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = me or f.recipient_id = me)
  ) x
  where public.social_push_reachable(x.friend);

  if array_length(recipients, 1) > 0 then
    perform public.social_notify(jsonb_build_object(
      'kind', 'journey_finished', 'from_user', me, 'challenge_id', null,
      'to_users', to_jsonb(recipients), 'course_name', j.course_name, 'miles', j.course_miles));
  end if;
  return true;
end;
$$;

revoke execute on function public.check_journey_finish() from public, anon;
grant execute on function public.check_journey_finish() to authenticated;

-- Your friends on a course (on it now, or finished it within the last
-- 30 days), for the map. Only friends, and only the course you name.
create or replace function public.friends_on_course(p_course_id text)
returns table (
  user_id uuid,
  name text,
  initials text,
  frame_id text,
  background_id text,
  icon_id text,
  miles numeric,
  course_miles numeric,
  finished_at timestamptz
)
language sql
stable
security definer set search_path = public
as $$
  select p.id, p.name, p.initials, p.equipped_frame_id, p.equipped_background_id, p.equipped_icon_id,
    least(public.journey_miles(j), j.course_miles), j.course_miles, j.finished_at
  from public.friendships f
  join public.journeys j
    on j.user_id = case when f.requester_id = auth.uid() then f.recipient_id else f.requester_id end
  join public.profiles p on p.id = j.user_id
  where f.status = 'accepted'
    and (f.requester_id = auth.uid() or f.recipient_id = auth.uid())
    and j.course_id = p_course_id
    and j.ended_at is null
    and (j.finished_at is null or j.finished_at > now() - interval '30 days');
$$;

revoke execute on function public.friends_on_course(text) from public, anon;
grant execute on function public.friends_on_course(text) to authenticated;

-- How many of your friends are on each course, for the course picker.
create or replace function public.friends_course_counts()
returns table (course_id text, friends integer)
language sql
stable
security definer set search_path = public
as $$
  select j.course_id, count(distinct j.user_id)::int
  from public.friendships f
  join public.journeys j
    on j.user_id = case when f.requester_id = auth.uid() then f.recipient_id else f.requester_id end
  where f.status = 'accepted'
    and (f.requester_id = auth.uid() or f.recipient_id = auth.uid())
    and j.ended_at is null
    and j.finished_at is null
  group by j.course_id;
$$;

revoke execute on function public.friends_course_counts() from public, anon;
grant execute on function public.friends_course_counts() to authenticated;

-- Undo, if needed:
--   drop function public.friends_course_counts();
--   drop function public.friends_on_course(text);
--   drop function public.check_journey_finish();
--   drop function public.my_journey();
--   drop function public.set_journey_count_all(boolean);
--   drop function public.end_journey();
--   drop function public.start_journey(text, text, numeric, date);
--   drop function public.journey_miles(public.journeys);
--   drop table public.journeys;
--   drop table public.daily_miles;
--   drop function public.daily_miles_keep_synced();
