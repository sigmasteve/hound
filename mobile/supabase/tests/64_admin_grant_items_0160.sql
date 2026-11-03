-- 0160: admins can give a member the Porch and its items before they've
-- earned them, see what they gave, and take back only what they gave.
select plan(8);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Sis') as sis \gset
select (now() at time zone 'utc')::date as today \gset
update public.profiles set xp_total = 0, bones_balance = 2000 where id = :'sis';

select tests.sign_in(:'sis');
set local role authenticated;
select throws_ok(format('select public.admin_give_items(%L, array[''zone_porch''])', :'sis'), 'Only an admin can do that.',
  'Members can''t give themselves things');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.admin_give_items(:'sis', array['zone_porch']), 1, 'An admin gives the Porch, below Hunter');
select is(public.admin_give_items(:'sis', array['zone_porch', 'porch_hottub']), 1, 'Only what they don''t have yet');
reset role;

select tests.sign_in(:'sis');
set local role authenticated;
select is(public.my_yard(:'today') -> 'porch', '["porch_hottub"]'::jsonb, 'They have the Porch and the hot tub');
select lives_ok(format('select public.buy_kennel_item(%L, ''porch_lounge'')', :'today'), 'and can buy for it');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select is((select count(*)::int from public.admin_member_items(:'sis') where given), 2, 'The admin sees what was given');
select is(public.admin_take_items(:'sis', array['zone_porch', 'porch_hottub', 'porch_lounge']), 2,
  'Taking back takes only what an admin gave');
reset role;
select ok(exists (select 1 from public.kennel_purchases where user_id = :'sis' and item_id = 'porch_lounge'),
  'What they bought stays theirs');

select * from finish();
