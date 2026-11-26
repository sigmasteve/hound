-- Hound: fasting and logging an activity from the Apple Watch, and the
-- phone widgets' taps for Admin.
--
-- The watch (0189) acts as its person through watch_act_as, so these run
-- the phone's own functions with all their checks:
--   watch_today          now also sends fasting: your age answer, plan,
--                        the open fast (start and goal) and your streak
--   watch_fasting_start  fasting_start on your plan, or the one picked
--   watch_fasting_end    fasting_end, as if ended on the phone
--   watch_log_activity   log_workout (0204): a type and minutes, ending now
--   watch_undo_activity  undo_logged_workout, in its 15 minutes
-- watch_activity counts fast starts and ends and activities a day, for
-- Admin → Apple Watch.
--
-- The phone's widgets (the Fasting widget, and "+ Activity" on the Hound
-- widget) open Hound with a link; the app notes each tap here
-- (note_widget_tap) so Admin → Apple Watch shows widget taps too.
--
-- Run this once, after 0273, in the SQL Editor. The watch needs the 1.3.0
-- build to use it.

alter table public.watch_activity
  add column if not exists fast_starts int not null default 0,
  add column if not exists fast_ends int not null default 0,
  add column if not exists activities int not null default 0;

create table if not exists public.widget_taps (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('fasting', 'activity', 'goals')),
  n int not null default 0,
  primary key (user_id, day, kind)
);
alter table public.widget_taps enable row level security;
revoke all on public.widget_taps from anon, authenticated;

create or replace function public.note_widget_tap(p_kind text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or p_kind not in ('fasting', 'activity', 'goals') then
    return;
  end if;
  insert into public.widget_taps (user_id, day, kind, n) values (me, current_date, p_kind, 1)
    on conflict (user_id, day, kind) do update set n = public.widget_taps.n + 1;
end;
$$;
revoke execute on function public.note_widget_tap(text) from public, anon;
grant execute on function public.note_widget_tap(text) to authenticated;

-- What the watch shows for fasting. Null age: not answered yet (the phone
-- asks); 'under': no fasting.
create or replace function public.watch_fasting_json(u uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  fp public.fasting_profiles;
  f public.fasts;
begin
  select * into fp from public.fasting_profiles where user_id = u;
  select * into f from public.fasts where user_id = u and ended_at is null;
  return jsonb_build_object(
    'age', fp.age,
    'plan_hours', coalesce(fp.plan_hours, 16),
    'open', case when f.id is null then null else jsonb_build_object('started_at', f.started_at, 'goal_hours', f.goal_hours) end,
    'streak', case when fp.age = 'ok' then coalesce((public.fasting_numbers(u, p_day) ->> 'streak')::int, 0) else 0 end
  );
end;
$$;
revoke execute on function public.watch_fasting_json(uuid, date) from public, anon, authenticated;

-- 0189's watch_today, plus fasting.
create or replace function public.watch_today(p_device uuid, p_secret text, p_day date)
returns jsonb
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  u uuid := public.watch_act_as(p_device, p_secret);
  streak jsonb;
begin
  insert into public.watch_activity (user_id, day, opens) values (u, p_day, 1)
    on conflict (user_id, day) do update set opens = public.watch_activity.opens + 1;
  begin
    select to_jsonb(s) into streak from public.my_goal_streak(p_day) s;
  exception when others then
    streak := null;
  end;
  return jsonb_build_object(
    'name', (select split_part(p.name, ' ', 1) from public.profiles p where p.id = u),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object('metric', g.metric, 'period', g.period, 'target', g.target, 'activity', g.activity, 'label', g.label) order by g.sort, g.created_at)
      from public.goals g where g.user_id = u and g.archived_at is null
    ), '[]'::jsonb),
    'water', (
      select jsonb_build_object(
        'target_ml', wg.target_ml, 'glass_ml', wg.glass_ml, 'units', wg.units,
        'today_ml', (select coalesce(sum(l.ml), 0) from public.water_log l where l.user_id = u and l.day = p_day)
      )
      from public.water_goals wg where wg.user_id = u
    ),
    'streak', streak,
    'fasting', public.watch_fasting_json(u, p_day)
  );
end;
$$;
revoke execute on function public.watch_today(uuid, text, date) from public;
grant execute on function public.watch_today(uuid, text, date) to anon, authenticated;

-- Start a fast from the wrist: your plan, or the hours picked there.
-- Returns the watch's fasting state.
create or replace function public.watch_fasting_start(p_device uuid, p_secret text, p_day date, p_plan_hours int default null)
returns jsonb
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  u uuid := public.watch_act_as(p_device, p_secret);
  plan int := coalesce(p_plan_hours, (select fp.plan_hours from public.fasting_profiles fp where fp.user_id = u), 16);
begin
  perform public.fasting_start(plan, null, '{}');
  insert into public.watch_activity (user_id, day, fast_starts) values (u, p_day, 1)
    on conflict (user_id, day) do update set fast_starts = public.watch_activity.fast_starts + 1;
  return public.watch_fasting_json(u, p_day);
end;
$$;
revoke execute on function public.watch_fasting_start(uuid, text, date, int) from public;
grant execute on function public.watch_fasting_start(uuid, text, date, int) to anon, authenticated;

-- End the fast now: fasting_end's result (hours, on plan, Bones, streak).
create or replace function public.watch_fasting_end(p_device uuid, p_secret text, p_day date)
returns jsonb
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  u uuid := public.watch_act_as(p_device, p_secret);
  r jsonb;
begin
  r := public.fasting_end(p_day, null);
  insert into public.watch_activity (user_id, day, fast_ends) values (u, p_day, 1)
    on conflict (user_id, day) do update set fast_ends = public.watch_activity.fast_ends + 1;
  return r;
end;
$$;
revoke execute on function public.watch_fasting_end(uuid, text, date) from public;
grant execute on function public.watch_fasting_end(uuid, text, date) to anon, authenticated;

-- Log an activity from the wrist, ending now: log_workout's own limits
-- (a day's count, its minutes, the 2-hour Move points cap) apply.
create or replace function public.watch_log_activity(p_device uuid, p_secret text, p_day date, p_type text, p_minutes int)
returns jsonb
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  u uuid := public.watch_act_as(p_device, p_secret);
  r jsonb;
begin
  r := public.log_workout(p_type, p_minutes, now(), null);
  insert into public.watch_activity (user_id, day, activities) values (u, p_day, 1)
    on conflict (user_id, day) do update set activities = public.watch_activity.activities + 1;
  return r;
end;
$$;
revoke execute on function public.watch_log_activity(uuid, text, date, text, int) from public;
grant execute on function public.watch_log_activity(uuid, text, date, text, int) to anon, authenticated;

create or replace function public.watch_undo_activity(p_device uuid, p_secret text, p_source_id text)
returns boolean
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  u uuid := public.watch_act_as(p_device, p_secret);
begin
  perform public.undo_logged_workout(p_source_id);
  return true;
end;
$$;
revoke execute on function public.watch_undo_activity(uuid, text, text) from public;
grant execute on function public.watch_undo_activity(uuid, text, text) to anon, authenticated;

-- Admin → Apple Watch: 0189's numbers, plus fasting and activities from
-- the watch and the phone widgets' taps.
create or replace function public.admin_watch_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'linked', (select count(*) from public.watch_devices w where w.user_id is not null and w.revoked_at is null),
    'people', (select count(distinct w.user_id) from public.watch_devices w where w.user_id is not null and w.revoked_at is null),
    'seen_24h', (select count(distinct w.user_id) from public.watch_devices w where w.revoked_at is null and w.last_seen_at > now() - interval '24 hours'),
    'seen_7d', (select count(distinct w.user_id) from public.watch_devices w where w.revoked_at is null and w.last_seen_at > now() - interval '7 days'),
    'opens_7d', (select coalesce(sum(a.opens), 0) from public.watch_activity a where a.day > current_date - 7),
    'water_taps_7d', (select coalesce(sum(a.water_taps), 0) from public.watch_activity a where a.day > current_date - 7),
    'water_people_7d', (select count(distinct a.user_id) from public.watch_activity a where a.day > current_date - 7 and a.water_taps > 0),
    'fast_starts_7d', (select coalesce(sum(a.fast_starts), 0) from public.watch_activity a where a.day > current_date - 7),
    'fast_ends_7d', (select coalesce(sum(a.fast_ends), 0) from public.watch_activity a where a.day > current_date - 7),
    'fast_people_7d', (select count(distinct a.user_id) from public.watch_activity a where a.day > current_date - 7 and a.fast_starts + a.fast_ends > 0),
    'activities_7d', (select coalesce(sum(a.activities), 0) from public.watch_activity a where a.day > current_date - 7),
    'activity_people_7d', (select count(distinct a.user_id) from public.watch_activity a where a.day > current_date - 7 and a.activities > 0),
    'widget_taps_7d', coalesce((
      select jsonb_object_agg(kind, n) from (
        select t.kind, sum(t.n) as n from public.widget_taps t where t.day > current_date - 7 group by t.kind
      ) k
    ), '{}'::jsonb),
    'widget_people_7d', (select count(distinct t.user_id) from public.widget_taps t where t.day > current_date - 7)
  );
end;
$$;
revoke execute on function public.admin_watch_overview() from public, anon;
grant execute on function public.admin_watch_overview() to authenticated;

-- To undo:
--   drop function public.watch_fasting_start(uuid, text, date, int), public.watch_fasting_end(uuid, text, date),
--     public.watch_log_activity(uuid, text, date, text, int), public.watch_undo_activity(uuid, text, text),
--     public.watch_fasting_json(uuid, date), public.note_widget_tap(text);
--   drop table public.widget_taps;
--   (watch_today and admin_watch_overview as in 0189.)
