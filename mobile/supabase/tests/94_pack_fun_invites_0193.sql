-- 0193: inviting more people to a Pack Fun, and my_pack_funs' club and
-- starter for Today and the Clubs tab.
select plan(9);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bea') as bea \gset
select tests.new_user('Cal') as cal \gset
select tests.new_user('Dee') as dee \gset
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bea', 'accepted'), (:'ann', :'cal', 'accepted'), (:'dee', :'ann', 'pending');

-- Ann starts one on her own.
select tests.sign_in(:'ann');
set local role authenticated;
select public.start_pack_fun('Lunch walk', 30) as pack \gset
select is((public.invite_to_pack_fun(:'pack', array[:'bea', :'dee']::uuid[]) -> 'added' ->> 0)::uuid, :'bea'::uuid, 'Ann invites Bea after it started');
select is((public.invite_to_pack_fun(:'pack', array[:'dee']::uuid[]) -> 'skipped' -> 0 ->> 'why'), 'not_friend', 'A pending friend is skipped, and Ann is told why');
select is((public.invite_to_pack_fun(:'pack', array[:'bea']::uuid[]) -> 'skipped' -> 0 ->> 'why'), 'already', 'Someone already in it is skipped too');
select is(jsonb_array_length(public.pack_fun_state(:'pack') -> 'members'), 2, 'Bea is on the board as invited');
reset role;

-- Bea, invited but not joined, can't invite anyone yet.
select tests.sign_in(:'bea');
set local role authenticated;
select is((public.my_pack_funs() -> 0 ->> 'invited')::boolean, true, 'Bea sees it as an invite');
select is((public.my_pack_funs() -> 0 ->> 'creator_name'), 'Ann', 'with who started it');
select throws_ok(format('select public.invite_to_pack_fun(%L, array[%L]::uuid[])', :'pack', :'cal'), 'not authorized', 'Only people in it invite more');
reset role;

-- Not after it's over.
select tests.sign_in(:'ann');
set local role authenticated;
select public.end_pack_fun(:'pack');
select throws_ok(format('select public.invite_to_pack_fun(%L, array[%L]::uuid[])', :'pack', :'cal'), 'That Pack Activity is over.', 'No invites once it''s over');
reset role;

select is((select count(*)::int from public.pack_fun_members where pack_id = :'pack'), 2, 'Cal and Dee were never added');

select * from finish();
