-- 0249: Bullseye. The arrow's flight (the sight mark, the Moon), the ring,
-- setting it up, arrows from steps, a perfect arrow (an X), a Robin Hood,
-- the gold balloon once a day, the sight tape learning, the clout, a
-- miss, letting go early, bows that unlock (and the longbow's star), the
-- payout through the settle, Global publishing and Admin.
select plan(30);

-- ── The flight ──
select is(round(public.bullseye_mark(62, 0.0018, 70, 9.80665)::numeric), 98::numeric, 'A recurve at 70 m: 98 mils up (5.6°)');
select is((select round(tof::numeric, 2) from public.bullseye_fly(62, 0.0018, public.bullseye_mark(62, 0.0018, 70, 9.80665), 70, 9.80665)), 1.21::numeric,
  'and 1.21 s in the air');
select ok(public.bullseye_mark(44, 0.0018, 150, 9.80665) between 500 and 700, 'A youth bow lobs the clout at 150 m');
select is((select round(tof::numeric, 1) from public.bullseye_fly(62, 0, public.bullseye_mark(62, 0, 500, 1.62), 500, 1.62)), 8.1::numeric, 'On the Moon: 500 m in 8 s');
select is(array[public.bullseye_ring(0, 40), public.bullseye_ring(2.5, 40), public.bullseye_ring(19.9, 40), public.bullseye_ring(20, 40)], array[10, 9, 1, 0],
  'Rings: 10 in the middle, 1 at the edge, 0 off the face');

select tests.new_user_with_id('00000000-0000-0000-0000-00000008a001', 'Ann') as ann \gset
select tests.new_user_with_id('00000000-0000-0000-0000-00000008a002', 'Bob') as bob \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob');
select public.soccer_today(:'ann') as today \gset
select '00000000-0000-0000-0000-0000000810e1' as cid \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  (:'cid', 'Family Bullseye', 'bullseye', :'ann', 7,
   ((:'today'::date - 1)::timestamp at time zone 'America/New_York'), ((:'today'::date + 6)::timestamp at time zone 'America/New_York'), :'today'::date - 1);
insert into public.challenge_participants (challenge_id, user_id) select :'cid', u from unnest(array[:'ann', :'bob']::uuid[]) u;

-- ── Setting it up ──
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok(format('select public.bullseye_setup(%L, 150, %L, %L, false, true)', :'cid', 'none', 'none'), 'Only whoever made it can set it up.', 'Only the maker');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok(format('select public.bullseye_setup(%L, 150, %L, %L, true, true)', :'cid', 'none', 'none'), 'Out to the clout, no special days, the helper on');
select throws_ok(format('select public.bullseye_aim(%L, %L)', :'cid', '18'), 'No arrows left: walk 1,500 steps for the next end.', 'No steps, no arrows');
reset role;

-- ── A perfect arrow ──
-- 0250: an unshot sight mark is the book give or take a guess.
select ok(abs(public.bullseye_guess(:'ann', 'recurve', 'standard', 'earth', 70)) <= 4
          and public.bullseye_guess(:'ann', 'recurve', 'standard', 'earth', 70) = public.bullseye_guess(:'ann', 'recurve', 'standard', 'earth', 70),
  'A guessed mark is off by up to 4 mils, the same each time');
select isnt(public.bullseye_sight(:'ann', 'recurve', 'standard', 'earth', 70)::numeric,
  round((public.bullseye_book_get('recurve', 'standard', 'earth', 70)).mark::numeric, 1), 'so an unshot mark isn''t the book');
update public.bullseye_settings set sway_mil = 0, spread_mil = 0, wind_noise = 0, guess_mil = 0 where id;
insert into public.daily_step_totals (user_id, day, steps) values (:'ann', :'today', 4600), (:'bob', :'today', 1600);
select public.bullseye_conditions(:'cid', :'today') as cond \gset
-- The hold that cancels today's air and breeze at a distance.
create temp table holds as
select d, (public.bullseye_mark(62, 0.0018 * (:'cond'::jsonb ->> 'air')::double precision, d, 9.80665)
           - round((public.bullseye_book_get('recurve', 'standard', 'earth', d)).mark::numeric, 1)) as hy,
       -(public.longshot_wind_at(:'cond'::jsonb, now()) * 0.44704 * f.lag * 100) * 10 / d as hx
from unnest(array[18, 70]) d,
     lateral public.bullseye_fly(62, 0.0018 * (:'cond'::jsonb ->> 'air')::double precision,
       public.bullseye_mark(62, 0.0018 * (:'cond'::jsonb ->> 'air')::double precision, d, 9.80665), d, 9.80665) f;
grant select on holds to authenticated;
select hy as hy18, hx as hx18 from holds where d = 18 \gset
select hy as hy70, hx as hx70 from holds where d = 70 \gset

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.bullseye_state(:'cid') -> 'today' ->> 'left')::int, 9, '4,600 steps: 3 ends, 9 arrows');
select (public.bullseye_aim(:'cid', '18') ->> 'aimId')::bigint as a1 \gset
reset role;
update public.bullseye_aims set started_at = now() - interval '10 seconds' where not fired;
select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('ring', x -> 'ring', 'x', x -> 'x', 'points', x -> 'points', 'endNo', x -> 'endNo', 'arrowNo', x -> 'arrowNo')
           from (select public.bullseye_shoot(:'cid', :a1, :hx18, :hy18, 2000) x) y),
  '{"ring": 10, "x": true, "points": 10, "endNo": 1, "arrowNo": 1}'::jsonb, 'Held right at 18 m: an X (10 x 1 star)');
select throws_ok(format('select public.bullseye_shoot(%L, %s, 0, 0, 2000)', :'cid', :a1), 'That arrow''s already gone.', 'One arrow an aim');
select (public.bullseye_aim(:'cid', '18') ->> 'aimId')::bigint as a2 \gset
reset role;
update public.bullseye_aims set started_at = now() - interval '10 seconds' where not fired;
select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('robin', x -> 'robin', 'points', x -> 'points') from (select public.bullseye_shoot(:'cid', :a2, :hx18, :hy18, 2000) x) y),
  '{"robin": true, "points": 35}'::jsonb, 'The same again: a Robin Hood (+25)');
reset role;
select ok(abs((select mark from public.bullseye_tapes where user_id = :'ann' and dist = 18)
  - (round((public.bullseye_book_get('recurve', 'standard', 'earth', 18)).mark::numeric, 1) + :hy18::numeric)) <= 0.02, 'The sight tape learns the mark that hit gold');

-- ── The gold balloon ──
select bones_balance as ann_bones from public.profiles where id = :'ann' \gset
select tests.sign_in(:'ann');
set local role authenticated;
select (public.bullseye_aim(:'cid', 'gold') ->> 'aimId')::bigint as a3 \gset
reset role;
update public.bullseye_aims set started_at = now() - interval '10 seconds' where not fired;
select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('popped', x -> 'popped', 'gold', x -> 'gold', 'points', x -> 'points', 'endTotal', x -> 'endTotal')
           from (select public.bullseye_shoot(:'cid', :a3, :hx70, :hy70, 2000) x) y),
  '{"popped": true, "gold": true, "points": 20, "endTotal": 65}'::jsonb, 'The gold balloon at 70 m: popped, 20, and the end is 65');
reset role;
select is((select bones_balance from public.profiles where id = :'ann'), :ann_bones + 100, '100 Bones, straight away');

-- ── A miss, an early release, the clout ──
select tests.sign_in(:'ann');
set local role authenticated;
select (public.bullseye_aim(:'cid', '30') ->> 'aimId')::bigint as a4 \gset
reset role;
update public.bullseye_aims set started_at = now() - interval '10 seconds' where not fired;
select tests.sign_in(:'ann');
set local role authenticated;
select ok(public.bullseye_shoot(:'cid', :a4, 20, 0) ->> 'message' like 'Off the face:%right.', '20 mils right at 30 m: off the face');
select (public.bullseye_aim(:'cid', '18') ->> 'aimId')::bigint as a5 \gset
reset role;
update public.bullseye_aims set started_at = now() - interval '10 seconds' where not fired;
select tests.sign_in(:'ann');
set local role authenticated;
select ok((public.bullseye_shoot(:'cid', :a5, :hx18, :hy18, 300) ->> 'yCm')::numeric < -10, 'Let go before full draw: slow, and it drops low');
select ok((select x -> 'helper' ->> 'xCm' is not null from (select public.bullseye_aim(:'cid', 'clout') x) y), 'The helper says where the breeze takes it');
select (public.bullseye_aim(:'cid', 'clout') ->> 'aimId')::bigint as a6 \gset
reset role;
update public.bullseye_aims set started_at = now() - interval '10 seconds' where not fired;
select f.y as dummy from (select 1) z, lateral (select 0 as y) f \gset
select (public.bullseye_mark(62, 0.0018 * (:'cond'::jsonb ->> 'air')::double precision, 150, 9.80665)
        - round((public.bullseye_book_get('recurve', 'standard', 'earth', 150)).mark::numeric, 1)) as hy150,
       -(public.longshot_wind_at(:'cond'::jsonb, now()) * 0.44704 * f.lag * 100) * 10 / 150 as hx150
from public.bullseye_fly(62, 0.0018 * (:'cond'::jsonb ->> 'air')::double precision,
       public.bullseye_mark(62, 0.0018 * (:'cond'::jsonb ->> 'air')::double precision, 150, 9.80665), 150, 9.80665) f \gset
select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('ring', x -> 'ring', 'points', x -> 'points') from (select public.bullseye_shoot(:'cid', :a6, :hx150, :hy150, 2000) x) y),
  '{"ring": 5, "points": 30}'::jsonb, 'Right by the clout flag: 5 x 6 stars');

-- ── Bows ──
select throws_ok(format('select public.bullseye_loadout(%L, %L, %L)', :'cid', 'compound', 'standard'), 'The Compound unlocks at 80,000 steps in this game.', 'The compound waits for 80,000');
select lives_ok(format('select public.bullseye_loadout(%L, %L, %L)', :'cid', 'longbow', 'heavy'), 'A longbow and heavy arrows');
select is((public.bullseye_aim(:'cid', '70') ->> 'stars')::int, 5, 'No sight on a longbow: a star more');
select is((select jsonb_build_object('points', s -> 'me' -> 'points', 'bow', s -> 'me' -> 'bow', 'ends', jsonb_array_length(s -> 'ends'), 'gold', s -> 'goldTaker' -> 'me')
           from (select public.bullseye_state(:'cid') s) x),
  '{"points": 95, "bow": "longbow", "ends": 2, "gold": true}'::jsonb, 'The state: 95 points, the longbow, two ends, and the gold balloon');
reset role;

-- ── Bob, and the payout ──
select tests.sign_in(:'bob');
set local role authenticated;
select (public.bullseye_aim(:'cid', '18') ->> 'aimId')::bigint as b1 \gset
reset role;
update public.bullseye_aims set started_at = now() - interval '10 seconds' where not fired;
select tests.sign_in(:'bob');
set local role authenticated;
select is((public.bullseye_shoot(:'cid', :b1, :hx18, :hy18, 2000) ->> 'points')::int, 10, 'Bob''s X at 18 m');
reset role;
update public.challenges set ends_at = now() - interval '25 hours' where id = :'cid';
select public.settle_challenge_score(:'cid');
select is((select array_agg(bones_points order by bones_points desc) from public.activity_events where challenge_id = :'cid' and kind = 'bullseye_result'),
  array[255, 155], 'Settled: 400 Bones by place (250 and 150), and the usual 5');

-- ── Global and Admin ──
select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok($$select public.publish_global_challenge('Too Long', 'bullseye', 20, now(), now() + interval '1 day')$$, 'Bullseye runs 3 to 14 days.', 'A Global runs 3 to 14 days');
select is((select jsonb_build_object('tried', o -> 'tried', 'arrows7d', o -> 'arrows7d', 'robins7d', o -> 'robins7d', 'pops7d', o -> 'pops7d', 'gold7d', o -> 'gold7d')
           from public.admin_bullseye_overview() o), '{"tried": 2, "arrows7d": 7, "robins7d": 1, "pops7d": 1, "gold7d": 1}'::jsonb, 'Admin: archers, arrows, Robin Hoods, pops, gold balloons');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.admin_bullseye_overview()$$, 'not authorized', 'Admins only');
reset role;

select * from finish();
