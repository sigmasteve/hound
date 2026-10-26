-- 0130: a miles Distance pool says whether every mile counts, and a
-- global one is published and listed with it.
select plan(5);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Zed', true) as zed \gset

select throws_ok(format($q$insert into public.challenges (name, kind, created_by, duration_days, starts_at, ends_at, distance_goal_unit, distance_goal_mi, distance_source)
  values ('Odd', 'distance', %L, 7, now(), now() + interval '7 days', 'miles', 50, 'everything')$q$, :'ann'),
  '23514', null, 'Only workouts or all');

select tests.sign_in(:'zed');
set local role authenticated;
select public.publish_global_challenge('Hike the Appalachian Trail', 'distance', 30, now(), now() + interval '30 days',
  null, 'miles', 2190, null, null, null, 'all') as trail \gset
select is((select distance_source from public.list_global_challenges() where id = :'trail'), 'all', 'A global pool is listed with every mile counting');
select public.publish_global_challenge('Steps pool', 'distance', 30, now(), now() + interval '30 days',
  null, 'steps', null, 1000000, null, null, 'all') as steps_pool \gset
select is((select distance_source from public.list_global_challenges() where id = :'steps_pool'), null, 'A steps pool carries none');
select public.publish_global_challenge('Old app pool', 'distance', 30, now(), now() + interval '30 days',
  null, 'miles', 100) as old_pool \gset
select is((select distance_source from public.list_global_challenges() where id = :'old_pool'), null, 'An older app publishes as before');
select throws_ok($q$select public.publish_global_challenge('Odd', 'distance', 30, now(), now() + interval '30 days', null, 'miles', 100, null, null, null, 'some')$q$,
  'P0001', 'Miles count from logged workouts or every mile.', 'Anything else is refused');
reset role;

select * from finish();
