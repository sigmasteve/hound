-- 0222: new users join the open Global challenges. Up to 3, live ones
-- ending soonest first then upcoming, not 75 Day or Accountability, not a
-- Derby that isn't set up, late past the join window for a new account,
-- once only, never for an old account; Leave, Undo, Got it; Admin.
select plan(18);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Ann') as ann \gset
select tests.new_user('Old') as old \gset
update public.profiles set created_at = now() - interval '10 days' where id = :'old';

select tests.sign_in(:'ada');
set local role authenticated;
-- A: a week-long race, live. B: Accountability. C: a streak ending tomorrow.
-- D: a race whose window has closed. E: a Derby, not set up. F: upcoming.
select public.publish_global_challenge('Race A', 'steps', 7, now() - interval '1 hour', now() + interval '3 days') as a \gset
select public.publish_global_challenge('List B', 'checklist', 7, now() - interval '1 hour', now() + interval '3 days') as b \gset
select public.publish_global_challenge('Streak C', 'streak', 3, now() - interval '1 hour', now() + interval '1 day', 5000) as c \gset
select public.publish_global_challenge('Race D', 'steps', 10, now() - interval '1 hour', now() + interval '1 day') as d \gset
select public.publish_global_challenge('Derby E', 'derby', 7, now() - interval '1 hour', now() + interval '3 days') as e \gset
select public.publish_global_challenge('Race F', 'steps', 7, now() + interval '1 day', now() + interval '4 days') as f \gset
reset role;
update public.challenges set ends_at = now() + interval '20 hours' where id = :'c';
update public.challenges set starts_at = now() - interval '5 days', ends_at = now() + interval '5 days', join_closes_at = now() - interval '2 days'
  where id = :'d';

select tests.sign_in(:'ann');
set local role authenticated;
select is(jsonb_array_length(public.auto_join_open_globals() -> 'challenges'), 3, 'A new account joins three');
select is(public.auto_join_card() ->> 'show', 'true', 'and sees the card');
select is((select string_agg(x ->> 'name', ',' order by ord) from jsonb_array_elements(public.auto_join_card() -> 'challenges') with ordinality t(x, ord)),
  'Race D,Race A,Race F', 'Live ones ending soonest first, then the upcoming one');
reset role;
select ok((select late from public.global_auto_joins where user_id = :'ann' and challenge_id = :'d'), 'Race D was past its window: in late');
select ok(not exists (select 1 from public.challenge_participants where user_id = :'ann' and challenge_id in (:'b', :'c', :'e')),
  'Not Accountability, not past the cap, not a Derby that isn''t set up');

select tests.sign_in(:'ann');
set local role authenticated;
select is(jsonb_array_length(public.auto_join_open_globals() -> 'challenges'), 3, 'Once only');
reset role;
select is((select count(*)::int from public.challenge_participants where user_id = :'ann'), 3, '... nothing more joined');

select tests.sign_in(:'old');
set local role authenticated;
select is(public.auto_join_open_globals() ->> 'show', 'false', 'An account older than a week isn''t swept in');
reset role;
select is((select count(*)::int from public.challenge_participants where user_id = :'old'), 0, '... and is in nothing');

-- Leave, Undo, Got it.
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values (:'d', :'ann', current_date, 4000);
select tests.sign_in(:'ann');
set local role authenticated;
select is((select x ->> 'joined' from jsonb_array_elements(public.auto_join_leave(:'d') -> 'challenges') x where x ->> 'name' = 'Race D'), 'false',
  'Leave takes you out');
select throws_ok(format($q$select public.auto_join_leave(%L)$q$, :'c'), 'You can only leave a challenge you were put in.', 'Only the ones you were put in');
reset role;
select ok(not exists (select 1 from public.challenge_participants where user_id = :'ann' and challenge_id = :'d'), 'Out of Race D');
select ok(not exists (select 1 from public.progress_snapshots where user_id = :'ann' and challenge_id = :'d'), 'and its board');
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok(format($q$select public.auto_join_rejoin(%L)$q$, :'d'), 'Undo puts you back, past the window');
select public.auto_join_dismiss();
select is(public.auto_join_card() ->> 'show', 'false', 'Got it puts the card away');
reset role;
select ok(exists (select 1 from public.challenge_participants where user_id = :'ann' and challenge_id = :'d'), 'Back in Race D');

-- Admin.
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.admin_auto_join_overview()$q$, 'Only an admin can do that.', 'Admins only');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select ok((public.admin_auto_join_overview() ->> 'late_7d')::int >= 1, 'Admin sees the late joins');
reset role;

select * from finish();
