-- 0257: Auto for the Home Run Derby (every swing left), the Hound
-- Shootout (every kick left, low spots only) and facing combinations in
-- the ring; all marked auto; Admin counts them.
select plan(13);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob');
select public.soccer_today(:'ann') as today \gset

-- ── Home Run Derby ──
select tests.sign_in(:'ada');
set local role authenticated;
select public.publish_global_challenge('Auto Derby', 'derby', 7, now() - interval '1 hour', now() + interval '3 days') as derby \gset
select public.derby_setup_global(:'derby');
select public.publish_global_challenge('Auto Shootout', 'shootout', 7, now() - interval '1 hour', now() + interval '3 days') as so \gset
select public.shootout_setup_global(:'so');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select public.join_global_challenge(:'derby');
select public.join_global_challenge(:'so');
reset role;
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values (:'derby', :'ann', :'today', 4200), (:'so', :'ann', :'today', 4200);

select tests.sign_in(:'ann');
set local role authenticated;
select public.derby_swing_auto(:'derby') as d1 \gset
select is((:'d1'::jsonb ->> 'swings')::int, 4, 'Auto takes the 4 swings Ann has');
select is((public.derby_live(:'derby') ->> 'swings_left')::int, 0, 'and none are left');
reset role;
select is((select count(*)::int from public.derby_swings where challenge_id = :'derby' and user_id = :'ann' and auto and result is not null), 4, 'Four swings, marked auto');
select ok((select bool_and(abs(timing) <= 120 * factor + 1) from public.derby_swings where challenge_id = :'derby' and user_id = :'ann'),
  'Each within 120 ms of the ball (times the factor)');

-- ── Hound Shootout ──
select tests.sign_in(:'ann');
set local role authenticated;
select public.shootout_kick_auto(:'so') as s1 \gset
select is((:'s1'::jsonb ->> 'kicks')::int, 4, 'Auto takes the 4 kicks Ann has');
select throws_ok(format($q$select public.shootout_kick_auto(%L)$q$, :'so'), 'No kicks ready: your next comes at 5,000 steps.', 'With none left, it says why');
reset role;
select is((select count(*)::int from public.shootout_kicks where challenge_id = :'so' and user_id = :'ann' and auto), 4, 'Four kicks, marked auto');
select ok((select bool_and(zone in (3, 4, 5)) from public.shootout_kicks where challenge_id = :'so' and user_id = :'ann'), 'All at the low spots');

-- ── The ring: facing a combination ──
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-000000257b01', 'Auto Gym', 'bout', :'ann', 3,
   (:'today'::date)::timestamp at time zone 'America/New_York', (:'today'::date + 3)::timestamp at time zone 'America/New_York', :'today'::date);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-000000257b01', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.bout_setup('00000000-0000-0000-0000-000000257b01', 3);
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-000000257b01', :'bob');
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-000000257b01', :'ann', :'today', 5000), ('00000000-0000-0000-0000-000000257b01', :'bob', :'today', 5000);
-- Bob throws two exchanges on Auto: Ann has them to face.
select tests.sign_in(:'bob');
set local role authenticated;
select public.ring_exchange_auto('bout', '00000000-0000-0000-0000-000000257b01', 2);
reset role;
select count(*)::int as waiting from public.ring_exchanges x
  where x.challenge_id = '00000000-0000-0000-0000-000000257b01' and x.attacker = :'bob'
    and exists (select 1 from public.bout_punches p where p.exchange_id = x.id and p.points > 0) \gset
select tests.sign_in(:'ann');
set local role authenticated;
select public.ring_defend_auto('bout', '00000000-0000-0000-0000-000000257b01') as f1 \gset
select is((:'f1'::jsonb ->> 'combos')::int, :waiting, 'Auto faces every combination that got through');
reset role;
select is((select count(*)::int from public.ring_exchanges where challenge_id = '00000000-0000-0000-0000-000000257b01' and auto_defended and defended_at is not null), :waiting,
  'Each marked as faced on Auto');
select is((select count(*)::int from public.bout_punches p join public.ring_exchanges x on x.id = p.exchange_id
           where x.auto_defended and p.counter), 0, 'No counters on Auto');

-- ── Admin ──
select tests.sign_in(:'ada');
set local role authenticated;
select ok((public.admin_auto_play_overview() ->> 'derby_auto_7d')::int >= 4 and (public.admin_auto_play_overview() ->> 'shootout_auto_7d')::int >= 4,
  'Admin counts auto swings and kicks');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.admin_auto_play_overview()$$, 'not authorized', 'Admins only');
reset role;

select * from finish();
