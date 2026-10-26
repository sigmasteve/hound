-- 0116: today's step rank comes back with yesterday's, for the Step rank
-- tile, and only ever the caller's own.
select plan(6);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset

\set TODAY '(now() at time zone ''utc'')::date'
insert into public.daily_step_totals (user_id, day, steps) values
  (:'ann', :TODAY, 9000), (:'bob', :TODAY, 12000), (:'cat', :TODAY, 4000),
  (:'ann', :TODAY - 1, 3000), (:'bob', :TODAY - 1, 8000), (:'cat', :TODAY - 1, 6000);

select tests.sign_in(:'ann');
set local role authenticated;
select is((select rank from public.my_daily_step_rank_change()), 2::bigint, 'Ann is 2nd today');
select is((select total_users from public.my_daily_step_rank_change()), 3::bigint, 'of 3 today');
select is((select yesterday_rank from public.my_daily_step_rank_change()), 3::bigint, 'and was 3rd yesterday');
select is((select count(*)::int from public.my_daily_step_rank_change()), 1, 'Only Ann''s own row comes back');
reset role;

-- Someone with no total yesterday gets no yesterday rank.
delete from public.daily_step_totals where user_id = :'cat' and day = :TODAY - 1;
select tests.sign_in(:'cat');
set local role authenticated;
select is((select yesterday_rank from public.my_daily_step_rank_change()), null::bigint, 'No total yesterday, no yesterday rank');
reset role;

select ok(not has_function_privilege('anon', 'public.my_daily_step_rank_change(date)', 'EXECUTE'),
  'Signed-out visitors can''t call it');

select * from finish();
