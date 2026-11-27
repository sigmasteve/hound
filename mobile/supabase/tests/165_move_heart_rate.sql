-- 0280: a workout with no type is scored by heart rate, minute by minute.
select plan(11);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Boss', true) as boss \gset
-- A time zone where it's about noon now, so the workouts below are today.
select 'Etc/GMT' || case when k >= 0 then '-' || k else '+' || -k end as tz
  from (select 12 - extract(hour from now() at time zone 'UTC')::int as k) x \gset
update public.profiles set time_zone = :'tz' where id = :'ann';
select (now() at time zone :'tz')::date as today \gset

-- Steve's 3-hour "Manual labor": 181 minutes of "Workout" with 8,994 steps.
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min, steps_during)
  values (:'ann', 'hk-labor', 'Workout', now() - interval '3 hours 30 minutes', 'apple_health', 181, 8994);
select is(public.move_points_day(:'ann', :'today'), 9106, 'Before the phone sends its heart rate: 181 × 100 less its steps');

-- 70 minutes walking, the other 111 at a light heart rate.
update public.workout_history
  set effort = '{"rest": 55, "walk": 70, "nohr": 0, "idle": {"0": 30, "10": 9, "20": 26, "30": 18, "40": 14, "50": 8, "60": 6}}'
  where user_id = :'ann' and source_id = 'hk-labor';
select is(public.move_points_day(:'ann', :'today'), (18 + 14) * 30 + (8 + 6) * 70, 'Walking earns nothing more; the rest by heart rate: 1,940');
select is((select steps from public.move_day_items(:'ann', :'today') where source_id = 'hk-labor'), 8994, 'Its steps still show as already counted');

-- A minute with no heart rate earns the workout's rate.
update public.workout_history set effort = '{"rest": 55, "walk": 0, "nohr": 10, "idle": {}}' where source_id = 'hk-labor' and user_id = :'ann';
select is(public.move_points_day(:'ann', :'today'), 1000, 'No heart rate: 10 × 100');
-- Junk in the summary counts as nothing.
update public.workout_history set effort = '{"idle": {"x": 5, "40": "lots"}, "nohr": -3}' where source_id = 'hk-labor' and user_id = :'ann';
select is(public.move_points_day(:'ann', :'today'), 0, 'Junk counts as nothing');

-- A workout with a type keeps its rate, summary or not.
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min, steps_during, effort)
  values (:'ann', 'hk-yoga', 'Yoga', now() - interval '1 hour', 'apple_health', 30, 100, '{"rest": 55, "walk": 0, "nohr": 0, "idle": {"0": 30}}');
select is((select pts from public.move_day_items(:'ann', :'today') where source_id = 'hk-yoga'),
  30 * public.move_rate_of('yoga') - 100, 'Yoga: its rate, as before');

update public.workout_history
  set effort = '{"rest": 55, "walk": 70, "nohr": 0, "idle": {"20": 80, "60": 31}}'
  where user_id = :'ann' and source_id = 'hk-labor';
select tests.sign_in(:'ann');
set local role authenticated;
select is((select i -> 'effort' from jsonb_array_elements(public.my_move(:'today') -> 'items') i where i ->> 'source_id' = 'hk-labor'),
  '{"hr": 111, "walk": 70}'::jsonb, 'Move''s list says how it was scored');
select throws_ok($$select public.admin_set_move_config('{"hr_walk_spm": 70}')$$, 'Admins only.', 'Admin only');
reset role;

select tests.sign_in(:'boss');
set local role authenticated;
select throws_ok($$select public.admin_set_move_config('{"hr_bands": [{"from": 40, "per_min": 80}, {"from": 20, "per_min": 40}]}')$$,
  'Heart-rate levels go up: each starts above the one before.', 'Levels must go up');
select lives_ok($$select public.admin_set_move_config('{"hr_walk_spm": 70, "hr_bands": [{"from": 30, "per_min": 50}]}')$$, 'Admin sets them');
reset role;
select is((select pts from public.move_day_items(:'ann', :'today') where source_id = 'hk-labor'), 31 * 50,
  'New levels apply: nothing under 30 above resting, then 50 a minute');

select * from finish();
