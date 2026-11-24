-- 0259: a chess clock in the stand (Steve, 24 Nov 2026: "a clock of how
-- long each player is on the screen like in professional chess"). Each
-- side's time is the sum of its turns: a move's time runs from the move
-- before it (or the game's start, for White's first) to when it was made.
-- The side to move ticks from then on. chess_clock reads it; an Undo
-- (0258) gives the time back with the move.
--
-- Run this once, after 0001-0258, in the SQL Editor.

alter table public.chess_games add column if not exists started_at timestamptz;

-- When a game goes live (a friend joins, or a bot game is set up).
create or replace function public.chess_mark_start()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'active' and new.started_at is null
     and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    new.started_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.chess_mark_start() from public, anon, authenticated;
drop trigger if exists chess_mark_start on public.chess_games;
create trigger chess_mark_start before insert or update of status on public.chess_games
  for each row execute function public.chess_mark_start();

-- Games already going: White's first move counts from itself (0 s).
update public.chess_games g
  set started_at = coalesce((select min(m.created_at) from public.chess_moves m where m.challenge_id = g.challenge_id), g.turn_started_at, g.created_at)
  where g.started_at is null and g.status <> 'waiting';

create or replace function public.chess_clock(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  g public.chess_games;
  w numeric := 0;
  b numeric := 0;
  last_at timestamptz;
  last_side text;
  m record;
begin
  select * into g from public.chess_games where challenge_id = p_challenge_id;
  if g.challenge_id is null or me is null
     or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me) then
    raise exception 'You''re not playing in this game.';
  end if;
  last_at := coalesce(g.started_at, g.created_at);
  last_side := 'b';
  for m in select x.side, x.created_at from public.chess_moves x where x.challenge_id = p_challenge_id order by x.ply loop
    if m.side = 'w' then
      w := w + greatest(0, extract(epoch from m.created_at - last_at));
    else
      b := b + greatest(0, extract(epoch from m.created_at - last_at));
    end if;
    last_at := m.created_at;
    last_side := m.side;
  end loop;
  return jsonb_build_object(
    'w', round(w), 'b', round(b),
    -- Who's on the clock now (null when it isn't running), since when, and
    -- the server's time, so the phone can tick it without drifting.
    'running', case when g.status = 'active' then case when last_side = 'w' then 'b' else 'w' end end,
    'since', case when g.status = 'active' then last_at end,
    'now', now());
end;
$$;
revoke execute on function public.chess_clock(uuid) from public, anon;
grant execute on function public.chess_clock(uuid) to authenticated;
