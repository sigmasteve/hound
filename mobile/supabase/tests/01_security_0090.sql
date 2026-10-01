-- Roshan Trivedi's security hardening (0090). Each check is one of the
-- holes his review found, so it can't quietly come back.
select plan(14);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset

insert into public.organizations (id, name, kind, invite_code, created_by)
values (gen_random_uuid(), 'Test School', 'school', 'TST' || left(gen_random_uuid()::text, 5), :'dan')
returning id as org \gset
update public.profiles set organization_id = :'org', org_role = 'admin' where id = :'dan';

-- C1: someone in no organization can't act as its admin.
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok(format('select public.org_set_currency_name(%L, %L)', :'org', 'Pwned'),
  'not authorized', 'C1: a non-member cannot rename an organization''s currency');
reset role;

select tests.sign_in(:'dan');
set local role authenticated;
select lives_ok(format('select public.org_set_currency_name(%L, %L)', :'org', 'Treats'),
  'C1: the organization''s own admin still can');
reset role;

-- H3 (first review): a friendship can't be created already accepted.
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok(format('insert into public.friendships (requester_id, recipient_id, status) values (%L, %L, %L)', :'bob', :'cat', 'accepted'),
  '42501', null, 'H3: a friend request cannot arrive already accepted');
select lives_ok(format('insert into public.friendships (requester_id, recipient_id, status) values (%L, %L, %L)', :'bob', :'cat', 'pending'),
  'H3: a normal pending request works');

-- C2 (first review): no challenges that are already over.
select throws_ok(format($q$insert into public.challenges (name, kind, created_by, duration_days, starts_at, ends_at)
    values ('Instant payout', 'steps', %L, 1, now() - interval '3 days', now() - interval '2 days')$q$, :'bob'),
  '42501', null, 'C2: a challenge that already ended is refused');
select lives_ok(format($q$insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
    values ('11111111-0000-0000-0000-000000000001', 'Week race', 'steps', %L, 7, now(), now() + interval '7 days')$q$, :'bob'),
  'C2: a normal 7-day challenge is accepted');
reset role;

insert into public.challenge_participants (challenge_id, user_id, role)
values ('11111111-0000-0000-0000-000000000001', :'bob', 'hunted');

-- H9 (first review): roles only move hunted -> zombie.
select tests.sign_in(:'bob');
set local role authenticated;
select lives_ok($q$update public.challenge_participants set role = 'zombie'
    where challenge_id = '11111111-0000-0000-0000-000000000001' and user_id = auth.uid()$q$,
  'H9: hunted -> zombie (getting caught) is allowed');
select throws_ok($q$update public.challenge_participants set role = 'hunted'
    where challenge_id = '11111111-0000-0000-0000-000000000001' and user_id = auth.uid()$q$,
  'That role change is not allowed.', 'H9: a zombie cannot make itself hunted again');

-- H2 (first review): progress has to be human-sized and yours.
select lives_ok($q$insert into public.progress_snapshots (challenge_id, user_id, day, steps)
    values ('11111111-0000-0000-0000-000000000001', auth.uid(), current_date, 9000)$q$,
  'H2: a normal day of steps saves');
select throws_ok($q$update public.progress_snapshots set steps = 2000000000
    where challenge_id = '11111111-0000-0000-0000-000000000001' and user_id = auth.uid() and day = current_date$q$,
  '23514', null, 'H2: two billion steps are refused');
select throws_ok($q$insert into public.progress_snapshots (challenge_id, user_id, day, steps)
    values ('11111111-0000-0000-0000-000000000001', auth.uid(), current_date + 30, 5000)$q$,
  'That day is outside the challenge.', 'H2: a day far outside the challenge is refused');
reset role;

select tests.sign_in(:'cat');
set local role authenticated;
select throws_ok(format($q$insert into public.progress_snapshots (challenge_id, user_id, day, steps)
    values ('11111111-0000-0000-0000-000000000001', %L, current_date, 5000)$q$, :'cat'),
  'You are not in that challenge.', 'H2: someone not in the challenge cannot post progress');
reset role;

-- M1 (first review): signed-out visitors can run only what the site needs.
select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and has_function_privilege('anon', p.oid, 'EXECUTE')),
  array['beta_download_links', 'friend_code_owner_name'],
  'M1: signed-out visitors can run only the two functions the website uses');

-- The daily reward cap: a sixth paid result in 24 hours pays nothing.
insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
select :'ann', '11111111-0000-0000-0000-000000000001', 'steps_result', 50, 25, 5 from generate_series(1, 6);
select is(
  (select count(*)::int from public.activity_events where user_id = :'ann' and bones_points > 0),
  5, 'Reward cap: only 5 paid results count in a rolling 24 hours');

select * from finish();
