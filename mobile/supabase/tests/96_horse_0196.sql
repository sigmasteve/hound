-- 0196: H-O-R-S-E — one on one, the setter's shot, letters, the setter
-- passing on a miss, PIG ending early, and the payout.
select plan(22);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset

select (now() at time zone 'utc')::date
  - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end as cutoff \gset

-- A five-day game, every day over.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000000e1', 'Driveway', 'horse', :'ann', 5,
   (:'cutoff'::date - 4)::timestamp at time zone 'utc', (:'cutoff'::date + 1)::timestamp at time zone 'utc', :'cutoff'::date - 4);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000e1', :'ann');

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.horse_setup('00000000-0000-0000-0000-0000000000e1')$$, 'Only whoever made this game can set it up.', 'Only the creator sets it up');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.horse_setup('00000000-0000-0000-0000-0000000000e1', 'DOG')$$, 'Play to HORSE or PIG.', 'HORSE or PIG');
select lives_ok($$select public.horse_setup('00000000-0000-0000-0000-0000000000e1')$$, 'Ann sets up a game of HORSE');
reset role;

insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000e1', :'bob');
select throws_ok($$insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000e1', '$$ || :'cat' || $$')$$,
  'H-O-R-S-E is one on one.', 'A third player can''t join');

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.horse_set_shot('00000000-0000-0000-0000-0000000000e1', 'layup')$$, 'It''s their shot to set today.', 'Only the setter picks the shot');
select is(public.horse_view('00000000-0000-0000-0000-0000000000e1') ->> 'setter', :'ann', 'Ann sets first');
select is(public.horse_view('00000000-0000-0000-0000-0000000000e1') -> 'shot' ->> 'id', 'three', 'a Three to start');
reset role;

-- Day 1: Ann makes the Three (11,000), Bob doesn't match (9,000): H.
-- Day 2: Ann misses (8,000): no letter, Bob sets.
-- Day 3: Bob makes it (12,000), Ann matches (12,000).
-- Day 4: Bob misses (5,000): Ann sets.
-- Day 5: Ann makes it (10,500), Bob (2,000) doesn't: H-O.
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-0000000000e1', :'ann', :'cutoff'::date - 4, 11000), ('00000000-0000-0000-0000-0000000000e1', :'bob', :'cutoff'::date - 4, 9000),
  ('00000000-0000-0000-0000-0000000000e1', :'ann', :'cutoff'::date - 3, 8000), ('00000000-0000-0000-0000-0000000000e1', :'bob', :'cutoff'::date - 3, 15000),
  ('00000000-0000-0000-0000-0000000000e1', :'ann', :'cutoff'::date - 2, 12000), ('00000000-0000-0000-0000-0000000000e1', :'bob', :'cutoff'::date - 2, 12000),
  ('00000000-0000-0000-0000-0000000000e1', :'ann', :'cutoff'::date - 1, 20000), ('00000000-0000-0000-0000-0000000000e1', :'bob', :'cutoff'::date - 1, 5000),
  ('00000000-0000-0000-0000-0000000000e1', :'ann', :'cutoff'::date, 10500), ('00000000-0000-0000-0000-0000000000e1', :'bob', :'cutoff'::date, 2000);

select tests.sign_in(:'bob');
set local role authenticated;
select is(public.horse_advance('00000000-0000-0000-0000-0000000000e1'), 5, 'Five days played');
select is((select letter_to from public.horse_days where challenge_id = '00000000-0000-0000-0000-0000000000e1' and day_no = 1), :'bob'::uuid, 'Day 1: made, not matched, Bob takes a letter');
select is((select made from public.horse_days where challenge_id = '00000000-0000-0000-0000-0000000000e1' and day_no = 2), false, 'Day 2: Ann misses');
select is((select letter_to from public.horse_days where challenge_id = '00000000-0000-0000-0000-0000000000e1' and day_no = 2), null, 'and nobody takes a letter');
select is((select setter from public.horse_days where challenge_id = '00000000-0000-0000-0000-0000000000e1' and day_no = 3), :'bob'::uuid, 'so Bob sets day 3');
select is((select matched from public.horse_days where challenge_id = '00000000-0000-0000-0000-0000000000e1' and day_no = 3), true, 'Day 3: Ann matches');
select is((select setter from public.horse_days where challenge_id = '00000000-0000-0000-0000-0000000000e1' and day_no = 5), :'ann'::uuid, 'Bob misses day 4, so Ann sets day 5');
select is((select p ->> 'letters' from jsonb_array_elements(public.horse_view('00000000-0000-0000-0000-0000000000e1') -> 'players') p where p ->> 'user_id' = :'bob'), 'HO', 'Bob is on H-O');
select is(public.horse_view('00000000-0000-0000-0000-0000000000e1') ->> 'status', 'final', 'After the last day it''s over');
select is(public.horse_view('00000000-0000-0000-0000-0000000000e1') ->> 'winner', :'ann', 'Fewer letters wins');
reset role;

select public.settle_challenge_score('00000000-0000-0000-0000-0000000000e1');
select is((select bones_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000e1' and user_id = :'ann'), 55, 'The winner gets the win and play Bones');
select is((select bones_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000e1' and user_id = :'bob'), 15, 'the other the play Bones');

-- PIG ends as soon as it's spelled: a layup a day Bob never matches.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000000e2', 'Quick', 'horse', :'ann', 5,
   (:'cutoff'::date - 4)::timestamp at time zone 'utc', (:'cutoff'::date + 1)::timestamp at time zone 'utc', :'cutoff'::date - 4);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000e2', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.horse_setup('00000000-0000-0000-0000-0000000000e2', 'PIG');
select lives_ok($$select public.horse_set_shot('00000000-0000-0000-0000-0000000000e2', 'layup')$$, 'The setter picks a layup');
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000e2', :'bob');
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
select '00000000-0000-0000-0000-0000000000e2', :'ann', :'cutoff'::date - 4 + k, 7000 from generate_series(0, 4) k;
select public.horse_advance('00000000-0000-0000-0000-0000000000e2');
select is((select days_played from public.horse_games where challenge_id = '00000000-0000-0000-0000-0000000000e2'), 3, 'P-I-G in three days');
select ok((select status = 'final' and winner = :'ann' from public.horse_games where challenge_id = '00000000-0000-0000-0000-0000000000e2'), 'and it''s over');

select * from finish();
