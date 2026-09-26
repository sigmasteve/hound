-- Hound: Tic-Tac-Go's game state — see 0056_tictacgo_challenge_kind.sql
-- for the enum value this depends on (must already be committed).
--
-- Two players, one shared 3x3 board. Each square carries its own goal
-- ("Hit 5K steps", "30-min strength"…), drawn at creation from one
-- difficulty's pool (src/challenges/tictacgo.ts). On your turn you do
-- some activity, then claim any open square whose goal it meets; that
-- places your mark and passes the turn. Three in a row wins, a full
-- board is a draw.
--
-- Same trust model as Bingo's manual link (0053): whether the activity
-- really met a square's goal is checked on the device against its own
-- HealthKit/Health Connect data — the server can't see that data. What
-- the server does own is everything that makes it a fair game: whose
-- turn it is, that a square is only claimed once, the 24-hour turn
-- limit, and win/draw detection. Like Tag's tag_rounds (0045), the table
-- has no write policies at all; every write goes through the
-- security-definer functions below.
--
-- When a game ends (win or full board) the challenge's own ends_at is
-- pulled in to now(), so every existing "is this challenge finished"
-- check in the app (board.ts's isChallengeFinished, the Challenges
-- list, Home) treats it as finished without a Tic-Tac-Go special case.
-- A game still going when ends_at arrives on its own is a draw
-- ('time_up'), settled lazily by tictacgo_settle.
--
-- Run this once, after 0056 (as its own, separately committed
-- transaction), in the SQL Editor. Push notifications need the
-- send-tictacgo-notification Edge Function deployed and the same vault
-- 'service_role_key' secret 0010/0048 use; without them, notifications
-- silently no-op and the game itself still works.

create table public.tictacgo_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  difficulty text not null check (difficulty in ('easy', 'medium', 'advanced')),
  -- Goal ids, one per square, row by row (index 1 = top-left). Their
  -- meaning lives in src/challenges/tictacgo.ts's TICTACGO_GOALS.
  goals text[] not null check (array_length(goals, 1) = 9),
  -- Who claimed each square, same indexing as goals; null = open.
  marks uuid[] not null default array_fill(null::uuid, array[9]),
  -- Null until the second player joins and the coin flip happens.
  x_user_id uuid references public.profiles (id),
  o_user_id uuid references public.profiles (id),
  turn_user_id uuid references public.profiles (id),
  -- Only activity after this moment counts toward a claim, and the turn
  -- passes to the other player 24 hours after it.
  turn_started_at timestamptz,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'won', 'draw')),
  winner_user_id uuid references public.profiles (id),
  -- The three winning square indexes (1-based), for highlighting.
  winning_line int[],
  ended_reason text check (ended_reason in ('three_in_a_row', 'board_full', 'time_up')),
  updated_at timestamptz not null default now()
);

alter table public.tictacgo_games enable row level security;

create policy "Participants can view their Tic-Tac-Go game"
  on public.tictacgo_games for select
  to authenticated
  using (
    exists (
      select 1 from public.challenge_participants cp
      where cp.challenge_id = tictacgo_games.challenge_id and cp.user_id = auth.uid()
    )
  );

-- Fires the push for a game event. Wrapped so a notification failure
-- (pg_net missing, no vault secret, network) never rolls back the move
-- that triggered it — same reasoning as 0048's tag notifications.
create or replace function public.tictacgo_notify(p_kind text, p_challenge_id uuid, p_recipient uuid, p_actor uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://vaypjksgpuuopqvurcus.supabase.co/functions/v1/send-tictacgo-notification',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'kind', p_kind,
      'challenge_id', p_challenge_id,
      'recipient_id', p_recipient,
      'actor_id', p_actor
    )
  );
exception when others then
  null;
end;
$$;

-- Internal only: Postgres grants EXECUTE to PUBLIC by default, which
-- would let any signed-in user push arbitrary notifications through RPC.
revoke execute on function public.tictacgo_notify(text, uuid, uuid, uuid) from public, anon, authenticated;

-- The creator stores the board right after creating the challenge (and
-- can re-store it to reshuffle) — only while nobody else has joined.
create or replace function public.tictacgo_setup(p_challenge_id uuid, p_difficulty text, p_goals text[])
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  existing_status text;
begin
  if not exists (
    select 1 from public.challenges c
    where c.id = p_challenge_id and c.kind = 'tictacgo' and c.created_by = caller
  ) then
    raise exception 'Only the creator can set up this Tic-Tac-Go board.';
  end if;
  if p_difficulty not in ('easy', 'medium', 'advanced') then
    raise exception 'Unknown difficulty.';
  end if;
  if coalesce(array_length(p_goals, 1), 0) != 9
    or (select count(distinct g) from unnest(p_goals) g) != 9
    or exists (select 1 from unnest(p_goals) g where g is null or g !~ '^[a-z0-9_]+$')
  then
    raise exception 'A board needs 9 different goals.';
  end if;

  select status into existing_status from public.tictacgo_games where challenge_id = p_challenge_id;
  if existing_status is not null and existing_status != 'waiting' then
    raise exception 'This game has already started — the board can''t change now.';
  end if;

  insert into public.tictacgo_games (challenge_id, difficulty, goals)
    values (p_challenge_id, p_difficulty, p_goals)
    on conflict (challenge_id) do update
      set difficulty = excluded.difficulty, goals = excluded.goals, updated_at = now();
end;
$$;

grant execute on function public.tictacgo_setup(uuid, text, text[]) to authenticated;

-- Exactly two players: refuse a third join outright, whichever way it
-- arrives (invite acceptance is a plain insert — see
-- supabaseChallenges.ts's acceptChallengeInvite).
create or replace function public.tictacgo_before_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (select 1 from public.challenges c where c.id = new.challenge_id and c.kind = 'tictacgo')
    and (select count(*) from public.challenge_participants cp where cp.challenge_id = new.challenge_id) >= 2
  then
    raise exception 'This Tic-Tac-Go game already has two players.';
  end if;
  return new;
end;
$$;

create trigger tictacgo_before_join
  before insert on public.challenge_participants
  for each row execute procedure public.tictacgo_before_join();

-- The second player joining starts the game: a coin flip picks X, and X
-- moves first. The first turn can't start before the challenge itself
-- does (CreateScreen's "Starts: Tomorrow").
create or replace function public.tictacgo_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  p1 uuid;
  p2 uuid;
  x_player uuid;
  o_player uuid;
  challenge_start timestamptz;
begin
  if not exists (
    select 1 from public.tictacgo_games g where g.challenge_id = new.challenge_id and g.status = 'waiting'
  ) then
    return new;
  end if;
  if (select count(*) from public.challenge_participants cp where cp.challenge_id = new.challenge_id) != 2 then
    return new;
  end if;

  select min(cp.user_id::text)::uuid, max(cp.user_id::text)::uuid into p1, p2
    from public.challenge_participants cp where cp.challenge_id = new.challenge_id;
  if random() < 0.5 then
    x_player := p1; o_player := p2;
  else
    x_player := p2; o_player := p1;
  end if;
  select starts_at into challenge_start from public.challenges where id = new.challenge_id;

  update public.tictacgo_games
    set x_user_id = x_player,
        o_user_id = o_player,
        turn_user_id = x_player,
        turn_started_at = greatest(now(), challenge_start),
        status = 'active',
        updated_at = now()
    where challenge_id = new.challenge_id;

  -- Whoever just joined is already looking at the app; only tell X when
  -- that's the other player.
  if x_player != new.user_id then
    perform public.tictacgo_notify('started', new.challenge_id, x_player, new.user_id);
  end if;
  return new;
end;
$$;

create trigger tictacgo_after_join
  after insert on public.challenge_participants
  for each row execute procedure public.tictacgo_after_join();

-- Callable by any participant (the app calls it on load); a no-op unless
-- the challenge has run out (a draw) or the current turn has passed its
-- 24 hours (the turn goes to the other player, with a fresh 24 hours).
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

-- Claim a square (0-8, row by row). The caller's device has already
-- checked the square's goal against activity since turn_started_at.
-- Returns the game's status after the move.
--
-- Deliberately doesn't call tictacgo_settle itself: a late claim is
-- refused with an exception, and that would roll back any turn-pass the
-- settle had just made in the same transaction. The app calls
-- tictacgo_settle on its own (on load, and right before every claim),
-- so the pass is always persisted separately.
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
