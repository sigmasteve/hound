-- Hound: the welcome wizard's "What will you use Hound for?" page.
--
-- One checkbox per part of Hound (Steps, Intermittent fasting, Workouts,
-- Activities with no watch, Strength training, Water, Games with friends),
-- saved in profiles.hound_uses (0109). It replaces About you's interest
-- chips, and Settings' separate interests (K-08, 0151) fold into it:
--   - save_hound_uses takes the new values (the old ones still save, so an
--     older app keeps working);
--   - what people already said moves across: cardio becomes workouts, and
--     K-08's interests add their match (athlete → workouts, sports →
--     activities, gym → strength, weight loss and general → steps). Never
--     fasting: ticking it puts the Fasting tile on Today, so only a tick
--     does that.
--   - admin_uses_overview(): how many tick each, and how many of them have
--     tried it and use it now (Admin → Overview → Status).
--
-- Run this once, after 0271, in the SQL Editor.

create or replace function public.save_hound_uses(p_uses text[])
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  allowed constant text[] := array[
    'steps', 'fasting', 'workouts', 'activities', 'strength', 'water', 'friends',
    -- Before 0272.
    'cardio', 'habits', 'other'
  ];
  cleaned text[];
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  select coalesce(array_agg(distinct u order by u), '{}') into cleaned
    from unnest(coalesce(p_uses, '{}')) u
    where u = any (allowed);
  update public.profiles p set hound_uses = cleaned where p.id = caller;
end;
$$;

revoke execute on function public.save_hound_uses(text[]) from public, anon;
grant execute on function public.save_hound_uses(text[]) to authenticated;

-- What's already been said, moved across.
update public.profiles p
set hound_uses = (
  select coalesce(array_agg(distinct u order by u), '{}')
  from (
    select case when x = 'cardio' then 'workouts' else x end as u
    from unnest(p.hound_uses) x
    union
    select case i
      when 'athlete' then 'workouts'
      when 'sports' then 'activities'
      when 'gym' then 'strength'
      else 'steps'
    end
    from public.profile_interests pi, unnest(pi.interests) i
    where pi.user_id = p.id
  ) s
)
where 'cardio' = any (p.hound_uses)
   or exists (select 1 from public.profile_interests pi where pi.user_id = p.id and cardinality(pi.interests) > 0);

-- Admin: per checkbox, how many ticked it, how many of those have tried
-- it and how many use it now (the last 7 days).
create or replace function public.admin_uses_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  since timestamptz := now() - interval '7 days';
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  with ticked as (
    select p.id, u
    from public.profiles p, unnest(p.hound_uses) u
    where u in ('steps', 'fasting', 'workouts', 'activities', 'strength', 'water', 'friends')
  ),
  scored as (
    select t.u,
      t.id,
      case t.u
        when 'steps' then exists (select 1 from public.daily_step_totals d where d.user_id = t.id and d.steps > 0)
        when 'fasting' then exists (select 1 from public.fasts f where f.user_id = t.id)
        when 'workouts' then exists (select 1 from public.workout_history w where w.user_id = t.id and w.source not in ('manual', 'hound'))
        when 'activities' then exists (select 1 from public.workout_history w where w.user_id = t.id and w.source in ('manual', 'hound'))
        when 'strength' then exists (select 1 from public.move_sessions s where s.user_id = t.id and s.finished_at is not null and not s.cancelled)
        when 'water' then exists (select 1 from public.water_log l where l.user_id = t.id)
        when 'friends' then exists (select 1 from public.challenge_participants c where c.user_id = t.id)
      end as tried,
      case t.u
        when 'steps' then exists (select 1 from public.daily_step_totals d where d.user_id = t.id and d.steps > 0 and d.day >= (since)::date)
        when 'fasting' then exists (select 1 from public.fasts f where f.user_id = t.id and f.started_at >= since)
        when 'workouts' then exists (select 1 from public.workout_history w where w.user_id = t.id and w.source not in ('manual', 'hound') and w.occurred_at >= since)
        when 'activities' then exists (select 1 from public.workout_history w where w.user_id = t.id and w.source in ('manual', 'hound') and w.occurred_at >= since)
        when 'strength' then exists (select 1 from public.move_sessions s where s.user_id = t.id and s.finished_at >= since and not s.cancelled)
        when 'water' then exists (select 1 from public.water_log l where l.user_id = t.id and l.logged_at >= since)
        when 'friends' then exists (
          select 1 from public.challenge_participants c join public.challenges ch on ch.id = c.challenge_id
          where c.user_id = t.id and ch.ends_at >= now() and ch.starts_at <= now())
      end as now_
    from ticked t
  )
  select jsonb_build_object(
    'answered', (select count(*) from public.profiles p where cardinality(p.hound_uses) > 0),
    'answered_30d', (select count(*) from public.profiles p where cardinality(p.hound_uses) > 0 and p.created_at >= now() - interval '30 days'),
    'new_30d', (select count(*) from public.profiles p where p.created_at >= now() - interval '30 days'),
    'uses', coalesce((
      select jsonb_object_agg(u, jsonb_build_object('ticked', n, 'tried', tried, 'now', now_n))
      from (
        select u, count(*) as n, count(*) filter (where tried) as tried, count(*) filter (where now_) as now_n
        from scored group by u
      ) g
    ), '{}'::jsonb),
    'fasting_tile_waiting', (
      select count(*) from ticked t
      where t.u = 'fasting'
        and not exists (select 1 from public.fasts f where f.user_id = t.id)
        and not exists (select 1 from public.fasting_profiles fp where fp.user_id = t.id and fp.age = 'under')
    )
  ) into result;
  return result;
end;
$$;

revoke execute on function public.admin_uses_overview() from public, anon;
grant execute on function public.admin_uses_overview() to authenticated;

-- To undo:
--   drop function public.admin_uses_overview();
--   (save_hound_uses as in 0175; the moved answers stay.)
