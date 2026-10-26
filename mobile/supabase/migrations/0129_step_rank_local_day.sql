-- Hound: the Step rank counts each person's own day.
--
-- daily_step_totals (0027) was keyed by the UTC date on both the write
-- (recordDailyStepTotal) and the read (the rank functions). For anyone
-- in the US the "day" turned over at 7 or 8pm local: evening steps went
-- to tomorrow's row, and the next morning's small count overwrote the
-- evening's big one. From here the app writes under the phone's own
-- calendar day, as progress_snapshots and the challenges' start_day
-- already do, and asks for its rank on that day. Everyone is compared
-- on their own "today", which is what a daily rank means to the person
-- reading it.
--
-- The three rank functions take the phone's date (p_day); an older app
-- that passes nothing, or a date more than a day from the server's, gets
-- the UTC date as before. Rows written before this stay as they are;
-- the day after the update, every row is a local day.
--
-- Run this once, after 0128, in the SQL Editor.
--
-- Undo, if needed: re-run my_daily_step_rank and my_weekly_step_rank
-- from 0028 and my_daily_step_rank_change from 0116 (dropping these
-- first).

drop function if exists public.my_daily_step_rank();
drop function if exists public.my_weekly_step_rank();
drop function if exists public.my_daily_step_rank_change();

-- The day to rank on: the phone's, within a day of the server's.
create or replace function public.step_rank_day(p_day date)
returns date
language sql
stable
as $$
  select case
    when p_day is not null and abs(p_day - (now() at time zone 'utc')::date) <= 1 then p_day
    else (now() at time zone 'utc')::date
  end;
$$;

revoke execute on function public.step_rank_day(date) from public, anon, authenticated;

create or replace function public.my_daily_step_rank(p_day date default null)
returns table (rank bigint, total_users bigint)
language sql
stable
security definer
set search_path = public
as $$
  select rank, total_users
  from (
    select
      user_id,
      rank() over (order by steps desc) as rank,
      count(*) over () as total_users
    from public.daily_step_totals
    where day = public.step_rank_day(p_day)
  ) ranked
  where user_id = auth.uid();
$$;

revoke execute on function public.my_daily_step_rank(date) from public, anon;
grant execute on function public.my_daily_step_rank(date) to authenticated;

-- The seven days ending on the phone's day.
create or replace function public.my_weekly_step_rank(p_day date default null)
returns table (rank bigint, total_users bigint)
language sql
stable
security definer
set search_path = public
as $$
  select rank, total_users
  from (
    select
      user_id,
      rank() over (order by weekly_steps desc) as rank,
      count(*) over () as total_users
    from (
      select user_id, sum(steps) as weekly_steps
      from public.daily_step_totals
      where day > public.step_rank_day(p_day) - 7
        and day <= public.step_rank_day(p_day)
      group by user_id
    ) totals
  ) ranked
  where user_id = auth.uid();
$$;

revoke execute on function public.my_weekly_step_rank(date) from public, anon;
grant execute on function public.my_weekly_step_rank(date) to authenticated;

create or replace function public.my_daily_step_rank_change(p_day date default null)
returns table (rank bigint, total_users bigint, yesterday_rank bigint, yesterday_total_users bigint)
language sql
stable
security definer
set search_path = public
as $$
  with today as (
    select user_id, rank() over (order by steps desc) as rank, count(*) over () as total_users
    from public.daily_step_totals
    where day = public.step_rank_day(p_day)
  ),
  yesterday as (
    select user_id, rank() over (order by steps desc) as rank, count(*) over () as total_users
    from public.daily_step_totals
    where day = public.step_rank_day(p_day) - 1
  )
  select t.rank, t.total_users, y.rank, y.total_users
  from today t
  left join yesterday y on y.user_id = t.user_id
  where t.user_id = auth.uid();
$$;

revoke execute on function public.my_daily_step_rank_change(date) from public, anon;
grant execute on function public.my_daily_step_rank_change(date) to authenticated;
