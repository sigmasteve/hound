-- 0154: Admin → Water numbers, for platform admins only.
select plan(7);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cy') as cy \gset
update public.profiles set last_active_at = now() where id in (:'ann', :'bob', :'cy');
update public.profiles set username = 'bobby' where id = :'bob';

-- Bob tracks water in cups with sip reminders and logs three glasses;
-- Cy has a goal in ml and hasn't logged.
select tests.sign_in(:'bob');
set local role authenticated;
insert into public.water_goals (user_id, target_ml, sip_reminders) values (auth.uid(), 1893, true);
select public.log_water(current_date, 237);
select public.log_water(current_date, 237);
select public.log_water(current_date, 500);
select throws_ok('select public.admin_water_overview()', 'not authorized', 'Only admins can see the water numbers');
reset role;
insert into public.water_goals (user_id, target_ml, units) values (:'cy', 2000, 'ml');
-- Bob's is the older of the two.
update public.water_goals set created_at = now() - interval '1 day' where user_id = :'bob';

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.admin_water_overview() ->> 'with_goal')::int, 2, 'Counts who has a water goal');
select is((public.admin_water_overview() ->> 'logged_7d')::int, 1, 'and who logged this week');
select is((public.admin_water_overview() ->> 'glasses_7d')::int, 3, 'Counts glasses');
select is((public.admin_water_overview() ->> 'avg_day_ml')::int, 974, 'and the average logged day');
select is((public.admin_water_overview() ->> 'sip_reminders')::int || '/' || (public.admin_water_overview() ->> 'ml'), '1/1',
  'Counts sip reminders and millilitres');
select is(public.admin_water_overview() -> 'newest' -> 1 ->> 'name', 'bobby', 'Lists the newest water goals by username');
reset role;

select * from finish();
