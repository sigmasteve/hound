-- Hound: challenge settlement back on, for challenges ending from now on,
-- and the cron history prune job recorded in the repo. From Roshan's
-- database capacity report (16 Nov 2026).
--
-- Settlement. 0095 scheduled hound-settle-due-challenges (hourly, minute 7)
-- but production has no such job: the repo schedules 27 jobs and
-- production had the other 26. Without it a challenge settles only when
-- someone opens it, or when it's the one shown at the top of their Today, so 24
-- finished challenges (the oldest from 18 Sep) were never paid.
--
-- Turning the job back on as it was would pay every unsettled challenge
-- from the last 30 days within the hour. That backlog waits for Steve's
-- approval (Roshan's approval path: list it read-only, back up, settle one
-- to three, check, then the rest). So:
--   settle_config.since      the moment this migration runs; the job
--                            settles only challenges that end after it
--   settle_due_challenges()  redefined from 0095: ends_at after both
--                            settle_config.since and now() - 30 days
-- The backlog is untouched: settle it one by one with
-- select public.settle_challenge_score('<challenge id>'), or, once Steve
-- approves all of it, update public.settle_config set since = '<date>' where id.
-- Opening a finished challenge in the app still settles it, as before.
--
-- Cron history. Roshan scheduled prune-cron-history on production on 16 Nov
-- (job 27; Steve approved it): every day at 20:15 UTC (01:45 IST) it
-- deletes cron.job_run_details rows older than 30 days, so the log stops
-- growing (about 478 runs a day). Recorded here so staging and the repo
-- match. cron.schedule with the same name replaces the job, so running
-- this on production changes nothing there.
--
-- Run this once, after 0001-0212, in the SQL Editor.

create table if not exists public.settle_config (
  id boolean primary key default true check (id),
  since timestamptz not null default now()
);
alter table public.settle_config enable row level security;
revoke all on public.settle_config from public, anon, authenticated;
insert into public.settle_config (id, since) values (true, now()) on conflict (id) do nothing;

create or replace function public.settle_due_challenges()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
  since timestamptz := coalesce((select s.since from public.settle_config s where s.id), now());
begin
  for r in
    select id from public.challenges
    where score_settled_at is null
      and ends_at <= now()
      and ends_at > greatest(now() - interval '30 days', since)
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

-- Minute 7 of every hour, UTC (as 0095).
select cron.schedule('hound-settle-due-challenges', '7 * * * *', $$ select public.settle_due_challenges(); $$);

-- 20:15 UTC = 01:45 IST, as on production.
select cron.schedule('prune-cron-history', '15 20 * * *', $$ delete from cron.job_run_details where end_time < now() - interval '30 days' $$);

-- Undo, if needed:
--   select cron.unschedule('hound-settle-due-challenges');
--   select cron.unschedule('prune-cron-history');
