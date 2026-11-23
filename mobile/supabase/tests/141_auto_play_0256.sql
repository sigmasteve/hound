-- 0256: Auto. The ring throws the exchanges you have left, every punch
-- clean (so a guard still blocks some), marked auto; Paw Slots spins
-- marked auto; Admin counts both.
select plan(11);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob');
select public.soccer_today(:'ann') as today \gset

-- ── The ring ──
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-000000256b01', 'Auto Gym', 'bout', :'ann', 3,
   (:'today'::date)::timestamp at time zone 'America/New_York', (:'today'::date + 3)::timestamp at time zone 'America/New_York', :'today'::date);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-000000256b01', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.bout_setup('00000000-0000-0000-0000-000000256b01', 3);
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-000000256b01', :'bob');
-- 5,000 steps: 3 actions.
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values ('00000000-0000-0000-0000-000000256b01', :'ann', :'today', 5000);

select tests.sign_in(:'ann');
set local role authenticated;
select public.ring_exchange_auto('bout', '00000000-0000-0000-0000-000000256b01') as a1 \gset
select is((:'a1'::jsonb ->> 'exchanges')::int, 3, 'Auto throws the 3 exchanges Ann has');
select is((:'a1'::jsonb ->> 'left')::int, 0, 'and none are left');
reset role;
select public.bout_reason('00000000-0000-0000-0000-000000256b01', :'ann') as why \gset
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.ring_exchange_auto('bout', '00000000-0000-0000-0000-000000256b01')$$, :'why', 'With nothing left, it says why');
reset role;
select is((select count(*)::int from public.ring_exchanges where challenge_id = '00000000-0000-0000-0000-000000256b01' and auto and finished_at is not null), 3,
  'Three finished exchanges, marked auto');
select is((select count(*)::int from public.bout_punches where challenge_id = '00000000-0000-0000-0000-000000256b01' and user_id = :'ann'), 9, 'Nine punches');
select is((select count(*)::int from public.bout_punches where challenge_id = '00000000-0000-0000-0000-000000256b01' and user_id = :'ann' and quality = 'clean' and not star), 9,
  'All clean, no stars: never perfect');

-- ── Paw Slots ──
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-000000256c01', 'Auto Slots', 'slots', :'ann', 7,
   ((:'today'::date - 1)::timestamp at time zone 'America/New_York'), ((:'today'::date + 6)::timestamp at time zone 'America/New_York'), :'today'::date - 1);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-000000256c01', :'ann');
insert into public.daily_step_totals (user_id, day, steps) values (:'ann', :'today', 3000);
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.slots_spin('00000000-0000-0000-0000-000000256c01', 1, 1)$$, 'A spin by hand');
select ok((public.slots_spin_auto('00000000-0000-0000-0000-000000256c01', 1, 1)) ? 'stops', 'An auto spin is an ordinary spin');
reset role;
select is((select array_agg(auto order by id) from public.slots_spins where challenge_id = '00000000-0000-0000-0000-000000256c01'), array[false, true],
  'Only the auto spin is marked');

-- ── Admin ──
select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_auto_play_overview() ->> 'ring_auto_7d')::int >= 3 and (public.admin_auto_play_overview() ->> 'slots_auto_7d')::int >= 1, true,
  'Admin counts auto exchanges and spins');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.admin_auto_play_overview()$$, 'not authorized', 'Admins only');
reset role;

select * from finish();
