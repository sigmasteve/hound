-- 0157: the Porch opens at Hunter and porch items need it; a bougie
-- house is bought like any house; gifts go to friends only, once, with a
-- clean note, and show up once; friends see the porch; admins see counts.
select plan(16);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cy') as cy \gset
select (now() at time zone 'utc')::date as today \gset
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bob', 'accepted');
update public.profiles set bones_balance = 5000, xp_total = 0 where id in (:'ann', :'bob');

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok(format('select public.buy_kennel_item(%L, ''porch_hottub'')', :'today'), 'Unlock the Porch first.',
  'Porch items need the Porch');
select throws_ok(format('select public.buy_kennel_item(%L, ''zone_porch'')', :'today'), 'The Porch opens at Hunter (level 10).',
  'The Porch needs Hunter');
reset role;

update public.profiles set xp_total = 100000 where id = :'bob';
update public.profiles set bones_balance = 10000 where id = :'bob';
select bones_balance as bob_bones from public.profiles where id = :'bob' \gset

select tests.sign_in(:'bob');
set local role authenticated;
select lives_ok(format('select public.buy_kennel_item(%L, ''zone_porch'')', :'today'), 'At Hunter, the Porch unlocks');
select lives_ok(format('select public.buy_kennel_item(%L, ''porch_hottub'')', :'today'), 'and a hot tub goes on it');
select lives_ok(format('select public.buy_kennel_item(%L, ''house_mansion'')', :'today'), 'A mansion is bought like any house');
select is((select bones_balance from public.profiles where id = :'bob'), :'bob_bones'::int - 1500 - 1200 - 2500, 'and they all cost Bones');
select is(public.my_yard(:'today') -> 'porch', '["porch_hottub"]'::jsonb, 'The yard has the porch and what''s on it');
reset role;

-- Gifts.
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.friend_yard(:'bob', :'today')) -> 'porch', '["porch_hottub"]'::jsonb, 'Friends see the porch');
select throws_ok(format('select public.gift_kennel_item(%L, ''hat_crown'', null, %L)', :'cy', :'today'),
  'You can only send gifts to friends.', 'Gifts only go to friends');
select throws_ok(format('select public.gift_kennel_item(%L, ''zone_porch'', null, %L)', :'bob', :'today'),
  'That can''t be sent as a gift.', 'The Porch itself can''t be a gift');
select throws_ok(format('select public.gift_kennel_item(%L, ''hat_crown'', ''you fucking legend'', %L)', :'bob', :'today'),
  'Keep it clean: one of those words isn''t allowed.', 'Notes are kept clean');
select is(public.gift_kennel_item(:'bob', 'hat_crown', '  Happy   birthday! ', :'today'), 4700, 'A gift costs the giver');
select throws_ok(format('select public.gift_kennel_item(%L, ''hat_crown'', null, %L)', :'bob', :'today'),
  'They already have that.', 'Not something they have');
select is((public.admin_shop_overview() ->> 'gifts_30d')::int, 1, 'Admins see gifts');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is((select item_name || ': ' || note from public.my_new_gifts()), 'Crown: Happy birthday!', 'The friend gets it, with the note');
select is((select count(*)::int from public.my_new_gifts()), 0, 'and sees it once');
reset role;

select * from finish();
