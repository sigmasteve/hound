-- 0259: the chess clock. A game's start is marked when it goes live; each
-- side's time adds up its turns; the side to move is running.
select plan(8);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob');
select public.soccer_today(:'ann') as today \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-000000259c01', 'Clocked', 'chess', :'ann', 7, now() - interval '1 hour', now() + interval '7 days', :'today'::date);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-000000259c01', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.chess_setup('00000000-0000-0000-0000-000000259c01');
reset role;
select is((select started_at from public.chess_games where challenge_id = '00000000-0000-0000-0000-000000259c01'), null, 'Waiting for a friend: no start yet');
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-000000259c01', :'bob');
select ok((select started_at is not null from public.chess_games where challenge_id = '00000000-0000-0000-0000-000000259c01'), 'Bob joins: the clock starts');

-- Started 100 s ago; Ann took 30 s over e4, Bob 40 s over e5, and Ann's been thinking 30 s.
update public.chess_games set started_at = now() - interval '100 seconds' where challenge_id = '00000000-0000-0000-0000-000000259c01';
select tests.sign_in(:'ann');
set local role authenticated;
select (public.chess_move('00000000-0000-0000-0000-000000259c01', 'e2', 'e4')) is not null;
reset role;
update public.chess_moves set created_at = now() - interval '70 seconds' where challenge_id = '00000000-0000-0000-0000-000000259c01' and ply = 1;
select tests.sign_in(:'bob');
set local role authenticated;
select (public.chess_move('00000000-0000-0000-0000-000000259c01', 'e7', 'e5')) is not null;
reset role;
update public.chess_moves set created_at = now() - interval '30 seconds' where challenge_id = '00000000-0000-0000-0000-000000259c01' and ply = 2;

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.chess_clock('00000000-0000-0000-0000-000000259c01') ->> 'w')::int, 30, 'White has used 30 s');
select is((public.chess_clock('00000000-0000-0000-0000-000000259c01') ->> 'b')::int, 40, 'Black has used 40 s');
select is(public.chess_clock('00000000-0000-0000-0000-000000259c01') ->> 'running', 'w', 'White is on the clock');
select ok(abs(extract(epoch from now() - (public.chess_clock('00000000-0000-0000-0000-000000259c01') ->> 'since')::timestamptz) - 30) < 1, 'since Bob''s move, 30 s ago');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select is((public.chess_clock('00000000-0000-0000-0000-000000259c01') ->> 'w')::int, 30, 'Bob sees the same clock');
reset role;
select tests.sign_in(:'cat');
set local role authenticated;
select throws_ok($$select public.chess_clock('00000000-0000-0000-0000-000000259c01')$$, 'You''re not playing in this game.', 'Only the players read it');
reset role;

select * from finish();
