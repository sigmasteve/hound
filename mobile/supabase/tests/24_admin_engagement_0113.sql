-- 0113: Admin → Engagement is for admins only, and counts opens from the
-- daily bonus and new members' setup. Checked as differences, so other
-- rows in the database don't matter.
select plan(6);

select tests.new_user('Ada', true) as ada \gset
select tests.sign_in(:'ada');
set local role authenticated;
select public.admin_engagement() as before \gset
reset role;

select tests.new_user('Bob') as bob \gset
insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
  values (:'bob', 'daily_bonus', 0, 0, 5);
update public.profiles set push_permission = 'granted' where id = :'bob';

select tests.sign_in(:'ada');
set local role authenticated;
select public.admin_engagement() as after \gset
select is(jsonb_array_length(:'after'::jsonb -> 'daily'), 14, 'Fourteen days of opens');
select is((:'after'::jsonb #>> '{active,day}')::int - (:'before'::jsonb #>> '{active,day}')::int, 1,
  'Opening the app today counts');
select is((:'after'::jsonb ->> 'members')::int - (:'before'::jsonb ->> 'members')::int, 1, 'A new member counts');
select is((:'after'::jsonb #>> '{new_members,joined}')::int - (:'before'::jsonb #>> '{new_members,joined}')::int, 1,
  'as joined in the last 30 days');
select is((:'after'::jsonb #>> '{new_members,notifications}')::int - (:'before'::jsonb #>> '{new_members,notifications}')::int, 1,
  'with notifications allowed');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok('select public.admin_engagement()', 'not authorized', 'Only admins see it');
reset role;

select * from finish();
