-- 0147: Cricket — the ball odds, the toss, only the named players join,
-- an over a day with the batter's steps against the bowler's, the
-- innings swap with a target, the chase stops the moment it's reached,
-- and the winning side is paid.
select plan(27);

-- One ball at level steps (r = 0.5): out 5%, six 7%, four 12%, two 11.4%,
-- dot 30.4%, single the rest.
select is(public.cricket_ball_outcome(0.5, 0.01), 'W', 'Level steps, a low roll: out');
select is(public.cricket_ball_outcome(0.5, 0.06), '6', 'Then a six');
select is(public.cricket_ball_outcome(0.5, 0.15), '4', 'Then a four');
select is(public.cricket_ball_outcome(0.5, 0.30), '2', 'Then a two');
select is(public.cricket_ball_outcome(0.5, 0.50), '0', 'Then a dot');
select is(public.cricket_ball_outcome(0.5, 0.90), '1', 'Otherwise a single');
select is(public.cricket_ball_outcome(0.0, 0.19), 'W', 'Out-walked completely: out one ball in five');
select is(public.cricket_ball_outcome(1.0, 0.03), '6', 'Out-walking the bowler: wickets are rare and sixes common');

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset

-- Two days, one over an innings; both days are over everywhere.
select (now() at time zone 'utc')::date
  - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end as cutoff \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000000e1', 'Ashes', 'cricket', :'ann', 2,
   (:'cutoff'::date - 1)::timestamp at time zone 'utc', (:'cutoff'::date + 1)::timestamp at time zone 'utc', :'cutoff'::date - 1);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000e1', :'ann');

select throws_ok(
  $$insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000e1', '$$ || :'bob' || $$')$$,
  null, null, 'Nobody joins before the sides are set');
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.cricket_setup('00000000-0000-0000-0000-0000000000e1', '[{"id":"$$ || :'bob' || $$","team":"a"},{"id":"$$ || :'ann' || $$","team":"b"}]'::jsonb)$$,
  null, null, 'The creator plays on side A');
select lives_ok($$select public.cricket_setup('00000000-0000-0000-0000-0000000000e1', '[{"id":"$$ || :'ann' || $$","team":"a"},{"id":"$$ || :'bob' || $$","team":"b"}]'::jsonb)$$,
  'Ann against Bob');
select lives_ok($$select public.cricket_add_player('00000000-0000-0000-0000-0000000000e1', '$$ || :'cat' || $$', 'b')$$, 'Cat is added to Bob''s side');
reset role;
select is((select overs from public.cricket_games where challenge_id = '00000000-0000-0000-0000-0000000000e1'), 1, 'Two days: one over an innings');
select is((select batting_first from public.cricket_games where challenge_id = '00000000-0000-0000-0000-0000000000e1'),
  case when public.rally_js_rand(public.rally_js_hash('00000000-0000-0000-0000-0000000000e1:toss')) < 0.5 then 'a' else 'b' end,
  'The toss is seeded');
select is((select seat from public.cricket_players where challenge_id = '00000000-0000-0000-0000-0000000000e1' and user_id = :'cat'), 2, 'Cat bats second for side B');
select throws_ok(
  $$insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000e1', '$$ || :'dan' || $$')$$,
  null, null, 'Someone not named can''t join');
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000000e1', :'bob'), ('00000000-0000-0000-0000-0000000000e1', :'cat');

-- Who's on for the first over.
select tests.sign_in(:'ann');
set local role authenticated;
select is((select batter_id from public.cricket_on_strike('00000000-0000-0000-0000-0000000000e1')),
  (select player_id from public.cricket_players where challenge_id = '00000000-0000-0000-0000-0000000000e1'
     and team = (select batting_first from public.cricket_games where challenge_id = '00000000-0000-0000-0000-0000000000e1') and seat = 1),
  'The first batter of the side batting first is on strike');
reset role;

insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-0000000000e1', :'ann', :'cutoff'::date - 1, 11000),
  ('00000000-0000-0000-0000-0000000000e1', :'bob', :'cutoff'::date - 1, 7000),
  ('00000000-0000-0000-0000-0000000000e1', :'cat', :'cutoff'::date - 1, 9000),
  ('00000000-0000-0000-0000-0000000000e1', :'ann', :'cutoff'::date, 8000),
  ('00000000-0000-0000-0000-0000000000e1', :'bob', :'cutoff'::date, 12000),
  ('00000000-0000-0000-0000-0000000000e1', :'cat', :'cutoff'::date, 6000);

select tests.sign_in(:'dan');
set local role authenticated;
select is(public.cricket_advance('00000000-0000-0000-0000-0000000000e1'), 0, 'Someone outside the match can''t play it');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select is(public.cricket_advance('00000000-0000-0000-0000-0000000000e1'), 2, 'Both days are played');
reset role;

select ok((select innings = 1 and batting_team = (select batting_first from public.cricket_games where challenge_id = '00000000-0000-0000-0000-0000000000e1')
  from public.cricket_days where challenge_id = '00000000-0000-0000-0000-0000000000e1' and day_no = 1), 'Day 1 is the first innings');
select ok((select innings = 2 and batting_team <> (select batting_first from public.cricket_games where challenge_id = '00000000-0000-0000-0000-0000000000e1')
  from public.cricket_days where challenge_id = '00000000-0000-0000-0000-0000000000e1' and day_no = 2), 'Day 2, the other side chases');
select ok((select count(*) between 1 and 6 from public.cricket_balls where challenge_id = '00000000-0000-0000-0000-0000000000e1' and innings = 1),
  'An over is up to six balls');
select ok((select bool_and(p.team <> b.batting_team) from public.cricket_balls b
  join public.cricket_players p on p.challenge_id = b.challenge_id and p.player_id = b.bowler_id
  where b.challenge_id = '00000000-0000-0000-0000-0000000000e1'), 'Every ball is bowled by the fielding side');
select is((select target from public.cricket_games where challenge_id = '00000000-0000-0000-0000-0000000000e1'),
  (select coalesce(sum(runs), 0)::int + 1 from public.cricket_balls where challenge_id = '00000000-0000-0000-0000-0000000000e1' and innings = 1),
  'The target is the first innings plus one');
select ok((select
    case g.result
      when 'chased' then s.runs >= g.target and s.runs - s.last_runs < g.target
      when 'tie' then s.runs = g.target - 1
      else s.runs < g.target - 1
    end
  from public.cricket_games g,
    lateral (select coalesce(sum(runs), 0) as runs,
                    (select b.runs from public.cricket_balls b where b.challenge_id = g.challenge_id and b.innings = 2 order by b.ball_no desc limit 1) as last_runs
             from public.cricket_balls where challenge_id = g.challenge_id and innings = 2) s
  where g.challenge_id = '00000000-0000-0000-0000-0000000000e1' and g.status = 'final'),
  'The result follows the chase, and a chase stops on the winning ball');

select tests.sign_in(:'ann');
set local role authenticated;
select public.settle_challenge_score('00000000-0000-0000-0000-0000000000e1');
reset role;
select is((select count(*)::int from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000e1' and kind = 'cricket_result'), 3, 'All three players are paid');
select ok(exists (select 1 from cron.job where jobname = 'hound-cricket-advance'), 'The morning job is scheduled');

select * from finish();
