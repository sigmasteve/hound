-- 0276: logging by hand is limited by time (2 hours a day), not by count.
select plan(8);

select tests.new_user('Ann') as ann \gset
-- A time zone where it's about noon now, so the last 4 hours are today.
select 'Etc/GMT' || case when k >= 0 then '-' || k else '+' || -k end as tz
  from (select 12 - extract(hour from now() at time zone 'UTC')::int as k) x \gset
update public.profiles set created_at = now() - interval '60 days', time_zone = :'tz' where id = :'ann';
update public.workout_log_config set enabled = true where id;

select is((select per_day from public.workout_log_config), 0, 'No count limit');
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.my_logged_workouts() ->> 'cap_min')::int, 120, 'The day''s cap is 2 hours');
select public.log_workout('yoga', 45, now() - interval '3 hours 50 minutes') as a \gset
select public.log_workout('pilates', 30, now() - interval '2 hours 30 minutes') as b \gset
select is((public.log_workout('dance', 30, now() - interval '1 hour 30 minutes') ->> 'minutes_left_today')::int, 15, 'Three logged: 105 minutes, 15 left');
select throws_ok($$select public.log_workout('hiit', 20, now() - interval '30 minutes')$$,
  'That''s over 2 hours by hand today: 15 min left.', 'A fourth that goes past 2 hours is refused');
select is((public.log_workout('stretching', 15, now() - interval '5 minutes') ->> 'minutes_left_today')::int, 0, 'Exactly to the cap is fine');
select throws_ok($$select public.log_workout('yoga', 5, now() - interval '1 minute')$$,
  'That''s 2 hours by hand today. More tomorrow.', 'At the cap: no more today');
select lives_ok(format('select public.undo_logged_workout(%L)', :'b'::jsonb ->> 'source_id'), 'Undo the 30-minute one');
select is((public.my_logged_workouts() ->> 'minutes_today')::int, 90, 'Undone time doesn''t count');
reset role;

select * from finish();
