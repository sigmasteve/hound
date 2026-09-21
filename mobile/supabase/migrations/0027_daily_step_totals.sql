-- Global (not challenge-scoped) daily step totals — one row per user per
-- UTC calendar day. Steps only ever reached the server before this as a
-- side effect of challenge participation (progress_snapshots), so there
-- was nothing to rank someone against on a day they're not in an active
-- challenge. The write path (recordDailyStepTotal in
-- src/leaderboard/supabaseStepsRank.ts) upserts the same
-- HealthSnapshot.stepsToday every other screen already shows, on every
-- Home screen load.
--
-- UTC, not each user's own local day (progress_snapshots' own
-- convention, see recordProgress's comment there) — a leaderboard that
-- compares everyone needs one shared "today" boundary, and UTC is the
-- simplest one to reason about consistently across timezones. It's a
-- deliberate approximation: your own "today" total can straddle two
-- UTC-keyed rows near your local midnight. Good enough for a rank, not
-- meant to be exact per-timezone accounting.
create table public.daily_step_totals (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  steps integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.daily_step_totals enable row level security;

-- Nobody, including another signed-in user, can select a stranger's row
-- directly — the two rank functions below are the only way to learn
-- anything about anyone else's steps, and they only ever hand back the
-- caller's own rank plus a headcount, never another user's row.
create policy "Users can view their own daily step totals"
  on public.daily_step_totals for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can record their own daily step totals"
  on public.daily_step_totals for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their own daily step totals"
  on public.daily_step_totals for update
  to authenticated
  using (user_id = auth.uid());

-- Security-definer escape hatch, same shape admin_user_overview
-- (0023_admin_user_directory.sql) and add_friend_by_code
-- (0019_friend_codes.sql) already use: the client never selects another
-- user's daily_step_totals row, it calls a function that ranks across
-- all of them server-side and returns only the caller's own place.
--
-- The denominator is "everyone who's actually synced today" (count(*)
-- over the ranked set), not every registered account — an inner join
-- against profiles for "everyone" would make a rank look artificially
-- good next to accounts that haven't opened the app in weeks.
create or replace function public.my_daily_step_rank()
returns table (rank bigint, total_users bigint)
language sql
security definer
set search_path = public
as $$
  select rank, count(*) over ()
  from (
    select user_id, rank() over (order by steps desc) as rank
    from public.daily_step_totals
    where day = (now() at time zone 'utc')::date
  ) ranked
  where user_id = auth.uid();
$$;

grant execute on function public.my_daily_step_rank() to authenticated;

-- Same shape, summed over the trailing 7 UTC days (today inclusive).
-- Naturally thin right after this ships — someone with only a couple of
-- days of history is still ranked fairly among everyone else who's just
-- as new, and it fills in on its own as daily_step_totals accumulates.
create or replace function public.my_weekly_step_rank()
returns table (rank bigint, total_users bigint)
language sql
security definer
set search_path = public
as $$
  select rank, count(*) over ()
  from (
    select user_id, rank() over (order by weekly_steps desc) as rank
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

grant execute on function public.my_weekly_step_rank() to authenticated;
