-- Hound: Hound'opoly — the day a player joined, in their own day, not UTC.
--
-- A player's turns start the day after they joined (joined mid-day, so
-- that day's steps don't count twice). houndopoly_after_join (0136)
-- stamped the join day in UTC, but the game's days are the creator's own
-- calendar (start_day, 0085). A game made at 9pm Eastern is already the
-- next day in UTC, so everyone in it was stamped as joining on day 2 and
-- nobody rolled before day 3: the midday job ran, wrote the day's row,
-- and found no one to roll.
--
-- Now the join day is taken in the joiner's own time zone (profiles.
-- time_zone, 0088; the creator's own fallback otherwise), and anyone who
-- joins on or before the game's first day rolls from day 1. Running games
-- are backfilled, and their day rows that rolled nobody are cleared so
-- the missed turns roll the next time the board opens (or the next job).
--
-- Run this once, after 0143, in the SQL Editor; then open the board.

create or replace function public.houndopoly_join_day(p_challenge_id uuid, p_user_id uuid, p_joined_at timestamptz)
returns date
language plpgsql
stable
as $$
declare
  c public.challenges;
  tz text;
  local_day date;
  first_day date;
begin
  select * into c from public.challenges where id = p_challenge_id;
  tz := coalesce((select p.time_zone from public.profiles p where p.id = p_user_id), 'America/New_York');
  local_day := (p_joined_at at time zone tz)::date;
  first_day := public.houndopoly_first_day(c);
  -- In before the first day: day 1 counts. Later: from the next day.
  return case when local_day <= first_day then first_day - 1 else local_day end;
end;
$$;

revoke execute on function public.houndopoly_join_day(uuid, uuid, timestamptz) from public, anon, authenticated;

create or replace function public.houndopoly_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  k public.challenge_kind;
  s public.houndopoly_settings;
begin
  select kind into k from public.challenges where id = new.challenge_id;
  if k <> 'houndopoly' then
    return new;
  end if;
  select * into s from public.houndopoly_settings;
  insert into public.houndopoly_players (challenge_id, user_id, cash, joined_day)
  values (new.challenge_id, new.user_id, s.start_cash, public.houndopoly_join_day(new.challenge_id, new.user_id, coalesce(new.joined_at, now())))
  on conflict do nothing;
  return new;
end;
$$;

-- Running games: restamp every player's join day by the new rule.
update public.houndopoly_players hp
  set joined_day = public.houndopoly_join_day(hp.challenge_id, hp.user_id, cp.joined_at)
  from public.challenge_participants cp, public.challenges c
  where cp.challenge_id = hp.challenge_id and cp.user_id = hp.user_id
    and c.id = hp.challenge_id and c.kind = 'houndopoly' and c.ends_at > now() and c.score_settled_at is null;

-- Day rows that rolled nobody (no turns, nothing logged) in running games
-- are cleared, so houndopoly_advance rolls those turns on its next pass.
delete from public.houndopoly_days d
  using public.challenges c
  where c.id = d.challenge_id and c.kind = 'houndopoly' and c.ends_at > now() and c.score_settled_at is null
    and not exists (select 1 from public.houndopoly_turns t where t.challenge_id = d.challenge_id and t.day = d.day and t.slot = d.slot)
    and not exists (select 1 from public.houndopoly_events e where e.challenge_id = d.challenge_id and e.day = d.day and e.slot = d.slot);
