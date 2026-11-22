-- 0247: Long Shot. The flight (drop, time, speed at the plate; the Moon),
-- a day's range the same for everyone, setting it up, rounds from steps,
-- a held-perfectly round (center, cold bore), the data card learning, the
-- gold plate once a day, a miss, rifles that unlock, the payout through
-- the settle, Global publishing and Admin.
select plan(32);

-- ── The flight ──
select is((select array[round(drop_mil::numeric, 1), round(tof::numeric, 2), round(v_end::numeric)] from public.longshot_fly(2710, 0.315, 1000, 1.225, 9.80665)),
  array[9.4, 1.52, 1438]::numeric[], '6.5 Creedmoor at 1,000 yd: 9.4 mil, 1.52 s, 1,438 fps');
select is((select round(drop_mil::numeric, 1) from public.longshot_fly(2820, 0.52, 3000, 1.225, 9.80665)), 44.2::numeric, '.50 BMG at 3,000 yd: 44.2 mil');
select is((select round(drop_mil::numeric, 1) from public.longshot_fly(2710, 0.315, 1000, 0, 1.62)), 1.0::numeric, 'On the Moon: 1.0 mil');
select ok((select drop_mil from public.longshot_fly(2710, 0.315, 1000, 1.06, 9.80665)) < (select drop_mil from public.longshot_fly(2710, 0.315, 1000, 1.225, 9.80665)),
  'Thinner air, less drop');

select tests.new_user_with_id('00000000-0000-0000-0000-00000007a001', 'Ann') as ann \gset
select tests.new_user_with_id('00000000-0000-0000-0000-00000007a002', 'Bob') as bob \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob');
select public.soccer_today(:'ann') as today \gset
select '00000000-0000-0000-0000-0000000710e1' as cid \gset

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  (:'cid', 'Range Week', 'longshot', :'ann', 7,
   ((:'today'::date - 1)::timestamp at time zone 'America/New_York'), ((:'today'::date + 6)::timestamp at time zone 'America/New_York'), :'today'::date - 1);
insert into public.challenge_participants (challenge_id, user_id) select :'cid', u from unnest(array[:'ann', :'bob']::uuid[]) u;
select is((select count(*)::int from public.longshot_players where challenge_id = :'cid'), 2, 'Joining puts you on the range');

-- ── The day ──
select is(public.longshot_conditions(:'cid', :'today'), public.longshot_conditions(:'cid', :'today'), 'The same range all day, for everyone');
select ok(public.longshot_conditions(:'cid', :'today') -> 'wind' <> public.longshot_conditions(:'cid', :'today'::date + 1) -> 'wind', 'and a new wind tomorrow');
select is((select count(*)::int from generate_series(0, 6) i
           where public.longshot_conditions(:'cid', :'today'::date + i) ->> 'world' = 'moon'), 1, 'Saturdays are on the Moon');

-- ── Setting it up ──
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok(format('select public.longshot_setup(%L, %L, %s, %L, true)', :'cid', 'sea', 3000, 'none'), 'Only whoever made it can set it up.', 'Only the maker sets it up');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format('select public.longshot_setup(%L, %L, %s, %L, true)', :'cid', 'sea', 2500, 'none'), 'The farthest plate is 1,000, 2,000 or 3,000 yards.', 'Three ranges');
select lives_ok(format('select public.longshot_setup(%L, %L, %s, %L, true)', :'cid', 'desert', 3000, 'none'), 'The desert, out to 3,000, no Moon days');
select throws_ok(format('select public.longshot_aim(%L, 1000)', :'cid'), 'No rounds left: walk 1,000 steps for the next.', 'No steps, no rounds');
reset role;

-- ── Rounds, and a perfect hold ──
-- No sway, spread or wind noise, so a hold that cancels the real drop and
-- drift lands dead center.
update public.longshot_settings set sway_mil = 0, spread_mil = 0, transonic_mil = 0, wind_noise = 0 where id;
insert into public.daily_step_totals (user_id, day, steps) values (:'ann', :'today', 3500), (:'bob', :'today', 1200);
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.longshot_state(:'cid') -> 'today' ->> 'left')::int, 3, '3,500 steps: 3 rounds');
select throws_ok(format('select public.longshot_aim(%L, 1200)', :'cid'), 'There''s no plate at 1200 yards today.', 'Only the plates');
select (public.longshot_aim(:'cid', 1000) ->> 'aimId')::bigint as aim1 \gset
reset role;

-- What the server will see: today's air and the wind right now.
select public.longshot_conditions(:'cid', :'today') as cond \gset
select f.drop_mil - public.longshot_dial(:'ann', '65', 24, 'desert', 'earth', 1000) as hy1,
       -(public.longshot_wind_at(:'cond'::jsonb, now()) * 0.44704 * f.lag / (1000 * 0.9144) * 1000) as hx1
  from public.longshot_fly(2710, 0.315, 1000, (:'cond'::jsonb ->> 'rho')::double precision, 9.80665) f \gset
select tests.sign_in(:'ann');
set local role authenticated;
select public.longshot_fire(:'cid', :aim1, :hx1, :hy1, 3000) as shot1 \gset
select is((select jsonb_build_object('hit', x -> 'hit', 'center', x -> 'center', 'points', x -> 'points', 'coldBore', x -> 'coldBore', 'left', x -> 'left')
  from (select :'shot1'::jsonb x) y), '{"hit": true, "center": true, "points": 8, "coldBore": true, "left": 2}'::jsonb,
  'Held right: center at 1,000 (3, doubled) and the cold bore (+2)');
select throws_ok(format('select public.longshot_fire(%L, %s, 0, 0)', :'cid', :aim1), 'That one''s already gone.', 'One round an aim');
reset role;
select is((select elev from public.longshot_cards where user_id = :'ann' and caliber = '65' and dist = 1000),
  round((public.longshot_book_get('65', 24, 'earth', 1000)).drop_mil::numeric, 1) + round(:hy1::numeric, 2), 'The card learns the elevation that rang it');
select ok((select elev from public.longshot_cards where user_id = :'ann' and dist = 1000)
          < round((public.longshot_book_get('65', 24, 'earth', 1000)).drop_mil::numeric, 1), 'less than the book, in the desert''s thin air');

-- ── The gold plate ──
select bones_balance as ann_bones from public.profiles where id = :'ann' \gset
select tests.sign_in(:'ann');
set local role authenticated;
select (public.longshot_aim(:'cid', 2500) ->> 'aimId')::bigint as aim2 \gset
reset role;
select f.drop_mil - public.longshot_dial(:'ann', '65', 24, 'desert', 'earth', 2500) as hy2,
       -(public.longshot_wind_at(:'cond'::jsonb, now()) * 0.44704 * f.lag / (2500 * 0.9144) * 1000) as hx2
  from public.longshot_fly(2710, 0.315, 2500, (:'cond'::jsonb ->> 'rho')::double precision, 9.80665) f \gset
select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('gold', x -> 'gold', 'points', x -> 'points') from (select public.longshot_fire(:'cid', :aim2, :hx2, :hy2) x) y),
  '{"gold": true, "points": 24}'::jsonb, 'The gold plate at 2,500: 12 doubled, and it''s hers');
reset role;
select is((select bones_balance from public.profiles where id = :'ann'), :ann_bones + 150, '150 Bones, straight away');
select tests.sign_in(:'bob');
set local role authenticated;
select (public.longshot_aim(:'cid', 2500) ->> 'aimId')::bigint as aim3 \gset
select is((select jsonb_build_object('gold', x -> 'gold', 'points', x -> 'points') from (select public.longshot_fire(:'cid', :aim3, :hx2, :hy2) x) y),
  '{"gold": false, "points": 26}'::jsonb, 'Bob rings it too: his points and cold bore, but the Bones were Ann''s');
reset role;

-- ── A miss ──
select tests.sign_in(:'ann');
set local role authenticated;
select (public.longshot_aim(:'cid', 300) ->> 'aimId')::bigint as aim4 \gset
select ok(public.longshot_fire(:'cid', :aim4, 4, 0) ->> 'message' like 'Miss:%right.', 'Four mils right at 300: a miss, and where it went');
select throws_ok(format('select public.longshot_aim(%L, 300)', :'cid'), 'No rounds left: walk 1,000 steps for the next.', 'Three rounds, three shots');

-- ── Rifles ──
select throws_ok(format('select public.longshot_loadout(%L, %L, 29)', :'cid', '50'), 'The .50 BMG unlocks at 120,000 steps in this game.', 'The .50 waits for 120,000 steps');
select throws_ok(format('select public.longshot_loadout(%L, %L, 29)', :'cid', '308'), 'That barrel doesn''t fit the .308 Win.', 'Each rifle its barrels');
select lives_ok(format('select public.longshot_loadout(%L, %L, 20)', :'cid', '308'), 'A .308 with a 20 in barrel');
select is((select jsonb_build_object('points', s -> 'me' -> 'points', 'caliber', s -> 'me' -> 'caliber', 'plates', jsonb_array_length(s -> 'plates'),
              'card', jsonb_array_length(s -> 'card'), 'gold', s -> 'goldTaker' -> 'me')
           from (select public.longshot_state(:'cid') s) x),
  '{"points": 32, "caliber": "308", "plates": 7, "card": 7, "gold": true}'::jsonb, 'The state: her 32 points, the .308, seven plates and their card');
reset role;

-- ── The payout ──
update public.challenges set ends_at = now() - interval '25 hours' where id = :'cid';
select public.settle_challenge_score(:'cid');
select is((select array_agg(bones_points order by bones_points desc) from public.activity_events where challenge_id = :'cid' and kind = 'longshot_result'),
  array[255, 155], 'Settled: 400 Bones by place (250 and 150), and the usual 5');

-- ── Global ──
select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok($$select public.publish_global_challenge('Too Long', 'longshot', 20, now(), now() + interval '1 day')$$, 'Long Shot runs 3 to 14 days.', 'A Global runs 3 to 14 days');
select public.publish_global_challenge('Global Long Shot', 'longshot', 7, now(), now() + interval '2 days') as gid \gset
select lives_ok(format('select public.longshot_setup(%L, %L, %s, %L, true, 2500)', :'gid', 'mountain', 2000, 'sat'), 'An admin sets a Global''s range and pool');

-- ── Admin ──
select is((select jsonb_build_object('tried', o -> 'tried', 'rounds7d', o -> 'rounds7d', 'hits7d', o -> 'hits7d', 'gold7d', o -> 'gold7d')
           from public.admin_longshot_overview() o), '{"tried": 2, "rounds7d": 4, "hits7d": 3, "gold7d": 1}'::jsonb, 'Admin: who shot, rounds, hits, gold plates');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.admin_longshot_overview()$$, 'not authorized', 'Admins only');
reset role;

select * from finish();
