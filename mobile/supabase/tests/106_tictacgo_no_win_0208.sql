-- 0208: Tic-Tac-Go ends as soon as nobody can get three in a row: the
-- check itself, a move that leaves no way to win, a game already in that
-- state ending when it's opened, and the other endings as before.
select plan(16);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset

-- The check. Squares 1-9 row by row; a = Ann (X), b = Bob (O).
-- Steve's board: . X O / O X X / X O .  — the corners are open, and
-- Ann's diagonal needs both of them.
select is(public.tictacgo_can_win(array[null, :'ann', :'bob', :'bob', :'ann', :'ann', :'ann', :'bob', null]::uuid[], :'ann', :'bob', :'bob'),
  false, 'Steve''s board, O to move: nobody can win');
select is(public.tictacgo_can_win(array[null, :'ann', :'bob', :'bob', :'ann', :'ann', :'ann', :'bob', null]::uuid[], :'ann', :'bob', :'ann'),
  false, 'and X to move: X takes one corner, O the other');
select is(public.tictacgo_can_win(array_fill(null::uuid, array[9]), :'ann', :'bob', :'ann'),
  true, 'an empty board can be won');
select is(public.tictacgo_can_win(array[:'ann', :'ann', null, :'bob', :'bob', :'ann', :'ann', :'bob', :'bob']::uuid[], :'ann', :'bob', :'ann'),
  true, 'one square left that wins for the player to move');
select is(public.tictacgo_can_win(array[:'ann', :'ann', null, :'bob', :'bob', :'ann', :'ann', :'bob', :'bob']::uuid[], :'ann', :'bob', :'bob'),
  false, 'one square left that would win for the other player: no');
select is(public.tictacgo_can_win(array[:'ann', null, :'bob', null, :'ann', null, :'bob', null, null]::uuid[], :'ann', :'bob', :'bob'),
  true, 'X needs one more with O to move and squares to spare: still on');
select is(public.tictacgo_can_win(array[:'ann', :'bob', :'ann', :'ann', :'bob', :'bob', :'bob', :'ann', null]::uuid[], :'ann', :'bob', :'ann'),
  false, 'every line blocked: no');

-- Games. Ann is X, Bob is O.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000000d801', 'Block it', 'tictacgo', :'ann', 7, now() - interval '4 days', now() + interval '3 days'),
  ('00000000-0000-0000-0000-00000000d802', 'Stuck game', 'tictacgo', :'ann', 7, now() - interval '4 days', now() + interval '3 days'),
  ('00000000-0000-0000-0000-00000000d803', 'Open game', 'tictacgo', :'ann', 7, now() - interval '4 days', now() + interval '3 days'),
  ('00000000-0000-0000-0000-00000000d804', 'Winner', 'tictacgo', :'ann', 7, now() - interval '4 days', now() + interval '3 days');
insert into public.challenge_participants (challenge_id, user_id)
select c, u from unnest(array['00000000-0000-0000-0000-00000000d801', '00000000-0000-0000-0000-00000000d802',
  '00000000-0000-0000-0000-00000000d803', '00000000-0000-0000-0000-00000000d804']::uuid[]) c, unnest(array[:'ann', :'bob']::uuid[]) u;

insert into public.tictacgo_games (challenge_id, difficulty, goals, marks, x_user_id, o_user_id, turn_user_id, turn_started_at, status) values
  -- . X O / O X X / X . .  — Bob (O) to move; Ann threatens the middle column.
  ('00000000-0000-0000-0000-00000000d801', 'easy', array_fill('steps_3k'::text, array[9]),
   array[null, :'ann', :'bob', :'bob', :'ann', :'ann', :'ann', null, null]::uuid[], :'ann', :'bob', :'bob', now() - interval '1 hour', 'active'),
  -- Steve's board, already stuck, Bob to move.
  ('00000000-0000-0000-0000-00000000d802', 'easy', array_fill('steps_3k'::text, array[9]),
   array[null, :'ann', :'bob', :'bob', :'ann', :'ann', :'ann', :'bob', null]::uuid[], :'ann', :'bob', :'bob', now() - interval '1 hour', 'active'),
  -- X . . / . O . / . . .  — Ann to move, lots left.
  ('00000000-0000-0000-0000-00000000d803', 'easy', array_fill('steps_3k'::text, array[9]),
   array[:'ann', null, null, null, :'bob', null, null, null, null]::uuid[], :'ann', :'bob', :'ann', now() - interval '1 hour', 'active'),
  -- X X . / O O . / . . .  — Ann to move, square 3 wins.
  ('00000000-0000-0000-0000-00000000d804', 'easy', array_fill('steps_3k'::text, array[9]),
   array[:'ann', :'ann', null, :'bob', :'bob', null, null, null, null]::uuid[], :'ann', :'bob', :'ann', now() - interval '1 hour', 'active');

-- Bob blocks the middle column (square 8, index 7): nobody can win now.
select tests.sign_in(:'bob');
set local role authenticated;
select is(public.tictacgo_claim_square('00000000-0000-0000-0000-00000000d801', 7), 'draw', 'blocking the last line ends it as a draw');
reset role;
select is((select ended_reason from public.tictacgo_games where challenge_id = '00000000-0000-0000-0000-00000000d801'), 'no_win', 'with ended_reason no_win');
select ok((select turn_user_id is null from public.tictacgo_games where challenge_id = '00000000-0000-0000-0000-00000000d801'), 'nobody''s turn');
select ok((select ends_at <= now() from public.challenges where id = '00000000-0000-0000-0000-00000000d801'), 'and the challenge ends now');

-- A game already stuck ends when it's opened (settle).
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.tictacgo_settle('00000000-0000-0000-0000-00000000d802')$$, 'settle on a stuck game');
reset role;
select is((select status || ':' || ended_reason from public.tictacgo_games where challenge_id = '00000000-0000-0000-0000-00000000d802'), 'draw:no_win', 'it''s a draw, nobody can win');
select ok((select ends_at <= now() from public.challenges where id = '00000000-0000-0000-0000-00000000d802'), 'its challenge ends now');

-- A game with lines left goes on; a winning move still wins.
select tests.sign_in(:'ann');
set local role authenticated;
select public.tictacgo_settle('00000000-0000-0000-0000-00000000d803');
select is(public.tictacgo_claim_square('00000000-0000-0000-0000-00000000d803', 8), 'active', 'a game with lines left goes on');
select is(public.tictacgo_claim_square('00000000-0000-0000-0000-00000000d804', 2), 'won', 'three in a row still wins');
reset role;

select * from finish();
