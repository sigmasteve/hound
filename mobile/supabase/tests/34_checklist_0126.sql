-- 0125/0126: an Accountability challenge has a shared checklist (capped
-- by Admin), one personal line each, locks the list once ticking starts,
-- keeps ticks to the challenge's own days, scores by complete days,
-- pays alone, and can be global.
select plan(29);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Zed', true) as zed \gset

-- Ann and Bob's 3-day list, ended 30 hours ago.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
values ('99999999-0000-0000-0000-000000000001', 'Daily six', 'checklist', :'ann', 3, now() - interval '4 days 6 hours', now() - interval '30 hours');
insert into public.challenge_participants (challenge_id, user_id) values
  ('99999999-0000-0000-0000-000000000001', :'ann'), ('99999999-0000-0000-0000-000000000001', :'bob');
select start_day as day1 from public.challenges where id = '99999999-0000-0000-0000-000000000001' \gset

-- A checklist only belongs on a checklist challenge.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
values ('99999999-0000-0000-0000-000000000002', 'Not a list', 'steps', :'ann', 3, now() - interval '1 day', now() + interval '2 days');
select throws_ok(format($q$insert into public.checklist_items (challenge_id, label) values ('99999999-0000-0000-0000-000000000002', 'Stretch')$q$),
  'P0001', 'Only an Accountability challenge has a checklist.', 'No list on a Step Race');

-- ── Only the creator writes the shared list ──────────────────────────
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($q$insert into public.checklist_items (challenge_id, label) values ('99999999-0000-0000-0000-000000000001', 'Bob''s item')$q$,
  '42501', null, 'Bob can''t add to the shared list');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;

select throws_ok($q$insert into public.checklist_items (challenge_id, label, kind) values ('99999999-0000-0000-0000-000000000001', 'Steps', 'steps')$q$,
  '23514', null, 'A steps item needs its count');
select throws_ok($q$insert into public.checklist_items (challenge_id, label, kind, steps_target) values ('99999999-0000-0000-0000-000000000001', 'Steps', 'steps', 500)$q$,
  '23514', null, 'and the count is between 1,000 and 30,000');

insert into public.checklist_items (id, challenge_id, position, label, kind, steps_target) values
  ('99999999-0000-0000-0000-00000000a001', '99999999-0000-0000-0000-000000000001', 1, 'Steps', 'steps', 5000),
  ('99999999-0000-0000-0000-00000000a002', '99999999-0000-0000-0000-000000000001', 2, 'Workout', 'workout', null),
  ('99999999-0000-0000-0000-00000000a003', '99999999-0000-0000-0000-000000000001', 3, 'Mindfulness', 'mindfulness', null),
  ('99999999-0000-0000-0000-00000000a004', '99999999-0000-0000-0000-000000000001', 4, 'Read 10 pages', 'manual', null),
  ('99999999-0000-0000-0000-00000000a005', '99999999-0000-0000-0000-000000000001', 5, 'Drink water', 'manual', null),
  ('99999999-0000-0000-0000-00000000a006', '99999999-0000-0000-0000-000000000001', 6, 'No sugar', 'manual', null);
select is((select count(*)::int from public.checklist_items where challenge_id = '99999999-0000-0000-0000-000000000001'), 6, 'Ann writes six items');
select throws_ok($q$insert into public.checklist_items (challenge_id, position, label) values ('99999999-0000-0000-0000-000000000001', 7, 'One more')$q$,
  'P0001', 'A list can hold 6 items.', 'but not a seventh');
reset role;

-- ── Bob has his own line ─────────────────────────────────────────────
select tests.sign_in(:'bob');
set local role authenticated;
insert into public.checklist_items (id, challenge_id, owner_id, label, from_day)
values ('99999999-0000-0000-0000-00000000b001', '99999999-0000-0000-0000-000000000001', :'bob', 'Call Mum', :'day1');
select throws_ok(format($q$insert into public.checklist_items (challenge_id, owner_id, label) values ('99999999-0000-0000-0000-000000000001', %L, 'Another')$q$, :'bob'),
  '23505', null, 'One personal line each');
select throws_ok(format($q$insert into public.checklist_items (challenge_id, owner_id, label) values ('99999999-0000-0000-0000-000000000001', %L, 'Walk')$q$, :'ann'),
  '42501', null, 'and only your own');

-- Bob's first day: everything, his own line too.
insert into public.checklist_checkins (challenge_id, user_id, day, item_id, source)
select '99999999-0000-0000-0000-000000000001', :'bob', :'day1', id, 'tap'
from public.checklist_items where challenge_id = '99999999-0000-0000-0000-000000000001';
select is((select count(*)::int from public.checklist_checkins where user_id = :'bob' and day = :'day1'), 7, 'Bob ticks all seven on day one');

-- Day two: five of six, and the sixth unticked again.
insert into public.checklist_checkins (challenge_id, user_id, day, item_id)
select '99999999-0000-0000-0000-000000000001', :'bob', :'day1'::date + 1, id
from public.checklist_items where challenge_id = '99999999-0000-0000-0000-000000000001' and owner_id is null;
update public.checklist_checkins set done = false
  where user_id = :'bob' and day = :'day1'::date + 1 and item_id = '99999999-0000-0000-0000-00000000a006';
select is((select count(*)::int from public.checklist_checkins where user_id = :'bob' and day = :'day1'::date + 1 and done), 5, 'Five of six on day two');

-- Days outside the challenge: skipped quietly inside the window, refused
-- from the future.
insert into public.checklist_checkins (challenge_id, user_id, day, item_id)
values ('99999999-0000-0000-0000-000000000001', :'bob', :'day1'::date - 1, '99999999-0000-0000-0000-00000000a004');
select is((select count(*)::int from public.checklist_checkins where user_id = :'bob' and day = :'day1'::date - 1), 0, 'The day before the start is skipped');
select throws_ok(format($q$insert into public.checklist_checkins (challenge_id, user_id, day, item_id)
  values ('99999999-0000-0000-0000-000000000001', %L, current_date + 2, '99999999-0000-0000-0000-00000000a004')$q$, :'bob'),
  'P0001', 'That day is outside the challenge.', 'A day from the future is refused');
reset role;

-- ── Ann can't tick Bob's line, nor change the list now ───────────────
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$insert into public.checklist_checkins (challenge_id, user_id, day, item_id)
  values ('99999999-0000-0000-0000-000000000001', %L, %L, '99999999-0000-0000-0000-00000000b001')$q$, :'ann', :'day1'),
  'P0001', 'That item isn''t on your list.', 'Ann can''t tick Bob''s line');
select throws_ok($q$insert into public.checklist_items (challenge_id, label) values ('99999999-0000-0000-0000-000000000001', 'Late add')$q$,
  'P0001', 'The list is set — people have started ticking it.', 'The list is locked once ticking starts');
select throws_ok($q$delete from public.checklist_items where id = '99999999-0000-0000-0000-00000000a006'$q$,
  'P0001', 'The list is set — people have started ticking it.', 'and nothing comes off it');
select throws_ok($q$update public.checklist_items set label = 'No sweets' where id = '99999999-0000-0000-0000-00000000a006'$q$,
  'P0001', 'The list is set — people have started ticking it.', 'nor changes');

-- Ann: all six on days one and two.
insert into public.checklist_checkins (challenge_id, user_id, day, item_id)
select '99999999-0000-0000-0000-000000000001', :'ann', d, id
from public.checklist_items, (values (:'day1'::date), (:'day1'::date + 1)) as days (d)
where challenge_id = '99999999-0000-0000-0000-000000000001' and owner_id is null;
select is((select count(*)::int from public.checklist_checkins where user_id = :'ann'), 12, 'Ann ticks all six on two days');
select is((select count(*)::int from public.checklist_checkins where user_id = :'bob'), 13, 'and sees Bob''s ticks');
reset role;

-- ── Scoring: complete days ───────────────────────────────────────────
select public.settle_challenge_score('99999999-0000-0000-0000-000000000001');
select isnt((select score_settled_at from public.challenges where id = '99999999-0000-0000-0000-000000000001'), null, 'The challenge settles');
select is((select score_points from public.activity_events where challenge_id = '99999999-0000-0000-0000-000000000001' and user_id = :'ann'),
  6, 'Ann: two complete days, 6 points');
select is((select xp_points from public.activity_events where challenge_id = '99999999-0000-0000-0000-000000000001' and user_id = :'ann'),
  27, 'and 25 + 2 XP');
select is((select score_points from public.activity_events where challenge_id = '99999999-0000-0000-0000-000000000001' and user_id = :'bob'),
  3, 'Bob: one complete day (his own line counts from day one)');
select is((select kind from public.activity_events where challenge_id = '99999999-0000-0000-0000-000000000001' and user_id = :'bob'),
  'checklist_result', 'as a checklist result');

-- ── Alone, it still pays ─────────────────────────────────────────────
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
values ('99999999-0000-0000-0000-000000000003', 'Solo list', 'checklist', :'bob', 3, now() - interval '5 days', now() - interval '30 hours');
insert into public.challenge_participants (challenge_id, user_id) values ('99999999-0000-0000-0000-000000000003', :'bob');
select tests.sign_in(:'bob');
set local role authenticated;
select public.settle_challenge_score('99999999-0000-0000-0000-000000000003');
reset role;
select is((select count(*)::int from public.activity_events where challenge_id = '99999999-0000-0000-0000-000000000003'), 1, 'A solo list pays its player');

-- ── Admin sets the cap ───────────────────────────────────────────────
select tests.sign_in(:'bob');
set local role authenticated;
update public.checklist_settings set max_items = 2;
reset role;
select is((select max_items from public.checklist_settings), 6, 'Bob can''t change the cap');

select tests.sign_in(:'zed');
set local role authenticated;
update public.checklist_settings set max_items = 2;
select is((select max_items from public.checklist_settings), 2, 'Zed can');

-- and publishes a global one with a short list.
select public.publish_global_challenge('Daily two', 'checklist', 30, now(), now() + interval '7 days') as global_id \gset
select is((select kind::text from public.challenges where id = :'global_id'), 'checklist', 'An Accountability challenge can be global');
insert into public.checklist_items (challenge_id, position, label, kind, steps_target) values
  (:'global_id', 1, 'Steps', 'steps', 3000),
  (:'global_id', 2, 'Move', 'workout', null);
select throws_ok(format($q$insert into public.checklist_items (challenge_id, position, label) values (%L, 3, 'Third')$q$, :'global_id'),
  'P0001', 'A list can hold 2 items.', 'The cap applies to a new list');
reset role;

-- Anyone signed in can read a global list before joining.
select tests.sign_in(:'ann');
set local role authenticated;
select is((select count(*)::int from public.checklist_items where challenge_id = :'global_id'), 2, 'Ann sees the global list before joining');
reset role;

select * from finish();
