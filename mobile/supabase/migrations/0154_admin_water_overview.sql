-- Hound: Admin → Water, how many people use the water tracker (0153).
--
-- One read for admins only, the same shape as admin_goals_overview
-- (0098): who has a water goal, who's logging, how much, and the water
-- badges. Plus the ten newest water goals by name, so it's clear who's
-- trying it.
--
-- Run this once, after 0001-0153, in the SQL Editor.

create or replace function public.admin_water_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  with active as (
    select p.id from public.profiles p where p.last_active_at > now() - interval '14 days'
  ),
  -- Each person's total for each day they logged, over the last week.
  logged_days as (
    select w.user_id, w.day, sum(w.ml) as ml
    from public.water_log w
    where w.logged_at > now() - interval '7 days'
    group by w.user_id, w.day
  )
  select jsonb_build_object(
    'with_goal', (select count(*) from public.water_goals),
    'active', (select count(*) from active),
    'active_with_goal', (select count(*) from public.water_goals g join active a on a.id = g.user_id),
    'added_7d', (select count(*) from public.water_goals g where g.created_at > now() - interval '7 days'),
    'cups', (select count(*) from public.water_goals g where g.units = 'cups'),
    'ml', (select count(*) from public.water_goals g where g.units = 'ml'),
    'sip_reminders', (select count(*) from public.water_goals g where g.sip_reminders),
    'logged_24h', (select count(distinct w.user_id) from public.water_log w where w.logged_at > now() - interval '24 hours'),
    'logged_7d', (select count(distinct l.user_id) from logged_days l),
    'glasses_7d', (select count(*) from public.water_log w where w.logged_at > now() - interval '7 days'),
    'avg_day_ml', (select coalesce(round(avg(l.ml)), 0) from logged_days l),
    'water_days_7d', (select count(*) from public.water_days d where d.day > current_date - 7),
    'badges', jsonb_build_object(
      'water_first', (select count(*) from public.user_achievements ua where ua.achievement_id = 'water_first'),
      'water_7', (select count(*) from public.user_achievements ua where ua.achievement_id = 'water_7'),
      'water_30', (select count(*) from public.user_achievements ua where ua.achievement_id = 'water_30')
    ),
    'newest', coalesce((
      select jsonb_agg(jsonb_build_object('name', n.name, 'added_at', n.created_at) order by n.created_at desc)
      from (
        select coalesce(nullif(p.username, ''), p.name) as name, g.created_at
        from public.water_goals g join public.profiles p on p.id = g.user_id
        order by g.created_at desc
        limit 10
      ) n
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke execute on function public.admin_water_overview() from public, anon;
grant execute on function public.admin_water_overview() to authenticated;
