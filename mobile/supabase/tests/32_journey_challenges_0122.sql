-- 0121/0122: a Journey challenge needs a course, ends when someone
-- reaches the end of it, places by miles, tells you how many are ahead
-- and behind, and can be published globally with a course.
select plan(12);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Zed', true) as zed \gset

-- A Journey without a course isn't one.
select throws_ok(format($q$insert into public.challenges (name, kind, created_by, duration_days, starts_at, ends_at)
  values ('No course', 'journey', %L, 10, now() - interval '1 day', now() + interval '9 days')$q$, :'ann'),
  '23514', null, 'A Journey needs a course and its length');

-- Ann and Bob race across the Golden Gate (1.7 mi); it has 9 days to go.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, distance_goal_unit, distance_goal_mi, course_id)
values ('88888888-0000-0000-0000-000000000001', 'Bridge race', 'journey', :'ann', 10, now() - interval '1 day', now() + interval '9 days', 'miles', 1.7, 'golden-gate');
insert into public.challenge_participants (challenge_id, user_id) values
  ('88888888-0000-0000-0000-000000000001', :'ann'), ('88888888-0000-0000-0000-000000000001', :'bob');
insert into public.progress_snapshots (challenge_id, user_id, day, distance_mi) values
  ('88888888-0000-0000-0000-000000000001', :'ann', (now() at time zone 'utc')::date, 1.0),
  ('88888888-0000-0000-0000-000000000001', :'bob', (now() at time zone 'utc')::date, 1.2);

select tests.sign_in(:'ann');
set local role authenticated;
select is((select ahead from public.journey_standing('88888888-0000-0000-0000-000000000001')), 1, 'Bob is ahead of Ann');
select is((select rank from public.journey_standing('88888888-0000-0000-0000-000000000001')), 2, 'so she is second');
select is((select behind from public.journey_standing('88888888-0000-0000-0000-000000000001')), 0, 'with nobody behind her');
select is((select leader_miles from public.journey_standing('88888888-0000-0000-0000-000000000001')), 1.20, 'and the leader at 1.2 mi');
-- Nobody has reached the end, so it keeps running.
select public.settle_challenge_score('88888888-0000-0000-0000-000000000001');
reset role;
select is((select score_settled_at from public.challenges where id = '88888888-0000-0000-0000-000000000001'),
  null, 'It runs on while nobody has finished the course');

select tests.sign_in(:'cat');
set local role authenticated;
select is((select count(*)::int from public.journey_standing('88888888-0000-0000-0000-000000000001')), 0, 'Someone not in it has no standing');
reset role;

-- Bob crosses the bridge: the race is over with 9 days still on the clock.
update public.progress_snapshots set distance_mi = 1.8
  where challenge_id = '88888888-0000-0000-0000-000000000001' and user_id = :'bob';
select tests.sign_in(:'ann');
set local role authenticated;
select is((select finished from public.journey_standing('88888888-0000-0000-0000-000000000001')), 1, 'One person has finished');
select public.settle_challenge_score('88888888-0000-0000-0000-000000000001');
reset role;
select isnt((select score_settled_at from public.challenges where id = '88888888-0000-0000-0000-000000000001'),
  null, 'Reaching the end of the course ends the race');
select is((select score_points from public.activity_events where challenge_id = '88888888-0000-0000-0000-000000000001' and user_id = :'bob'),
  60, 'First place, plus a little for finishing');
select is((select score_points from public.activity_events where challenge_id = '88888888-0000-0000-0000-000000000001' and user_id = :'ann'),
  25, 'Second place');

-- A global Journey carries its course.
select tests.sign_in(:'zed');
set local role authenticated;
select public.publish_global_challenge('Windy City, Together', 'journey', 30, now() + interval '1 day', now() + interval '4 days',
  null, null, 26.2, null, null, 'windy-city') as global_id \gset
select is((select course_id from public.list_global_challenges() where id = :'global_id'), 'windy-city', 'A global Journey lists its course');
reset role;

select * from finish();
