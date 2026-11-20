-- 0229: Send only to me. A test goes to the admin's own phone only,
-- needs that phone registered, doesn't use the day's push, stays out of
-- the history, and is capped at 20 a day.
select plan(7);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Ann') as ann \gset
select vault.create_secret('https://example.supabase.co', 'project_url')
  where not exists (select 1 from vault.secrets where name = 'project_url');
delete from public.push_broadcasts where created_at > now() - interval '25 hours';

select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok($q$select public.admin_send_broadcast_test('Hi', 'There')$q$,
  'Your phone isn''t registered for pushes. Turn notifications on for Hound, open it once, and try again.', 'Needs your phone registered');
reset role;
insert into public.device_push_tokens (user_id, expo_push_token, platform) values (:'ada', 'ExponentPushToken[ada]', 'ios');
-- Ada turned news off herself: a test still reaches her.
update public.profiles set alert_news_push_enabled = false where id = :'ada';

select tests.sign_in(:'ada');
set local role authenticated;
select public.admin_send_broadcast_test('Title Bout soon', 'Trying the wording') as t \gset
reset role;
select is((select array_agg(user_id) from public.push_broadcast_recipients where broadcast_id = :'t'), array[:'ada']::uuid[], 'Only to her');
select is((select is_test from public.push_broadcasts where id = :'t'), true, 'Marked a test');

select tests.sign_in(:'ada');
set local role authenticated;
select ok(public.admin_broadcast_preview() ->> 'next_at' is null, 'It doesn''t use the day''s push');
select is((select count(*)::int from jsonb_array_elements(public.admin_broadcast_overview() -> 'broadcasts') x where x ->> 'id' = :'t'), 0,
  'and stays out of the history');
reset role;
insert into public.push_broadcasts (created_by, title, message, recipients, is_test)
  select :'ada', 'T', 'M', 1, true from generate_series(1, 19);
select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok($q$select public.admin_send_broadcast_test('Hi', 'There')$q$, 'That''s 20 tests today. Try again tomorrow.', '20 a day');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.admin_send_broadcast_test('Hi', 'There')$q$, 'Only an admin can send a push to everyone.', 'Admins only');
reset role;

select * from finish();
