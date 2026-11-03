-- 0151: milestone badges count only finishes that are hard to farm and
-- are awarded once; interests are saved cleaned and private.
select plan(10);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset

select is((select count(*)::int from public.achievements where id in ('finishes_25', 'finishes_50', 'finishes_100')), 3,
  'Three milestone badges');

-- 30 one-day challenges on her own: they count as finishes, but not
-- toward the milestones.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
select ('55555555-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'Solo ' || g, 'steps', :'ann', 1,
       now() - interval '2 days', now() - interval '1 day'
from generate_series(1, 30) g;
insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points)
select :'ann', ('55555555-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'steps_result', 50, 0
from generate_series(1, 30) g;

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.my_finish_progress(), 0, 'One-day challenges on your own don''t count toward the milestones');
select ok(not exists (select 1 from public.check_achievements() where achievement_id = 'finishes_25'),
  'so 30 of them don''t earn Seasoned');
select ok(exists (select 1 from public.user_achievements where user_id = :'ann' and achievement_id = 'ten_finishes'),
  'though they still count for Regular (10 finishes)');
reset role;

-- 25 challenges that ran three days.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
select ('66666666-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'Week ' || g, 'steps', :'ann', 3,
       now() - interval '4 days', now() - interval '1 day'
from generate_series(1, 25) g;
insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points)
select :'ann', ('66666666-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'steps_result', 15, 0
from generate_series(1, 25) g;
-- And a one-day challenge with someone else in it, which counts too.
insert into public.challenge_participants (challenge_id, user_id) values
  ('55555555-0000-0000-0000-000000000001', :'bob');

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.my_finish_progress(), 26, 'Three-day challenges, and ones with someone else, count');
select is((select bones from public.check_achievements() where achievement_id = 'finishes_25'), 75,
  'Seasoned is earned at 25, with its 75 Bones');
select ok(not exists (select 1 from public.check_achievements() where achievement_id = 'finishes_25'),
  'and only once');
select is(public.save_my_interests(array['gym', 'weight_loss', 'bogus', 'gym']), array['gym', 'weight_loss'],
  'Interests are saved without unknown or repeated ones');
select is((select interests from public.profile_interests where user_id = :'ann'), array['gym', 'weight_loss'],
  'and you can read your own');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is((select count(*)::int from public.profile_interests where user_id = :'ann'), 0,
  'Nobody else can read them');
reset role;

select * from finish();
