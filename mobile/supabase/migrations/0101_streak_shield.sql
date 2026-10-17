-- Hound: Streak Shields. Spend Bones on a shield that saves your goal
-- streak (0099) when you miss a single day.
--
--   - Bought with Bones, 50 by default (goal_reward_config.shield_bones,
--     admin-tunable). You can hold up to 2.
--   - Used up automatically: when your next goal day comes after exactly
--     one missed day, a shield covers that day and the streak carries on
--     (the missed day itself doesn't count toward it). Two or more
--     missed days in a row still end the streak.
--   - At most one shield a week (one used in the last 7 days means the
--     next miss isn't covered), so a streak still means showing up.
--   - Spending comes off bones_balance only, like the Locker shop:
--     bones_earned_total (what challenge unlocks go by) is untouched.
--     Each purchase is logged in streak_shield_purchases.
--
-- claim_goal_day and my_goal_streak are redefined with the shield rule.
-- my_goal_streak also returns the shield count, the price, whether a
-- shield is keeping your streak alive today, and whether one can still
-- cover a miss this week.
--
-- Run this once, after 0001-0100, in the SQL Editor, before publishing
-- the app update that goes with it.

alter table public.goal_streaks
  add column shields integer not null default 0 check (shields between 0 and 2),
  add column shield_used_on date;

alter table public.goal_reward_config
  add column shield_bones integer not null default 50 check (shield_bones > 0);

create table public.streak_shield_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  bones integer not null,
  created_at timestamptz not null default now()
);

create index streak_shield_purchases_user on public.streak_shield_purchases (user_id);

alter table public.streak_shield_purchases enable row level security;

create policy "Owners can view their shield purchases"
  on public.streak_shield_purchases for select to authenticated
  using (user_id = auth.uid());

revoke all on public.streak_shield_purchases from anon;
revoke insert, update, delete on public.streak_shield_purchases from authenticated;

-- Whether a shield can cover the day before p_day for this streak row:
-- you have one, the last goal day was exactly two days before p_day, and
-- no shield was used in the 7 days before.
create or replace function public.goal_shield_covers(s public.goal_streaks, p_day date)
returns boolean
language sql
stable
as $$
  select coalesce(s.shields, 0) > 0
    and s.last_hit_on = p_day - 2
    and (s.shield_used_on is null or s.shield_used_on < p_day - 7);
$$;

revoke execute on function public.goal_shield_covers(public.goal_streaks, date) from public, anon, authenticated;

create or replace function public.buy_streak_shield()
returns table (shields integer, bones_balance integer)
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  price integer;
  balance integer;
  held integer;
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  select coalesce((select c.shield_bones from public.goal_reward_config c where c.id), 50) into price;

  insert into public.goal_streaks (user_id) values (caller) on conflict (user_id) do nothing;
  select g.shields into held from public.goal_streaks g where g.user_id = caller for update;
  if held >= 2 then
    raise exception 'You already have 2 shields, the most you can hold.';
  end if;

  select p.bones_balance into balance from public.profiles p where p.id = caller for update;
  if coalesce(balance, 0) < price then
    raise exception 'Not enough Bones: a shield costs %.', price;
  end if;

  update public.profiles p set bones_balance = p.bones_balance - price where p.id = caller;
  update public.goal_streaks g set shields = g.shields + 1, updated_at = now() where g.user_id = caller;
  insert into public.streak_shield_purchases (user_id, bones) values (caller, price);

  return query select held + 1, balance - price;
end;
$$;

revoke execute on function public.buy_streak_shield() from public, anon;
grant execute on function public.buy_streak_shield() to authenticated;

-- 0099's claim_goal_day, plus: a goal day after exactly one missed day
-- uses up a shield (when one can cover it) and continues the streak.
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
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
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

-- Its columns change, so it's dropped and made again.
drop function public.my_goal_streak(date);

create function public.my_goal_streak(p_local_date date)
returns table (
  streak integer,
  best_streak integer,
  hit_today boolean,
  week_paid boolean,
  next_bones integer,
  week_bones integer,
  shields integer,
  shield_bones integer,
  -- Yesterday was missed and a shield will cover it: the streak is alive
  -- only thanks to the shield, until today's goals are done.
  shield_covering boolean,
  -- A shield used in the last 7 days: the next miss isn't covered.
  shield_cooldown boolean
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  s public.goal_streaks;
  c public.goal_reward_config;
  covering boolean;
  live integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into s from public.goal_streaks g where g.user_id = auth.uid();
  select * into c from public.goal_reward_config r where r.id;
  covering := coalesce(public.goal_shield_covers(s, p_local_date), false);
  live := case when s.last_hit_on >= p_local_date - 1 or covering then s.streak else 0 end;
  return query select
    coalesce(live, 0),
    coalesce(s.best_streak, 0),
    coalesce(s.last_hit_on >= p_local_date, false),
    coalesce(s.last_week_on >= p_local_date - ((extract(isodow from p_local_date)::int + 6) % 7), false),
    case when s.last_hit_on >= p_local_date then 0
         else public.goal_day_reward(coalesce(live, 0), coalesce(c.day_bones, 5), coalesce(c.streak_bones, 25)) end,
    coalesce(c.week_bones, 15),
    coalesce(s.shields, 0),
    coalesce(c.shield_bones, 50),
    covering,
    coalesce(s.shield_used_on >= p_local_date - 7, false);
end;
$$;

revoke execute on function public.my_goal_streak(date) from public, anon;
grant execute on function public.my_goal_streak(date) to authenticated;

-- Undo, if needed:
--   drop function public.buy_streak_shield();
--   run 0099's claim_goal_day and my_goal_streak again (drop the new
--   my_goal_streak first);
--   drop function public.goal_shield_covers(public.goal_streaks, date);
--   drop table public.streak_shield_purchases;
--   alter table public.goal_reward_config drop column shield_bones;
--   alter table public.goal_streaks drop column shields, drop column shield_used_on;
