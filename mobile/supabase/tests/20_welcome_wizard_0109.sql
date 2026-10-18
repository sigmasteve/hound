-- 0109: the welcome wizard shows once for a new account, saves only
-- known answers, and isn't shown to someone who already finished
-- "Get started".
select plan(7);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset

select tests.sign_in(:'ann');
set local role authenticated;
select is((select show_wizard from public.my_welcome()), true, 'A new account sees the wizard');

select public.save_hound_uses(array['strength', 'friends', 'nonsense', 'strength']);
select is((select uses from public.my_welcome()), array['friends', 'strength'], 'Only known answers are saved, once each');

select public.finish_welcome();
select is((select show_wizard from public.my_welcome()), false, 'Finishing it means it doesn''t show again');

select throws_ok(
  format('update public.profiles set welcome_done_at = null where id = %L', :'ann'),
  '42501', null, 'Nobody can reset it directly');
select throws_ok(
  format('update public.profiles set hound_uses = %L where id = %L', '{steps}', :'ann'),
  '42501', null, 'or write the answers directly');
reset role;

-- Bob already finished "Get started" (and claimed its Bones) before the
-- wizard existed.
update public.profiles set onboarding_reward_claimed_at = now() where id = :'bob';

select tests.sign_in(:'bob');
set local role authenticated;
select is((select show_wizard from public.my_welcome()), false, 'Someone who finished Get started doesn''t see it');
reset role;

set local role anon;
select throws_ok('select public.finish_welcome()', '42501', null, 'Signed-out callers can''t use it');
reset role;

select * from finish();
