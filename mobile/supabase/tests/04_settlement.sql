-- Settling a finished challenge: who is paid what, and only once.
-- The C1/C3/H6 fixes from the deep review will add checks here.
select plan(6);

select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset

-- A Step Race that ended yesterday (created directly, as the app would
-- have a week ago).
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
values ('44444444-0000-0000-0000-000000000001', 'Race', 'steps', :'bob', 3, now() - interval '4 days', now() - interval '1 day');
insert into public.challenge_participants (challenge_id, user_id) values
  ('44444444-0000-0000-0000-000000000001', :'bob'),
  ('44444444-0000-0000-0000-000000000001', :'cat');
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('44444444-0000-0000-0000-000000000001', :'bob', current_date - 3, 12000),
  ('44444444-0000-0000-0000-000000000001', :'cat', current_date - 3, 8000);

select tests.sign_in(:'bob');
set local role authenticated;
select public.settle_challenge_score('44444444-0000-0000-0000-000000000001');
select public.settle_challenge_score('44444444-0000-0000-0000-000000000001');
reset role;

select is((select score_points from public.activity_events where user_id = :'bob' and challenge_id = '44444444-0000-0000-0000-000000000001'),
  50, 'Step Race: first place earns 50');
select is((select score_points from public.activity_events where user_id = :'cat' and challenge_id = '44444444-0000-0000-0000-000000000001'),
  25, 'Step Race: second place earns 25');
select is((select count(*)::int from public.activity_events where challenge_id = '44444444-0000-0000-0000-000000000001'),
  2, 'Settling twice pays once');
select is((select hound_score from public.profiles where id = :'bob'), 50, 'The winner''s Hound Score goes up');

-- C2 (deep review): Daily Streak used to fail with "date = text" and never settle.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, daily_goal_steps, start_day)
values ('44444444-0000-0000-0000-000000000002', 'Streak', 'streak', :'bob', 2, now() - interval '3 days', now() - interval '1 day', 5000, current_date - 3);
insert into public.challenge_participants (challenge_id, user_id, joined_at) values
  ('44444444-0000-0000-0000-000000000002', :'cat', now() - interval '4 days');
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('44444444-0000-0000-0000-000000000002', :'cat', current_date - 3, 6000),
  ('44444444-0000-0000-0000-000000000002', :'cat', current_date - 2, 7000);

select tests.sign_in(:'cat');
set local role authenticated;
select public.settle_challenge_score('44444444-0000-0000-0000-000000000002');
reset role;
select isnt((select score_settled_at from public.challenges where id = '44444444-0000-0000-0000-000000000002'),
  null, 'C2: a Daily Streak challenge settles');
select is((select score_points from public.activity_events where user_id = :'cat' and challenge_id = '44444444-0000-0000-0000-000000000002'),
  40, 'C2: someone who hit the goal every day is paid as a survivor');

select * from finish();
