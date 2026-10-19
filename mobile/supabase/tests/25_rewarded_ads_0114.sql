-- 0114: rewarded ads are off until an admin turns them on, pay Bones up
-- to the daily cap, never twice for one of Google's transactions, and
-- only through Google's callback once the server is the one to verify.
select plan(12);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Bob') as bob \gset
select bones_balance as bob_start from public.profiles where id = :'bob' \gset

select tests.sign_in(:'bob');
set local role authenticated;
select is((select available from public.my_ad_offer(current_date)), false, 'Ads are off to start');
select is((select awarded from public.claim_ad_reward(current_date)), false, 'and pay nothing');
select throws_ok('select public.set_ad_settings(true, 10, 3, false, false, null, null)', 'not authorized',
  'Only admins can turn them on');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok($q$select public.set_ad_settings(true, 10, 2, false, false, 'nope', null)$q$,
  'An ad unit id looks like ca-app-pub-1234567890123456/1234567890.', 'An ad unit id is checked');
select lives_ok('select public.set_ad_settings(true, 10, 2, false, false, null, null)', 'An admin turns them on, 2 a day');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is((select bones from public.claim_ad_reward(current_date)), 10, 'Watching one pays 10 Bones');
select is((select awarded from public.claim_ad_reward(current_date)), false, 'A second claim straight away pays nothing');
reset role;
update public.ad_rewards set created_at = now() - interval '1 minute';
select tests.sign_in(:'bob');
set local role authenticated;
select is((select awarded from public.claim_ad_reward(current_date)), true, 'The next ad pays');
reset role;
update public.ad_rewards set created_at = now() - interval '1 minute';
select tests.sign_in(:'bob');
set local role authenticated;
select is((select awarded from public.claim_ad_reward(current_date)), false, 'Past the daily cap, nothing');
reset role;

update public.ad_settings set verify_by_server = true, daily_cap = 5;
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok('select public.claim_ad_reward(current_date)', 'Bones for ads are paid by the server now.',
  'Once the server verifies, the app can''t claim');
reset role;

select public.credit_ad_reward_verified(:'bob', 'txn-1', null, current_date);
select public.credit_ad_reward_verified(:'bob', 'txn-1', null, current_date);
select is((select count(*)::int from public.ad_rewards where transaction_id = 'txn-1'), 1,
  'Google''s callback pays once per transaction');
select is((select bones_balance from public.profiles where id = :'bob') - :bob_start, 30, 'Bob has 30 more Bones from 3 ads');

select * from finish();
