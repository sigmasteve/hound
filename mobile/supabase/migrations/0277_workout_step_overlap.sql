-- Hound: a workout's own steps aren't counted twice (Steve, Nov 2026: a
-- 113-minute "Workout" from Health earned 11,300 Move points on top of
-- the steps taken during it, which were already in his day's steps).
--
-- A workout now earns its minutes × its rate, minus the steps taken
-- during it, never below 0. So a walk earns only its steps (as before, by
-- rate 0), a pickleball game keeps what it adds beyond its steps, and a
-- strength session or a swim keeps nearly everything. The steps come
-- from the phone:
--   - a watch or Health workout: workout_history.steps_during, which the
--     phone works out from Health for the workout's time when it syncs;
--   - logged by hand: the phone's steps it already sends (0204's
--     workout_log_entries.phone_steps).
-- Workouts the phone hasn't re-synced yet keep their old points until it
-- does (Today re-syncs the recent ones on every open). With the hand cap,
-- only the counted share of the steps comes off.
--   move_day_items  takes the steps off, and says how many (steps)
--   my_move         each item's steps, for Move's list
--
-- Run this once, after 0276, in the SQL Editor.

alter table public.workout_history add column if not exists steps_during int check (steps_during is null or steps_during >= 0);

drop function if exists public.move_day_items(uuid, date);
create or replace function public.move_day_items(p_user uuid, p_day date)
returns table (
  source_id text, name text, source text, activity text, occurred_at timestamptz,
  minutes int, counted_min int, rate int, pts int, kind text,
  -- 0277: steps taken during it (already in the day's steps), taken off.
  steps int
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  tz text := public.workout_log_tz(p_user);
  cap int := coalesce((select c.hand_cap_min from public.move_config c where c.id), 120);
  used int := 0;
  w record;
  m int;
  c int;
  s int;
  covered boolean;
begin
  for w in
    select x.* from public.workout_history x
    where x.user_id = p_user and (x.occurred_at at time zone tz)::date = p_day
    order by x.occurred_at, x.source_id
  loop
    m := greatest(coalesce(case when w.source = 'manual' then w.logged_min end, w.duration_min, 0), 0);
    covered := false;
    if w.source = 'manual' then
      c := least(m, greatest(cap - used, 0));
      used := used + m;
    elsif w.source = 'hound' then
      covered := exists (
        select 1 from public.workout_history d
        where d.user_id = p_user and d.source not in ('manual', 'hound')
          and d.occurred_at < w.occurred_at + make_interval(mins => greatest(m, 1))
          and d.occurred_at + make_interval(mins => greatest(coalesce(d.duration_min, 0), 1)) > w.occurred_at);
      c := case when covered then 0 else m end;
    else
      c := m;
    end if;
    source_id := w.source_id;
    name := w.name;
    source := w.source;
    activity := coalesce(w.move_activity, public.move_activity_for(w.name));
    occurred_at := w.occurred_at;
    minutes := m;
    counted_min := c;
    rate := coalesce(w.move_rate, public.move_rate_of(activity));
    -- Its own steps are already in the day's steps: take them off, in
    -- proportion to the minutes that count, never below 0 (0277).
    s := coalesce(w.steps_during, (select e.phone_steps from public.workout_log_entries e where e.source_id = w.source_id), 0);
    steps := case when m > 0 then round(greatest(s, 0) * c::numeric / m)::int else 0 end;
    pts := greatest(0, c * rate - steps);
    kind := case when w.source = 'manual' then 'hand' when w.source = 'hound' then case when covered then 'covered' else 'hound' end else 'device' end;
    return next;
  end loop;
end;
$$;
revoke execute on function public.move_day_items(uuid, date) from public, anon, authenticated;

create or replace function public.my_move(p_local_date date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cap int := (select c.hand_cap_min from public.move_config c where c.id);
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  return jsonb_build_object(
    'day', p_local_date,
    'pts', public.move_points_day(me, p_local_date),
    'hand_cap_min', cap,
    'hand_min', (select coalesce(sum(i.minutes), 0) from public.move_day_items(me, p_local_date) i where i.kind = 'hand'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_id', i.source_id, 'name', i.name, 'activity', i.activity, 'kind', i.kind,
        'occurred_at', i.occurred_at, 'minutes', i.minutes, 'counted_min', i.counted_min, 'rate', i.rate, 'pts', i.pts, 'steps', i.steps,
        'prs', (select count(*) from public.move_sets x join public.move_sessions ms on ms.id = x.session_id
                where ms.source_id = i.source_id and x.is_pr),
        'ref', (select ms.ref from public.move_sessions ms where ms.source_id = i.source_id))
        order by i.occurred_at)
      from public.move_day_items(me, p_local_date) i), '[]'::jsonb),
    'strength', public.move_strength_json(me, p_local_date));
end;
$$;
revoke execute on function public.my_move(date) from public, anon;
grant execute on function public.my_move(date) to authenticated;
