-- Hound: Your first week's Global step counts the one you were joined to
-- (Steve, Nov 2026, testing as a new user: Hound joins new accounts to the
-- open Globals on the first open, so "Join a Global challenge" sat
-- unticked beside one they were already in).
--
-- starter_step_done (0282's, only the Global step changed): any Global
-- you're in counts, including one Hound joined you to, as long as you
-- haven't left it. New accounts already on the path get it ticked (and
-- its Bones) the next time Today opens.
--
-- Run this once, after 0284, in the SQL Editor.

-- Whether a step is done (since the path started, for its window).
create or replace function public.starter_step_done(p_user uuid, p_step text, p_since timestamptz)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select case p_step
    when 'goal' then
      exists (select 1 from public.activity_events e where e.user_id = p_user and e.kind = 'goal_day' and e.created_at >= p_since)
      or exists (
        select 1 from public.daily_step_totals d
        where d.user_id = p_user and d.day >= (p_since - interval '1 day')::date
          and d.steps >= coalesce((select min(g.target) from public.goals g where g.user_id = p_user and g.metric = 'steps' and g.period = 'day'), 10000))
    when 'fast' then
      exists (select 1 from public.fasts f where f.user_id = p_user)
    when 'move' then
      exists (select 1 from public.workout_history w where w.user_id = p_user and w.occurred_at >= p_since - interval '1 day')
    -- 0285: any Global you're in, including one Hound joined you to on
    -- the first open (Leave takes you out of it, and then it doesn't).
    when 'global' then
      exists (
        select 1 from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id
        where cp.user_id = p_user and c.is_global)
    else false
  end;
$$;
revoke execute on function public.starter_step_done(uuid, text, timestamptz) from public, anon, authenticated;

-- To undo: starter_step_done as in 0282.
