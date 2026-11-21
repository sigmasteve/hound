-- 0236: Hound Roulette. The multiplier and targets, the spin (seeded, once a
-- day, no banking after it), tasks done from evidence, All in, a Raid that
-- takes a lost ride, a Raid too late, a Duel called, accepted and won, a
-- Duel turned down, banking, the end (rides banked, Bones, the Lucky
-- Bandana), and Admin.
select plan(38);

select is(public.roulette_mult(1), 1::numeric, 'One day riding: x1');
select is(public.roulette_mult(2), 1.5::numeric, 'Two: x1.5');
select is(public.roulette_mult(9), 3::numeric, 'Capped at x3');

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cy') as cy \gset
select tests.new_user('Dee') as dee \gset
select tests.new_user('Eve') as eve \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob', :'cy', :'dee', :'eve');
select public.soccer_today(:'ann') as today \gset

select is(public.roulette_target('steps', 'bold', :'ann', :'today'), 6500, 'No steps on record: Bold is 5,000 x 1.25, to the 500');
select is(public.roulette_target('steps', 'allin', :'ann', :'today'), 8000, 'All in: x 1.6');
select is(public.roulette_target('workout', 'safe', :'ann', :'today'), 10, 'Safe workout: 10 minutes');
select is(public.roulette_target('water', 'bold', :'ann', :'today'), 1893, 'Bold water: the goal');
select ok(public.roulette_segment('00000000-0000-0000-0000-0000000e0101', :'ann', :'today')
  in ('steps', 'workout', 'water', 'free', 'goals', 'walk', 'double', 'cheer', 'steps2', 'pick'), 'The wheel lands on a slot');
select is(public.roulette_segment('00000000-0000-0000-0000-0000000e0101', :'ann', :'today'),
  public.roulette_segment('00000000-0000-0000-0000-0000000e0101', :'ann', :'today'), 'and the same slot every time');

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000e0101', 'Spin City', 'roulette', :'ann', 7,
   (:'today'::date)::timestamp at time zone 'America/New_York', (:'today'::date + 7)::timestamp at time zone 'America/New_York', :'today'::date);
insert into public.challenge_participants (challenge_id, user_id)
  select '00000000-0000-0000-0000-0000000e0101', u from unnest(array[:'ann', :'bob', :'cy', :'dee', :'eve']::uuid[]) u;

-- ── The spin ──
select public.roulette_segment('00000000-0000-0000-0000-0000000e0101', :'eve', :'today') as eveseg \gset
select tests.sign_in(:'eve');
set local role authenticated;
select throws_ok($$select public.roulette_spin('00000000-0000-0000-0000-0000000e0101', 'lucky')$$, 'Pick a stake: Safe, Bold or All in.', 'Three stakes');
select is((public.roulette_spin('00000000-0000-0000-0000-0000000e0101', 'bold') -> 'spin' ->> 'segment'),
  :'eveseg', 'Spun: today''s slot');
select throws_ok($$select public.roulette_spin('00000000-0000-0000-0000-0000000e0101', 'safe')$$, 'You''ve spun today. Back tomorrow.', 'Once a day');
select throws_ok($$select public.roulette_bank('00000000-0000-0000-0000-0000000e0101')$$, 'Bank before you spin: tomorrow morning.', 'No banking after the spin');
reset role;

-- ── Done from evidence ──
insert into public.roulette_spins (challenge_id, user_id, day, stake, segment, task, target)
  values ('00000000-0000-0000-0000-0000000e0101', :'bob', :'today'::date - 1, 'bold', 'steps', 'steps', 3000);
insert into public.daily_step_totals (user_id, day, steps) values (:'bob', :'today'::date - 1, 4000);
select is((select jsonb_build_object('ride', ride, 'days', ride_days) from public.roulette_players where challenge_id = '00000000-0000-0000-0000-0000000e0101' and user_id = :'bob'),
  '{"ride": 3, "days": 1}'::jsonb, 'Steps synced: Bold''s 3 on the ride');
insert into public.roulette_spins (challenge_id, user_id, day, stake, segment, task, target)
  values ('00000000-0000-0000-0000-0000000e0101', :'bob', :'today', 'allin', 'water', 'water', 100);
insert into public.water_log (user_id, day, ml) values (:'bob', :'today', 200);
select is((select ride from public.roulette_players where challenge_id = '00000000-0000-0000-0000-0000000e0101' and user_id = :'bob'), 6, 'All in and done: the ride doubles');

-- ── A Raid ──
insert into public.roulette_players (challenge_id, user_id, banked) values ('00000000-0000-0000-0000-0000000e0101', :'ann', 5);
insert into public.roulette_spins (challenge_id, user_id, day, stake, segment, task, target, status, points, done_at)
  values ('00000000-0000-0000-0000-0000000e0101', :'cy', :'today'::date - 1, 'bold', 'workout', 'workout', 20, 'done', 4, now());
insert into public.roulette_players (challenge_id, user_id, ride, ride_days, last_done_day) values ('00000000-0000-0000-0000-0000000e0101', :'cy', 4, 1, :'today'::date - 1);
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format('select public.roulette_raid(%L, %L)', '00000000-0000-0000-0000-0000000e0101', :'bob'), 'Too late: they''ve made today''s task.', 'Can''t raid a task that''s done');
select is((public.roulette_raid('00000000-0000-0000-0000-0000000e0101', :'cy') -> 'myRaid' ->> 'name'), 'Cy', 'Raiding Cy');
select throws_ok(format('select public.roulette_raid(%L, %L)', '00000000-0000-0000-0000-0000000e0101', :'dee'), 'One Raid a day: you''ve sent today''s.', 'One Raid sent a day');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok(format('select public.roulette_raid(%L, %L)', '00000000-0000-0000-0000-0000000e0101', :'cy'), 'Someone''s already raiding them today.', 'One Raid on a person a day');
reset role;
select is((select banked from public.roulette_players where challenge_id = '00000000-0000-0000-0000-0000000e0101' and user_id = :'ann'), 3, 'The Raid costs 2');
-- Cy's day ends with no spin: the ride goes, to Ann.
select is(public.roulette_settle_member('00000000-0000-0000-0000-0000000e0101', :'cy', :'today'), 4, 'Cy loses a ride of 4');
select is((select banked from public.roulette_players where challenge_id = '00000000-0000-0000-0000-0000000e0101' and user_id = :'ann'), 9, 'Ann takes it, and her 2 back');
select is((select status from public.roulette_raids where target = :'cy'), 'won', 'The Raid is won');

-- ── Duels ──
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format('select public.roulette_duel_call(%L, %L, 5)', '00000000-0000-0000-0000-0000000e0101', :'bob'), 'They''ve only 0 banked: call them for that or less.', 'They need the stake banked');
reset role;
update public.roulette_players set banked = 10 where challenge_id = '00000000-0000-0000-0000-0000000e0101' and user_id = :'bob';
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.roulette_duel_call('00000000-0000-0000-0000-0000000e0101', :'bob', 5) -> 'duels' -> 0 ->> 'status'), 'open', 'Bob is called out for 5');
reset role;
select id as duel from public.roulette_duels where caller = :'ann' \gset
select tests.sign_in(:'bob');
set local role authenticated;
select is((public.roulette_duel_answer(:duel, true) -> 'duels' -> 0 ->> 'status'), 'on', 'Bob accepts');
reset role;
select is((select array_agg(banked order by user_id = :'ann' desc) from public.roulette_players where challenge_id = '00000000-0000-0000-0000-0000000e0101' and user_id in (:'ann', :'bob')),
  array[4, 5], 'Both stakes held');
insert into public.daily_step_totals (user_id, day, steps) values (:'ann', :'today'::date + 1, 10000), (:'bob', :'today'::date + 1, 6000);
select public.roulette_duel_resolve(:duel);
select is((select winner from public.roulette_duels where id = :duel), :'ann'::uuid, 'Ann doubled her average; Bob went 1.5x his');
select is((select banked from public.roulette_players where challenge_id = '00000000-0000-0000-0000-0000000e0101' and user_id = :'ann'), 14, 'Ann takes both stakes');
select tests.sign_in(:'bob');
set local role authenticated;
select (public.roulette_duel_call('00000000-0000-0000-0000-0000000e0101', :'ann', 2) is not null) as called \gset
reset role;
select id as duel2 from public.roulette_duels where caller = :'bob' \gset
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.roulette_duel_answer(:duel2, false) -> 'banked')::int, 14, 'Turned down: nothing moves');
reset role;

-- ── Banking ──
insert into public.roulette_players (challenge_id, user_id, ride, ride_days, last_done_day) values ('00000000-0000-0000-0000-0000000e0101', :'dee', 4, 3, :'today'::date - 1);
select tests.sign_in(:'dee');
set local role authenticated;
select is((public.roulette_bank('00000000-0000-0000-0000-0000000e0101') -> 'banked')::int, 8, 'Three days riding: 4 x 2 banked');
select throws_ok($$select public.roulette_bank('00000000-0000-0000-0000-0000000e0101')$$, 'Nothing riding to bank.', 'Nothing left to bank');
reset role;

-- ── The end ──
update public.challenges set duration_days = 1, ends_at = now() - interval '1 hour' where id = '00000000-0000-0000-0000-0000000e0101';
select public.settle_challenge_score_core('00000000-0000-0000-0000-0000000e0101');
select is((select banked from public.roulette_players where challenge_id = '00000000-0000-0000-0000-0000000e0101' and user_id = :'bob'), 14, 'Bob''s ride of 6, done today, banked at x1.5');
select is((select array_agg(a.score_points order by a.user_id = :'ann' desc) from public.activity_events a where a.challenge_id = '00000000-0000-0000-0000-0000000e0101' and a.user_id in (:'ann', :'bob')),
  array[50, 50], 'Level at the top: both first');
select is((select bones_points from public.activity_events a where a.challenge_id = '00000000-0000-0000-0000-0000000e0101' and a.user_id = :'dee'), 23, 'Dee: 5 + 10 for finishing + 8 banked');
select is((select count(*)::int from public.kennel_purchases k where k.item_id = 'bandana_lucky' and k.user_id in (:'ann', :'bob', :'cy', :'dee')), 2, 'The Lucky Bandana for the winners');

-- ── Admin ──
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.admin_roulette_overview()$$, 'not authorized', 'Admins only');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select is((select jsonb_build_object('raids', o -> 'raids7d' -> 'won', 'called', o -> 'duels7d' -> 'called', 'accepted', o -> 'duels7d' -> 'accepted', 'bandanas', o -> 'bandanas')
  from public.admin_roulette_overview() o),
  '{"raids": 1, "called": 2, "accepted": 1, "bandanas": 2}'::jsonb, 'Admin: Raids, Duels and Bandanas');
reset role;

select * from finish();
