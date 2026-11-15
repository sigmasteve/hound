-- Hound: spotting people whose phone syncs but sends 0 steps.
--
-- When Hound can't read steps (on iPhone, Steps turned off for Hound in
-- Health), Health doesn't say so: it returns nothing, Hound saves 0, and
-- the person's challenges sit at 0 though they're "syncing". The app now
-- warns them on Today; these give Admin the same view:
--
--   - admin_user_steps_recent(user): their last 7 days of daily_step_totals
--     (what the app saves from Health each day it opens), and how many of
--     their most recent saved days in a row were 0.
--   - admin_health_zero_overview(): everyone who opened Hound in the last
--     3 days whose last 3 or more saved days were all 0 steps, for
--     Admin → Overview → Status.
--
-- Admins only; nothing new is stored.

create or replace function public.admin_user_steps_recent(p_user uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  streak int := 0;
  r record;
  last_nonzero date;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  for r in
    select d.day, d.steps from public.daily_step_totals d
    where d.user_id = p_user and d.day >= current_date - 30
    order by d.day desc
  loop
    exit when r.steps > 0;
    streak := streak + 1;
  end loop;
  select max(d.day) into last_nonzero from public.daily_step_totals d where d.user_id = p_user and d.steps > 0;
  return jsonb_build_object(
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'steps', d.steps) order by d.day), '[]'::jsonb)
      from public.daily_step_totals d
      where d.user_id = p_user and d.day >= current_date - 6
    ),
    'zero_streak', streak,
    'last_nonzero_day', last_nonzero
  );
end;
$$;
revoke execute on function public.admin_user_steps_recent(uuid) from public, anon;
grant execute on function public.admin_user_steps_recent(uuid) to authenticated;

create or replace function public.admin_health_zero_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return (
    with active as (
      select p.id, p.name, p.last_active_at
      from public.profiles p
      where p.last_active_at > now() - interval '3 days'
    ),
    -- Each active person's saved days over the last 30, newest first,
    -- numbered, with a running count of non-zero days.
    recent as (
      select d.user_id, d.day, d.steps,
        row_number() over (partition by d.user_id order by d.day desc) as n,
        count(*) filter (where d.steps > 0) over (partition by d.user_id order by d.day desc) as nonzero_so_far
      from public.daily_step_totals d
      join active a on a.id = d.user_id
      where d.day >= current_date - 30
    ),
    streaks as (
      select r.user_id, count(*) filter (where r.nonzero_so_far = 0)::int as zero_days
      from recent r
      group by r.user_id
    ),
    flagged as (
      select a.id, a.name, a.last_active_at, s.zero_days,
        (select max(d.day) from public.daily_step_totals d where d.user_id = a.id and d.steps > 0) as last_nonzero_day
      from active a
      join streaks s on s.user_id = a.id
      where s.zero_days >= 3
    )
    select jsonb_build_object(
      'count', (select count(*) from flagged),
      'people', coalesce((
        select jsonb_agg(jsonb_build_object(
            'user_id', f.id, 'name', f.name, 'zero_days', f.zero_days,
            'last_active_at', f.last_active_at, 'last_nonzero_day', f.last_nonzero_day)
          order by f.zero_days desc, f.last_active_at desc)
        from flagged f), '[]'::jsonb)
    )
  );
end;
$$;
revoke execute on function public.admin_health_zero_overview() from public, anon;
grant execute on function public.admin_health_zero_overview() to authenticated;
