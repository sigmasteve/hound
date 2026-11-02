-- 0148: the Yard. Spots open up with rank, items have to be yours (or
-- free) and go in their own spot, trophies come only from wins, and
-- friends can look around.
select plan(19);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cy') as cy \gset
select (now() at time zone 'utc')::date as today \gset
update public.profiles set bones_balance = 100, xp_total = 0 where id = :'ann';
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bob', 'accepted');

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.my_yard(:'today') -> 'size', '0'::jsonb, 'A Pup has the smallest yard');
select is(public.my_yard(:'today') -> 'spots',
  '{"house": "house_classic", "bed": "bed_cushion", "bowl": "bowl_classic", "toy": "toy_ball"}'::jsonb,
  'with four spots, each showing its free item');
select throws_ok(format('select public.place_yard_item(%L, ''plant_left'', ''plant_fern'')', :'today'),
  'That spot opens up when your hound ranks up.', 'A spot the yard doesn''t have yet can''t be used');
select throws_ok(format('select public.place_yard_item(%L, ''bed'', ''bed_donut'')', :'today'),
  'You don''t have that yet.', 'An item has to be bought first');
select throws_ok(format('select public.place_yard_item(%L, ''bed'', ''toy_duck'')', :'today'),
  'That doesn''t go there.', 'and goes only in its own spot');
select throws_ok(format('select public.place_yard_item(%L, ''roof'', null)', :'today'),
  'Unknown spot.', 'Unknown spots are refused');
select public.buy_kennel_item(:'today', 'bed_donut');
select public.place_yard_item(:'today', 'bed', 'bed_donut');
select is(public.my_yard(:'today') #>> '{spots,bed}', 'bed_donut', 'A bought bed goes in the bed spot');
select is((select bones_balance from public.profiles where id = :'ann'), 40, 'for its 60 Bones');
select public.place_yard_item(:'today', 'bed', null);
select is(public.my_yard(:'today') #>> '{spots,bed}', 'bed_cushion', 'Clearing a spot puts the free item back');
select public.place_yard_item(:'today', 'bed', 'bed_donut');
reset role;

-- Tracker (level 5 is 350 XP): two more spots, and room for two trophies.
update public.profiles set xp_total = 350 where id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.my_yard(:'today') -> 'size', '1'::jsonb, 'A Tracker''s yard is bigger');
select is(public.my_yard(:'today') #>> '{spots,plant_left}', 'plant_fern', 'with a plant spot');
select public.place_yard_item(:'today', 'plant_left', 'plant_fern');
select is(public.my_yard(:'today') #>> '{spots,bed}', 'bed_donut', 'and keeps what was already placed');
select is(public.my_yard(:'today') -> 'trophies', '[]'::jsonb, 'No wins, no trophies');
reset role;

-- Wins: a Soccer win, a Step Race won against Cy, and a "win" alone in a
-- Step Race, which doesn't count. A Soccer loss doesn't either.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('33333333-0000-0000-0000-000000000001', 'Race', 'steps', :'ann', 7, now(), now() + interval '7 days'),
  ('33333333-0000-0000-0000-000000000002', 'Alone', 'steps', :'ann', 7, now(), now() + interval '7 days');
insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, created_at) values
  (:'ann', null, 'soccer_result', 35, 0, now() - interval '3 days'),
  (:'ann', null, 'soccer_result', 35, 0, now() - interval '2 days'),
  (:'ann', null, 'soccer_result', 5, 0, now() - interval '1 day'),
  (:'ann', '33333333-0000-0000-0000-000000000001', 'steps_result', 50, 0, now() - interval '1 hour'),
  (:'cy', '33333333-0000-0000-0000-000000000001', 'steps_result', 25, 0, now() - interval '1 hour'),
  (:'ann', '33333333-0000-0000-0000-000000000002', 'steps_result', 50, 0, now());
update public.profiles set xp_total = 350 where id = :'ann';

select tests.sign_in(:'ann');
set local role authenticated;
select is(
  (select jsonb_agg(jsonb_build_object('kind', t ->> 'kind', 'wins', t -> 'wins')) from jsonb_array_elements(public.my_yard(:'today') -> 'trophies') t),
  '[{"kind": "steps", "wins": 1}, {"kind": "soccer", "wins": 2}]'::jsonb,
  'Trophies are wins only, newest first, with how many');
select is(public.my_yard(:'today') -> 'shown', '["steps", "soccer"]'::jsonb, 'Unchosen, the newest stand in the yard');
select throws_ok(format('select public.set_yard_trophies(%L, array[''cricket''])', :'today'),
  'Win one of those first.', 'A trophy you haven''t won can''t go up');
select throws_ok(format('select public.set_yard_trophies(%L, array[''soccer'', ''steps'', ''soccer''])', :'today'),
  'Your yard has room for 2 trophies.', 'and only as many as the yard has room for');
select public.set_yard_trophies(:'today', array['soccer']);
select is(public.my_yard(:'today') -> 'shown', '["soccer"]'::jsonb, 'Chosen trophies are the ones shown');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is(public.friend_yard(:'ann', :'today') #>> '{spots,bed}', 'bed_donut', 'A friend can look around your yard');
reset role;

select * from finish();
