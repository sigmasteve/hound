-- 0269: fasting phase games.
select plan(17);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Boss', true) as boss \gset
insert into public.fasting_profiles (user_id, age, share) values (:'ann', 'ok', true), (:'bob', 'ok', true), (:'cat', 'ok', false), (:'boss', 'ok', true);
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bob', 'accepted');
-- Ann: a 16 h fast, 13 h in. Bob: a 12:12, ended an hour ago at 12.5 h.
insert into public.fasts (user_id, goal_hours, started_at) values (:'ann', 16, now() - interval '13 hours') returning id as afast \gset
insert into public.fasts (user_id, goal_hours, started_at, ended_at, hours) values (:'bob', 12, now() - interval '13.5 hours', now() - interval '1 hour', 12.5) returning id as bfast \gset
insert into public.fasts (user_id, goal_hours, started_at) values (:'cat', 18, now() - interval '5 hours') returning id as cfast \gset

-- Slots and what opens when.
select is(public.fasting_slot_at('ketosis', 12), null, 'A 12:12 has no ketosis game');
select is(public.fasting_slot_at('fatburn', 12), 12::numeric, 'but does have fat burning, at its goal');
select is(public.fasting_slot_game('settling', date '2026-11-25') <> public.fasting_slot_game('settling', date '2026-11-26'), true, 'Settling''s game changes day to day');

select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_agg(s ->> 'status' order by ord) from jsonb_array_elements(public.fasting_games_state() -> 'slots') with ordinality as t(s, ord)),
  '["open", "open", "locked", "locked"]'::jsonb, 'At 13 h of 16: settling and fat burning are open');
select throws_ok(format('select public.fasting_game_start(%L, %L)', :'afast', 'ketosis'), 'That game opens at 16 h.', 'Ketosis waits for 16 h');
select (public.fasting_game_start(:'afast', 'fatburn')) ->> 'id' as g1 \gset
select is((select game from public.fasting_games where id = :'g1'), 'burn', 'Fat burning plays Burn Zone');
select throws_ok(format('select public.fasting_game_finish(%L, %L)', :'g1', '{"pct": 80}'), 'That score doesn''t add up.', 'A 30-second game can''t finish at once');
reset role;
update public.fasting_games set started_at = now() - interval '31 seconds' where id = :'g1';
set local role authenticated;
select is((public.fasting_game_finish(:'g1', '{"pct": 80}')) ->> 'score', '90', 'Burn Zone: 80% in the zone scores 90');
select throws_ok(format('select public.fasting_game_finish(%L, %L)', :'g1', '{"pct": 80}'), 'You''ve played that one.', 'One try');
select throws_ok(format('select public.fasting_game_start(%L, %L)', :'afast', 'fatburn'), 'You''ve played that one.', 'Not even a restart');
reset role;
select is((select bones_balance from public.profiles where id = :'ann'), 5 + coalesce((select bones_balance from public.profiles where id = :'boss'), 0), 'It paid 5 Bones');

-- Bob plays his goal game after his fast ended.
select tests.sign_in(:'bob');
set local role authenticated;
select (public.fasting_game_start(:'bfast', 'goal')) ->> 'id' as g2 \gset
reset role;
update public.fasting_games set started_at = now() - interval '12 seconds' where id = :'g2';
set local role authenticated;
select is((public.fasting_game_finish(:'g2', '{"pts": 12, "left": 2}')) ->> 'score', '88', 'Refeed: the goal game, after the fast ended');
reset role;

-- Cat doesn't share: she plays but isn't on others' boards.
select tests.sign_in(:'cat');
set local role authenticated;
select (public.fasting_game_start(:'cfast', 'settling')) ->> 'id' as g3 \gset
reset role;
update public.fasting_games set started_at = now() - interval '20 minutes' where id = :'g3';
set local role authenticated;
select is((public.fasting_games_state() -> 'slots' -> 0 ->> 'status'), 'left', 'A run left for 15 minutes counts as played');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_agg(r ->> 'id' order by (r ->> 'rank')::int) from jsonb_array_elements(public.fasting_games_board('all') -> 'rows') r
  where r ->> 'id' in (:'ann', :'bob', :'cat')), jsonb_build_array(:'ann', :'bob'),
  'All-time: Ann 90, Bob 88; Cat doesn''t share');
select is((public.fasting_games_board('friends') ->> 'of')::int, 2, 'Friends: Ann and Bob');
select throws_ok($$select public.admin_fasting_games_overview()$$, 'not authorized', 'Admin numbers are admins only');
reset role;
select tests.sign_in(:'boss');
set local role authenticated;
select is((public.admin_fasting_games_overview() ->> 'games_7d')::int >= 2, true, 'Admin sees the games');
reset role;

select * from finish();
