-- 0258: Undo in Hound Chess, and Bullseye's compound bow sooner.
--
-- Chess (Steve, 23 Nov 2026: "an undo that appears for the first 5
-- seconds of a move, better than a confirmation"): chess_undo takes back
-- your last move within a few seconds of making it (the app shows Undo for
-- 5; the server allows 10 for a slow connection), as long as the game
-- isn't over and the other player hasn't moved since. Against the bot,
-- its instant reply comes off too. Each undo is logged for Admin
-- (admin_chess_undo_overview).
--
-- Bullseye: the compound bow unlocks at 50,000 steps in the game (was
-- 80,000).
--
-- Run this once, after 0001-0257, in the SQL Editor.

update public.bullseye_bows set unlock_steps = 50000 where id = 'compound';

create table if not exists public.chess_undos (
  id bigserial primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  ply int not null,
  bot boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists chess_undos_at on public.chess_undos (created_at desc);
alter table public.chess_undos enable row level security;
revoke all on public.chess_undos from anon, authenticated;

create or replace function public.chess_undo(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  g public.chess_games;
  last_m public.chess_moves;
  mine public.chess_moves;
  back_to int;
  v_fen text;
begin
  select * into g from public.chess_games where challenge_id = p_challenge_id for update;
  if g.challenge_id is null or me is null or me not in (coalesce(g.white, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(g.black, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'You''re not playing in this game.';
  end if;
  if g.status <> 'active' then
    raise exception 'This game is over: no taking back.';
  end if;
  select * into last_m from public.chess_moves where challenge_id = p_challenge_id order by ply desc limit 1;
  if last_m.id is null then
    raise exception 'No move to take back.';
  end if;
  if g.bot is not null and last_m.by_user is null and last_m.ply > 1 then
    -- The bot answered at once: your move is the one before it.
    select * into mine from public.chess_moves where challenge_id = p_challenge_id and ply = last_m.ply - 1;
  else
    mine := last_m;
  end if;
  if mine.id is null or mine.by_user is distinct from me or mine.auto then
    raise exception 'Too late: they''ve moved.';
  end if;
  if mine.created_at < now() - interval '10 seconds' then
    raise exception 'Too late to take it back.';
  end if;
  back_to := mine.ply - 1;
  select m.fen_after into v_fen from public.chess_moves m where m.challenge_id = p_challenge_id and m.ply = back_to;
  delete from public.chess_moves where challenge_id = p_challenge_id and ply > back_to;
  update public.chess_games
    set fen = coalesce(v_fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'),
        plies = back_to, turn_started_at = now()
    where challenge_id = p_challenge_id;
  insert into public.chess_undos (challenge_id, user_id, ply, bot) values (p_challenge_id, me, mine.ply, g.bot is not null);
  return public.chess_state(p_challenge_id);
end;
$$;
revoke execute on function public.chess_undo(uuid) from public, anon;
grant execute on function public.chess_undo(uuid) to authenticated;

-- Admin → Games → Hound Chess: how often Undo is used.
create or replace function public.admin_chess_undo_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'undos_7d', (select count(*) from public.chess_undos u where u.created_at > now() - interval '7 days'),
    'people_7d', (select count(distinct u.user_id) from public.chess_undos u where u.created_at > now() - interval '7 days'),
    'people_ever', (select count(distinct u.user_id) from public.chess_undos u),
    'bot_7d', (select count(*) from public.chess_undos u where u.bot and u.created_at > now() - interval '7 days'),
    'moves_7d', (select count(*) from public.chess_moves m where m.by_user is not null and not m.auto and m.created_at > now() - interval '7 days'));
end;
$$;
revoke execute on function public.admin_chess_undo_overview() from public, anon;
grant execute on function public.admin_chess_undo_overview() to authenticated;
