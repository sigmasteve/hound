-- 0284: which golf scores send a push is Admin's, for every golf game.
select plan(7);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bo') as bo \gset
select tests.new_user('Ada', true) as ada \gset
select (now() at time zone 'America/New_York')::date as today \gset

-- Pushes are noted here instead of sent.
create temp table pushes (kind text, recipient uuid);
grant all on pushes to public;
create or replace function public.golf_notify(p_kind text, p_challenge_id uuid, p_recipient uuid, p_extra jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public, pg_temp
as $$ insert into pg_temp.pushes values (p_kind, p_recipient); $$;

-- One straight par 4 with a flat green: the pin at 400.
insert into public.golf_courses (id, name, style, sort) values ('zzpush', 'Push Park', 'park', 99);
insert into public.golf_holes (course_id, no, par, length, name, hole)
select 'zzpush', k, 4, 400, 'Push ' || k, jsonb_build_object(
  'no', k, 'par', 4, 'length', 400, 'name', 'Push ' || k,
  'center', '[[0,0],[400,0]]'::jsonb, 'fairway_w', 20, 'fairway_from', 30, 'fairway_to', 388,
  'green', '{"d":400,"lat":0,"r":14,"break":0}'::jsonb, 'pin', '{"d":400,"lat":0}'::jsonb,
  'hazards', '[]'::jsonb, 'ob', 70, 'wind', '{"mph":0,"deg":90}'::jsonb, 'slope', null)
from generate_series(1, 9) k;

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-000000284a01', 'Pushes', 'golf', :'ann', 4, now() - interval '1 day', now() + interval '3 days', :'today'::date - 1);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-000000284a01', :'ann');
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-000000284a01', :'ann', :'today'::date - 1, 20000);

select tests.sign_in(:'ann');
set local role authenticated;
select public.golf_setup('00000000-0000-0000-0000-000000284a01', 'zzpush', 9, 'stroke', true, 0, array[:'ann', :'bo']::uuid[]);
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-000000284a01', :'bo');
update public.golf_players set joined = true where challenge_id = '00000000-0000-0000-0000-000000284a01';

select is((select push_min from public.golf_config where id), 'birdie', 'Birdies to start with, as before');

-- A birdie: a 1-yard putt in on the third shot.
update public.golf_players set lie = 'green', ball_d = 399, ball_lat = 0, strokes = 2, hole = 1
  where challenge_id = '00000000-0000-0000-0000-000000284a01' and user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select public.golf_shot('00000000-0000-0000-0000-000000284a01', 'putter', 1, 0, 0, 0);
reset role;
select is((select count(*)::int from pg_temp.pushes where kind = 'birdie' and recipient = :'bo'), 1, 'A birdie tells Bo');

-- Admin: eagles only.
select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok($$select public.admin_set_golf_config('{"push_min": "par"}')$$, 'Score pushes: birdie, eagle, ace or none.', 'Only the four settings');
select lives_ok($$select public.admin_set_golf_config('{"push_min": "eagle"}')$$, 'Eagle or better');
reset role;

delete from pg_temp.pushes where true;
update public.golf_players set lie = 'green', ball_d = 399, ball_lat = 0, strokes = 2
  where challenge_id = '00000000-0000-0000-0000-000000284a01' and user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select public.golf_shot('00000000-0000-0000-0000-000000284a01', 'putter', 1, 0, 0, 0);
reset role;
select is((select count(*)::int from pg_temp.pushes where kind = 'birdie'), 0, 'Now a birdie sends nothing');

-- An eagle: in on the second shot.
update public.golf_players set lie = 'green', ball_d = 399, ball_lat = 0, strokes = 1
  where challenge_id = '00000000-0000-0000-0000-000000284a01' and user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select public.golf_shot('00000000-0000-0000-0000-000000284a01', 'putter', 1, 0, 0, 0);
reset role;
select is((select count(*)::int from pg_temp.pushes where kind = 'birdie' and recipient = :'bo'), 1, 'An eagle still tells Bo');
select is((select count(*)::int from pg_temp.pushes where recipient = :'ann'), 0, 'Never yourself');

select * from finish();
