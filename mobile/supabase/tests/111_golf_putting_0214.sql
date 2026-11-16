-- 0214: putts to the inch, a bank that pays whole yards, putts that say
-- where they stopped, and Admin's putting numbers.
select plan(16);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Ada', true) as ada \gset
select (now() at time zone 'America/New_York')::date as today \gset

-- One straight hole with a flat green: the pin at 400.
insert into public.golf_courses (id, name, style, sort) values ('zzputt', 'Putt Park', 'park', 99);
insert into public.golf_holes (course_id, no, par, length, name, hole)
select 'zzputt', k, 4, 400, 'Putt ' || k, jsonb_build_object(
  'no', k, 'par', 4, 'length', 400, 'name', 'Putt ' || k,
  'center', '[[0,0],[400,0]]'::jsonb, 'fairway_w', 20, 'fairway_from', 30, 'fairway_to', 388,
  'green', '{"d":400,"lat":0,"r":14,"break":0}'::jsonb, 'pin', '{"d":400,"lat":0}'::jsonb,
  'hazards', '[]'::jsonb, 'ob', 70, 'wind', '{"mph":0,"deg":90}'::jsonb, 'slope', null)
from generate_series(1, 9) k;

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-000000214a01', 'Putts', 'golf', :'ann', 4, now() - interval '1 day', now() + interval '3 days', :'today'::date - 1);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-000000214a01', :'ann');
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-000000214a01', :'ann', :'today'::date - 1, 20000);

select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok(format($q$select public.golf_setup('00000000-0000-0000-0000-000000214a01', 'zzputt', 9, 'stroke', true, 0, array[%L]::uuid[])$q$, :'ann'),
  'A game to putt in');
reset role;

-- On the green, 6 yards (18 ft) out, two shots in.
update public.golf_players set lie = 'green', ball_d = 394, ball_lat = 0, strokes = 2
  where challenge_id = '00000000-0000-0000-0000-000000214a01' and user_id = :'ann';

-- The words, on their own.
select is(public.golf_putt_words((select hole from public.golf_holes where course_id = 'zzputt' and no = 1), 394, 0, 399, 0, 'green'),
  'Left it 3 ft short.', 'Short, in feet');
select is(public.golf_putt_words((select hole from public.golf_holes where course_id = 'zzputt' and no = 1), 394, 0, 401.5, 0, 'green'),
  'Rolled 5 ft past.', 'Past');
select is(public.golf_putt_words((select hole from public.golf_holes where course_id = 'zzputt' and no = 1), 394, 0, 399.8, 2, 'green'),
  'Missed right, 6 ft from the cup.', 'Off to the side');
select is(public.golf_putt_words((select hole from public.golf_holes where course_id = 'zzputt' and no = 1), 394, 0, 403, 0, 'fringe'),
  'Rolled 9 ft past. Off the green.', 'Off the green');

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.golf_shot('00000000-0000-0000-0000-000000214a01', 'putter', 0.2, 0, 0, 0)$q$,
  'Give it at least a foot.', 'A putt is at least a foot');

-- 4.33 yards (13 ft) of an 18 ft putt: short, and the bank pays 4 yards.
select public.golf_shot('00000000-0000-0000-0000-000000214a01', 'putter', 4.33, 0, 0, 0) as p1 \gset
select is((:'p1'::jsonb) ->> 'holed', 'false', 'A short putt stays out');
select is((:'p1'::jsonb) ->> 'message', 'Left it 5 ft short.', 'It says how short');
select ok(abs(((:'p1'::jsonb) -> 'ball' ->> 'd')::numeric - 398.33) < 0.01, 'It rolled exactly 4.33 yards');
select is((:'p1'::jsonb) -> 'banks' ->> 'yards', '1996', 'The bank paid 4 whole yards');
reset role;
select is((select yards from public.golf_shots where challenge_id = '00000000-0000-0000-0000-000000214a01' order by created_at desc limit 1), 4,
  'The shot records whole yards');

-- 1.67 yards (5 ft) from 1.67 out: in.
select tests.sign_in(:'ann');
set local role authenticated;
select public.golf_shot('00000000-0000-0000-0000-000000214a01', 'putter', 1.67, 0, 0, 0) as p2 \gset
select is((:'p2'::jsonb) ->> 'holed', 'true', 'The second putt drops');
select is((:'p2'::jsonb) ->> 'hole_score', '4', 'Par');
-- Other clubs still come in whole yards.
select is((public.golf_shot('00000000-0000-0000-0000-000000214a01', 'driver', 200.4, 0, 0, 0)) -> 'banks' ->> 'yards', '1794',
  'A drive of 200.4 is 200 yards');
reset role;

-- Admin's numbers.
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.admin_golf_putting_overview()$q$, 'not authorized', 'Only admins read putting');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_golf_putting_overview() - 'by_length' - 'avg_putts_per_hole_7d' - 'holes_7d' - 'three_putts_7d')
  , '{"putts_7d": 2, "putters_7d": 1, "made_7d": 1, "pace_putts_7d": 2, "pace_players_7d": 1}'::jsonb,
  'Putts, made, and with the pace meter');
reset role;

select * from finish();
