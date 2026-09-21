-- Fixes a real bug in both rank functions from 0027_daily_step_totals.sql:
-- `count(*) over ()` was written in the outer SELECT, but SQL applies
-- `where user_id = auth.uid()` before evaluating that SELECT's window
-- functions — so it was counting the 1 row left after filtering down to
-- the caller, not everyone ranked that day/week (e.g. "#2 of 1"). Fixed
-- by computing total_users as a window function inside the same
-- subquery as rank(), before the outer filter narrows it to one row.

create or replace function public.my_daily_step_rank()
returns table (rank bigint, total_users bigint)
language sql
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
    where day = (now() at time zone 'utc')::date
  ) ranked
  where user_id = auth.uid();
$$;

create or replace function public.my_weekly_step_rank()
returns table (rank bigint, total_users bigint)
language sql
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
      where day > (now() at time zone 'utc')::date - interval '7 days'
        and day <= (now() at time zone 'utc')::date
      group by user_id
    ) totals
  ) ranked
  where user_id = auth.uid();
$$;
