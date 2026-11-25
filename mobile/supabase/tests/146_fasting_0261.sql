-- 0261: Fasting. 16+, start and end, Bones by hours once a day, the
-- streak with rest days and a weekly free miss, cancel, friends (now,
-- cheer, share, compare), pack fasts and their bonus, the club board, and
-- Admin's numbers and Bones settings.
select plan(61);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Kid') as kid \gset
select tests.new_user('Boss', true) as boss \gset
select (now() at time zone 'utc')::date as today \gset
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bob', 'accepted');

-- ── 16+ ──
select tests.sign_in(:'kid');
set local role authenticated;
select throws_ok($$select public.fasting_start(16)$$, 'Fasting is for people 16 and older.', 'No answer yet: no fasting');
select public.fasting_set_age(false);
select public.fasting_set_age(true);
select is(public.my_fasting((now() at time zone 'utc')::date) ->> 'age', 'under', 'Once under 16, tapping again doesn''t change it');
select throws_ok($$select public.fasting_start(16)$$, 'Fasting is for people 16 and older.', 'Under 16: no fasting');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select public.fasting_set_age(true);
select is((public.my_fasting(:'today'::date) ->> 'started_any')::boolean, false, 'Before the first fast, started_any is false (no Today tile)');
select throws_ok($$select public.fasting_start(30)$$, 'A plan is 12 to 24 hours.', 'Plans are 12 to 24 hours');
select throws_ok($$select public.fasting_start(16, now() - interval '13 hours')$$, 'You can start a fast up to 12 hours back.', '"I stopped eating at" goes back 12 hours at most');
select ok(public.fasting_start(16) ? 'fast_id', 'Ann starts a 16:8 fast');
select throws_ok($$select public.fasting_start(16)$$, 'You''re already fasting.', 'One fast at a time');
select is((public.my_fasting(:'today'::date) -> 'open' ->> 'goal_hours')::int, 16, 'The open fast shows with its goal');
select is((public.my_fasting(:'today'::date) ->> 'started_any')::boolean, true, 'Once started, the Today tile shows');
reset role;

-- ── Friends see it, and cheer ──
select tests.sign_in(:'bob');
set local role authenticated;
select public.fasting_set_age(true);
select is(jsonb_array_length(public.fasting_friends(:'today'::date) -> 'now'), 1, 'Bob sees Ann fasting now');
select public.fasting_cheer((public.fasting_friends(:'today'::date) -> 'now' -> 0 -> 'fast' ->> 'id')::uuid);
select public.fasting_cheer((public.fasting_friends(:'today'::date) -> 'now' -> 0 -> 'fast' ->> 'id')::uuid);
select is((public.fasting_friends(:'today'::date) -> 'now' -> 0 ->> 'cheered')::boolean, true, 'Bob''s cheer shows as sent');
reset role;
select is((select count(*)::int from public.fast_cheers), 1, 'One cheer per friend per fast');
select id as ann_fast from public.fasts where user_id = :'ann' \gset
select tests.sign_in(:'cat');
set local role authenticated;
select public.fasting_set_age(true);
select is(jsonb_array_length(public.fasting_friends(:'today'::date) -> 'now'), 0, 'Cat (not a friend) doesn''t see Ann');
select throws_ok(format($$select public.fasting_cheer(%L)$$, :'ann_fast'),
  'You can cheer friends who are fasting.', 'Only friends can cheer');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select is(jsonb_array_length(public.my_fasting(:'today'::date) -> 'cheers'), 1, 'Ann sees who cheered her');
select public.fasting_settings(p_share => false);
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select is(jsonb_array_length(public.fasting_friends(:'today'::date) -> 'now'), 0, 'Sharing off: Bob doesn''t see Ann');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select public.fasting_settings(p_share => true);
reset role;

-- ── Ending: Bones by hours, once a day; the streak ──
update public.fasts set started_at = now() - interval '16 hours 30 minutes' where user_id = :'ann';
select bones_balance as ann_before from public.profiles where id = :'ann' \gset
select tests.sign_in(:'ann');
set local role authenticated;
select public.fasting_end(:'today'::date) as e1 \gset
select is((:'e1'::jsonb ->> 'on_plan')::boolean, true, '16.5 h on a 16 h plan is on plan');
select is((:'e1'::jsonb ->> 'bones')::int, 15, '16 h pays 15 Bones');
select is((:'e1'::jsonb ->> 'streak')::int, 1, 'The streak starts at 1');
reset role;
select is((select bones_balance from public.profiles where id = :'ann') - :ann_before, 15, 'The Bones are credited');
select is((select bones_earned_total from public.profiles where id = :'ann'), 0, 'Fasting Bones don''t count toward unlocks');

select tests.sign_in(:'ann');
set local role authenticated;
select public.fasting_start(20);
reset role;
update public.fasts set started_at = now() - interval '21 hours' where user_id = :'ann' and ended_at is null;
select tests.sign_in(:'ann');
set local role authenticated;
select public.fasting_end(:'today'::date) as e2 \gset
select is((:'e2'::jsonb ->> 'bones')::int, 0, 'A second fast the same day pays nothing');
select is((:'e2'::jsonb ->> 'streak')::int, 1, 'Or adds to the streak');
select is((:'e2'::jsonb ->> 'new_longest')::boolean, true, '21 h is a new longest');
reset role;

-- The streak: yesterday-ish days on plan, then today.
update public.fasting_profiles set streak = 2, best_streak = 2, last_on = :'today'::date - 1 where user_id = :'ann';
update public.fasts set local_day = :'today'::date - 3 where user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select public.fasting_start(16);
reset role;
update public.fasts set started_at = now() - interval '30 hours' where user_id = :'ann' and ended_at is null;
select tests.sign_in(:'ann');
set local role authenticated;
select public.fasting_end(:'today'::date) as e3 \gset
select is((:'e3'::jsonb ->> 'streak')::int, 3, 'A day on plan after yesterday''s makes 3');
select is((:'e3'::jsonb ->> 'milestone_bones')::int, 25, 'Day 3 pays the streak bonus');
select is((:'e3'::jsonb ->> 'bones')::int, 25, 'A 30 h fast pays the 20 h amount, no more');
reset role;

-- Rest days and the weekly free miss (Mon 16 Nov 2026 onward).
select is(public.fasting_streak_holds(:'cat', '2026-11-16', '2026-11-18', '{}', false), true, 'One missed day is the week''s free miss');
select is(public.fasting_streak_holds(:'cat', '2026-11-16', '2026-11-19', '{}', false), false, 'Two missed days in a week break it');
select is(public.fasting_streak_holds(:'cat', '2026-11-16', '2026-11-19', '{2}', false), true, 'A rest day (Tuesday) plus the free miss holds');
select is(public.fasting_streak_holds(:'cat', '2026-11-21', '2026-11-24', '{}', false), true, 'A miss each side of Monday: one free miss per week');
select public.fasting_streak_holds(:'cat', '2026-11-16', '2026-11-18', '{}', true);
select is(public.fasting_streak_holds(:'cat', '2026-11-18', '2026-11-20', '{}', false), false, 'The free miss, once used, is gone for that week');
select is(public.fasting_streak_holds(:'cat', '2026-11-16', '2026-11-18', '{}', false), true, 'The same day it covered still counts');

-- ── Cancel ──
select tests.sign_in(:'cat');
set local role authenticated;
select public.fasting_start(14);
select lives_ok($$select public.fasting_cancel()$$, 'A mis-tap can be cancelled');
select is((public.my_fasting(:'today'::date) -> 'open'), 'null'::jsonb, 'and it''s gone');
select public.fasting_start(14);
reset role;
update public.fasts set created_at = now() - interval '20 minutes' where user_id = :'cat' and ended_at is null;
select tests.sign_in(:'cat');
set local role authenticated;
select throws_ok($$select public.fasting_cancel()$$, 'Only in the first 15 minutes. End it instead.', 'After 15 minutes, end it instead');
reset role;
delete from public.fasts where user_id = :'cat';

-- ── Pack fast ──
select tests.sign_in(:'ann');
set local role authenticated;
select public.fasting_start(16, null, array[:'bob', :'cat']::uuid[]) ->> 'pack_id' as pack \gset
reset role;
select is((select count(*)::int from public.fast_pack_members where pack_id = :'pack'), 2, 'Only friends are invited (Cat isn''t one)');
select tests.sign_in(:'bob');
set local role authenticated;
select is(jsonb_array_length(public.fasting_waiting()), 1, 'Bob''s invite waits on him (Needs you)');
select public.fasting_pack_join(:'pack', 14);
select is(jsonb_array_length(public.fasting_waiting()), 0, 'Joined: nothing waiting');
select public.fasting_pack_note(:'pack', 'water');
select throws_ok(format($$select public.fasting_pack_note(%L, 'pizza')$$, :'pack'), 'Pick a note.', 'Only the quick notes');
select is(jsonb_array_length(public.fasting_pack(:'pack') -> 'members'), 2, 'The pack shows both');
reset role;
select tests.sign_in(:'cat');
set local role authenticated;
select throws_ok(format($$select public.fasting_pack(%L)$$, :'pack'), 'You''re not in that pack fast.', 'Outsiders can''t see a pack');
reset role;

update public.fasts set started_at = now() - interval '17 hours' where pack_id = :'pack';
select bones_balance as bob_before from public.profiles where id = :'bob' \gset
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.fasting_end(:'today'::date) ->> 'pack_bones')::int, 0, 'No pack bonus until everyone''s done');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select public.fasting_end(:'today'::date) as eb \gset
select is((:'eb'::jsonb ->> 'pack_bones')::int, 10, 'Everyone on plan: the pack bonus');
reset role;
select is((select bones_balance from public.profiles where id = :'bob') - :bob_before, 25, 'Bob gets 15 for his fast and 10 for the pack');
select is((select count(*)::int from public.activity_events where kind = 'fasting_pack'), 2, 'Paid once to each');

-- ── Compare and the board ──
select tests.sign_in(:'bob');
set local role authenticated;
select is((public.fasting_compare(:'ann', :'today'::date) ->> 'together')::int, 1, 'Compare counts fasts together');
select is(jsonb_array_length(public.fasting_friends(:'today'::date) -> 'board'), 2, 'The board has Bob and Ann');
select is(public.fasting_friends(:'today'::date) -> 'board' -> 0 ->> 'name', 'Ann', 'Ann leads on days on plan and streak');
select throws_ok(format($$select public.fasting_compare(%L, %L)$$, :'cat', :'today'), 'You can compare with friends who share their fasting.', 'Only friends');
reset role;

-- ── Club ──
insert into public.clubs (id, code, name, sport, is_public, created_by) values
  ('00000000-0000-0000-0000-000000261c01', 'FAST01', 'Fasting Pack', 'fasting', true, :'ann');
insert into public.club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-000000261c01', :'ann', 'owner'), ('00000000-0000-0000-0000-000000261c01', :'cat', 'member');
select tests.sign_in(:'cat');
set local role authenticated;
select is(jsonb_array_length(public.club_fasting('00000000-0000-0000-0000-000000261c01', :'today'::date) -> 'board'), 1, 'The club board has members who fast');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
-- 0262: a public club's counts show to anyone; the board is members only.
select is(jsonb_array_length(public.club_fasting('00000000-0000-0000-0000-000000261c01', (now() at time zone 'utc')::date) -> 'board'), 0, 'The board is members only');
reset role;

-- ── Admin ──
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.admin_fasting_overview()$$, 'Admins only.', 'The overview is admin-only');
select throws_ok($$select public.admin_set_fasting_config('{"bones_16": 30}')$$, 'Admins only.', 'So are the Bones');
reset role;
select tests.sign_in(:'boss');
set local role authenticated;
select is((public.admin_fasting_overview() ->> 'tried')::int, 2, 'Two people have fasted');
select is((public.admin_fasting_overview() ->> 'under_16')::int, 1, 'One said under 16');
select is((public.admin_fasting_overview() ->> 'packs_paid_7d')::int, 1, 'One pack fast paid');
select public.admin_set_fasting_config('{"bones_16": 30, "pack_bonus": 0}');
select is((select bones_16 from public.fasting_config), 30, 'Admin changes what 16 h pays');
select throws_ok($$select public.admin_set_fasting_config('{"bones_99": 3}')$$, 'Unknown setting bones_99.', 'Only known settings');
select throws_ok($$select public.admin_set_fasting_config('{"bones_12": -1}')$$, 'Enter a whole number of Bones from 0 to 100,000.', 'No negative Bones');
reset role;

select * from finish();
