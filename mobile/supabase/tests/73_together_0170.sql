-- 0170: together. Playdates with any friend who finished their goals too
-- (challenge-mates first, kept for the day), walks together (10 minutes
-- or more overlapping), the dog park (friends who walked in the last
-- day), park visits, and the admin numbers.
select plan(17);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
select current_date as today \gset
insert into public.friendships (requester_id, recipient_id, status) values
  (:'ann', :'bob', 'accepted'), (:'ann', :'cat', 'accepted');

-- A walk from m1 to m2 minutes ago.
create function pg_temp.walk(u uuid, m1 int, m2 int, steps int) returns void language sql as $$
  insert into public.hound_walks (user_id, day, start_minute, started_at, ended_at, steps)
  values (u, current_date, 600, now() - make_interval(mins => m1), now() - make_interval(mins => m2), steps);
$$;

-- ── Playdates ──
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.my_together(:'today') -> 'playdate', 'null'::jsonb, 'No playdate before your goals are done');
reset role;

insert into public.goal_streaks (user_id, streak, last_hit_on) values
  (:'ann', 1, :'today'), (:'bob', 1, :'today'), (:'cat', 1, :'today');
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'Step Week', 'steps', :'ann', 7, now() - interval '1 day', now() + interval '6 days');
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000000d1', :'ann'), ('00000000-0000-0000-0000-0000000000d1', :'bob');

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.my_together(:'today') -> 'playdate' ->> 'owner', 'Bob', 'Both done: a friend in a challenge together comes first');
select is(public.my_together(:'today') -> 'playdate' ->> 'challenge', 'Step Week', 'with the challenge named');
reset role;
select is((select friend_id from public.hound_playdates where user_id = :'ann' and day = :'today'), :'bob'::uuid, 'The playdate is kept');
select is(public.yard_view(:'ann', :'today', true) -> 'guest' ->> 'user_id', :'bob', 'and Bob''s hound is over in Ann''s yard');

select tests.sign_in(:'cat');
set local role authenticated;
select is(public.my_together(:'today') -> 'playdate' ->> 'owner', 'Ann', 'Any friend will do now, with no challenge together');
reset role;

-- The playdate stays for the day, even once the challenge ends.
delete from public.challenge_participants where challenge_id = '00000000-0000-0000-0000-0000000000d1' and user_id = :'bob';
select is(public.yard_view(:'ann', :'today', true) -> 'guest' ->> 'user_id', :'bob', 'The day''s playmate doesn''t change');

-- ── Walks together and the park ──
select pg_temp.walk(:'ann', 60, 20, 3000);   -- Ann, 40 minutes
select pg_temp.walk(:'bob', 50, 25, 2400);   -- Bob, overlapping 25 of them
select pg_temp.walk(:'cat', 26, 12, 1500);   -- Cat, overlapping 6
select pg_temp.walk(:'dan', 55, 25, 2800);   -- Dan, not a friend

select tests.sign_in(:'ann');
set local role authenticated;
select is(jsonb_array_length(public.my_together(:'today') -> 'together'), 1, 'One walk together');
select is((select x ->> 'owner' || ' ' || (x ->> 'minutes') from jsonb_array_elements(public.my_together(:'today') -> 'together') x), 'Bob 25',
  'with Bob, for 25 minutes');
select is((select count(*)::int from jsonb_array_elements(public.my_together(:'today') -> 'together') x where x ->> 'owner' = 'Cat'), 0,
  'Six minutes overlapping isn''t walking together');
select is((select array_agg(x ->> 'owner' order by x ->> 'owner') from jsonb_array_elements(public.my_together(:'today') -> 'park') x), array['Bob', 'Cat'],
  'The dog park has friends who''ve walked, and nobody else');
select is((select (x ->> 'with_me')::boolean from jsonb_array_elements(public.my_together(:'today') -> 'park') x where x ->> 'owner' = 'Bob'), true,
  'Bob walked with Ann');
select is((select (x ->> 'minutes')::int from jsonb_array_elements(public.my_together(:'today') -> 'park') x where x ->> 'owner' = 'Cat'), 14,
  'and Cat was out 14 minutes');
select is(public.my_together(:'today') ->> 'me_walked', 'true', 'Ann''s hound is at the park too');
select lives_ok($$select public.log_walk_event('park_open')$$, 'A park visit is noted');

-- ── Admin ──
select is((select (public.admin_together_overview() ->> 'walks_together_7d')::int), 1, 'Admin: walks together');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok('select public.admin_together_overview()', 'not authorized', 'Members can''t see the admin numbers');
reset role;

select * from finish();
