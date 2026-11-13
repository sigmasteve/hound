-- 0200/0201: Golf — setup, banks, the shot engine, skins, match play,
-- hands-off walks, settlement and Admin.
select plan(75);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
select tests.new_user('Eve') as eve \gset
select tests.new_user('Ada', true) as ada \gset
select (now() at time zone 'America/New_York')::date as today \gset

-- A plain test course: nine straight par 4s, 400 yards, no wind to speak
-- of, a stream across at 330 (drop at 315) and a flat green.
insert into public.golf_courses (id, name, style, sort) values ('zztest', 'Test Park', 'park', 99);
insert into public.golf_holes (course_id, no, par, length, name, hole)
select 'zztest', k, 4, 400, 'Test ' || k, jsonb_build_object(
  'no', k, 'par', 4, 'length', 400, 'name', 'Test ' || k,
  'center', '[[0,0],[400,0]]'::jsonb, 'fairway_w', 20, 'fairway_from', 30, 'fairway_to', 388,
  'green', '{"d":400,"lat":0,"r":14,"break":0}'::jsonb, 'pin', '{"d":400,"lat":0}'::jsonb,
  'hazards', '[{"type":"water","d":330,"lat":0,"rd":8,"rl":50,"drop":{"d":315,"lat":0}}]'::jsonb,
  'ob', 70, 'wind', '{"mph":0,"deg":90}'::jsonb, 'slope', null)
from generate_series(1, 9) k;

-- ── The courses ──

select is((select count(*)::int from public.golf_holes h join public.golf_courses c on c.id = h.course_id where c.id <> 'zztest'), 36,
  'Four courses of nine holes');
select is((select array_agg(s order by c) from (select h.course_id as c, sum(h.par)::int as s from public.golf_holes h
           where h.course_id <> 'zztest' group by h.course_id) x), array[36, 36, 36, 36], 'Every course is par 36');
select is((select count(*)::int from public.golf_holes h, jsonb_array_elements(h.hole -> 'hazards') z
           where z ->> 'type' = 'water' and not (z ? 'drop')), 0, 'All water has a drop');

-- ── The flight maths (the prototype's) ──

select is(public.golf_flight((select hole from public.golf_holes where course_id = 'zztest' and no = 1),
    0, 0, 'tee', 'driver', 200, 0, 0, 0.2, 0, 90),
  '{"to_d": 197.16, "to_lat": 12.00, "carry": 186.0, "lie": "fairway", "holed": false}'::jsonb,
  'Late by 0.2: 186 yd carry, 12 yd right (slice), 6% roll on the fairway');
select is((public.golf_flight((select hole from public.golf_holes where course_id = 'zztest' and no = 1),
    0, 0, 'tee', 'driver', 200, 0, 0, 0.2, 8, 90)) ->> 'to_lat', '18.00',
  'An 8 mph wind to the right adds 6 yards at 200');
select is((public.golf_flight((select hole from public.golf_holes where course_id = 'zztest' and no = 1),
    0, 0, 'tee', 'driver', 200, 0, 20, 0, 8, 90)) ->> 'to_lat', '3.00',
  'Power 20 halves the wind');
select is((public.golf_flight((select hole from public.golf_holes where course_id = 'zztest' and no = 1),
    200, 0, 'rough', 'i7', 100, 0, 0, 0, 0, 90)) ->> 'carry', '85.0', 'From the rough, the carry is ×0.85');
select is((public.golf_flight((select hole from public.golf_holes where course_id = 'zztest' and no = 1),
    200, 0, 'bunker', 'i7', 100, 0, 0, 0, 0, 90)) ->> 'carry', '70.0', 'From a bunker, ×0.7');

-- ── Setup ──

-- A: stroke play, one hole a day. B: skins. C: match. D: hands-off. E: over.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000009a1', 'Stroke', 'golf', :'ann', 4, now() - interval '1 day', now() + interval '3 days', :'today'::date - 1),
  ('00000000-0000-0000-0000-0000000009b1', 'Skins', 'golf', :'ann', 4, now() - interval '1 day', now() + interval '3 days', :'today'::date - 1),
  ('00000000-0000-0000-0000-0000000009c1', 'Match', 'golf', :'ann', 4, now() - interval '1 day', now() + interval '3 days', :'today'::date - 1),
  ('00000000-0000-0000-0000-0000000009d1', 'Walks', 'golf', :'ann', 4, now() - interval '2 days', now() + interval '2 days', :'today'::date - 2),
  ('00000000-0000-0000-0000-0000000009e1', 'Done', 'golf', :'ann', 4, now() - interval '5 days', now() - interval '1 hour', :'today'::date - 5);
insert into public.challenge_participants (challenge_id, user_id)
select g, :'ann' from unnest(array['00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009b1',
  '00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009d1', '00000000-0000-0000-0000-0000000009e1']::uuid[]) g;

select tests.sign_in(:'cat');
set local role authenticated;
select throws_ok(format($q$select public.golf_setup('00000000-0000-0000-0000-0000000009a1', 'zztest', 9, 'stroke', true, 1, array[%L, %L]::uuid[])$q$, :'ann', :'cat'),
  'Only whoever made this game can set it up.', 'Only the creator sets it up');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$select public.golf_setup('00000000-0000-0000-0000-0000000009a1', 'zztest', 9, 'scramble', true, 1, array[%L]::uuid[])$q$, :'ann'),
  'Pick stroke play, skins or match play.', 'Scramble isn''t a format yet');
select throws_ok(format($q$select public.golf_setup('00000000-0000-0000-0000-0000000009a1', 'zztest', 12, 'stroke', true, 1, array[%L]::uuid[])$q$, :'ann'),
  'A round is 9 holes or 18.', '9 or 18 holes');
select throws_ok(format($q$select public.golf_setup('00000000-0000-0000-0000-0000000009a1', 'zztest', 9, 'stroke', true, 1, array[%L]::uuid[])$q$, :'cat'),
  'You''re playing too.', 'The creator plays');
select throws_ok(format($q$select public.golf_setup('00000000-0000-0000-0000-0000000009c1', 'zztest', 9, 'match', true, 0, array[%L, %L, %L]::uuid[])$q$, :'ann', :'cat', :'dan'),
  'Match play is one on one: you and one friend.', 'Match play is two players');
select lives_ok(format($q$select public.golf_setup('00000000-0000-0000-0000-0000000009a1', 'zztest', 9, 'stroke', true, 1, array[%L, %L, %L]::uuid[])$q$, :'ann', :'cat', :'dan'),
  'Stroke play sets up');
select throws_ok(format($q$select public.golf_setup('00000000-0000-0000-0000-0000000009a1', 'zztest', 9, 'stroke', true, 1, array[%L]::uuid[])$q$, :'ann'),
  'This game is already set up.', 'Only once');
select lives_ok(format($q$select public.golf_setup('00000000-0000-0000-0000-0000000009b1', 'zztest', 9, 'skins', true, 0, array[%L, %L]::uuid[])$q$, :'ann', :'cat'),
  'Skins sets up');
select lives_ok(format($q$select public.golf_setup('00000000-0000-0000-0000-0000000009c1', 'zztest', 18, 'match', true, 0, array[%L, %L]::uuid[])$q$, :'ann', :'cat'),
  'Match play sets up, 18 holes');
select lives_ok(format($q$select public.golf_setup('00000000-0000-0000-0000-0000000009d1', 'zztest', 9, 'stroke', false, 0, array[%L]::uuid[])$q$, :'ann'),
  'A hands-off round sets up');
select lives_ok(format($q$select public.golf_setup('00000000-0000-0000-0000-0000000009e1', 'zztest', 9, 'stroke', true, 0, array[%L, %L]::uuid[])$q$, :'ann', :'cat'),
  'A round that''s about to end sets up');
reset role;

select is((select array_agg(joined order by user_id = :'ann' desc, user_id = :'cat' desc) from public.golf_players where challenge_id = '00000000-0000-0000-0000-0000000009a1'),
  array[true, false, false], 'The creator is in; the invited join when they accept');
insert into public.challenge_participants (challenge_id, user_id)
select g, u from unnest(array['00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009b1',
  '00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009e1']::uuid[]) g, unnest(array[:'cat'::uuid]) u;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000009a1', :'dan');
select is((select count(*)::int from public.golf_players where challenge_id = '00000000-0000-0000-0000-0000000009a1' and joined), 3,
  'Accepting takes their place');
select throws_ok(format($q$insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000009c1', %L)$q$, :'eve'),
  'This match is already one on one.', 'No third player in a match');
select is((select array_length(scores, 1) from public.golf_players where challenge_id = '00000000-0000-0000-0000-0000000009c1' and user_id = :'ann'), 18,
  'An 18-hole card');

-- ── Banks ──

insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-0000000009a1', :'ann', :'today'::date - 1, 30000),
  ('00000000-0000-0000-0000-0000000009a1', :'cat', :'today'::date - 1, 20000),
  ('00000000-0000-0000-0000-0000000009a1', :'dan', :'today'::date - 1, 500),
  ('00000000-0000-0000-0000-0000000009a1', :'ann', :'today'::date - 10, 99000);
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min) values
  (:'ann', 'g1', 'Traditional Strength Training', ((:'today'::date - 1) + time '16:00') at time zone 'America/New_York', 'healthkit', 15),
  (:'ann', 'g2', 'Golf', ((:'today'::date - 1) + time '17:00') at time zone 'America/New_York', 'healthkit', 20),
  (:'ann', 'g3', 'Running', ((:'today'::date - 1) + time '07:00') at time zone 'America/New_York', 'healthkit', 10),
  (:'ann', 'g4', 'Running', ((:'today'::date - 9) + time '07:00') at time zone 'America/New_York', 'healthkit', 60);

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.golf_view('00000000-0000-0000-0000-0000000009a1') -> 'banks') - 'power_from',
  '{"steps": 30000, "yards": 3000, "power": 100}'::jsonb,
  'Banks: 30,000 steps are 3,000 yards; strength ×2, golf ×3 and a run are 100 power (days before the game don''t count)');
select is(jsonb_array_length(public.golf_view('00000000-0000-0000-0000-0000000009a1') -> 'banks' -> 'power_from'), 3,
  'Where the power came from');

-- ── Validation ──

select throws_ok($q$select public.golf_shot('00000000-0000-0000-0000-0000000009a1', 'putter', 20, 0, 0, 0)$q$,
  'The putter''s for the green.', 'No putter off the green');
select throws_ok($q$select public.golf_shot('00000000-0000-0000-0000-0000000009a1', 'driver', 260, 0, 0, 0)$q$,
  'The driver goes 250 yards at most.', 'A club''s range');
select throws_ok($q$select public.golf_shot('00000000-0000-0000-0000-0000000009a1', 'driver', 250, 40, 0, 0)$q$,
  'Aim within 35 degrees of the pin.', 'Aim stays near the pin');
select throws_ok($q$select public.golf_shot('00000000-0000-0000-0000-0000000009a1', 'driver', 250, 0, 15, 0)$q$,
  'Power is 0, 10, 20 or 30, up to 30.', 'Power comes in tens');
reset role;

select tests.sign_in(:'dan');
set local role authenticated;
select throws_ok($q$select public.golf_shot('00000000-0000-0000-0000-0000000009a1', 'wedge', 100, 0, 0, 0)$q$,
  'You have 50 yards banked.', 'No more yards than banked');
select throws_ok($q$select public.golf_shot('00000000-0000-0000-0000-0000000009a1', 'wedge', 40, 0, 10, 0)$q$,
  'You have 0 power banked.', 'No more power than banked');
reset role;

-- ── Ann's first hole: fairway, water, out of bounds, the green, a putt ──

select tests.sign_in(:'ann');
set local role authenticated;
select public.golf_shot('00000000-0000-0000-0000-0000000009a1', 'driver', 250, 0, 10, 0) as s1 \gset
select is((:'s1'::jsonb) ->> 'lie', 'fairway', 'A pure drive finds the fairway');
select is((:'s1'::jsonb) ->> 'carry', '275', 'Power 10 carries it 10% further');
select ok(((:'s1'::jsonb) -> 'to' ->> 'd')::numeric = 291.5, 'And it rolls 6% on the fairway');
select is((:'s1'::jsonb) ->> 'message', 'Pure. 275 yd, fairway.', 'In words');
select is((:'s1'::jsonb) -> 'banks', '{"yards": 2750, "power": 90}'::jsonb, 'It spent 250 yards and 10 power');

select public.golf_shot('00000000-0000-0000-0000-0000000009a1', 'wedge', 40, 0, 0, 0) as s2 \gset
select is((:'s2'::jsonb) ->> 'lie', 'water', 'Into the stream');
select is((:'s2'::jsonb) ->> 'penalty', '1', 'A penalty stroke');
select is((:'s2'::jsonb) -> 'ball', '{"d": 315, "lat": 0}'::jsonb, 'Dropped at the drop');
select is((:'s2'::jsonb) ->> 'strokes_on_hole', '3', 'Two swings, one penalty');

select public.golf_shot('00000000-0000-0000-0000-0000000009a1', 'i7', 160, 35, 0, 0) as s3 \gset
select is((:'s3'::jsonb) ->> 'lie', 'out', 'Out of bounds');
select is((:'s3'::jsonb) -> 'ball', (:'s3'::jsonb) -> 'from', 'Played again from the same spot');
select is((:'s3'::jsonb) ->> 'strokes_on_hole', '5', 'Stroke and distance');
select is((select lie from public.golf_players where challenge_id = '00000000-0000-0000-0000-0000000009a1' and user_id = :'ann'), 'fairway',
  'Still on the fairway');

select public.golf_shot('00000000-0000-0000-0000-0000000009a1', 'wedge', 85, 0, 0, 0) as s4 \gset
select is((:'s4'::jsonb) ->> 'lie', 'green', 'On the green');
select throws_ok($q$select public.golf_shot('00000000-0000-0000-0000-0000000009a1', 'wedge', 3, 0, 0, 0)$q$,
  'That''s the putter''s job.', 'Only the putter on the green');
select public.golf_shot('00000000-0000-0000-0000-0000000009a1', 'putter',
  ceil(sqrt(power(400 - ((:'s4'::jsonb) -> 'ball' ->> 'd')::numeric, 2) + power(((:'s4'::jsonb) -> 'ball' ->> 'lat')::numeric, 2)))::int, 0, 0, 0) as s5 \gset
select is((:'s5'::jsonb) ->> 'holed', 'true', 'The putt drops');
select is((:'s5'::jsonb) ->> 'hole_score', '7', 'Seven on the hole');
select is((:'s5'::jsonb) ->> 'next_hole', '2', 'On to the 2nd');
select throws_ok($q$select public.golf_shot('00000000-0000-0000-0000-0000000009a1', 'driver', 250, 0, 0, 0)$q$,
  'That''s 1 hole today. More tomorrow.', 'One hole a day here');
select is(public.golf_view('00000000-0000-0000-0000-0000000009a1') -> 'today', '{"holes_started": 1, "can_start": false}'::jsonb,
  'The view knows');
select is((select jsonb_agg(x -> 'lie' order by (x ->> 'seq')::int) from jsonb_array_elements(public.golf_shots('00000000-0000-0000-0000-0000000009a1', :'ann', 1)) x),
  '["fairway", "water", "out", "green", "green"]'::jsonb, 'Her hole, shot by shot, for watching');
reset role;

-- ── Picking up at par + 4 ──

select tests.sign_in(:'cat');
set local role authenticated;
select is(public.golf_shot('00000000-0000-0000-0000-0000000009a1', 'driver', 250, 35, 0, 0) ->> 'strokes_on_hole', k::text,
  'Out of bounds again: ' || k) from generate_series(2, 6, 2) k;
select public.golf_shot('00000000-0000-0000-0000-0000000009a1', 'driver', 250, -35, 0, 0) as c4 \gset
select is((:'c4'::jsonb) ->> 'hole_score', '8', 'Four out of bounds is eight: picked up at par + 4');
select is((:'c4'::jsonb) ->> 'picked_up', 'true', 'Picked up');
select is((:'c4'::jsonb) -> 'banks' ->> 'yards', '1000', 'Every swing still spent its yards');
reset role;
select is((select scores[1] from public.golf_players where challenge_id = '00000000-0000-0000-0000-0000000009a1' and user_id = :'cat'), 8, 'On her card');

-- ── Skins ──

update public.golf_players set scores[1] = 4, scores[2] = 3 where challenge_id = '00000000-0000-0000-0000-0000000009b1' and user_id = :'ann';
update public.golf_players set scores[1] = 4, scores[2] = 5, scores[3] = 4 where challenge_id = '00000000-0000-0000-0000-0000000009b1' and user_id = :'cat';
select public.golf_settle_skins('00000000-0000-0000-0000-0000000009b1', false);
select is((select skins from public.golf_games where challenge_id = '00000000-0000-0000-0000-0000000009b1'),
  jsonb_build_array(jsonb_build_object('hole', 1, 'winner', null, 'bones', 10, 'carried', 0),
                    jsonb_build_object('hole', 2, 'winner', :'ann', 'bones', 20, 'carried', 10)),
  'A tie carries the skin; the next hole''s winner takes both; hole 3 waits for Ann');
select tests.sign_in(:'ann');
set local role authenticated;
select is((select x ->> 'skins' from jsonb_array_elements(public.golf_view('00000000-0000-0000-0000-0000000009b1') -> 'players') x where x ->> 'user_id' = :'ann'), '1',
  'Ann has a skin');
reset role;

-- ── Match play ──

update public.golf_players set scores[1] = 4, scores[2] = 5, scores[3] = 3 where challenge_id = '00000000-0000-0000-0000-0000000009c1' and user_id = :'ann';
update public.golf_players set scores[1] = 5, scores[2] = 5, scores[3] = 4, scores[4] = 3 where challenge_id = '00000000-0000-0000-0000-0000000009c1' and user_id = :'cat';
select tests.sign_in(:'cat');
set local role authenticated;
select is((select jsonb_object_agg(case when x ->> 'user_id' = :'ann' then 'ann' else 'cat' end, x -> 'match')
           from jsonb_array_elements(public.golf_view('00000000-0000-0000-0000-0000000009c1') -> 'players') x),
  '{"ann": "2 up", "cat": "2 down"}'::jsonb, 'Match play counts holes won over the holes both have finished');
reset role;

-- ── Hands-off: walks are shots, played at night ──

insert into public.progress_snapshots (challenge_id, user_id, day, steps) values ('00000000-0000-0000-0000-0000000009d1', :'ann', :'today'::date - 1, 10000);
insert into public.hound_walks (user_id, day, start_minute, started_at, ended_at, steps) values
  (:'ann', :'today'::date - 1, 540, now() - interval '30 hours', now() - interval '30 hours' + interval '25 minutes', 2600),
  (:'ann', :'today'::date - 1, 600, now() - interval '29 hours', now() - interval '29 hours' + interval '5 minutes', 600),
  (:'ann', :'today'::date, 600, now() - interval '1 minute', now(), 900);
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.golf_shot('00000000-0000-0000-0000-0000000009d1', 'driver', 250, 0, 0, 0)$q$,
  'This game plays itself: every walk of 10 minutes or more is a shot.', 'A hands-off game takes no swipes');
reset role;
select is(public.golf_advance('00000000-0000-0000-0000-0000000009d1', true), 1, 'The night plays yesterday''s long walk (not the short one, not today''s)');
select is((select array[yards, (walk_id is not null)::int, (club = 'driver')::int] from public.golf_shots where challenge_id = '00000000-0000-0000-0000-0000000009d1'),
  array[250, 1, 1], 'A 2,600-step walk is a driver, capped at 250 yards');
select is(public.golf_advance('00000000-0000-0000-0000-0000000009d1', true), 0, 'A walk plays once');

-- ── The end and the Bones ──

update public.golf_players set scores = array[4,4,4,4,4,4,4,4,3], finished_at = now()
  where challenge_id = '00000000-0000-0000-0000-0000000009e1' and user_id = :'ann';
update public.golf_players set scores[1] = 4, scores[2] = 4 where challenge_id = '00000000-0000-0000-0000-0000000009e1' and user_id = :'cat';
select public.settle_challenge_score('00000000-0000-0000-0000-0000000009e1');
select is((select array[status, winner::text] from public.golf_games where challenge_id = '00000000-0000-0000-0000-0000000009e1'),
  array['final', :'ann'], 'Ended: the lowest total wins');
select is((select scores from public.golf_players where challenge_id = '00000000-0000-0000-0000-0000000009e1' and user_id = :'cat'),
  array[4,4,8,8,8,8,8,8,8], 'Unfinished holes score par + 4');
select is((select jsonb_object_agg(case when user_id = :'ann' then 'ann' else 'cat' end, jsonb_build_array(score_points, bones_points))
           from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000009e1' and kind = 'golf_result'),
  '{"ann": [35, 55], "cat": [5, 5]}'::jsonb, 'The winner: win and play Bones; not finishing: neither');
select ok((select score_settled_at is not null from public.challenges where id = '00000000-0000-0000-0000-0000000009e1'), 'Settled once');
select is((select wins from public.yard_trophies(:'ann') where kind = 'golf'), 1, 'A Yard trophy for the win');

-- ── Admin ──

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.admin_golf_overview()$q$, 'not authorized', 'Admin numbers are Admin''s');
select throws_ok($q$select public.admin_set_golf_config('{"skin_bones": 50}')$q$, 'not authorized', 'And so are the settings');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select public.admin_set_golf_config('{"skin_bones": 15, "putt_cup": 0.9}');
select is((select array[(o ->> 'games_all')::int, (o -> 'config' ->> 'skin_bones')::int, (o -> 'by_course' ->> 'zztest')::int]
           from public.admin_golf_overview() o), array[5, 15, 5], 'Admin sees the games and sets the Bones');
reset role;
select is((select putt_cup from public.golf_config), 0.90::numeric(3, 2), 'And how close counts on a putt');

select * from finish();
