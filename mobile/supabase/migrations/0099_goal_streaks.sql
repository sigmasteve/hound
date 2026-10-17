-- Hound: goal streaks and Bones for hitting your goals.
--
--   A goal day   every daily goal done on one local calendar day. Pays
--                day_bones, or streak_bones on every 7th goal day in a
--                row. Days in a row make the streak on Today's goals card;
--                a day without one starts it over.
--   A goal week  every weekly goal done in one Monday-to-Sunday week.
--                Pays week_bones, once a week.
--
-- The phone works out progress from its own health data (the server
-- never sees it, same as challenges) and claims through
-- claim_goal_day / claim_goal_week. The server decides whether the claim
-- is new, how long the streak is and what it pays, so the phone can ask
-- but never award itself. Same shape as the daily bonus
-- (0070_daily_bonus.sql):
--
--   - The day is the caller's local date, bounded to within one day of
--     the server's UTC date, and must be after the last claimed day, so a
--     wrong clock can't stack claims.
--   - Recorded in activity_events (kinds 'goal_day' and 'goal_week'), and
--     credits bones_balance only, not bones_earned_total (that one gates
--     challenge unlocks on Bones earned in challenges).
--   - The amounts live in goal_reward_config (one row, admins can change
--     it from Admin), seeded at 5 a day, 25 on every 7th day and 15 a
--     week.
--
-- goal_streaks has no write policies at all: only the claim functions
-- change it. my_goal_streak() is what Today reads.
--
-- Also adds two numbers to Admin → Goals (admin_goals_overview, 0098):
-- how many people have a streak going, and how many goal days were paid
-- in the last 7 days.
--
-- Run this once, after 0001-0098, in the SQL Editor.

create table public.goal_streaks (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  streak integer not null default 0,
  best_streak integer not null default 0,
  last_hit_on date,
  -- The Monday of the last week paid for.
  last_week_on date,
  updated_at timestamptz not null default now()
);

alter table public.goal_streaks enable row level security;

create policy "Owners can view their goal streak"
  on public.goal_streaks for select to authenticated
  using (user_id = auth.uid());

revoke all on public.goal_streaks from anon;
revoke insert, update, delete on public.goal_streaks from authenticated;

create table public.goal_reward_config (
  id boolean primary key default true,
  constraint goal_reward_config_singleton check (id),
  day_bones integer not null default 5 check (day_bones > 0),
  streak_bones integer not null default 25 check (streak_bones > 0),
  week_bones integer not null default 15 check (week_bones > 0),
  updated_at timestamptz not null default now()
);

insert into public.goal_reward_config (id) values (true);

alter table public.goal_reward_config enable row level security;

create policy "Anyone signed in can read the goal rewards"
  on public.goal_reward_config for select to authenticated
  using (true);

create policy "Only admins can change the goal rewards"
  on public.goal_reward_config for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

revoke all on public.goal_reward_config from anon;

-- What the next goal day pays, for a streak that's currently `streak`.
create or replace function public.goal_day_reward(streak integer, day_amt integer, streak_amt integer)
returns integer
language sql
immutable
as $$
  select case when (streak + 1) % 7 = 0 then streak_amt else day_amt end;
$$;

-- Only the functions below use it.
revoke execute on function public.goal_day_reward(integer, integer, integer) from public, anon, authenticated;

-- Today's goal streak, for Today's goals card. `streak` already counts
-- as broken if neither today nor yesterday was a goal day.
create or replace function public.my_goal_streak(p_local_date date)
returns table (streak integer, best_streak integer, hit_today boolean, week_paid boolean, next_bones integer, week_bones integer)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  s public.goal_streaks;
  c public.goal_reward_config;
  live integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into s from public.goal_streaks g where g.user_id = auth.uid();
  select * into c from public.goal_reward_config r where r.id;
  live := case when s.last_hit_on >= p_local_date - 1 then s.streak else 0 end;
  return query select
    coalesce(live, 0),
    coalesce(s.best_streak, 0),
    coalesce(s.last_hit_on >= p_local_date, false),
    coalesce(s.last_week_on >= p_local_date - ((extract(isodow from p_local_date)::int + 6) % 7), false),
    case when s.last_hit_on >= p_local_date then 0
         else public.goal_day_reward(coalesce(live, 0), coalesce(c.day_bones, 5), coalesce(c.streak_bones, 25)) end,
    coalesce(c.week_bones, 15);
end;
$$;

revoke execute on function public.my_goal_streak(date) from public, anon;
grant execute on function public.my_goal_streak(date) to authenticated;

-- Every daily goal is done today: pay once for the day and grow the
-- streak. A repeat claim the same day pays nothing and changes nothing.
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
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  if not exists (
    select 1 from public.goals g where g.user_id = caller and g.archived_at is null and g.period = 'day'
  ) then
    raise exception 'You don''t have a daily goal.';
  end if;

  select * into c from public.goal_reward_config r where r.id;

  -- `for update` so two claims at once (Today and a background sync)
  -- can't both pay.
  insert into public.goal_streaks (user_id) values (caller) on conflict (user_id) do nothing;
  select * into s from public.goal_streaks g where g.user_id = caller for update;

  if s.last_hit_on is not null and p_local_date <= s.last_hit_on then
    return query select false, 0, s.streak, s.best_streak;
    return;
  end if;

  new_streak := case when s.last_hit_on = p_local_date - 1 then s.streak + 1 else 1 end;
  reward := public.goal_day_reward(new_streak - 1, coalesce(c.day_bones, 5), coalesce(c.streak_bones, 25));

  update public.goal_streaks g
    set streak = new_streak,
        best_streak = greatest(g.best_streak, new_streak),
        last_hit_on = p_local_date,
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

-- Every weekly goal is done this week: pay once for the week.
-- p_local_date is the caller's local date (bounded the same way); the
-- week is the Monday-to-Sunday week it falls in.
create or replace function public.claim_goal_week(p_local_date date)
returns table (awarded boolean, bones_awarded integer)
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  monday date;
  s public.goal_streaks;
  reward integer;
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  if not exists (
    select 1 from public.goals g where g.user_id = caller and g.archived_at is null and g.period = 'week'
  ) then
    raise exception 'You don''t have a weekly goal.';
  end if;

  monday := p_local_date - ((extract(isodow from p_local_date)::int + 6) % 7);
  select coalesce((select r.week_bones from public.goal_reward_config r where r.id), 15) into reward;

  insert into public.goal_streaks (user_id) values (caller) on conflict (user_id) do nothing;
  select * into s from public.goal_streaks g where g.user_id = caller for update;

  if s.last_week_on is not null and monday <= s.last_week_on then
    return query select false, 0;
    return;
  end if;

  update public.goal_streaks g set last_week_on = monday, updated_at = now() where g.user_id = caller;

  update public.profiles set bones_balance = bones_balance + reward where id = caller;

  insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
    values (caller, 'goal_week', 0, 0, reward);

  return query select true, reward;
end;
$$;

revoke execute on function public.claim_goal_week(date) from public, anon;
grant execute on function public.claim_goal_week(date) to authenticated;

-- Admin → Goals, as in 0098, plus:
--   streaking      of the active people, how many have a goal streak
--                  going (a goal day today or yesterday, UTC)
--   goal_days_7d   goal days paid in the last 7 days, everyone
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
    'steps_tracked', (select count(*) from steps_yesterday),
    'streaking', (
      select count(*) from public.goal_streaks s
      join active a on a.id = s.user_id
      where s.last_hit_on >= yesterday
    ),
    'goal_days_7d', (
      select count(*) from public.activity_events e
      where e.kind = 'goal_day' and e.created_at > now() - interval '7 days'
    )
  ) into result;

  return result;
end;
$$;

revoke execute on function public.admin_goals_overview() from public, anon;
grant execute on function public.admin_goals_overview() to authenticated;

-- Undo, if needed (then run 0098 again for the old Admin → Goals):
--   drop function public.claim_goal_week(date);
--   drop function public.claim_goal_day(date);
--   drop function public.my_goal_streak(date);
--   drop function public.goal_day_reward(integer, integer, integer);
--   drop table public.goal_reward_config;
--   drop table public.goal_streaks;
