-- 0139: Rally — singles and doubles. The shuttle crosses on returned
-- steps, a missed deadline scores, games to 21 and the match on two
-- games, a smash doubles both returns, nights don't count, partners
-- alternate in doubles, only the named players can join, and the winning
-- team is paid.
select plan(56);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
select tests.new_user('Eve') as eve \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob');

-- rally_due: waking hours only.
select is(public.rally_due('2026-11-02 20:00:00-05'::timestamptz, 2, 'America/New_York'),
  '2026-11-03 08:00:00-05'::timestamptz, 'Two hours from 8pm run out at 8am the next morning');
select is(public.rally_due('2026-11-02 10:00:00-05'::timestamptz, 4, 'America/New_York'),
  '2026-11-02 14:00:00-05'::timestamptz, 'Four hours from 10am is 2pm');
select is(public.rally_due('2026-11-02 10:00:00-05'::timestamptz, 24, 'America/New_York'),
  '2026-11-02 21:00:00-05'::timestamptz, 'The rest of the day ends at 9pm');
select is(public.rally_due('2026-11-02 19:30:00-05'::timestamptz, 24, 'America/New_York'),
  '2026-11-03 21:00:00-05'::timestamptz, 'A shuttle that lands after 7pm is due by 9pm tomorrow');
select is(public.rally_due('2026-11-02 23:00:00-05'::timestamptz, 8, 'America/New_York'),
  '2026-11-03 15:00:00-05'::timestamptz, 'Eight hours from overnight start at 7am');
select is(public.rally_next_target(1000), 1150, 'The next target is 15% more');
select is(public.rally_next_target(1150), 1350, 'Rounded up to a round 50');

-- Singles: Ann against Bob.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'Shuttle run', 'rally', :'ann', 14, now() - interval '1 hour', now() + interval '13 days');
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a1', :'ann');
select throws_ok(
  $$insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a1', '$$ || :'cat' || $$')$$,
  null, null, 'Nobody joins before the teams are set');

select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.rally_setup('00000000-0000-0000-0000-0000000000a1', 1000, 4, null, array['$$ || :'bob' || $$']::uuid[])$$, 'The creator sets the serve, window and opponent');
select throws_ok($$select public.rally_setup('00000000-0000-0000-0000-0000000000a1', 100, 4, null, array['$$ || :'bob' || $$']::uuid[])$$, null, null, 'A 100-step serve is refused');
select throws_ok($$select public.rally_setup('00000000-0000-0000-0000-0000000000a1', 1000, 4, null, array['$$ || :'bob' || $$', '$$ || :'cat' || $$']::uuid[])$$, null, null, 'Singles takes one opponent');
reset role;
select is((select status from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 'waiting', 'Waiting for the opponent');
select is((select joined from public.rally_players where challenge_id = '00000000-0000-0000-0000-0000000000a1' and user_id = :'ann'), true, 'The creator is already in');
select throws_ok(
  $$insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a1', '$$ || :'cat' || $$')$$,
  null, null, 'Someone not named can''t join');

-- Bob joins: the match starts with the shuttle on his side.
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a1', :'bob');
select is((select status from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 'active', 'The opponent joining starts the match');
select is((select side_user_id from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), :'bob', 'The creator serves, so the shuttle is on the opponent''s side');
select is((select target_steps from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 1000, 'The first return needs the serve');
select ok((select due_at > now() from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 'The return has a deadline ahead');

-- Bob returns once his synced steps grow by the target.
select tests.sign_in(:'bob');
set local role authenticated;
select is(public.rally_check_shot('00000000-0000-0000-0000-0000000000a1'), 'short', 'No steps yet: short');
select throws_ok('update public.rally_games set points_b = 21', '42501', null, 'Nobody writes the game directly');
select is((select count(*)::int from public.rally_players where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 2, 'Players see the line-up');
reset role;
select tests.sign_in(:'dan');
set local role authenticated;
select is((select count(*)::int from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'Someone outside the match sees nothing');
reset role;
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values ('00000000-0000-0000-0000-0000000000a1', :'bob', current_date, 1200);
select tests.sign_in(:'bob');
set local role authenticated;
select is(public.rally_check_shot('00000000-0000-0000-0000-0000000000a1'), 'returned', '1,200 steps return a 1,000 serve');
reset role;
select is((select side_user_id from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), :'ann', 'The shuttle crosses to Ann');
select is((select target_steps from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 1150, 'Her return needs 15% more');
select is((select shot_no from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 1, 'One shot in the rally');

-- Ann arms a smash: her return now needs double, and Bob's next doubles.
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.rally_arm_smash('00000000-0000-0000-0000-0000000000a1')$$, 'Ann arms her smash');
select throws_ok($$select public.rally_arm_smash('00000000-0000-0000-0000-0000000000a1')$$, null, null, 'It can''t be armed twice');
reset role;
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values ('00000000-0000-0000-0000-0000000000a1', :'ann', current_date, 1500);
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.rally_check_shot('00000000-0000-0000-0000-0000000000a1'), 'short', '1,500 doesn''t cover a 2,300 smash');
reset role;
update public.progress_snapshots set steps = 2300 where challenge_id = '00000000-0000-0000-0000-0000000000a1' and user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.rally_check_shot('00000000-0000-0000-0000-0000000000a1'), 'smashed', '2,300 lands the smash');
reset role;
select is((select target_steps from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 2700, 'Bob''s return is doubled: 1,350 x 2');
select is((select smash_a_left from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'Team A''s smash is used for this game');
select is((select count(*)::int from public.rally_events where challenge_id = '00000000-0000-0000-0000-0000000000a1' and kind in ('return', 'smash')), 2, 'Both shots are logged');

-- Bob misses: the deadline passes, Ann scores, and Bob receives the serve.
update public.rally_games set due_at = now() - interval '1 minute' where challenge_id = '00000000-0000-0000-0000-0000000000a1';
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.rally_settle('00000000-0000-0000-0000-0000000000a1')$$, 'Anyone in the match can settle it');
reset role;
select is((select points_a from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 1, 'A missed return is a point to Ann');
select is((select side_user_id from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), :'bob', 'The point loser receives the next serve');
select is((select target_steps from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 1000, 'Back to the serve');

-- Game point: 20–0 and another miss ends the game; smashes come back.
update public.rally_games set points_a = 20, due_at = now() - interval '1 minute' where challenge_id = '00000000-0000-0000-0000-0000000000a1';
select public.rally_settle('00000000-0000-0000-0000-0000000000a1');
select is((select games_a || '-' || games_b || ' ' || points_a || '-' || points_b || ' g' || game_no from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'),
  '1-0 0-0 g2', 'The game goes to Ann and game 2 starts level');
select is((select smash_a_left from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 1, 'A new game brings the smash back');

-- 20–20 needs two clear; 29–29 ends at 30.
update public.rally_games set points_a = 20, points_b = 20, due_at = now() - interval '1 minute' where challenge_id = '00000000-0000-0000-0000-0000000000a1';
select public.rally_settle('00000000-0000-0000-0000-0000000000a1');
select is((select points_a || '-' || points_b from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), '21-20', '21–20 isn''t a game yet');

-- Match: a second game to Ann ends it, the challenge closes, and scoring pays the winner.
update public.rally_games set points_a = 29, points_b = 29, side_team = 'b', side_user_id = :'bob', due_at = now() - interval '1 minute' where challenge_id = '00000000-0000-0000-0000-0000000000a1';
select public.rally_settle('00000000-0000-0000-0000-0000000000a1');
select is((select status || ' ' || games_a || '-' || games_b from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 'won 2-0', 'Two games win the match');
select is((select winner_team from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 'a', 'Ann''s team wins');
select ok((select ends_at <= now() from public.challenges where id = '00000000-0000-0000-0000-0000000000a1'), 'The challenge ends with the match');

select tests.sign_in(:'bob');
set local role authenticated;
select public.settle_challenge_score('00000000-0000-0000-0000-0000000000a1');
reset role;
select is((select score_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000a1' and user_id = :'ann'), 35, 'The winner scores like a Tic-Tac-Go winner');
select is((select score_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000a1' and user_id = :'bob'), 5, 'The loser gets the trickle');

-- Doubles: Ann and Cat against Dan and Eve. Partners alternate returns.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000000a2', 'Mixed doubles', 'rally', :'ann', 14, now() - interval '1 hour', now() + interval '13 days');
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a2', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.rally_setup('00000000-0000-0000-0000-0000000000a2', 1000, 24, '$$ || :'cat' || $$', array['$$ || :'dan' || $$']::uuid[])$$, null, null, 'Doubles takes two opponents');
select throws_ok($$select public.rally_setup('00000000-0000-0000-0000-0000000000a2', 1000, 24, '$$ || :'cat' || $$', array['$$ || :'dan' || $$', '$$ || :'cat' || $$']::uuid[])$$, null, null, 'Nobody plays on both teams');
select lives_ok($$select public.rally_setup('00000000-0000-0000-0000-0000000000a2', 1000, 24, '$$ || :'cat' || $$', array['$$ || :'dan' || $$', '$$ || :'eve' || $$']::uuid[])$$, 'Ann names a partner and two opponents');
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a2', :'dan'), ('00000000-0000-0000-0000-0000000000a2', :'cat');
select is((select status from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a2'), 'waiting', 'Three of four in: still waiting');
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a2', :'eve');
select is((select status || ' ' || side_team from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a2'), 'active b', 'The fourth player starts it, shuttle on team B');
select is((select side_user_id from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a2'), :'dan', 'Seat 1 returns first');
select throws_ok(
  $$insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a2', '$$ || :'bob' || $$')$$,
  null, null, 'A fifth player is refused');
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values ('00000000-0000-0000-0000-0000000000a2', :'dan', current_date, 1000);
select tests.sign_in(:'dan');
set local role authenticated;
select is(public.rally_check_shot('00000000-0000-0000-0000-0000000000a2'), 'returned', 'Dan returns the serve');
reset role;
select is((select side_user_id from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a2'), :'ann', 'Ann, seat 1 of team A, returns next');
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values ('00000000-0000-0000-0000-0000000000a2', :'ann', current_date, 1150);
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.rally_check_shot('00000000-0000-0000-0000-0000000000a2'), 'returned', 'Ann returns');
reset role;
select is((select side_user_id from public.rally_games where challenge_id = '00000000-0000-0000-0000-0000000000a2'), :'eve', 'Eve takes team B''s next return, not Dan again');

select * from finish();
