-- 0262: Hound clubs (an admin marks a public club; no member cap,
-- featured, first in Find a club) and a fasting club's numbers.
select plan(17);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Boss', true) as boss \gset
select (now() at time zone 'utc')::date as today \gset
update public.profiles set username = lower(name) || left(id::text, 4) where id in (:'ann', :'bob', :'cat', :'boss');
insert into public.community_age_ok (user_id) values (:'ann'), (:'bob'), (:'cat'), (:'boss');
insert into public.clubs (id, code, name, sport, is_public, created_by) values
  ('00000000-0000-0000-0000-000000262c01', 'IF0262', 'Intermittent Fasting', 'fasting', true, :'boss'),
  ('00000000-0000-0000-0000-000000262c02', 'PV0262', 'Secret Fasters', 'fasting', false, :'boss');
insert into public.club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-000000262c01', :'boss', 'owner'), ('00000000-0000-0000-0000-000000262c02', :'boss', 'owner');

-- ── Making it a Hound club ──
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.admin_set_hound_club('00000000-0000-0000-0000-000000262c01', true)$$, 'Admins only.', 'Only admins');
reset role;
select tests.sign_in(:'boss');
set local role authenticated;
select throws_ok($$select public.admin_set_hound_club('00000000-0000-0000-0000-000000262c02', true)$$, 'Only a public club can be a Hound club.', 'Private clubs can''t be');
select public.admin_set_hound_club('00000000-0000-0000-0000-000000262c01', true);
reset role;

-- ── Everyone sees it; no member cap ──
update public.club_config set max_members = 1 where id;
select tests.sign_in(:'ann');
set local role authenticated;
select is(jsonb_array_length(public.hound_clubs()), 1, 'Ann sees the Hound club');
select is((public.hound_clubs() -> 0 ->> 'hound')::boolean, true, 'marked as a Hound club');
select is(public.search_clubs('', null) -> 0 ->> 'name', 'Intermittent Fasting', 'First in Find a club');
-- Before joining: only the counts.
select is((public.club_fasting('00000000-0000-0000-0000-000000262c01', :'today'::date) ->> 'member')::boolean, false, 'Not a member yet');
select is(jsonb_array_length(public.club_fasting('00000000-0000-0000-0000-000000262c01', :'today'::date) -> 'board'), 0, 'No board before joining');
select lives_ok($$select public.join_club('00000000-0000-0000-0000-000000262c01')$$, 'Joins past the member cap');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select public.join_club('00000000-0000-0000-0000-000000262c01');
reset role;
update public.club_config set max_members = 500 where id;

-- ── The numbers: everyone who has ever fasted and shares ──
select tests.sign_in(:'ann');
set local role authenticated;
select public.fasting_set_age(true);
select public.fasting_start(16);
reset role;
-- Bob fasted 40 days ago and not since: still on the board.
select tests.sign_in(:'bob');
set local role authenticated;
select public.fasting_set_age(true);
select public.fasting_start(16);
reset role;
update public.fasts set started_at = now() - interval '17 hours' where user_id = :'bob';
select tests.sign_in(:'bob');
set local role authenticated;
select public.fasting_end(:'today'::date);
reset role;
update public.fasts set created_at = now() - interval '40 days', started_at = now() - interval '40 days 17 hours',
  ended_at = now() - interval '40 days', local_day = :'today'::date - 40 where user_id = :'bob';

select tests.sign_in(:'ann');
set local role authenticated;
select public.club_fasting('00000000-0000-0000-0000-000000262c01', :'today'::date) as cf \gset
select is((:'cf'::jsonb ->> 'member')::boolean, true, 'Ann is a member');
select is((:'cf'::jsonb ->> 'now_count')::int, 1, 'One fasting now');
select is((:'cf'::jsonb ->> 'fasters')::int, 2, 'Two have fasted');
select is(jsonb_array_length(:'cf'::jsonb -> 'board'), 2, 'Bob''s old fast still puts him on the board');
select is((:'cf'::jsonb ->> 'my_rank')::int, 2, 'Ann is second: no days on plan yet, and Bob''s longest is longer');
reset role;
select tests.sign_in(:'cat');
set local role authenticated;
select is((public.club_fasting('00000000-0000-0000-0000-000000262c01', :'today'::date) ->> 'now_count')::int, 1, 'Outsiders see the count');
select throws_ok($$select public.club_fasting('00000000-0000-0000-0000-000000262c02', (now() at time zone 'utc')::date)$$, 'You''re not in that club.', 'Not a private club''s');
reset role;

-- ── Admin ──
select tests.sign_in(:'boss');
set local role authenticated;
select is((public.admin_hound_clubs_overview() -> 0 ->> 'members')::int, 3, 'Admin sees its members');
select is((public.admin_hound_clubs_overview() -> 0 ->> 'fasting_now')::int, 1, 'and who''s fasting now');
reset role;

select * from finish();
