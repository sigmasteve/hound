-- 0265: Bullseye volleys (1 to 3 arrows off one draw, within the round)
-- and fewer arrows a day (4 rounds, 6 carried over).
select plan(9);

select is((select max_ends from public.bullseye_settings), 4, 'Four rounds a day');
select is((select carry_max from public.bullseye_settings), 6, 'Six arrows carried over at most');

select tests.new_user_with_id('00000000-0000-0000-0000-00000009b001', 'Ann') as ann \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York' where id = :'ann';
select public.soccer_today(:'ann') as today \gset
select '00000000-0000-0000-0000-0000000910e1' as cid \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  (:'cid', 'Volleys', 'bullseye', :'ann', 7,
   ((:'today'::date - 1)::timestamp at time zone 'America/New_York'), ((:'today'::date + 6)::timestamp at time zone 'America/New_York'), :'today'::date - 1);
insert into public.challenge_participants (challenge_id, user_id) values (:'cid', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.bullseye_setup(:'cid', 70, 'none', 'none', false, false);
reset role;
-- 9,000 steps would be 6 rounds; now it's 4 (12 arrows).
insert into public.daily_step_totals (user_id, day, steps) values (:'ann', :'today', 9000);

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.bullseye_state(:'cid') -> 'today' ->> 'left')::int, 12, '9,000 steps: 4 rounds, 12 arrows');
select (public.bullseye_aim(:'cid', '18') ->> 'aimId')::bigint as a1 \gset
reset role;
update public.bullseye_aims set started_at = now() - interval '5 seconds' where not fired;
select tests.sign_in(:'ann');
set local role authenticated;
select public.bullseye_volley(:'cid', :a1, 0, 0, 2000, 3) as v1 \gset
select is((:'v1'::jsonb ->> 'count')::int, 3, 'A volley of three');
select is(jsonb_array_length(:'v1'::jsonb -> 'arrows'), 3, 'three arrows shot');
select is(array(select (e ->> 'arrowNo')::int from jsonb_array_elements(:'v1'::jsonb -> 'arrows') e), array[1, 2, 3], 'arrows 1, 2 and 3 of the round');
select is((:'v1'::jsonb ->> 'points')::int, (select sum((e ->> 'points')::int)::int from jsonb_array_elements(:'v1'::jsonb -> 'arrows') e), 'points add up');
select throws_ok(format('select public.bullseye_volley(%L, %s, 0, 0, 2000, 3)', :'cid', :a1), 'That arrow''s already gone.', 'One volley a draw');
-- One arrow into the next round, then a volley of 3 only gets the 2 left in it.
select (public.bullseye_aim(:'cid', '18') ->> 'aimId')::bigint as a2 \gset
select public.bullseye_shoot(:'cid', :a2, 0, 0, 2000);
select (public.bullseye_aim(:'cid', '18') ->> 'aimId')::bigint as a3 \gset
select is((public.bullseye_volley(:'cid', :a3, 0, 0, 2000, 3) ->> 'count')::int, 2, 'A volley stays inside the round');
reset role;

select * from finish();
