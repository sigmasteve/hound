-- 0243: the Prize Counter. A Paw Slots settle fills the wallet (once),
-- an item bought for Paw Coins, not enough coins, already owned, the
-- Bones shop and gifts refusing counter items, the yard placing one only
-- for its owner, and Admin.
select plan(13);

select tests.new_user_with_id('00000000-0000-0000-0000-00000006a001', 'Ann') as ann \gset
select tests.new_user_with_id('00000000-0000-0000-0000-00000006a002', 'Bob') as bob \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York', bones_balance = 10000, xp_total = 100000 where id in (:'ann', :'bob');
select public.soccer_today(:'ann') as today \gset

-- A finished Paw Slots: Ann 1,000 coins, Bob 0.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000610e1', 'Paw Week', 'slots', :'ann', 3, now() - interval '4 days', now() - interval '25 hours', :'today'::date - 4);
insert into public.challenge_participants (challenge_id, user_id)
  select '00000000-0000-0000-0000-0000000610e1', u from unnest(array[:'ann', :'bob']::uuid[]) u;
update public.slots_players set coins = case user_id when :'ann'::uuid then 1000 else 0 end where challenge_id = '00000000-0000-0000-0000-0000000610e1';
insert into public.slots_spins (challenge_id, user_id, day, lines, bet, cost, stops)
  select '00000000-0000-0000-0000-0000000610e1', u, :'today'::date - 3, 1, 1, 1, array[0, 0, 0] from unnest(array[:'ann', :'bob']::uuid[]) u;
select public.settle_challenge_score('00000000-0000-0000-0000-0000000610e1');

select is((select balance from public.paw_wallets where user_id = :'ann'), 1000, 'Settled: her 1,000 Paw Coins go to her wallet');
select is((select count(*)::int from public.paw_wallets where user_id = :'bob'), 0, 'Nothing for a hound who finished on 0');
-- A second settle row for her can't credit twice.
insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
  values (:'ann', '00000000-0000-0000-0000-0000000610e1', 'slots_result', 0, 0, 0);
select is((select balance from public.paw_wallets where user_id = :'ann'), 1000, 'Once a challenge');

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.prize_counter_state() ->> 'balance')::int, 1000, 'The counter shows her wallet');
select is((select (x ->> 'price')::int from jsonb_array_elements(public.prize_counter_state() -> 'items') x where x ->> 'id' = 'house_arcade'), 5000, 'and its prices');
select is((public.prize_counter_buy('collar_goldhound') ->> 'balance')::int, 400, 'The Golden Hound Collar for 600');
select throws_ok($$select public.prize_counter_buy('collar_goldhound')$$, 'You already have that.', 'Once');
select throws_ok($$select public.prize_counter_buy('bowl_coin')$$, 'That''s 800 Paw Coins and you have 400.', 'Not enough coins');
select throws_ok($$select public.prize_counter_buy('collar_red')$$, 'That isn''t on the Prize Counter.', 'Only counter items');
select lives_ok(format('select public.equip_kennel_item(%L, %L, %L)', :'today', 'neck', 'collar_goldhound'), 'She wears it');
select throws_ok(format('select public.buy_kennel_item(%L, %L)', :'today', 'house_arcade'), 'That one was only around for a while, and it''s gone now.', 'The Bones shop never sells them');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok(format('select public.place_yard_item(%L, %L, %L)', :'today', 'house', 'house_arcade'), 'You don''t have that yet.', 'Nobody places one they haven''t won');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select is((select jsonb_build_object('earned', o -> 'earned', 'spent', o -> 'spent', 'buyers', o -> 'buyers')
  from public.admin_prize_counter_overview() o), '{"earned": 1000, "spent": 600, "buyers": 1}'::jsonb, 'Admin: coins in, coins spent, buyers');
reset role;

select * from finish();
