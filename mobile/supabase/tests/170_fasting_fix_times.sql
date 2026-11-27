-- 0286: fixing a fast's times. A forgotten 48-hour fast put right (hours,
-- Bones, longest, the streak), the open fast's start, the limits, and
-- Admin's list, fix (including ending an open fast) and numbers.
select plan(31);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Boss', true) as boss \gset
select (now() at time zone 'utc')::date as today \gset
insert into public.fasting_profiles (user_id, age, age_at) values (:'ann', 'ok', now()), (:'bob', 'ok', now());
update public.profiles set bones_balance = 100 where id = :'ann';

-- Ann pressed Start two days ago and forgot to end it.
insert into public.fasts (user_id, goal_hours, started_at, created_at)
  values (:'ann', 16, now() - interval '48 hours', now() - interval '48 hours');
select id as f1 from public.fasts where user_id = :'ann' \gset

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.fasting_end(:'today'::date) ->> 'hours')::numeric >= 47.9, true, 'Ending it now counts 48 hours');
reset role;
select is((select bones from public.fasts where id = :'f1'), 25, 'The 48 hours paid the 20 h+ Bones');
select is((select bones_balance from public.profiles where id = :'ann'), 125, 'Ann has the 25');

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($$select public.fasting_fix(%L, now() - interval '48 hours', now() + interval '2 hours', %L)$$, :'f1', :'today'),
  'That time hasn''t happened yet.', 'No end in the future');
select throws_ok(format($$select public.fasting_fix(%L, now() - interval '30 hours', now() - interval '31 hours', %L)$$, :'f1', :'today'),
  'It has to end after it starts.', 'The end comes after the start');
select throws_ok(format($$select public.fasting_fix(%L, now() - interval '61 hours', now() - interval '30 hours', %L)$$, :'f1', :'today'),
  'A fast can start up to 12 hours before you pressed Start.', 'A start goes back 12 hours before Start at most');
select throws_ok(format($$select public.fasting_fix(%L, now() - interval '48 hours', now() - interval '30 hours', %L)$$, :'f1', (:'today'::date - 5)::text),
  'Invalid date.', 'The day has to be the new end''s');
-- She really ate 30 hours ago: an 18-hour fast.
select is((public.fasting_fix(:'f1', now() - interval '48 hours', now() - interval '30 hours', ((now() - interval '30 hours') at time zone 'utc')::date) ->> 'bones_change')::int,
  -5, 'Fixed to 18 hours: 5 Bones back (18 h pays 20)');
reset role;
select is((select hours from public.fasts where id = :'f1'), 18.00, 'The fast is 18 hours now');
select is((select on_plan from public.fasts where id = :'f1'), true, 'Still on plan');
select is((select bones from public.fasts where id = :'f1'), 20, 'It pays 20');
select is((select bones_balance from public.profiles where id = :'ann'), 120, 'Ann''s balance follows');
select is((select count(*)::int from public.fasting_fixes where fast_id = :'f1' and not by_admin), 1, 'The fix is kept');
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.my_fasting(:'today'::date) -> 'numbers' ->> 'longest')::numeric, 18.00, 'Her longest is 18 hours, not 48');

-- The fast she's on now: its start can move.
select public.fasting_start(16);
reset role;
select id as f2 from public.fasts where user_id = :'ann' and ended_at is null \gset
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.fasting_fix(:'f2', now() - interval '2 hours') ->> 'bones_change')::int, 0, 'She stopped eating 2 hours earlier: the start moves');
select throws_ok(format($$select public.fasting_fix(%L, now() - interval '13 hours')$$, :'f2'),
  'A fast can start up to 12 hours before you pressed Start.', 'Not more than 12 hours before Start');
select throws_ok(format($$select public.fasting_fix(%L, now() - interval '2 hours', now())$$, :'f2'),
  'End it with End fast.', 'The open fast ends with End fast');
select throws_ok(format($$select public.fasting_fix(%L, now() - interval '48 hours', now() - interval '1 hour', %L)$$, :'f1', :'today'),
  'That overlaps another fast.', 'A fix can''t run into another fast');
reset role;
select is((select started_at from public.fasts where id = :'f2') < now() - interval '119 minutes', true, 'The open fast starts 2 hours back');

-- Not someone else's, and not from long ago.
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok(format($$select public.fasting_fix(%L, now() - interval '3 hours')$$, :'f2'),
  'That fast isn''t yours.', 'Bob can''t fix Ann''s fast');
reset role;
insert into public.fasts (user_id, goal_hours, started_at, ended_at, hours, on_plan, local_day, created_at)
  values (:'ann', 16, now() - interval '9 days', now() - interval '8 days', 24, true, :'today'::date - 8, now() - interval '9 days');
select id as f0 from public.fasts where user_id = :'ann' and local_day = :'today'::date - 8 \gset
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($$select public.fasting_fix(%L, now() - interval '9 days', now() - interval '8 days' - interval '2 hours', %L)$$, :'f0', (:'today'::date - 8)::text),
  'You can fix fasts from the last 7 days.', 'Only the last 7 days');
reset role;

-- The streak is counted again: a fast on plan the day before f1's day
-- makes it 2; fixing f1 to 10 hours (off plan) brings it back to 1.
insert into public.fasts (user_id, goal_hours, started_at, ended_at, hours, on_plan, local_day, created_at)
  values (:'ann', 16, now() - interval '70 hours', now() - interval '52 hours', 18, true,
          ((now() - interval '30 hours') at time zone 'utc')::date - 1, now() - interval '70 hours');
select tests.sign_in(:'ann');
set local role authenticated;
select public.fasting_fix(:'f1', now() - interval '47 hours', now() - interval '30 hours', ((now() - interval '30 hours') at time zone 'utc')::date);
reset role;
select is((select streak from public.fasting_profiles where user_id = :'ann'), 2, 'Two days on plan in a row');
select tests.sign_in(:'ann');
set local role authenticated;
select public.fasting_fix(:'f1', now() - interval '40 hours', now() - interval '30 hours', ((now() - interval '30 hours') at time zone 'utc')::date);
reset role;
select is((select on_plan from public.fasts where id = :'f1'), false, '10 hours is short of the 16 h goal');
select is((select streak from public.fasting_profiles where user_id = :'ann'), 1, 'The streak counts the day before only');
select is((select best_streak from public.fasting_profiles where user_id = :'ann'), 2, 'The best streak doesn''t go down');

-- Admin.
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok(format($$select public.admin_user_fasts(%L)$$, :'ann'), 'Admins only.', 'Only admins see a member''s fasts');
select throws_ok(format($$select public.admin_fasting_fix(%L, now() - interval '2 hours', now())$$, :'f2'), 'Admins only.', 'Only admins fix them');
reset role;
select tests.sign_in(:'boss');
set local role authenticated;
select is(public.admin_user_fasts(:'ann') -> 'fasts' -> 0 ->> 'id', :'f2', 'The open fast is first in Admin''s list');
select is((public.admin_fasting_fix(:'f2', now() - interval '3 hours', now() - interval '1 hour') ->> 'hours')::numeric, 2.00,
  'An admin can end an open fast at a time');
select is((public.admin_fasting_fix_overview() ->> 'forgot_7d')::int, 1, 'Admin counts the forgotten fast fixed');
select is((public.admin_fasting_fix_overview() ->> 'admin_7d')::int, 1, 'And the admin''s own fix');
reset role;

select * from finish();
