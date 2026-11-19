-- 0225: Hound Bout. The numbers, setup and one on one, actions from steps,
-- a punch against the guard (blocked, perfect gets through, a miss, the
-- counter), incoming and the slip, the round scored the morning after
-- with knockdowns and a KO, a draw, the payout, and Admin.
select plan(37);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob', :'cat');
select public.soccer_today(:'ann') as today \gset
select (now() at time zone 'utc')::date
  - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end as cutoff \gset

-- ── The numbers ──

select is(array[public.bout_width('jab', false), public.bout_width('hook', false), public.bout_width('up', false), public.bout_width('jab', true)],
  array[14, 9, 5, 18.2]::numeric[], 'The green: jab widest, uppercut narrowest, wider on a fight camp day');
select is(array[public.bout_quality(50, 5), public.bout_quality(53, 5), public.bout_quality(56, 5)], array['perfect', 'clean', 'miss'],
  'Perfect, clean, a miss');
select is(array[public.bout_blocks('high', 'hook', 'clean'), public.bout_blocks('high', 'up', 'clean'), public.bout_blocks('body', 'up', 'clean'),
                public.bout_blocks('counter', 'jab', 'clean'), public.bout_blocks('high', 'hook', 'perfect')],
  array[true, false, true, true, false], 'High stops hooks, body stops uppercuts, counter catches jabs; perfect beats them all');
select is(public.bout_slip_width('jab', false) < public.bout_slip_width('up', false), true, 'Jabs are the hardest to slip');

-- ── A fight starting today ──

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000b0001', 'Garage Gym', 'bout', :'ann', 3,
   (:'today'::date)::timestamp at time zone 'America/New_York', (:'today'::date + 3)::timestamp at time zone 'America/New_York', :'today'::date);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000b0001', :'ann');

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.bout_setup('00000000-0000-0000-0000-0000000b0001', 3)$$, 'Only whoever made this fight can set it up.', 'Only the creator sets it up');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.bout_setup('00000000-0000-0000-0000-0000000b0001', 4)$$, 'A Hound Bout is 3, 5 or 7 rounds.', '3, 5 or 7 rounds');
select throws_ok($$select public.bout_setup('00000000-0000-0000-0000-0000000b0001', 5)$$,
  'A round a day: the fight runs as many days as it has rounds.', 'A round a day');
select lives_ok($$select public.bout_setup('00000000-0000-0000-0000-0000000b0001', 3)$$, 'Ann sets up three rounds');
select is(public.bout_live('00000000-0000-0000-0000-0000000b0001') ->> 'reason', 'Waiting for your opponent to join.', 'Nothing until Bob joins');
reset role;

insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000b0001', :'bob');
select throws_ok($$insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000b0001', '$$ || :'cat' || $$')$$,
  'A Hound Bout is one on one.', 'A third can''t join');

insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-0000000b0001', :'ann', :'today', 5000), ('00000000-0000-0000-0000-0000000b0001', :'bob', :'today', 3000);

select tests.sign_in(:'bob');
set local role authenticated;
select is(public.bout_set_guard('00000000-0000-0000-0000-0000000b0001', 'high'), 'high', 'Bob puts a high guard up');
select throws_ok($$select public.bout_set_guard('00000000-0000-0000-0000-0000000b0001', 'low')$$, 'Pick a high guard, a body guard or counter.', 'Three guards');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.bout_live('00000000-0000-0000-0000-0000000b0001') -> 'day' ->> 'left')::int, 5, '5,000 steps: five actions');
select is(public.bout_throw('00000000-0000-0000-0000-0000000b0001', 'hook', 55) - array['id', 'run', 'downs', 'kd_needs', 'left', 'message'],
  '{"punch":"hook","quality":"clean","blocked":true,"countered":false,"points":0,"guard":"high"}'::jsonb, 'A clean hook into a high guard: blocked');
select is(public.bout_throw('00000000-0000-0000-0000-0000000b0001', 'up', 50) - array['id', 'message', 'left', 'guard'],
  '{"punch":"up","quality":"perfect","blocked":false,"countered":false,"points":3,"run":1,"downs":0,"kd_needs":3}'::jsonb,
  'A perfect uppercut gets through: 3, one of three to a knockdown');
select is(public.bout_throw('00000000-0000-0000-0000-0000000b0001', 'jab', 80) ->> 'quality', 'miss', 'Late: a miss');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is(jsonb_array_length(public.bout_live('00000000-0000-0000-0000-0000000b0001') -> 'incoming'), 1, 'Only what got through waits for Bob');
select bout_id from (select (public.bout_live('00000000-0000-0000-0000-0000000b0001') -> 'incoming' -> 0 ->> 'id')::bigint as bout_id) z \gset
select is(public.bout_slip('00000000-0000-0000-0000-0000000b0001', :bout_id, 50) ->> 'slip', 'slipped', 'Bob slips it in the green');
select throws_ok(format($q$select public.bout_slip('00000000-0000-0000-0000-0000000b0001', %s, 50)$q$, :bout_id),
  'That one''s already dealt with.', 'Once');
select is((public.bout_live('00000000-0000-0000-0000-0000000b0001') -> 'day' ->> 'left')::int, 2, 'A slip costs Bob one of his three actions');
select public.bout_set_guard('00000000-0000-0000-0000-0000000b0001', 'counter');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.bout_throw('00000000-0000-0000-0000-0000000b0001', 'jab', 55) ->> 'countered', 'true', 'A clean jab into a counter guard: caught, and Bob hits back');
select is(public.bout_live('00000000-0000-0000-0000-0000000b0001') -> 'tally', '{"mine": 0, "theirs": 1}'::jsonb, 'So far today: 0–1');
select is((public.bout_live('00000000-0000-0000-0000-0000000b0001') ->> 'run')::int, 0, 'The slip broke Ann''s run');
select public.bout_throw('00000000-0000-0000-0000-0000000b0001', 'hook', 50);
select throws_ok($$select public.bout_throw('00000000-0000-0000-0000-0000000b0001', 'jab', 50)$$,
  'No actions ready: your next comes at 6,000 steps.', 'Five actions used');
reset role;

-- ── A fight already fought: knockdowns, then a KO ──

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000b0002', 'Title Night', 'bout', :'ann', 3,
   (:'cutoff'::date - 2)::timestamp at time zone 'utc', (:'cutoff'::date + 1)::timestamp at time zone 'utc', :'cutoff'::date - 2);
insert into public.bout_games (challenge_id, rounds) values ('00000000-0000-0000-0000-0000000b0002', 3);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000b0002', :'ann'), ('00000000-0000-0000-0000-0000000b0002', :'bob');
-- Round 1: Ann lands three uppercuts in a row (a knockdown) and a jab;
-- Bob lands a jab. Round 2: Ann lands nine uppercuts: three knockdowns.
insert into public.bout_punches (challenge_id, user_id, target, day, round, punch, pos, quality, guard, points)
select '00000000-0000-0000-0000-0000000b0002', :'ann', :'bob', :'cutoff'::date - 2, 1, x.p, 50, 'clean', 'high', public.bout_points(x.p)
from unnest(array['up', 'up', 'up', 'jab']) with ordinality x(p, o) order by o;
insert into public.bout_punches (challenge_id, user_id, target, day, round, punch, pos, quality, guard, points)
  values ('00000000-0000-0000-0000-0000000b0002', :'bob', :'ann', :'cutoff'::date - 2, 1, 'jab', 50, 'clean', 'high', 1);
insert into public.bout_punches (challenge_id, user_id, target, day, round, punch, pos, quality, guard, points)
select '00000000-0000-0000-0000-0000000b0002', :'ann', :'bob', :'cutoff'::date - 1, 2, 'up', 50, 'clean', 'high', 3 from generate_series(1, 9);

select tests.sign_in(:'bob');
set local role authenticated;
select is(public.bout_advance('00000000-0000-0000-0000-0000000b0002'), 2, 'Two rounds scored, then it''s over');
select is(jsonb_array_length(public.bout_replay('00000000-0000-0000-0000-0000000b0002', 1) -> 'punches'), 5, 'Round 1''s replay has every punch');
select throws_ok($$select public.bout_replay('00000000-0000-0000-0000-0000000b0002', 3)$$, 'That round hasn''t been scored yet.', 'Only scored rounds');
reset role;
select is((select array[a_points, b_points, a_down, b_down, a_score, b_score] from public.bout_rounds
           where challenge_id = '00000000-0000-0000-0000-0000000b0002' and round = 1),
  array[10, 1, 0, 1, 10, 8], 'Round 1: Ann 10 points to 1 and a knockdown: 10-8');
select is((select b_down from public.bout_rounds where challenge_id = '00000000-0000-0000-0000-0000000b0002' and round = 2), 3, 'Round 2: three knockdowns');
select is((select array[status, method, ko_round::text, (winner = :'ann')::text] from public.bout_games where challenge_id = '00000000-0000-0000-0000-0000000b0002'),
  array['final', 'ko', '2', 'true'], 'Ann wins by KO in round 2');
select is((select count(*)::int from public.bout_punches where challenge_id = '00000000-0000-0000-0000-0000000b0002' and knockdown), 4, 'Four knockdowns marked for the replay');

-- The payout, once the challenge is over.
update public.challenges set ends_at = now() - interval '1 hour' where id = '00000000-0000-0000-0000-0000000b0002';
select public.settle_challenge_score('00000000-0000-0000-0000-0000000b0002');
select is((select score_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000b0002' and user_id = :'ann' and kind = 'bout_result'),
  35, 'The winner scores like any 1 on 1 winner');
select ok((select bones_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000b0002' and user_id = :'ann' and kind = 'bout_result')
          > (select bones_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000b0002' and user_id = :'bob' and kind = 'bout_result'),
  'and gets the win Bones');

-- ── Nobody threw a punch: a draw ──

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000b0003', 'Quiet Night', 'bout', :'ann', 3,
   (:'cutoff'::date - 2)::timestamp at time zone 'utc', (:'cutoff'::date + 1)::timestamp at time zone 'utc', :'cutoff'::date - 2);
insert into public.bout_games (challenge_id, rounds) values ('00000000-0000-0000-0000-0000000b0003', 3);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000b0003', :'ann'), ('00000000-0000-0000-0000-0000000b0003', :'bob');
select public.bout_advance('00000000-0000-0000-0000-0000000b0003');
select is((select array[status, method] from public.bout_games where challenge_id = '00000000-0000-0000-0000-0000000b0003'), array['final', 'draw'],
  'Three even rounds: a draw');

-- ── Admin ──

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.admin_bout_overview()$q$, 'not authorized', 'Admins only');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select ok((public.admin_bout_overview() ->> 'knockdowns_all')::int >= 4, 'Admin sees the knockdowns');
select is(public.admin_bout_overview() -> 'by_method' ->> 'ko', '1', 'and how fights end');
reset role;

select * from finish();
