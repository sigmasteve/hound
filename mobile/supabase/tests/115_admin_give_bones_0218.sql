-- 0218: an admin gives a member Bones; they're spendable, not earned.
select plan(11);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Ann') as ann \gset
update public.profiles set bones_balance = 100, bones_earned_total = 40 where id = :'ann';

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$select public.admin_give_bones(%L, 50)$q$, :'ann'), 'Only an admin can do that.', 'Members can''t give themselves Bones');
select throws_ok(format($q$select public.admin_member_bones(%L)$q$, :'ann'), 'Only an admin can do that.', 'or read the card');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select is(public.admin_give_bones(:'ann', 250, '  Thanks for testing  '), 350, 'Returns the new balance');
select throws_ok(format($q$select public.admin_give_bones(%L, 0)$q$, :'ann'), 'Give between 1 and 10,000 Bones.', 'At least 1');
select throws_ok(format($q$select public.admin_give_bones(%L, 10001)$q$, :'ann'), 'Give between 1 and 10,000 Bones.', 'At most 10,000');
select throws_ok($q$select public.admin_give_bones('00000000-0000-0000-0000-000000000099', 5)$q$, 'No such member.', 'Only real members');
select is((public.admin_member_bones(:'ann') ->> 'given_total')::int, 250, 'The card shows what was given');
select is(public.admin_member_bones(:'ann') #>> '{grants,0,note}', 'Thanks for testing', 'with the note, trimmed');
select is((public.admin_bones_grants_overview() ->> 'people_30d')::int >= 1, true, 'Admin''s overview counts it');
reset role;

select is((select bones_balance from public.profiles where id = :'ann'), 350, 'The Bones are spendable');
select is((select bones_earned_total from public.profiles where id = :'ann'), 40, 'but not earned: locked games stay locked');

select * from finish();
