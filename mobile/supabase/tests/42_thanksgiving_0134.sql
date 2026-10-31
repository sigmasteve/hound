-- 0134: the Thanksgiving items exist with their last day, and behave
-- like any limited-time item (0112's rules).
select plan(4);

select tests.new_user('Ann') as ann \gset
select (now() at time zone 'utc')::date as today \gset
update public.profiles set bones_balance = 1000 where id = :'ann';

select is((select count(*)::int from public.kennel_items where available_until = '2026-11-30'), 4, 'Four Thanksgiving Kennel items');
select is((select count(*)::int from public.cosmetic_items where available_until = '2026-12-01 08:00:00+00'), 7, 'Seven Thanksgiving Locker items');

-- Make the Turkey Hat's last day today, so this runs the same whenever.
update public.kennel_items set available_until = :'today' where id = 'hat_turkey';
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok(format('select public.buy_kennel_item(%L, %L)', :'today', 'hat_turkey'), 'On its last day it can be bought');
select lives_ok(format('select public.equip_kennel_item(%L, %L, %L)', :'today', 'head', 'hat_turkey'), 'and worn');
reset role;

select * from finish();
