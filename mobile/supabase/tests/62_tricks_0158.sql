-- 0158: tricks are bought once with Bones, and admins see them.
select plan(4);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset
select (now() at time zone 'utc')::date as today \gset
update public.profiles set bones_balance = 400 where id = :'bob';

select tests.sign_in(:'bob');
set local role authenticated;
select is(public.buy_kennel_item(:'today', 'trick_highfive'), 200, 'A trick costs its Bones');
select throws_ok(format('select public.buy_kennel_item(%L, ''trick_highfive'')', :'today'), 'You already have that.', 'Bought once');
select throws_ok(format('select public.buy_kennel_item(%L, ''trick_playdead'')', :'today'), 'Not enough Bones.', 'Only with the Bones for it');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.admin_shop_overview() ->> 'tricks_bought')::int, 1, 'Admins see tricks bought');
reset role;

select * from finish();
