-- 0107: pots take earned Bones only, the top pot player wins, a pot with
-- no winner refunds, and global prizes pay the top 3.
select plan(11);

select tests.new_user('Steve', true) as steve \gset
select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
update public.profiles set bones_balance = 200, bones_earned_total = 200 where id in (:'steve', :'ann');
update public.profiles set bones_balance = 500, bones_earned_total = 0 where id = :'bob';

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
  values ('00000000-0000-0000-0000-0000000000c1', 'Race', 'steps', :'steve', 1, now() - interval '2 hours', now() + interval '1 day');
insert into public.challenge_participants (challenge_id, user_id)
  values ('00000000-0000-0000-0000-0000000000c1', :'steve'), ('00000000-0000-0000-0000-0000000000c1', :'ann'),
         ('00000000-0000-0000-0000-0000000000c1', :'bob');

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok('select public.set_challenge_pot(''00000000-0000-0000-0000-0000000000c1'', 50)',
  'Only the challenge''s creator can set its pot.', 'Only the creator sets the pot');
reset role;

select tests.sign_in(:'steve');
set local role authenticated;
select public.set_challenge_pot('00000000-0000-0000-0000-0000000000c1', 50);
select is(public.join_challenge_pot('00000000-0000-0000-0000-0000000000c1'), 50, 'The creator joins the pot');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select public.join_challenge_pot('00000000-0000-0000-0000-0000000000c1');
select is((select total from public.challenge_pot('00000000-0000-0000-0000-0000000000c1')), 100, 'Two in the pot');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok('select public.join_challenge_pot(''00000000-0000-0000-0000-0000000000c1'')',
  'Only Bones you''ve earned by playing can go in a pot. Bought Bones can''t.', 'Bought Bones can''t go in');
select throws_ok('insert into public.challenge_pot_entries (challenge_id, user_id, bones) values (''00000000-0000-0000-0000-0000000000c1'', auth.uid(), 1)',
  '42501', null, 'Nobody writes pot entries directly');
reset role;

-- Ann out-walks Steve; Bob (not in the pot) out-walks both. Logged on
-- the challenge's own day (start_day, New York time), which just after
-- midnight UTC is still yesterday.
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
  select c.id, v.user_id, c.start_day, v.steps
  from public.challenges c,
       (values (:'steve'::uuid, 9000), (:'ann'::uuid, 12000), (:'bob'::uuid, 20000)) as v(user_id, steps)
  where c.id = '00000000-0000-0000-0000-0000000000c1';
-- Over now, so it can settle.
update public.challenges set ends_at = now() - interval '1 hour' where id = '00000000-0000-0000-0000-0000000000c1';
select public.settle_challenge_score_core('00000000-0000-0000-0000-0000000000c1');
-- The pot pays when the settlement commits; the test stays in one
-- transaction, so run it the way the deferred trigger does.
select public.settle_challenge_pot('00000000-0000-0000-0000-0000000000c1');
select is((select paid_out from public.challenge_pot_entries where challenge_id = '00000000-0000-0000-0000-0000000000c1' and user_id = :'ann'),
  100, 'The pot player with the most steps takes the pot');
select is((select paid_out from public.challenge_pot_entries where challenge_id = '00000000-0000-0000-0000-0000000000c1' and user_id = :'steve'),
  0, 'and the others get nothing back');

-- A pot with one player is refunded.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
  values ('00000000-0000-0000-0000-0000000000c2', 'Solo', 'steps', :'steve', 1, now() - interval '2 hours', now() + interval '1 day');
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000c2', :'steve');
select tests.sign_in(:'steve');
set local role authenticated;
select public.set_challenge_pot('00000000-0000-0000-0000-0000000000c2', 10);
select public.join_challenge_pot('00000000-0000-0000-0000-0000000000c2');
reset role;
-- Over now, so it can settle.
update public.challenges set ends_at = now() - interval '1 hour' where id = '00000000-0000-0000-0000-0000000000c2';
select public.settle_challenge_score_core('00000000-0000-0000-0000-0000000000c2');
select public.settle_challenge_pot('00000000-0000-0000-0000-0000000000c2');
select is((select paid_out from public.challenge_pot_entries where challenge_id = '00000000-0000-0000-0000-0000000000c2'),
  10, 'A pot with no winner gives the entry back');

-- Global prizes: admin only, and the top steps get paid.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, is_global)
  values ('00000000-0000-0000-0000-0000000000c3', 'Global', 'steps', :'steve', 1, now() - interval '2 hours', now() + interval '1 day', true);
insert into public.challenge_participants (challenge_id, user_id)
  values ('00000000-0000-0000-0000-0000000000c3', :'ann'), ('00000000-0000-0000-0000-0000000000c3', :'bob');
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
  select c.id, v.user_id, c.start_day, v.steps
  from public.challenges c,
       (values (:'ann'::uuid, 30000), (:'bob'::uuid, 10000)) as v(user_id, steps)
  where c.id = '00000000-0000-0000-0000-0000000000c3';
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok('select public.set_global_prizes(''00000000-0000-0000-0000-0000000000c3'', 100, 50, 25)',
  'not authorized', 'Only an admin sets prizes');
reset role;
select tests.sign_in(:'steve');
set local role authenticated;
select public.set_global_prizes('00000000-0000-0000-0000-0000000000c3', 200, 75, 0);
reset role;
-- Over now, so it can settle.
update public.challenges set ends_at = now() - interval '1 hour' where id = '00000000-0000-0000-0000-0000000000c3';
select public.settle_challenge_score_core('00000000-0000-0000-0000-0000000000c3');
select public.pay_global_places('00000000-0000-0000-0000-0000000000c3');
select is((select sum(bones_points)::int from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000c3' and user_id = :'ann' and kind = 'global_place'),
  200, '1st place gets the 1st prize');
select is((select sum(bones_points)::int from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000c3' and user_id = :'bob' and kind = 'global_place'),
  75, '2nd place gets the 2nd prize');

select * from finish();
