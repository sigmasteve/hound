-- 0128: yesterday's goal day can be claimed a day late, up to two UTC
-- days back; three is still refused.
select plan(4);

select tests.new_user('Ann') as ann \gset
select (now() at time zone 'utc')::date as today \gset

select tests.sign_in(:'ann');
set local role authenticated;
select public.ensure_starter_goals(10000, 3);

select throws_ok(format('select * from public.claim_goal_day(%L)', (:'today'::date - 3)),
  'Invalid date.', 'Three days back is still refused');
select is((select awarded from public.claim_goal_day(:'today'::date - 2)), true, 'Two days back is a late claim');
select is((select streak from public.claim_goal_day(:'today'::date - 1)), 2, 'Yesterday continues it');
select is((select streak from public.claim_goal_day(:'today')), 3, 'and today makes three');
reset role;

select * from finish();
