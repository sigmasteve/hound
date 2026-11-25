-- 0266: the Admin user directory, most recently active first; never
-- opened last.
select plan(2);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Zed') as zed \gset
select tests.new_user('Amy') as amy \gset
select tests.new_user('Never') as never \gset
update public.profiles set last_active_at = now() - interval '1 day' where id = :'ada';
update public.profiles set last_active_at = now() - interval '5 minutes' where id = :'zed';
update public.profiles set last_active_at = now() - interval '2 hours' where id = :'amy';
update public.profiles set last_active_at = null where id = :'never';

select tests.sign_in(:'ada');
set local role authenticated;
select is((select array_agg(id) from (select id from public.admin_search_users('', 200, 0)) x
           where id in (:'ada', :'zed', :'amy', :'never')),
  array[:'zed', :'amy', :'ada', :'never']::uuid[], 'Zed (5 min), Amy (2 h), Ada (a day), then never');
select is((select array_agg(id) from public.admin_search_users('m', 200, 0) where id in (:'amy', :'never')),
  array[:'amy']::uuid[], 'A search keeps the order');
reset role;

select * from finish();
