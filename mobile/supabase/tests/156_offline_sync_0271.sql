-- 0271: offline mode's sync.
select plan(13);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Boss', true) as boss \gset
update public.profiles set time_zone = 'UTC', created_at = now() - interval '30 days' where id in (:'ann', :'boss');
insert into public.fasting_profiles (user_id, age) values (:'ann', 'ok');
select (now() at time zone 'UTC')::date as today \gset

select is((select enabled from public.offline_config), false, 'Offline mode starts off');

select tests.sign_in(:'ann');
set local role authenticated;
-- A strength log timed on the phone, 35 minutes ago to 5 minutes ago.
select is((public.offline_apply('11111111-1111-1111-1111-111111111111', 'move_offline_session', jsonb_build_object(
  'kind', 'strength', 'ref', 'legs', 'started_at', now() - interval '35 minutes', 'ended_at', now() - interval '5 minutes',
  'minutes', 30, 'hard', false, 'local_date', :'today',
  'sets', '[{"exercise": "Goblet squat", "set_no": 1, "weight_lb": 35, "reps": 10}]'::jsonb), now() - interval '5 minutes')) ->> 'minutes',
  '30', 'A session timed offline syncs');
select is((public.offline_apply('11111111-1111-1111-1111-111111111111', 'move_offline_session', '{}'::jsonb)) ->> 'repeat', 'true', 'Sent again, it isn''t applied twice');
select is((select count(*)::int from public.workout_history where user_id = :'ann' and source = 'hound'), 1, 'One workout, not two');
reset role;
select is(public.move_points_day(:'ann', :'today'), 3000, 'It counts in full: 30 × 100');
set local role authenticated;
-- More minutes than went by: cut to the span.
select is((public.offline_apply('22222222-2222-2222-2222-222222222222', 'move_offline_session', jsonb_build_object(
  'kind', 'routine', 'ref', 'full10', 'started_at', now() - interval '3 hours', 'ended_at', now() - interval '2 hours 50 minutes',
  'minutes', 45, 'local_date', :'today'))) ->> 'minutes', '10', 'Asked for 45, 10 went by: 10');
-- Overlapping another timed session: turned down, with a reason.
select is((public.offline_apply('33333333-3333-3333-3333-333333333333', 'move_offline_session', jsonb_build_object(
  'kind', 'routine', 'ref', 'quick7', 'started_at', now() - interval '20 minutes', 'ended_at', now() - interval '13 minutes',
  'local_date', :'today'))) ->> 'error', 'That overlaps another session timed in Hound.', 'An overlap is turned down');
select is((public.offline_apply('44444444-4444-4444-4444-444444444444', 'move_offline_session', jsonb_build_object(
  'kind', 'routine', 'ref', 'quick7', 'started_at', now() + interval '1 hour', 'ended_at', now() + interval '2 hours'))) ->> 'error',
  'That session ends in the future.', 'So is one from the future');
-- Fasting and water.
select ok((public.offline_apply('55555555-5555-5555-5555-555555555555', 'fasting_start',
  jsonb_build_object('plan_hours', 16, 'started_at', now() - interval '2 hours'))) ? 'fast_id', 'A fast started offline syncs');
select ok((public.offline_apply('66666666-6666-6666-6666-666666666666', 'log_water',
  jsonb_build_object('day', :'today', 'ml', 250))) ? 'id', 'So does a glass of water');
select is((public.offline_apply('77777777-7777-7777-7777-777777777777', 'teleport', '{}'::jsonb)) ->> 'error', 'Unknown op teleport.', 'An unknown op is turned down');
select throws_ok($$select public.admin_offline_overview()$$, 'not authorized', 'Admin numbers are admins only');
reset role;
select tests.sign_in(:'boss');
set local role authenticated;
select is((public.admin_offline_overview() ->> 'failures_7d')::int >= 3, true, 'Admin sees the ones turned down');
reset role;

select * from finish();
