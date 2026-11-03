-- 0159: a friend's yard says which tricks their hound knows.
select plan(2);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select (now() at time zone 'utc')::date as today \gset
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bob', 'accepted');
update public.profiles set bones_balance = 1000 where id = :'bob';

select tests.sign_in(:'bob');
set local role authenticated;
select public.buy_kennel_item(:'today', 'trick_spin');
select is(public.my_yard(:'today') -> 'tricks', '["trick_spin"]'::jsonb, 'Your yard lists your tricks');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.friend_yard(:'bob', :'today') -> 'tricks', '["trick_spin"]'::jsonb, 'and so does a friend''s');
reset role;

select * from finish();
