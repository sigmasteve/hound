-- 0102: a bounty takes the poster's Bones, the first friend to the
-- target gets them, nobody else can see or claim it, and an unclaimed
-- one comes back.
select plan(16);

select tests.new_user('Steve') as steve \gset
select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Stranger') as stranger \gset
update public.profiles set bones_balance = 200 where id = :'steve';
insert into public.friendships (requester_id, recipient_id, status) values
  (:'steve', :'ann', 'accepted'), (:'bob', :'steve', 'accepted');

select tests.sign_in(:'stranger');
set local role authenticated;
select throws_ok('select public.post_bounty(15000, 25, now() + interval ''5 hours'')',
  'Add a friend first: bounties are for your friends.', 'No friends, no bounty');
reset role;

select tests.sign_in(:'steve');
set local role authenticated;
select throws_ok('select public.post_bounty(15000, 500, now() + interval ''5 hours'')',
  'A bounty is 10 to 100 Bones.', 'At most 100 Bones');
select throws_ok('select public.post_bounty(15000, 25, now() + interval ''10 minutes'')',
  'It''s too late in the day for a bounty. Post one tomorrow.', 'Too close to the end of the day');
select public.post_bounty(15000, 30, now() + interval '5 hours') as bid \gset
select throws_ok('select public.post_bounty(15000, 30, now() + interval ''5 hours'')',
  'You already have a bounty out.', 'One bounty at a time');
select throws_ok(format('update public.bounties set bones = 1 where id = %L', :'bid'), '42501', null,
  'Nobody can change a bounty directly');
reset role;
select is((select bones_balance from public.profiles where id = :'steve'), 170, 'Posting takes the Bones');

select tests.sign_in(:'stranger');
set local role authenticated;
select is((select count(*)::int from public.list_bounties()), 0, 'A stranger doesn''t see it');
select throws_ok(format('select * from public.claim_bounty(%L, 20000)', :'bid'),
  'That bounty isn''t open to you.', 'A stranger can''t claim it');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select is((select count(*)::int from public.list_bounties()), 1, 'A friend sees it');
select is((select claimed from public.claim_bounty(:'bid', 12000)), false, 'Short of the target claims nothing');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is((select bones from public.claim_bounty(:'bid', 16000)), 30, 'The first friend to the target gets the Bones');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select is((select claimed from public.claim_bounty(:'bid', 18000)), false, 'Only the first claim pays');
reset role;
select is((select bones_balance from public.profiles where id = :'bob'), 30, 'The winner''s balance goes up');

-- Unclaimed: it comes back when it runs out.
select tests.sign_in(:'steve');
set local role authenticated;
select public.post_bounty(10000, 50, now() + interval '5 hours') as bid2 \gset
reset role;
update public.bounties set ends_at = now() - interval '1 minute' where id = :'bid2';
select tests.sign_in(:'steve');
set local role authenticated;
select is((select status from public.list_bounties() where id = :'bid2'), 'refunded', 'A bounty nobody hit is refunded');
reset role;
select is((select bones_balance from public.profiles where id = :'steve'), 170, 'The Bones come back');

-- Taken back before anyone claims it.
select tests.sign_in(:'steve');
set local role authenticated;
select public.post_bounty(10000, 20, now() + interval '5 hours') as bid3 \gset
select public.cancel_bounty(:'bid3');
reset role;
select is((select bones_balance from public.profiles where id = :'steve'), 170, 'Taking it back returns the Bones');

select * from finish();
