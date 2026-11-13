-- 0202: the Hound Open — Golf as a Global Hound Challenge: publishing and
-- setup, joining without a cap, banks from the join day, the leaderboard,
-- the top-10 push, the sponsor's hole, ending only at the end, and
-- payouts where a tie shares the places.
select plan(46);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
select (now() at time zone 'America/New_York')::date as today \gset

-- Ann and Bob are friends; Ann and Cat are in a club.
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bob', 'accepted');
insert into public.clubs (id, code, name, sport, is_public, created_by)
  values ('00000000-0000-0000-0000-00000000c1b1', 'ZZOPEN', 'Morning Walkers', 'walking', true, :'ann');
insert into public.club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000c1b1', :'ann', 'owner'),
  ('00000000-0000-0000-0000-00000000c1b1', :'cat', 'member');

-- The plain test course from 0200's tests: nine straight par 4s.
insert into public.golf_courses (id, name, style, sort) values ('zztest', 'Test Park', 'park', 99);
insert into public.golf_holes (course_id, no, par, length, name, hole)
select 'zztest', k, 4, 400, 'Test ' || k, jsonb_build_object(
  'no', k, 'par', 4, 'length', 400, 'name', 'Test ' || k,
  'center', '[[0,0],[400,0]]'::jsonb, 'fairway_w', 20, 'fairway_from', 30, 'fairway_to', 388,
  'green', '{"d":400,"lat":0,"r":14,"break":0}'::jsonb, 'pin', '{"d":400,"lat":0}'::jsonb,
  'hazards', '[]'::jsonb, 'ob', 70, 'wind', '{"mph":0,"deg":90}'::jsonb, 'slope', null)
from generate_series(1, 9) k;

-- Marks someone as having swung (the field is whoever swung).
create function tests.swung(p_challenge uuid, p_user uuid) returns void language sql as $$
  insert into public.golf_shots (challenge_id, user_id, hole, seq, club, yards, aim, power, timing,
    from_d, from_lat, to_d, to_lat, ball_d, ball_lat, carry, lie, penalty, holed, picked_up, par, score, day)
  values (p_challenge, p_user, 1, 99, 'driver', 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 'tee', 0, false, false, 4, null, current_date);
$$;

-- ── Publishing and setting up ──

select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok($q$select public.publish_global_challenge('Short Open', 'golf', 2, now(), now() + interval '1 day')$q$,
  'A Global Golf runs 3 to 30 days.', 'A Global Golf runs at least 3 days');
select public.publish_global_challenge('The Hound Open', 'golf', 7, now() - interval '1 hour', now() + interval '3 days') as open \gset
select ok(:'open' is not null, 'Golf can be a Global Hound Challenge');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$select public.golf_setup_global(%L, 'zztest', 9, 0)$q$, :'open'),
  'Only an admin can set up a Global Golf.', 'Only an admin sets it up');
select throws_ok(format($q$select public.join_global_challenge(%L)$q$, :'open'),
  'This game isn''t set up yet.', 'Nobody joins before the course is set');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select lives_ok(format($q$select public.golf_setup_global(%L, 'zztest', 9, 0, 15)$q$, :'open'), 'The admin sets the course');
select throws_ok(format($q$select public.golf_setup_global(%L, 'zztest', 9, 0)$q$, :'open'),
  'This game is already set up.', 'Only once');
reset role;
select is((select array[format, hands_on::text, finish_bones::text] from public.golf_games where challenge_id = :'open'),
  array['stroke', 'true', '15'], 'Stroke play, everyone takes their own shots, its own finish Bones');

-- It began two days ago (so there are days before anyone joined).
update public.challenges set starts_at = now() - interval '2 days', start_day = :'today'::date - 2 where id = :'open';

-- ── Joining: no cap ──

select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok(format($q$select public.join_global_challenge(%L)$q$, :'open'), 'Ann joins');
reset role;
insert into public.challenge_participants (challenge_id, user_id) select :'open', u from unnest(array[:'bob', :'cat', :'dan']::uuid[]) u;
create temp table fill as select tests.new_user('Fil' || k) as id, k from generate_series(1, 24) k;
insert into public.challenge_participants (challenge_id, user_id) select :'open', id from fill;
select is((select count(*)::int from public.golf_players where challenge_id = :'open' and joined), 28,
  'Twenty-eight in: no 12-player cap in a global game');

-- ── Banks count from the day you join ──

update public.golf_players set seated_at = now() - interval '3 days' where challenge_id = :'open' and user_id = :'bob';
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  (:'open', :'ann', :'today'::date - 2, 50000),
  (:'open', :'ann', :'today'::date, 30000),
  (:'open', :'bob', :'today'::date - 2, 50000);
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min) values
  (:'ann', 'o1', 'Traditional Strength Training', ((:'today'::date - 1) + time '16:00') at time zone 'America/New_York', 'healthkit', 15),
  (:'ann', 'o2', 'Running', (:'today'::date + time '07:00') at time zone 'America/New_York', 'healthkit', 10);
select is(public.golf_banks(:'open', :'ann'), '{"steps": 30000, "yards": 3000, "power": 10}'::jsonb,
  'Ann joined today: steps and workouts from before don''t count');
select is((public.golf_banks(:'open', :'bob') ->> 'yards')::int, 5000, 'Bob joined before the start: from the first day');

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.golf_view(:'open') ->> 'is_global')::boolean, true, 'The view says it''s global');
select is(jsonb_array_length(public.golf_view(:'open') -> 'players'), 1, 'A global view lists only you');
select is((public.golf_view(:'open') ->> 'finish_bones')::int, 15, 'And the finish Bones');
reset role;

-- ── The field: 24 others who've swung, at +1 or +2 ──

update public.golf_players g set scores[1] = 5 + (f.k % 2), hole = 2
  from fill f where g.challenge_id = :'open' and g.user_id = f.id;
select tests.swung(:'open', id) from fill;

-- ── Ann plays the 1st for real: a birdie, and into the top 10 ──

select tests.sign_in(:'ann');
set local role authenticated;
select public.golf_shot(:'open', 'driver', 250, 0, 0, 0) as s1 \gset
select public.golf_shot(:'open', 'i9', 130, 0, 0, 0) as s2 \gset
select is((:'s2'::jsonb) ->> 'lie', 'green', 'On in two');
select public.golf_shot(:'open', 'putter',
  round(sqrt(power(400 - ((:'s2'::jsonb) -> 'ball' ->> 'd')::numeric, 2) + power(((:'s2'::jsonb) -> 'ball' ->> 'lat')::numeric, 2)))::int, 0, 0, 0) as s3 \gset
select is((:'s3'::jsonb) ->> 'holed', 'true', 'Holed');
select is((:'s3'::jsonb) -> 'sponsor_bonus', 'null'::jsonb, 'No sponsor bonus off the sponsor''s hole');
reset role;
select ok((select top10_at is not null from public.golf_players where challenge_id = :'open' and user_id = :'ann'),
  'Ann''s into the top 10 of a 25-strong field: the push goes once');

-- ── The sponsor's hole ──

select tests.sign_in(:'ada');
set local role authenticated;
select public.set_challenge_sponsor_v2(:'open', '{"name": "Acme Running Co.", "url": "https://acme.example", "hole": 2, "hole_bones": 5}'::jsonb);
reset role;
update public.golf_players set ball_d = 399, ball_lat = 0, lie = 'green', strokes = 1
  where challenge_id = :'open' and user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select public.golf_shot(:'open', 'putter', 1, 0, 0, 0) as s4 \gset
select is((:'s4'::jsonb) ->> 'hole_score', '2', 'An eagle on the sponsor''s hole');
select is((:'s4'::jsonb) ->> 'sponsor_bonus', '5', 'The sponsor adds 5 Bones');
select ok((:'s4'::jsonb) ->> 'message' like '%Acme Running Co. adds 5 Bones.', 'And says so');
reset role;
select is((select sponsor_bones from public.golf_players where challenge_id = :'open' and user_id = :'ann'), 5,
  'Held for the end');

-- ── The board ──

update public.golf_players set scores[1] = 3, hole = 2 where challenge_id = :'open' and user_id = :'bob';
select tests.swung(:'open', :'bob');
update public.golf_players set scores[1] = 6, hole = 2 where challenge_id = :'open' and user_id = :'cat';
select tests.swung(:'open', :'cat');
-- Ann is 3, 2 (−3 thru 2); Bob 3 (−1 thru 1); Cat +2; the field +1/+2; Dan hasn't swung.

select tests.sign_in(:'dan');
set local role authenticated;
select public.golf_open_board(:'open', 'top') as b \gset
reset role;
select is(array[(:'b'::jsonb ->> 'field')::int, (:'b'::jsonb ->> 'swung')::int], array[28, 27], '28 joined, 27 swung');
select is(jsonb_array_length(:'b'::jsonb -> 'rows'), 26, 'The top 25, then Dan');
select is((:'b'::jsonb -> 'rows' -> 0 ->> 'user_id'), :'ann', 'Ann leads');
select is((:'b'::jsonb -> 'rows' -> 0 -> 'best'), '{"diff": -2, "hole": 2}'::jsonb, 'Her best hole: the eagle on the 2nd');
select is((:'b'::jsonb -> 'rows' -> 25 ->> 'pos'), null, 'Dan hasn''t swung: no place');
select is((:'b'::jsonb ->> 'more')::int, 2, 'Two more between the 25th and Dan');
select is((:'b'::jsonb -> 'me' ->> 'pos'), null, 'Dan''s own card has no place yet');

select tests.sign_in(:'ann');
set local role authenticated;
select public.golf_open_board(:'open', 'friends') as f \gset
select public.golf_open_board(:'open', 'club') as c \gset
select throws_ok(format($q$select public.golf_open_board(%L, 'everyone')$q$, :'open'), 'Pick Top, Friends or My club.', 'Three tabs');
reset role;
select is((select jsonb_agg(x ->> 'user_id' order by o) from jsonb_array_elements(:'f'::jsonb -> 'rows') with ordinality t(x, o)),
  jsonb_build_array(:'ann', :'bob'), 'Friends: Ann and Bob');
select is((:'f'::jsonb -> 'rows' -> 1 ->> 'is_friend')::boolean, true, 'Bob is her friend');
select is((select jsonb_agg(x ->> 'user_id' order by o) from jsonb_array_elements(:'c'::jsonb -> 'rows') with ordinality t(x, o)),
  jsonb_build_array(:'ann', :'cat'), 'My club: Ann and Cat');
select is(:'c'::jsonb -> 'club' ->> 'name', 'Morning Walkers', 'Named');
select is((:'f'::jsonb -> 'me' ->> 'pos')::int, 1, 'Ann is 1st');

-- Ties share a place; the night's mark shows who moved.
select public.golf_advance_all();
update public.golf_players set scores[2] = 2 where challenge_id = :'open' and user_id = :'bob';
select tests.sign_in(:'bob');
set local role authenticated;
select public.golf_open_board(:'open', 'top') as b2 \gset
reset role;
select is(:'b2'::jsonb -> 'me' -> 'pos', '1'::jsonb, 'Bob catches Ann at −3');
select is((:'b2'::jsonb -> 'me' ->> 'tied')::boolean, true, 'T1');
select is((:'b2'::jsonb -> 'me' ->> 'moved')::int, 1, 'Up one since the night''s mark');

-- ── It ends at its end, not when everyone so far has finished ──

update public.golf_players set finished_at = now() where challenge_id = :'open';
select is(public.golf_check_end(:'open', false), false, 'A global game keeps going while it''s on');
update public.golf_players set finished_at = null where challenge_id = :'open';

select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_golf_overview() -> 'open' ->> 'players')::int, 28, 'Admin sees the Open''s field');
reset role;

-- ── The end: places, a tie sharing them ──

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day, is_global, join_closes_at, prize_bones)
values ('00000000-0000-0000-0000-0000000009f1', 'Last Open', 'golf', :'ada', 4, now() - interval '5 days', now() - interval '1 hour',
  :'today'::date - 5, true, now() - interval '3 days', array[500, 250, 100]);
select tests.sign_in(:'ada');
set local role authenticated;
select public.golf_setup_global('00000000-0000-0000-0000-0000000009f1', 'zztest', 9, 0, 15);
reset role;
insert into public.challenge_participants (challenge_id, user_id)
select '00000000-0000-0000-0000-0000000009f1', u from unnest(array[:'ann', :'bob', :'cat', :'dan', :'ada']::uuid[]) u;
update public.golf_players set scores = array[4,4,4,4,4,4,4,3,3], finished_at = now(), sponsor_bones = 5
  where challenge_id = '00000000-0000-0000-0000-0000000009f1' and user_id = :'ann';
update public.golf_players set scores = array[4,4,4,4,4,4,4,4,4], finished_at = now()
  where challenge_id = '00000000-0000-0000-0000-0000000009f1' and user_id in (:'bob', :'cat', :'dan');
select tests.swung('00000000-0000-0000-0000-0000000009f1', u) from unnest(array[:'ann', :'bob', :'cat', :'dan']::uuid[]) u;
select public.settle_challenge_score('00000000-0000-0000-0000-0000000009f1');
select is((select winner::text from public.golf_games where challenge_id = '00000000-0000-0000-0000-0000000009f1'), :'ann', 'Ann wins');
select is((select jsonb_object_agg(case user_id when :'ann'::uuid then 'ann' when :'bob'::uuid then 'bob' else 'x' end, bones_points)
           from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000009f1' and kind = 'golf_result'
             and user_id in (:'ann', :'bob')),
  '{"ann": 25, "bob": 20}'::jsonb, 'Finish Bones 15 + 5, plus the sponsor''s 5 for Ann; no win Bones (the places pay)');
select is((select count(*)::int from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000009f1' and kind = 'golf_result'), 4,
  'Only those who swung are paid (Ada joined and never played)');
select public.pay_global_places('00000000-0000-0000-0000-0000000009f1');
select is((select jsonb_object_agg(case user_id when :'ann'::uuid then 'ann' when :'bob'::uuid then 'bob' when :'cat'::uuid then 'cat' else 'dan' end, bones_points)
           from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000009f1' and kind = 'global_place'),
  '{"ann": 500, "bob": 116, "cat": 116, "dan": 116}'::jsonb, '1st 500; three tied 2nd share 2nd and 3rd: 350 ÷ 3');

select tests.sign_in(:'cat');
set local role authenticated;
select public.golf_open_board('00000000-0000-0000-0000-0000000009f1', 'top') as fin \gset
reset role;
select is(:'fin'::jsonb ->> 'status', 'final', 'Final');
select is((select jsonb_agg(jsonb_build_array(x -> 'place', x -> 'bones') order by o) from jsonb_array_elements(:'fin'::jsonb -> 'podium') with ordinality t(x, o)),
  '[[1, 500], [2, 116], [2, 116], [2, 116]]'::jsonb, 'The podium, with what each place paid');

select * from finish();
