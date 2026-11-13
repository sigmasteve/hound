-- 0204: logging a workout by hand. The settings, every refusal, half
-- value for the games and full for "did you work out", undo, the day's
-- limit counting undone ones, a phone workout replacing a logged one,
-- clients can't write a logged one themselves, and Admin.
select plan(39);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
select tests.new_user('Eve') as eve \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob', :'cat', :'dan', :'eve');
-- Everyone but Bob has been on Hound a month.
update public.profiles set created_at = now() - interval '30 days' where id in (:'ann', :'cat', :'dan', :'eve');

-- Yesterday in New York, and a time on it.
select (now() at time zone 'America/New_York')::date - 1 as yday \gset
create function pg_temp.at(p_day date, p_time text) returns timestamptz language sql as $$
  select (p_day::timestamp + p_time::interval) at time zone 'America/New_York';
$$;

-- ── The settings ──
select is((select array[per_day, min_min, max_min, back_days, value_pct, new_account_days, undo_minutes] from public.workout_log_config),
  array[2, 5, 90, 1, 50, 7, 15], 'Two a day, 5 to 90 minutes, back to yesterday, half value, a week''s wait, 15 minutes to undo');

-- ── The refusals ──
select tests.sign_in(:'bob');
set local role authenticated;
select throws_like($q$select public.log_workout('strength', 30, now() - interval '1 hour')$q$,
  'Logging opens after your first week. In 7 days.%', 'A new account waits a week');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.log_workout('juggling', 30, now() - interval '1 minute')$q$, 'Pick what you did.', 'An unknown type is refused');
select throws_ok($q$select public.log_workout('strength', 4, now() - interval '1 minute')$q$, 'Between 5 and 90 minutes.', 'Under 5 minutes is refused');
select throws_ok($q$select public.log_workout('strength', 91, now() - interval '1 minute')$q$, 'Between 5 and 90 minutes.', 'Over 90 minutes is refused');
select throws_ok($q$select public.log_workout('strength', 30, now() + interval '2 hours')$q$, 'That hasn''t happened yet.', 'The future is refused');
select throws_ok(format($q$select public.log_workout('strength', 30, %L)$q$, pg_temp.at(:'yday'::date - 1, '12:00')),
  'Only today or yesterday.', 'Two days ago is refused');

-- ── Logging: half for the games, full on the record ──
select is((public.log_workout('strength', 30, pg_temp.at(:'yday', '08:00')) ->> 'counts_as')::int, 15,
  '30 minutes of strength yesterday counts as 15');
reset role;
select is((select array[duration_min, logged_min] from public.workout_history where user_id = :'ann' and source = 'manual'),
  array[15, 30], 'The workout row holds 15 for the games and 30 as logged');
select is((select name || ' ' || to_char(occurred_at at time zone 'America/New_York', 'HH24:MI') from public.workout_history
  where user_id = :'ann' and source = 'manual'), 'Traditional Strength Training 07:30',
  'It''s written as strength training, starting 30 minutes before it ended');
select is((select distance_mi is null and avg_heart_rate is null from public.workout_history where user_id = :'ann' and source = 'manual'),
  true, 'No distance and no heart rate');
select is((select b.strength_min from public.sport_day_bonus(:'ann', :'yday', 'hoops') b), 15,
  'The sports games see half: 15 strength minutes');
select is(public.doors_evidence(:'ann', 'workout', :'yday', 0), true, 'Daily Doors'' workout door counts it');

-- ── Overlaps ──
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$select public.log_workout('walk', 20, %L)$q$, pg_temp.at(:'yday', '08:10')),
  'That overlaps your traditional strength training at 7:30 am.', 'A workout over another one is refused');
reset role;
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min)
values (:'ann', 'hk-walk-1', 'Walking', pg_temp.at(:'yday', '18:10'), 'Apple Health', 25);
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$select public.log_workout('run', 30, %L)$q$, pg_temp.at(:'yday', '18:20')),
  'That overlaps your walking at 6:10 pm.', 'So is one over a phone workout');

-- ── Undo, and the day's limit ──
select public.log_workout('yoga', 20, pg_temp.at(:'yday', '12:00')) ->> 'source_id' as yoga \gset
select lives_ok(format($q$select public.undo_logged_workout(%L)$q$, :'yoga'), 'A fresh log can be undone');
reset role;
select is((select count(*)::int from public.workout_history where source_id = :'yoga'), 0, 'Undoing takes the workout away');
select isnt((select undone_at from public.workout_log_entries where source_id = :'yoga'), null, 'but keeps the log');
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$select public.log_workout('cycle', 20, %L)$q$, pg_temp.at(:'yday', '15:00')),
  'That''s 2 logged for yesterday.', 'An undone log still counts towards the day''s two');
reset role;
update public.workout_log_entries set created_at = now() - interval '20 minutes'
  where user_id = :'ann' and type = 'strength';
select source_id as lift from public.workout_log_entries where user_id = :'ann' and type = 'strength' \gset
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$select public.undo_logged_workout(%L)$q$, :'lift'),
  'It''s been more than 15 minutes: it stands now.', 'After 15 minutes it stands');

-- ── Today, and reading mine ──
select is((public.log_workout('run', 10, now() - interval '1 minute') ->> 'left_today')::int, 1, 'A run today leaves one more for today');
select is((select (d ->> 'left_today')::int * 10 + (d ->> 'left_yesterday')::int from public.my_logged_workouts() d), 10,
  'Mine: one left today, none left yesterday');
select is((select jsonb_array_length(d -> 'logs') from public.my_logged_workouts() d), 3, 'Mine lists the last two days'' logs, undone ones too');
select is((select count(*)::int from jsonb_array_elements((public.my_logged_workouts()) -> 'logs') e where e ->> 'undo_until' is not null),
  1, 'Only the fresh one can still be undone');

-- ── Clients can't write a logged workout themselves ──
select throws_ok(format($q$insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min)
  values (%L, 'fake-1', 'Running', now() - interval '3 hours', 'manual', 90)$q$, :'ann'),
  '42501', null, 'Writing a manual row directly is refused');
update public.workout_history set duration_min = 90 where user_id = :'ann' and source = 'manual';
reset role;
select is((select duration_min from public.workout_history where user_id = :'ann' and source = 'manual' and name = 'Running'), 5,
  'and changing one does nothing (the run still counts as 5)');
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok(format($q$insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min)
  values (%L, 'hk-row-2', 'Cycling', %L, 'Apple Health', 15)$q$, :'ann', pg_temp.at(:'yday', '05:00')),
  'Phone workouts still sync');

-- ── A phone workout over the same time replaces a logged one ──
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min)
values (:'ann', 'hk-lift-1', 'Traditional Strength Training', pg_temp.at(:'yday', '07:40'), 'Apple Health', 35);
reset role;
select is((select count(*)::int from public.workout_history where user_id = :'ann' and source = 'manual' and name ~ 'Strength'), 0,
  'The watch''s strength workout replaces the logged one');
select isnt((select replaced_at from public.workout_log_entries where user_id = :'ann' and type = 'strength'), null,
  'and the log says so');

-- ── Admin's value and blocks ──
select tests.sign_in(:'ada');
set local role authenticated;
select lives_ok($q$select public.admin_set_workout_log_config('{"value_pct": 0}')$q$, 'Admin sets logged workouts to count for nothing in games');
select lives_ok(format($q$select public.admin_block_workout_logging(%L, true)$q$, :'cat'), 'and turns logging off for Cat');
reset role;
select tests.sign_in(:'dan');
set local role authenticated;
select is((public.log_workout('strength', 60, pg_temp.at(:'yday', '09:00')) ->> 'counts_as')::int, 0, 'Then a logged hour counts as 0');
select throws_ok(format($q$select public.admin_block_workout_logging(%L, true)$q$, :'eve'), 'not authorized', 'Only admins block');
reset role;
select tests.sign_in(:'cat');
set local role authenticated;
select throws_ok($q$select public.log_workout('walk', 30, now() - interval '1 minute')$q$,
  'Logging is off for your account. Workouts from a watch or your phone still count.', 'Cat can''t log');
reset role;

-- ── Admin's numbers and who's worth a look ──
-- Dan logs a 60 minute walk with 100 steps; Eve's at the limit 10 days running.
select tests.sign_in(:'dan');
set local role authenticated;
select public.log_workout('walk', 60, pg_temp.at(:'yday', '20:00'), 100);
reset role;
insert into public.workout_log_entries (user_id, source_id, type, minutes, started_at, ended_at, local_day)
select :'eve', 'manual:eve-' || k || '-' || j, 'strength', 30, now() - make_interval(days => k), now() - make_interval(days => k), current_date - k
from generate_series(1, 10) k cross join generate_series(1, 2) j;
select tests.sign_in(:'ada');
set local role authenticated;
select is((select (o ->> 'people_7d')::int from public.admin_workout_log_overview() o), 3,
  'Admin sees who logged this week (Ann, Dan, Eve)');
select is((select count(*)::int from jsonb_array_elements((public.admin_workout_log_overview()) -> 'flagged') f
  where f ->> 'why' = 'Logged a 60 min walk with 100 steps in that time' and f ->> 'user_id' = :'dan'), 1,
  'A walk with almost no steps is worth a look');
select is((select count(*)::int from jsonb_array_elements((public.admin_workout_log_overview()) -> 'flagged') f
  where f ->> 'why' = 'At the limit 10 of the last 14 days' and f ->> 'user_id' = :'eve'), 1,
  'So is being at the limit day after day');
select is((select jsonb_array_length(o -> 'blocked') from public.admin_workout_log_overview() o), 1, 'and Cat is listed as blocked');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.admin_workout_log_overview()$q$, 'not authorized', 'Only admins see the numbers');
reset role;

select * from finish();
