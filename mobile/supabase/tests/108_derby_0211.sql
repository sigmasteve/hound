-- 0211: the Home Run Derby. Publishing and setup, joining, swings from
-- steps and the 20 cap, the stages, the distance table, steps and workout
-- feet and the 500 cap, fences by direction, fly outs and whiffs, Moonshots
-- and golden balls, the pending pitch, the board, the payout (ties share,
-- the longest home run, 10+ home runs, the sign capped), and Admin.
select plan(55);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob', :'cat', :'dan');
select public.soccer_today(:'ann') as today \gset

-- ── The numbers ──

select is((select string_agg(public.derby_stage(7, d)::text, '' order by d) from generate_series(1, 7) d), '1122233',
  'Seven days: days 1-2, 3-5, 6-7');
select is((select string_agg(public.derby_stage(3, d)::text, '' order by d) from generate_series(1, 3) d), '123', 'Three days: one each');
select is(array[public.derby_mph(1), public.derby_mph(2), public.derby_mph(3)], array[70, 75, 80], '70, 75, 80 mph');
select is(array[public.derby_ms(1), public.derby_ms(2), public.derby_ms(3)], array[820, 760, 700], 'Faster to the plate each stage');
select is(array[public.derby_base_ft(5, 1), public.derby_base_ft(15, 1), public.derby_base_ft(25, 1), public.derby_base_ft(40, 1), public.derby_base_ft(60, 1)],
  array[435, 425, 410, 390, 360], 'The distance table at 70 mph');
select is(public.derby_base_ft(71, 1), null, 'Past 70 ms, no barrel');
select is(public.derby_base_ft(8, 0.70), 425, 'At 80 mph the bands narrow: 8 ms is no longer dead on');
select is(array[public.derby_fence(10, 1), public.derby_fence(30, 1), public.derby_fence(60, 1)], array[410, 375, 330],
  'Fences: center, the gaps, down the lines');
select is(array[public.derby_dir(-20, 1), public.derby_dir(20, 1), public.derby_dir(10, 1)], array['left', 'right', 'center'],
  'Early pulls it, late pushes it');
select is(array[public.derby_steps_ft(4200), public.derby_steps_ft(5000), public.derby_steps_ft(23000)], array[0, 10, 40],
  '+10 ft per 5,000 steps, up to 40');
select is(array[public.derby_workout_ft(0), public.derby_workout_ft(1), public.derby_workout_ft(2), public.derby_workout_ft(3)],
  array[0, 15, 25, 25], 'A workout adds 15, two or more 25');

-- ── Publishing and setting up ──

select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok($q$select public.publish_global_challenge('Short Derby', 'derby', 2, now(), now() + interval '1 day')$q$,
  'The Home Run Derby runs 3 to 30 days.', 'A Derby runs at least 3 days');
select public.publish_global_challenge('Hound Home Run Derby', 'derby', 7, now() - interval '1 hour', now() + interval '3 days') as derby \gset
select ok(:'derby' is not null, 'The Derby can be a Global Hound Challenge');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$select public.derby_setup_global(%L)$q$, :'derby'),
  'Only an admin can set up the Home Run Derby.', 'Only an admin sets it up');
select throws_ok(format($q$select public.join_global_challenge(%L)$q$, :'derby'),
  'This Derby isn''t set up yet.', 'Nobody joins before it''s set up');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select lives_ok(format($q$select public.derby_setup_global(%L)$q$, :'derby'), 'The admin sets it up with the default prizes');
select throws_ok(format($q$select public.derby_setup_global(%L)$q$, :'derby'), 'This Derby is already set up.', 'Once');
reset role;

-- Everyone but Bob joins now; each player's first golden ball is set
-- where a test wants it (the pitch that creates the day keeps a row that's
-- already there).
select tests.sign_in(:'ann');
set local role authenticated;
select public.join_global_challenge(:'derby');
reset role;
select tests.sign_in(:'cat');
set local role authenticated;
select public.join_global_challenge(:'derby');
reset role;
select tests.sign_in(:'dan');
set local role authenticated;
select public.join_global_challenge(:'derby');
reset role;
select is((select joined_day from public.derby_players where challenge_id = :'derby' and user_id = :'ann'), :'today'::date,
  'Your Derby counts from the day you join');
insert into public.derby_days (challenge_id, user_id, day, golden1, golden2) values
  (:'derby', :'ann', :'today', 10, null), (:'derby', :'dan', :'today', 10, 11), (:'derby', :'cat', :'today', 2, null);

-- ── Swings from steps ──

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.derby_live(:'derby') ->> 'reason', 'No swings ready: your next comes at 1,000 steps.', 'No steps, no swings');
select throws_ok(format($q$select public.derby_pitch(%L)$q$, :'derby'), 'No swings ready: your next comes at 1,000 steps.',
  'And no pitch');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select is(public.derby_live(:'derby') ->> 'reason', 'Join the Derby to swing.', 'Join first');
reset role;

insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  (:'derby', :'ann', :'today', 4200), (:'derby', :'cat', :'today', 25000), (:'derby', :'dan', :'today', 20000);
-- Dan did an hour of strength work today: two bonuses.
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min)
  values (:'dan', 'derby-test-1', 'Traditional Strength Training', (:'today'::date + time '12:00') at time zone 'America/New_York', 'test', 60);

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.derby_live(:'derby') ->> 'swings_left')::int, 4, '4,200 steps: four swings');
select is((public.derby_live(:'derby') -> 'power' ->> 'steps_ft')::int, 0, 'Not enough steps yet for extra feet');
select is(public.derby_pitch(:'derby') ->> 'mph', '70', 'Day one: 70 mph');
select is((public.derby_pitch(:'derby') ->> 'n')::int, 1, 'A pitch not swung at comes back');
reset role;
select is((select count(*)::int from public.derby_swings where challenge_id = :'derby' and user_id = :'ann'), 1, '... without a new one');
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.derby_swing(:'derby', 0) ->> 'message', 'Gone! 435 ft.', 'Dead on: 435 ft, over the center-field wall');
select public.derby_pitch(:'derby');
select is(public.derby_swing(:'derby', -50) - array['hrs', 'longest_ft', 'rank', 'swings_left', 'power', 'golden', 'sign', 'sign_paid', 'message', 'moonshot', 'px', 'py', 'miss', 'timing'],
  '{"result":"hr","ft":350,"dir":"left","counts":1}'::jsonb, '50 ms early: 350 ft, pulled down the line, and out');
select public.derby_pitch(:'derby');
select is(public.derby_swing(:'derby', -90) ->> 'message', 'Caught at the wall: a little early.', '90 ms early: caught at the wall');
select public.derby_pitch(:'derby');
select is(public.derby_swing(:'derby', 150) ->> 'message', 'Swing and a miss: way late.', 'Way late: a whiff');
select is(public.derby_live(:'derby') ->> 'reason', 'No swings ready: your next comes at 5,000 steps.', 'Four swings used');
select throws_ok(format($q$select public.derby_swing(%L, 0)$q$, :'derby'), 'Pitch first.', 'No pitch, no swing');
select is((public.derby_live(:'derby') -> 'me' ->> 'hrs')::int, 2, 'Two home runs');
reset role;

-- ── Dan: 20,000 steps and two workouts — the longest there is ──

select tests.sign_in(:'dan');
set local role authenticated;
select is((public.derby_live(:'derby') -> 'power')::jsonb, '{"steps_ft": 40, "workout_ft": 25}'::jsonb, '+40 for steps, +25 for workouts');
select public.derby_pitch(:'derby');
select is(public.derby_swing(:'derby', 0) - array['hrs', 'longest_ft', 'rank', 'swings_left', 'power', 'golden', 'sign', 'sign_paid', 'dir', 'result', 'px', 'py', 'miss', 'timing'],
  '{"ft":500,"moonshot":true,"counts":2,"message":"Moonshot! 500 ft: that counts as two."}'::jsonb, 'A 500 ft Moonshot counts as two');
select public.derby_pitch(:'derby');
select is(public.derby_swing(:'derby', null) ->> 'message', 'You have to swing in a derby. That one''s an out.', 'Taking one is an out');
reset role;

-- ── Cat: golden balls and the 20 cap ──

select tests.sign_in(:'cat');
set local role authenticated;
do $$
declare i int;
begin
  for i in 1 .. 20 loop
    perform public.derby_pitch((select id from public.challenges where name = 'Hound Home Run Derby'));
    perform public.derby_swing((select id from public.challenges where name = 'Hound Home Run Derby'), 6);
  end loop;
end $$;
select is(public.derby_live(:'derby') ->> 'reason', 'That''s 20 swings today. Back tomorrow.', '20 swings a day at most');
reset role;
select is((select count(*)::int from public.derby_swings where challenge_id = :'derby' and user_id = :'cat' and golden), 2,
  'Two golden balls once you''re past 15,000 steps');
select ok((select golden from public.derby_swings where challenge_id = :'derby' and user_id = :'cat' and n = 2), 'The first where it was set');
select ok((select golden2 between 1 and 10 and golden2 <> 2 from public.derby_days where challenge_id = :'derby' and user_id = :'cat'),
  'The second within 10 pitches of passing 15K, never the first''s pitch');
select is((select counts from public.derby_swings where challenge_id = :'derby' and user_id = :'cat' and n = 2), 2,
  'A golden home run counts double');
select is((select hrs from public.derby_players where challenge_id = :'derby' and user_id = :'cat'), 22, '20 home runs, 2 of them golden: 22');
select is((select count(*)::int from public.derby_swings where challenge_id = :'derby' and sign), 0, 'No sponsor, no sign hits');
select tests.sign_in(:'ann');
set local role authenticated;
select ok((public.derby_live(:'derby') -> 'goldens' ->> 'second_unlocked')::boolean = false, 'Ann''s second golden ball waits for 15,000 steps');
reset role;

-- ── The board ──

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.derby_board(:'derby', 'top') -> 'rows' -> 0 ->> 'user_id', :'cat', 'Cat leads');
select is((public.derby_board(:'derby', 'top') ->> 'swung')::int, 3, 'Three have swung');
select throws_ok(format($q$select public.derby_board(%L, 'nope')$q$, :'derby'), 'Pick Top, Friends or My club.', 'A real tab');
reset role;

-- ── The end: places (a tie shares), the longest, 10+, the sign capped ──

update public.challenges set sponsor_name = 'Acme' where id = :'derby';
update public.derby_players set hrs = 1, longest_ft = 400, longest_at = '2026-11-01 12:00+00', sign_hits = 0
  where challenge_id = :'derby' and user_id = :'ann';
update public.derby_players set sign_hits = 7 where challenge_id = :'derby' and user_id = :'cat';
-- Bob joins late and ties Ann exactly.
insert into public.challenge_participants (challenge_id, user_id) values (:'derby', :'bob');
update public.derby_players set hrs = 1, longest_ft = 400, longest_at = '2026-11-01 12:00+00', swings = 1
  where challenge_id = :'derby' and user_id = :'bob';
update public.challenges set starts_at = now() - interval '8 days', ends_at = now() - interval '25 hours' where id = :'derby';
select public.settle_challenge_score(:'derby');
-- The payout trigger is deferred to commit; run it now.
set constraints all immediate;

select ok((select paid_at is not null from public.derby_games where challenge_id = :'derby'), 'It pays at the end');
select is((select array[place, place_bones, ten_bones, sign_bones_paid] from public.derby_players where challenge_id = :'derby' and user_id = :'cat'),
  array[1, 500, 25, 125], 'Cat: 1st (500), 10+ home runs (25), 7 sign hits paid up to 5 (125)');
select is((select array[place, place_bones, longest_bones] from public.derby_players where challenge_id = :'derby' and user_id = :'dan'),
  array[2, 300, 150], 'Dan: 2nd, and the longest home run');
select is((select array_agg(place_bones order by user_id) from public.derby_players where challenge_id = :'derby' and user_id in (:'ann', :'bob')),
  array[150, 150], 'Ann and Bob tie for 3rd: 3rd and 4th shared, 150 each');
select is((select bones_points from public.activity_events where challenge_id = :'derby' and user_id = :'cat' and kind = 'global_place'), 650,
  'Cat''s prize Bones in one go');
select public.derby_pay(:'derby');
select is((select count(*)::int from public.activity_events where challenge_id = :'derby' and kind = 'global_place'), 4, 'Paid once');

-- ── Admin ──

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.admin_derby_overview()$q$, 'not authorized', 'Admins only');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select ok((public.admin_derby_overview() ->> 'swings_7d')::int >= 26, 'Admin sees the swings');
reset role;

select * from finish();
