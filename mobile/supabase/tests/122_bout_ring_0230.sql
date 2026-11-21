-- 0230: the new ring's scoring. A combination that lands three with two
-- power punches is a knockdown, a Star punch counts as two power, the
-- knocked-down hound loses its stars, counters score 2; the openings
-- follow the guard; dodges; and Admin's numbers.
select plan(10);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select (now() at time zone 'utc')::date
  - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end as cutoff \gset

select is(array[public.ring_dodge_ok('jab', null, 'left'), public.ring_dodge_ok('jab', null, 'duck'), public.ring_dodge_ok('up', null, 'back'),
                public.ring_dodge_ok('hook', 'L', 'left'), public.ring_dodge_ok('hook', 'L', 'right'), public.ring_dodge_ok('hook', 'R', 'duck')],
  array[true, false, true, true, false, true], 'Jabs either side, uppercuts lean back, hooks away or under');
select ok((select bool_and(public.ring_openings('high') ?| array['up', 'jab', 'hookL', 'hookR']) from generate_series(1, 20)), 'Three openings each time');
-- A fresh draw for each g (an argument that doesn't depend on g is drawn once).
select ok((select count(*) from generate_series(1, 200) g, jsonb_array_elements_text(public.ring_openings(case when g > 0 then 'body' end)) k where k like 'hook%')
          > (select count(*) from generate_series(1, 200) g, jsonb_array_elements_text(public.ring_openings(case when g > 0 then 'high' end)) k where k like 'hook%'),
  'A body guard shows more hooks than a high guard');

-- Round 1, already fought: Ann's combination of hook, uppercut, jab all
-- land (two power: a knockdown); Bob's star uppercut and two jabs land
-- (a star is two power: a knockdown), and Ann counters once.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000c0001', 'Ring Night', 'bout', :'ann', 3,
   (:'cutoff'::date)::timestamp at time zone 'utc', (:'cutoff'::date + 3)::timestamp at time zone 'utc', :'cutoff'::date);
insert into public.bout_games (challenge_id, rounds) values ('00000000-0000-0000-0000-0000000c0001', 3);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000c0001', :'ann'), ('00000000-0000-0000-0000-0000000c0001', :'bob');
insert into public.ring_exchanges (id, game, challenge_id, round, day, attacker, defender, guard, openings, finished_at) values
  (900001, 'bout', '00000000-0000-0000-0000-0000000c0001', 1, :'cutoff', :'ann', :'bob', 'high', '["hookL","up","jab"]', now()),
  (900002, 'bout', '00000000-0000-0000-0000-0000000c0001', 1, :'cutoff', :'bob', :'ann', 'high', '["up","jab","jab"]', now());
insert into public.bout_punches (challenge_id, user_id, target, day, round, punch, pos, quality, guard, points, exchange_id, seq, side, star, slip) values
  ('00000000-0000-0000-0000-0000000c0001', :'ann', :'bob', :'cutoff', 1, 'hook', 90, 'perfect', 'high', 2, 900001, 0, 'L', false, 'taken'),
  ('00000000-0000-0000-0000-0000000c0001', :'ann', :'bob', :'cutoff', 1, 'up', 90, 'perfect', 'high', 3, 900001, 1, null, false, 'taken'),
  ('00000000-0000-0000-0000-0000000c0001', :'ann', :'bob', :'cutoff', 1, 'jab', 90, 'perfect', 'high', 1, 900001, 2, null, false, 'taken'),
  ('00000000-0000-0000-0000-0000000c0001', :'bob', :'ann', :'cutoff', 1, 'up', 90, 'perfect', 'high', 6, 900002, 0, null, true, 'taken'),
  ('00000000-0000-0000-0000-0000000c0001', :'bob', :'ann', :'cutoff', 1, 'jab', 90, 'perfect', 'high', 1, 900002, 1, null, false, 'taken'),
  ('00000000-0000-0000-0000-0000000c0001', :'bob', :'ann', :'cutoff', 1, 'jab', 90, 'perfect', 'high', 1, 900002, 2, null, false, 'taken'),
  ('00000000-0000-0000-0000-0000000c0001', :'ann', :'bob', :'cutoff', 1, 'jab', 100, 'perfect', 'counter', 2, 900002, 11, null, false, 'taken');
update public.bout_punches set counter = true where exchange_id = 900002 and seq = 11;
select public.ring_set_stars('bout', '00000000-0000-0000-0000-0000000c0001', :'ann', 2);
select public.ring_set_stars('bout', '00000000-0000-0000-0000-0000000c0001', :'bob', 3);

select public.bout_advance('00000000-0000-0000-0000-0000000c0001');
select is((select count(*)::int from public.bout_punches where exchange_id = 900001 and knockdown), 1, 'Three land, two of them power: a knockdown');
select is((select count(*)::int from public.bout_punches where exchange_id = 900002 and knockdown and user_id = :'bob'), 1,
  'A Star punch and two jabs land: the star counts as two power, a knockdown');
select is((select array[a_points, b_points, a_down, b_down] from public.bout_rounds where challenge_id = '00000000-0000-0000-0000-0000000c0001' and round = 1),
  array[8, 8, 1, 1], 'Ann 6 + a counter''s 2; Bob 6 + 1 + 1; one down each');
select is((select array_agg(stars order by user_id = :'ann' desc) from public.ring_stars where challenge_id = '00000000-0000-0000-0000-0000000c0001'),
  array[0, 0], 'Knocked down: the stars go');

-- Admin
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.admin_ring_overview()$q$, 'not authorized', 'Admins only');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select ok((public.admin_ring_overview() ->> 'counters_7d')::int >= 1, 'Admin sees the counters');
select ok((public.admin_ring_overview() ->> 'combo_knockdowns_7d')::int >= 2, 'and knockdowns from combinations');
reset role;

select * from finish();
