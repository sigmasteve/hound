-- Hound: a daily open bonus with a login streak — a small Bones reward
-- for opening the app once per local calendar day, bigger every 7th
-- consecutive day. Claimed by the client itself (HomeScreen, on open /
-- focus / resume) through claim_daily_bonus below; the server decides
-- whether today's claim is new, how long the streak is, and how much it
-- pays, so the client can only ever ask, never award itself.
--
-- Both amounts live in daily_bonus_config (one shared row, admin-only
-- write — same shape as app_banner, 0050_app_banner.sql) so they can be
-- tuned from the Admin screen without a code change. Seeded at 1 Bone a
-- day and 25 on every 7th consecutive day. The client never hardcodes
-- either: claim_daily_bonus returns tomorrow's amount and the weekly
-- amount alongside today's award, for the popup and tomorrow's reminder.
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
-- Run this once, after 0001-0069, in the SQL Editor.

alter table public.profiles
  add column daily_bonus_last_claimed_on date,
  add column daily_bonus_streak int not null default 0;

create table public.daily_bonus_config (
  id boolean primary key default true,
  constraint daily_bonus_config_singleton check (id),
  daily_bones int not null default 1 check (daily_bones > 0),
  weekly_bones int not null default 25 check (weekly_bones > 0),
  updated_at timestamptz not null default now()
);

insert into public.daily_bonus_config (id) values (true);

alter table public.daily_bonus_config enable row level security;

create policy "Anyone signed in can read the daily bonus config"
  on public.daily_bonus_config for select
  to authenticated
  using (true);

create policy "Only admins can update the daily bonus config"
  on public.daily_bonus_config for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

create or replace function public.claim_daily_bonus(p_local_date date)
returns table (awarded boolean, bones_awarded int, streak int, next_bones int, weekly_bones int)
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  last_on date;
  cur_streak int;
  new_streak int;
  daily_amt int;
  weekly_amt int;
  reward int;
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;

  -- Falls back to the seeded defaults if the config row is ever missing,
  -- rather than failing every claim.
  select c.daily_bones, c.weekly_bones into daily_amt, weekly_amt
    from public.daily_bonus_config c where c.id;
  daily_amt := coalesce(daily_amt, 1);
  weekly_amt := coalesce(weekly_amt, 25);

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
    return query select false, 0, cur_streak,
      case when (cur_streak + 1) % 7 = 0 then weekly_amt else daily_amt end, weekly_amt;
    return;
  end if;

  new_streak := case when last_on = p_local_date - 1 then cur_streak + 1 else 1 end;
  reward := case when new_streak % 7 = 0 then weekly_amt else daily_amt end;

  update public.profiles
    set daily_bonus_last_claimed_on = p_local_date,
        daily_bonus_streak = new_streak,
        bones_balance = bones_balance + reward
    where id = caller;

  insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
    values (caller, 'daily_bonus', 0, 0, reward);

  return query select true, reward, new_streak,
    case when (new_streak + 1) % 7 = 0 then weekly_amt else daily_amt end, weekly_amt;
end;
$$;

revoke execute on function public.claim_daily_bonus(date) from public, anon;
grant execute on function public.claim_daily_bonus(date) to authenticated;
