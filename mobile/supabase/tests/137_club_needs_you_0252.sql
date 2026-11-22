-- 0252: club games on Today's Needs you: what shows, Not now, joining
-- from there (logged for Admin), and what's left out.
select plan(14);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Ada', true) as ada \gset

update public.profiles set username = 'annie' where id = :'ann';
insert into public.clubs (id, code, name, sport, is_public, created_by) values
  ('00000000-0000-0000-0000-0000000252c1', 'NY0252', 'Eastside Runners', 'running', true, :'ann'),
  ('00000000-0000-0000-0000-0000000252c2', 'NY0253', 'Night Owls', 'walking', true, :'ann');
insert into public.club_members (club_id, user_id, role, muted) values
  ('00000000-0000-0000-0000-0000000252c1', :'ann', 'owner', false),
  ('00000000-0000-0000-0000-0000000252c2', :'ann', 'owner', false),
  ('00000000-0000-0000-0000-0000000252c1', :'bob', 'member', false),
  ('00000000-0000-0000-0000-0000000252c2', :'bob', 'member', true);

-- Ann's: a Bullseye starting tomorrow (posted to both clubs), a Steps
-- challenge in the muted club only, a Distance one she also invited Bob
-- to, and one whose joining has closed.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000025201', 'Archers', 'bullseye', :'ann', 7, now() + interval '1 day', now() + interval '8 days'),
  ('00000000-0000-0000-0000-000000025202', 'Owl Steps', 'steps', :'ann', 7, now() + interval '1 day', now() + interval '8 days'),
  ('00000000-0000-0000-0000-000000025203', 'Long Road', 'distance', :'ann', 7, now() + interval '1 day', now() + interval '8 days'),
  ('00000000-0000-0000-0000-000000025204', 'Old Steps', 'steps', :'ann', 7, now() - interval '3 days', now() + interval '4 days');
update public.challenges set created_at = now() - interval '4 days' where id = '00000000-0000-0000-0000-000000025204';
insert into public.challenge_participants (challenge_id, user_id)
  select id, :'ann' from public.challenges where id::text like '00000000-0000-0000-0000-0000000252%';
insert into public.club_posts (club_id, challenge_id, posted_by) values
  ('00000000-0000-0000-0000-0000000252c1', '00000000-0000-0000-0000-000000025201', :'ann'),
  ('00000000-0000-0000-0000-0000000252c2', '00000000-0000-0000-0000-000000025201', :'ann'),
  ('00000000-0000-0000-0000-0000000252c2', '00000000-0000-0000-0000-000000025202', :'ann'),
  ('00000000-0000-0000-0000-0000000252c1', '00000000-0000-0000-0000-000000025203', :'ann'),
  ('00000000-0000-0000-0000-0000000252c1', '00000000-0000-0000-0000-000000025204', :'ann');
insert into public.challenge_invites (challenge_id, inviter_id, invitee_id) values
  ('00000000-0000-0000-0000-000000025203', :'ann', :'bob');

select tests.sign_in(:'bob');
set local role authenticated;
select is(jsonb_array_length(public.club_waiting()), 1, 'Bob has one club game waiting (muted club, direct invite and closed one left out)');
select is(public.club_waiting()->0->>'challenge_name', 'Archers', 'It''s the Bullseye');
select is(public.club_waiting()->0->>'club_name', 'Eastside Runners', 'posted in his unmuted club');
select is(public.club_waiting()->0->>'posted_by', 'annie', 'with who posted it (their username)');
select ok((public.club_waiting()->0->>'closes_at')::timestamptz > now(), 'and when joining closes');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select is(jsonb_array_length(public.club_waiting()), 0, 'Ann''s own posts don''t wait on her');
reset role;

-- Not now.
select tests.sign_in(:'bob');
set local role authenticated;
select lives_ok($$select public.dismiss_club_waiting('00000000-0000-0000-0000-000000025201')$$, 'Bob says Not now');
select is(jsonb_array_length(public.club_waiting()), 0, 'and it leaves Needs you');
select is(jsonb_array_length(public.club_page('00000000-0000-0000-0000-0000000252c1')->'challenges') >= 1, true, 'but stays on the club''s page');
reset role;

-- Joining from Needs you.
delete from public.club_post_dismissals where user_id = :'bob';
select tests.sign_in(:'bob');
set local role authenticated;
select lives_ok($$select public.join_club_challenge('00000000-0000-0000-0000-0000000252c1', '00000000-0000-0000-0000-000000025201', 'needs_you')$$, 'Bob joins from Needs you');
select is(jsonb_array_length(public.club_waiting()), 0, 'and it''s no longer waiting');
reset role;
select is((select via from public.club_joins where user_id = :'bob' and challenge_id = '00000000-0000-0000-0000-000000025201'), 'needs_you', 'The join is logged as from Needs you');

-- Admin.
select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_club_needs_overview()->>'joined_needs_you_30d')::int, 1, 'Admin counts the join from Needs you');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.admin_club_needs_overview()$$, 'not authorized', 'Admin only');
reset role;

select * from finish();
