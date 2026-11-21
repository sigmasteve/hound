-- 0234: Cricket, bat and bowl yourself. The shot and delivery tables, the
-- creator's switch, who bats and who bowls today, balls from steps, a
-- ball bowled to you and your shot, your own deliveries, the cap, the
-- over using them (the batter's first, then the bowler's), and Admin.
select plan(31);

-- ── The shot ──
select is(public.cricket_shot_outcome('good', 0, 0, null, null, 0.5, 1, 0.5, 0.5) ->> 'how', 'bowled', 'Left one on the stumps: bowled');
select is(public.cricket_shot_outcome('good', -0.5, 0, null, null, 0.5, 1, 0.5, 0.5) ->> 'how', 'left', 'Left one outside: a good leave');
select is(public.cricket_shot_outcome('good', -0.5, 0, -300, 0, 0.5, 1, 0.5, 0.5) ->> 'how', 'beaten', 'Way early outside: beaten');
select is(public.cricket_shot_outcome('good', -0.5, 0, 0, 1.2, 0.5, 1, 0.1, 0.5) ->> 'how', 'caught_behind', 'Off the edge of the bat: caught behind (45%)');
select is(public.cricket_shot_outcome('good', -0.5, 0, 0, 1.2, 0.5, 1, 0.9, 0.5) ->> 'outcome', '1', 'or a single');
select is(public.cricket_shot_outcome('short', 0, 0, 0, 0, 0.5, 1, 0.5, 0.5) ->> 'outcome', '6', 'Middled, on time, a short one: six');
select is(public.cricket_shot_outcome('good', 0, 0, 0, 0, 0.5, 1, 0.5, 0.5) ->> 'outcome', '4', 'a good length: four');
select is(public.cricket_shot_outcome('yorker', 0, 0, 0, 0, 0.5, 1, 0.5, 0.5) ->> 'outcome', '4', 'a yorker: harder (x 0.6), still four');
select is(public.cricket_shot_outcome('good', 0, 0, 40, 0.4, 0.5, 1, 0.5, 0.5) ->> 'outcome', '2', 'A bit late and off: two');
select is(public.cricket_shot_outcome('good', 0, 0, -50, 0.1, 0.5, 1, 0.5, 0.5) ->> 'how', 'flicked', 'Early goes to the leg side');

-- ── The delivery ──
select is(public.cricket_delivery_outcome('yorker', 0, 0.05, 0, 0.5, false, 0.01) ->> 'how', 'bowled', 'A yorker on the stumps can bowl them');
select is(public.cricket_delivery_outcome('pace', 0, 0.3, 0, 0.5, false, 0.01) ->> 'outcome', '0', 'A good length on the stumps: mostly dots');
select is(public.cricket_delivery_outcome('pace', 0, 0.5, 0, 0.5, false, 0.85) ->> 'outcome', '6', 'Short: it can go for six');
select is(public.cricket_delivery_outcome('pace', 0, 0.3, 0, 0.5, false, 0.5) ->> 'length', 'good', 'and it says the length');

-- ── A match ──
select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob');
select public.soccer_today(:'ann') as today \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000c2e01', 'Ashes', 'cricket', :'ann', 4,
   (:'today'::date)::timestamp at time zone 'America/New_York', (:'today'::date + 4)::timestamp at time zone 'America/New_York', :'today'::date);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000c2e01', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.cricket_setup('00000000-0000-0000-0000-0000000c2e01', ('[{"id":"' || :'ann' || '","team":"a"},{"id":"' || :'bob' || '","team":"b"}]')::jsonb);
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000c2e01', :'bob');
select is((select hands_on from public.cricket_games where challenge_id = '00000000-0000-0000-0000-0000000c2e01'), false, 'Off by default');
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.cricket_set_hands_on('00000000-0000-0000-0000-0000000c2e01', true)$$, 'Only the creator can change this match.', 'Only the creator switches it on');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select public.cricket_set_hands_on('00000000-0000-0000-0000-0000000c2e01', true);
reset role;

-- Who bats and who bowls today.
select case when batting_first = 'a' then :'ann' else :'bob' end as batter, case when batting_first = 'a' then :'bob' else :'ann' end as bowler
  from public.cricket_games where challenge_id = '00000000-0000-0000-0000-0000000c2e01' \gset
select tests.sign_in(:'batter');
set local role authenticated;
select is((select jsonb_build_object('role', h -> 'role', 'reason', h -> 'reason') from public.cricket_hand('00000000-0000-0000-0000-0000000c2e01') h),
  jsonb_build_object('role', 'bat', 'reason', 'No balls ready: your next one comes at 1,000 steps.'), 'The batting side bats; no steps, no balls');
reset role;
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
values ('00000000-0000-0000-0000-0000000c2e01', :'ann', :'today', 3500), ('00000000-0000-0000-0000-0000000c2e01', :'bob', :'today', 3500);

select tests.sign_in(:'batter');
set local role authenticated;
select is((select jsonb_build_object('can', h -> 'can_play', 'ready', h -> 'ready', 'opp', h -> 'opponent' -> 'steps') from public.cricket_hand('00000000-0000-0000-0000-0000000c2e01') h),
  jsonb_build_object('can', true, 'ready', 3, 'opp', 3500), '3,500 steps: three balls, against the bowler''s 3,500');
select public.cricket_bowl_to_me('00000000-0000-0000-0000-0000000c2e01') as d1 \gset
select is(public.cricket_bowl_to_me('00000000-0000-0000-0000-0000000c2e01'), :'d1'::jsonb, 'Asking again: the same ball');
select throws_ok($$select public.cricket_bowl('00000000-0000-0000-0000-0000000c2e01', 'pace', 0, 0.3, 0)$$, 'You''re batting today: play your shots.', 'The batter can''t bowl');
select ok(public.cricket_play_shot('00000000-0000-0000-0000-0000000c2e01', 0, 0) ->> 'outcome' in ('0', '1', '2', '4', '6', 'W'), 'A shot');
select throws_ok($$select public.cricket_play_shot('00000000-0000-0000-0000-0000000c2e01', 0, 0)$$, 'Bowl it first.', 'One shot a ball');
select public.cricket_bowl_to_me('00000000-0000-0000-0000-0000000c2e01');
select public.cricket_play_shot('00000000-0000-0000-0000-0000000c2e01', 20, 0.2);
select public.cricket_bowl_to_me('00000000-0000-0000-0000-0000000c2e01');
select public.cricket_play_shot('00000000-0000-0000-0000-0000000c2e01', null, null);
select is(public.cricket_hand('00000000-0000-0000-0000-0000000c2e01') ->> 'reason', 'No balls ready: your next one comes at 4,000 steps.', 'Three balls, then wait for more steps');
reset role;

select tests.sign_in(:'bowler');
set local role authenticated;
select is(public.cricket_hand('00000000-0000-0000-0000-0000000c2e01') ->> 'role', 'bowl', 'Today''s bowler bowls');
select throws_ok($$select public.cricket_bowl('00000000-0000-0000-0000-0000000c2e01', 'googly', 0, 0.3, 0)$$, 'Pick a ball: pace, spin or a yorker.', 'Three balls to pick from');
select is((select jsonb_build_object('grade', b -> 'grade', 'line', b -> 'line', 'bounce', b -> 'bounce') from public.cricket_bowl('00000000-0000-0000-0000-0000000c2e01', 'pace', 0.1, 0.3, 0) b),
  jsonb_build_object('grade', 'Right on your spot', 'line', 0.1, 'bounce', 0.3), 'On the ring: right on your spot');
select public.cricket_bowl('00000000-0000-0000-0000-0000000c2e01', 'spin', -0.4, 0.3, 0.5);
select public.cricket_bowl('00000000-0000-0000-0000-0000000c2e01', 'yorker', 0, 0.05, 0.1);
select is((public.cricket_hand('00000000-0000-0000-0000-0000000c2e01') ->> 'ready')::int, 0, 'Three bowled');
reset role;

-- Tonight: the batter's three first, then the bowler's.
select public.cricket_play_day('00000000-0000-0000-0000-0000000c2e01', :'today', 1, :'today');
select is((select by_hand || ':' || outcome from public.cricket_balls where challenge_id = '00000000-0000-0000-0000-0000000c2e01' and ball_no = 1),
  (select 'bat:' || outcome from public.cricket_hand_balls where challenge_id = '00000000-0000-0000-0000-0000000c2e01' and role = 'bat' and n = 1),
  'Ball one is the batter''s first, as played');
select is((select count(*)::int from public.cricket_balls where challenge_id = '00000000-0000-0000-0000-0000000c2e01' and by_hand is not null),
  (select count(*)::int from public.cricket_hand_balls where challenge_id = '00000000-0000-0000-0000-0000000c2e01' and used_over is not null),
  'Every ball by hand that was bowled is marked used');
select ok((select count(*) from public.cricket_balls where challenge_id = '00000000-0000-0000-0000-0000000c2e01' and ball_no >= 4) = 0
  or (select by_hand from public.cricket_balls where challenge_id = '00000000-0000-0000-0000-0000000c2e01' and ball_no = 4) = 'bowl',
  'then ball four is the bowler''s');

select tests.sign_in(:'ada');
set local role authenticated;
select is((select jsonb_build_object('bat', o -> 'bat_balls_7d', 'bowl', o -> 'bowl_balls_7d', 'batters', o -> 'batters_7d', 'hands_on', o -> 'hands_on')
  from public.admin_cricket_overview() o),
  jsonb_build_object('bat', 3, 'bowl', 3, 'batters', 1, 'hands_on', 1), 'Admin: balls batted and bowled by hand, batters, hands-on matches');
reset role;

select * from finish();
