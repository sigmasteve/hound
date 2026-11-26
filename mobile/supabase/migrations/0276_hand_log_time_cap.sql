-- Hound: logging by hand is limited by time, not by count (Steve, Nov
-- 2026: "2-hour cap for hand-logging").
--
-- Before, Log a workout allowed 2 a day, each up to 90 minutes, and Move
-- points counted up to 2 hours of it. Now the day's time by hand is the
-- limit, everywhere: log_workout refuses what would take the day past
-- move_config.hand_cap_min (Admin → Bones → Move points, 120 to start),
-- and the count limit is off (workout_log_config.per_day = 0, which Admin
-- can still set back to a number: 0 means no count limit). Undone and
-- replaced workouts don't use up the time. Each workout is still 5 to 90
-- minutes.
--   log_workout          the time check; says minutes left
--   my_logged_workouts   cap_min, minutes_today / _yesterday
--   admin_workout_log_overview  "at the limit" means at the time cap
--
-- Run this once, after 0275, in the SQL Editor.

alter table public.workout_log_config drop constraint if exists workout_log_config_per_day_check;
alter table public.workout_log_config add constraint workout_log_config_per_day_check check (per_day between 0 and 10);
update public.workout_log_config set per_day = 0 where id;
alter table public.workout_log_config alter column per_day set default 0;

-- Minutes logged by hand on a day that still stand.
create or replace function public.workout_log_minutes(u uuid, d date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce(sum(x.minutes), 0)::int from public.workout_log_entries x
  where x.user_id = u and x.local_day = d and x.undone_at is null and x.replaced_at is null;
$$;
revoke execute on function public.workout_log_minutes(uuid, date) from public, anon, authenticated;

-- "2 hours", "90 min", "1 h 30 min".
create or replace function public.workout_log_hm(m int)
returns text
language sql
immutable
as $$
  select case when m < 60 then m || ' min'
              when m % 60 = 0 then (m / 60) || case when m = 60 then ' hour' else ' hours' end
              else (m / 60) || ' h ' || (m % 60) || ' min' end;
$$;
revoke execute on function public.workout_log_hm(int) from public, anon, authenticated;

create or replace function public.log_workout(p_type text, p_minutes int, p_ended_at timestamptz, p_phone_steps int default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.workout_log_config%rowtype;
  tz text;
  today date;
  day date;
  started timestamptz;
  opens int;
  n int;
  cap int := coalesce((select c.hand_cap_min from public.move_config c where c.id), 120);
  used int;
  clash record;
  e public.workout_log_entries%rowtype;
  v_name text := public.workout_log_name(p_type);
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into cfg from public.workout_log_config where id;
  if not cfg.enabled then
    raise exception 'Logging workouts is paused right now.';
  end if;
  if exists (select 1 from public.workout_log_blocks b where b.user_id = me) then
    raise exception 'Logging is off for your account. Workouts from a watch or your phone still count.';
  end if;
  opens := coalesce(public.workout_log_opens_in(me), 0);
  if opens > 0 then
    raise exception 'Logging opens after your first week. In % %. Until then, workouts from a watch or your phone count.',
      opens, case when opens = 1 then 'day' else 'days' end;
  end if;
  if v_name is null then
    raise exception 'Pick what you did.';
  end if;
  if p_minutes is null or p_minutes < cfg.min_min or p_minutes > cfg.max_min then
    raise exception 'Between % and % minutes.', cfg.min_min, cfg.max_min;
  end if;

  tz := public.workout_log_tz(me);
  today := (now() at time zone tz)::date;
  if p_ended_at is null or p_ended_at > now() + interval '1 minute' then
    raise exception 'That hasn''t happened yet.';
  end if;
  day := (p_ended_at at time zone tz)::date;
  if day > today or day < today - cfg.back_days then
    raise exception '%', case when cfg.back_days = 0 then 'Only today.'
                              when cfg.back_days = 1 then 'Only today or yesterday.'
                              else format('Only today or the %s days before.', cfg.back_days) end;
  end if;

  -- One at a time per person, so two quick taps can't both slip under the limit.
  perform pg_advisory_xact_lock(hashtext('workout_log:' || me::text));
  select count(*) into n from public.workout_log_entries x where x.user_id = me and x.local_day = day;
  if cfg.per_day > 0 and n >= cfg.per_day then
    raise exception '%', case when day = today then format('That''s %s logged today. More tomorrow.', cfg.per_day)
                              else format('That''s %s logged for yesterday.', cfg.per_day) end;
  end if;
  -- 0276: the day's time by hand (Move points' cap, 2 hours to start).
  used := public.workout_log_minutes(me, day);
  if used + p_minutes > cap then
    raise exception '%', case
      when used >= cap then format('That''s %s by hand %s. More tomorrow.', public.workout_log_hm(cap), case when day = today then 'today' else 'for yesterday' end)
      else format('That''s over %s by hand %s: %s min left.', public.workout_log_hm(cap), case when day = today then 'today' else 'for yesterday' end, cap - used) end;
  end if;

  started := p_ended_at - make_interval(mins => p_minutes);
  select w.name, w.occurred_at into clash
    from public.workout_history w
    where w.user_id = me
      and w.occurred_at < p_ended_at
      and w.occurred_at + make_interval(mins => greatest(coalesce(w.logged_min, w.duration_min, 0), 1)) > started
    order by w.occurred_at
    limit 1;
  if found then
    raise exception 'That overlaps your % at %.', lower(clash.name),
      ltrim(to_char(clash.occurred_at at time zone tz, 'HH12:MI am'), '0');
  end if;

  insert into public.workout_log_entries (user_id, source_id, type, minutes, started_at, ended_at, local_day, phone_steps)
  values (me, 'manual:' || gen_random_uuid()::text, p_type, p_minutes, started, p_ended_at, day,
          case when p_phone_steps is null or p_phone_steps < 0 then null else p_phone_steps end)
  returning * into e;

  insert into public.workout_history (user_id, source_id, name, occurred_at, source, distance_mi, avg_heart_rate, duration_min, logged_min)
  values (me, e.source_id, v_name, started, 'manual', null, null, round(p_minutes * cfg.value_pct / 100.0)::int, p_minutes);

  return public.workout_log_json(e) || jsonb_build_object(
    'left_today', case when cfg.per_day > 0 then greatest(0, cfg.per_day - (select count(*) from public.workout_log_entries x where x.user_id = me and x.local_day = today)) else 99 end,
    'minutes_left_today', greatest(0, cap - public.workout_log_minutes(me, today)));
end;
$$;
revoke execute on function public.log_workout(text, int, timestamptz, int) from public, anon;
grant execute on function public.log_workout(text, int, timestamptz, int) to authenticated;

create or replace function public.my_logged_workouts()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.workout_log_config%rowtype;
  today date;
  cap int := coalesce((select c.hand_cap_min from public.move_config c where c.id), 120);
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into cfg from public.workout_log_config where id;
  today := (now() at time zone public.workout_log_tz(me))::date;
  return jsonb_build_object(
    'enabled', cfg.enabled,
    'blocked', exists (select 1 from public.workout_log_blocks b where b.user_id = me),
    'opens_in_days', coalesce(public.workout_log_opens_in(me), 0),
    'per_day', cfg.per_day,
    'min_min', cfg.min_min,
    'max_min', cfg.max_min,
    'back_days', cfg.back_days,
    'value_pct', cfg.value_pct,
    'undo_minutes', cfg.undo_minutes,
    'left_today', case when cfg.per_day > 0 then greatest(0, cfg.per_day - (select count(*) from public.workout_log_entries x where x.user_id = me and x.local_day = today)) else 99 end,
    'left_yesterday', case when cfg.per_day > 0 then greatest(0, cfg.per_day - (select count(*) from public.workout_log_entries x where x.user_id = me and x.local_day = today - 1)) else 99 end,
    'cap_min', cap,
    'minutes_today', public.workout_log_minutes(me, today),
    'minutes_yesterday', public.workout_log_minutes(me, today - 1),
    'logs', (select coalesce(jsonb_agg(public.workout_log_json(x) order by x.ended_at desc), '[]'::jsonb)
             from public.workout_log_entries x
             where x.user_id = me and x.local_day >= today - greatest(cfg.back_days, 1)));
end;
$$;
revoke execute on function public.my_logged_workouts() from public, anon;
grant execute on function public.my_logged_workouts() to authenticated;

create or replace function public.admin_workout_log_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  cfg public.workout_log_config%rowtype;
  since timestamptz := now() - interval '7 days';
  all_7d int;
  manual_7d int;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  select * into cfg from public.workout_log_config where id;
  select count(*), count(*) filter (where w.source = 'manual') into all_7d, manual_7d
    from public.workout_history w where w.occurred_at >= since;

  return jsonb_build_object(
    'config', jsonb_build_object('enabled', cfg.enabled, 'per_day', cfg.per_day, 'min_min', cfg.min_min,
      'max_min', cfg.max_min, 'back_days', cfg.back_days, 'value_pct', cfg.value_pct,
      'new_account_days', cfg.new_account_days, 'undo_minutes', cfg.undo_minutes),
    'people_7d', (select count(distinct e.user_id) from public.workout_log_entries e where e.created_at >= since and e.undone_at is null),
    'logs_7d', (select count(*) from public.workout_log_entries e where e.created_at >= since and e.undone_at is null),
    'minutes_7d', (select coalesce(sum(e.minutes), 0) from public.workout_log_entries e where e.created_at >= since and e.undone_at is null),
    'share_7d', case when all_7d = 0 then 0 else round(manual_7d::numeric / all_7d, 3) end,
    'undone_7d', (select count(*) from public.workout_log_entries e where e.created_at >= since and e.undone_at is not null),
    'replaced_7d', (select count(*) from public.workout_log_entries e where e.created_at >= since and e.replaced_at is not null),
    'by_type', (select coalesce(jsonb_object_agg(t.type, t.n), '{}'::jsonb) from (
        select e.type, count(*) as n from public.workout_log_entries e
        where e.created_at >= since and e.undone_at is null group by e.type) t),
    'flagged', (select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', f.user_id, 'name', public.golf_name(f.user_id), 'why', f.why,
          'blocked', exists (select 1 from public.workout_log_blocks b where b.user_id = f.user_id))
          order by f.ord, f.user_id), '[]'::jsonb)
        from (
          -- At the limit on 10 or more of the last 14 days.
          (select d.user_id, 1 as ord, format('At the limit %s of the last 14 days', count(*)) as why
          from (
            select e.user_id, e.local_day from public.workout_log_entries e
            where e.local_day >= current_date - 14 and e.undone_at is null
            group by e.user_id, e.local_day
            having (cfg.per_day > 0 and count(*) >= cfg.per_day)
                or (cfg.per_day = 0 and sum(e.minutes) >= coalesce((select c.hand_cap_min from public.move_config c where c.id), 120))
          ) d
          group by d.user_id having count(*) >= 10)
          union all
          -- A walk or run with far fewer steps than the minutes (the latest).
          (select distinct on (e.user_id) e.user_id, 2,
            format('Logged a %s min %s with %s steps in that time', e.minutes,
              case e.type when 'run' then 'run' else 'walk' end, e.phone_steps)
          from public.workout_log_entries e
          where e.created_at >= now() - interval '14 days' and e.type in ('walk', 'run')
            and e.phone_steps is not null and e.phone_steps < e.minutes * 30
          order by e.user_id, e.created_at desc)
        ) f),
    'blocked', (select coalesce(jsonb_agg(jsonb_build_object('user_id', b.user_id, 'name', public.golf_name(b.user_id))
          order by b.created_at desc), '[]'::jsonb) from public.workout_log_blocks b)
  );
end;
$$;
revoke execute on function public.admin_workout_log_overview() from public, anon;
grant execute on function public.admin_workout_log_overview() to authenticated;
