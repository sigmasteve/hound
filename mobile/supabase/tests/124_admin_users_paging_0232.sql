-- 0232: the Admin user directory a page at a time: admins only, every
-- person reachable past the old 25, pages that don't overlap, the search
-- still filtering, the page size kept to 1 - 200, and the old call as it
-- was.
select plan(7);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Needle Person') as needle \gset
select tests.new_user('Person ' || lpad(i::text, 3, '0')) from generate_series(1, 40) i;

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($q$select * from public.admin_search_users('', 10, 0)$q$, 'not authorized', 'Admins only');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select is((select count(*)::int from public.admin_search_users('', 200, 0)), (select count(*)::int from public.profiles),
  'Everyone is reachable, not just the first 25');
select is((select count(*)::int from (
    select id from public.admin_search_users('', 20, 0)
    intersect select id from public.admin_search_users('', 20, 20)) x), 0, 'Pages don''t overlap');
select is((select array_agg(id) from (select id from public.admin_search_users('', 20, 0) union all select id from public.admin_search_users('', 20, 20)) x),
  (select array_agg(id) from public.admin_search_users('', 40, 0)), 'Two pages of 20 are the first 40, in order');
select is((select array_agg(id) from public.admin_search_users('needle', 50, 0)), array[:'needle'::uuid], 'The search still filters');
select is((select count(*)::int from public.admin_search_users('', 0, 0)), 1, 'A page is at least one');
select is((select count(*)::int from public.admin_search_users('')), 25, 'The one-argument call still returns 25');
reset role;

select * from finish();
