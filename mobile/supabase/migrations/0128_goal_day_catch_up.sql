-- Hound: a goal day can be claimed a day late.
--
-- The phone claims a goal day when it sees every daily goal done. A day
-- finished late with Hound closed (or before a watch's steps had reached
-- the phone) was never claimed, and the streak read as broken the next
-- morning although the goals were met. The app now claims yesterday on
-- the first open of a day when the phone's own data says it was earned
-- (useGoalStreak, backgroundSync). The server already took a day up to
-- one UTC day back; this widens it to two, so a phone west of UTC can
-- still claim its yesterday in the evening (US evening is already the
-- next UTC day). Everything else in claim_goal_day is as 0101 left it.
--
-- Run this once, after 0127, in the SQL Editor.
--
-- Undo, if needed: re-run claim_goal_day from 0101.

create or replace function public.claim_goal_day(p_local_date date)
returns table (awarded boolean, bones_awarded integer, streak integer, best_streak integer)
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  s public.goal_streaks;
  c public.goal_reward_config;
  new_streak integer;
  reward integer;
  shielded boolean;
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_local_date is null or p_local_date < utc_today - 2 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  if not exists (
    select 1 from public.goals g where g.user_id = caller and g.archived_at is null and g.period = 'day'
  ) then
    raise exception 'You don''t have a daily goal.';
  end if;

  select * into c from public.goal_reward_config r where r.id;

  insert into public.goal_streaks (user_id) values (caller) on conflict (user_id) do nothing;
  select * into s from public.goal_streaks g where g.user_id = caller for update;

  if s.last_hit_on is not null and p_local_date <= s.last_hit_on then
    return query select false, 0, s.streak, s.best_streak;
    return;
  end if;

  shielded := public.goal_shield_covers(s, p_local_date);
  new_streak := case when s.last_hit_on = p_local_date - 1 or shielded then s.streak + 1 else 1 end;
  reward := public.goal_day_reward(new_streak - 1, coalesce(c.day_bones, 5), coalesce(c.streak_bones, 25));

  update public.goal_streaks g
    set streak = new_streak,
        best_streak = greatest(g.best_streak, new_streak),
        last_hit_on = p_local_date,
        shields = case when shielded then g.shields - 1 else g.shields end,
        shield_used_on = case when shielded then p_local_date - 1 else g.shield_used_on end,
        updated_at = now()
    where g.user_id = caller;

  update public.profiles set bones_balance = bones_balance + reward where id = caller;

  insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
    values (caller, 'goal_day', 0, 0, reward);

  return query select true, reward, new_streak, greatest(s.best_streak, new_streak);
end;
$$;

revoke execute on function public.claim_goal_day(date) from public, anon;
grant execute on function public.claim_goal_day(date) to authenticated;
