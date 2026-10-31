-- 0112: a limited-time Kennel item can be bought through its last day,
-- not after, and one you already have can still be worn. The dates are
-- set relative to today so this runs the same whenever it's run.
select plan(5);

select tests.new_user('Ann') as ann \gset
select (now() at time zone 'utc')::date as today \gset
update public.profiles set bones_balance = 1000 where id = :'ann';

select is((select count(*)::int from public.kennel_items where available_until = '2026-10-31'), 5, 'Five Halloween items');

-- Pumpkin Hat's last day is today; the Witch Hat's was yesterday.
update public.kennel_items set available_until = :'today' where id = 'hat_pumpkin';
update public.kennel_items set available_until = :'today'::date - 1 where id = 'hat_witch';

select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok(format('select public.buy_kennel_item(%L, %L)', :'today', 'hat_pumpkin'), 'On its last day it can be bought');
select throws_ok(format('select public.buy_kennel_item(%L, %L)', :'today', 'hat_witch'),
  'That one was only around for a while, and it''s gone now.', 'After its last day it can''t');
reset role;

-- The pumpkin hat's season ends too; Ann still has it.
update public.kennel_items set available_until = :'today'::date - 1 where id = 'hat_pumpkin';
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok(format('select public.equip_kennel_item(%L, %L, %L)', :'today', 'head', 'hat_pumpkin'),
  'One you bought can still be worn after its season');
select lives_ok(format('select public.buy_kennel_item(%L, %L)', :'today', 'collar_red'), 'Everyday items are unaffected');
reset role;

select * from finish();
