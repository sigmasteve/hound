-- 0140: Rally bots — the server simulates a bot to the step the app
-- does, a bot can take a seat, its returns land at the exact moment it
-- walked the target, a bot that can't make it is scored as a miss, and a
-- match against a bot pays the human.
select plan(24);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob');

-- The app's hash and generator, to the bit (reference values from
-- botSimulation.ts run in Node for this bot id).
select is(public.rally_js_hash('00000000-0000-0000-0000-0000000000b1:0'), 1440036722::bigint, 'hashSeed matches the app');
select is(public.rally_js_hash('00000000-0000-0000-0000-0000000000b1:1'), 2418744798::bigint, 'hashSeed matches on day 1');
select is(round(public.rally_js_rand(1440036722)::numeric, 10), 0.6442160190, 'pseudoRandom matches the app');

-- A challenge made at a known UTC moment, with an athletic bot.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000000a3', 'Bot rally', 'rally', :'ann', 14, '2026-11-01 10:00:00+00', '2026-11-15 10:00:00+00');
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a3', :'ann');
insert into public.challenge_bots (id, challenge_id, name, fitness_level) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', 'Reese', 'athletic');
select is(public.rally_bot_total('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b1', '2026-11-03 12:00:00+00'),
  33006::numeric, 'Two and a half days of an athletic bot match simulateBotSteps');
select is(public.rally_bot_total('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b1', '2026-11-01 06:00:00+00'),
  3466::numeric, 'A quarter day matches too');

-- Singles against the bot starts at setup: the bot is already in.
update public.challenges set starts_at = now() - interval '1 day', ends_at = now() + interval '13 days' where id = '00000000-0000-0000-0000-0000000000a3';
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.rally_setup('00000000-0000-0000-0000-0000000000a3', 250, 24, null, array['00000000-0000-0000-0000-0000000000b1']::uuid[])$$, 'A bot can be the opponent');
reset role;
select is((select status || ' ' || side_team from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a3'), 'active b', 'The match starts at once, shuttle on the bot');
select is((select bot_id from public.rally_players where challenge_id = '00000000-0000-0000-0000-0000000000a3' and team = 'b'), '00000000-0000-0000-0000-0000000000b1', 'The bot holds seat B1');
select is((select player_id from public.rally_players where challenge_id = '00000000-0000-0000-0000-0000000000a3' and team = 'a'), :'ann', 'Ann holds seat A1');

-- Just served, the bot hasn't walked anything yet.
select tests.sign_in(:'ann');
set local role authenticated;
select public.rally_settle('00000000-0000-0000-0000-0000000000a3');
reset role;
select is((select side_user_id from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a3'), '00000000-0000-0000-0000-0000000000b1', 'The bot still has the shuttle');

-- Ninety minutes ago the shuttle landed on it: an athletic bot (10,000+
-- a day) has walked 250 since, so its return is in, timed to the step.
update public.rally_games
  set side_since = now() - interval '90 minutes',
      side_start_total = public.rally_bot_total('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b1', now() - interval '90 minutes'),
      due_at = now() + interval '1 hour'
  where challenge_id = '00000000-0000-0000-0000-0000000000a3';
select tests.sign_in(:'ann');
set local role authenticated;
select public.rally_settle('00000000-0000-0000-0000-0000000000a3');
reset role;
select is((select side_user_id from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a3'), :'ann', 'The bot returned; the shuttle is on Ann');
select is((select target_steps from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a3'), 300, 'Her return needs 15% more');
select ok((select side_since > now() - interval '90 minutes' and side_since < now() from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a3'),
  'Her window starts when the bot actually got there, not when anyone looked');
select is((select count(*)::int from public.rally_events where challenge_id = '00000000-0000-0000-0000-0000000000a3' and kind = 'return' and user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'The bot''s return is logged');

-- Ann returns; then give the bot a target it can't reach in time and it misses.
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values ('00000000-0000-0000-0000-0000000000a3', :'ann', current_date, 2000);
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.rally_check_shot('00000000-0000-0000-0000-0000000000a3'), 'returned', 'Ann returns');
reset role;
select is((select side_user_id from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a3'), '00000000-0000-0000-0000-0000000000b1', 'Back to the bot');
update public.rally_games set target_steps = 9000, due_at = now() - interval '1 minute' where challenge_id = '00000000-0000-0000-0000-0000000000a3';
select tests.sign_in(:'ann');
set local role authenticated;
select public.rally_settle('00000000-0000-0000-0000-0000000000a3');
reset role;
select is((select points_a from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a3'), 1, 'A bot that can''t make its target is scored as a miss');
select is((select side_user_id from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a3'), '00000000-0000-0000-0000-0000000000b1', 'The bot receives the serve');

-- The tick settles every Rally with a bot on the shuttle.
select is(public.rally_bots_tick(), 1, 'The scheduled job finds the match');
select ok(exists (select 1 from cron.job where jobname = 'hound-rally-bots'), 'The job is scheduled');

-- Match over on games: the human is paid even though the bot is not a participant.
update public.rally_games set games_a = 1, points_a = 20, points_b = 0, target_steps = 9000, due_at = now() - interval '1 minute' where challenge_id = '00000000-0000-0000-0000-0000000000a3';
select tests.sign_in(:'ann');
set local role authenticated;
select public.rally_settle('00000000-0000-0000-0000-0000000000a3');
select public.settle_challenge_score('00000000-0000-0000-0000-0000000000a3');
reset role;
select is((select score_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000a3' and user_id = :'ann'), 35, 'Beating a bot pays like beating a person');

-- Doubles with a bot partner: Ann and Reese against Bob and a casual bot.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000000a4', 'Bot doubles', 'rally', :'ann', 14, now() - interval '1 hour', now() + interval '13 days');
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a4', :'ann');
insert into public.challenge_bots (id, challenge_id, name, fitness_level) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a4', 'Reese', 'athletic'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a4', 'Casey', 'casual');
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.rally_setup('00000000-0000-0000-0000-0000000000a4', 1000, 24, '00000000-0000-0000-0000-0000000000b2', array['$$ || :'bob' || $$', '00000000-0000-0000-0000-0000000000b3']::uuid[])$$, 'A bot can be the partner');
reset role;
select is((select status from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a4'), 'waiting', 'Still waiting on Bob');
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a4', :'bob');
select is((select status || ' ' || side_team from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a4'), 'active b', 'Bob joining starts it');

select * from finish();
