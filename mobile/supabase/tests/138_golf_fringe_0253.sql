-- 0253: the putter from the fringe (just off the green), not from
-- further out or the trees; other clubs still play from there; Admin
-- counts putts from the fringe.
select plan(11);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Ada', true) as ada \gset
select (now() at time zone 'America/New_York')::date as today \gset

-- A straight hole, the green 14 yd across around the pin at 400, trees
-- beside it on the right.
insert into public.golf_courses (id, name, style, sort) values ('zzfringe', 'Fringe Park', 'park', 99);
insert into public.golf_holes (course_id, no, par, length, name, hole)
select 'zzfringe', k, 4, 400, 'Fringe ' || k, jsonb_build_object(
  'no', k, 'par', 4, 'length', 400, 'name', 'Fringe ' || k,
  'center', '[[0,0],[400,0]]'::jsonb, 'fairway_w', 20, 'fairway_from', 30, 'fairway_to', 388,
  'green', '{"d":400,"lat":0,"r":14,"break":0}'::jsonb, 'pin', '{"d":400,"lat":0}'::jsonb,
  'hazards', '[{"type":"trees","d":400,"lat":16,"rd":3,"rl":3}]'::jsonb, 'ob', 70, 'wind', '{"mph":0,"deg":90}'::jsonb, 'slope', null)
from generate_series(1, 9) k;
select hole as h from public.golf_holes where course_id = 'zzfringe' and no = 1 \gset

select ok(public.golf_fringe(:'h'::jsonb, 384, 0), '2 yd off the green is the fringe');
select ok(not public.golf_fringe(:'h'::jsonb, 380, 0), '6 yd off isn''t');
select ok(not public.golf_fringe(:'h'::jsonb, 400, 16), 'The trees aren''t');
select ok(not public.golf_fringe(:'h'::jsonb, 394, 0), 'The green itself isn''t (it''s the green)');

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-000000253a01', 'Fringe', 'golf', :'ann', 4, now() - interval '1 day', now() + interval '3 days', :'today'::date - 1);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-000000253a01', :'ann');
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-000000253a01', :'ann', :'today'::date - 1, 20000);
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok(format($q$select public.golf_setup('00000000-0000-0000-0000-000000253a01', 'zzfringe', 9, 'stroke', true, 0, array[%L]::uuid[])$q$, :'ann'),
  'A game to putt in');
reset role;

-- 6 yd off the green, on the fairway: no putter.
update public.golf_players set lie = 'fairway', ball_d = 380, ball_lat = 0, strokes = 2
  where challenge_id = '00000000-0000-0000-0000-000000253a01' and user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.golf_shot('00000000-0000-0000-0000-000000253a01', 'putter', 20, 0, 0, 0)$q$,
  'The putter''s for the green, or just off it.', 'Not from 6 yd off');
reset role;

-- 2 yd off: the putter rolls it in from 16 yd (48 ft).
update public.golf_players set lie = 'fairway', ball_d = 384, ball_lat = 0, strokes = 2
  where challenge_id = '00000000-0000-0000-0000-000000253a01' and user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select public.golf_shot('00000000-0000-0000-0000-000000253a01', 'putter', 16, 0, 0, 0) as p1 \gset
select is((:'p1'::jsonb) ->> 'holed', 'true', 'A putt from the fringe drops');
reset role;

-- On the next hole, from the fringe, a wedge is still allowed.
update public.golf_players set lie = 'rough', ball_d = 384, ball_lat = 4, strokes = 2
  where challenge_id = '00000000-0000-0000-0000-000000253a01' and user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($q$select public.golf_shot('00000000-0000-0000-0000-000000253a01', 'wedge', 16, 0, 0, 0)$q$, 'A chip from the fringe still plays');
reset role;

-- Ada reads it on Admin.
select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_golf_putting_overview() ->> 'fringe_putts_7d')::int, 1, 'Admin counts the putt from the fringe');
select is((public.admin_golf_putting_overview() ->> 'fringe_made_7d')::int, 1, 'and that it dropped');
select is((public.admin_golf_putting_overview() ->> 'fringe_putters_7d')::int, 1, 'and who putted');
reset role;

select * from finish();
