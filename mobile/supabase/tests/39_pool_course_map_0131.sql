-- 0131: a miles Distance pool keeps its course; a steps pool doesn't.
select plan(2);

select tests.new_user('Zed', true) as zed \gset
select tests.sign_in(:'zed');
set local role authenticated;
select public.publish_global_challenge('Hike the Appalachian Trail', 'distance', 30, now(), now() + interval '30 days',
  null, 'miles', 2190, null, null, 'appalachian', 'all') as trail \gset
select is((select course_id from public.list_global_challenges() where id = :'trail'), 'appalachian', 'A miles pool keeps its course');
select public.publish_global_challenge('Steps pool', 'distance', 30, now(), now() + interval '30 days',
  null, 'steps', null, 1000000, null, 'appalachian', null) as steps_pool \gset
select is((select course_id from public.list_global_challenges() where id = :'steps_pool'), null, 'A steps pool has none');
reset role;

select * from finish();
