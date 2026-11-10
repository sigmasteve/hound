-- 0167: Baseball. The odds, setup (positions in batting order, the
-- seeded home side, only the named players join), the picks and who may
-- make them, an inning a day from the steps, the line score, the game
-- ending, the winners paid, and the admin overview.
select plan(41);

-- The odds at level steps, and the picks' effect.
select is(round(public.baseball_strikeout_chance(5000, 5000, null)::numeric, 4), 0.2200, 'Level steps: a 22% strikeout');
select is(round(public.baseball_strikeout_chance(5000, 5000, 'power')::numeric, 4), 0.2600, 'Power adds 4 points of strikeouts');
select is(round(public.baseball_walk_chance(5000, 5000, 'finesse')::numeric, 4), 0.1100, 'Finesse adds 3 points of walks');
select is(public.baseball_home_run_chance(7999, null), 0::double precision, 'No home runs under 8,000 steps');
select is(round(public.baseball_home_run_chance(12000, 'power')::numeric, 4), 0.0750, '6% from 12,000, a quarter more with Power');
select is(public.baseball_hit_length(3000, null, 0.01), 1, 'Under 4,000 steps, only singles');
select is(public.baseball_hit_length(9000, null, 0.02), 3, '8,000 and up, a low roll is a triple');
select is(public.baseball_hit_length(9000, null, 0.20), 2, 'then a double');
select is(round(public.baseball_catch_chance(5000, 5000, 'left', null)::numeric, 4), 0.6700, 'Level steps: caught 67% of the time');
select is(round(public.baseball_catch_chance(5000, 5000, 'left', 'left')::numeric, 4), 0.8710, 'The right shift: 1.3 times');
select is(round(public.baseball_catch_chance(5000, 5000, 'left', 'right')::numeric, 4), 0.5695, 'The wrong shift: 0.85 times');
select is(round(public.baseball_tag_chance(5000, 5000)::numeric, 4), 0.1600, 'Level steps: tagged at home 16% of the time');
select is(round(public.baseball_steal_chance(5000, 5000)::numeric, 4), 0.6800, 'and safe stealing 68%');
select is(round(public.baseball_double_play_chance(5000, 5000)::numeric, 4), 0.3500, 'and a double play 35%');

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset

-- Three innings, all over everywhere.
select (now() at time zone 'utc')::date
  - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end as cutoff \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000000b1', 'Opening Day', 'baseball', :'ann', 3,
   (:'cutoff'::date - 2)::timestamp at time zone 'utc', (:'cutoff'::date + 1)::timestamp at time zone 'utc', :'cutoff'::date - 2),
  ('00000000-0000-0000-0000-0000000000b2', 'Too long', 'baseball', :'ann', 4,
   (:'cutoff'::date - 2)::timestamp at time zone 'utc', (:'cutoff'::date + 2)::timestamp at time zone 'utc', :'cutoff'::date - 2);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000b1', :'ann');

select throws_ok(
  $$insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000b1', '$$ || :'bob' || $$')$$,
  null, null, 'Nobody joins before the sides are set');
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.baseball_setup('00000000-0000-0000-0000-0000000000b2', '[{"id":"$$ || :'ann' || $$","team":"a"},{"id":"$$ || :'bob' || $$","team":"b"}]'::jsonb)$$,
  'A game is 3, 5, 7 or 9 innings, one a day.', 'An odd number of innings, 3 to 9');
select throws_ok($$select public.baseball_setup('00000000-0000-0000-0000-0000000000b1', '[{"id":"$$ || :'bob' || $$","team":"a"},{"id":"$$ || :'ann' || $$","team":"b"}]'::jsonb)$$,
  'You play on your own side.', 'The creator plays on side A');
select lives_ok($$select public.baseball_setup('00000000-0000-0000-0000-0000000000b1', '[{"id":"$$ || :'ann' || $$","team":"a"},{"id":"$$ || :'bob' || $$","team":"b"},{"id":"$$ || :'cat' || $$","team":"b"}]'::jsonb)$$,
  'Ann against Bob and Cat');
reset role;

select is((select positions from public.baseball_players where challenge_id = '00000000-0000-0000-0000-0000000000b1' and user_id = :'ann'),
  array['p', 'c', 'ss', 'cf', '2b', '3b', 'lf', '1b', 'rf'], 'A side of one plays every position');
select is((select positions from public.baseball_players where challenge_id = '00000000-0000-0000-0000-0000000000b1' and user_id = :'bob'),
  array['p', 'ss', '2b', 'lf', 'rf'], 'On a side of two, the first pitches');
select is((select positions from public.baseball_players where challenge_id = '00000000-0000-0000-0000-0000000000b1' and user_id = :'cat'),
  array['c', 'cf', '3b', '1b'], 'and the second catches');
select is((select home_team from public.baseball_games where challenge_id = '00000000-0000-0000-0000-0000000000b1'),
  case when public.rally_js_rand(public.rally_js_hash('00000000-0000-0000-0000-0000000000b1:toss')) < 0.5 then 'a' else 'b' end,
  'The home side is a seeded toss');
select throws_ok(
  $$insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000b1', '$$ || :'dan' || $$')$$,
  null, null, 'Someone not named can''t join');
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000000b1', :'bob'), ('00000000-0000-0000-0000-0000000000b1', :'cat');

-- Today's picks: anyone aims, the catcher shifts, the pitcher picks how.
select tests.sign_in(:'cat');
set local role authenticated;
select lives_ok($$select public.baseball_set_pick('00000000-0000-0000-0000-0000000000b1', 'shift', 'left')$$, 'The catcher calls the shift');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.baseball_set_pick('00000000-0000-0000-0000-0000000000b1', 'shift', 'left')$$, 'The catcher calls the shift.', 'Nobody else does');
select throws_ok($$select public.baseball_set_pick('00000000-0000-0000-0000-0000000000b1', 'aim', 'up')$$, 'Aim left, center or right.', 'Three zones to aim at');
select lives_ok($$select public.baseball_set_pick('00000000-0000-0000-0000-0000000000b1', 'approach', 'power')$$, 'The pitcher picks Power');
select is((select count(*)::int from public.baseball_picks where challenge_id = '00000000-0000-0000-0000-0000000000b1' and player_id = :'cat'), 1,
  'A teammate''s pick is visible to their side');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select is((select count(*)::int from public.baseball_picks where challenge_id = '00000000-0000-0000-0000-0000000000b1' and player_id <> :'ann'), 0,
  'The other side''s picks stay hidden until the day''s played');
reset role;

-- Ann walks big every day; Bob and Cat barely walk. The rolls are seeded
-- by the game and the day, so the innings are played on a fixed week in
-- the past: with dates that moved with the calendar, some days' rolls
-- gave a 0-0 tie (extra innings, no winner) and failed this test. The
-- picks above needed today to be a game day; they're cleared, so every
-- pick is the automatic one.
select '2026-03-10'::date as cutoff \gset
update public.challenges set
  starts_at = (:'cutoff'::date - 2)::timestamp at time zone 'utc',
  ends_at = (:'cutoff'::date + 1)::timestamp at time zone 'utc',
  start_day = :'cutoff'::date - 2
where id = '00000000-0000-0000-0000-0000000000b1';
delete from public.baseball_picks where challenge_id = '00000000-0000-0000-0000-0000000000b1';
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
  select '00000000-0000-0000-0000-0000000000b1', u, :'cutoff'::date - g, s
  from (values (:'ann'::uuid, 40000), (:'bob'::uuid, 1000), (:'cat'::uuid, 1000)) v(u, s), generate_series(0, 2) g;

select tests.sign_in(:'dan');
set local role authenticated;
select is(public.baseball_advance('00000000-0000-0000-0000-0000000000b1'), 0, 'Someone outside the game can''t play it');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select is(public.baseball_advance('00000000-0000-0000-0000-0000000000b1'), 3, 'All three days are played');
reset role;

select ok((select count(*) between 2 and 3 from public.baseball_innings where challenge_id = '00000000-0000-0000-0000-0000000000b1'), 'An inning a day');
select ok((select bool_and(pp.team <> bp.batting_team) from public.baseball_plays bp
  join public.baseball_players pp on pp.challenge_id = bp.challenge_id and pp.player_id = bp.pitcher_id
  where bp.challenge_id = '00000000-0000-0000-0000-0000000000b1'), 'Every pitch comes from the fielding side');
select ok((select max(outs) <= 3 from public.baseball_plays where challenge_id = '00000000-0000-0000-0000-0000000000b1'), 'Never more than three outs');
select is((select runs_a + runs_b from public.baseball_games where challenge_id = '00000000-0000-0000-0000-0000000000b1'),
  (select (sum(away_runs) + coalesce(sum(home_runs), 0))::int from public.baseball_innings where challenge_id = '00000000-0000-0000-0000-0000000000b1'),
  'The line score adds up to the score');
select is((select (sum(away_runs) + coalesce(sum(home_runs), 0))::int from public.baseball_innings where challenge_id = '00000000-0000-0000-0000-0000000000b1'),
  (select sum(runs)::int from public.baseball_plays where challenge_id = '00000000-0000-0000-0000-0000000000b1'),
  'and every run is in the plays');
select ok((select status = 'final' and winner_team = 'a' from public.baseball_games where challenge_id = '00000000-0000-0000-0000-0000000000b1'),
  'Out-walked 40 to 1, Ann''s side wins');

select public.settle_challenge_score('00000000-0000-0000-0000-0000000000b1');
select is((select score_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000b1' and user_id = :'ann' and kind = 'baseball_result'),
  35, 'The winner is paid like a Soccer win');
select ok(exists (select 1 from public.yard_trophies(:'ann') t where t.kind = 'baseball'), 'and gets a Baseball trophy for the yard');

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.admin_baseball_overview() ->> 'finished')::int, 1, 'The admin sees the finished game');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$ select public.admin_baseball_overview() $$, 'not authorized', 'Members can''t see the overview');
reset role;

select * from finish();
