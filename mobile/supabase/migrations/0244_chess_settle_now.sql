-- Hound: Hound Chess ends when the game does (Steve, Nov 2026).
--
-- A game that ends early (checkmate, a resignation, a second missed
-- turn, stalemate...) used to sit open until the challenge's last day:
-- no Bones, no "That's a wrap", no share. Now, like Tic-Tac-Go, Rally and
-- Cricket, the challenge ends the moment the game does and is settled
-- straight away.
--
-- chess_close does both, and only for a finished game that isn't settled.
-- It's called where a game can end outside a settle: chess_move (your
-- move, or the bot's answer), chess_resign and the hourly chess_tick.
-- Never from chess_finish itself: the settle runs the clock, and the
-- clock can finish a game, so that would settle twice.
--
-- Games already over and not yet settled are settled when this runs.
--
-- Run this once, after 0243, in the SQL Editor.

create or replace function public.chess_close(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.chess_games g join public.challenges c on c.id = g.challenge_id
    where g.challenge_id = p_challenge_id and g.status = 'final' and c.score_settled_at is null
  ) then
    return;
  end if;
  update public.challenges set ends_at = now() where id = p_challenge_id and ends_at > now();
  perform public.settle_challenge_score_core(p_challenge_id);
end;
$$;
revoke execute on function public.chess_close(uuid) from public, anon, authenticated;

create or replace function public.chess_move(p_challenge_id uuid, p_from text, p_to text, p_promo text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  g public.chess_games;
  p public.chess_pos;
  my_side text;
  free text;
  fr int;
  t int;
  ok record;
  over text;
  other uuid;
begin
  select * into g from public.chess_games where challenge_id = p_challenge_id for update;
  if g.challenge_id is null or me is null or me not in (g.white, coalesce(g.black, g.white)) then
    raise exception 'You''re not playing in this game.';
  end if;
  if g.status = 'waiting' then
    raise exception 'Waiting for your opponent to join.';
  end if;
  if g.status <> 'active' then
    raise exception 'This game is over.';
  end if;
  if now() >= (select c.ends_at from public.challenges c where c.id = p_challenge_id) then
    raise exception 'Time''s up: the game is decided on the pieces left.';
  end if;
  p := public.chess_parse(g.fen);
  my_side := case when me = g.white then 'w' else 'b' end;
  if p.side <> my_side then
    raise exception 'It''s not your move.';
  end if;
  if p_from !~ '^[a-h][1-8]$' or p_to !~ '^[a-h][1-8]$' then
    raise exception 'Pick a square on the board.';
  end if;
  fr := public.chess_sq(p_from);
  t := public.chess_sq(p_to);
  free := public.chess_free_for(me, null);
  select * into ok from public.chess_allowed(p, free) a
    where a.fr = fr and a.t = t and (a.promo is null or a.promo = coalesce(lower(p_promo), 'q'))
    limit 1;
  if ok.fr is null then
    if exists (select 1 from public.chess_legal(p) l where l.fr = fr and l.t = t) then
      raise exception 'That piece is resting: walk more to free it.';
    end if;
    raise exception 'That move isn''t allowed.';
  end if;
  over := public.chess_play(p_challenge_id, fr, t, ok.promo, me, false,
    translate('NBRQ', free, ''), ok.all_free);
  if over is null then
    if g.bot is not null then
      perform public.chess_bot_turn(p_challenge_id);
    else
      other := case when my_side = 'w' then g.black else g.white end;
      perform public.chess_notify(p_challenge_id, other, 'Hound Chess', public.chess_name(me) || ' moved. Your move.');
    end if;
  end if;
  -- 0244: a move (or the bot's answer) that ends it settles it now.
  perform public.chess_close(p_challenge_id);
  return public.chess_state(p_challenge_id);
end;
$$;
revoke execute on function public.chess_move(uuid, text, text, text) from public, anon;
grant execute on function public.chess_move(uuid, text, text, text) to authenticated;

create or replace function public.chess_resign(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  g public.chess_games;
begin
  select * into g from public.chess_games where challenge_id = p_challenge_id for update;
  if g.challenge_id is null or me is null or me not in (g.white, coalesce(g.black, g.white)) then
    raise exception 'You''re not playing in this game.';
  end if;
  if g.status <> 'active' then
    raise exception 'This game isn''t on.';
  end if;
  perform public.chess_finish(p_challenge_id, case when me = g.white then 'black' else 'white' end, 'resign');
  -- 0244: settled now, not on the challenge's last day.
  perform public.chess_close(p_challenge_id);
  return public.chess_state(p_challenge_id);
end;
$$;
revoke execute on function public.chess_resign(uuid) from public, anon;
grant execute on function public.chess_resign(uuid) to authenticated;

create or replace function public.chess_tick()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in select g.challenge_id from public.chess_games g where g.status = 'active' loop
    perform public.chess_tick_game(r.challenge_id);
    -- 0244: a second missed turn ends it: settle it now.
    perform public.chess_close(r.challenge_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.chess_tick() from public, anon, authenticated;

-- The ones already over.
do $$
declare
  r record;
begin
  for r in
    select g.challenge_id, g.ended_at from public.chess_games g join public.challenges c on c.id = g.challenge_id
    where g.status = 'final' and c.score_settled_at is null
  loop
    update public.challenges set ends_at = least(ends_at, coalesce(r.ended_at, now())) where id = r.challenge_id;
    perform public.settle_challenge_score_core(r.challenge_id);
  end loop;
end;
$$;
