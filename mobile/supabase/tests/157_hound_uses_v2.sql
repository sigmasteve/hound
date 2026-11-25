-- 0272: the wizard's "What will you use Hound for?" page.
select plan(12);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Boss', true) as boss \gset


select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.save_hound_uses('{steps,fasting,strength,water,activities,bogus}')$$, 'The new checkboxes save');
reset role;
select is((select hound_uses from public.profiles where id = :'ann'), '{activities,fasting,steps,strength,water}'::text[], 'Unknown ones are dropped');

set local role authenticated;
select lives_ok($$select public.save_hound_uses('{workouts,friends,other}')$$, 'Workouts, friends and other save too');
reset role;
select is((select hound_uses from public.profiles where id = :'ann'), '{friends,other,workouts}'::text[], 'Replaced, not added to');

set local role authenticated;
select public.save_hound_uses('{steps,fasting,strength,water,activities}');
select throws_ok($$select public.admin_uses_overview()$$, 'not authorized', 'Only admins read it');
reset role;

-- Ann tries fasting and logs an activity.
insert into public.fasts (user_id, goal_hours, started_at) values (:'ann', 16, now() - interval '2 hours');
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min)
  values (:'ann', 'm1', 'Yoga', now() - interval '20 days', 'manual', 30);
insert into public.water_log (user_id, day, ml) values (:'ann', current_date, 250);

select tests.sign_in(:'boss');
set local role authenticated;
select public.admin_uses_overview() as o \gset
reset role;
select is((:'o'::jsonb -> 'uses' -> 'fasting' ->> 'ticked')::int, 1, 'One ticked fasting');
select is((:'o'::jsonb -> 'uses' -> 'fasting' ->> 'now')::int, 1, 'And fasted this week');
select is((:'o'::jsonb -> 'uses' -> 'activities' ->> 'tried')::int, 1, 'Activities: tried');
select is((:'o'::jsonb -> 'uses' -> 'activities' ->> 'now')::int, 0, 'But not this week');
select is((:'o'::jsonb -> 'uses' -> 'strength' ->> 'tried')::int, 0, 'Strength: ticked, not tried');
select is((:'o'::jsonb -> 'uses' -> 'water' ->> 'now')::int, 1, 'Water this week');
select is((:'o'::jsonb ->> 'fasting_tile_waiting')::int, 0, 'Nobody waits on a first fast: Ann has fasted');

select * from finish();
