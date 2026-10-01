-- 0091: push tokens follow whoever is signed in, account deletion, and an
-- organization always keeps an admin.
select plan(9);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
select tests.new_user('Eve') as eve \gset

-- H7: a shared phone's token moves to the person signed in now.
select tests.sign_in(:'bob');
set local role authenticated;
select public.claim_push_token('ExponentPushToken[shared-phone]', 'ios');
reset role;
select tests.sign_in(:'cat');
set local role authenticated;
select public.claim_push_token('ExponentPushToken[shared-phone]', 'ios');
select throws_ok($q$select public.claim_push_token('not a token', 'ios')$q$,
  'That is not a push token.', 'H7: only real Expo push tokens are accepted');
reset role;
select is((select user_id from public.device_push_tokens where expo_push_token = 'ExponentPushToken[shared-phone]'),
  :'cat'::uuid, 'H7: the phone''s token now belongs to the person signed in');

-- H8 / M7: deleting an account hands shared challenges on and removes solo ones.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('22222222-0000-0000-0000-000000000001', 'Shared', 'steps', :'dan', 7, now(), now() + interval '7 days'),
  ('22222222-0000-0000-0000-000000000002', 'Solo', 'steps', :'dan', 7, now(), now() + interval '7 days');
insert into public.challenge_participants (challenge_id, user_id, joined_at) values
  ('22222222-0000-0000-0000-000000000001', :'dan', now() - interval '2 minutes'),
  ('22222222-0000-0000-0000-000000000001', :'eve', now() - interval '1 minute'),
  ('22222222-0000-0000-0000-000000000002', :'dan', now());

select tests.sign_in(:'dan');
set local role authenticated;
select throws_ok(format('select public.delete_account_data(%L)', :'dan'),
  '42501', null, 'H8: signed-in users cannot call the deletion cleanup directly');
reset role;

set local role service_role;
select public.delete_account_data(:'dan');
reset role;
select lives_ok(format('delete from auth.users where id = %L', :'dan'),
  'M7: the account can then be deleted without a foreign-key error');
select is((select created_by from public.challenges where id = '22222222-0000-0000-0000-000000000001'),
  :'eve'::uuid, 'H8: a shared challenge is handed to the next player');
select is((select count(*)::int from public.challenges where id = '22222222-0000-0000-0000-000000000002'),
  0, 'H8: a challenge nobody else is in is removed');

-- An organization can't lose its last admin.
insert into public.organizations (id, name, kind, invite_code)
values ('33333333-0000-0000-0000-000000000001', 'Org', 'company', 'ORG' || left(gen_random_uuid()::text, 5));
update public.profiles set organization_id = '33333333-0000-0000-0000-000000000001', org_role = 'admin' where id = :'bob';
update public.profiles set organization_id = '33333333-0000-0000-0000-000000000001', org_role = 'member' where id = :'cat';

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok(format('select public.org_set_member_role(%L, %L)', :'bob', 'member'),
  'An organization needs at least one admin. Make someone else an admin first.',
  'The last admin cannot demote themselves');
select lives_ok(format('select public.org_set_member_role(%L, %L)', :'cat', 'admin'),
  'Making someone else an admin works');
select lives_ok(format('select public.org_set_member_role(%L, %L)', :'bob', 'member'),
  'Then the first admin can step down');
reset role;

select * from finish();
