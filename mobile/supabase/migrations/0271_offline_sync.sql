-- 0271: Offline mode, batch 1 (Steve, 26 Nov 2026: someone at the gym
-- with no signal couldn't use Hound). The phone keeps working without a
-- connection and sends what you did when it's back:
--
--   - Things done offline wait on the phone, in order, each with its own
--     id, and go through offline_apply when the connection is back. The
--     id makes a resend harmless: offline_apply applies each id once and
--     answers a repeat with the first answer. Ops: a strength log or
--     routine timed on the phone (move_offline_session), Log a workout
--     (log_workout), starting and ending a fast (fasting_start,
--     fasting_end) and a glass of water (log_water).
--   - When a rule says no (an overlap, a cap, a time too far back), the
--     answer is {"error": ...} rather than an exception, so the phone can
--     tell you which one didn't sync and why; it's kept for Admin.
--   - A session timed on the phone can't be watched by the server, so it's
--     checked when it arrives: it ended in the past, its minutes fit
--     between its start and end, it doesn't overlap another session
--     timed in Hound, it's within the last 3 days, and offline-timed
--     sessions count up to offline_config.hound_cap_min a day (3 hours).
--     Then it counts in full like any timed session.
--
-- offline_config.enabled is Admin's switch (Overview → Status → Offline
-- mode). Off by default: the app works as it always has until it's
-- turned on. Things already waiting still sync if it's turned off.
--
-- Run this once, after 0001-0270, in the SQL Editor.

create table public.offline_config (
  id boolean primary key default true,
  constraint offline_config_singleton check (id),
  enabled boolean not null default false,
  hound_cap_min int not null default 180 check (hound_cap_min between 0 and 1440),
  updated_at timestamptz not null default now()
);
insert into public.offline_config (id) values (true);
alter table public.offline_config enable row level security;
create policy "Anyone signed in can read the offline settings"
  on public.offline_config for select to authenticated using (true);
revoke all on public.offline_config from anon;
revoke insert, update, delete on public.offline_config from authenticated;

-- Every op applied, by its id from the phone.
create table public.client_ops (
  user_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null,
  op text not null,
  done_at timestamptz,
  applied_at timestamptz not null default now(),
  result jsonb,
  primary key (user_id, client_id)
);
create index client_ops_applied on public.client_ops (applied_at);
alter table public.client_ops enable row level security;
revoke all on public.client_ops from public, anon, authenticated;

-- Ops a rule turned down, for Admin.
create table public.client_op_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null,
  op text not null,
  message text,
  done_at timestamptz,
  at timestamptz not null default now()
);
create index client_op_failures_at on public.client_op_failures (at);
alter table public.client_op_failures enable row level security;
revoke all on public.client_op_failures from public, anon, authenticated;

alter table public.move_sessions add column if not exists offline boolean not null default false;

-- ── A session timed on the phone ──

create or replace function public.move_offline_session(
  p_kind text, p_ref text, p_started_at timestamptz, p_ended_at timestamptz, p_minutes int, p_hard boolean, p_sets jsonb, p_local_date date
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  span int;
  m int;
  act text;
  v_name text;
  sid text;
  s public.move_sessions;
  tz text;
  day date;
  used int;
  cap int := coalesce((select c.hound_cap_min from public.offline_config c where c.id), 180);
  st jsonb;
  ex text;
  wt numeric;
  rp int;
  best_w numeric;
  best_r int;
  is_pr boolean;
  prs jsonb := '[]'::jsonb;
  got int;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_kind not in ('routine', 'strength') or p_ref is null or length(trim(p_ref)) not between 1 and 40 then
    raise exception 'A routine or a strength log.';
  end if;
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then
    raise exception 'That session''s times don''t add up.';
  end if;
  if p_ended_at > now() + interval '2 minutes' then
    raise exception 'That session ends in the future.';
  end if;
  if p_started_at < now() - interval '3 days' then
    raise exception 'That session is more than 3 days old, so it can''t sync. Log it by hand instead.';
  end if;
  span := ceil(extract(epoch from (p_ended_at - p_started_at)) / 60.0)::int;
  if span > 240 then
    raise exception 'That session ran over 4 hours, so it wasn''t saved. Log it by hand instead.';
  end if;
  m := least(greatest(coalesce(p_minutes, span), 1), greatest(span, 1));
  if exists (
    select 1 from public.workout_history w
    where w.user_id = me and w.source = 'hound'
      and w.occurred_at < p_ended_at
      and w.occurred_at + make_interval(mins => greatest(coalesce(w.duration_min, 0), 1)) > p_started_at
  ) then
    raise exception 'That overlaps another session timed in Hound.';
  end if;
  tz := public.workout_log_tz(me);
  day := (p_started_at at time zone tz)::date;
  select coalesce(sum(x.minutes), 0) into used from public.move_sessions x
    where x.user_id = me and x.offline and x.finished_at is not null
      and (x.started_at at time zone tz)::date = day;
  if used + m > cap then
    raise exception 'That''s over % hours timed offline in a day, so it wasn''t saved. Log it by hand instead.', round(cap / 60.0, 1);
  end if;

  act := case when p_kind = 'routine' and p_ref like 'stretch%' then 'stretching'
              when p_kind = 'strength' and coalesce(p_hard, false) then 'strength_heavy'
              else 'strength_light' end;
  v_name := case when act = 'stretching' then 'Flexibility'
                 when p_kind = 'routine' then 'Functional Strength Training'
                 else 'Traditional Strength Training' end;

  insert into public.move_sessions (user_id, kind, ref, started_at, finished_at, minutes, activity, offline)
    values (me, p_kind, trim(p_ref), p_started_at, p_ended_at, m, act, true)
    returning * into s;
  sid := 'hound:' || s.id::text;
  insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min, logged_min, move_activity, move_rate)
    values (me, sid, v_name, p_started_at, 'hound', m, m, act, public.move_rate_of(act));

  if p_kind = 'strength' and p_sets is not null and jsonb_typeof(p_sets) = 'array' then
    if jsonb_array_length(p_sets) > 80 then
      raise exception 'That''s a lot of sets. 80 at most.';
    end if;
    for st in select * from jsonb_array_elements(p_sets) loop
      ex := trim(coalesce(st ->> 'exercise', ''));
      continue when ex = '' or (st ->> 'reps') is null;
      wt := nullif((st ->> 'weight_lb')::numeric, 0);
      rp := (st ->> 'reps')::int;
      select max(x.weight_lb) into best_w from public.move_sets x where x.user_id = me and lower(x.exercise) = lower(ex);
      select max(x.reps) into best_r from public.move_sets x
        where x.user_id = me and lower(x.exercise) = lower(ex) and x.weight_lb is not distinct from coalesce(best_w, wt);
      is_pr := exists (select 1 from public.move_sets x where x.user_id = me and lower(x.exercise) = lower(ex))
        and ((wt is not null and (best_w is null or wt > best_w))
          or (wt is not distinct from best_w and rp > coalesce(best_r, 0)));
      insert into public.move_sets (session_id, user_id, exercise, set_no, weight_lb, reps, is_pr)
        values (s.id, me, ex, coalesce((st ->> 'set_no')::int, 1), wt, rp, is_pr);
      if is_pr then
        prs := prs || jsonb_build_object('exercise', ex, 'weight_lb', wt, 'reps', rp, 'prev_weight_lb', best_w, 'prev_reps', best_r);
      end if;
    end loop;
  end if;

  select i.pts into got from public.move_day_items(me, day) i where i.source_id = sid;
  update public.move_sessions set source_id = sid, pts = coalesce(got, 0) where id = s.id;
  return jsonb_build_object(
    'minutes', m, 'pts', coalesce(got, 0), 'activity', act, 'prs', prs,
    'today', public.move_points_day(me, day),
    'strength', public.move_strength_json(me, coalesce(p_local_date, day)));
end;
$$;
revoke execute on function public.move_offline_session(text, text, timestamptz, timestamptz, int, boolean, jsonb, date) from public, anon;
grant execute on function public.move_offline_session(text, text, timestamptz, timestamptz, int, boolean, jsonb, date) to authenticated;

-- ── Applying what waited on the phone ──

-- p_done_at: when it happened on the phone. Answers the op's own result,
-- {"error": "..."} when a rule turns it down, or the first answer again
-- (with "repeat": true) for an id it has seen.
create or replace function public.offline_apply(p_client_id uuid, p_op text, p_args jsonb, p_done_at timestamptz default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  prior jsonb;
  res jsonb;
  a jsonb := coalesce(p_args, '{}'::jsonb);
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_client_id is null then
    raise exception 'Missing id.';
  end if;
  -- One at a time per id, so two sends at once can't both apply it.
  perform pg_advisory_xact_lock(hashtext('client_op:' || me::text || ':' || p_client_id::text));
  select c.result into prior from public.client_ops c where c.user_id = me and c.client_id = p_client_id;
  if found then
    return coalesce(prior, '{}'::jsonb) || jsonb_build_object('repeat', true);
  end if;

  begin
    res := case p_op
      when 'move_offline_session' then public.move_offline_session(
        a ->> 'kind', a ->> 'ref', (a ->> 'started_at')::timestamptz, (a ->> 'ended_at')::timestamptz,
        (a ->> 'minutes')::int, coalesce((a ->> 'hard')::boolean, false), a -> 'sets', (a ->> 'local_date')::date)
      when 'log_workout' then public.log_workout(
        a ->> 'type', (a ->> 'minutes')::int, (a ->> 'ended_at')::timestamptz, (a ->> 'phone_steps')::int)
      when 'fasting_start' then public.fasting_start(
        (a ->> 'plan_hours')::int, (a ->> 'started_at')::timestamptz, '{}'::uuid[])
      when 'fasting_end' then public.fasting_end((a ->> 'local_date')::date, (a ->> 'ended_at')::timestamptz)
      when 'log_water' then jsonb_build_object('id', public.log_water((a ->> 'day')::date, (a ->> 'ml')::int))
    end;
    if res is null and p_op not in ('move_offline_session', 'log_workout', 'fasting_start', 'fasting_end', 'log_water') then
      raise exception 'Unknown op %.', p_op;
    end if;
  exception when others then
    insert into public.client_op_failures (user_id, client_id, op, message, done_at)
      values (me, p_client_id, coalesce(p_op, '?'), left(sqlerrm, 300), p_done_at);
    return jsonb_build_object('error', sqlerrm);
  end;

  insert into public.client_ops (user_id, client_id, op, done_at, result)
    values (me, p_client_id, p_op, p_done_at, coalesce(res, '{}'::jsonb));
  return coalesce(res, '{}'::jsonb);
end;
$$;
revoke execute on function public.offline_apply(uuid, text, jsonb, timestamptz) from public, anon;
grant execute on function public.offline_apply(uuid, text, jsonb, timestamptz) to authenticated;

-- ── Admin ──

create or replace function public.admin_offline_overview()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  res jsonb;
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'not authorized';
  end if;
  with o as (select * from public.client_ops where applied_at > now() - interval '7 days'),
  late as (select extract(epoch from (applied_at - done_at)) / 60.0 as mins from o where done_at is not null),
  f as (select * from public.client_op_failures where at > now() - interval '7 days')
  select jsonb_build_object(
    'enabled', (select enabled from public.offline_config where id),
    'hound_cap_min', (select hound_cap_min from public.offline_config where id),
    'ops_7d', (select count(*) from o),
    'people_7d', (select count(distinct user_id) from o),
    'by_op_7d', coalesce((select jsonb_object_agg(op, n) from (select op, count(*) n from o group by op) z), '{}'::jsonb),
    'late_ops_7d', (select count(*) from late where mins >= 1),
    'median_late_min', (select round((percentile_cont(0.5) within group (order by mins))::numeric, 1) from late where mins >= 1),
    'over_hour_7d', (select count(*) from late where mins >= 60),
    'offline_sessions_7d', (select count(*) from public.move_sessions where offline and finished_at > now() - interval '7 days'),
    'failures_7d', (select count(*) from f),
    'top_failures', coalesce((select jsonb_agg(jsonb_build_object('message', message, 'n', n) order by n desc)
      from (select message, count(*) n from f group by message order by 2 desc limit 5) z), '[]'::jsonb))
  into res;
  return res;
end;
$$;
revoke execute on function public.admin_offline_overview() from public, anon;
grant execute on function public.admin_offline_overview() to authenticated;

create or replace function public.admin_set_offline_config(p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'Admins only.';
  end if;
  if p ? 'enabled' and jsonb_typeof(p -> 'enabled') <> 'boolean' then
    raise exception 'On or off.';
  end if;
  if p ? 'hound_cap_min' and (jsonb_typeof(p -> 'hound_cap_min') <> 'number'
      or (p ->> 'hound_cap_min')::numeric not between 0 and 1440
      or (p ->> 'hound_cap_min')::numeric <> floor((p ->> 'hound_cap_min')::numeric)) then
    raise exception 'Enter whole minutes from 0 to 1,440.';
  end if;
  update public.offline_config c set
    enabled = coalesce((p ->> 'enabled')::boolean, c.enabled),
    hound_cap_min = coalesce((p ->> 'hound_cap_min')::int, c.hound_cap_min),
    updated_at = now()
  where c.id;
end;
$$;
revoke execute on function public.admin_set_offline_config(jsonb) from public, anon;
grant execute on function public.admin_set_offline_config(jsonb) to authenticated;
