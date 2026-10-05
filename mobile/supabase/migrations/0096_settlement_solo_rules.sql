-- 0096: follow-up to 0095, from Steve's review.
--
--   1. Personal challenges still pay when played alone. 75 Day and Bingo
--      pay for your own effort, not for beating anyone, so the two-player
--      rule no longer applies to them. Step Race, Daily Streak and Distance
--      keep it: a solo Step Race against bots used to pay first place.
--   2. A Chase (hunt), Tag or Tic Tac Go with fewer than two real players is
--      now closed with no payout once the 24-hour grace has passed, so the
--      hourly job stops retrying it for 30 days.
--
-- Nothing else changes: the caller check, the 24-hour grace and the hourly
-- job are as in 0095. Bots are in challenge_bots, not challenge_participants,
-- so the count is real people who joined.
--
-- Run once, after 0095. Undo: run 0095's version of settle_challenge_score
-- again (it is in migrations/0095_settlement_rules.sql).

create or replace function public.settle_challenge_score(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  grace constant interval := interval '24 hours';
  min_players constant int := 2;
  players int;
  caller uuid := auth.uid();
  personal boolean;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.score_settled_at is not null then
    return;
  end if;

  -- A signed-in caller must be in the challenge. The scheduled job runs as
  -- the database and has no signed-in user.
  if caller is not null and not exists (
    select 1 from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id and cp.user_id = caller
  ) then
    return;
  end if;

  select count(*) into players
  from public.challenge_participants cp
  where cp.challenge_id = p_challenge_id;

  -- Played for your own effort, so one player is enough.
  personal := c.kind::text in ('seventyfive', 'bingo');

  -- Game-event kinds can end before ends_at; the core decides if they have.
  if c.kind::text in ('hunt', 'tag', 'tictacgo') then
    if players >= min_players then
      perform public.settle_challenge_score_core(p_challenge_id);
    elsif now() >= c.ends_at + grace then
      -- Never had an opponent: close it without paying anyone.
      update public.challenges set score_settled_at = now() where id = p_challenge_id;
    end if;
    return;
  end if;

  -- Time-based kinds wait for the grace period.
  if now() < c.ends_at + grace then
    return;
  end if;

  if players < min_players and not personal then
    -- Nobody to compete against: close it without paying anyone.
    update public.challenges set score_settled_at = now() where id = p_challenge_id;
    return;
  end if;

  perform public.settle_challenge_score_core(p_challenge_id);
end;
$$;

revoke execute on function public.settle_challenge_score(uuid) from public, anon;
grant execute on function public.settle_challenge_score(uuid) to authenticated;
