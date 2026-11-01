-- Hound: Hound'opoly rolls twice a day. Once a day made for a slow game.
--
-- Each day now has two turns: a midday roll on the steps synced so far
-- that day, and an overnight roll on the rest of the day's steps (the
-- day's total less what the midday roll already counted). The dice
-- tiers are halved for a turn (1,000 / 3,000 / 6,000 by default), so a
-- whole day's steps still earn the same dice in total, just in two
-- goes. The midday roll happens at midday_hour_utc (18:00, early
-- afternoon in the US); the overnight one at roll_hour_utc (11:00) the
-- next day, as before. Both by cron, or when a player opens the game.
--
--   houndopoly_turns   one row per player, day and slot: the steps the
--                      turn counted and the dice and roll it got
--   houndopoly_days    now one row per day and slot
--   houndopoly_events  gain a slot, so the feed can show "this
--                      afternoon" apart from "last night"
--
-- A day whose overnight roll already happened before this change (the
-- old once-a-day rule) is left alone: no midday roll is added after the
-- fact.
--
-- Run this once, after 0136, in the SQL Editor.

alter table public.houndopoly_settings add column if not exists midday_hour_utc integer not null default 18 check (midday_hour_utc between 0 and 23);

alter table public.houndopoly_days add column if not exists slot text not null default 'night' check (slot in ('noon', 'night'));
alter table public.houndopoly_days drop constraint if exists houndopoly_days_pkey;
alter table public.houndopoly_days add primary key (challenge_id, day, slot);

alter table public.houndopoly_events add column if not exists slot text not null default 'night' check (slot in ('noon', 'night'));

create table if not exists public.houndopoly_turns (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  slot text not null check (slot in ('noon', 'night')),
  steps integer not null,
  dice integer not null,
  roll integer not null,
  rolled_at timestamptz not null default now(),
  primary key (challenge_id, user_id, day, slot)
);
alter table public.houndopoly_turns enable row level security;
create policy "Participants can view houndopoly turns"
  on public.houndopoly_turns for select to authenticated
  using (public.is_challenge_participant(challenge_id, auth.uid())
    or exists (select 1 from public.challenges c where c.id = challenge_id and (c.created_by = auth.uid() or c.is_global)));
revoke all on public.houndopoly_turns from anon;
revoke insert, update, delete on public.houndopoly_turns from authenticated;

-- Dice for a turn's steps: the day's tiers, shared across the day's turns.
create or replace function public.houndopoly_dice(p_steps integer, s public.houndopoly_settings, p_turns integer default 2)
returns integer
language sql
immutable
as $$
  select case
    when p_steps * p_turns < s.dog_house_steps then 0
    when p_steps * p_turns < s.two_dice_steps then 1
    when p_steps * p_turns < s.three_dice_steps then 2
    else 3
  end;
$$;

revoke execute on function public.houndopoly_dice(integer, public.houndopoly_settings, integer) from public, anon, authenticated;
drop function if exists public.houndopoly_dice(integer, public.houndopoly_settings);

-- 0136's log, stamping the slot the current roll set (houndopoly.slot);
-- a decision made by hand during the day lands in the 'noon' slot of
-- today if the midday roll hasn't happened, else 'night'.
create or replace function public.houndopoly_log(
  p_challenge_id uuid, p_day date, p_user uuid, p_kind text,
  p_idx integer default null, p_amount integer default null, p_other uuid default null, p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.houndopoly_events (challenge_id, day, seq, user_id, kind, idx, amount, other_user_id, detail, slot)
  values (
    p_challenge_id, p_day,
    coalesce((select max(seq) from public.houndopoly_events e where e.challenge_id = p_challenge_id and e.day = p_day), 0) + 1,
    p_user, p_kind, p_idx, p_amount, p_other, p_detail,
    coalesce(nullif(current_setting('houndopoly.slot', true), ''), 'night')
  );
end;
$$;

-- Rolls one turn for one game. The midday turn counts the steps synced
-- so far that day; the overnight turn counts the day's total less that.
create or replace function public.houndopoly_roll_day(p_challenge_id uuid, p_day date, p_slot text default 'night')
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  s public.houndopoly_settings;
  pl record;
  total integer;
  counted integer;
  steps integer;
  dice integer;
  roll integer;
  i integer;
begin
  select * into s from public.houndopoly_settings;
  insert into public.houndopoly_days (challenge_id, day, slot) values (p_challenge_id, p_day, p_slot);
  perform set_config('houndopoly.slot', p_slot, true);

  for pl in
    select * from public.houndopoly_players hp
    where hp.challenge_id = p_challenge_id and hp.joined_day < p_day
    order by hp.user_id
  loop
    if pl.pending_idx is not null then
      perform public.houndopoly_log(p_challenge_id, p_day, pl.user_id, 'passed', pl.pending_idx);
      update public.houndopoly_players set pending_idx = null, updated_at = now()
        where challenge_id = p_challenge_id and user_id = pl.user_id;
    end if;
    total := coalesce((select t.steps from public.daily_step_totals t where t.user_id = pl.user_id and t.day = p_day), 0);
    counted := coalesce((select t.steps from public.houndopoly_turns t
      where t.challenge_id = p_challenge_id and t.user_id = pl.user_id and t.day = p_day and t.slot = 'noon'), 0);
    steps := case when p_slot = 'noon' then total else greatest(0, total - counted) end;
    dice := public.houndopoly_dice(steps, s, 2);
    roll := 0;
    for i in 1..dice loop
      roll := roll + 1 + floor(random() * 6)::int;
    end loop;
    insert into public.houndopoly_turns (challenge_id, user_id, day, slot, steps, dice, roll)
    values (p_challenge_id, pl.user_id, p_day, p_slot, steps, dice, roll);
    if dice = 0 then
      perform public.houndopoly_log(p_challenge_id, p_day, pl.user_id, 'stayed_in', pl.position, null, null, jsonb_build_object('steps', steps, 'slot', p_slot));
      continue;
    end if;
    perform public.houndopoly_land(p_challenge_id, p_day, pl.user_id, roll, null, jsonb_build_object('steps', steps, 'dice', dice, 'slot', p_slot));
  end loop;
end;
$$;

revoke execute on function public.houndopoly_roll_day(uuid, date, text) from public, anon, authenticated;
drop function if exists public.houndopoly_roll_day(uuid, date);

-- Rolls every turn that's due and not yet rolled, oldest first: a day's
-- midday turn once midday_hour_utc has passed on that day, its
-- overnight turn once roll_hour_utc has passed the next day.
create or replace function public.houndopoly_advance(p_challenge_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
  s public.houndopoly_settings;
  caller uuid := auth.uid();
  d date;
  first_day date;
  last_day date;
  n integer := 0;
  now_utc timestamp := now() at time zone 'utc';
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.kind <> 'houndopoly' then
    return 0;
  end if;
  if caller is not null and not public.is_challenge_participant(p_challenge_id, caller) and c.created_by <> caller then
    raise exception 'Only players can do that.';
  end if;
  select * into s from public.houndopoly_settings;
  first_day := public.houndopoly_first_day(c);
  last_day := first_day + c.duration_days - 1;
  for d in
    select g::date from generate_series(first_day::timestamp, least(last_day, now_utc::date)::timestamp, interval '1 day') g order by g
  loop
    -- Midday, unless the day already rolled overnight under the old rule.
    if now_utc >= d::timestamp + make_interval(hours => s.midday_hour_utc)
       and not exists (select 1 from public.houndopoly_days hd where hd.challenge_id = p_challenge_id and hd.day = d) then
      perform public.houndopoly_roll_day(p_challenge_id, d, 'noon');
      n := n + 1;
    end if;
    if now_utc >= (d + 1)::timestamp + make_interval(hours => s.roll_hour_utc)
       and not exists (select 1 from public.houndopoly_days hd where hd.challenge_id = p_challenge_id and hd.day = d and hd.slot = 'night') then
      perform public.houndopoly_roll_day(p_challenge_id, d, 'night');
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- 0136's decide, stamping the slot a daytime decision belongs to.
create or replace function public.houndopoly_decide(p_challenge_id uuid, p_buy boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  pl public.houndopoly_players;
  sq public.houndopoly_squares;
  today date := (now() at time zone 'utc')::date;
begin
  select * into pl from public.houndopoly_players where challenge_id = p_challenge_id and user_id = auth.uid() for update;
  if not found or pl.pending_idx is null then
    raise exception 'Nothing is waiting for you to decide.';
  end if;
  select * into sq from public.houndopoly_squares where idx = pl.pending_idx;
  perform set_config('houndopoly.slot',
    case when exists (select 1 from public.houndopoly_days hd where hd.challenge_id = p_challenge_id and hd.day = today and hd.slot = 'noon') then 'night' else 'noon' end,
    true);
  if p_buy then
    if pl.bankrupt then
      raise exception 'You''re bankrupt; you can''t buy.';
    end if;
    if exists (select 1 from public.houndopoly_deeds d where d.challenge_id = p_challenge_id and d.idx = sq.idx) then
      raise exception 'Someone got there first.';
    end if;
    if pl.cash < sq.price then
      raise exception 'Not enough cash: % costs % and you have %.', sq.name, sq.price, pl.cash;
    end if;
    insert into public.houndopoly_deeds (challenge_id, idx, owner_id, bought_on) values (p_challenge_id, sq.idx, auth.uid(), today);
    update public.houndopoly_players set cash = cash - sq.price, pending_idx = null, updated_at = now()
      where challenge_id = p_challenge_id and user_id = auth.uid();
    perform public.houndopoly_log(p_challenge_id, today, auth.uid(), 'bought', sq.idx, sq.price);
  else
    update public.houndopoly_players set pending_idx = null, updated_at = now()
      where challenge_id = p_challenge_id and user_id = auth.uid();
    perform public.houndopoly_log(p_challenge_id, today, auth.uid(), 'passed', sq.idx);
  end if;
end;
$$;

-- The midday run, alongside 0136's overnight one.
select cron.schedule('hound-houndopoly-midday', '15 18 * * *', $$ select public.houndopoly_advance_all(); $$);

-- Undo, if needed: unschedule hound-houndopoly-midday, drop
-- houndopoly_turns, drop the slot columns, and run 0136's dice, log,
-- roll_day, advance and decide again.
