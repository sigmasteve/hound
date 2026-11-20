-- 0228: Send a push. Who it reaches (a registered phone, news and
-- invites on, not already in the challenge for 'not_in'), the preview,
-- the checks (admins only, lengths, an open Global challenge, one a day),
-- the recipients snapshot, opened, joined, and the overview.
select plan(17);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
-- Ann, Bob and Cat have phones registered; Dan doesn't. Cat turned news off.
insert into public.device_push_tokens (user_id, expo_push_token, platform) values
  (:'ann', 'ExponentPushToken[ann]', 'ios'), (:'bob', 'ExponentPushToken[bob]', 'android'), (:'cat', 'ExponentPushToken[cat]', 'ios');
update public.profiles set alert_news_push_enabled = false where id = :'cat';
-- Where the Edge Function lives (0093), as on the real project.
select vault.create_secret('https://example.supabase.co', 'project_url')
  where not exists (select 1 from vault.secrets where name = 'project_url');
-- Clear the way: nothing sent in the last day on this database.
delete from public.push_broadcasts where created_at > now() - interval '25 hours';

select tests.sign_in(:'ada');
set local role authenticated;
select public.publish_global_challenge('Big Week', 'steps', 7, now() - interval '1 hour', now() + interval '3 days') as g \gset
reset role;
insert into public.challenge_participants (challenge_id, user_id) values (:'g', :'ann');
select is((select count(*)::int from public.broadcast_audience(:'g', 'not_in') u where u in (:'ann', :'bob', :'cat', :'dan')), 1,
  'An invite to Big Week: Bob only (Ann''s in it, Cat turned news off, Dan has no phone)');

select tests.sign_in(:'ada');
set local role authenticated;
select ok((public.admin_broadcast_preview() ->> 'reach')::int >= 2, 'Everyone with a phone and news on');
select is(public.admin_broadcast_preview(:'g', 'not_in') - 'next_at' - 'turned_off' - 'reach' - 'already_in',
  '{}'::jsonb, 'The preview''s keys');
select is((public.admin_broadcast_preview(:'g', 'not_in') ->> 'already_in')::int >= 1, true, 'and it says who''s already in');
select throws_ok($q$select public.admin_send_broadcast('', 'Hi', null, 'all')$q$, 'A title of 1 to 50 characters.', 'A title');
select throws_ok($q$select public.admin_send_broadcast('Hi', repeat('x', 151), null, 'all')$q$, 'A message of 1 to 150 characters.', 'A short message');
select throws_ok($q$select public.admin_send_broadcast('Hi', 'There', gen_random_uuid(), 'all')$q$,
  'That challenge isn''t a Global one people can still join.', 'Only an open Global challenge');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.admin_send_broadcast('Hi', 'There', null, 'all')$q$, 'Only an admin can send a push to everyone.', 'Admins only');
select throws_ok($q$select public.admin_broadcast_preview()$q$, 'not authorized', 'The preview too');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select public.admin_send_broadcast('Big Week starts now', 'Most steps in a week wins. Join in one tap.', :'g', 'not_in') as b \gset
select ok(:'b' is not null, 'Sent');
select throws_like($q$select public.admin_send_broadcast('Again', 'Twice', null, 'all')$q$, 'One push a day: the next can go at % UTC on %', 'One a day');
select ok(public.admin_broadcast_preview() ->> 'next_at' is not null, 'The preview says when the next can go');
reset role;
select is((select count(*)::int from public.push_broadcast_recipients where broadcast_id = :'b' and user_id in (:'ann', :'bob', :'cat', :'dan')), 1,
  'The recipients, as they were when it went');
select is((select array[title, audience, challenge_name] from public.push_broadcasts where id = :'b'),
  array['Big Week starts now', 'not_in', 'Big Week'], 'What was sent');

-- Bob taps it and joins.
select tests.sign_in(:'bob');
set local role authenticated;
select public.broadcast_opened(:'b');
reset role;
insert into public.challenge_participants (challenge_id, user_id) values (:'g', :'bob');

select tests.sign_in(:'ada');
set local role authenticated;
select is((select (x ->> 'opened')::int from jsonb_array_elements(public.admin_broadcast_overview() -> 'broadcasts') x where x ->> 'id' = :'b'), 1,
  'Opened: Bob');
select is((select (x ->> 'joined')::int from jsonb_array_elements(public.admin_broadcast_overview() -> 'broadcasts') x where x ->> 'id' = :'b'), 1,
  'Joined within a day: Bob');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.admin_broadcast_overview()$q$, 'not authorized', 'The overview is admins only');
reset role;

select * from finish();
