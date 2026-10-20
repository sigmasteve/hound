-- 0115: a sync that reads nothing (0 steps, 0 miles) can't wipe out a
-- day the app already saved, but real numbers still replace old ones.
select plan(9);

select tests.new_user('Ann') as ann \gset

\set C '66666666-0000-0000-0000-000000000001'
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  (:'C', 'Weekly Step-Off', 'steps', :'ann', 7, now() - interval '1 day', now() + interval '6 days');
insert into public.challenge_participants (challenge_id, user_id) values (:'C', :'ann');

select tests.sign_in(:'ann');
set local role authenticated;
-- Each sync is the same upsert the app sends (recordProgressDays).
insert into public.progress_snapshots (challenge_id, user_id, day, steps, distance_mi) values (:'C', auth.uid(), current_date, 9200, 4.1)
  on conflict (challenge_id, user_id, day) do update set steps = excluded.steps, distance_mi = excluded.distance_mi;
select is((select steps from public.progress_snapshots where challenge_id = :'C' and day = current_date), 9200, 'A day of steps saves');
insert into public.progress_snapshots (challenge_id, user_id, day, steps, distance_mi) values (:'C', auth.uid(), current_date, 0, 0)
  on conflict (challenge_id, user_id, day) do update set steps = excluded.steps, distance_mi = excluded.distance_mi;
select is((select steps from public.progress_snapshots where challenge_id = :'C' and day = current_date), 9200, 'A read of 0 steps keeps the steps already there');
select is((select distance_mi from public.progress_snapshots where challenge_id = :'C' and day = current_date), 4.1::numeric, 'and the miles');
insert into public.progress_snapshots (challenge_id, user_id, day, steps, distance_mi) values (:'C', auth.uid(), current_date, 9850, 0)
  on conflict (challenge_id, user_id, day) do update set steps = excluded.steps, distance_mi = excluded.distance_mi;
select is((select steps from public.progress_snapshots where challenge_id = :'C' and day = current_date), 9850, 'More steps still replace the old number');
select is((select distance_mi from public.progress_snapshots where challenge_id = :'C' and day = current_date), 4.1::numeric, 'while 0 miles keeps the miles');
insert into public.progress_snapshots (challenge_id, user_id, day, steps, distance_mi) values (:'C', auth.uid(), current_date, 9700, 4.3)
  on conflict (challenge_id, user_id, day) do update set steps = excluded.steps, distance_mi = excluded.distance_mi;
select is((select steps from public.progress_snapshots where challenge_id = :'C' and day = current_date), 9700, 'A real number below the old one still saves');

-- Today's step total, behind the daily and weekly step ranks.
insert into public.daily_step_totals (user_id, day, steps) values (auth.uid(), current_date, 7300)
  on conflict (user_id, day) do update set steps = excluded.steps;
insert into public.daily_step_totals (user_id, day, steps) values (auth.uid(), current_date, 0)
  on conflict (user_id, day) do update set steps = excluded.steps;
select is((select steps from public.daily_step_totals where user_id = auth.uid() and day = current_date), 7300,
  'A read of 0 keeps today''s step total');
reset role;

-- Admins and the server can still set a 0.
update public.progress_snapshots set steps = 0, distance_mi = 0
  where challenge_id = :'C';
select is((select steps from public.progress_snapshots where challenge_id = :'C' and day = current_date), 0, 'A server-side change can still set 0 steps');
update public.daily_step_totals set steps = 0 where user_id = :'ann';
select is((select steps from public.daily_step_totals where user_id = :'ann' and day = current_date), 0,
  'and a 0 step total');

select * from finish();
