-- 0238: Hound Chess. The rules (perft against the known counts), every
-- puzzle has a mate, a game against a friend (joining, steps freeing the
-- pieces, a workout freeing the queen, check freeing everything, turns,
-- illegal moves), the 24-hour clock, mate, a bot game, the payout, the
-- puzzle of the day, and Admin.
select plan(38);

create or replace function pg_temp.perft(p public.chess_pos, d int) returns bigint language plpgsql as $$
declare n bigint := 0; m record;
begin
  if d = 0 then return 1; end if;
  for m in select * from public.chess_legal(p) loop
    if d = 1 then n := n + 1; else n := n + pg_temp.perft(public.chess_apply(p, m.fr, m.t, m.promo), d - 1); end if;
  end loop;
  return n;
end $$;

-- ── The rules ──
select is(pg_temp.perft(public.chess_parse('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), 3), 8902::bigint, 'Start: 8,902 positions after three plies');
select is(pg_temp.perft(public.chess_parse('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'), 2), 2039::bigint, 'Kiwipete: castling, pins, en passant');
select is(pg_temp.perft(public.chess_parse('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'), 3), 2812::bigint, 'Endgame with en passant checks');
select is(pg_temp.perft(public.chess_parse('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1'), 2), 264::bigint, 'Promotions and castling rights');
select is(pg_temp.perft(public.chess_parse('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8'), 2), 1486::bigint, 'Promotion with capture');
select is(public.chess_fen(public.chess_parse('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')),
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 'FEN round trip');
select is((select count(*)::int from public.chess_puzzles z
           where exists (select 1 from public.chess_legal(public.chess_parse(z.fen)) l
                         where public.chess_over(public.chess_apply(public.chess_parse(z.fen), l.fr, l.t, l.promo)) = 'mate')),
  (select count(*)::int from public.chess_puzzles), 'Every puzzle has a mate in one');

-- ── A game with a friend ──
select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cy') as cy \gset
select tests.new_user('Dee') as dee \gset
select tests.new_user('Eve') as eve \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob', :'cy', :'dee', :'eve');
select public.soccer_today(:'ann') as today \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000c4e01', 'Endgame', 'chess', :'ann', 7, now() - interval '1 hour', now() + interval '7 days', :'today'::date),
  ('00000000-0000-0000-0000-0000000c4e02', 'Me and the bot', 'chess', :'cy', 7, now() - interval '1 hour', now() + interval '7 days', :'today'::date);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000c4e01', :'ann'), ('00000000-0000-0000-0000-0000000c4e02', :'cy');
select tests.sign_in(:'ann');
set local role authenticated;
select public.chess_setup('00000000-0000-0000-0000-0000000c4e01');
reset role;
select is((select status from public.chess_games where challenge_id = '00000000-0000-0000-0000-0000000c4e01'), 'waiting', 'Waiting for a friend');
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000c4e01', :'bob');
select is((select status || ':' || (black = :'bob')::text from public.chess_games where challenge_id = '00000000-0000-0000-0000-0000000c4e01'), 'active:true', 'Bob joins as Black');
select throws_ok(format('insert into public.challenge_participants (challenge_id, user_id) values (%L, %L)', '00000000-0000-0000-0000-0000000c4e01', :'dee'),
  'Hound Chess is one on one.', 'No third player');

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.chess_state('00000000-0000-0000-0000-0000000c4e01') ->> 'free'), 'PK', 'No steps: pawns and the king');
select ok((select bool_and(m ->> 'from' not in ('b1', 'g1')) from jsonb_array_elements(public.chess_state('00000000-0000-0000-0000-0000000c4e01') -> 'moves') m),
  'so the knights aren''t offered');
select throws_ok($$select public.chess_move('00000000-0000-0000-0000-0000000c4e01', 'g1', 'f3')$$, 'That piece is resting: walk more to free it.', 'A resting knight can''t move');
select is((public.chess_move('00000000-0000-0000-0000-0000000c4e01', 'e2', 'e4') ->> 'turn'), 'b', 'e4');
select throws_ok($$select public.chess_move('00000000-0000-0000-0000-0000000c4e01', 'd2', 'd4')$$, 'It''s not your move.', 'Turns');
reset role;

insert into public.chess_claims (user_id, day, steps) values (:'bob', :'today', 3500);
select tests.sign_in(:'bob');
set local role authenticated;
select is((public.chess_state('00000000-0000-0000-0000-0000000c4e01') ->> 'free'), 'PKNB', '3,500 steps: knights and bishops');
select is((public.chess_move('00000000-0000-0000-0000-0000000c4e01', 'b8', 'c6') ->> 'plies')::int, 2, '...Nc6');
reset role;

insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min) values (:'ann', 'w1', 'Run', now() - interval '1 minute', 'test', 25);
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.chess_state('00000000-0000-0000-0000-0000000c4e01') ->> 'free'), 'PKQ', 'A 20-minute workout frees the queen');
select throws_ok($$select public.chess_move('00000000-0000-0000-0000-0000000c4e01', 'e4', 'e6')$$, 'That move isn''t allowed.', 'Illegal moves are refused');
select is((public.chess_move('00000000-0000-0000-0000-0000000c4e01', 'd1', 'h5') ->> 'plies')::int, 3, 'Qh5');
reset role;

-- In check, everything's free.
update public.chess_games set fen = 'r3k3/8/8/8/8/8/8/4RK2 b - - 0 1' where challenge_id = '00000000-0000-0000-0000-0000000c4e01';
select tests.sign_in(:'bob');
set local role authenticated;
select is((public.chess_state('00000000-0000-0000-0000-0000000c4e01') ->> 'allFree')::boolean, true, 'In check: every piece is free');
reset role;

-- ── The clock ──
update public.chess_games set fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', turn_started_at = now() - interval '25 hours'
  where challenge_id = '00000000-0000-0000-0000-0000000c4e01';
select public.chess_tick_game('00000000-0000-0000-0000-0000000c4e01');
select is((select black_misses || ':' || plies from public.chess_games where challenge_id = '00000000-0000-0000-0000-0000000c4e01'), '1:4', '24 hours up: Hound moves for Bob');
select ok((select auto from public.chess_moves where challenge_id = '00000000-0000-0000-0000-0000000c4e01' order by ply desc limit 1), 'marked as played for him');
update public.chess_games set fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', turn_started_at = now() - interval '25 hours'
  where challenge_id = '00000000-0000-0000-0000-0000000c4e01';
select public.chess_tick_game('00000000-0000-0000-0000-0000000c4e01');
select is((select result || ':' || method from public.chess_games where challenge_id = '00000000-0000-0000-0000-0000000c4e01'), 'white:timeout', 'Two in a row: the game''s lost');

-- ── Mate ──
update public.chess_games set status = 'active', result = null, method = null, black_misses = 0, turn_started_at = now(),
  fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1'
  where challenge_id = '00000000-0000-0000-0000-0000000c4e01';
select tests.sign_in(:'ann');
set local role authenticated;
select is((select s ->> 'status' || ':' || (s ->> 'result') || ':' || (s ->> 'method') from public.chess_move('00000000-0000-0000-0000-0000000c4e01', 'f3', 'f7') s),
  'final:white:mate', 'Qxf7 is mate');
reset role;
select public.settle_challenge_score_core('00000000-0000-0000-0000-0000000c4e01');
select is((select array_agg(a.score_points || '/' || a.bones_points order by a.user_id = :'ann' desc) from public.activity_events a where a.challenge_id = '00000000-0000-0000-0000-0000000c4e01'),
  array['35/30', '5/5'], 'Ann: 35 points and 25 win Bones; Bob: 5');

-- ── Against the bot ──
select tests.sign_in(:'cy');
set local role authenticated;
select public.chess_setup('00000000-0000-0000-0000-0000000c4e02', 'easy');
select is((public.chess_move('00000000-0000-0000-0000-0000000c4e02', 'd2', 'd4') ->> 'plies')::int, 2, 'The bot answers at once');
select is((public.chess_state('00000000-0000-0000-0000-0000000c4e02') ->> 'myTurn')::boolean, true, 'and it''s Cy''s move again');
reset role;
select throws_ok(format('insert into public.challenge_participants (challenge_id, user_id) values (%L, %L)', '00000000-0000-0000-0000-0000000c4e02', :'dee'),
  'This game is against the Hound bot.', 'Nobody joins a bot game');

-- ── The puzzle of the day ──
select tests.sign_in(:'eve');
set local role authenticated;
select is((select jsonb_build_object('open', s -> 'open', 'fen', s -> 'fen') from public.chess_puzzle_state(1000) s), '{"open": false, "fen": null}'::jsonb, 'Under 5,000 steps: still shut');
select throws_ok($$select public.chess_puzzle_try('a2', 'a3')$$, 'Today''s puzzle opens at 5,000 steps.', 'No tries while it''s shut');
reset role;
select tests.sign_in(:'dee');
set local role authenticated;
select ok((public.chess_puzzle_state(6000) ->> 'fen') is not null, '6,000 steps: it opens');
reset role;
select z.fen as pfen from public.chess_puzzle_days d join public.chess_puzzles z on z.id = d.puzzle_id where d.user_id = :'dee' \gset
select public.chess_sq_name(l.fr) as mfr, public.chess_sq_name(l.t) as mto from public.chess_legal(public.chess_parse(:'pfen')) l
  where public.chess_over(public.chess_apply(public.chess_parse(:'pfen'), l.fr, l.t, l.promo)) = 'mate' limit 1 \gset
select public.chess_sq_name(l.fr) as wfr, public.chess_sq_name(l.t) as wto from public.chess_legal(public.chess_parse(:'pfen')) l
  where coalesce(public.chess_over(public.chess_apply(public.chess_parse(:'pfen'), l.fr, l.t, l.promo)), '') <> 'mate' limit 1 \gset
select bones_balance as bones0 from public.profiles where id = :'dee' \gset
select tests.sign_in(:'dee');
set local role authenticated;
select is((select jsonb_build_object('mate', s -> 'mate', 'tries', s -> 'tries') from public.chess_puzzle_try(:'wfr', :'wto') s), '{"mate": false, "tries": 1}'::jsonb, 'A miss uses a try');
select is((select jsonb_build_object('mate', s -> 'mate', 'bones', s -> 'bones', 'streak', s -> 'streak') from public.chess_puzzle_try(:'mfr', :'mto') s),
  '{"mate": true, "bones": 2, "streak": 1}'::jsonb, 'Mate on the second try: 2 Bones, a streak of 1');
select throws_ok($$select public.chess_puzzle_try('a2', 'a3')$$, 'Solved already: back tomorrow.', 'Once a day');
reset role;
select is((select bones_balance from public.profiles where id = :'dee') - :bones0, 2, 'The Bones are paid');

-- ── Admin ──
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.admin_chess_overview()$$, 'not authorized', 'Admins only');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select is((select jsonb_build_object('finished', o -> 'finished', 'easy', o -> 'vsBot' -> 'easy', 'solved', o -> 'puzzlesSolved7d', 'auto', o -> 'autoMoves7d')
  from public.admin_chess_overview() o),
  '{"finished": 1, "easy": 1, "solved": 1, "auto": 1}'::jsonb, 'Admin: games, bot games, puzzles, auto moves');
reset role;

select * from finish();
