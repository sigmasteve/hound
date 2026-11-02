-- 0150: friends leave pawprints and toss treats in each other's yards,
-- strangers can't, and a friend's hound comes over on a day you both
-- finished your goals in a challenge together.
select plan(14);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cy') as cy \gset
select tests.new_user('Dee') as dee \gset
select (now() at time zone 'utc')::date as today \gset
update public.profiles set bones_balance = 50 where id in (:'bob', :'dee');
insert into public.friendships (requester_id, recipient_id, status) values
  (:'ann', :'bob', 'accepted'),
  (:'dee', :'ann', 'accepted');

select tests.sign_in(:'bob');
set local role authenticated;
select public.leave_pawprint(:'ann', :'today');
select lives_ok(format('select public.leave_pawprint(%L, %L)', :'ann', :'today'), 'A second pawprint the same day does nothing');
select is(public.toss_yard_treat(:'ann', :'today'), 40, 'A treat costs the friend 10 Bones');
select throws_ok(format('select public.toss_yard_treat(%L, %L)', :'ann', :'today'),
  'You''ve tossed them a treat today. Back tomorrow.', 'One treat a day per friend');
select is(public.friend_yard(:'ann', :'today') -> 'mine', '{"pawprint": true, "treat": true}'::jsonb,
  'The visitor sees what they left today');
select is(public.friend_yard(:'ann', :'today') -> 'visitors', '[]'::jsonb, 'but not who else stopped by');
select is((public.friend_yard(:'ann', :'today') ->> 'pawprints')::int, 1, 'Pawprints show to visitors too');
reset role;

select tests.sign_in(:'dee');
set local role authenticated;
select throws_ok(format('select public.toss_yard_treat(%L, %L)', :'ann', :'today'),
  'They''ve had a treat today. Try tomorrow.', 'A hound gets one treat a day, whoever gives it');
reset role;

select tests.sign_in(:'cy');
set local role authenticated;
select throws_ok(format('select public.leave_pawprint(%L, %L)', :'ann', :'today'),
  'Only friends can visit each other''s yards.', 'Strangers can''t leave pawprints');
select throws_ok(format('select public.toss_yard_treat(%L, %L)', :'ann', :'today'),
  'Only friends can visit each other''s yards.', 'or treats');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.my_yard(:'today') ->> 'pawprints')::int, 1, 'The owner sees one pawprint');
select is(
  (select jsonb_agg(jsonb_build_object('name', v ->> 'name', 'pawprint', v -> 'pawprint', 'treat', v -> 'treat'))
     from jsonb_array_elements(public.my_yard(:'today') -> 'visitors') v),
  '[{"name": "Bob", "pawprint": true, "treat": true}]'::jsonb,
  'and who stopped by, with what they left');
select is((select treated_today from public.my_kennel(:'today')), true, 'A friend''s treat is the hound''s treat for the day');
select is(public.my_yard(:'today') -> 'guest', 'null'::jsonb, 'No goal days, no visiting hound');
reset role;

-- Both finish their goals today, in a challenge together that's on now.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('44444444-0000-0000-0000-000000000001', 'Hound Cup', 'steps', :'ann', 7, now() - interval '1 day', now() + interval '6 days');
insert into public.challenge_participants (challenge_id, user_id) values
  ('44444444-0000-0000-0000-000000000001', :'ann'),
  ('44444444-0000-0000-0000-000000000001', :'bob');
insert into public.goal_streaks (user_id, streak, best_streak, last_hit_on) values
  (:'ann', 1, 1, :'today'),
  (:'bob', 1, 1, :'today');

select tests.sign_in(:'ann');
set local role authenticated;
select is(
  (select jsonb_build_object('owner', g ->> 'owner', 'challenge', g ->> 'challenge', 'name', g ->> 'name')
     from (select public.my_yard(:'today') -> 'guest' as g) x),
  '{"owner": "Bob", "challenge": "Hound Cup", "name": "Scout"}'::jsonb,
  'A friend''s hound comes over to play');
reset role;

select * from finish();
