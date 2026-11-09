-- 0185: clubs. Start one, join it (by search or code), post a challenge
-- to it, join that through the club, and Admin.
select plan(30);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Ada', true) as ada \gset

-- Ann is new and level 1.
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.create_club('Eastside Runners', 'running', 'Austin, TX', null, 'orange', true)$$, 'Reach level 3 to start a club.', 'A new account can''t start a club');
reset role;

-- Ann levels up, has a username and is a month old; Bob and Cat have
-- confirmed 13+.
update public.profiles set xp_total = 100000, created_at = now() - interval '30 days', username = 'annruns' where id = :'ann';
insert into public.community_age_ok (user_id) values (:'ann'), (:'bob'), (:'cat');

select tests.sign_in(:'ann');
set local role authenticated;
select (public.create_club('Eastside Runners', 'running', 'Austin, TX', 'Tuesday runs', 'orange', true))->>'id' as east \gset
select (public.create_club('Night Owls', 'running', null, null, 'purple', false)) as owls_json \gset
select throws_ok($$select public.create_club('Run www.spam.com', 'running', null, null, 'orange', true)$$, 'No links or email addresses, please.', 'Club names are checked like community words');
select is((public.my_clubs()->0->>'role'), 'owner', 'Ann owns the club she started');
reset role;
select is((select char_length(code) from public.clubs where id = :'east'), 6, 'A club gets a 6-character code');
select (:'owls_json'::jsonb)->>'id' as owls \gset
select code as owls_code from public.clubs where id = :'owls' \gset

-- Bob has no username yet.
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok(format('select public.join_club(%L)', :'east'), 'Pick a username first (Settings → Profile): clubs show usernames.', 'Joining a club needs a username');
reset role;
update public.profiles set username = 'bobbikes' where id = :'bob';
update public.profiles set username = 'catwalks' where id = :'cat';

select tests.sign_in(:'bob');
set local role authenticated;
select is(jsonb_array_length(public.search_clubs('east', null)), 1, 'Find a club finds the public one');
select is(jsonb_array_length(public.search_clubs('night', null)), 0, 'but not a private one');
select is(jsonb_array_length(public.search_clubs('', 'cycling')), 0, 'Sport filters the search');
select lives_ok(format('select public.join_club(%L)', :'east'), 'Bob joins the public club');
select throws_ok(format('select public.join_club(%L)', :'owls'), 'That club is joined with its code.', 'A private club can''t be joined from search');
select throws_ok(format('select public.club_page(%L)', :'owls'), 'That club is joined with its code.', 'and its page is closed to non-members');
select is((public.preview_club_by_code(lower(:'owls_code')))->>'name', 'Night Owls', 'Its code finds it');
select is(public.join_club_by_code(:'owls_code'), :'owls'::uuid, 'and joins it');
reset role;
-- Bob joined an hour ago (posts after that are new to him).
update public.club_members set seen_at = now() - interval '1 hour' where user_id = :'bob';

-- Ann starts a steps challenge (tomorrow) and a soccer game.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000001c1', '5K a Day', 'steps', :'ann', 7, now() + interval '1 day', now() + interval '8 days'),
  ('00000000-0000-0000-0000-0000000001c2', 'Kickabout', 'soccer', :'ann', 7, now() + interval '1 day', now() + interval '8 days');
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000001c1', :'ann'), ('00000000-0000-0000-0000-0000000001c2', :'ann');

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok(format('select public.post_to_clubs(%L, array[%L]::uuid[])', '00000000-0000-0000-0000-0000000001c1', :'east'), 'Only the challenge''s creator can post it to clubs.', 'Only the creator posts a challenge');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.post_to_clubs('00000000-0000-0000-0000-0000000001c1', array[:'east', :'owls']::uuid[]), 2, 'Ann posts it to both her clubs');
select throws_ok(format('select public.post_to_clubs(%L, array[%L]::uuid[])', '00000000-0000-0000-0000-0000000001c2', :'east'), 'That kind of challenge can''t be posted to a club.', 'A fixed-team game can''t be posted');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is(public.clubs_badge(), 2, 'Bob''s Clubs tab shows 2 new');
select is(jsonb_array_length(public.club_page(:'east')->'challenges'), 1, 'The club page lists it');
select is(public.clubs_badge(), 1, 'Opening the club marks its post seen');
select lives_ok(format('select public.join_club_challenge(%L, %L)', :'east', '00000000-0000-0000-0000-0000000001c1'), 'Bob joins it through the club');
select is(public.clubs_badge(), 0, 'Joined: nothing new left');
select lives_ok(format('select public.set_club_muted(%L, true)', :'owls'), 'Bob mutes a club');
reset role;
select is((select count(*)::int from public.challenge_participants where challenge_id = '00000000-0000-0000-0000-0000000001c1' and user_id = :'bob'), 1, 'Bob is in the challenge');
select is((select count(*)::int from public.club_joins where user_id = :'bob'), 1, 'and it counts as a join through the club');

-- Cat isn't in the club.
select tests.sign_in(:'cat');
set local role authenticated;
select throws_ok(format('select public.join_club_challenge(%L, %L)', :'east', '00000000-0000-0000-0000-0000000001c1'), 'Join the club first.', 'Only members join through the club');
reset role;

-- The owner leaves: the club passes to Bob.
select tests.sign_in(:'ann');
set local role authenticated;
select public.leave_club(:'east');
reset role;
select is((select role from public.club_members where club_id = :'east' and user_id = :'bob'), 'owner', 'When the owner leaves, the club passes on');

-- Admin.
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.admin_clubs_overview()$$, 'not authorized', 'Only admins see the club numbers');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_clubs_overview()->>'clubs')::int, 2, 'Admin counts the clubs');
select public.admin_set_club_config('{"search_on": false}'::jsonb);
select is(jsonb_array_length(public.search_clubs('east', null)), 0, 'Search off: Find a club is empty');
select public.admin_remove_club(:'east', 'test');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is(jsonb_array_length(public.my_clubs()), 1, 'A removed club leaves everyone''s list');
reset role;

select * from finish();
