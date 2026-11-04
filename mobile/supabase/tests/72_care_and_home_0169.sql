-- 0169: bath day (muddy after a long walk, a bath after an active day),
-- homemade treats (baked from spare finds and Bones, fed or sent to a
-- friend), the room inside the house, and the admin numbers.
select plan(31);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select current_date as today \gset
update public.profiles set bones_balance = 2000 where id in (:'ann', :'bob');
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bob', 'accepted');

-- A finished walk, ended m2 minutes ago after m1 - m2 minutes, with a find.
create function pg_temp.walk(u uuid, m1 int, m2 int, steps int, find text) returns void language sql as $$
  insert into public.hound_walks (user_id, day, start_minute, started_at, ended_at, steps, find_id, found_at)
  values (u, current_date, 600, now() - make_interval(mins => m1), now() - make_interval(mins => m2), steps, find,
          case when find is null then null else now() end);
$$;

-- ── Bath day ──
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.my_care(:'today') -> 'bath' ->> 'can_bath', 'false', 'No bath without an active day');
select throws_ok(format('select public.give_bath(%L)', :'today'),
  'A bath comes after an active day: a long walk, 8,000 steps or your goals done.', 'and asking says why');
reset role;

-- A short walk isn't enough; a 40-minute one brings the hound home muddy.
select pg_temp.walk(:'ann', 300, 285, 1200, 'stick');
select pg_temp.walk(:'ann', 200, 160, 3500, 'stick');
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.my_care(:'today') -> 'bath' ->> 'muddy', 'true', 'Home muddy from a long walk');
select is(public.my_care(:'today') -> 'bath' ->> 'earned', 'walk', 'which earns a bath');
select is(public.give_bath(:'today') -> 'bath' ->> 'muddy', 'false', 'A bath washes the mud off');
select is(public.my_care(:'today') -> 'bath' ->> 'bathed', 'true', 'and the hound is fresh');
select throws_ok(format('select public.give_bath(%L)', :'today'), 'Already had a bath today. Squeaky clean.', 'One bath a day');
reset role;

select pg_temp.walk(:'ann', 100, 60, 3200, 'pebble');
update public.hound_baths set created_at = now() - interval '2 hours' where user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.my_care(:'today') -> 'bath' ->> 'muddy', 'true', 'Another long walk after the bath: muddy again');
reset role;

insert into public.daily_step_totals (user_id, day, steps) values (:'bob', :'today', 9000);
select tests.sign_in(:'bob');
set local role authenticated;
select is(public.my_care(:'today') -> 'bath' ->> 'earned', 'steps', '8,000 steps earn a bath too');
select is(public.my_care(:'today') -> 'bath' ->> 'muddy', 'false', 'without any mud');
reset role;

-- ── Treats ──
-- Ann's finds: two sticks and a pebble (common), and a marble.
select pg_temp.walk(:'ann', 600, 580, 900, 'marble');
select tests.sign_in(:'ann');
set local role authenticated;
select is((select (x ->> 'n')::int from jsonb_array_elements(public.my_care(:'today') -> 'spare') x where x ->> 'id' = 'stick'), 2,
  'Finds are spare until they''re baked');
select is(jsonb_array_length(public.make_treat(:'today', 'pumpkin_biscuits') -> 'pantry'), 1, 'Pumpkin biscuits, from two common finds');
reset role;
select is((select used from public.hound_treats where made_by = :'ann'), array['stick', 'stick'], 'The most plentiful finds go in first');
select is((select bones_balance from public.profiles where id = :'ann'), 1985, 'and 15 Bones');
select (select id from public.hound_treats where made_by = :'ann') as biscuit \gset
select tests.sign_in(:'ann');
set local role authenticated;
select is((select count(*)::int from jsonb_array_elements(public.my_walks(:'today') -> 'finds')), 3,
  'The collection book still counts every find');
select throws_ok(format('select public.make_treat(%L, ''frosty_paws'')', :'today'), 'Not enough uncommon finds yet. Walks bring more home.',
  'Frosty paws need two uncommon finds');
reset role;
select is((select bones_balance from public.profiles where id = :'ann'), 1985, 'and a recipe that can''t be made costs nothing');

-- Fed as today's treat, for free.
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.feed_homemade_treat(:'today', :'biscuit') ->> 'treated_today', 'true',
  'A homemade treat is today''s treat');
reset role;
select is((select bones_balance from public.profiles where id = :'ann'), 1985, 'with nothing more to pay');

-- Another batch, for Bob.
select pg_temp.walk(:'ann', 700, 680, 900, 'clover');
select tests.sign_in(:'ann');
set local role authenticated;
select public.make_treat(:'today', 'pumpkin_biscuits');
reset role;
select (select id from public.hound_treats where made_by = :'ann' and eaten_at is null) as batch2 \gset
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format('select public.feed_homemade_treat(%L, %L)', :'today', :'batch2'),
  'Already had a treat today. Save it for tomorrow.', 'One treat a day, homemade or not');
select throws_ok(format('select public.gift_treat(%L, %L, null, %L)', :'cat', :'batch2', :'today'),
  'You can only send gifts to friends.', 'Treats go to friends only');
select lives_ok(format('select public.gift_treat(%L, %L, %L, %L)', :'bob', :'batch2', 'Fresh from the oven', :'today'),
  'Ann sends Bob''s hound the biscuits');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is((select x ->> 'from' from jsonb_array_elements(public.my_care(:'today') -> 'pantry') x), 'Ann', 'They''re in Bob''s pantry, from Ann');
select is((select item_name || ': ' || note from public.my_new_gifts()), 'pumpkin biscuits: Fresh from the oven', 'and Bob hears about it, with the note');
select throws_ok(format('select public.gift_treat(%L, %L, null, %L)', :'ann', :'batch2', :'today'),
  'That one was a gift to you. Send one you baked.', 'A gift can''t be sent on');
reset role;

-- ── The room ──
select tests.sign_in(:'bob');
set local role authenticated;
select lives_ok(format('select public.buy_kennel_item(%L, ''room_sofa'')', :'today'), 'The room is open to everyone: Bob gets a sofa');
reset role;
select is(public.yard_view(:'bob', :'today', false) -> 'room', '["room_sofa"]'::jsonb, 'and it''s in his room, for friends to see too');
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok(format('select public.gift_kennel_item(%L, ''room_rug'', null, %L)', :'bob', :'today'), 'Room things can be gifts');

-- ── Admin ──
select is((public.admin_care_overview() ->> 'made_all')::int, 2, 'Admin: treats made');
select is((public.admin_room_overview() ->> 'rooms')::int, 1, 'Admin: rooms decorated');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok('select public.admin_care_overview()', 'not authorized', 'Members can''t see the admin numbers');
reset role;

select * from finish();
