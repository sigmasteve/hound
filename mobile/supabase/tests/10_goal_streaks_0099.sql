-- 0099: goal days and goal weeks pay once, streaks count days in a row,
-- and nobody can write their own streak.
select plan(15);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob', true) as bob \gset
select (now() at time zone 'utc')::date as today \gset
select bones_balance as ann_bones from public.profiles where id = :'ann' \gset

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format('select * from public.claim_goal_day(%L)', :'today'),
  'You don''t have a daily goal.', 'No daily goal, no goal day');
select public.ensure_starter_goals(10000, 3);

select throws_ok(format('select * from public.claim_goal_day(%L)', (:'today'::date - 3)),
  'Invalid date.', 'A day more than one day from today is refused');

select is((select bones_awarded from public.claim_goal_day(:'today'::date - 1)), 5, 'A goal day pays 5');
select is((select streak from public.claim_goal_day(:'today')), 2, 'The next day makes a 2-day streak');
select is((select awarded from public.claim_goal_day(:'today')), false, 'The same day only pays once');
select is((select awarded from public.claim_goal_day(:'today'::date - 1)), false, 'An earlier day pays nothing');

select is((select streak from public.my_goal_streak(:'today')), 2, 'Today shows the streak');
select is((select hit_today from public.my_goal_streak(:'today')), true, 'Today shows it was a goal day');
select is((select streak from public.my_goal_streak(:'today'::date + 2)), 0, 'Missing a day ends the streak');

select is((select bones_awarded from public.claim_goal_week(:'today')), 15, 'A goal week pays 15');
select is((select awarded from public.claim_goal_week(:'today')), false, 'A week only pays once');

select throws_ok('update public.goal_streaks set streak = 99', '42501', null, 'Nobody can change their own streak');
reset role;

select is((select bones_balance from public.profiles where id = :'ann'), :ann_bones + 25,
  'Bones go to the balance');

-- Six days in a row, then the seventh pays the bigger amount.
update public.goal_streaks set streak = 6 where user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select is((select bones_awarded from public.claim_goal_day(:'today'::date + 1)), 25, 'Every 7th day pays 25');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is((public.admin_goals_overview() ->> 'goal_days_7d')::int, 3, 'Admin → Goals counts goal days');
reset role;

select * from finish();
