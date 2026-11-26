-- 0277: a workout's own steps aren't counted twice in Move points.
select plan(6);

select tests.new_user('Ann') as ann \gset
-- A time zone where it's about noon now, so the workouts below are today.
select 'Etc/GMT' || case when k >= 0 then '-' || k else '+' || -k end as tz
  from (select 12 - extract(hour from now() at time zone 'UTC')::int as k) x \gset
update public.profiles set time_zone = :'tz' where id = :'ann';
select (now() at time zone :'tz')::date as today \gset

-- A 113-minute "Workout" from Health (the 'other' rate, 100 a minute).
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min)
  values (:'ann', 'hk-1', 'Workout', now() - interval '3 hours', 'apple_health', 113);
select is(public.move_points_day(:'ann', :'today'), 11300, 'Before the phone sends its steps: 113 × 100');

-- The phone sends the steps taken during it.
update public.workout_history set steps_during = 11050 where user_id = :'ann' and source_id = 'hk-1';
select is(public.move_points_day(:'ann', :'today'), 250, 'Its own 11,050 steps come off: 250 left');
select is((select steps from public.move_day_items(:'ann', :'today') where source_id = 'hk-1'), 11050, 'And it says how many');

-- More steps than its points: 0, never below.
update public.workout_history set steps_during = 20000 where user_id = :'ann' and source_id = 'hk-1';
select is(public.move_points_day(:'ann', :'today'), 0, 'Never below 0');

-- A strength session with few steps keeps nearly everything.
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min, steps_during)
  values (:'ann', 'hk-2', 'Traditional Strength Training', now() - interval '1 hour', 'apple_health', 45, 300);
select is((select pts from public.move_day_items(:'ann', :'today') where source_id = 'hk-2'),
  45 * public.move_rate_of('strength_light') - 300, 'Strength: its points less its 300 steps');

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.my_move(:'today') -> 'items' -> 0 ->> 'steps')::int, 20000, 'Move''s list says the steps already counted');
reset role;

select * from finish();
