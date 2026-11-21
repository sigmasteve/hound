-- Hound: Hound Chess, gentler unlocks (Steve, Nov 2026).
--
--   1. Lower: knights and bishops at 2,500 steps, rooks at 5,000, the
--      queen at 7,500 (was 3,000 / 6,000 / 9,000), or still a 20-minute
--      workout for the queen.
--   2. Yesterday counts: a piece is free on the better of today's and
--      yesterday's steps (and workout), so a move made first thing in the
--      morning isn't stuck with pawns and the king.
--
-- chess_state also says what's free on today alone (freeToday) and
-- yesterday's numbers, so the app can say a piece is free from yesterday.
--
-- Run this once, after 0238, in the SQL Editor.

alter table public.chess_settings alter column knight_bishop_steps set default 2500;
alter table public.chess_settings alter column rook_steps set default 5000;
alter table public.chess_settings alter column queen_steps set default 7500;
update public.chess_settings set knight_bishop_steps = 2500, rook_steps = 5000, queen_steps = 7500, updated_at = now() where id;

create or replace function public.chess_free_for(p_user uuid, p_bot text)
returns text
language sql
stable
security definer set search_path = public
as $$
  select case
    when p_user is null then public.chess_free_letters(case p_bot when 'easy' then 4000 when 'medium' then 7000 else 10000 end, 0)
    -- 0239: the better of today and yesterday, so a piece freed yesterday
    -- is still free this morning.
    else public.chess_free_letters(
      greatest(public.chess_steps(p_user, public.soccer_today(p_user)), public.chess_steps(p_user, public.soccer_today(p_user) - 1)),
      greatest(public.chess_workout_min(p_user, public.soccer_today(p_user)), public.chess_workout_min(p_user, public.soccer_today(p_user) - 1)))
  end;
$$;
revoke execute on function public.chess_free_for(uuid, text) from public, anon, authenticated;

create or replace function public.chess_state(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  g public.chess_games;
  c public.challenges%rowtype;
  cfg public.chess_settings;
  p public.chess_pos;
  my_side text;
  opp uuid;
  free text;
  their_free text;
  my_steps int;
  my_wk int;
  my_y int;
  wk_y int;
  moves jsonb := '[]'::jsonb;
  all_free boolean := false;
begin
  select * into g from public.chess_games where challenge_id = p_challenge_id;
  if g.challenge_id is null then
    raise exception 'This game never got set up.';
  end if;
  if me is null or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me) then
    raise exception 'Join the challenge to see the board.';
  end if;
  perform public.chess_tick_game(p_challenge_id);
  select * into g from public.chess_games where challenge_id = p_challenge_id;
  select * into c from public.challenges where id = p_challenge_id;
  select * into cfg from public.chess_settings;
  p := public.chess_parse(g.fen);
  my_side := case when me = g.white then 'w' when me = g.black then 'b' end;
  opp := case when my_side = 'w' then g.black else g.white end;
  my_steps := public.chess_steps(me, public.soccer_today(me));
  my_wk := public.chess_workout_min(me, public.soccer_today(me));
  -- 0239: yesterday counts too.
  my_y := public.chess_steps(me, public.soccer_today(me) - 1);
  wk_y := public.chess_workout_min(me, public.soccer_today(me) - 1);
  free := public.chess_free_letters(greatest(my_steps, my_y), greatest(my_wk, wk_y));
  their_free := public.chess_free_for(opp, g.bot);
  if g.status = 'active' and p.side = my_side then
    select coalesce(jsonb_agg(jsonb_build_object('from', public.chess_sq_name(a.fr), 'to', public.chess_sq_name(a.t), 'promo', a.promo)), '[]'::jsonb),
           coalesce(bool_or(a.all_free), false)
      into moves, all_free
      from public.chess_allowed(p, free) a;
  end if;
  return jsonb_build_object(
    'fen', g.fen,
    'status', g.status,
    'result', g.result,
    'method', g.method,
    'me', my_side,
    'turn', p.side,
    'myTurn', g.status = 'active' and p.side = my_side,
    'inCheck', public.chess_in_check(p),
    'white', jsonb_build_object('id', g.white, 'name', public.chess_name(g.white)),
    'black', case when g.bot is not null then jsonb_build_object('id', null, 'name', 'Hound bot', 'bot', g.bot)
                  when g.black is not null then jsonb_build_object('id', g.black, 'name', public.chess_name(g.black)) end,
    'bot', g.bot,
    'deadline', case when g.status = 'active' and g.turn_started_at is not null then g.turn_started_at + make_interval(hours => cfg.move_hours) end,
    'endsAt', c.ends_at,
    'misses', jsonb_build_object('w', g.white_misses, 'b', g.black_misses),
    'plies', g.plies,
    'material', public.chess_material(p.b),
    'steps', my_steps,
    'workoutMin', my_wk,
    'stepsYesterday', my_y,
    'workoutMinYesterday', wk_y,
    'freeToday', public.chess_free_letters(my_steps, my_wk),
    'free', free,
    'allFree', all_free,
    'theirSteps', case when g.bot is not null then null else public.chess_steps(opp, public.soccer_today(opp)) end,
    'theirFree', their_free,
    'moves', moves,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('ply', m.ply, 'side', m.side, 'piece', m.piece, 'from', m.fr, 'to', m.t, 'promo', m.promo,
                                          'captured', m.captured, 'check', m.gave_check, 'auto', m.auto) order by m.ply)
      from public.chess_moves m where m.challenge_id = p_challenge_id
    ), '[]'::jsonb),
    'needs', jsonb_build_object('knightBishop', cfg.knight_bishop_steps, 'rook', cfg.rook_steps, 'queen', cfg.queen_steps,
                                'queenWorkout', cfg.queen_workout_min, 'moveHours', cfg.move_hours)
  );
end;
$$;
revoke execute on function public.chess_state(uuid) from public, anon;
grant execute on function public.chess_state(uuid) to authenticated;
