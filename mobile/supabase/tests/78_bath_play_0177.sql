-- 0177: bath time you play. 6,000 steps or a Bones pack bought today
-- earn the bath too; finish_bath pays the bubbles, capped by the
-- settings; the quick bath pays nothing; admin numbers and settings.
select plan(24);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dee') as dee \gset
select current_date as today \gset

-- 6,000 steps is enough now.
insert into public.daily_step_totals (user_id, day, steps) values (:'ann', :'today', 6200), (:'dee', :'today', 5900);
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.my_care(:'today') -> 'bath' ->> 'earned', 'steps', '6,000 steps earn a bath');
select is((public.my_care(:'today') -> 'bath' ->> 'bubbles')::int, 10, 'Ten bubbles a bath');
select is((public.my_care(:'today') -> 'bath' ->> 'golden_bones')::int, 5, 'and a golden one worth 5');
reset role;
select is((select bones_balance from public.profiles where id = :'ann'), 0, 'Ann starts with no Bones');

select tests.sign_in(:'dee');
set local role authenticated;
select is(public.my_care(:'today') -> 'bath' ->> 'can_bath', 'false', '5,900 steps isn''t quite enough');
select throws_ok(format('select public.finish_bath(%L, 3, false)', :'today'),
  'A bath comes after an active day: a long walk, 6,000 steps, your goals done or a Bones pack.', 'and a played bath needs it earned too');
reset role;

-- Played: popped bubbles pay, capped at the settings' number.
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.finish_bath(:'today', 99, true) -> 'bath' ->> 'bath_bones', '15', 'At most 10 bubbles and the golden 5');
select is(public.my_care(:'today') -> 'bath' ->> 'bath_kind', 'play', 'A played bath');
select throws_ok(format('select public.finish_bath(%L, 4, false)', :'today'), 'Already had a bath today. Squeaky clean.', 'One bath a day');
select throws_ok(format('select public.give_bath(%L)', :'today'), 'Already had a bath today. Squeaky clean.', 'quick or played');
reset role;
select is((select bones_balance from public.profiles where id = :'ann'), 15, 'Ann has her 15 Bones');
select is((select bones_earned_total from public.profiles where id = :'ann'), 15, 'counted as earned');
select is((select earned from public.hound_baths where user_id = :'ann'), 'steps', 'What earned it is kept');

-- A Bones pack bought today earns Bob's bath; the quick bath pays nothing.
insert into public.bones_purchases (user_id, store, product_id, transaction_id, bones_credited)
values (:'bob', 'app_store', 'bones_pack_small', 'tx-bob-1', 100);
select tests.sign_in(:'bob');
set local role authenticated;
select is(public.my_care(:'today') -> 'bath' ->> 'earned', 'pack', 'A Bones pack today earns a bath');
select is(public.give_bath(:'today') -> 'bath' ->> 'bath_kind', 'quick', 'Quick bath');
reset role;
select is((select bones_balance from public.profiles where id = :'bob'), 0, 'which pays no Bones');

-- A refunded pack doesn't count.
insert into public.bones_purchases (user_id, store, product_id, transaction_id, bones_credited, status)
values (:'cat', 'app_store', 'bones_pack_small', 'tx-cat-1', 100, 'refunded');
select tests.sign_in(:'cat');
set local role authenticated;
select is(public.my_care(:'today') -> 'bath' ->> 'can_bath', 'false', 'A refunded pack earns nothing');
reset role;

-- Settings: admins only; a smaller bath pays less, no golden pays none.
select tests.sign_in(:'cat');
set local role authenticated;
update public.bath_settings set bubbles = 30 where true;
reset role;
select is((select bubbles from public.bath_settings), 10, 'Only admins can change the bath settings');
select tests.sign_in(:'ann');
set local role authenticated;
update public.bath_settings set bubbles = 6, golden_bones = 0 where true;
reset role;
insert into public.daily_step_totals (user_id, day, steps) values (:'cat', :'today', 7000);
select tests.sign_in(:'cat');
set local role authenticated;
select is(public.finish_bath(:'today', 8, true) -> 'bath' ->> 'bath_bones', '6', 'Capped at the new 6, and no golden bubble');
reset role;

-- Admin numbers.
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.admin_bath_overview() ->> 'played_7d')::int, 2, 'Two baths played this week');
select is((public.admin_bath_overview() ->> 'quick_7d')::int, 1, 'one quick');
select is((public.admin_bath_overview() ->> 'bones_7d')::int, 21, 'and 21 Bones paid');
select is(public.admin_bath_overview() -> 'by_earned_7d' ->> 'pack', '1', 'One earned by a Bones pack');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok('select public.admin_bath_overview()', 'not authorized', 'Admins only');
reset role;

select * from finish();
