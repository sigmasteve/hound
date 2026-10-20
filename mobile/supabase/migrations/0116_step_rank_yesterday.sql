-- Hound: today's step rank next to yesterday's, for the Step rank tile on
-- Today ("#12 of 340 on Hound today · ▲ 5 from yesterday").
--
-- Same ranking as my_daily_step_rank (0027, fixed in 0028): everyone's
-- daily_step_totals for a UTC day, most steps first, ties sharing a rank.
-- This adds the caller's rank and headcount for the day before, or null
-- when they have no total for it. Like the other rank functions it only
-- ever returns the caller's own ranks and the headcounts, never anyone
-- else's steps or name.
--
-- Read-only. The app falls back to today's rank alone until this has run.
-- Run this once, after 0001-0115, in the SQL Editor.

create or replace function public.my_daily_step_rank_change()
returns table (rank bigint, total_users bigint, yesterday_rank bigint, yesterday_total_users bigint)
language sql
stable
security definer
set search_path = public
as $$
  with today as (
    select user_id, rank() over (order by steps desc) as rank, count(*) over () as total_users
    from public.daily_step_totals
    where day = (now() at time zone 'utc')::date
  ),
  yesterday as (
    select user_id, rank() over (order by steps desc) as rank, count(*) over () as total_users
    from public.daily_step_totals
    where day = (now() at time zone 'utc')::date - 1
  )
  select t.rank, t.total_users, y.rank, y.total_users
  from today t
  left join yesterday y on y.user_id = t.user_id
  where t.user_id = auth.uid();
$$;

revoke execute on function public.my_daily_step_rank_change() from public, anon;
grant execute on function public.my_daily_step_rank_change() to authenticated;

-- Undo, if needed:
--   drop function public.my_daily_step_rank_change();
