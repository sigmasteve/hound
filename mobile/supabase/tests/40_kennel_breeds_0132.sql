-- 0132: breeds cost 600 Bones, go on and off like a coat, show to
-- friends, and join the avatar code only while one is on.
select plan(8);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select (now() at time zone 'utc')::date as today \gset
update public.profiles set bones_balance = 700 where id = :'ann';
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bob', 'accepted');

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format('select public.equip_kennel_item(%L, ''breed'', ''breed_corgi'')', :'today'),
  'You don''t have that yet.', 'A breed has to be bought first');
select public.buy_kennel_item(:'today', 'breed_corgi');
select is((select bones_balance from public.my_kennel(:'today')), 100, 'A breed costs 600 Bones');
select throws_ok(format('select public.buy_kennel_item(%L, ''breed_poodle'')', :'today'),
  'Not enough Bones.', 'and a second one needs the Bones for it');
select public.equip_kennel_item(:'today', 'breed', 'breed_corgi');
select is((select breed_id from public.my_kennel(:'today')), 'breed_corgi', 'The breed goes on');
select is(public.use_hound_avatar(:'today', true), 'hound:.floppy.wavy.none....breed_corgi', 'and joins the avatar code');
select public.equip_kennel_item(:'today', 'breed', null);
select is((select equipped_icon_id from public.profiles where id = :'ann'), 'hound:.floppy.wavy.none...',
  'Taking it off goes back to the hound, and the code is as before');
select public.equip_kennel_item(:'today', 'breed', 'breed_corgi');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is((select breed_id from public.friend_kennel(:'ann', :'today')), 'breed_corgi', 'A friend sees your breed');
reset role;

select is((select count(*)::int from public.kennel_items where slot = 'breed' and cost_bones = 600), 3, 'Three breeds, 600 each');

select * from finish();
