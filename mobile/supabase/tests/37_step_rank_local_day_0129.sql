-- 0129: the Step rank is asked for the phone's own day. A US evening is
-- already tomorrow in UTC; the phone's date still finds today's row.
select plan(7);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select (now() at time zone 'utc')::date as utc_today \gset

-- Both phones are a day behind UTC (an evening in the US): today's rows
-- as the phones write them, and yesterday's from the day before.
select tests.sign_in(:'ann');
set local role authenticated;
insert into public.daily_step_totals (user_id, day, steps) values (:'ann', :'utc_today'::date - 1, 9000);
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
insert into public.daily_step_totals (user_id, day, steps) values (:'bob', :'utc_today'::date - 1, 12000);
reset role;
insert into public.daily_step_totals (user_id, day, steps) values
  (:'ann', :'utc_today'::date - 2, 3000), (:'bob', :'utc_today'::date - 2, 1000);

select tests.sign_in(:'ann');
set local role authenticated;
select is((select rank from public.my_daily_step_rank(:'utc_today'::date - 1)), 2::bigint, 'Ann is second on her own today');
select is((select total_users from public.my_daily_step_rank(:'utc_today'::date - 1)), 2::bigint, 'of two');
select is((select count(*)::int from public.my_daily_step_rank()), 0, 'An older app asking for the UTC day finds no row yet');
select is((select count(*)::int from public.my_daily_step_rank(:'utc_today'::date - 5)), 0, 'A date far from the server''s falls back to the UTC day');
select is((select rank from public.my_weekly_step_rank(:'utc_today'::date - 1)), 2::bigint, 'The week ending on her day: 12,000 to Bob''s 13,000');
select is((select rank from public.my_daily_step_rank_change(:'utc_today'::date - 1)), 2::bigint, 'The tile: second today');
select is((select yesterday_rank from public.my_daily_step_rank_change(:'utc_today'::date - 1)), 1::bigint, 'and first yesterday');
reset role;

select * from finish();
