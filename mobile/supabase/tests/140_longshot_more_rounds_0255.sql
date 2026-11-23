-- 0255: Long Shot's rounds: steps up to 15 a day, plus a round per 20
-- minutes of the day's workouts (up to 100 minutes, 5 rounds); the state
-- says which came from where; Admin counts today's workout rounds.
select plan(12);

select is(public.longshot_workout_rounds(19), 0, '19 minutes: no round yet');
select is(public.longshot_workout_rounds(20), 1, '20 minutes: 1 round');
select is(public.longshot_workout_rounds(40), 2, '40 minutes: 2');
select is(public.longshot_workout_rounds(60), 3, 'Two 30-minute workouts (60): 3');
select is(public.longshot_workout_rounds(100), 5, '100 minutes: 5');
select is(public.longshot_workout_rounds(240), 5, 'Capped at 100 minutes: still 5');

select tests.new_user('Ann') as ann \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York' where id = :'ann';
select public.soccer_today(:'ann') as today \gset
select '00000000-0000-0000-0000-0000000255e1' as cid \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  (:'cid', 'Range Week', 'longshot', :'ann', 7,
   ((:'today'::date - 1)::timestamp at time zone 'America/New_York'), ((:'today'::date + 6)::timestamp at time zone 'America/New_York'), :'today'::date - 1);
insert into public.challenge_participants (challenge_id, user_id) values (:'cid', :'ann');

-- 18,000 steps (15 at most from steps) and two 30-minute workouts (3).
insert into public.daily_step_totals (user_id, day, steps) values (:'ann', :'today', 18000);
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min) values
  (:'ann', 'ls1', 'Running', (:'today'::date + time '07:00') at time zone 'America/New_York', 'healthkit', 30),
  (:'ann', 'ls2', 'Traditional Strength Training', (:'today'::date + time '12:00') at time zone 'America/New_York', 'healthkit', 30);

select is(public.longshot_granted(:'ann', :'today'), 18, '15 from steps and 3 from 60 workout minutes');
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.longshot_state(:'cid') -> 'today' ->> 'fromSteps')::int, 15, 'Steps give 15 at most');
select is((public.longshot_state(:'cid') -> 'today' ->> 'fromWorkout')::int, 3, 'The workouts give 3');
select is((public.longshot_state(:'cid') -> 'today' ->> 'left')::int, 18, '18 rounds to shoot');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_longshot_overview() ->> 'workoutRoundsToday')::int, 3, 'Admin: 3 rounds from workouts today');
select is((public.admin_longshot_overview() ->> 'workoutPeopleToday')::int, 1, 'Admin: by 1 person');
reset role;

select * from finish();
