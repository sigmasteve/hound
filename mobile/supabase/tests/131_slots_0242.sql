-- 0242: Paw Slots. What a line pays, teams dealt evenly, spins from steps
-- and a workout, a press (5 lines x2), buying spins (and the cap), the
-- carry, the solo payout, the team payout, the settle, Global publishing
-- and Admin.
select plan(31);

-- ── What a line pays ──
select is((public.slots_pay(array['gold', 'gold', 'gold']) ->> 'n')::int, 250, 'Three Golden Hounds: 250');
select is((public.slots_pay(array['gold', 'gold', 'collar']) ->> 'n')::int, 4, 'The Collar isn''t a Golden Hound: two on the left, doubled');
select is((public.slots_pay(array['bone', 'collar', 'bone']) ->> 'n')::int, 100, 'Three Bones with a Collar: 50, doubled');
select is((public.slots_pay(array['collar', 'collar', 'collar']) ->> 'n')::int, 100, 'Three Collars: 100');
select is((public.slots_pay(array['paw', 'paw', 'ball']) ->> 'n')::int, 2, 'Two on the left: 2');
select is((public.slots_pay(array['paw', 'ball', 'paw']) ->> 'n')::int, 0, 'Not on the left: nothing');
select is(public.slots_symbol(0, 16, 1), 'gold', 'The middle row is the stop');
select is(public.slots_symbol(0, 16, 0), 'treat', 'The top row is the next one up');

select tests.new_user_with_id('00000000-0000-0000-0000-00000005a001', 'Ann') as ann \gset
select tests.new_user_with_id('00000000-0000-0000-0000-00000005a002', 'Bob') as bob \gset
select tests.new_user_with_id('00000000-0000-0000-0000-00000005a003', 'Cy') as cy \gset
select tests.new_user_with_id('00000000-0000-0000-0000-00000005a004', 'Dee') as dee \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob', :'cy', :'dee');
select public.soccer_today(:'ann') as today \gset

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000510e1', 'Paw Packs', 'slots', :'ann', 7,
   ((:'today'::date - 1)::timestamp at time zone 'America/New_York'), ((:'today'::date + 6)::timestamp at time zone 'America/New_York'), :'today'::date - 1);
insert into public.challenge_participants (challenge_id, user_id)
  select '00000000-0000-0000-0000-0000000510e1', u from unnest(array[:'ann', :'bob', :'cy', :'dee']::uuid[]) u;

-- ── Teams ──
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.slots_setup('00000000-0000-0000-0000-0000000510e1', 2)$$, 'Only whoever made it can set it up.', 'Only the maker sets it up');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.slots_setup('00000000-0000-0000-0000-0000000510e1', 5)$$, 'Play solo, or in 2, 3 or 4 packs.', 'Two to four packs');
select public.slots_setup('00000000-0000-0000-0000-0000000510e1', 2);
reset role;
select is((select array_agg(team order by user_id) from public.slots_players where challenge_id = '00000000-0000-0000-0000-0000000510e1'),
  array['wolves', 'goldens', 'wolves', 'goldens'], 'Dealt into two packs in the order they joined');

-- ── Spins ──
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.slots_spin('00000000-0000-0000-0000-0000000510e1', 1, 1)$$, 'That needs 1 spins and you have 0.', 'No steps, no spins');
reset role;
insert into public.daily_step_totals (user_id, day, steps) values (:'ann', :'today', 5200);
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min)
values (:'ann', 's-w', 'Run', ((:'today'::date)::timestamp + interval '9 hours') at time zone 'America/New_York', 'test', 25);
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.slots_state('00000000-0000-0000-0000-0000000510e1', 6100) -> 'today' ->> 'left')::int, 14, 'The phone''s 6,100 steps: 12 spins, and 2 for the workout');
select throws_ok($$select public.slots_spin('00000000-0000-0000-0000-0000000510e1', 2, 1)$$, 'Play 1, 3 or 5 lines.', 'Lines are 1, 3 or 5');
select throws_ok($$select public.slots_spin('00000000-0000-0000-0000-0000000510e1', 5, 3)$$, 'That needs 15 spins and you have 14.', 'Five lines at x3 is 15 spins');
select is((public.slots_spin('00000000-0000-0000-0000-0000000510e1', 5, 2) ->> 'left')::int, 4, 'Five lines at x2: 10 spins used');
reset role;
select is((select coins from public.slots_players where challenge_id = '00000000-0000-0000-0000-0000000510e1' and user_id = :'ann'),
  (select coins from public.slots_spins where challenge_id = '00000000-0000-0000-0000-0000000510e1' and user_id = :'ann'), 'What the press won is her coins');
select is((select coins = base * 2 and jsonb_array_length(wins) <= 5 from public.slots_spins where user_id = :'ann'), true, 'Every line''s pay, times the bet');

-- ── Buying ──
update public.slots_players set coins = 50 where challenge_id = '00000000-0000-0000-0000-0000000510e1' and user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.slots_buy('00000000-0000-0000-0000-0000000510e1', 11)$$, 'You can buy 10 more today.', 'Up to 10 a day');
select is((public.slots_buy('00000000-0000-0000-0000-0000000510e1', 5) -> 'coins')::int, 35, '5 spins for 15 Paw Coins');
select is((public.slots_state('00000000-0000-0000-0000-0000000510e1') -> 'today' ->> 'left')::int, 9, 'and 5 more to play');
select throws_ok($$select public.slots_buy('00000000-0000-0000-0000-0000000510e1', 6)$$, 'You can buy 5 more today.', 'The cap counts what''s bought');
reset role;

-- ── The carry ──
insert into public.daily_step_totals (user_id, day, steps) values (:'bob', :'today'::date - 1, 7000);
select tests.sign_in(:'bob');
set local role authenticated;
select is((public.slots_state('00000000-0000-0000-0000-0000000510e1') -> 'today' ->> 'carried')::int, 10, 'Yesterday''s 14 unplayed: 10 carry over');
reset role;

-- ── The team payout: wolves 60 + 20 (40 a hound), goldens 40 + 0 (20) ──
update public.slots_players set coins = case user_id when :'ann'::uuid then 60 when :'bob'::uuid then 40 when :'cy'::uuid then 20 else 0 end
  where challenge_id = '00000000-0000-0000-0000-0000000510e1';
insert into public.slots_spins (challenge_id, user_id, day, lines, bet, cost, stops)
  select '00000000-0000-0000-0000-0000000510e1', u, :'today', 1, 1, 1, array[0, 0, 0] from unnest(array[:'bob', :'cy']::uuid[]) u;
select is((select jsonb_object_agg(public.horse_name(x.user_id), x.bones) from public.slots_payout('00000000-0000-0000-0000-0000000510e1') x),
  jsonb_build_object('Ann', 418, 'Bob', 241, 'Cy', 139, 'Dee', 0), 'Wolves take 60 of 86 parts of 800, split by coins; Dee never played');

-- ── Solo: 4 hounds, 800 Bones, 3 of them played ──
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000510e2', 'Paw Solo', 'slots', :'ann', 3, now() - interval '4 days', now() - interval '25 hours', :'today'::date - 4);
insert into public.challenge_participants (challenge_id, user_id)
  select '00000000-0000-0000-0000-0000000510e2', u from unnest(array[:'ann', :'bob', :'cy', :'dee']::uuid[]) u;
update public.slots_players set coins = case user_id when :'ann'::uuid then 20 when :'bob'::uuid then 100 when :'cy'::uuid then 50 else 0 end
  where challenge_id = '00000000-0000-0000-0000-0000000510e2';
insert into public.slots_spins (challenge_id, user_id, day, lines, bet, cost, stops)
  select '00000000-0000-0000-0000-0000000510e2', u, :'today'::date - 3, 1, 1, 1, array[0, 0, 0] from unnest(array[:'ann', :'bob', :'cy']::uuid[]) u;
select is((select jsonb_object_agg(public.horse_name(x.user_id), x.bones) from public.slots_payout('00000000-0000-0000-0000-0000000510e2') x),
  jsonb_build_object('Bob', 400, 'Cy', 240, 'Ann', 160, 'Dee', 0), '30 / 18 / 12 of 800, scaled to three places');
select public.settle_challenge_score('00000000-0000-0000-0000-0000000510e2');
select is((select array_agg(a.bones_points || ':' || a.score_points order by a.bones_points desc) from public.activity_events a where a.challenge_id = '00000000-0000-0000-0000-0000000510e2'),
  array['405:50', '245:25', '165:15', '5:5'], 'Settled: the pool and the usual 5, the Hound Score by place');

-- ── Global ──
select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok($$select public.publish_global_challenge('Two Days', 'slots', 2, now(), now() + interval '1 day')$$, 'Paw Slots runs 3 to 30 days.', 'A Global runs 3 to 30 days');
select public.publish_global_challenge('Global Paw Slots', 'slots', 7, now(), now() + interval '2 days') as gid \gset
select lives_ok(format('select public.slots_setup(%L, 0, 5000)', :'gid'), 'An admin sets a Global''s pool');
select is((public.slots_state(:'gid') ->> 'pool')::int, 5000, 'and the page shows it');
reset role;

-- ── Admin ──
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.admin_slots_overview()$$, 'not authorized', 'Admins only');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select is((select jsonb_build_object('presses', o -> 'presses7d', 'l5', o -> 'byLines7d' -> 'l5', 'bought', o -> 'bought7d', 'spent', o -> 'coinsSpent7d', 'teams', o -> 'teamGames')
  from public.admin_slots_overview() o),
  '{"presses": 6, "l5": 1, "bought": 5, "spent": 15, "teams": 1}'::jsonb, 'Admin: presses, lines, spins bought');
reset role;

select * from finish();
