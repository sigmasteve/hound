-- Hound: change the goal of the fast you're on.
--
-- Started on the wrong plan (Start fast uses the last one you fasted), or
-- want to go longer or stop sooner: fasting_set_goal sets the open fast's
-- goal, 12 to 24 hours, and makes it the plan for next time. Not below
-- what you've already fasted, so a goal can't be met by shortening it.
-- The phase games' slots follow the new goal (fasting_slot_at reads it).
--
-- Run this once, after 0272, in the SQL Editor.

create or replace function public.fasting_set_goal(p_goal_hours int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  f public.fasts;
  h numeric;
begin
  perform public.fasting_require_ok(me);
  if p_goal_hours is null or p_goal_hours < 12 or p_goal_hours > 24 then
    raise exception 'A plan is 12 to 24 hours.';
  end if;
  select * into f from public.fasts where user_id = me and ended_at is null for update;
  if f.id is null then
    raise exception 'You''re not fasting.';
  end if;
  h := extract(epoch from (now() - f.started_at)) / 3600.0;
  if p_goal_hours <= h then
    raise exception 'You''ve already fasted % h. Pick a longer goal, or end your fast.', floor(h);
  end if;
  update public.fasts set goal_hours = p_goal_hours where id = f.id returning * into f;
  update public.fasting_profiles set plan_hours = p_goal_hours, updated_at = now() where user_id = me;
  return public.fasting_open_json(f);
end;
$$;
revoke execute on function public.fasting_set_goal(int) from public, anon;
grant execute on function public.fasting_set_goal(int) to authenticated;

-- To undo:
--   drop function public.fasting_set_goal(int);
