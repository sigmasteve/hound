-- 0168: Game of Tag counts each round from the reset. It can tag anyone,
-- a first sync sets a player's baseline, a catch is out-stepping the
-- target in the round, and a catch or the 15-minute reset starts the
-- next round from everyone's totals then.
select plan(19);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, distance_goal_unit, distance_goal_steps)
values ('00000000-0000-0000-0000-0000000000c1', 'Tag time', 'tag', :'ann', 7, now() - interval '1 hour', now() + interval '7 days', 'steps', 1000000);
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000000c1', :'ann'),
  ('00000000-0000-0000-0000-0000000000c1', :'bob'),
  ('00000000-0000-0000-0000-0000000000c1', :'cat');

select is((select baselines from public.tag_rounds where challenge_id = '00000000-0000-0000-0000-0000000000c1'), '{}'::jsonb,
  'A new game starts with no baselines');

-- The day's steps synced after the game starts don't count: each
-- player's first sync is where their round starts.
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-0000000000c1', :'ann', current_date, 5000),
  ('00000000-0000-0000-0000-0000000000c1', :'bob', current_date, 9000);
select is((select baselines from public.tag_rounds where challenge_id = '00000000-0000-0000-0000-0000000000c1'),
  jsonb_build_object(:'ann', 5000, :'bob', 9000), 'A first sync sets the baseline');
select is(public.tag_round_gain('00000000-0000-0000-0000-0000000000c1', :'bob'), 0::numeric, 'so Bob starts the round at 0');
select is(public.tag_round_gain('00000000-0000-0000-0000-0000000000c1', :'cat'), 0::numeric, 'and so does Cat, with nothing synced');

-- It picks anyone, even someone with fewer steps overall.
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.tag_select_target('00000000-0000-0000-0000-0000000000c1', '$$ || :'cat' || $$')$$,
  'You''re not currently "IT" in this game.', 'Only It picks');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.tag_select_target('00000000-0000-0000-0000-0000000000c1', '$$ || :'cat' || $$')$$,
  'It can pick someone who has logged nothing');
select is(public.tag_check_catch('00000000-0000-0000-0000-0000000000c1'), false, 'Both at 0: no instant catch');
select lives_ok($$select public.tag_select_target('00000000-0000-0000-0000-0000000000c1', '$$ || :'bob' || $$')$$,
  'and can switch to someone far ahead overall');
reset role;

-- Bob walks 500 in the round, Ann 400: not caught yet.
update public.progress_snapshots set steps = 9500
  where challenge_id = '00000000-0000-0000-0000-0000000000c1' and user_id = :'bob';
update public.progress_snapshots set steps = 5400
  where challenge_id = '00000000-0000-0000-0000-0000000000c1' and user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.tag_check_catch('00000000-0000-0000-0000-0000000000c1'), false, '400 in the round against 500: still chasing');
reset role;

update public.progress_snapshots set steps = 5600
  where challenge_id = '00000000-0000-0000-0000-0000000000c1' and user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.tag_check_catch('00000000-0000-0000-0000-0000000000c1'), true, '600 against 500: caught');
reset role;

select is((select it_user_id from public.tag_rounds where challenge_id = '00000000-0000-0000-0000-0000000000c1'), :'bob'::uuid,
  'Bob is It');
select is((select metric from public.tag_events where challenge_id = '00000000-0000-0000-0000-0000000000c1' and kind = 'catch'),
  500::numeric, 'The catch records Bob''s steps in the round');
select is((select baselines from public.tag_rounds where challenge_id = '00000000-0000-0000-0000-0000000000c1'),
  jsonb_build_object(:'ann', 5600, :'bob', 9500), 'and the next round starts from everyone''s totals at the catch');

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.tag_select_target('00000000-0000-0000-0000-0000000000c1', '$$ || :'ann' || $$')$$,
  'No tag-backs — pick someone else.', 'Still no tag-backs');
reset role;

-- Cat's first sync mid-round starts her there.
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-0000000000c1', :'cat', current_date, 7000);
select is(public.tag_round_gain('00000000-0000-0000-0000-0000000000c1', :'cat'), 0::numeric, 'A first sync mid-round starts at 0');

-- The 15-minute reset: someone else is It, counting from the reset.
update public.progress_snapshots set steps = 7300
  where challenge_id = '00000000-0000-0000-0000-0000000000c1' and user_id = :'cat';
update public.tag_rounds set round_started_at = now() - interval '16 minutes'
  where challenge_id = '00000000-0000-0000-0000-0000000000c1';
select public.tag_settle_timeout('00000000-0000-0000-0000-0000000000c1');
select isnt((select it_user_id from public.tag_rounds where challenge_id = '00000000-0000-0000-0000-0000000000c1'), :'bob'::uuid,
  'At the reset, It passes on');
select is((select baselines ->> :'cat' from public.tag_rounds where challenge_id = '00000000-0000-0000-0000-0000000000c1'), '7300',
  'and the new round starts from the steps at the reset');
select is(public.tag_round_gain('00000000-0000-0000-0000-0000000000c1', :'cat'), 0::numeric, 'so everyone is back to 0');

select tests.sign_in(:'dan');
set local role authenticated;
select throws_ok($$select public.tag_round_gain('00000000-0000-0000-0000-0000000000c1', '$$ || :'ann' || $$')$$,
  '42501', null, 'The round helpers are internal');
reset role;

select * from finish();
