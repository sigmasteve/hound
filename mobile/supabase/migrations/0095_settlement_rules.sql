-- 0095: settle finished challenges on a schedule, and only by the rules.
--
-- Before this, nothing settled an ended challenge on its own. The first
-- person to open it in the app triggered settle_challenge_score, which had
-- no caller check, no minimum number of players and no grace period. The
-- result could lock before the leader had synced. On production the Daily
-- Streak Test ended 2 Oct 04:00 UTC and stayed unsettled for about 26 hours.
--
-- What changes:
--   1. The existing function moves, unchanged, to settle_challenge_score_core
--      and can no longer be called by app users.
--   2. settle_challenge_score keeps its name and signature (the app calls it)
--      and now checks, before calling the core:
--        a. the caller is in the challenge (or is the database itself, for
--           the scheduled job);
--      and, for time-based kinds (steps, streak, distance):
--        b. at least two players joined;
--        c. 24 hours have passed since ends_at, so late syncs count.
--      Hunt, tag and Tic Tac Go can end on a game event, so they skip the
--      grace period and the two-player rule is the only extra check.
--   3. A challenge that ended more than the grace ago with fewer than two
--      players is marked settled with no payout, so it stops being retried.
--   4. An hourly job settles everything that is due.
--
-- Decisions for Steve (change the constants below if you disagree):
--   grace 24 hours; minimum 2 players; the job only looks back 30 days, so
--   old test challenges are not paid out by surprise. Clear the test
--   challenges before launch.
--
-- Run once, after 0001-0094. Undo: see the bottom of this file.

alter function public.settle_challenge_score(uuid) rename to settle_challenge_score_core;
revoke execute on function public.settle_challenge_score_core(uuid) from public, anon, authenticated;

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

  -- Game-event kinds can end before ends_at; the core decides if they have.
  if c.kind::text in ('hunt', 'tag', 'tictacgo') then
    if players >= min_players then
      perform public.settle_challenge_score_core(p_challenge_id);
    end if;
    return;
  end if;

  -- Time-based kinds wait for the grace period.
  if now() < c.ends_at + grace then
    return;
  end if;

  if players < min_players then
    -- Nobody to compete against: close it without paying anyone.
    update public.challenges set score_settled_at = now() where id = p_challenge_id;
    return;
  end if;

  perform public.settle_challenge_score_core(p_challenge_id);
end;
$$;

revoke execute on function public.settle_challenge_score(uuid) from public, anon;
grant execute on function public.settle_challenge_score(uuid) to authenticated;

-- The hourly job. Runs as the database, so it passes the caller check.
create or replace function public.settle_due_challenges()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select id from public.challenges
    where score_settled_at is null
      and ends_at <= now()
      and ends_at > now() - interval '30 days'
    order by ends_at
    limit 200
  loop
    begin
      perform public.settle_challenge_score(r.id);
      n := n + 1;
    exception when others then
      -- One bad challenge must not block the rest.
      raise warning 'settle_due_challenges: % failed: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;

revoke execute on function public.settle_due_challenges() from public, anon, authenticated;

-- Minute 7 of every hour, UTC.
select cron.schedule('hound-settle-due-challenges', '7 * * * *', $$ select public.settle_due_challenges(); $$);

-- Undo, if needed:
--   select cron.unschedule('hound-settle-due-challenges');
--   drop function public.settle_due_challenges();
--   drop function public.settle_challenge_score(uuid);
--   alter function public.settle_challenge_score_core(uuid) rename to settle_challenge_score;
--   grant execute on function public.settle_challenge_score(uuid) to authenticated;
