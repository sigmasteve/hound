-- 0172: Daily Doors. The calendar's tasks, the steps target, opening a
-- door (only your own, only today's, only once, and what's behind it),
-- tasks marked done as the evidence lands or already there, points and
-- the run with its weekly free miss, the board, settling, publishing,
-- and the admin overview.
select plan(40);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
update public.profiles set time_zone = 'UTC' where id in (:'ann', :'bob', :'cat');
select (now() at time zone 'utc')::date as today \gset

-- Does a task, whichever it is, for a member on a day.
create or replace function tests.do_task(p_user uuid, p_task text, p_day date, p_target int)
returns void
language plpgsql
as $$
begin
  case p_task
    when 'steps' then
      insert into public.daily_step_totals (user_id, day, steps) values (p_user, p_day, coalesce(p_target, 5000) + 100)
      on conflict (user_id, day) do update set steps = excluded.steps;
    when 'workout' then
      insert into public.workout_history (user_id, source_id, name, occurred_at, source)
      values (p_user, gen_random_uuid()::text, 'Run', p_day::timestamp at time zone 'utc' + interval '12 hours', 'test');
    when 'water' then
      insert into public.water_days (user_id, day) values (p_user, p_day);
    when 'goal_day' then
      insert into public.activity_events (user_id, kind, created_at) values (p_user, 'goal_day', p_day::timestamp at time zone 'utc' + interval '12 hours');
    when 'treat' then
      insert into public.kennels (user_id) values (p_user) on conflict do nothing;
      update public.kennels set treated_on = p_day where user_id = p_user;
    when 'walk' then
      insert into public.hound_walks (user_id, day, start_minute, started_at, ended_at, steps)
      values (p_user, p_day, 600, p_day::timestamp at time zone 'utc' + interval '10 hours',
              p_day::timestamp at time zone 'utc' + interval '10 hours 20 minutes', 2000);
    when 'cheer' then
      insert into public.nudges (from_user, to_user, created_at)
      values (p_user, (select id from public.profiles where id <> p_user limit 1), p_day::timestamp at time zone 'utc' + interval '12 hours');
  end case;
end;
$$;

-- The calendar.
select is(public.doors_task('00000000-0000-0000-0000-0000000000d1', 5), public.doors_task('00000000-0000-0000-0000-0000000000d1', 5),
  'A door''s task is the same every time');
select is((select count(distinct public.doors_task('00000000-0000-0000-0000-0000000000d1', n)) from generate_series(1, 7) n), 7::bigint,
  'Each week of doors has all seven tasks');
select is((select count(*) from generate_series(2, 60) n
           where public.doors_task('00000000-0000-0000-0000-0000000000d1', n) = public.doors_task('00000000-0000-0000-0000-0000000000d1', n - 1)),
  0::bigint, 'Never the same task two days running');

-- The steps target.
select is(public.doors_steps_target(:'bob', :'today'), 5000, 'No steps on record: 5,000');
insert into public.daily_step_totals (user_id, day, steps)
select :'bob', :'today'::date - n, 8000 from generate_series(1, 7) n;
select is(public.doors_steps_target(:'bob', :'today'), 9000, 'A tenth over an 8,000 average, to the nearest 500');
delete from public.daily_step_totals where user_id = :'bob';

-- d1: today is door 4 of 6. d2: today is door 3 of 5. d3: today is the
-- last of 4. d4: 14 doors, today the last.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day, is_global, join_closes_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'Knock Knock', 'doors', :'ann', 6, (:'today'::date - 3)::timestamp at time zone 'utc', (:'today'::date + 3)::timestamp at time zone 'utc', :'today'::date - 3, true, now() + interval '3 days'),
  ('00000000-0000-0000-0000-0000000000d2', 'Doors Two', 'doors', :'ann', 5, (:'today'::date - 2)::timestamp at time zone 'utc', (:'today'::date + 3)::timestamp at time zone 'utc', :'today'::date - 2, true, now() + interval '3 days'),
  ('00000000-0000-0000-0000-0000000000d3', 'Doors Three', 'doors', :'ann', 4, (:'today'::date - 3)::timestamp at time zone 'utc', (:'today'::date + 1)::timestamp at time zone 'utc', :'today'::date - 3, true, now() + interval '1 day'),
  ('00000000-0000-0000-0000-0000000000d4', 'Doors Four', 'doors', :'ann', 14, (:'today'::date - 13)::timestamp at time zone 'utc', (:'today'::date + 1)::timestamp at time zone 'utc', :'today'::date - 13, true, now() + interval '1 day');
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000000d1', :'ann'), ('00000000-0000-0000-0000-0000000000d1', :'bob'),
  ('00000000-0000-0000-0000-0000000000d2', :'bob'), ('00000000-0000-0000-0000-0000000000d3', :'bob'),
  ('00000000-0000-0000-0000-0000000000d4', :'ann'), ('00000000-0000-0000-0000-0000000000d4', :'bob');

-- Opening.
select tests.sign_in(:'cat');
set local role authenticated;
select throws_ok($$select public.doors_open('00000000-0000-0000-0000-0000000000d1', (now() at time zone 'utc')::date)$$,
  'Join the challenge to open its doors.', 'Only members open doors');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.doors_open('00000000-0000-0000-0000-0000000000d1', (now() at time zone 'utc')::date + 1)$$,
  'That door isn''t open today.', 'Not tomorrow''s door');
select throws_ok($$select public.doors_open('00000000-0000-0000-0000-0000000000d1', (now() at time zone 'utc')::date - 1)$$,
  'That door isn''t open today.', 'and not yesterday''s');
select lives_ok($$select public.doors_open('00000000-0000-0000-0000-0000000000d1', (now() at time zone 'utc')::date)$$, 'Today''s door opens');
select lives_ok($$select public.doors_open('00000000-0000-0000-0000-0000000000d1', (now() at time zone 'utc')::date)$$, 'and opening it again is harmless');
select public.doors_state('00000000-0000-0000-0000-0000000000d1', :'today') as st \gset
reset role;

select is((select count(*) from public.door_opens where user_id = :'bob' and challenge_id = '00000000-0000-0000-0000-0000000000d1'), 1::bigint,
  'One row for the door');
select is((select door_no from public.door_opens where user_id = :'bob' and challenge_id = '00000000-0000-0000-0000-0000000000d1'), 4,
  'Today is door 4');
select is((:'st'::jsonb -> 'doors' -> 3 ->> 'state'), 'opened', 'The state shows door 4 opened');
select is((:'st'::jsonb -> 'doors' -> 0 ->> 'state'), 'missed', 'door 1 missed');
select is((:'st'::jsonb -> 'doors' -> 0 ->> 'task'), public.doors_task('00000000-0000-0000-0000-0000000000d1', 1), 'with what it was');
select is((:'st'::jsonb -> 'doors' -> 4 ->> 'state'), 'locked', 'door 5 still shut');
select ok((:'st'::jsonb -> 'doors' -> 4 -> 'task') = 'null'::jsonb, 'and its task hidden');
select is((:'st'::jsonb ->> 'points')::int, 1, 'Opening is a point');
select is((select steps_target is not null from public.door_opens where user_id = :'bob' and door_no = 4 and challenge_id = '00000000-0000-0000-0000-0000000000d1'),
  public.doors_task('00000000-0000-0000-0000-0000000000d1', 4) = 'steps', 'A steps door, and only a steps door, has a target');

-- Done when the evidence lands.
select tests.do_task(:'bob', task, day, steps_target) from public.door_opens
where user_id = :'bob' and challenge_id = '00000000-0000-0000-0000-0000000000d1';
select isnt((select done_at from public.door_opens where user_id = :'bob' and challenge_id = '00000000-0000-0000-0000-0000000000d1'), null,
  'Doing the task marks the door done');
select is((select points from public.doors_points('00000000-0000-0000-0000-0000000000d1', :'bob', :'today')), 3, 'Opened and done: 3 points');
select is((select place from public.doors_board('00000000-0000-0000-0000-0000000000d1') where user_id = :'bob'), 1::bigint, 'Bob leads the board');

-- Already done before opening; every third door's Bones.
select tests.do_task(:'bob', public.doors_task('00000000-0000-0000-0000-0000000000d2', 3), :'today', public.doors_steps_target(:'bob', :'today'));
select bones_balance as before from public.profiles where id = :'bob' \gset
select tests.sign_in(:'bob');
set local role authenticated;
select lives_ok($$select public.doors_open('00000000-0000-0000-0000-0000000000d2', (now() at time zone 'utc')::date)$$, 'Door 3 opens');
reset role;
select isnt((select done_at from public.door_opens where user_id = :'bob' and challenge_id = '00000000-0000-0000-0000-0000000000d2'), null,
  'A task already done counts straight away');
select ok((select bonus_bones between 5 and 10 from public.door_opens where user_id = :'bob' and challenge_id = '00000000-0000-0000-0000-0000000000d2'),
  'Door 3 has 5 to 10 Bones behind it');
select is((select bones_balance from public.profiles where id = :'bob'),
  :before + (select bonus_bones from public.door_opens where user_id = :'bob' and challenge_id = '00000000-0000-0000-0000-0000000000d2'),
  'paid on opening');

-- The last door's prize.
select tests.sign_in(:'bob');
set local role authenticated;
select lives_ok($$select public.doors_open('00000000-0000-0000-0000-0000000000d3', (now() at time zone 'utc')::date)$$, 'The last door opens');
reset role;
select ok(exists (select 1 from public.cosmetic_purchases where user_id = :'bob' and item_id = 'frame_doorbell'), 'and the Doorbell Ring is theirs');
select throws_ok($$insert into public.cosmetic_items (id, slot, name, cost_bones, door_prize) values ('frame_x', 'frame', 'X', 10, true)$$,
  '23514', null, 'A door prize can''t also be bought');

-- Points and the run, with a free miss a week: doors 1-3 done, 4 missed
-- (free), 5 done, 6 missed (run over), 7 done, 8 opened only (week 2's
-- free one), 9-10 done, 11-13 missed (run over), 14 today.
insert into public.door_opens (challenge_id, user_id, door_no, day, task, done_at)
select '00000000-0000-0000-0000-0000000000d4', :'ann', n, :'today'::date - 14 + n, 'water', case when n = 8 then null else now() end
from unnest(array[1, 2, 3, 5, 7, 8, 9, 10]) n;
select is((select row(points, run, opened, done)::text from public.doors_points('00000000-0000-0000-0000-0000000000d4', :'ann', :'today')),
  '(25,0,8,7)', '25 points: 7 done, 8 opened, two runs of three');
select is((select row(points, run)::text from public.doors_points('00000000-0000-0000-0000-0000000000d4', :'ann', :'today'::date - 3)),
  '(25,3)', 'with the run at 3 after door 10');

-- Settling: most points wins.
update public.challenges set ends_at = now() - interval '2 days' where id = '00000000-0000-0000-0000-0000000000d4';
select public.settle_challenge_score_core('00000000-0000-0000-0000-0000000000d4');
select is((select score_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000d4' and user_id = :'ann' and kind = 'doors_result'),
  50, 'First place: 50');
select is((select score_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000d4' and user_id = :'bob' and kind = 'doors_result'),
  25, 'Second: 25');

-- A steps door done on the phone's own count: d5 starts so today's door
-- is its first steps door.
select n - 1 as back from generate_series(1, 7) n
where public.doors_task('00000000-0000-0000-0000-0000000000d5', n) = 'steps' limit 1 \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day, is_global, join_closes_at) values
  ('00000000-0000-0000-0000-0000000000d5', 'Doors Five', 'doors', :'ann', 10, (:'today'::date - :back)::timestamp at time zone 'utc',
   (:'today'::date + 10 - :back)::timestamp at time zone 'utc', :'today'::date - :back, true, now() + interval '1 day');
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000d5', :'cat');
select tests.sign_in(:'cat');
set local role authenticated;
select public.doors_open('00000000-0000-0000-0000-0000000000d5', (now() at time zone 'utc')::date) is not null as opened \gset
select is(public.doors_claim_steps('00000000-0000-0000-0000-0000000000d5', (now() at time zone 'utc')::date, 100), false,
  'Fewer steps than the target don''t count');
select is(public.doors_claim_steps('00000000-0000-0000-0000-0000000000d5', (now() at time zone 'utc')::date, 20000), true,
  'The phone''s own count reaching it does');
reset role;
select isnt((select done_at from public.door_opens where user_id = :'cat' and challenge_id = '00000000-0000-0000-0000-0000000000d5'), null,
  'and the door is done');

-- Publishing and the overview.
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.publish_global_challenge('Knock Knock, Hound', 'doors', 24, now() + interval '1 day', now() + interval '8 days')$$,
  'An admin publishes a Daily Doors');
select throws_ok($$select public.publish_global_challenge('Too short', 'doors', 2, now() + interval '1 day', now() + interval '2 days')$$,
  'Daily Doors runs 3 to 60 days, a door a day.', 'At least three doors');
select is((public.admin_doors_overview() ->> 'opens')::int, 12, 'The overview counts every door opened');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.admin_doors_overview()$$, 'not authorized', 'Only admins see it');
reset role;

select * from finish();
