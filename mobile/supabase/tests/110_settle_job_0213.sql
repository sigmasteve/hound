-- 0213: the settlement job is scheduled again, settles only challenges
-- that end after settle_config.since (the backlog waits for approval), and
-- the cron history prune job is recorded.
select plan(6);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset

select ok(exists (select 1 from cron.job where jobname = 'hound-settle-due-challenges' and schedule = '7 * * * *'),
  'hound-settle-due-challenges is scheduled hourly at minute 7');
select ok(exists (select 1 from cron.job where jobname = 'prune-cron-history' and schedule = '15 20 * * *'
                  and command ~ 'job_run_details' and command ~ '30 days'),
  'prune-cron-history deletes job logs older than 30 days, daily at 20:15 UTC');

-- The job was turned back on two days ago. Old: ended five days ago (the
-- backlog). New: ended 26 hours ago (settlement waits a day after the end).
update public.settle_config set since = now() - interval '2 days' where id;
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000013a1', 'Old race', 'steps', :'ann', 7, now() - interval '12 days', now() - interval '5 days'),
  ('00000000-0000-0000-0000-0000000013a2', 'New race', 'steps', :'ann', 7, now() - interval '8 days', now() - interval '26 hours');
insert into public.challenge_participants (challenge_id, user_id)
select c, u from unnest(array['00000000-0000-0000-0000-0000000013a1', '00000000-0000-0000-0000-0000000013a2']::uuid[]) c,
  unnest(array[:'ann', :'bob']::uuid[]) u;

select lives_ok($$select public.settle_due_challenges()$$, 'the job runs');
select ok((select score_settled_at is null from public.challenges where id = '00000000-0000-0000-0000-0000000013a1'),
  'a challenge that ended before the job came back waits for approval');
select ok((select score_settled_at is not null from public.challenges where id = '00000000-0000-0000-0000-0000000013a2'),
  'a challenge that ended since is settled');

-- Approving the backlog: move since back.
update public.settle_config set since = now() - interval '30 days' where id;
select public.settle_due_challenges();
select ok((select score_settled_at is not null from public.challenges where id = '00000000-0000-0000-0000-0000000013a1'),
  'moving since back settles the backlog');

select * from finish();
