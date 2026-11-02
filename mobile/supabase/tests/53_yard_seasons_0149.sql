-- 0149: the Yard's limited-time items are bought and placed like any
-- other, and each has a last day.
select plan(3);

select tests.new_user('Ann') as ann \gset
select (now() at time zone 'utc')::date as today \gset
update public.profiles set bones_balance = 300, xp_total = 350 where id = :'ann';
-- On sale for this test, whatever today is.
update public.kennel_items set available_until = :'today'::date + 30 where id = 'house_gingerbread';

select tests.sign_in(:'ann');
set local role authenticated;
select public.buy_kennel_item(:'today', 'house_gingerbread');
select public.place_yard_item(:'today', 'house', 'house_gingerbread');
select is(public.my_yard(:'today') #>> '{spots,house}', 'house_gingerbread', 'A seasonal house goes in the house spot');
select is((select bones_balance from public.profiles where id = :'ann'), 100, 'for its 200 Bones');
reset role;

select is(
  (select count(*)::int from public.kennel_items
    where id in ('ground_pumpkins', 'house_gingerbread', 'ground_snowman', 'fence_garland') and available_until is not null),
  4, 'Every seasonal yard item has a last day');

select * from finish();
