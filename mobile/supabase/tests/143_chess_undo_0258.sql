-- 0258: Undo in Hound Chess (your last move, within seconds, before they
-- reply; against the bot, its answer too; not after the game ends), and
-- Bullseye's compound bow at 50,000 steps.
select plan(13);

select is((select unlock_steps from public.bullseye_bows where id = 'compound'), 50000, 'The compound bow unlocks at 50,000 steps');

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cy') as cy \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob', :'cy');
select public.soccer_today(:'ann') as today \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-000000258c01', 'Undo me', 'chess', :'ann', 7, now() - interval '1 hour', now() + interval '7 days', :'today'::date),
  ('00000000-0000-0000-0000-000000258c02', 'Undo the bot', 'chess', :'cy', 7, now() - interval '1 hour', now() + interval '7 days', :'today'::date);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-000000258c01', :'ann'), ('00000000-0000-0000-0000-000000258c02', :'cy');
select tests.sign_in(:'ann');
set local role authenticated;
select public.chess_setup('00000000-0000-0000-0000-000000258c01');
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-000000258c01', :'bob');

-- ── With a friend ──
select tests.sign_in(:'ann');
set local role authenticated;
select (public.chess_move('00000000-0000-0000-0000-000000258c01', 'e2', 'e4')) is not null;
select is((public.chess_undo('00000000-0000-0000-0000-000000258c01') ->> 'plies')::int, 0, 'Ann takes back e4');
select is((public.chess_state('00000000-0000-0000-0000-000000258c01') ->> 'myTurn')::boolean, true, 'and it''s her move again');
select is((public.chess_state('00000000-0000-0000-0000-000000258c01') ->> 'fen'),
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'The board is back to the start');
select throws_ok($$select public.chess_undo('00000000-0000-0000-0000-000000258c01')$$, 'No move to take back.', 'Nothing to take back');
select (public.chess_move('00000000-0000-0000-0000-000000258c01', 'd2', 'd4')) is not null;
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.chess_undo('00000000-0000-0000-0000-000000258c01')$$, 'Too late: they''ve moved.', 'Bob can''t take back Ann''s move');
select (public.chess_move('00000000-0000-0000-0000-000000258c01', 'd7', 'd5')) is not null;
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.chess_undo('00000000-0000-0000-0000-000000258c01')$$, 'Too late: they''ve moved.', 'Once Bob has replied, Ann can''t');
select (public.chess_move('00000000-0000-0000-0000-000000258c01', 'c2', 'c4')) is not null;
reset role;
-- Ann's c4 was a while ago.
update public.chess_moves set created_at = now() - interval '30 seconds' where challenge_id = '00000000-0000-0000-0000-000000258c01' and ply = 3;
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.chess_undo('00000000-0000-0000-0000-000000258c01')$$, 'Too late to take it back.', 'Only within seconds');
reset role;

-- ── Against the bot ──
select tests.sign_in(:'cy');
set local role authenticated;
select public.chess_setup('00000000-0000-0000-0000-000000258c02', 'easy');
select is((public.chess_move('00000000-0000-0000-0000-000000258c02', 'e2', 'e4') ->> 'plies')::int, 2, 'The bot answers at once');
select is((public.chess_undo('00000000-0000-0000-0000-000000258c02') ->> 'plies')::int, 0, 'Undo takes back Cy''s move and the bot''s answer');
select is((public.chess_state('00000000-0000-0000-0000-000000258c02') ->> 'myTurn')::boolean, true, 'Cy to move again');
reset role;

-- ── Admin ──
select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_chess_undo_overview() ->> 'undos_7d')::int, 2, 'Admin counts the undos');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.admin_chess_undo_overview()$$, 'not authorized', 'Admins only');
reset role;

select * from finish();
