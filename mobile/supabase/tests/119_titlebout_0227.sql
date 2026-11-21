-- 0227: the Title Bout. Publishing and setup, joining, the day's pairing
-- (two by two, the odd one out against a sparring hound), a punch and a
-- slip, the ladder scored the morning after (a KO win 3, a points win 2),
-- the title fight set after day 5, free picks and the tale of the tape,
-- a KO in round 1 for the belt, the payout (places, most KOs, the picks:
-- double for a right underdog pick), the replay, and Admin.
select plan(49);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
select tests.new_user('Eve') as eve \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob', :'cat', :'dan', :'eve');
select public.soccer_today(:'ann') as today \gset
select (now() at time zone 'utc')::date
  - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end as cutoff \gset

-- ── Publishing and setting up ──

select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok($q$select public.publish_global_challenge('Short Bout', 'titlebout', 5, now(), now() + interval '1 day')$q$,
  'The Title Bout runs 7 days: 5 on the ladder, then the title fight.', 'A Title Bout is 7 days');
select throws_ok($q$select public.publish_global_challenge('Late Bout', 'titlebout', 7, now(), now() + interval '5 days')$q$,
  'Joining the Title Bout closes by the end of day 3.', 'Joining closes by day 3');
select public.publish_global_challenge('Title Bout', 'titlebout', 7, now() - interval '1 hour', now() + interval '2 days') as tb \gset
select ok(:'tb' is not null, 'The Title Bout is a Global Hound Challenge');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$select public.titlebout_setup_global(%L)$q$, :'tb'), 'Only an admin can set up the Title Bout.', 'Only an admin sets it up');
select throws_ok(format($q$select public.join_global_challenge(%L)$q$, :'tb'), 'This Title Bout isn''t set up yet.', 'Nobody joins before it''s set up');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok(format($q$select public.titlebout_setup_global(%L, '{"champion":500}')$q$, :'tb'), 'Each prize is 0 to 5,000 Bones.', 'Every prize');
select throws_ok(format($q$select public.titlebout_setup_global(%L, null, 900)$q$, :'tb'), 'A right pick is worth 0 to 500 Bones.', 'Pick Bones in range');
select lives_ok(format($q$select public.titlebout_setup_global(%L)$q$, :'tb'), 'Set up with the default prizes');
select throws_ok(format($q$select public.titlebout_setup_global(%L)$q$, :'tb'), 'This Title Bout is already set up.', 'Once');
reset role;

-- ── Day 1 of a live one: three in, one pair and a sparring hound ──

update public.challenges set start_day = :'today'::date where id = :'tb';
insert into public.challenge_participants (challenge_id, user_id) values (:'tb', :'ann'), (:'tb', :'bob'), (:'tb', :'cat');
select is((select count(*)::int from public.tb_players where challenge_id = :'tb'), 3, 'Joining puts you on the ladder');
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
  select :'tb', u, :'today', 5000 from unnest(array[:'ann', :'bob', :'cat']::uuid[]) u;

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.tb_live(:'tb') -> 'tb' ->> 'phase', 'ladder', 'Day 1: the ladder');
reset role;
select is((select array[count(*), count(*) filter (where b is null)]::int[] from public.tb_fights where challenge_id = :'tb'), array[2, 1],
  'Three fighters: one pair, and the odd one out against a sparring hound');
select a as p1, b as p2 from public.tb_fights where challenge_id = :'tb' and b is not null \gset

select tests.sign_in(:'p1');
set local role authenticated;
select is((public.tb_live(:'tb') -> 'opponent' ->> 'id')::uuid, :'p2'::uuid, 'Your opponent today');
select (x ->> 'id')::bigint as ex1 from (select public.ring_exchange_start('titlebout', :'tb') x) z \gset
select is(public.ring_exchange_punch(:ex1, 0, 0.9) ->> 'quality', 'perfect', 'A perfect punch gets through any guard');
select is((public.tb_live(:'tb') -> 'day' ->> 'left')::int, 2, '5,000 steps: three actions, one used');
select public.ring_exchange_punch(:ex1, 1, 0.9);
select public.ring_exchange_punch(:ex1, 2, 0.9);
reset role;

select tests.sign_in(:'p2');
set local role authenticated;
select d from (select public.ring_defend_start('titlebout', :'tb') d) z \gset
select is((public.ring_defend_finish((:'d'::jsonb ->> 'id')::bigint,
    (select jsonb_agg(jsonb_build_object('dir', case p ->> 'punch' when 'jab' then 'left' when 'up' then 'back' else 'duck' end, 'dt', -100)
       order by (p ->> 'seq')::int) from jsonb_array_elements(:'d'::jsonb -> 'punches') p), 1) ->> 'stars')::int, 1,
  'Slipped all three tight and countered: a star');
select is(public.tb_set_guard(:'tb', 'body'), 'body', 'A body guard up');
select throws_ok($q$select public.tb_pick('$q$ || :'tb' || $q$', '$q$ || :'p1' || $q$')$q$, 'Picks are closed.', 'No picks before the title fight');
reset role;

-- ── One already through day 5 ──

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day, is_global, join_closes_at) values
  ('00000000-0000-0000-0000-0000000eb002', 'Title Night', 'titlebout', :'ada', 7,
   (:'cutoff'::date - 4)::timestamp at time zone 'utc', (:'cutoff'::date + 3)::timestamp at time zone 'utc', :'cutoff'::date - 4, true,
   (:'cutoff'::date - 2)::timestamp at time zone 'utc');
insert into public.tb_games (challenge_id) values ('00000000-0000-0000-0000-0000000eb002');
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000eb002', :'ann'), ('00000000-0000-0000-0000-0000000eb002', :'bob'), ('00000000-0000-0000-0000-0000000eb002', :'cat'),
  ('00000000-0000-0000-0000-0000000eb002', :'dan'), ('00000000-0000-0000-0000-0000000eb002', :'eve');
-- Seed the ladder's order (Ann, Bob, Cat, Dan, Eve) for day 1's pairing.
update public.tb_players set joined_day = :'cutoff'::date - 4,
    landed = case user_id when :'ann' then 50 when :'bob' then 40 when :'cat' then 30 when :'dan' then 20 else 10 end
  where challenge_id = '00000000-0000-0000-0000-0000000eb002';
select public.tb_ensure_day('00000000-0000-0000-0000-0000000eb002', :'cutoff'::date - 4);
select is((select array_agg(array[a::text, coalesce(b::text, 'bot')] order by id) from public.tb_fights where challenge_id = '00000000-0000-0000-0000-0000000eb002'),
  array[array[:'ann', :'bob'], array[:'cat', :'dan'], array[:'eve', 'bot']], 'Paired down the ladder, two by two');

-- Day 1: Ann lands nine uppercuts on Bob (three knockdowns: a KO), Bob a
-- jab; Cat two jabs to Dan's one; Eve a jab against the sparring hound.
select id as f1 from public.tb_fights where challenge_id = '00000000-0000-0000-0000-0000000eb002' and a = :'ann' \gset
select id as f2 from public.tb_fights where challenge_id = '00000000-0000-0000-0000-0000000eb002' and a = :'cat' \gset
select id as f3 from public.tb_fights where challenge_id = '00000000-0000-0000-0000-0000000eb002' and a = :'eve' \gset
insert into public.tb_punches (challenge_id, fight_id, user_id, target, day, punch, pos, quality, guard, points)
  select '00000000-0000-0000-0000-0000000eb002', :f1, :'ann', :'bob', :'cutoff'::date - 4, 'up', 50, 'clean', 'high', 3 from generate_series(1, 9);
insert into public.tb_punches (challenge_id, fight_id, user_id, target, day, punch, pos, quality, guard, points) values
  ('00000000-0000-0000-0000-0000000eb002', :f1, :'bob', :'ann', :'cutoff'::date - 4, 'jab', 50, 'clean', 'high', 1),
  ('00000000-0000-0000-0000-0000000eb002', :f2, :'cat', :'dan', :'cutoff'::date - 4, 'jab', 50, 'clean', 'high', 1),
  ('00000000-0000-0000-0000-0000000eb002', :f2, :'cat', :'dan', :'cutoff'::date - 4, 'jab', 50, 'clean', 'high', 1),
  ('00000000-0000-0000-0000-0000000eb002', :f2, :'dan', :'cat', :'cutoff'::date - 4, 'jab', 50, 'clean', 'high', 1),
  ('00000000-0000-0000-0000-0000000eb002', :f3, :'eve', null, :'cutoff'::date - 4, 'jab', 50, 'clean', 'high', 1);

select is(public.tb_advance('00000000-0000-0000-0000-0000000eb002'), 5, 'Five days scored');
select is((select array[result, ko::text] from public.tb_fights where id = :f1), array['a', 'true'], 'Ann KOs Bob');
select is((select array[result, a_score::text, b_score::text] from public.tb_fights where id = :f2), array['a', '10', '9'], 'Cat beats Dan on points, 10-9');
select is((select result from public.tb_fights where id = :f3), 'b', 'The sparring hound outpoints Eve''s one jab');
select is((select array_agg(pts order by user_id = :'ann' desc, user_id = :'cat' desc, user_id) from public.tb_players
           where challenge_id = '00000000-0000-0000-0000-0000000eb002' and user_id in (:'ann', :'cat', :'bob')), array[3, 2, 0],
  'A KO win 3, a points win 2, a loss 0');
select is((select array[title_a, title_b] from public.tb_games where challenge_id = '00000000-0000-0000-0000-0000000eb002'), array[:'ann', :'cat']::uuid[],
  'After day 5 the top two fight for the belt');
select is((select array_agg(day - (:'cutoff'::date - 4) + 1 order by round) from public.tb_fights where challenge_id = '00000000-0000-0000-0000-0000000eb002' and title),
  array[6, 7], 'Round 1 on day 6, round 2 on day 7');

-- ── The picks ──

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.tb_pick('00000000-0000-0000-0000-0000000eb002', '$q$ || :'ann' || $q$')$q$,
  'You’re in the title fight: no picking yourself.', 'The fighters don''t pick');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($q$select public.tb_pick('00000000-0000-0000-0000-0000000eb002', '$q$ || :'dan' || $q$')$q$,
  'Pick one of the two in the title fight.', 'Only the two fighters');
select is(public.tb_pick('00000000-0000-0000-0000-0000000eb002', :'cat') - 'pick', '{"a": 0, "b": 1}'::jsonb, 'Bob picks Cat');
select is(public.tb_live('00000000-0000-0000-0000-0000000eb002') -> 'tb' -> 'title' -> 'a' -> 'kos', '1'::jsonb, 'The tale of the tape: Ann''s KO');
select is(public.tb_live('00000000-0000-0000-0000-0000000eb002') -> 'tb' -> 'picks' ->> 'mine', :'cat', 'and Bob''s pick');
reset role;
select tests.sign_in(:'dan');
set local role authenticated;
select public.tb_pick('00000000-0000-0000-0000-0000000eb002', :'cat');
reset role;
select tests.sign_in(:'eve');
set local role authenticated;
select is(public.tb_pick('00000000-0000-0000-0000-0000000eb002', :'ann') - 'pick', '{"a": 1, "b": 2}'::jsonb, 'Eve takes the underdog');
reset role;

-- ── Day 6: Ann KOs Cat in round 1 ──

-- A day later: everything moves back a day.
update public.challenges set start_day = start_day - 1, starts_at = starts_at - interval '1 day', ends_at = ends_at - interval '1 day'
  where id = '00000000-0000-0000-0000-0000000eb002';
update public.tb_fights set day = day - 1 where challenge_id = '00000000-0000-0000-0000-0000000eb002';
update public.tb_punches set day = day - 1 where challenge_id = '00000000-0000-0000-0000-0000000eb002';
select id as t1 from public.tb_fights where challenge_id = '00000000-0000-0000-0000-0000000eb002' and title and round = 1 \gset
insert into public.tb_punches (challenge_id, fight_id, user_id, target, day, punch, pos, quality, guard, points)
  select '00000000-0000-0000-0000-0000000eb002', :t1, :'ann', :'cat', :'cutoff'::date, 'hook', 50, 'clean', 'body', 2 from generate_series(1, 9);
insert into public.kennels (user_id) values (:'ann') on conflict do nothing;

select is(public.tb_advance('00000000-0000-0000-0000-0000000eb002'), 1, 'Day 6 scored');
select is((select array[winner::text, method, ko_round::text] from public.tb_games where challenge_id = '00000000-0000-0000-0000-0000000eb002'),
  array[:'ann', 'ko', '1'], 'Ann takes the belt by KO in round 1');
select is((select count(*)::int from public.tb_fights where challenge_id = '00000000-0000-0000-0000-0000000eb002' and title), 1, 'No round 2 after a KO');
select ok(exists (select 1 from public.kennel_purchases where user_id = :'ann' and item_id = 'title_belt'), 'The belt is Ann''s');
select is((select body_id from public.kennels where user_id = :'ann'), 'title_belt', 'and her hound wears it');

select tests.sign_in(:'eve');
set local role authenticated;
select throws_ok($q$select public.tb_pick('00000000-0000-0000-0000-0000000eb002', '$q$ || :'cat' || $q$')$q$, 'Picks are closed.', 'Picks close at round 1''s scoring');
select is(jsonb_array_length(public.tb_replay('00000000-0000-0000-0000-0000000eb002', :t1) -> 'punches'), 9, 'Anyone in it can watch the title fight');
select throws_ok(format($q$select public.tb_replay('00000000-0000-0000-0000-0000000eb002', %s)$q$, :f1), 'That fight isn''t yours.', 'but not other people''s ladder fights');
reset role;

-- ── The payout ──

update public.challenges set ends_at = now() - interval '25 hours' where id = '00000000-0000-0000-0000-0000000eb002';
select public.settle_challenge_score('00000000-0000-0000-0000-0000000eb002');
set constraints all immediate;
select is((select status from public.tb_games where challenge_id = '00000000-0000-0000-0000-0000000eb002'), 'final', 'Over after day 7');
select is((select array[place, place_bones, kos_bones] from public.tb_players where challenge_id = '00000000-0000-0000-0000-0000000eb002' and user_id = :'ann'),
  array[1, 500, 150], 'The champion: 500, and most KOs 150');
select is((select array[place, place_bones] from public.tb_players where challenge_id = '00000000-0000-0000-0000-0000000eb002' and user_id = :'cat'),
  array[2, 250], 'The runner-up: 250');
select is((select array[place, place_bones] from public.tb_players where challenge_id = '00000000-0000-0000-0000-0000000eb002' and user_id = :'bob'),
  array[3, 100], 'Then the ladder: the top 10 get 100');
select is((select array_agg(bones order by user_id = :'eve' desc, user_id) from public.tb_picks where challenge_id = '00000000-0000-0000-0000-0000000eb002'),
  array[50, 0, 0], 'Eve picked the underdog champion: double, 50; Bob and Dan nothing');
select is((select bones_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000eb002' and user_id = :'eve' and kind = 'global_place'),
  150, 'Eve''s place and pick Bones in one go');
select public.tb_pay('00000000-0000-0000-0000-0000000eb002');
select is((select count(*)::int from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000eb002' and kind = 'global_place'), 5, 'Paid once');

-- ── Admin ──

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.admin_titlebout_overview()$q$, 'not authorized', 'Admins only');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select is(public.admin_titlebout_overview() -> 'picks_right', '1'::jsonb, 'Admin sees the picks');
reset role;

select * from finish();
