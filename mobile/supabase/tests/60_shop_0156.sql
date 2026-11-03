-- 0156: body and feet clothes are bought, worn and seen by friends; a
-- body item can't go on the feet; Admin → Shop numbers are for admins.
select plan(9);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset
select (now() at time zone 'utc')::date as today \gset
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bob', 'accepted');
update public.profiles set bones_balance = 1000 where id = :'bob';

select tests.sign_in(:'bob');
set local role authenticated;
select public.buy_kennel_item(:'today', 'body_tux');
select public.buy_kennel_item(:'today', 'booties_red');
select throws_ok(format('select public.equip_kennel_item(%L, ''feet'', ''body_tux'')', :'today'),
  'You don''t have that yet.', 'A body item can''t go on the feet');
select public.equip_kennel_item(:'today', 'body', 'body_tux');
select public.equip_kennel_item(:'today', 'feet', 'booties_red');
select is((select body_id || ',' || feet_id from public.my_kennel(:'today')), 'body_tux,booties_red', 'The tux and booties go on');
select is((select bones_balance from public.my_kennel(:'today')), 520, 'and came off the balance');
select throws_ok('select public.admin_shop_overview()', 'not authorized', 'Only admins see the shop numbers');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select is((select body_id from public.friend_kennel(:'bob', :'today')), 'body_tux', 'Friends see the outfit');
reset role;

insert into public.bones_purchases (user_id, store, product_id, transaction_id, bones_credited) values
  (:'bob', 'app_store', 'bones_pack_large', 't1', 1200),
  (:'bob', 'app_store', 'bones_pack_small', 't2', 100);

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.admin_shop_overview() ->> 'revenue_30d')::numeric, 11.98, 'Counts pack revenue');
select is((public.admin_shop_overview() ->> 'buyers_30d')::int, 1, 'and buyers');
select is((public.admin_shop_overview() -> 'spent_30d' ->> 'clothes')::int, 480, 'and Bones spent on clothes');
select is((public.admin_shop_overview() ->> 'wearing_body')::int, 1, 'and who''s wearing a body item');
reset role;

select * from finish();
