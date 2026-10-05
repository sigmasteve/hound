-- 0095: who may settle, how many players it takes, and the 24-hour grace.
select plan(7);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Ben') as ben \gset
select tests.new_user('Cy') as cy \gset

-- A Step Race that ended 30 hours ago, Ann and Ben in it. Cy is not.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
values ('66666666-0000-0000-0000-000000000001', 'Late', 'steps', :'ann', 3, now() - interval '5 days', now() - interval '30 hours');
insert into public.challenge_participants (challenge_id, user_id) values
  ('66666666-0000-0000-0000-000000000001', :'ann'),
  ('66666666-0000-0000-0000-000000000001', :'ben');
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('66666666-0000-0000-0000-000000000001', :'ann', current_date - 3, 9000),
  ('66666666-0000-0000-0000-000000000001', :'ben', current_date - 3, 4000);

-- Someone outside the challenge cannot settle it.
select tests.sign_in(:'cy');
set local role authenticated;
select public.settle_challenge_score('66666666-0000-0000-0000-000000000001');
reset role;
select is((select score_settled_at from public.challenges where id = '66666666-0000-0000-0000-000000000001'),
  null, 'An outsider cannot settle a challenge');

-- A player can, once the grace period has passed.
select tests.sign_in(:'ben');
set local role authenticated;
select public.settle_challenge_score('66666666-0000-0000-0000-000000000001');
reset role;
select isnt((select score_settled_at from public.challenges where id = '66666666-0000-0000-0000-000000000001'),
  null, 'A player can settle after 24 hours');
select is((select score_points from public.activity_events where user_id = :'ann' and challenge_id = '66666666-0000-0000-0000-000000000001'),
  50, 'First place is paid');

-- Inside the grace period nothing settles.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
values ('66666666-0000-0000-0000-000000000002', 'Fresh', 'steps', :'ann', 3, now() - interval '4 days', now() - interval '2 hours');
insert into public.challenge_participants (challenge_id, user_id) values
  ('66666666-0000-0000-0000-000000000002', :'ann'),
  ('66666666-0000-0000-0000-000000000002', :'ben');
select tests.sign_in(:'ann');
set local role authenticated;
select public.settle_challenge_score('66666666-0000-0000-0000-000000000002');
reset role;
select is((select score_settled_at from public.challenges where id = '66666666-0000-0000-0000-000000000002'),
  null, 'Two hours after the end, it is still waiting');

-- One player only: closed without a payout.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
values ('66666666-0000-0000-0000-000000000003', 'Solo', 'steps', :'ann', 3, now() - interval '5 days', now() - interval '30 hours');
insert into public.challenge_participants (challenge_id, user_id) values ('66666666-0000-0000-0000-000000000003', :'ann');
select public.settle_due_challenges();
select isnt((select score_settled_at from public.challenges where id = '66666666-0000-0000-0000-000000000003'),
  null, 'The job closes a one-player challenge');
select is((select count(*)::int from public.activity_events where challenge_id = '66666666-0000-0000-0000-000000000003'),
  0, 'A one-player challenge pays nobody');

-- The core function is not callable by app users.
select is(has_function_privilege('authenticated', 'public.settle_challenge_score_core(uuid)', 'execute'),
  false, 'Signed-in users cannot call the core function');
