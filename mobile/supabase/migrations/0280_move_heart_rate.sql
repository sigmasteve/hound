-- Hound: Move points for a workout with no type, by heart rate (Steve,
-- Nov 2026: a 3-hour "Manual labor" from Whoop and his Apple Watch
-- earned 9,106 Move points on top of its 8,994 steps, at "Anything
-- else"'s 100 a minute, though his heart rate was mostly light).
--
-- Calories weren't the answer: the watch said 1,236 cal and Whoop 544
-- for the same three hours. Heart rate is measured, not estimated, so a
-- workout Health gives no type ("Other", which Hound shows as "Workout")
-- is now scored minute by minute from what the phone reads in Health:
--   - a minute with at least move_config.hr_walk_spm steps (60) is
--     walking: it earns nothing more, its steps already count;
--   - any other minute earns by how far the heart rate was above the
--     person's resting heart rate, from move_config.hr_bands (Admin →
--     Bones → Move points): under 25 bpm above resting 0 a minute, 25+ 30,
--     45+ 70, 65+ 120, 85+ 180. Lower than a walk at the same heart rate:
--     arm work, lifting and standing raise the heart rate more for the
--     effort than walking does;
--   - a minute with no heart rate earns "Anything else"'s rate.
-- The phone sends the summary as workout_history.effort with the steps it
-- already sends (Today re-syncs the last 3 days' workouts), so recent
-- workouts are re-scored when it next opens. Workouts with a type, hand
-- logs and Hound's own sessions are scored as before.
--
--   effort: {"rest": 58, "walk": 70, "nohr": 2, "idle": {"0": 30, "25": 41, "45": 22}}
--           (minutes; idle is keyed by bpm above resting, rounded down to 5)
--
-- Run this once, after 0279, in the SQL Editor.

alter table public.workout_history add column if not exists effort jsonb;

alter table public.move_config
  add column if not exists hr_walk_spm int not null default 60 check (hr_walk_spm between 20 and 200),
  add column if not exists hr_bands jsonb not null default
    '[{"from": 25, "per_min": 30}, {"from": 45, "per_min": 70}, {"from": 65, "per_min": 120}, {"from": 85, "per_min": 180}]'::jsonb;

-- Points a minute for a heart rate this many bpm above resting.
create or replace function public.move_hr_rate(p_above int)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce((
    select (b ->> 'per_min')::int
    from public.move_config c, jsonb_array_elements(c.hr_bands) b
    where c.id and (b ->> 'from')::int <= p_above
    order by (b ->> 'from')::int desc
    limit 1), 0);
$$;
revoke execute on function public.move_hr_rate(int) from public, anon, authenticated;

create or replace function public.move_effort_pts(p_effort jsonb, p_rate int)
returns int
language sql
stable
security definer set search_path = public
as $$
  select greatest(0,
    coalesce((select sum(greatest(0, round((e.value)::numeric))::int * public.move_hr_rate(e.key::int))
              from jsonb_each_text(coalesce(p_effort -> 'idle', '{}'::jsonb)) e
              where e.key ~ '^[0-9]+$' and e.value ~ '^[0-9.]+$'), 0)
    + greatest(0, coalesce((p_effort ->> 'nohr')::numeric, 0))::int * p_rate)::int;
$$;
revoke execute on function public.move_effort_pts(jsonb, int) from public, anon, authenticated;

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
    if w.source not in ('manual', 'hound') and activity = 'other' and w.effort is not null and m > 0 then
      -- 0280: a workout with no type, scored minute by minute from the
      -- phone's summary: walking minutes earn nothing more (their steps
      -- count), the rest by heart rate above resting, minutes with no
      -- heart rate at the rate.
      pts := public.move_effort_pts(w.effort, rate);
    else
      pts := greatest(0, c * rate - steps);
    end if;
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
        -- 0280: scored by heart rate: its walking minutes and the rest.
        'effort', (select case when i.activity = 'other' and i.kind = 'device' then
                     jsonb_build_object('walk', coalesce((wh.effort ->> 'walk')::int, 0),
                       'hr', coalesce((select sum(e.value::numeric)::int from jsonb_each_text(coalesce(wh.effort -> 'idle', '{}'::jsonb)) e where e.value ~ '^[0-9.]+$'), 0))
                     end
                   from public.workout_history wh where wh.user_id = me and wh.source_id = i.source_id and wh.effort is not null),
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

-- Admin → Bones → Move points: also the heart-rate levels and what a
-- walking minute is.
-- p: {"rates": {...}, "hand_cap_min": 120, "hr_walk_spm": 60,
--     "hr_bands": [{"from": 20, "per_min": 40}, ...]}
create or replace function public.admin_set_move_config(p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  k text;
  b jsonb;
  prev int := -1;
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'Admins only.';
  end if;
  if p ? 'hand_cap_min' then
    if jsonb_typeof(p -> 'hand_cap_min') <> 'number' or (p ->> 'hand_cap_min')::numeric not between 0 and 1440
       or (p ->> 'hand_cap_min')::numeric <> floor((p ->> 'hand_cap_min')::numeric) then
      raise exception 'Enter whole minutes from 0 to 1,440.';
    end if;
    update public.move_config set hand_cap_min = (p ->> 'hand_cap_min')::int, updated_at = now() where id;
  end if;
  if p ? 'hr_walk_spm' then
    if jsonb_typeof(p -> 'hr_walk_spm') <> 'number' or (p ->> 'hr_walk_spm')::numeric not between 20 and 200
       or (p ->> 'hr_walk_spm')::numeric <> floor((p ->> 'hr_walk_spm')::numeric) then
      raise exception 'Steps a minute for walking: a whole number from 20 to 200.';
    end if;
    update public.move_config set hr_walk_spm = (p ->> 'hr_walk_spm')::int, updated_at = now() where id;
  end if;
  if p ? 'hr_bands' then
    if jsonb_typeof(p -> 'hr_bands') <> 'array' or jsonb_array_length(p -> 'hr_bands') not between 1 and 6 then
      raise exception 'Heart-rate levels: 1 to 6 of them.';
    end if;
    for b in select * from jsonb_array_elements(p -> 'hr_bands') loop
      if jsonb_typeof(b -> 'from') <> 'number' or jsonb_typeof(b -> 'per_min') <> 'number'
         or (b ->> 'from')::numeric not between 0 and 150 or (b ->> 'per_min')::numeric not between 0 and 1000
         or (b ->> 'from')::numeric <> floor((b ->> 'from')::numeric) or (b ->> 'per_min')::numeric <> floor((b ->> 'per_min')::numeric) then
        raise exception 'Each heart-rate level: whole bpm above resting (0 to 150) and points a minute (0 to 1,000).';
      end if;
      if (b ->> 'from')::int <= prev then
        raise exception 'Heart-rate levels go up: each starts above the one before.';
      end if;
      prev := (b ->> 'from')::int;
    end loop;
    update public.move_config set hr_bands = p -> 'hr_bands', updated_at = now() where id;
  end if;
  if p ? 'rates' then
    for k in select jsonb_object_keys(p -> 'rates') loop
      if not exists (select 1 from public.move_rates r where r.activity = k) then
        raise exception 'Unknown activity %.', k;
      end if;
      if jsonb_typeof(p -> 'rates' -> k) <> 'number' or (p -> 'rates' ->> k)::numeric not between 0 and 1000
         or (p -> 'rates' ->> k)::numeric <> floor((p -> 'rates' ->> k)::numeric) then
        raise exception 'Enter whole points a minute from 0 to 1,000.';
      end if;
      update public.move_rates set per_min = (p -> 'rates' ->> k)::int, updated_at = now() where activity = k;
    end loop;
  end if;
end;
$$;
revoke execute on function public.admin_set_move_config(jsonb) from public, anon;
grant execute on function public.admin_set_move_config(jsonb) to authenticated;

-- To undo:
--   move_day_items and my_move as in 0277, admin_set_move_config as in 0270;
--   drop function public.move_effort_pts(jsonb, int);
--   drop function public.move_hr_rate(int);
--   alter table public.move_config drop column hr_bands, drop column hr_walk_spm;
--   alter table public.workout_history drop column effort;
