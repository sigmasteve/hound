-- Hound: the numbers behind Admin → Goals, for platform admins only.
--
-- Everything is counted over people who've opened Hound in the last 14
-- days (the same window as Admin → App versions):
--
--   active            how many people that is
--   goals_set         of them, how many have set their own goals (goal
--                     setup on Today, or any change on the Goals screen)
--   custom_goals      how many have a goal beyond the three starters
--   levels            how many on each hounding level (no row = gentle)
--   phone_scheduled   how many phones have today's reminders scheduled
--                     themselves (hound_settings.scheduled_through)
--   backups_24h       how many got the 9 PM backup reminder in the last
--                     24 hours (send-login-reminders)
--   steps_hit / steps_tracked
--                     yesterday (UTC), of those with a daily steps goal and
--                     a step total on file (daily_step_totals), how many
--                     reached their goal
--
-- Run this once, after 0001-0097, in the SQL Editor.

create or replace function public.admin_goals_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  yesterday date := (now() at time zone 'UTC')::date - 1;
  result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  with active as (
    select p.id from public.profiles p
    where p.last_active_at > now() - interval '14 days'
  ),
  settings as (
    select a.id, coalesce(h.level, 'gentle') as level, h.goals_set_at, h.scheduled_through
    from active a
    left join public.hound_settings h on h.user_id = a.id
  ),
  custom as (
    select distinct g.user_id
    from public.goals g
    join active a on a.id = g.user_id
    where g.archived_at is null
      and (g.label is not null
           or g.activity is not null
           or (g.metric, g.period) not in (('steps', 'day'), ('distance_mi', 'day'), ('workouts', 'week')))
  ),
  steps_goals as (
    select distinct on (g.user_id) g.user_id, g.target
    from public.goals g
    join active a on a.id = g.user_id
    where g.archived_at is null and g.metric = 'steps' and g.period = 'day'
    order by g.user_id, g.sort
  ),
  steps_yesterday as (
    select sg.user_id, d.steps >= sg.target as hit
    from steps_goals sg
    join public.daily_step_totals d on d.user_id = sg.user_id and d.day = yesterday
  )
  select jsonb_build_object(
    'active', (select count(*) from active),
    'goals_set', (select count(*) from settings where goals_set_at is not null),
    'custom_goals', (select count(*) from custom),
    'levels', jsonb_build_object(
      'gentle', (select count(*) from settings where level = 'gentle'),
      'persistent', (select count(*) from settings where level = 'persistent'),
      'relentless', (select count(*) from settings where level = 'relentless'),
      'off', (select count(*) from settings where level = 'off')
    ),
    'phone_scheduled', (select count(*) from settings where scheduled_through >= (now() at time zone 'UTC')::date),
    'backups_24h', (
      select count(*) from public.profiles p
      where p.last_login_reminder_sent_at > now() - interval '24 hours'
    ),
    'steps_hit', (select count(*) from steps_yesterday where hit),
    'steps_tracked', (select count(*) from steps_yesterday)
  ) into result;

  return result;
end;
$$;

revoke execute on function public.admin_goals_overview() from public, anon;
grant execute on function public.admin_goals_overview() to authenticated;

-- Undo, if needed:
--   drop function public.admin_goals_overview();
