-- 0101: Streak Shields cost Bones, cover one missed day (one a week),
-- and can't be written directly.
select plan(11);

select tests.new_user('Ann') as ann \gset
select (now() at time zone 'utc')::date as today \gset
update public.profiles set bones_balance = 120 where id = :'ann';

select tests.sign_in(:'ann');
set local role authenticated;
select public.ensure_starter_goals(10000, 3);
select is((select shields from public.buy_streak_shield()), 1, 'A shield can be bought');
select is((select shields from public.buy_streak_shield()), 2, 'A second one too');
select throws_ok('select * from public.buy_streak_shield()', 'You already have 2 shields, the most you can hold.',
  'You can hold at most 2');
select throws_ok('update public.goal_streaks set shields = 2', '42501', null, 'Nobody can give themselves shields');
reset role;

select is((select bones_balance from public.profiles where id = :'ann'), 20, 'Each shield cost 50 Bones');

-- A 4-day streak whose last goal day was two days ago: yesterday was missed.
update public.goal_streaks set streak = 4, best_streak = 4, last_hit_on = :'today'::date - 2 where user_id = :'ann';

select tests.sign_in(:'ann');
set local role authenticated;
select is((select shield_covering from public.my_goal_streak(:'today')), true, 'Today shows a shield covering yesterday');
select is((select streak from public.my_goal_streak(:'today')), 4, 'The streak is still alive');
select is((select streak from public.claim_goal_day(:'today')), 5, 'Today''s goal day continues the streak');
select is((select shields from public.goal_streaks), 1, 'One shield was used');
reset role;

-- Another single miss within the week isn't covered.
update public.goal_streaks set last_hit_on = :'today'::date - 1 where user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select is((select streak from public.claim_goal_day(:'today'::date + 1)), 1,
  'A second miss in the same week starts the streak over');
select is((select shields from public.goal_streaks), 1, 'and keeps the shield');
reset role;

select * from finish();
