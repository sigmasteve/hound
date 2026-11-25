-- 0270: Move points.
select plan(20);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Boss', true) as boss \gset
update public.profiles set time_zone = 'UTC' where id in (:'ann', :'bob', :'boss');
select (now() at time zone 'UTC')::date as today \gset
select date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' as midnight \gset

-- Rates and tagging.
select is(public.move_activity_for('Indoor Spin Class'), 'spin', 'Spin matches before cycling');
select is(public.move_activity_for('Traditional Strength Training'), 'strength_light', 'Strength from a watch is light');
select is(public.move_activity_for('Outdoor Walk'), 'steps', 'Walks earn nothing extra');
select is(public.move_activity_for('Stair Climbing'), 'other', 'Anything else is "other"');

-- A watch yoga class, 30 min: 30 × 70.
select tests.sign_in(:'ann');
set local role authenticated;
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min)
  values (:'ann', 'hk:1', 'Yoga', :'midnight'::timestamptz + interval '1 hour', 'healthkit', 30);
select throws_ok(format($q$insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min)
  values (%L, 'hound:x', 'Traditional Strength Training', now(), 'hound', 60)$q$, :'ann'), '42501', null, 'Clients can''t write a Hound-timed workout');
reset role;
select is((select move_rate from public.workout_history where source_id = 'hk:1'), 70, 'A workout keeps the rate it was recorded with');
select is(public.move_points_day(:'ann', :'today'), 2100, 'Yoga 30 min = 2,100');

-- A walk adds nothing; hand-logged minutes count up to 2 h a day.
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min, logged_min) values
  (:'ann', 'hk:2', 'Outdoor Walk', :'midnight'::timestamptz + interval '2 hours', 'healthkit', 40, null),
  (:'ann', 'manual:a', 'Cycling', :'midnight'::timestamptz + interval '3 hours', 'manual', 45, 90),
  (:'ann', 'manual:b', 'Pilates', :'midnight'::timestamptz + interval '5 hours', 'manual', 30, 60);
select is(public.move_points_day(:'ann', :'today'), 2100 + 90 * 195 + 30 * 85, 'By hand: 90 min of cycling, then only 30 of the 60 of pilates');
select is((select counted_min from public.move_day_items(:'ann', :'today') where source_id = 'manual:b'), 30, 'The cap cuts the second log');

-- A rate change applies to what comes after.
select tests.sign_in(:'boss');
set local role authenticated;
select lives_ok($$select public.admin_set_move_config('{"rates": {"yoga": 80}}')$$, 'Admin sets a rate');
reset role;
select is((select move_rate from public.workout_history where source_id = 'hk:1'), 70, 'An earlier yoga class keeps 70');

-- A Move points challenge: the phone's steps plus the day's points.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, counts)
  values ('00000000-0000-0000-0000-00000000c0de', 'Move-a-thon', 'steps', :'ann', 7, now() - interval '1 day', now() + interval '6 days', 'move');
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-00000000c0de', :'ann');
insert into public.progress_snapshots (challenge_id, user_id, day, steps, distance_mi)
  values ('00000000-0000-0000-0000-00000000c0de', :'ann', :'today', 5000, 2)
  on conflict (challenge_id, user_id, day) do update set steps = excluded.steps;
select is((select steps from public.progress_snapshots where challenge_id = '00000000-0000-0000-0000-00000000c0de' and day = :'today'),
  5000 + public.move_points_day(:'ann', :'today'), 'The day counts steps plus Move points');
select is((select raw_steps from public.progress_snapshots where challenge_id = '00000000-0000-0000-0000-00000000c0de' and day = :'today'),
  5000, 'and keeps the phone''s steps');

-- A guided routine: timed on the server, never more minutes than went by.
select tests.sign_in(:'ann');
set local role authenticated;
select (public.move_session_start('routine', 'full10')) ->> 'id' as r1 \gset
reset role;
update public.move_sessions set started_at = now() - interval '10 minutes 30 seconds' where id = :'r1';
set local role authenticated;
select is((public.move_session_finish(:'r1', 45, false, null, :'today')) ->> 'minutes', '11', 'Asked for 45 minutes, 11 went by: 11');
reset role;
select is((select steps from public.progress_snapshots where challenge_id = '00000000-0000-0000-0000-00000000c0de' and day = :'today'),
  5000 + public.move_points_day(:'ann', :'today'), 'The challenge day catches up');

-- Strength log: sets, and a new best the second time.
set local role authenticated;
select (public.move_session_start('strength', 'legs')) ->> 'id' as s1 \gset
reset role;
update public.move_sessions set started_at = now() - interval '20 minutes' where id = :'s1';
set local role authenticated;
select is(jsonb_array_length((public.move_session_finish(:'s1', 20, false,
  '[{"exercise": "Goblet squat", "set_no": 1, "weight_lb": 35, "reps": 10}]', :'today')) -> 'prs'), 0, 'The first time isn''t a PR');
select (public.move_session_start('strength', 'legs')) ->> 'id' as s2 \gset
reset role;
update public.move_sessions set started_at = now() - interval '5 minutes' where id = :'s2';
set local role authenticated;
select is((public.move_session_finish(:'s2', 5, true,
  '[{"exercise": "goblet squat", "set_no": 1, "weight_lb": 40, "reps": 12}]', :'today')) -> 'prs' -> 0 ->> 'weight_lb', '40', 'Heavier is a new best');
select is((public.move_set_strength_target(1, :'today')) ->> 'streak', '1', 'Goal 1 a week, met this week: a 1-week streak');
select throws_ok($$update public.move_rates set per_min = 999 where activity = 'yoga'$$, '42501', null, 'Clients can''t change the rates');
select throws_ok($$select public.admin_move_overview()$$, 'not authorized', 'Admin numbers are admins only');
reset role;

select * from finish();
