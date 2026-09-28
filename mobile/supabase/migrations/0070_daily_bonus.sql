-- Hound: a daily open bonus with a login streak — a small Bones reward
-- for opening the app once per local calendar day, bigger every 7th
-- consecutive day. Claimed by the client itself (HomeScreen, on open /
-- focus / resume) through claim_daily_bonus below; the server decides
-- whether today's claim is new, how long the streak is, and how much it
-- pays, so the client can only ever ask, never award itself.
--
-- The day boundary is the caller's own local date (passed in), not UTC
-- — "once a day" should roll over at the user's midnight, not at 5pm
-- Pacific. It's bounded to within one day of the server's UTC date
-- (every real timezone's local date is), and must be strictly after the
-- last claimed date, so a spoofed device clock can at most pull one
-- claim a single day early, once — never stack claims.
--
-- Recorded in activity_events (kind 'daily_bonus', null challenge_id)
-- like every other Bones award, so the ledger stays complete. Credits
-- bones_balance only — deliberately NOT bones_earned_total
-- (0066_bones_earned_total.sql): that counter gates challenge unlocks on
-- Bones earned through actually playing, and a login bonus alone would
-- otherwise unlock them for someone who never finishes a challenge.
--
-- Reward schedule must match src/bones/dailyBonus.ts's
-- dailyBonusForStreak by hand (same "two copies, kept in sync" shape
-- catalog.ts/cosmetic_items already use).
--
-- Run this once, after 0001-0069, in the SQL Editor.

alter table public.profiles
  add column daily_bonus_last_claimed_on date,
  add column daily_bonus_streak int not null default 0;

create or replace function public.claim_daily_bonus(p_local_date date)
returns table (awarded boolean, bones_awarded int, streak int)
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  last_on date;
  cur_streak int;
  new_streak int;
  reward int;
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;

  -- `for update` serializes two concurrent claims (a double-fired focus
  -- + resume) so both can't read the same last_on and double-award.
  select daily_bonus_last_claimed_on, daily_bonus_streak
    into last_on, cur_streak
    from public.profiles where id = caller
    for update;
  if not found then
    raise exception 'No profile for this account.';
  end if;

  if last_on is not null and p_local_date <= last_on then
    return query select false, 0, cur_streak;
    return;
  end if;

  new_streak := case when last_on = p_local_date - 1 then cur_streak + 1 else 1 end;
  reward := case when new_streak % 7 = 0 then 25 else 5 end;

  update public.profiles
    set daily_bonus_last_claimed_on = p_local_date,
        daily_bonus_streak = new_streak,
        bones_balance = bones_balance + reward
    where id = caller;

  insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
    values (caller, 'daily_bonus', 0, 0, reward);

  return query select true, reward, new_streak;
end;
$$;

revoke execute on function public.claim_daily_bonus(date) from public, anon;
grant execute on function public.claim_daily_bonus(date) to authenticated;
