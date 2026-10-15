-- 0097: goals and hound settings are private, starter goals arrive once,
-- and nobody has more than 8 goals at a time.
select plan(9);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset

select tests.sign_in(:'ann');
set local role authenticated;
select public.ensure_starter_goals(8000, 2.5);
select is((select count(*)::int from public.goals), 3, 'Starter goals: three of them');
select is((select target from public.goals where metric = 'steps'), 8000::numeric,
  'The steps goal keeps the phone''s own setting');
update public.goals set archived_at = now();
select public.ensure_starter_goals(10000, 3);
select is((select count(*)::int from public.goals where archived_at is null), 0,
  'Removing every goal does not bring the starters back');

insert into public.goals (user_id, metric, period, target, activity, label)
select :'ann', 'workouts', 'week', 2, 'run', 'Run twice a week' from generate_series(1, 8);
select throws_ok(
  $q$insert into public.goals (user_id, metric, period, target) values (auth.uid(), 'steps', 'day', 5000)$q$,
  'You can have up to 8 goals at a time.', 'A ninth goal is refused');
select throws_ok(
  $q$insert into public.goals (user_id, metric, period, target, activity) values (auth.uid(), 'steps', 'day', 5000, 'run')$q$,
  '23514', null, 'Only workout goals take an activity');

insert into public.hound_settings (user_id, level) values (auth.uid(), 'relentless');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is((select count(*)::int from public.goals), 0, 'Someone else''s goals are not visible');
select is((select count(*)::int from public.hound_settings), 0, 'Someone else''s hound settings are not visible');
select throws_ok(
  format($q$insert into public.goals (user_id, metric, period, target) values (%L, 'steps', 'day', 5000)$q$, :'ann'),
  '42501', null, 'Nobody can add a goal for someone else');
reset role;

set local role anon;
select throws_ok('select * from public.goals', '42501', null, 'Signed-out visitors cannot read goals');
reset role;

select * from finish();
