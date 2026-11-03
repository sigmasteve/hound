-- 0152: community challenges. Publishing is earned and checked, codes
-- work only once approved, joining asks for 13+ and a username, wrong
-- codes are limited, reports pause one, removal ends it with a strike,
-- featuring lists it, and there are no pots, bots or typed messages.
select plan(27);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cy') as cy \gset
select tests.new_user('Dee') as dee \gset
select tests.new_user('Eve', true) as eve \gset
select tests.new_user('Fay') as fay \gset
update public.profiles set xp_total = 350, created_at = now() - interval '30 days', username = 'ann_walks' where id = :'ann';
update public.profiles set username = 'bobby' where id = :'bob';
update public.profiles set username = 'dee_d' where id = :'dee';
update public.profiles set username = 'fay_f' where id = :'fay';
insert into public.organizations (id, name, kind, invite_code) values
  ('77777777-0000-0000-0000-000000000001', 'Oak School', 'school', 'OAKSCHOOL1');
update public.profiles set organization_id = '77777777-0000-0000-0000-000000000001', org_role = 'member' where id = :'dee';

-- Publishing.
select tests.sign_in(:'fay');
set local role authenticated;
select ok((public.my_community_status() ->> 'publish_problem') like 'Reach level 5%', 'A new member can''t publish yet');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$select * from public.publish_community_challenge('Sprint', null, 'steps', 14, now(), now() + interval '3 days')$q$),
  'Confirm you''re 13 or older first.', 'Publishing asks for 13+ first');
select public.confirm_community_age();
select throws_ok(format($q$select * from public.publish_community_challenge('Fucking fast', null, 'steps', 14, now(), now() + interval '3 days')$q$),
  'Keep it clean: one of those words isn''t allowed.', 'Swear words are refused, not masked');
select throws_ok(format($q$select * from public.publish_community_challenge('Sprint', 'Join at bit.ly/xyz', 'steps', 14, now(), now() + interval '3 days')$q$),
  'No links or email addresses, please.', 'Links are refused');
select throws_ok(format($q$select * from public.publish_community_challenge('Sprint', null, 'soccer', 7, now(), now() + interval '3 days')$q$),
  'That kind of challenge can''t be a community challenge.', 'Only the crowd-safe kinds');
select throws_ok(format($q$select * from public.publish_community_challenge('Sprint', null, 'steps', 2, now(), now() + interval '1 day')$q$),
  'A community challenge runs 3 to 30 days.', 'Three to 30 days');
select id as cid, join_code as code, review_state as state
  from public.publish_community_challenge('November Step Sprint', 'Most steps in two weeks wins.', 'steps', 14, now(), now() + interval '3 days') \gset
select ok(:'code' ~ '^[A-HJ-NP-Z2-9]{7}$', 'It gets a 7-character code without look-alike letters');
select is(:'state'::text, 'pending', 'and waits for review while pre-review is on');
select is((select count(*)::int from public.challenge_participants where challenge_id = :'cid' and user_id = :'ann'), 1,
  'The creator is in it');
reset role;
select lower(substr(:'code', 1, 3)) || '-' || lower(substr(:'code', 4)) as typed \gset

-- Joining.
select tests.sign_in(:'bob');
set local role authenticated;
select is((select problem from public.preview_by_code(:'code')), 'This challenge is waiting for review. Try again soon.',
  'A code waiting for review previews but can''t be joined');
reset role;

select tests.sign_in(:'eve');
set local role authenticated;
select public.admin_review_community(:'cid', 'approve');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is((select problem from public.preview_by_code(:'typed')), 'age', 'Approved, it asks for 13+ (any case, with a dash)');
select throws_ok(format('select public.join_by_code(%L)', :'code'), 'Confirm you''re 13 or older first.', 'and joining needs it');
select public.confirm_community_age();
select is(public.join_by_code(:'code'), :'cid'::uuid, 'Then it joins');
select is((select participant_count from public.preview_by_code(:'code')), 2, 'and counts them');
select throws_ok(format($q$select public.post_trash_talk(%L, 'hello')$q$, :'cid'), 'Global and community challenges are taunts only.',
  'Its wall is taunts only');
reset role;

select tests.sign_in(:'cy');
set local role authenticated;
select public.confirm_community_age();
select throws_ok(format('select public.join_by_code(%L)', :'code'),
  'Pick a username first (Settings → Profile): community leaderboards show usernames.', 'Joining needs a username');
select is((select count(*)::int from public.preview_by_code('ZZZZZZZ')), 0, 'A wrong code finds nothing');
do $$ begin
  for i in 1..9 loop
    perform * from public.preview_by_code('ZZZZZZZ');
  end loop;
end $$;
select throws_ok($q$select * from public.preview_by_code('ZZZZZZZ')$q$, 'Too many wrong codes. Try again in an hour.',
  'Wrong codes are limited per hour');
reset role;

select tests.sign_in(:'dee');
set local role authenticated;
select public.confirm_community_age();
select throws_ok(format('select public.join_by_code(%L)', :'code'), 'Community challenges aren''t available through your school.',
  'A school''s members can''t use codes unless the school opts in');
reset role;

-- Listing and featuring.
select tests.sign_in(:'bob');
set local role authenticated;
select ok(not exists (select 1 from public.list_global_challenges() where id = :'cid'), 'It isn''t listed anywhere');
reset role;
select tests.sign_in(:'eve');
set local role authenticated;
select public.admin_review_community(:'cid', 'feature');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select ok(exists (select 1 from public.list_global_challenges() where id = :'cid'), 'until an admin features it');
reset role;
select is((select name from public.community_code_public(:'code')), 'November Step Sprint', 'The website can show what a code is');

-- No pots, no bots.
select throws_ok(format('update public.challenges set pot_bones = 10 where id = %L', :'cid'), 'Community challenges don''t have pots.',
  'No pots');
select throws_ok(format($q$insert into public.challenge_bots (challenge_id, name, fitness_level) values (%L, 'Bolt', 'casual')$q$, :'cid'),
  'Community challenges are people only.', 'No bots');

-- Reports and removal.
select tests.sign_in(:'bob');
set local role authenticated;
select public.report_community_challenge(:'cid', 'spam');
reset role;
select tests.sign_in(:'cy');
set local role authenticated;
select public.report_community_challenge(:'cid', 'offensive');
reset role;
select tests.sign_in(:'dee');
set local role authenticated;
select public.report_community_challenge(:'cid', 'misleading');
reset role;
select is((select review_state || ',' || featured::text from public.challenges where id = :'cid'), 'hidden,false',
  'Three reports pause it and take it off the featured list');

select tests.sign_in(:'eve');
set local role authenticated;
select public.admin_review_community(:'cid', 'remove');
reset role;
select ok((select review_state = 'removed' and score_settled_at is not null and ends_at <= now() from public.challenges where id = :'cid'),
  'Removing it ends it with no results');
select tests.sign_in(:'ann');
set local role authenticated;
select ok((public.my_community_status() ->> 'publish_problem') like 'You can publish again on%', 'and the creator waits 30 days');
reset role;

select * from finish();
