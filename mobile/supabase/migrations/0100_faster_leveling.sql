-- Hound: faster leveling, and XP for daily habits, not only challenges.
--
-- Before this, a finished challenge was the only real source of XP
-- (about 25), and level L took 50·L² XP: Tracker (level 5) needed about
-- 50 finished challenges, Legend (level 20) about 800.
--
-- 1. A gentler curve: level L takes 10·L² + 20·L XP.
--
--      level   1     5      10      15      20
--      before  50    1,250  5,000   11,250  20,000
--      now     30    350    1,200   2,550   4,400
--
--    level_for_xp is the one place the server works levels out
--    (settlement's level-up Bones, the level achievements), and
--    src/challenges/leveling.ts mirrors it. Everyone's level goes up
--    straight away; no Bones are paid for that jump.
--
-- 2. XP for the daily habits, added to their existing activity_events
--    rows by a trigger, so the claim functions don't change:
--      daily_bonus (opening Hound)   5 XP
--      goal_day                      10 XP
--      goal_week                     25 XP
--    Crossing a level this way pays the same level-up Bones settlement
--    does (25 a level), so a level pays the same however it's reached.
--    An active player earns about 155 XP a week: Tracker in 2-3 weeks,
--    Hunter in about 2 months, Legend in about 7.
--
-- 3. Leveled Locker items keep unlocking at the same level as before, so
--    their unlock_xp moves to that level's XP on the new curve
--    (src/cosmetics/catalog.ts mirrors these).
--
-- Run this once, after 0001-0099, in the SQL Editor, before publishing
-- the app update that goes with it.

create or replace function public.level_for_xp(p_xp int)
returns int
language plpgsql
immutable
as $$
declare
  lvl bigint := 0;
begin
  while 10::bigint * (lvl + 1) * (lvl + 1) + 20::bigint * (lvl + 1) <= p_xp loop
    lvl := lvl + 1;
  end loop;
  return lvl::int;
end;
$$;

create or replace function public.activity_events_habit_xp()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  bones_per_level constant int := 25;
  amount int;
  old_xp int;
  crossed int;
begin
  if new.challenge_id is not null or new.xp_points <> 0 then
    return new;
  end if;
  amount := case new.kind
    when 'daily_bonus' then 5
    when 'goal_day' then 10
    when 'goal_week' then 25
    else 0
  end;
  if amount = 0 then
    return new;
  end if;

  new.xp_points := amount;
  select p.xp_total into old_xp from public.profiles p where p.id = new.user_id for update;
  crossed := public.level_for_xp(coalesce(old_xp, 0) + amount) - public.level_for_xp(coalesce(old_xp, 0));
  update public.profiles p
    set xp_total = p.xp_total + amount,
        bones_balance = p.bones_balance + crossed * bones_per_level,
        bones_earned_total = p.bones_earned_total + crossed * bones_per_level
    where p.id = new.user_id;
  return new;
end;
$$;

revoke execute on function public.activity_events_habit_xp() from public, anon, authenticated;

drop trigger if exists activity_events_habit_xp on public.activity_events;
create trigger activity_events_habit_xp
  before insert on public.activity_events
  for each row execute procedure public.activity_events_habit_xp();

update public.cosmetic_items set unlock_xp = case id
  when 'frame_bronze' then 150     -- level 3
  when 'frame_silver' then 630     -- level 7
  when 'frame_gold' then 1680      -- level 12
  when 'frame_glow' then 3600      -- level 18
  when 'frame_diamond' then 6750   -- level 25
  when 'bg_sunset' then 350        -- level 5
  when 'bg_ocean' then 1200        -- level 10
  when 'bg_forest' then 2550       -- level 15
  when 'bg_aurora' then 4400       -- level 20
  when 'bg_midnight' then 9600     -- level 30
  when 'icon_paw' then 240         -- level 4
  when 'icon_dog' then 990         -- level 9
  when 'icon_cat' then 2240        -- level 14
  when 'icon_rabbit' then 4400     -- level 20
  when 'icon_fire' then 7830       -- level 27
  else unlock_xp
end
where unlock_xp is not null;

-- Undo, if needed:
--   drop trigger activity_events_habit_xp on public.activity_events;
--   drop function public.activity_events_habit_xp();
--   level_for_xp back to: while 50::bigint * (lvl + 1) * (lvl + 1) <= p_xp
--   cosmetic_items.unlock_xp back to 0059/0069's values.
