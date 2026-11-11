-- 0187: invite friends to a club. Only friends, only by members; an
-- invite gets you into a private club; the badge counts invites.
select plan(12);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
select tests.new_user('Ada', true) as ada \gset

update public.profiles set xp_total = 100000, created_at = now() - interval '30 days', username = 'annruns' where id = :'ann';
update public.profiles set username = 'bobbikes' where id = :'bob';
insert into public.community_age_ok (user_id) values (:'ann'), (:'bob'), (:'cat');
-- Ann is friends with Bob and Cat; not with Dan.
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bob', 'accepted'), (:'cat', :'ann', 'accepted');

select tests.sign_in(:'ann');
set local role authenticated;
select (public.create_club('Waffle House Crew', 'mixed', null, null, 'green', false))->>'id' as crew \gset
select is(jsonb_array_length(public.friends_for_club(:'crew')), 2, 'Ann''s list shows her two friends');
select is(public.invite_to_club(:'crew', array[:'bob', :'cat', :'dan']::uuid[]), 2, 'Ann invites her friends (Dan isn''t one)');
select is(public.invite_to_club(:'crew', array[:'bob']::uuid[]), 0, 'An invite already waiting isn''t sent twice');
select is((public.friends_for_club(:'crew')->0->>'invited')::boolean, true, 'and the list shows who''s invited');
reset role;

select tests.sign_in(:'dan');
set local role authenticated;
select throws_ok(format('select public.invite_to_club(%L, array[%L]::uuid[])', :'crew', :'bob'), 'Only people in the club can invite to it.', 'Only members invite');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is(jsonb_array_length(public.my_club_invites()), 1, 'Bob sees his invite');
select is(public.my_club_invites()->0->>'invited_by', 'Ann', 'from Ann');
select is(public.clubs_badge(), 1, 'and it counts on his Clubs tab');
select lives_ok(format('select public.accept_club_invite(%L)', :'crew'), 'Bob joins the private club from the invite, no code');
select is(public.clubs_badge(), 0, 'Joined: nothing waiting');
reset role;

-- Cat has no username yet: the invite asks for one.
select tests.sign_in(:'cat');
set local role authenticated;
select throws_ok(format('select public.accept_club_invite(%L)', :'crew'), 'Pick a username first (Settings → Profile): clubs show usernames.', 'Joining from an invite still needs a username');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_clubs_overview()->>'invites_accepted_30d')::int, 1, 'Admin counts invites accepted');
reset role;

select * from finish();
