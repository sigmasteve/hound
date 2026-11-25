-- 0264: moon forms: the switch, scenes watched (only ranks reached), the
-- one-time catch-up, a friend's switch, and Admin's numbers.
select plan(13);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Pup') as pup \gset
select tests.new_user('Boss', true) as boss \gset
-- Ann is level 12 (Hunter): xp for level 12 = 10*144 + 240.
update public.profiles set xp_total = 1700 where id = :'ann';

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.moon_state() -> 'reached', '["tracker", "hunter"]'::jsonb, 'Level 12 has reached Tracker and Hunter');
select is((public.moon_state() ->> 'on')::boolean, true, 'The moon look is on by default');
select is((public.moon_state() ->> 'catchup_due')::boolean, true, 'The catch-up is due');
select throws_ok($$select public.moon_watched('alpha', 'replay')$$, 'Your hound hasn''t reached that form yet.', 'Not a form not reached');
select public.moon_watched('tracker', 'catchup');
select public.moon_watched('hunter', 'catchup', true);
select is(public.moon_state() -> 'watched', '["tracker"]'::jsonb, 'Watched Tracker (Hunter was skipped)');
select is((public.moon_state() ->> 'catchup_due')::boolean, false, 'The catch-up isn''t offered again');
select public.moon_set(false);
select is((public.moon_state() ->> 'on')::boolean, false, 'Switched off');
reset role;

select tests.sign_in(:'pup');
set local role authenticated;
select is(public.moon_state() -> 'reached', '[]'::jsonb, 'A new account has no forms yet');
select is((public.moon_state() ->> 'catchup_due')::boolean, false, 'and nothing to catch up on');
select is(public.moon_forms_on(:'ann'), false, 'Others see Ann''s switch');
select throws_ok($$select public.admin_moon_overview()$$, 'Admins only.', 'Admin numbers are admin-only');
reset role;

select tests.sign_in(:'boss');
set local role authenticated;
select is((public.admin_moon_overview() ->> 'watchers')::int, 1, 'One person has watched');
select is((public.admin_moon_overview() ->> 'switched_off')::int, 1, 'One switched it off');
reset role;

select * from finish();
