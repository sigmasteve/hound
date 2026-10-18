-- 0105: friends see each other's hounds and nobody else does, free coats
-- cost nothing and special ones cost Bones, and looks change for free.
select plan(9);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select (now() at time zone 'utc')::date as today \gset
update public.profiles set bones_balance = 100 where id = :'ann';
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bob', 'accepted');

select tests.sign_in(:'ann');
set local role authenticated;
select public.buy_kennel_item(:'today', 'coat_gray');
select public.equip_kennel_item(:'today', 'coat', 'coat_gray');
select is((select bones_balance from public.my_kennel(:'today')), 100, 'A free coat costs nothing');
select throws_ok(format('select public.equip_kennel_item(%L, ''coat'', ''coat_golden'')', :'today'),
  'You don''t have that yet.', 'A special coat has to be bought first');
select public.buy_kennel_item(:'today', 'coat_golden');
select is((select bones_balance from public.my_kennel(:'today')), 0, 'A special coat costs Bones');
select public.set_kennel_look(:'today', 'perky', 'curly', null);
select is((select ears || ',' || tail || ',' || markings from public.my_kennel(:'today')), 'perky,curly,none',
  'Looks change, and a null leaves one as it is');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is((select coat_id from public.friend_kennel(:'ann', :'today')), 'coat_gray', 'A friend sees your coat');
select is((select ears from public.friend_kennel(:'ann', :'today')), 'perky', 'and your look');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select is((select name from public.friend_kennel(:'bob', :'today')), 'Scout',
  'A friend who''s never opened the Kennel shows the default hound');
reset role;
select is((select count(*)::int from public.kennels where user_id = :'bob'), 0, 'Looking doesn''t make them a kennel');

select tests.sign_in(:'cat');
set local role authenticated;
select throws_ok(format('select * from public.friend_kennel(%L, %L)', :'ann', :'today'),
  'Only friends can see each other''s hounds.', 'Strangers can''t see your hound');
reset role;

select * from finish();
