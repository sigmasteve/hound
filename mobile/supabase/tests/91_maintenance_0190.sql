-- 0190: maintenance windows, the "now" switch, and who saw the heads-up.
select plan(16);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bea') as bea \gset
select tests.new_user('Ada', true) as ada \gset

-- Before sign-in, the app can read it.
set local role anon;
select is((select now_on from public.app_maintenance), false, 'Anyone can read it, signed in or not, and it starts off');
select throws_ok($$update public.app_maintenance set now_on = true where id$$, '42501', null, 'but nobody writes it directly');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.admin_set_maintenance('x', now() + interval '1 hour', 10)$$, 'not authorized', 'Only admins schedule it');
select throws_ok($$select public.admin_set_maintenance_now(true)$$, 'not authorized', 'or switch it on');
select throws_ok($$select public.admin_maintenance_overview()$$, 'not authorized', 'or see who saw it');
select throws_ok($$select * from public.maintenance_seen$$, '42501', null, 'and the seen log is private');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok($$select public.admin_set_maintenance('x', now() + interval '1 hour', 0)$$, 'It can last from 1 minute to 8 hours.', 'A window has a length');
select throws_ok($$select public.admin_set_maintenance('x', now() - interval '2 hours', 30)$$, 'That window is already over.', 'and is not over already');
select lives_ok($$select public.admin_set_maintenance('  Making Hound faster.  ', date_trunc('minute', now()) + interval '3 hours', 10)$$, 'Admin schedules a window');
select is((select ends_at - starts_at from public.app_maintenance), interval '10 minutes', 'It ends 10 minutes after it starts');
select is((select message from public.app_maintenance), 'Making Hound faster.', 'The message is trimmed');
reset role;

select starts_at as win from public.app_maintenance \gset

select tests.sign_in(:'ann');
set local role authenticated;
select public.mark_maintenance_seen(:'win'::timestamptz);
select public.mark_maintenance_seen(:'win'::timestamptz);
select public.mark_maintenance_seen(now());
reset role;
select tests.sign_in(:'bea');
set local role authenticated;
select public.mark_maintenance_seen(:'win'::timestamptz);
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_maintenance_overview() ->> 'seen')::int, 2, 'Two people saw the heads-up, once each, and only for the real window');
select public.admin_set_maintenance_now(true);
select is((select now_on from public.app_maintenance), true, 'Maintenance now goes on');
select public.admin_set_maintenance_now(false);
select public.admin_clear_maintenance();
select is((select starts_at from public.app_maintenance), null, 'Cancelling clears the window');
select is((public.admin_maintenance_overview() ->> 'seen')::int, 0, 'and there is no current heads-up to count');
select is((public.admin_maintenance_overview() ->> 'seen_all')::int, 2, 'but the history stays');
reset role;

select * from finish();
