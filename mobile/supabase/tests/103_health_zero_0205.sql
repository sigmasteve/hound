-- 0205: spotting people whose phone syncs but sends 0 steps.
select plan(10);

select tests.new_user('Bri') as bri \gset
select tests.new_user('Cal') as cal \gset
select tests.new_user('Dot') as dot \gset
select tests.new_user('Ada', true) as ada \gset

-- Bri: opened today, 0 steps on her last 4 saved days (steps before that).
-- Cal: opened today, walking every day.
-- Dot: 0 steps for a week, but hasn't opened Hound in 10 days.
update public.profiles set last_active_at = now() where id in (:'bri', :'cal');
update public.profiles set last_active_at = now() - interval '10 days' where id = :'dot';
insert into public.daily_step_totals (user_id, day, steps)
select :'bri'::uuid, current_date - k, case when k < 4 then 0 else 5000 end from generate_series(0, 6) k;
insert into public.daily_step_totals (user_id, day, steps)
select :'cal'::uuid, current_date - k, 8000 from generate_series(0, 6) k;
insert into public.daily_step_totals (user_id, day, steps)
select :'dot'::uuid, current_date - 10 - k, 0 from generate_series(0, 6) k;

select tests.sign_in(:'cal');
set local role authenticated;
select throws_ok($$select public.admin_health_zero_overview()$$, 'not authorized', 'Only admins see who sends 0 steps');
select throws_ok(format('select public.admin_user_steps_recent(%L)', :'bri'), 'not authorized', 'or anyone''s recent steps');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_health_zero_overview() ->> 'count')::int, 1, 'One person: Bri');
select is((public.admin_health_zero_overview() -> 'people' -> 0 ->> 'user_id'), :'bri', 'It is Bri');
select is((public.admin_health_zero_overview() -> 'people' -> 0 ->> 'zero_days')::int, 4, 'with 4 zero days in a row');
select is((public.admin_health_zero_overview() -> 'people' -> 0 ->> 'last_nonzero_day')::date, current_date - 4, 'and steps last on the day before them');
select is((public.admin_user_steps_recent(:'bri') ->> 'zero_streak')::int, 4, 'Her detail says 4 zero days');
select is(jsonb_array_length(public.admin_user_steps_recent(:'bri') -> 'days'), 7, 'with her last 7 days');
select is((public.admin_user_steps_recent(:'cal') ->> 'zero_streak')::int, 0, 'Cal walks: no zero days');
select is((public.admin_user_steps_recent(:'dot') ->> 'zero_streak')::int, 7, 'Dot''s zeros count on his own page, though he''s left off the list for not opening Hound lately');
reset role;

select * from finish();
