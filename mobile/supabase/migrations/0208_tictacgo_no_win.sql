-- Hound: Tic-Tac-Go ends as soon as nobody can win (Steve's ask, Nov
-- 2026). Before, a game went on until the board was full or time ran
-- out, even when every line was already blocked: on a board like
--
--     .  X  O
--     O  X  X
--     X  O  .      (O to move)
--
-- X's only open line is the diagonal through the middle, and it needs
-- both corners, but O moves next and takes one. So it's a draw now.
--
-- tictacgo_can_win(marks, x, o, next) asks: taking turns from `next`,
-- can either player still complete any line? A line counts for a player
-- when the other has no mark on it; if it needs k more squares and E are
-- open, they get there when 2k - 1 <= E moving first, or 2k <= E moving
-- second (the other player's moves in between go elsewhere). A turn that
-- times out hands the move over without a mark; that isn't counted, as
-- it's not how a game is meant to be won.
--
-- tictacgo_claim_square (0057) ends the game with ended_reason 'no_win'
-- after the move that makes it so, and tictacgo_settle (0057; the app
-- calls it on load) ends any game already in that state, so games on now
-- finish the next time someone opens them. Both redefined from 0057,
-- their latest.
--
-- Run this once, after 0001-0207, in the SQL Editor.

alter table public.tictacgo_games drop constraint if exists tictacgo_games_ended_reason_check;
alter table public.tictacgo_games add constraint tictacgo_games_ended_reason_check
  check (ended_reason in ('three_in_a_row', 'board_full', 'time_up', 'no_win'));

create or replace function public.tictacgo_can_win(p_marks uuid[], p_x uuid, p_o uuid, p_next uuid)
returns boolean
language plpgsql
immutable
as $$
declare
  lines int[] := array[[1,2,3],[4,5,6],[7,8,9],[1,4,7],[2,5,8],[3,6,9],[1,5,9],[3,5,7]];
  line int[];
  open_n int := 0;
  p uuid;
  other uuid;
  need int;
  blocked boolean;
  i int;
begin
  for i in 1..9 loop
    if p_marks[i] is null then open_n := open_n + 1; end if;
  end loop;
  foreach line slice 1 in array lines loop
    foreach p in array array[p_x, p_o] loop
      continue when p is null;
      other := case when p = p_x then p_o else p_x end;
      need := 0;
      blocked := false;
      for i in 1..3 loop
        if p_marks[line[i]] is null then
          need := need + 1;
        elsif p_marks[line[i]] is distinct from p then
          blocked := true;
        end if;
      end loop;
      continue when blocked or need = 0;
      if (p = p_next and 2 * need - 1 <= open_n) or (p is distinct from p_next and 2 * need <= open_n) then
        return true;
      end if;
    end loop;
  end loop;
  return false;
end;
$$;

revoke execute on function public.tictacgo_can_win(uuid[], uuid, uuid, uuid) from public, anon;
grant execute on function public.tictacgo_can_win(uuid[], uuid, uuid, uuid) to authenticated;

create or replace function public.tictacgo_settle(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.tictacgo_games%rowtype;
  challenge_end timestamptz;
  next_player uuid;
begin
  select * into g from public.tictacgo_games where challenge_id = p_challenge_id for update;
  if not found or g.status != 'active' then
    return;
  end if;

  select ends_at into challenge_end from public.challenges where id = p_challenge_id;
  if now() >= challenge_end then
    update public.tictacgo_games
      set status = 'draw', ended_reason = 'time_up', turn_user_id = null, updated_at = now()
      where challenge_id = p_challenge_id;
    return;
  end if;

  -- 0208: a game already past winning (from before this rule) ends now.
  if not public.tictacgo_can_win(g.marks, g.x_user_id, g.o_user_id, g.turn_user_id) then
    update public.tictacgo_games
      set status = 'draw', ended_reason = 'no_win', turn_user_id = null, updated_at = now()
      where challenge_id = p_challenge_id;
    update public.challenges set ends_at = now() where id = p_challenge_id and ends_at > now();
    perform public.tictacgo_notify('draw', p_challenge_id, g.x_user_id, null);
    perform public.tictacgo_notify('draw', p_challenge_id, g.o_user_id, null);
    return;
  end if;

  if now() < g.turn_started_at + interval '24 hours' then
    return;
  end if;

  next_player := case when g.turn_user_id = g.x_user_id then g.o_user_id else g.x_user_id end;
  update public.tictacgo_games
    set turn_user_id = next_player, turn_started_at = now(), updated_at = now()
    where challenge_id = p_challenge_id;
  perform public.tictacgo_notify('timeout', p_challenge_id, next_player, g.turn_user_id);
end;
$$;

grant execute on function public.tictacgo_settle(uuid) to authenticated;

create or replace function public.tictacgo_claim_square(p_challenge_id uuid, p_square int)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  g public.tictacgo_games%rowtype;
  lines int[] := array[[1,2,3],[4,5,6],[7,8,9],[1,4,7],[2,5,8],[3,6,9],[1,5,9],[3,5,7]];
  line int[];
  win_line int[];
  opponent uuid;
  new_status text;
  challenge_end timestamptz;
begin
  select * into g from public.tictacgo_games where challenge_id = p_challenge_id for update;
  if not found then
    raise exception 'This game''s board isn''t set up yet.';
  end if;
  if g.status = 'waiting' then
    raise exception 'Waiting for your opponent to join.';
  end if;
  if g.status != 'active' then
    raise exception 'This game is over.';
  end if;
  select ends_at into challenge_end from public.challenges where id = p_challenge_id;
  if now() >= challenge_end then
    raise exception 'Time''s up — this game has ended.';
  end if;
  if g.turn_user_id is distinct from caller then
    raise exception 'It''s not your turn.';
  end if;
  if now() < g.turn_started_at then
    raise exception 'The game hasn''t started yet.';
  end if;
  if now() >= g.turn_started_at + interval '24 hours' then
    raise exception 'Your 24 hours ran out, so the turn passed to your opponent.';
  end if;
  if p_square is null or p_square < 0 or p_square > 8 then
    raise exception 'That square doesn''t exist.';
  end if;
  if g.marks[p_square + 1] is not null then
    raise exception 'That square is already taken.';
  end if;

  g.marks[p_square + 1] := caller;
  opponent := case when caller = g.x_user_id then g.o_user_id else g.x_user_id end;

  foreach line slice 1 in array lines loop
    if g.marks[line[1]] = caller and g.marks[line[2]] = caller and g.marks[line[3]] = caller then
      win_line := line;
      exit;
    end if;
  end loop;

  if win_line is not null then
    new_status := 'won';
    update public.tictacgo_games
      set marks = g.marks, status = 'won', winner_user_id = caller, winning_line = win_line,
          ended_reason = 'three_in_a_row', turn_user_id = null, updated_at = now()
      where challenge_id = p_challenge_id;
  elsif array_position(g.marks, null) is null then
    new_status := 'draw';
    update public.tictacgo_games
      set marks = g.marks, status = 'draw', ended_reason = 'board_full', turn_user_id = null, updated_at = now()
      where challenge_id = p_challenge_id;
  elsif not public.tictacgo_can_win(g.marks, g.x_user_id, g.o_user_id, opponent) then
    -- 0208: squares are left, but nobody can get three in a row any more.
    new_status := 'draw';
    update public.tictacgo_games
      set marks = g.marks, status = 'draw', ended_reason = 'no_win', turn_user_id = null, updated_at = now()
      where challenge_id = p_challenge_id;
  else
    new_status := 'active';
    update public.tictacgo_games
      set marks = g.marks, turn_user_id = opponent, turn_started_at = now(), updated_at = now()
      where challenge_id = p_challenge_id;
  end if;

  if new_status != 'active' then
    update public.challenges set ends_at = now() where id = p_challenge_id and ends_at > now();
  end if;

  perform public.tictacgo_notify(
    case new_status when 'won' then 'won' when 'draw' then 'draw' else 'your_turn' end,
    p_challenge_id,
    opponent,
    caller
  );
  return new_status;
end;
$$;

grant execute on function public.tictacgo_claim_square(uuid, int) to authenticated;
