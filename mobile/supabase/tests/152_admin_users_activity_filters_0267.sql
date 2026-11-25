-- 0267: the user directory's activity filters and their counts.
select plan(7);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Hour') as hour \gset
select tests.new_user('Two days') as two \gset
select tests.new_user('Five days') as five \gset
select tests.new_user('Month') as month \gset
select tests.new_user('Never') as never \gset
update public.profiles set last_active_at = now() - interval '1 hour' where id in (:'hour', :'ada');
update public.profiles set last_active_at = now() - interval '2 days' where id = :'two';
update public.profiles set last_active_at = now() - interval '5 days' where id = :'five';
update public.profiles set last_active_at = now() - interval '30 days' where id = :'month';
update public.profiles set last_active_at = null where id = :'never';
create temp table mine as select unnest(array[:'ada', :'hour', :'two', :'five', :'month', :'never']::uuid[]) as id;
grant select on mine to authenticated;

select tests.sign_in(:'hour');
set local role authenticated;
select throws_ok($$select public.admin_user_activity_counts('')$$, 'not authorized', 'Admins only');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select is((select array_agg(id) from public.admin_search_users_active('', 200, 0, 'day') where id in (select id from mine)),
  array[:'ada', :'hour']::uuid[], 'Last 24 hours, newest first (ties by name)');
select is((select count(*)::int from public.admin_search_users_active('', 200, 0, '3d') where id in (select id from mine)), 3, 'Last 3 days includes the last day');
select is((select count(*)::int from public.admin_search_users_active('', 200, 0, '7d') where id in (select id from mine)), 4, 'Last 7 days');
select is((select array_agg(id) from public.admin_search_users_active('', 200, 0, 'over7') where id in (select id from mine)),
  array[:'month', :'never']::uuid[], 'Over 7 days, never opened last');
select is((public.admin_user_activity_counts('') ->> '7d')::int + (public.admin_user_activity_counts('') ->> 'over7')::int,
  (public.admin_user_activity_counts('') ->> 'all')::int, '7 days plus over 7 is everyone');
select is((public.admin_user_activity_counts('days') ->> 'all')::int, 2, 'Counts follow the search');
reset role;

select * from finish();
