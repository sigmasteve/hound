-- 0286: Fix a fast's times (Steve, 27 Nov 2026: "if folks forget and
-- they are now at 48 hours, when they remember can they adjust it to the
-- accurate time. Also, as an admin, I may need the ability to adjust
-- times as well").
--
--   Yours      fasting_fix: the start of the fast you're on, or the start
--              and end of one that ended in the last 7 days. A start can
--              go back up to 12 hours before you pressed Start (as when
--              starting); nothing in the future, nothing over another
--              fast. Ending a fast you forgot is still End fast with "I
--              ate at…", which now reaches back to the start in the app.
--   Admin      admin_user_fasts (a member's fasts, Admin → People → a
--              member) and admin_fasting_fix: any fast's start and end,
--              including ending one that's still open. The local day
--              comes from the member's time zone.
--   Either way the fast's hours and on plan are worked out again, its
--   hours' Bones are put right (more or less, once a day as before; the
--   balance never goes below 0), and the streak is counted again from
--   the fasts on plan. Streak milestone Bones already paid stay; a fix
--   doesn't pay new ones. Every fix is kept in fasting_fixes, for Admin →
--   Overview → Fitness → Fasting.
--
-- Run this once, after 0001-0285, in the SQL Editor.

create table public.fasting_fixes (
  id uuid primary key default gen_random_uuid(),
  fast_id uuid not null references public.fasts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  by_user uuid references public.profiles (id) on delete set null,
  by_admin boolean not null default false,
  old_started_at timestamptz not null,
  old_ended_at timestamptz,
  new_started_at timestamptz not null,
  new_ended_at timestamptz,
  bones_change int not null default 0,
  created_at timestamptz not null default now()
);
create index fasting_fixes_created on public.fasting_fixes (created_at);
create index fasting_fixes_fast on public.fasting_fixes (fast_id);
alter table public.fasting_fixes enable row level security;
revoke all on public.fasting_fixes from anon, authenticated;

-- The streak counted again from the fasts on plan, oldest first, with
-- the same rest days and weekly free miss as when a fast ends. The best
-- streak never goes down.
create or replace function public.fasting_restreak(p_user uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  fp public.fasting_profiles;
  d date;
  last date := null;
  s int := 0;
  best int := 0;
begin
  select * into fp from public.fasting_profiles where user_id = p_user for update;
  if fp.user_id is null then
    return;
  end if;
  delete from public.fasting_freezes where user_id = p_user;
  for d in
    select distinct f.local_day from public.fasts f
    where f.user_id = p_user and f.ended_at is not null and f.on_plan and f.local_day is not null
    order by 1
  loop
    if last is not null and public.fasting_streak_holds(p_user, last, d, fp.rest_days, true) then
      s := s + 1;
    else
      s := 1;
    end if;
    best := greatest(best, s);
    last := d;
  end loop;
  update public.fasting_profiles
    set streak = s, best_streak = greatest(best_streak, best), last_on = last, updated_at = now()
    where user_id = p_user;
end;
$$;
revoke execute on function public.fasting_restreak(uuid) from public, anon, authenticated;

-- The fix itself, for both. p_end null on an open fast moves its start
-- only; with p_end it ends it (Admin).
create or replace function public.fasting_apply_fix(p_fast_id uuid, p_start timestamptz, p_end timestamptz, p_local_day date, p_by uuid, p_admin boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  f public.fasts;
  c public.fasting_config;
  h numeric;
  plan_ok boolean;
  old_pay int := 0;
  keep int := 0;
  new_pay int := 0;
  delta int := 0;
  fp public.fasting_profiles;
begin
  select * into f from public.fasts where id = p_fast_id for update;
  if f.id is null then
    raise exception 'That fast isn''t there.';
  end if;
  if p_start is null then
    raise exception 'Pick when it started.';
  end if;
  if p_start > now() + interval '1 minute' then
    raise exception 'That time hasn''t happened yet.';
  end if;
  p_start := least(p_start, now());
  if f.ended_at is not null and p_end is null then
    raise exception 'Pick when it ended.';
  end if;
  if p_end is not null then
    if p_end > now() + interval '1 minute' then
      raise exception 'That time hasn''t happened yet.';
    end if;
    p_end := least(p_end, now());
    if p_end <= p_start then
      raise exception 'It has to end after it starts.';
    end if;
    if p_local_day is null then
      raise exception 'Invalid date.';
    end if;
  end if;
  if exists (
    select 1 from public.fasts x
    where x.user_id = f.user_id and x.id <> f.id
      and x.started_at < coalesce(p_end, 'infinity'::timestamptz)
      and coalesce(x.ended_at, 'infinity'::timestamptz) > p_start
  ) then
    raise exception 'That overlaps another fast.';
  end if;

  if p_end is null then
    update public.fasts set started_at = p_start where id = f.id;
    insert into public.fasting_fixes (fast_id, user_id, by_user, by_admin, old_started_at, old_ended_at, new_started_at, new_ended_at)
      values (f.id, f.user_id, p_by, p_admin, f.started_at, null, p_start, null);
    return jsonb_build_object('fast_id', f.id, 'started_at', p_start, 'ended_at', null, 'bones_change', 0);
  end if;

  select * into c from public.fasting_config where id;
  h := round(extract(epoch from (p_end - p_start)) / 3600.0, 2);
  plan_ok := h >= f.goal_hours;
  -- What it paid for its hours (the rest was a streak milestone, kept).
  if f.ended_at is not null and f.bones > 0 then
    old_pay := least(f.bones, public.fasting_hours_bones(f.hours, c));
    keep := f.bones - old_pay;
  end if;
  -- Once a day, as when a fast ends: unless another fast that day paid.
  if not exists (
    select 1 from public.fasts x
    where x.user_id = f.user_id and x.id <> f.id and x.local_day = p_local_day and x.bones > 0
  ) then
    new_pay := public.fasting_hours_bones(h, c);
  end if;
  delta := new_pay - old_pay;

  update public.fasts
    set started_at = p_start, ended_at = p_end, hours = h, on_plan = plan_ok, local_day = p_local_day, bones = new_pay + keep
    where id = f.id;
  if delta <> 0 then
    update public.profiles set bones_balance = greatest(0, bones_balance + delta) where id = f.user_id;
    insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
      values (f.user_id, 'fasting_fix', 0, 0, delta);
  end if;
  insert into public.fasting_fixes (fast_id, user_id, by_user, by_admin, old_started_at, old_ended_at, new_started_at, new_ended_at, bones_change)
    values (f.id, f.user_id, p_by, p_admin, f.started_at, f.ended_at, p_start, p_end, delta);
  perform public.fasting_restreak(f.user_id);
  if plan_ok and f.pack_id is not null then
    perform public.fasting_pack_settle(f.pack_id);
  end if;
  select * into fp from public.fasting_profiles where user_id = f.user_id;
  return jsonb_build_object(
    'fast_id', f.id, 'started_at', p_start, 'ended_at', p_end, 'hours', h, 'goal_hours', f.goal_hours,
    'on_plan', plan_ok, 'bones_change', delta, 'streak', coalesce(fp.streak, 0));
end;
$$;
revoke execute on function public.fasting_apply_fix(uuid, timestamptz, timestamptz, date, uuid, boolean) from public, anon, authenticated;

-- Yours: the fast you're on (its start), or one that ended in the last
-- 7 days (start and end; p_local_date is your own date at the new end).
create or replace function public.fasting_fix(p_fast_id uuid, p_started_at timestamptz, p_ended_at timestamptz default null, p_local_date date default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  f public.fasts;
  end_utc date;
begin
  perform public.fasting_require_ok(me);
  select * into f from public.fasts where id = p_fast_id and user_id = me;
  if f.id is null then
    raise exception 'That fast isn''t yours.';
  end if;
  if f.ended_at is null and p_ended_at is not null then
    raise exception 'End it with End fast.';
  end if;
  if f.ended_at is not null and f.ended_at < now() - interval '7 days' then
    raise exception 'You can fix fasts from the last 7 days.';
  end if;
  if p_started_at < f.created_at - interval '12 hours' then
    raise exception 'A fast can start up to 12 hours before you pressed Start.';
  end if;
  if f.ended_at is not null then
    if p_ended_at is null then
      raise exception 'Pick when it ended.';
    end if;
    end_utc := (p_ended_at at time zone 'utc')::date;
    if p_local_date is null or p_local_date < end_utc - 1 or p_local_date > end_utc + 1 then
      raise exception 'Invalid date.';
    end if;
  end if;
  return public.fasting_apply_fix(f.id, p_started_at, p_ended_at, case when f.ended_at is null then null else p_local_date end, me, false);
end;
$$;
revoke execute on function public.fasting_fix(uuid, timestamptz, timestamptz, date) from public, anon;
grant execute on function public.fasting_fix(uuid, timestamptz, timestamptz, date) to authenticated;

-- ── Admin ──

-- A member's last 30 fasts, the open one first, and their streak.
create or replace function public.admin_user_fasts(p_user uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  return jsonb_build_object(
    'time_zone', (select time_zone from public.profiles where id = p_user),
    'streak', coalesce((select streak from public.fasting_profiles where user_id = p_user), 0),
    'fasts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'goal_hours', f.goal_hours, 'started_at', f.started_at, 'ended_at', f.ended_at,
        'hours', coalesce(f.hours, round(extract(epoch from (now() - f.started_at)) / 3600.0, 2)),
        'on_plan', f.on_plan, 'local_day', f.local_day, 'bones', f.bones,
        'fixes', (select count(*) from public.fasting_fixes x where x.fast_id = f.id))
        order by f.ended_at desc nulls first)
      from (select * from public.fasts where user_id = p_user order by ended_at desc nulls first limit 30) f), '[]'));
end;
$$;
revoke execute on function public.admin_user_fasts(uuid) from public, anon;
grant execute on function public.admin_user_fasts(uuid) to authenticated;

-- Any fast's start and end; an end on an open fast ends it.
create or replace function public.admin_fasting_fix(p_fast_id uuid, p_started_at timestamptz, p_ended_at timestamptz default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  f public.fasts;
  tz text;
  ld date;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  select * into f from public.fasts where id = p_fast_id;
  if f.id is null then
    raise exception 'That fast isn''t there.';
  end if;
  if p_ended_at is not null then
    select time_zone into tz from public.profiles where id = f.user_id;
    if tz is not null then
      ld := (p_ended_at at time zone tz)::date;
    elsif f.ended_at is not null and f.local_day is not null then
      -- No time zone on file: keep the day it counted for, shifted by
      -- however many days the end moved.
      ld := f.local_day + ((p_ended_at at time zone 'utc')::date - (f.ended_at at time zone 'utc')::date);
    else
      ld := (p_ended_at at time zone 'utc')::date;
    end if;
  end if;
  return public.fasting_apply_fix(f.id, p_started_at, p_ended_at, ld, auth.uid(), true);
end;
$$;
revoke execute on function public.admin_fasting_fix(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_fasting_fix(uuid, timestamptz, timestamptz) to authenticated;

-- Admin → Overview → Fitness → Fasting: who fixes their times.
create or replace function public.admin_fasting_fix_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  return jsonb_build_object(
    'people_ever', (select count(distinct user_id) from public.fasting_fixes where not by_admin),
    'people_7d', (select count(distinct user_id) from public.fasting_fixes where not by_admin and created_at > now() - interval '7 days'),
    'fixes_7d', (select count(*) from public.fasting_fixes where not by_admin and created_at > now() - interval '7 days'),
    'starts_7d', (select count(*) from public.fasting_fixes where not by_admin and created_at > now() - interval '7 days'
                  and new_started_at <> old_started_at),
    'ends_7d', (select count(*) from public.fasting_fixes where not by_admin and created_at > now() - interval '7 days'
                and old_ended_at is not null and new_ended_at <> old_ended_at),
    -- Forgot to end it: a fast of 36 hours or more fixed to less.
    'forgot_7d', (select count(*) from public.fasting_fixes where created_at > now() - interval '7 days'
                  and old_ended_at is not null and old_ended_at - old_started_at >= interval '36 hours'
                  and new_ended_at - new_started_at < interval '36 hours'),
    'admin_7d', (select count(*) from public.fasting_fixes where by_admin and created_at > now() - interval '7 days'),
    'bones_7d', coalesce((select sum(bones_change) from public.fasting_fixes where created_at > now() - interval '7 days'), 0));
end;
$$;
revoke execute on function public.admin_fasting_fix_overview() from public, anon;
grant execute on function public.admin_fasting_fix_overview() to authenticated;
