-- 0192: Pack Fun: sessions, steps, scent trails, flash challenges, the
-- map's bones, Admin's Bones amounts and the daily cap.
select plan(30);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bea') as bea \gset
select tests.new_user('Cal') as cal \gset
select tests.new_user('Ada', true) as ada \gset
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bea', 'accepted');

-- Admin settings.
select tests.sign_in(:'bea');
set local role authenticated;
select throws_ok($$select public.admin_set_pack_fun_config('{"daily_cap": 9999}')$$, 'not authorized', 'Only admins change the Bones');
select throws_ok($$select public.admin_pack_fun_overview()$$, 'not authorized', 'or see the numbers');
select is((select trail_first_bones from public.pack_fun_config), 25, 'Everyone can read the amounts');
reset role;

-- Ann starts one, inviting Bea (a friend) and Cal (not a friend).
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.start_pack_fun('Hike', 45)$$, 'Pick 30 minutes, 1, 2 or 4 hours.', 'Lengths are set');
select public.start_pack_fun('Saturday hike', 120, array[:'bea', :'cal']::uuid[], null, true, true, true) as pack \gset
reset role;
select is((select count(*)::int from public.pack_fun_members where pack_id = :'pack'), 2, 'Only friends are invited');

select tests.sign_in(:'cal');
set local role authenticated;
select throws_ok(format('select public.join_pack_fun(%L)', :'pack'), 'You weren''t invited to that one.', 'Someone uninvited can''t join');
select throws_ok(format('select public.pack_fun_state(%L)', :'pack'), 'not authorized', 'or see it');
reset role;

-- Alone, a Pack Fun gives no Bones.
select tests.sign_in(:'ann');
set local role authenticated;
select public.pack_fun_ping(:'pack', 2500, true, 33.9500, -84.4400);
select is((public.pack_fun_state(:'pack') -> 'trail') is not null, true, 'At 2,000 pack steps the first scent trail opens');
select (public.pack_fun_state(:'pack') -> 'trail' ->> 'id') as trail1 \gset
reset role;
select answer as right_answer from public.pack_fun_puzzles where id = (select puzzle_id from public.pack_fun_trails where id = :'trail1') \gset
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.answer_pack_fun_trail(:'trail1', :right_answer) ->> 'bones')::int, 0, 'Solo, the right answer earns nothing');
select throws_ok(format('select public.answer_pack_fun_trail(%L, 0)', :'trail1'), 'You''ve answered this one.', 'One answer each');
reset role;

-- Bea joins; the next trail opens at 4,000.
select tests.sign_in(:'bea');
set local role authenticated;
select public.join_pack_fun(:'pack');
select public.pack_fun_ping(:'pack', 1600, true, 33.9502, -84.4402);
select (public.pack_fun_state(:'pack') -> 'trail' ->> 'id') as trail2 \gset
select isnt(:'trail2'::uuid, :'trail1'::uuid, 'At 4,000 the second one opens');
reset role;
select answer as right2 from public.pack_fun_puzzles where id = (select puzzle_id from public.pack_fun_trails where id = :'trail2') \gset

select tests.sign_in(:'bea');
set local role authenticated;
select is((public.answer_pack_fun_trail(:'trail2', :right2) ->> 'bones')::int, 25, 'First right answer: 25 Bones');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.answer_pack_fun_trail(:'trail2', :right2) ->> 'bones')::int, 5, 'Then 5 for each right answer after');
select is((public.pack_fun_state(:'pack') -> 'trail' ->> 'answer')::int, :right2, 'The answer shows once you''ve answered');
reset role;

-- Steps only go up.
select tests.sign_in(:'bea');
set local role authenticated;
select public.pack_fun_ping(:'pack', 100);
reset role;
select is((select steps from public.pack_fun_members where pack_id = :'pack' and user_id = :'bea'), 1600, 'A lower step count never lowers the board');

-- A Dash.
select tests.sign_in(:'bea');
set local role authenticated;
select public.start_pack_fun_flash(:'pack', 'dash', 10) as dash \gset
select throws_ok(format('select public.start_pack_fun_flash(%L, %L, 5)', :'pack', 'dash'), 'One flash challenge at a time.', 'One at a time');
select public.pack_fun_ping(:'pack', 2400);
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select public.pack_fun_ping(:'pack', 2700);
reset role;
update public.pack_fun_flashes set ends_at = now() - interval '1 second' where id = :'dash';
select public.pack_fun_settle_due();
select is((select result ->> 'winner' from public.pack_fun_flashes where id = :'dash'), :'bea', 'Most steps in the Dash wins it');
select is((select bones from public.pack_fun_rewards where user_id = :'bea' and reason = 'flash_dash'), 20, 'for 20 Bones');

-- A Pack push that the pack makes.
select tests.sign_in(:'ann');
set local role authenticated;
select public.start_pack_fun_flash(:'pack', 'push', 5, 500) as push \gset
select public.pack_fun_ping(:'pack', 3100);
reset role;
select tests.sign_in(:'bea');
set local role authenticated;
select public.pack_fun_ping(:'pack', 2600);
reset role;
update public.pack_fun_flashes set ends_at = now() - interval '1 second' where id = :'push';
select public.pack_fun_settle_due();
select is((select count(*)::int from public.pack_fun_rewards where reason = 'flash_push' and pack_id = :'pack'), 2, 'Making the Pack push pays everyone');

-- The daily cap.
select tests.sign_in(:'ada');
set local role authenticated;
select public.admin_set_pack_fun_config('{"daily_cap": 40, "bone_find_bones": 15}');
select is((select daily_cap from public.pack_fun_config), 40, 'Admin sets the daily cap');
reset role;

-- Bones on the map.
select is((select count(*)::int from public.pack_fun_bones where pack_id = :'pack') >= 1, true, 'The map drops a bone near the pack');
select id as bone, lat as blat, lng as blng from public.pack_fun_bones where pack_id = :'pack' limit 1 \gset
select tests.sign_in(:'bea');
set local role authenticated;
select throws_ok(format('select public.find_pack_fun_bone(%L, %s, %s)', :'bone', :blat + 0.01, :blng), 'Get a little closer.', 'You have to walk to a bone');
select is(public.find_pack_fun_bone(:'bone', :blat, :blng), 0, 'Over the daily cap, a bone gives nothing more');
reset role;
select is((select sum(bones)::int from public.pack_fun_rewards where user_id = :'bea' and created_at > now() - interval '1 day') <= 40 + 25, true, 'Nobody gets past the cap once it''s set');

-- Ending it.
select tests.sign_in(:'bea');
set local role authenticated;
select throws_ok(format('select public.end_pack_fun(%L)', :'pack'), 'Only whoever started it can end it.', 'Only the starter ends it early');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select public.end_pack_fun(:'pack');
select is((public.pack_fun_state(:'pack') ->> 'settled')::boolean, true, 'Ending it settles it');
select is((public.pack_fun_state(:'pack') -> 'members' -> 0 ->> 'lat'), null, 'and nobody''s location is kept');
reset role;
select is((select lat from public.pack_fun_members where pack_id = :'pack' and user_id = :'ann'), null, 'not even in the table');

select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_pack_fun_overview() ->> 'started_all')::int, 1, 'Admin counts Pack Funs');
select is((public.admin_pack_fun_overview() ->> 'people_all')::int, 2, 'and the people in them');
reset role;

select * from finish();
