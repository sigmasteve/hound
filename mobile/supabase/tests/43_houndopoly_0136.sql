-- 0135/0136: Hound'opoly. Joining seats you on Start with the starting
-- cash; a day's steps pick your dice and the roll waits until the day
-- is over everywhere; landing on a square for sale holds it for you to
-- buy or pass; rent goes to the owner, doubled for a whole group; the
-- Vet costs; passing Start pays; running dry makes you bankrupt; and
-- the richest places first at settlement.
select plan(29);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Zed', true) as zed \gset
select (now() at time zone 'utc')::date as today \gset

-- A 21-day game that started 4 days ago.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day)
values ('99999999-0000-0000-0000-000000000010', 'Office Walkers', 'houndopoly', :'ann', 21, now() - interval '4 days', now() + interval '17 days', :'today'::date - 4);
insert into public.challenge_participants (challenge_id, user_id) values
  ('99999999-0000-0000-0000-000000000010', :'ann'), ('99999999-0000-0000-0000-000000000010', :'bob');
-- They joined four days ago too.
update public.houndopoly_players set joined_day = :'today'::date - 4 where challenge_id = '99999999-0000-0000-0000-000000000010';

select is((select count(*)::int from public.houndopoly_players where challenge_id = '99999999-0000-0000-0000-000000000010'), 2, 'Joining seats both players');
select is((select cash || '/' || position from public.houndopoly_players where challenge_id = '99999999-0000-0000-0000-000000000010' and user_id = :'ann'),
  '1500/0', 'on Start with the starting cash');
select is((select count(*)::int from public.houndopoly_squares), 24, 'A board of 24 squares');

-- A Step Race doesn't seat anyone.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
values ('99999999-0000-0000-0000-000000000011', 'Not a game', 'steps', :'ann', 3, now() - interval '1 day', now() + interval '2 days');
insert into public.challenge_participants (challenge_id, user_id) values ('99999999-0000-0000-0000-000000000011', :'ann');
select is((select count(*)::int from public.houndopoly_players where challenge_id = '99999999-0000-0000-0000-000000000011'), 0, 'A Step Race seats nobody');

-- ── Dice from steps ──────────────────────────────────────────────────
select is(public.houndopoly_dice(1500, s), 0, 'Under 2,000 steps: no roll') from public.houndopoly_settings s;
select is(public.houndopoly_dice(5999, s), 1, 'Under 6,000: one die') from public.houndopoly_settings s;
select is(public.houndopoly_dice(11999, s), 2, 'Under 12,000: two dice') from public.houndopoly_settings s;
select is(public.houndopoly_dice(16000, s), 3, '12,000 and up: three dice') from public.houndopoly_settings s;

-- ── Landing, as the server does it ───────────────────────────────────
-- Ann moves 4 from Start: Riverside Trail (100), for sale.
select public.houndopoly_land('99999999-0000-0000-0000-000000000010', :'today'::date - 3, :'ann', 4);
select is((select position || '/' || coalesce(pending_idx::text, '-') from public.houndopoly_players where challenge_id = '99999999-0000-0000-0000-000000000010' and user_id = :'ann'),
  '4/4', 'Landing on a square for sale holds it');

select tests.sign_in(:'ann');
set local role authenticated;
select public.houndopoly_decide('99999999-0000-0000-0000-000000000010', true);
select is((select cash from public.houndopoly_players where challenge_id = '99999999-0000-0000-0000-000000000010' and user_id = :'ann'), 1400, 'Buying takes the price');
select is((select owner_id from public.houndopoly_deeds where challenge_id = '99999999-0000-0000-0000-000000000010' and idx = 4), :'ann', 'and the deed is yours');
select throws_ok('select public.houndopoly_decide(''99999999-0000-0000-0000-000000000010'', true)',
  'Nothing is waiting for you to decide.', 'Nothing more to decide');
reset role;

-- Bob lands on Ann's Riverside Trail: rent is a tenth, 10.
select public.houndopoly_land('99999999-0000-0000-0000-000000000010', :'today'::date - 3, :'bob', 4);
select is((select cash from public.houndopoly_players where challenge_id = '99999999-0000-0000-0000-000000000010' and user_id = :'bob'), 1490, 'Rent is a tenth of the price');
select is((select cash from public.houndopoly_players where challenge_id = '99999999-0000-0000-0000-000000000010' and user_id = :'ann'), 1410, 'and goes to the owner');

-- Ann gets Creekside Loop too (the whole b group): rent there doubles.
insert into public.houndopoly_deeds (challenge_id, idx, owner_id, bought_on) values ('99999999-0000-0000-0000-000000000010', 5, :'ann', :'today'::date - 3);
select is(public.houndopoly_rent('99999999-0000-0000-0000-000000000010', 5), 24, 'A whole group doubles the rent');
select public.houndopoly_land('99999999-0000-0000-0000-000000000010', :'today'::date - 3, :'bob', 1);
select is((select cash from public.houndopoly_players where challenge_id = '99999999-0000-0000-0000-000000000010' and user_id = :'bob'), 1466, 'Bob pays the doubled rent');

-- Bob on to the Vet (18): 13 squares. Then 6 more: round past Start (0 is 24): +200, lands on Start.
select public.houndopoly_land('99999999-0000-0000-0000-000000000010', :'today'::date - 3, :'bob', 13);
select is((select cash from public.houndopoly_players where challenge_id = '99999999-0000-0000-0000-000000000010' and user_id = :'bob'), 1366, 'The Vet costs 100');
select public.houndopoly_land('99999999-0000-0000-0000-000000000010', :'today'::date - 3, :'bob', 6);
select is((select cash || '/' || position from public.houndopoly_players where challenge_id = '99999999-0000-0000-0000-000000000010' and user_id = :'bob'),
  '1566/0', 'Passing Start pays 200');

-- Bankrupt: Bob down to 5 cash, then Ann's doubled rent of 24.
update public.houndopoly_players set cash = 5 where challenge_id = '99999999-0000-0000-0000-000000000010' and user_id = :'bob';
select public.houndopoly_land('99999999-0000-0000-0000-000000000010', :'today'::date - 3, :'bob', 5);
select is((select cash || '/' || bankrupt from public.houndopoly_players where challenge_id = '99999999-0000-0000-0000-000000000010' and user_id = :'bob'),
  '0/true', 'Paying what you can''t makes you bankrupt');
select is((select count(*)::int from public.houndopoly_events where challenge_id = '99999999-0000-0000-0000-000000000010' and kind = 'bankrupt'), 1, 'and the feed says so');

-- ── The nightly roll ─────────────────────────────────────────────────
-- Steps for the day before yesterday, which is over everywhere.
insert into public.daily_step_totals (user_id, day, steps) values (:'ann', :'today'::date - 2, 13000), (:'bob', :'today'::date - 2, 900);
select tests.sign_in(:'ann');
set local role authenticated;
select ok(public.houndopoly_advance('99999999-0000-0000-0000-000000000010') >= 2, 'A player can roll the days that are over');
reset role;
select is((select count(*)::int from public.houndopoly_days where challenge_id = '99999999-0000-0000-0000-000000000010' and day = :'today'::date - 2), 1, 'The day is marked rolled');
select is((select kind from public.houndopoly_events where challenge_id = '99999999-0000-0000-0000-000000000010' and day = :'today'::date - 2 and user_id = :'bob' and kind in ('stayed_in', 'moved') limit 1),
  'stayed_in', 'Under 2,000 steps stays in');
select ok((select (detail ->> 'dice')::int = 3 and amount between 3 and 18 from public.houndopoly_events
  where challenge_id = '99999999-0000-0000-0000-000000000010' and day = :'today'::date - 2 and user_id = :'ann' and kind = 'moved' order by seq limit 1),
  '13,000 steps rolls three dice');
select is(public.houndopoly_advance('99999999-0000-0000-0000-000000000010'), 0, 'Rolling again does nothing');

-- ── Settlement ───────────────────────────────────────────────────────
-- A 3-day game that ended 30 hours ago: Ann has more, so she places first.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day)
values ('99999999-0000-0000-0000-000000000012', 'Done game', 'houndopoly', :'ann', 3, now() - interval '4 days 6 hours', now() - interval '30 hours', :'today'::date - 4);
insert into public.challenge_participants (challenge_id, user_id) values
  ('99999999-0000-0000-0000-000000000012', :'ann'), ('99999999-0000-0000-0000-000000000012', :'bob');
update public.houndopoly_players set cash = 900 where challenge_id = '99999999-0000-0000-0000-000000000012' and user_id = :'bob';
insert into public.houndopoly_deeds (challenge_id, idx, owner_id, bought_on) values ('99999999-0000-0000-0000-000000000012', 23, :'ann', :'today'::date - 3);
select is(public.houndopoly_net_worth('99999999-0000-0000-0000-000000000012', :'ann'), 1900, 'Net worth is cash plus squares');
select tests.sign_in(:'ann');
set local role authenticated;
select public.settle_challenge_score('99999999-0000-0000-0000-000000000012');
reset role;
select is((select score_points from public.activity_events where challenge_id = '99999999-0000-0000-0000-000000000012' and user_id = :'ann' and kind = 'houndopoly_result'), 50, 'The richest places first');
select is((select score_points from public.activity_events where challenge_id = '99999999-0000-0000-0000-000000000012' and user_id = :'bob' and kind = 'houndopoly_result'), 25, 'and the next, second');

-- A global one.
select tests.sign_in(:'zed');
set local role authenticated;
select lives_ok(format('select public.publish_global_challenge(%L, %L, 21, %L, %L)', 'Global Boulevard', 'houndopoly', now() + interval '1 day', now() + interval '3 days'),
  'A Hound''opoly game can be global');
reset role;

select * from finish();
