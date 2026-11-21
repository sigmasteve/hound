-- 0239: Hound Chess's gentler unlocks. The new step levels, and yesterday's
-- steps or workout still freeing pieces this morning.
select plan(8);

select is((select knight_bishop_steps || '/' || rook_steps || '/' || queen_steps from public.chess_settings), '2500/5000/7500', 'Knights and bishops 2,500, rooks 5,000, the queen 7,500');

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cy') as cy \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob', :'cy');
select public.soccer_today(:'ann') as today \gset

select is(public.chess_free_for(:'ann', null), 'PK', 'Nothing walked: pawns and the king');
insert into public.chess_claims (user_id, day, steps) values (:'ann', :'today', 5200);
select is(public.chess_free_for(:'ann', null), 'PKNBR', '5,200 today: knights, bishops and rooks');

insert into public.chess_claims (user_id, day, steps) values (:'bob', :'today'::date - 1, 8000);
select is(public.chess_free_for(:'bob', null), 'PKNBRQ', '8,000 yesterday, nothing yet today: still everything');

insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min)
values (:'cy', 'w-y', 'Run', ((:'today'::date - 1)::timestamp + interval '12 hours') at time zone 'America/New_York', 'test', 25);
select is(public.chess_free_for(:'cy', null), 'PKQ', 'Yesterday''s 20-minute workout still frees the queen');

-- What the board says.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000c4f01', 'Morning game', 'chess', :'bob', 7, now() - interval '1 hour', now() + interval '7 days', :'today'::date);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000c4f01', :'bob');
select tests.sign_in(:'bob');
set local role authenticated;
select public.chess_setup('00000000-0000-0000-0000-0000000c4f01', 'easy');
select is((public.chess_state('00000000-0000-0000-0000-0000000c4f01') ->> 'free'), 'PKNBRQ', 'The board frees them');
select is((public.chess_state('00000000-0000-0000-0000-0000000c4f01') ->> 'freeToday'), 'PK', 'and says today alone hasn''t yet');
select is((public.chess_state('00000000-0000-0000-0000-0000000c4f01') ->> 'stepsYesterday')::int, 8000, 'with yesterday''s steps');
reset role;

select * from finish();
