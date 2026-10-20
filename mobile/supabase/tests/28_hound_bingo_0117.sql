-- 0117: hound Bingo deals a shuffled card sized by the challenge's
-- length, notes the first BINGO, places BINGOs in order, and can have a
-- pot.
select plan(20);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
update public.profiles set bones_balance = 100, bones_earned_total = 100 where id in (:'ann', :'bob', :'cat');

-- A week, two weeks and four weeks.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, bingo_card_type) values
  ('00000000-0000-0000-0000-0000000000b3', 'Week', 'bingo', :'ann', 7, now() - interval '2 hours', now() + interval '6 days', 'hound'),
  ('00000000-0000-0000-0000-0000000000b4', 'Fortnight', 'bingo', :'ann', 14, now() - interval '2 hours', now() + interval '13 days', 'hound'),
  ('00000000-0000-0000-0000-0000000000b5', 'Month', 'bingo', :'ann', 28, now() - interval '2 hours', now() + interval '27 days', 'hound'),
  ('00000000-0000-0000-0000-0000000000b0', 'Old card', 'bingo', :'ann', 7, now() - interval '2 hours', now() + interval '6 days', 'variety');
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000000b3', :'ann'),
  ('00000000-0000-0000-0000-0000000000b4', :'ann'),
  ('00000000-0000-0000-0000-0000000000b5', :'ann'), ('00000000-0000-0000-0000-0000000000b5', :'bob'),
  ('00000000-0000-0000-0000-0000000000b5', :'cat'),
  ('00000000-0000-0000-0000-0000000000b0', :'ann');

select is((select array_length(squares, 1) from public.bingo_cards where challenge_id = '00000000-0000-0000-0000-0000000000b3' and user_id = :'ann'),
  9, 'A week deals a 3x3 card');
select is((select array_length(squares, 1) from public.bingo_cards where challenge_id = '00000000-0000-0000-0000-0000000000b4' and user_id = :'ann'),
  16, 'Two weeks deals a 4x4 card');
select is((select array_length(squares, 1) from public.bingo_cards where challenge_id = '00000000-0000-0000-0000-0000000000b5' and user_id = :'ann'),
  25, 'Four weeks deals a 5x5 card');
select is((select squares[14] from public.bingo_cards where challenge_id = '00000000-0000-0000-0000-0000000000b5' and user_id = :'ann'),
  'free', 'FREE is in the middle of the N column');
select ok((select bool_and(s like 'steps_%') from public.bingo_cards b, unnest(array[b.squares[1], b.squares[6], b.squares[11], b.squares[16], b.squares[21]]) s
  where b.challenge_id = '00000000-0000-0000-0000-0000000000b5' and b.user_id = :'ann'), 'The H column is all step squares');
select ok((select bool_and(s in ('run', 'strength', 'yoga_pilates', 'hiit_cardio'))
  from public.bingo_cards b, unnest(array[b.squares[4], b.squares[8], b.squares[12], b.squares[16]]) s
  where b.challenge_id = '00000000-0000-0000-0000-0000000000b4' and b.user_id = :'ann'), 'The T column on a 4x4 is workout types');
select ok(not exists (select 1 from public.bingo_cards b, unnest(b.squares) s
  where b.challenge_id = '00000000-0000-0000-0000-0000000000b3' and s = 'swim'), 'No swim on a 3x3');
select is((select count(*)::int from public.bingo_cards where challenge_id = '00000000-0000-0000-0000-0000000000b0'),
  0, 'An old-style Bingo deals no card');

select tests.sign_in(:'bob');
set local role authenticated;
select is(public.my_bingo_card('00000000-0000-0000-0000-0000000000b5'),
  (select squares from public.bingo_cards where challenge_id = '00000000-0000-0000-0000-0000000000b5' and user_id = auth.uid()),
  'my_bingo_card returns the card already dealt');
select is((select count(*)::int from public.bingo_cards where challenge_id = '00000000-0000-0000-0000-0000000000b5'),
  3, 'Players see everyone''s card');
select throws_ok('update public.bingo_cards set bingo_at = now()', '42501', null, 'Nobody writes cards directly');
reset role;

select tests.sign_in(:'dan');
set local role authenticated;
select is((select count(*)::int from public.bingo_cards where challenge_id = '00000000-0000-0000-0000-0000000000b5'),
  0, 'Someone not in the challenge sees no cards');
reset role;

-- Ann marks four squares of her top row: no BINGO yet. Through the app's
-- own path, as Ann.
select tests.sign_in(:'ann');
set local role authenticated;
insert into public.bingo_progress (challenge_id, user_id, category, workout_key)
  select '00000000-0000-0000-0000-0000000000b5', auth.uid(), b.squares[i], 'k' || i
  from public.bingo_cards b, generate_series(1, 4) i
  where b.challenge_id = '00000000-0000-0000-0000-0000000000b5' and b.user_id = auth.uid();
reset role;
select is((select bingo_at from public.bingo_cards where challenge_id = '00000000-0000-0000-0000-0000000000b5' and user_id = :'ann'),
  null, 'Four in a row isn''t a BINGO');

select tests.sign_in(:'ann');
set local role authenticated;
insert into public.bingo_progress (challenge_id, user_id, category, workout_key)
  select '00000000-0000-0000-0000-0000000000b5', auth.uid(), b.squares[5], 'k5'
  from public.bingo_cards b
  where b.challenge_id = '00000000-0000-0000-0000-0000000000b5' and b.user_id = auth.uid();
reset role;
select isnt((select bingo_at from public.bingo_cards where challenge_id = '00000000-0000-0000-0000-0000000000b5' and user_id = :'ann'),
  null, 'The fifth makes a BINGO');

-- Bob's middle row: four squares and FREE.
insert into public.bingo_progress (challenge_id, user_id, category, workout_key)
  select '00000000-0000-0000-0000-0000000000b5', :'bob', b.squares[i], 'k' || i
  from public.bingo_cards b, unnest(array[11, 12, 13, 15]) i
  where b.challenge_id = '00000000-0000-0000-0000-0000000000b5' and b.user_id = :'bob';
select isnt((select bingo_at from public.bingo_cards where challenge_id = '00000000-0000-0000-0000-0000000000b5' and user_id = :'bob'),
  null, 'FREE counts toward a line');

-- Cat fills three squares, no line. Bob's BINGO came first.
insert into public.bingo_progress (challenge_id, user_id, category, workout_key)
  select '00000000-0000-0000-0000-0000000000b5', :'cat', b.squares[i], 'k' || i
  from public.bingo_cards b, unnest(array[1, 7, 25]) i
  where b.challenge_id = '00000000-0000-0000-0000-0000000000b5' and b.user_id = :'cat';
update public.bingo_cards set bingo_at = now() - interval '2 days'
  where challenge_id = '00000000-0000-0000-0000-0000000000b5' and user_id = :'bob';

-- Bob and Ann go in a pot; Cat doesn't.
select tests.sign_in(:'ann');
set local role authenticated;
select public.set_challenge_pot('00000000-0000-0000-0000-0000000000b5', 25);
select public.join_challenge_pot('00000000-0000-0000-0000-0000000000b5');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select public.join_challenge_pot('00000000-0000-0000-0000-0000000000b5');
reset role;

update public.challenges set ends_at = now() - interval '1 hour' where id = '00000000-0000-0000-0000-0000000000b5';
select public.settle_challenge_score_core('00000000-0000-0000-0000-0000000000b5');
select public.settle_challenge_pot('00000000-0000-0000-0000-0000000000b5');

select is((select score_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000b5' and user_id = :'bob' and kind = 'bingo_result'),
  35, 'The first BINGO takes 1st');
select is((select score_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000b5' and user_id = :'ann' and kind = 'bingo_result'),
  30, 'The next one takes 2nd');
select is((select score_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000b5' and user_id = :'cat' and kind = 'bingo_result'),
  3, 'No BINGO scores its squares');
select is((select paid_out from public.challenge_pot_entries where challenge_id = '00000000-0000-0000-0000-0000000000b5' and user_id = :'bob'),
  50, 'The first BINGO in the pot takes the pot');

select ok(not has_function_privilege('anon', 'public.my_bingo_card(uuid)', 'EXECUTE'),
  'Signed-out visitors can''t be dealt a card');

select * from finish();
