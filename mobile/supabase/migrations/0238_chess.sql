-- Hound: Hound Chess (0237 adds the kind). Mockup:
-- claude.ai/artifact/HfDqdw7FaXZmCeDy68pJcX (Chess: your move, and the
-- puzzle of the day).
--
-- Real chess, one on one with a friend or against the Hound bot (Easy,
-- Medium or Hard), where your steps today decide which pieces can move:
--
--   pawns, king   always
--   knights and bishops at 3,000 steps
--   rooks         at 6,000
--   the queen     at 9,000, or after a 20-minute workout
--
-- In check, or when no free piece has a move, every piece is free. The
-- creator plays White. 24 hours a move: run out and Hound plays a careful
-- move for you; miss the next one too and the game's lost. It ends on
-- mate, a resignation, stalemate, a dead position or fifty moves without a
-- capture, or on the challenge's last day, decided on the pieces left
-- (level is a draw). A win is 35 points and Admin's win Bones (fewer
-- against the bot), a draw 15, a loss 5.
--
-- The puzzle of the day, for everyone: a mate in one that opens at 5,000
-- steps, three tries, 5 Bones for the first, 2 after.
--
-- The rules are checked here, in SQL (chess_legal; perft-tested in 128).
-- Pushes through send-golf-notification's 'chess' kind (worded here).
-- Every number is Admin's (chess_settings).
--
-- Run this once, after 0237 (committed on its own), in the SQL Editor.
-- Then redeploy send-golf-notification.

-- ── The rules of chess ──
--
-- A position is a FEN string; chess_pos is it unpacked: b holds the 64
-- squares (b[sq + 1], sq = rank * 8 + file, a1 = 0, h8 = 63), uppercase
-- white, lowercase black, '.' empty.

create type public.chess_pos as (b text[], side text, castle text, ep int, half int, full_no int);

create or replace function public.chess_sq(p_name text)
returns int language sql immutable as $$
  select (ascii(substr(p_name, 1, 1)) - 97) + (substr(p_name, 2, 1)::int - 1) * 8;
$$;

create or replace function public.chess_sq_name(p_sq int)
returns text language sql immutable as $$
  select chr(97 + p_sq % 8) || (p_sq / 8 + 1)::text;
$$;

create or replace function public.chess_parse(p_fen text)
returns public.chess_pos
language plpgsql
immutable
as $$
declare
  parts text[] := string_to_array(trim(p_fen), ' ');
  rows text[] := string_to_array(parts[1], '/');
  b text[] := array_fill('.'::text, array[64]);
  i int;
  j int;
  f int;
  r int;
  c text;
  p public.chess_pos;
begin
  for i in 1 .. 8 loop
    r := 8 - i;
    f := 0;
    for j in 1 .. length(rows[i]) loop
      c := substr(rows[i], j, 1);
      if c ~ '[1-8]' then
        f := f + c::int;
      else
        b[r * 8 + f + 1] := c;
        f := f + 1;
      end if;
    end loop;
  end loop;
  p.b := b;
  p.side := coalesce(parts[2], 'w');
  p.castle := coalesce(parts[3], '-');
  p.ep := case when coalesce(parts[4], '-') = '-' then null else public.chess_sq(parts[4]) end;
  p.half := coalesce(parts[5], '0')::int;
  p.full_no := coalesce(parts[6], '1')::int;
  return p;
end;
$$;

create or replace function public.chess_fen(p public.chess_pos)
returns text
language plpgsql
immutable
as $$
declare
  out text := '';
  r int;
  f int;
  n int;
  c text;
begin
  for r in reverse 7 .. 0 loop
    n := 0;
    for f in 0 .. 7 loop
      c := p.b[r * 8 + f + 1];
      if c = '.' then
        n := n + 1;
      else
        if n > 0 then out := out || n; n := 0; end if;
        out := out || c;
      end if;
    end loop;
    if n > 0 then out := out || n; end if;
    if r > 0 then out := out || '/'; end if;
  end loop;
  return out || ' ' || p.side || ' ' || coalesce(nullif(p.castle, ''), '-') || ' ' ||
         coalesce(public.chess_sq_name(p.ep), '-') || ' ' || p.half || ' ' || p.full_no;
end;
$$;

-- Whether square p_sq is attacked by side p_by ('w' or 'b').
create or replace function public.chess_attacked(b text[], p_sq int, p_by text)
returns boolean
language plpgsql
immutable
as $$
declare
  r int := p_sq / 8;
  f int := p_sq % 8;
  w boolean := p_by = 'w';
  kn int[] := array[1, 2, 2, 1, -1, -2, -2, -1];
  kf int[] := array[2, 1, -1, -2, -2, -1, 1, 2];
  dr int[] := array[1, -1, 0, 0, 1, 1, -1, -1];
  df int[] := array[0, 0, 1, -1, 1, -1, 1, -1];
  i int;
  rr int;
  ff int;
  c text;
  pr int;
  lp text := case when p_by = 'w' then 'P' else 'p' end;
  ln text := case when p_by = 'w' then 'N' else 'n' end;
  lk text := case when p_by = 'w' then 'K' else 'k' end;
  lines text[] := case when p_by = 'w' then array['R', 'Q'] else array['r', 'q'] end;
  diags text[] := case when p_by = 'w' then array['B', 'Q'] else array['b', 'q'] end;
begin
  -- Pawns: a white pawn attacks up the board.
  pr := case when w then r - 1 else r + 1 end;
  if pr between 0 and 7 then
    if f > 0 and b[pr * 8 + f - 1 + 1] = lp then return true; end if;
    if f < 7 and b[pr * 8 + f + 1 + 1] = lp then return true; end if;
  end if;
  for i in 1 .. 8 loop
    rr := r + kn[i]; ff := f + kf[i];
    if rr between 0 and 7 and ff between 0 and 7 and b[rr * 8 + ff + 1] = ln then return true; end if;
    rr := r + dr[i]; ff := f + df[i];
    if rr between 0 and 7 and ff between 0 and 7 and b[rr * 8 + ff + 1] = lk then return true; end if;
  end loop;
  -- Sliders: rooks and queens along the lines, bishops and queens on the diagonals.
  for i in 1 .. 8 loop
    rr := r + dr[i]; ff := f + df[i];
    while rr between 0 and 7 and ff between 0 and 7 loop
      c := b[rr * 8 + ff + 1];
      if c <> '.' then
        if i <= 4 and c = any (lines) then return true; end if;
        if i > 4 and c = any (diags) then return true; end if;
        exit;
      end if;
      rr := rr + dr[i]; ff := ff + df[i];
    end loop;
  end loop;
  return false;
end;
$$;

create or replace function public.chess_color(c text)
returns text language sql immutable as $$
  select case when c = '.' or c is null then null when c = upper(c) then 'w' else 'b' end;
$$;

-- Every pseudo-legal move (castling fully checked): from, to, promotion.
create or replace function public.chess_pseudo(p public.chess_pos)
returns table (fr int, t int, promo text)
language plpgsql
immutable
as $$
declare
  w boolean := p.side = 'w';
  opp text := case when p.side = 'w' then 'b' else 'w' end;
  sq int;
  r int;
  f int;
  c text;
  u text;
  dir int := case when p.side = 'w' then 1 else -1 end;
  start_r int := case when p.side = 'w' then 1 else 6 end;
  last_r int := case when p.side = 'w' then 7 else 0 end;
  kn int[] := array[1, 2, 2, 1, -1, -2, -2, -1];
  kf int[] := array[2, 1, -1, -2, -2, -1, 1, 2];
  dr int[] := array[1, -1, 0, 0, 1, 1, -1, -1];
  df int[] := array[0, 0, 1, -1, 1, -1, 1, -1];
  i int;
  rr int;
  ff int;
  x text;
  df2 int;
  pr text;
  kc text := case when p.side = 'w' then 'K' else 'k' end;
  qc text := case when p.side = 'w' then 'Q' else 'q' end;
  rk text := case when p.side = 'w' then 'R' else 'r' end;
  home int := case when p.side = 'w' then 4 else 60 end;
begin
  for sq in 0 .. 63 loop
    c := p.b[sq + 1];
    continue when c = '.' or public.chess_color(c) <> p.side;
    r := sq / 8; f := sq % 8; u := upper(c);
    if u = 'P' then
      rr := r + dir;
      if rr between 0 and 7 and p.b[rr * 8 + f + 1] = '.' then
        if rr = last_r then
          foreach pr in array array['q', 'r', 'b', 'n'] loop fr := sq; t := rr * 8 + f; promo := pr; return next; end loop;
        else
          fr := sq; t := rr * 8 + f; promo := null; return next;
          if r = start_r and p.b[(r + 2 * dir) * 8 + f + 1] = '.' then
            fr := sq; t := (r + 2 * dir) * 8 + f; promo := null; return next;
          end if;
        end if;
      end if;
      foreach df2 in array array[-1, 1] loop
        ff := f + df2;
        continue when ff < 0 or ff > 7 or rr < 0 or rr > 7;
        x := p.b[rr * 8 + ff + 1];
        if (x <> '.' and public.chess_color(x) = opp) or (p.ep is not null and p.ep = rr * 8 + ff) then
          if rr = last_r then
            foreach pr in array array['q', 'r', 'b', 'n'] loop fr := sq; t := rr * 8 + ff; promo := pr; return next; end loop;
          else
            fr := sq; t := rr * 8 + ff; promo := null; return next;
          end if;
        end if;
      end loop;
    elsif u = 'N' or u = 'K' then
      for i in 1 .. 8 loop
        if u = 'N' then rr := r + kn[i]; ff := f + kf[i]; else rr := r + dr[i]; ff := f + df[i]; end if;
        continue when rr < 0 or rr > 7 or ff < 0 or ff > 7;
        x := p.b[rr * 8 + ff + 1];
        if x = '.' or public.chess_color(x) = opp then
          fr := sq; t := rr * 8 + ff; promo := null; return next;
        end if;
      end loop;
      if u = 'K' and sq = home and not public.chess_attacked(p.b, sq, opp) then
        -- Castling: the rook home, the squares between empty, and the king
        -- not passing through check.
        if position(kc in p.castle) > 0
           and p.b[sq + 1 + 1] = '.' and p.b[sq + 2 + 1] = '.' and p.b[sq + 3 + 1] = rk
           and not public.chess_attacked(p.b, sq + 1, opp) and not public.chess_attacked(p.b, sq + 2, opp) then
          fr := sq; t := sq + 2; promo := null; return next;
        end if;
        if position(qc in p.castle) > 0
           and p.b[sq - 1 + 1] = '.' and p.b[sq - 2 + 1] = '.' and p.b[sq - 3 + 1] = '.' and p.b[sq - 4 + 1] = rk
           and not public.chess_attacked(p.b, sq - 1, opp) and not public.chess_attacked(p.b, sq - 2, opp) then
          fr := sq; t := sq - 2; promo := null; return next;
        end if;
      end if;
    else
      for i in (case when u = 'B' then 5 else 1 end) .. (case when u = 'R' then 4 else 8 end) loop
        rr := r + dr[i]; ff := f + df[i];
        while rr between 0 and 7 and ff between 0 and 7 loop
          x := p.b[rr * 8 + ff + 1];
          if x = '.' then
            fr := sq; t := rr * 8 + ff; promo := null; return next;
          else
            if public.chess_color(x) = opp then
              fr := sq; t := rr * 8 + ff; promo := null; return next;
            end if;
            exit;
          end if;
          rr := rr + dr[i]; ff := ff + df[i];
        end loop;
      end loop;
    end if;
  end loop;
end;
$$;

create or replace function public.chess_apply(p public.chess_pos, p_fr int, p_t int, p_promo text default null)
returns public.chess_pos
language plpgsql
immutable
as $$
declare
  q public.chess_pos := p;
  c text := p.b[p_fr + 1];
  u text := upper(c);
  cap text := p.b[p_t + 1];
  w boolean := p.side = 'w';
  dir int := case when p.side = 'w' then 1 else -1 end;
begin
  q.b[p_t + 1] := c;
  q.b[p_fr + 1] := '.';
  if u = 'P' and p.ep is not null and p_t = p.ep then
    q.b[p_t - dir * 8 + 1] := '.';
    cap := 'p';
  end if;
  if u = 'P' and (p_t / 8 = 7 or p_t / 8 = 0) then
    q.b[p_t + 1] := case when w then upper(coalesce(p_promo, 'q')) else lower(coalesce(p_promo, 'q')) end;
  end if;
  if u = 'K' and abs(p_t - p_fr) = 2 then
    if p_t > p_fr then
      q.b[p_fr + 1 + 1] := q.b[p_fr + 3 + 1]; q.b[p_fr + 3 + 1] := '.';
    else
      q.b[p_fr - 1 + 1] := q.b[p_fr - 4 + 1]; q.b[p_fr - 4 + 1] := '.';
    end if;
  end if;
  if u = 'K' then
    q.castle := replace(replace(q.castle, case when w then 'K' else 'k' end, ''), case when w then 'Q' else 'q' end, '');
  end if;
  if p_fr = 0 or p_t = 0 then q.castle := replace(q.castle, 'Q', ''); end if;
  if p_fr = 7 or p_t = 7 then q.castle := replace(q.castle, 'K', ''); end if;
  if p_fr = 56 or p_t = 56 then q.castle := replace(q.castle, 'q', ''); end if;
  if p_fr = 63 or p_t = 63 then q.castle := replace(q.castle, 'k', ''); end if;
  if q.castle = '' then q.castle := '-'; end if;
  q.ep := case when u = 'P' and abs(p_t - p_fr) = 16 then p_fr + dir * 8 end;
  q.half := case when u = 'P' or cap <> '.' then 0 else p.half + 1 end;
  q.full_no := p.full_no + case when w then 0 else 1 end;
  q.side := case when w then 'b' else 'w' end;
  return q;
end;
$$;

create or replace function public.chess_king(b text[], p_side text)
returns int language sql immutable as $$
  select array_position(b, case when p_side = 'w' then 'K' else 'k' end) - 1;
$$;

create or replace function public.chess_in_check(p public.chess_pos)
returns boolean language sql immutable as $$
  select public.chess_attacked(p.b, public.chess_king(p.b, p.side), case when p.side = 'w' then 'b' else 'w' end);
$$;

-- The legal moves: pseudo-legal ones that don't leave your king in check.
create or replace function public.chess_legal(p public.chess_pos)
returns table (fr int, t int, promo text)
language sql
immutable
as $$
  select m.fr, m.t, m.promo
  from public.chess_pseudo(p) m
  cross join lateral (select public.chess_apply(p, m.fr, m.t, m.promo) as q) a
  where not public.chess_attacked((a.q).b, public.chess_king((a.q).b, p.side), case when p.side = 'w' then 'b' else 'w' end);
$$;

create or replace function public.chess_has_move(p public.chess_pos)
returns boolean language sql immutable as $$ select exists (select 1 from public.chess_legal(p)); $$;

create or replace function public.chess_value(c text)
returns int language sql immutable as $$
  select case upper(coalesce(c, '.')) when 'P' then 1 when 'N' then 3 when 'B' then 3 when 'R' then 5 when 'Q' then 9 else 0 end;
$$;

-- White's material minus Black's.
create or replace function public.chess_material(b text[])
returns int language sql immutable as $$
  select coalesce(sum(case when public.chess_color(x) = 'w' then public.chess_value(x) else -public.chess_value(x) end), 0)::int
  from unnest(b) x where x <> '.';
$$;

-- Only kings, or a king and one knight or bishop against a bare king.
create or replace function public.chess_dead(b text[])
returns boolean language sql immutable as $$
  select count(*) filter (where upper(x) in ('P', 'R', 'Q')) = 0 and count(*) filter (where upper(x) in ('N', 'B')) <= 1
  from unnest(b) x where x <> '.';
$$;

-- What a position is now: 'mate', 'stalemate', 'dead', 'fifty' or null.
create or replace function public.chess_over(p public.chess_pos)
returns text language sql immutable as $$
  select case
    when not public.chess_has_move(p) then case when public.chess_in_check(p) then 'mate' else 'stalemate' end
    when public.chess_dead(p.b) then 'dead'
    when p.half >= 100 then 'fifty'
  end;
$$;

-- ── Settings ──

create table public.chess_settings (
  id boolean primary key default true,
  constraint chess_settings_singleton check (id),
  knight_bishop_steps int not null default 3000 check (knight_bishop_steps between 0 and 50000),
  rook_steps int not null default 6000 check (rook_steps between 0 and 50000),
  queen_steps int not null default 9000 check (queen_steps between 0 and 50000),
  queen_workout_min int not null default 20 check (queen_workout_min between 0 and 300),
  move_hours int not null default 24 check (move_hours between 1 and 168),
  win_bones int not null default 25 check (win_bones between 0 and 500),
  bot_win_bones int not null default 10 check (bot_win_bones between 0 and 500),
  puzzle_steps int not null default 5000 check (puzzle_steps between 0 and 50000),
  puzzle_tries int not null default 3 check (puzzle_tries between 1 and 10),
  puzzle_bones_first int not null default 5 check (puzzle_bones_first between 0 and 100),
  puzzle_bones_later int not null default 2 check (puzzle_bones_later between 0 and 100),
  updated_at timestamptz not null default now()
);
insert into public.chess_settings (id) values (true);
alter table public.chess_settings enable row level security;
create policy "Anyone signed in can read the Chess settings"
  on public.chess_settings for select to authenticated using (true);
create policy "Only admins can change the Chess settings"
  on public.chess_settings for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
revoke all on public.chess_settings from anon;
revoke insert, delete on public.chess_settings from authenticated;

-- ── Tables ──

create table public.chess_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  white uuid references public.profiles (id) on delete set null,
  black uuid references public.profiles (id) on delete set null,
  bot text check (bot in ('easy', 'medium', 'hard')),
  fen text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  status text not null default 'waiting' check (status in ('waiting', 'active', 'final')),
  result text check (result in ('white', 'black', 'draw')),
  method text check (method in ('mate', 'resign', 'timeout', 'stalemate', 'dead', 'fifty', 'time')),
  turn_started_at timestamptz,
  white_misses int not null default 0,
  black_misses int not null default 0,
  plies int not null default 0,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table public.chess_moves (
  id bigserial primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  ply int not null,
  side text not null check (side in ('w', 'b')),
  by_user uuid references public.profiles (id) on delete set null,
  piece text not null,
  fr text not null,
  t text not null,
  promo text,
  captured text,
  gave_check boolean not null default false,
  -- Played by Hound when the 24 hours ran out.
  auto boolean not null default false,
  -- The mover's pieces resting at the time ('Q', 'RQ'...), and whether
  -- everything was free anyway (in check, or nothing free could move).
  locked text not null default '',
  all_free boolean not null default false,
  fen_after text not null,
  created_at timestamptz not null default now(),
  unique (challenge_id, ply)
);
create index chess_moves_recent on public.chess_moves (created_at);

-- The phone's own step count for a day (daily_step_totals is kept by UTC day).
create table public.chess_claims (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  steps int not null check (steps between 0 and 150000),
  primary key (user_id, day)
);

create table public.chess_puzzles (
  id int primary key,
  fen text not null,
  theme text not null
);

create table public.chess_puzzle_days (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  puzzle_id int not null references public.chess_puzzles (id),
  tries int not null default 0,
  solved_at timestamptz,
  first_try boolean,
  bones int not null default 0,
  primary key (user_id, day)
);

alter table public.chess_games enable row level security;
alter table public.chess_moves enable row level security;
alter table public.chess_claims enable row level security;
alter table public.chess_puzzles enable row level security;
alter table public.chess_puzzle_days enable row level security;
revoke all on public.chess_games, public.chess_moves, public.chess_claims, public.chess_puzzles, public.chess_puzzle_days from anon;
revoke insert, update, delete on public.chess_games, public.chess_moves, public.chess_claims, public.chess_puzzles, public.chess_puzzle_days from authenticated;
-- Everything is read through chess_state and chess_puzzle_state.

-- Mate in one, white to move. Any mating move solves it.
insert into public.chess_puzzles (id, fen, theme) values
  (1, '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 'Back rank'),
  (2, '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', 'Smothered'),
  (3, 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1', 'The weak f7'),
  (4, 'k7/8/1K6/8/8/8/8/7R w - - 0 1', 'Rook and king'),
  (5, '7k/8/5N2/8/8/8/8/6RK w - - 0 1', 'Knight and rook'),
  (6, '6k1/5ppp/8/8/8/8/8/4Q1K1 w - - 0 1', 'Back rank'),
  (7, '1k6/ppp5/8/8/8/8/PPP5/1K1R4 w - - 0 1', 'Back rank'),
  (8, 'kr6/pp6/8/1N6/8/8/8/K7 w - - 0 1', 'Smothered'),
  (9, 'k7/8/1K6/8/8/8/8/7Q w - - 0 1', 'Queen and king'),
  (10, 'rnbqkbnr/ppppp2p/5p2/6p1/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1', 'Open diagonal'),
  (11, '7k/6pp/8/8/8/8/8/1Q4K1 w - - 0 1', 'Back rank');

-- ── Helpers ──

create or replace function public.chess_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$ select public.horse_name(p_user); $$;

create or replace function public.chess_steps(p_user uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select greatest(
    coalesce((select d.steps from public.daily_step_totals d where d.user_id = p_user and d.day = p_day), 0),
    coalesce((select max(ps.steps) from public.progress_snapshots ps where ps.user_id = p_user and ps.day = p_day), 0),
    coalesce((select c.steps from public.chess_claims c where c.user_id = p_user and c.day = p_day), 0));
$$;

create or replace function public.chess_workout_min(p_user uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce(sum(coalesce(w.duration_min, w.logged_min, 0)), 0)::int from public.workout_history w
  where w.user_id = p_user
    and w.occurred_at >= (p_day - 1)::timestamp at time zone 'utc'
    and w.occurred_at < (p_day + 2)::timestamp at time zone 'utc'
    and (w.occurred_at at time zone coalesce((select p.time_zone from public.profiles p where p.id = p_user), 'America/New_York'))::date = p_day;
$$;

-- The piece letters free to move on these steps: P and K always.
create or replace function public.chess_free_letters(p_steps int, p_workout int)
returns text
language sql
stable
security definer set search_path = public
as $$
  select 'PK'
    || case when p_steps >= s.knight_bishop_steps then 'NB' else '' end
    || case when p_steps >= s.rook_steps then 'R' else '' end
    || case when p_steps >= s.queen_steps or p_workout >= s.queen_workout_min then 'Q' else '' end
  from public.chess_settings s;
$$;

-- A player's free letters today; a bot's from its level.
create or replace function public.chess_free_for(p_user uuid, p_bot text)
returns text
language sql
stable
security definer set search_path = public
as $$
  select case
    when p_user is null then public.chess_free_letters(case p_bot when 'easy' then 4000 when 'medium' then 7000 else 10000 end, 0)
    else public.chess_free_letters(public.chess_steps(p_user, public.soccer_today(p_user)), public.chess_workout_min(p_user, public.soccer_today(p_user)))
  end;
$$;

-- The moves a side may make now: its free pieces' legal moves; everything
-- when in check or when no free piece can move.
create or replace function public.chess_allowed(p public.chess_pos, p_free text)
returns table (fr int, t int, promo text, all_free boolean)
language plpgsql
stable
as $$
declare
  any_free boolean;
begin
  if public.chess_in_check(p) then
    return query select l.fr, l.t, l.promo, true from public.chess_legal(p) l;
    return;
  end if;
  select exists (select 1 from public.chess_legal(p) l where position(upper(p.b[l.fr + 1]) in p_free) > 0) into any_free;
  if not any_free then
    return query select l.fr, l.t, l.promo, true from public.chess_legal(p) l;
    return;
  end if;
  return query select l.fr, l.t, l.promo, false from public.chess_legal(p) l where position(upper(p.b[l.fr + 1]) in p_free) > 0;
end;
$$;

create or replace function public.chess_notify(p_challenge_id uuid, p_recipient uuid, p_title text, p_message text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_recipient is not null then
    perform public.golf_notify('chess', p_challenge_id, p_recipient, jsonb_build_object('title', p_title, 'message', p_message));
  end if;
end;
$$;

-- The Hound bot's choice among the allowed moves: easy plays loosely,
-- medium sees captures, mates and pieces left hanging, hard the same with
-- less noise.
create or replace function public.chess_bot_pick(p public.chess_pos, p_level text, p_free text)
returns table (fr int, t int, promo text)
language plpgsql
volatile
as $$
declare
  m record;
  q public.chess_pos;
  opp text := case when p.side = 'w' then 'b' else 'w' end;
  cap int;
  val int;
  sc numeric;
  best numeric := -1e9;
  noise numeric := case p_level when 'easy' then 40 when 'medium' then 6 else 1.5 end;
  careful boolean := p_level <> 'easy';
begin
  for m in select * from public.chess_allowed(p, p_free) a where a.promo is null or a.promo = 'q' loop
    q := public.chess_apply(p, m.fr, m.t, m.promo);
    cap := public.chess_value(p.b[m.t + 1]) + case when upper(p.b[m.fr + 1]) = 'P' and p.ep is not null and m.t = p.ep then 1 else 0 end;
    val := public.chess_value(p.b[m.fr + 1]);
    sc := cap * 10 + random() * noise;
    if m.promo is not null then sc := sc + 70; end if;
    if careful then
      if public.chess_attacked(q.b, m.t, opp) then
        sc := sc - val * 9;
      end if;
      if public.chess_in_check(q) then
        sc := sc + 2;
        if not public.chess_has_move(q) then
          sc := sc + 1000;
        end if;
      end if;
    end if;
    if sc > best then
      best := sc;
      fr := m.fr; t := m.t; promo := m.promo;
    end if;
  end loop;
  if best > -1e9 then
    return next;
  end if;
end;
$$;

-- ── Playing a move ──

create or replace function public.chess_finish(p_challenge_id uuid, p_result text, p_method text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.chess_games;
  line text;
begin
  update public.chess_games set status = 'final', result = p_result, method = p_method, ended_at = now(), turn_started_at = null
    where challenge_id = p_challenge_id and status <> 'final'
    returning * into g;
  if g.challenge_id is null then
    return;
  end if;
  line := case p_method
    when 'mate' then 'Checkmate.'
    when 'resign' then 'A resignation.'
    when 'timeout' then 'Two missed turns.'
    when 'stalemate' then 'Stalemate: a draw.'
    when 'dead' then 'Not enough left to mate: a draw.'
    when 'fifty' then 'Fifty moves without a capture: a draw.'
    else 'Time''s up: decided on the pieces left.' end;
  perform public.chess_notify(p_challenge_id, g.white, 'Hound Chess',
    case when p_result = 'white' then 'You won! ' when p_result = 'black' then 'You lost. ' else '' end || line);
  perform public.chess_notify(p_challenge_id, g.black, 'Hound Chess',
    case when p_result = 'black' then 'You won! ' when p_result = 'white' then 'You lost. ' else '' end || line);
end;
$$;

-- Plays one move for the side to move (checked by the caller), and ends
-- the game if it's over. Returns the new position's verdict (null: on).
create or replace function public.chess_play(p_challenge_id uuid, p_fr int, p_t int, p_promo text, p_by uuid, p_auto boolean, p_locked text, p_all_free boolean)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  g public.chess_games;
  p public.chess_pos;
  q public.chess_pos;
  over text;
  cap text;
begin
  select * into g from public.chess_games where challenge_id = p_challenge_id for update;
  p := public.chess_parse(g.fen);
  cap := nullif(p.b[p_t + 1], '.');
  if cap is null and upper(p.b[p_fr + 1]) = 'P' and p.ep is not null and p_t = p.ep then
    cap := case when p.side = 'w' then 'p' else 'P' end;
  end if;
  q := public.chess_apply(p, p_fr, p_t, p_promo);
  insert into public.chess_moves (challenge_id, ply, side, by_user, piece, fr, t, promo, captured, gave_check, auto, locked, all_free, fen_after)
  values (p_challenge_id, g.plies + 1, p.side, p_by, upper(p.b[p_fr + 1]), public.chess_sq_name(p_fr), public.chess_sq_name(p_t),
          case when upper(p.b[p_fr + 1]) = 'P' and (p_t / 8 = 7 or p_t / 8 = 0) then coalesce(p_promo, 'q') end,
          upper(cap), public.chess_in_check(q), coalesce(p_auto, false), coalesce(p_locked, ''), coalesce(p_all_free, false), public.chess_fen(q));
  update public.chess_games
    set fen = public.chess_fen(q), plies = plies + 1, turn_started_at = now(),
        white_misses = case when p.side = 'w' and not coalesce(p_auto, false) then 0 else white_misses end,
        black_misses = case when p.side = 'b' and not coalesce(p_auto, false) then 0 else black_misses end
    where challenge_id = p_challenge_id;
  over := public.chess_over(q);
  if over = 'mate' then
    perform public.chess_finish(p_challenge_id, case when p.side = 'w' then 'white' else 'black' end, 'mate');
  elsif over is not null then
    perform public.chess_finish(p_challenge_id, 'draw', over);
  end if;
  return over;
end;
$$;

-- The bot's reply, if it's the bot's turn.
create or replace function public.chess_bot_turn(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.chess_games;
  p public.chess_pos;
  m record;
  free text;
begin
  select * into g from public.chess_games where challenge_id = p_challenge_id;
  if g.status <> 'active' or g.bot is null then
    return;
  end if;
  p := public.chess_parse(g.fen);
  if p.side <> 'b' then
    return;
  end if;
  free := public.chess_free_for(null, g.bot);
  select * into m from public.chess_bot_pick(p, g.bot, free);
  if m.fr is null then
    return;
  end if;
  perform public.chess_play(p_challenge_id, m.fr, m.t, m.promo, null, false, '', false);
end;
$$;

-- ── Setting up and joining ──

create or replace function public.chess_setup(p_challenge_id uuid, p_bot text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'chess' or c.created_by is distinct from auth.uid() then
    raise exception 'Only whoever made this game can set it up.';
  end if;
  if p_bot is not null and p_bot not in ('easy', 'medium', 'hard') then
    raise exception 'The Hound bot is Easy, Medium or Hard.';
  end if;
  if exists (select 1 from public.chess_games g where g.challenge_id = p_challenge_id) then
    raise exception 'This game is already set up.';
  end if;
  insert into public.chess_games (challenge_id, white, bot, status, turn_started_at)
  values (p_challenge_id, auth.uid(), p_bot, case when p_bot is null then 'waiting' else 'active' end, case when p_bot is not null then now() end);
end;
$$;
revoke execute on function public.chess_setup(uuid, text) from public, anon;
grant execute on function public.chess_setup(uuid, text) to authenticated;

create or replace function public.chess_before_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  g public.chess_games;
begin
  if not exists (select 1 from public.challenges c where c.id = new.challenge_id and c.kind::text = 'chess') then
    return new;
  end if;
  select * into g from public.chess_games where challenge_id = new.challenge_id;
  if g.challenge_id is null or new.user_id = g.white then
    return new;
  end if;
  if g.bot is not null then
    raise exception 'This game is against the Hound bot.';
  end if;
  if g.black is not null or g.status <> 'waiting' then
    raise exception 'Hound Chess is one on one.';
  end if;
  return new;
end;
$$;
create trigger chess_before_join before insert on public.challenge_participants
  for each row execute procedure public.chess_before_join();

create or replace function public.chess_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  g public.chess_games;
begin
  if not exists (select 1 from public.challenges c where c.id = new.challenge_id and c.kind::text = 'chess') then
    return new;
  end if;
  update public.chess_games set black = new.user_id, status = 'active', turn_started_at = now()
    where challenge_id = new.challenge_id and status = 'waiting' and bot is null and black is null and white is distinct from new.user_id
    returning * into g;
  if g.challenge_id is not null then
    perform public.chess_notify(new.challenge_id, g.white, 'Hound Chess', public.chess_name(new.user_id) || ' is in. You''re White: your move.');
  end if;
  return new;
end;
$$;
create trigger chess_after_join after insert on public.challenge_participants
  for each row execute procedure public.chess_after_join();

-- ── What the app does ──

create or replace function public.chess_claim_steps(p_steps int)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_steps is null or p_steps < 0 or p_steps > 150000 then
    raise exception 'Invalid steps.';
  end if;
  insert into public.chess_claims (user_id, day, steps) values (me, public.soccer_today(me), p_steps)
  on conflict (user_id, day) do update set steps = greatest(public.chess_claims.steps, excluded.steps);
end;
$$;
revoke execute on function public.chess_claim_steps(int) from public, anon;
grant execute on function public.chess_claim_steps(int) to authenticated;

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
  return public.chess_state(p_challenge_id);
end;
$$;
revoke execute on function public.chess_resign(uuid) from public, anon;
grant execute on function public.chess_resign(uuid) to authenticated;

-- ── The clock: missed turns and the last day ──

create or replace function public.chess_tick_game(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.chess_games;
  c public.challenges%rowtype;
  cfg public.chess_settings;
  p public.chess_pos;
  mover uuid;
  misses int;
  m record;
  mat int;
  over text;
begin
  select * into g from public.chess_games where challenge_id = p_challenge_id for update;
  if g.challenge_id is null or g.status <> 'active' then
    return;
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  select * into cfg from public.chess_settings;
  p := public.chess_parse(g.fen);
  if now() >= c.ends_at then
    mat := public.chess_material(p.b);
    perform public.chess_finish(p_challenge_id, case when mat > 0 then 'white' when mat < 0 then 'black' else 'draw' end, 'time');
    return;
  end if;
  mover := case when p.side = 'w' then g.white else g.black end;
  if mover is null or g.turn_started_at is null or now() < g.turn_started_at + make_interval(hours => cfg.move_hours) then
    return;
  end if;
  misses := case when p.side = 'w' then g.white_misses else g.black_misses end;
  if misses >= 1 then
    perform public.chess_finish(p_challenge_id, case when p.side = 'w' then 'black' else 'white' end, 'timeout');
    return;
  end if;
  -- Hound plays a careful move for them, with every piece.
  select * into m from public.chess_bot_pick(p, 'medium', 'PKNBRQ');
  if m.fr is null then
    return;
  end if;
  over := public.chess_play(p_challenge_id, m.fr, m.t, m.promo, null, true, '', true);
  update public.chess_games
    set white_misses = case when p.side = 'w' then white_misses + 1 else white_misses end,
        black_misses = case when p.side = 'b' then black_misses + 1 else black_misses end
    where challenge_id = p_challenge_id;
  perform public.chess_notify(p_challenge_id, mover, 'Hound Chess',
    'Your 24 hours ran out, so Hound moved for you. Miss the next one too and the game''s lost.');
  if over is null then
    if g.bot is not null then
      perform public.chess_bot_turn(p_challenge_id);
    else
      perform public.chess_notify(p_challenge_id, case when p.side = 'w' then g.black else g.white end, 'Hound Chess', 'Your move.');
    end if;
  end if;
end;
$$;
revoke execute on function public.chess_tick_game(uuid) from public, anon, authenticated;

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
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.chess_tick() from public, anon, authenticated;
select cron.schedule('hound-chess-tick', '17 * * * *', $$ select public.chess_tick(); $$);

-- ── What the app shows ──

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
  free := public.chess_free_letters(my_steps, my_wk);
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

-- ── Puzzle of the day ──

create or replace function public.chess_puzzle_streak(p_user uuid, p_day date)
returns int
language plpgsql
stable
security definer set search_path = public
as $$
declare
  d date := p_day;
  n int := 0;
begin
  if not exists (select 1 from public.chess_puzzle_days x where x.user_id = p_user and x.day = d and x.solved_at is not null) then
    d := d - 1;
  end if;
  while exists (select 1 from public.chess_puzzle_days x where x.user_id = p_user and x.day = d and x.solved_at is not null) loop
    n := n + 1;
    d := d - 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.chess_puzzle_streak(uuid, date) from public, anon, authenticated;

create or replace function public.chess_puzzle_state(p_steps int default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  day date;
  cfg public.chess_settings;
  steps int;
  pz public.chess_puzzles;
  pd public.chess_puzzle_days;
  is_open boolean;
  moves jsonb := '[]'::jsonb;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_steps is not null then
    perform public.chess_claim_steps(p_steps);
  end if;
  day := public.soccer_today(me);
  select * into cfg from public.chess_settings;
  steps := public.chess_steps(me, day);
  select * into pz from public.chess_puzzles
    where id = (select x.id from public.chess_puzzles x order by x.id
                offset ((day - date '2026-01-01') % (select count(*) from public.chess_puzzles)) limit 1);
  is_open := steps >= cfg.puzzle_steps;
  if is_open then
    insert into public.chess_puzzle_days (user_id, day, puzzle_id) values (me, day, pz.id) on conflict do nothing;
  end if;
  select * into pd from public.chess_puzzle_days x where x.user_id = me and x.day = day;
  if is_open and pd.solved_at is null and pd.tries < cfg.puzzle_tries then
    select coalesce(jsonb_agg(jsonb_build_object('from', public.chess_sq_name(l.fr), 'to', public.chess_sq_name(l.t), 'promo', l.promo)), '[]'::jsonb)
      into moves from public.chess_legal(public.chess_parse(pz.fen)) l;
  end if;
  return jsonb_build_object(
    'day', day,
    'open', is_open,
    'steps', steps,
    'need', cfg.puzzle_steps,
    'fen', case when is_open then pz.fen end,
    'theme', case when is_open then pz.theme end,
    'tries', coalesce(pd.tries, 0),
    'maxTries', cfg.puzzle_tries,
    'solved', pd.solved_at is not null,
    'firstTry', pd.first_try,
    'bones', coalesce(pd.bones, 0),
    'bonesFirst', cfg.puzzle_bones_first,
    'bonesLater', cfg.puzzle_bones_later,
    'streak', public.chess_puzzle_streak(me, day),
    'moves', moves
  );
end;
$$;
revoke execute on function public.chess_puzzle_state(int) from public, anon;
grant execute on function public.chess_puzzle_state(int) to authenticated;

create or replace function public.chess_puzzle_try(p_from text, p_to text, p_promo text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  day date := public.soccer_today(me);
  cfg public.chess_settings;
  pd public.chess_puzzle_days;
  p public.chess_pos;
  q public.chess_pos;
  fr int;
  t int;
  ok record;
  mate boolean;
  bones int := 0;
begin
  select * into cfg from public.chess_settings;
  select * into pd from public.chess_puzzle_days x where x.user_id = me and x.day = day for update;
  if pd.user_id is null then
    raise exception 'Today''s puzzle opens at % steps.', to_char(cfg.puzzle_steps, 'FM999,999');
  end if;
  if pd.solved_at is not null then
    raise exception 'Solved already: back tomorrow.';
  end if;
  if pd.tries >= cfg.puzzle_tries then
    raise exception 'No tries left today.';
  end if;
  if p_from !~ '^[a-h][1-8]$' or p_to !~ '^[a-h][1-8]$' then
    raise exception 'Pick a square on the board.';
  end if;
  p := public.chess_parse((select z.fen from public.chess_puzzles z where z.id = pd.puzzle_id));
  fr := public.chess_sq(p_from);
  t := public.chess_sq(p_to);
  select * into ok from public.chess_legal(p) l where l.fr = fr and l.t = t and (l.promo is null or l.promo = coalesce(lower(p_promo), 'q')) limit 1;
  if ok.fr is null then
    raise exception 'That move isn''t allowed.';
  end if;
  q := public.chess_apply(p, ok.fr, ok.t, ok.promo);
  mate := coalesce(public.chess_over(q) = 'mate', false);
  if mate then
    bones := case when pd.tries = 0 then cfg.puzzle_bones_first else cfg.puzzle_bones_later end;
    update public.chess_puzzle_days set tries = tries + 1, solved_at = now(), first_try = pd.tries = 0, bones = bones
      where user_id = me and chess_puzzle_days.day = day;
    if bones > 0 then
      update public.profiles set bones_balance = bones_balance + bones, bones_earned_total = bones_earned_total + bones where id = me;
    end if;
  else
    update public.chess_puzzle_days set tries = tries + 1 where user_id = me and chess_puzzle_days.day = day;
  end if;
  return jsonb_build_object('mate', mate, 'check', public.chess_in_check(q), 'fenAfter', public.chess_fen(q), 'bones', bones)
    || public.chess_puzzle_state(null);
end;
$$;
revoke execute on function public.chess_puzzle_try(text, text, text) from public, anon;
grant execute on function public.chess_puzzle_try(text, text, text) to authenticated;

-- The engine is the server's: nobody calls it directly.
revoke execute on function public.chess_sq(text), public.chess_sq_name(int), public.chess_parse(text), public.chess_fen(public.chess_pos),
  public.chess_attacked(text[], int, text), public.chess_color(text), public.chess_pseudo(public.chess_pos),
  public.chess_apply(public.chess_pos, int, int, text), public.chess_king(text[], text), public.chess_in_check(public.chess_pos),
  public.chess_legal(public.chess_pos), public.chess_has_move(public.chess_pos), public.chess_value(text), public.chess_material(text[]),
  public.chess_dead(text[]), public.chess_over(public.chess_pos), public.chess_name(uuid), public.chess_steps(uuid, date),
  public.chess_workout_min(uuid, date), public.chess_free_letters(int, int), public.chess_free_for(uuid, text),
  public.chess_allowed(public.chess_pos, text), public.chess_notify(uuid, uuid, text, text), public.chess_bot_pick(public.chess_pos, text, text),
  public.chess_finish(uuid, text, text), public.chess_play(uuid, int, int, text, uuid, boolean, text, boolean), public.chess_bot_turn(uuid),
  public.chess_before_join(), public.chess_after_join()
  from public, anon, authenticated;

-- ── Scoring (0236's, with Chess) ──

create or replace function public.settle_challenge_score_core(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  concluded boolean;
  hunt_fully_caught boolean := false;
  goal numeric;
  total numeric;
  ttt public.tictacgo_games%rowtype;
  rg public.rally_games%rowtype;
  sg public.soccer_games%rowtype;
  cg public.cricket_games%rowtype;
  bg public.baseball_games%rowtype;
  chg public.chess_games%rowtype;
  hg public.hoops_games%rowtype;
  xg public.horse_games%rowtype;
  xb public.bout_games%rowtype;
  hcfg public.hoops_config%rowtype;
  gg public.golf_games%rowtype;
  gcfg public.golf_config%rowtype;
  bones_trickle constant int := 5;
  bones_per_level constant int := 25;
  first_day date;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.score_settled_at is not null then
    return;
  end if;

  concluded := now() >= c.ends_at;

  if not concluded and c.kind = 'tag' and c.tag_mode is distinct from 'chase' then
    goal := case when c.distance_goal_unit = 'steps' then c.distance_goal_steps else c.distance_goal_mi end;
    if goal is not null then
      select coalesce(sum(case when c.distance_goal_unit = 'steps' then ps.steps else ps.distance_mi end), 0)
        into total
        from public.progress_snapshots ps
        where ps.challenge_id = p_challenge_id;
      if total >= goal then
        concluded := true;
      end if;
    end if;
  end if;

  -- A Journey ends the moment someone reaches the end of the course.
  if not concluded and c.kind = 'journey' and c.distance_goal_mi is not null then
    if exists (
      select 1 from public.progress_snapshots ps
      where ps.challenge_id = p_challenge_id
      group by ps.user_id
      having coalesce(sum(ps.distance_mi), 0) >= c.distance_goal_mi
    ) then
      concluded := true;
    end if;
  end if;

  if c.kind = 'hunt' then
    hunt_fully_caught :=
      exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.role in ('hunted', 'zombie'))
      and not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.role = 'hunted');
    if hunt_fully_caught then
      concluded := true;
    end if;
  end if;

  if c.kind = 'tictacgo' then
    select * into ttt from public.tictacgo_games where challenge_id = p_challenge_id;
    concluded := found and ttt.status in ('won', 'draw');
  end if;

  -- A Cricket match ends once the second innings is over: that can be
  -- well before ends_at, or the morning after it.
  if c.kind = 'cricket' then
    perform public.cricket_advance(p_challenge_id);
    select * into cg from public.cricket_games where challenge_id = p_challenge_id;
    concluded := found and cg.status = 'final';
  end if;

  -- A Tag chase (0181) ends once its last day is settled, the morning
  -- after ends_at.
  if c.kind = 'tag' and c.tag_mode = 'chase' then
    perform public.tag_chase_advance(p_challenge_id);
    concluded := (select count(*) from public.tag_chase_days d where d.challenge_id = p_challenge_id) >= c.duration_days;
  end if;

  -- A Baseball game ends after its last inning, which can be days past
  -- ends_at in extra innings, or before it on a skipped bottom half.
  if c.kind = 'baseball' then
    perform public.baseball_advance(p_challenge_id);
    select * into bg from public.baseball_games where challenge_id = p_challenge_id;
    concluded := found and bg.status = 'final';
  end if;

  -- A Hoops game ends after its last quarter, or its last overtime: the
  -- morning after ends_at at the earliest.
  if c.kind::text = 'hoops' then
    perform public.hoops_advance(p_challenge_id);
    select * into hg from public.hoops_games where challenge_id = p_challenge_id;
    concluded := found and hg.status = 'final';
  end if;

  -- H-O-R-S-E ends when someone spells the word, or after its last day.
  if c.kind::text = 'horse' then
    perform public.horse_advance(p_challenge_id);
    select * into xg from public.horse_games where challenge_id = p_challenge_id;
    concluded := found and xg.status = 'final';
  end if;

  -- 0225: a Hound Bout ends with a KO, or after its last round.
  if c.kind::text = 'bout' then
    perform public.bout_advance(p_challenge_id);
    select * into xb from public.bout_games where challenge_id = p_challenge_id;
    concluded := found and xb.status = 'final';
  end if;

  -- Golf ends once everyone's holed out, or at ends_at with every
  -- unfinished hole at par + 4 (hands-off walks played first).
  if c.kind::text = 'golf' then
    perform public.golf_advance(p_challenge_id, false);
    select * into gg from public.golf_games where challenge_id = p_challenge_id;
    concluded := found and gg.status = 'final';
  end if;

  -- A Soccer match ends after its last day is resolved, which can be the
  -- morning after ends_at — never before.
  if c.kind = 'soccer' then
    perform public.soccer_advance(p_challenge_id);
    select * into sg from public.soccer_games where challenge_id = p_challenge_id;
    concluded := found and sg.status = 'final';
  end if;

  -- A Rally ends on two games, or on time with the leading team winning.
  if c.kind = 'rally' then
    perform public.rally_settle(p_challenge_id);
    select * into rg from public.rally_games where challenge_id = p_challenge_id;
    concluded := found and rg.status in ('won', 'draw');
  end if;

  -- 0238: Hound Chess ends on mate, a resignation, two missed turns or a
  -- draw; or on the last day, decided on the pieces left.
  if c.kind::text = 'chess' then
    perform public.chess_tick_game(p_challenge_id);
    select * into chg from public.chess_games where challenge_id = p_challenge_id;
    concluded := found and chg.status = 'final';
  end if;

  if not concluded then
    return;
  end if;

  update public.challenges set score_settled_at = now() where id = p_challenge_id;

  if c.kind = 'hunt' then
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select
      cp.user_id,
      p_challenge_id,
      'hunt_result',
      case cp.role
        when 'hunter' then case when hunt_fully_caught then 40 else 10 end
        when 'zombie' then 10
        when 'hunted' then 30
        else 5
      end,
      25,
      bones_trickle
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;

  elsif c.kind = 'tag' and c.tag_mode = 'chase' then
    -- Placed by points (+3 a tag, +1 a day got away), fewer days as IT
    -- breaking a tie, and scored like a Step Race.
    with ranked as (
      select s.user_id, row_number() over (order by s.points desc, s.days_it asc) as rnk
      from public.tag_chase_standings(p_challenge_id) s
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'tag_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
      25,
      bones_trickle
    from ranked;

  elsif c.kind = 'tag' then
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select cp.user_id, p_challenge_id, 'tag_result', 10 + least(cp.tags_made, 5) * 5, 25, bones_trickle
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;

  elsif c.kind = 'distance' then
    goal := case when c.distance_goal_unit = 'steps' then c.distance_goal_steps else c.distance_goal_mi end;
    select coalesce(sum(case when c.distance_goal_unit = 'steps' then ps.steps else ps.distance_mi end), 0)
      into total
      from public.progress_snapshots ps
      where ps.challenge_id = p_challenge_id;
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select cp.user_id, p_challenge_id, 'distance_result',
      case when goal is not null and total >= goal then 15 else 10 end,
      25,
      bones_trickle
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;

  elsif c.kind = 'journey' then
    -- Furthest along the course places first, like a Step Race by
    -- miles; finishing the course is worth a little more on top.
    with totals as (
      select cp.user_id, coalesce(sum(ps.distance_mi), 0) as total_mi
      from public.challenge_participants cp
      left join public.progress_snapshots ps on ps.challenge_id = cp.challenge_id and ps.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    ),
    ranked as (
      select user_id, total_mi, row_number() over (order by total_mi desc) as rnk from totals
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'journey_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end
        + case when c.distance_goal_mi is not null and total_mi >= c.distance_goal_mi then 10 else 0 end,
      25,
      bones_trickle
    from ranked;

  elsif c.kind = 'steps' then
    with totals as (
      -- Not named `total` — see 0058's own comment on why that collides
      -- with this function's declared `total` variable.
      select cp.user_id, coalesce(sum(ps.steps), 0) as total_steps
      from public.challenge_participants cp
      left join public.progress_snapshots ps on ps.challenge_id = cp.challenge_id and ps.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    ),
    ranked as (
      select user_id, row_number() over (order by total_steps desc) as rnk from totals
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'steps_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
      25,
      bones_trickle
    from ranked;

  elsif c.kind = 'streak' and c.daily_goal_steps is not null then
    -- Every day from the challenge's first day (or the day they joined,
    -- if later) through its last day. The join day is taken in UTC,
    -- which never makes someone west of UTC answer for a day before
    -- they joined.
    first_day := coalesce(c.start_day, (c.starts_at at time zone 'America/New_York')::date);
    with survival as (
      select cp.user_id,
        not exists (
          select 1
          from generate_series(
            greatest(first_day, (cp.joined_at at time zone 'UTC')::date)::timestamp,
            (first_day + c.duration_days - 1)::timestamp,
            interval '1 day'
          ) d
          left join public.progress_snapshots ps
            on ps.challenge_id = p_challenge_id and ps.user_id = cp.user_id and ps.day = d::date
          where coalesce(ps.steps, 0) < c.daily_goal_steps
        ) as survived
      from public.challenge_participants cp
      where cp.challenge_id = p_challenge_id
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'streak_result',
      case when survived then 40 else 10 end,
      case when survived then 30 else 25 end,
      bones_trickle
    from survival;

  elsif c.kind = 'bingo' and c.bingo_card_type = 'hound' then
    -- Squares count only if they're on the player's card. BINGOs are
    -- placed in the order Hound saw them.
    with st as (
      select cp.user_id, bc.bingo_at, bc.blackout_at,
        count(bp.category) filter (where bp.category = any (bc.squares)) as n
      from public.challenge_participants cp
      left join public.bingo_cards bc on bc.challenge_id = cp.challenge_id and bc.user_id = cp.user_id
      left join public.bingo_progress bp on bp.challenge_id = cp.challenge_id and bp.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id, bc.bingo_at, bc.blackout_at
    ),
    placed as (
      select st.*, case when st.bingo_at is not null then rank() over (order by st.bingo_at) end as place
      from st
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'bingo_result',
      case
        when blackout_at is not null then 40
        when place = 1 then 35
        when place = 2 then 30
        when place = 3 then 25
        when bingo_at is not null then 20
        else least(n, 15)
      end,
      25 + n::int,
      bones_trickle
    from placed;

  elsif c.kind = 'bingo' then
    with counts as (
      select cp.user_id, count(bp.category) as n
      from public.challenge_participants cp
      left join public.bingo_progress bp on bp.challenge_id = cp.challenge_id and bp.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'bingo_result',
      case when n = 9 then 40 else n * 4 end,
      25 + n,
      bones_trickle
    from counts;

  elsif c.kind = 'tictacgo' then
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select uid, p_challenge_id, 'tictacgo_result',
      case
        when ttt.status = 'draw' then 15
        when uid = ttt.winner_user_id then 35
        else 5
      end,
      25,
      bones_trickle
    from (values (ttt.x_user_id), (ttt.o_user_id)) as players (uid);

  elsif c.kind = 'rally' then
    -- The winning team scores like a Tic-Tac-Go winner, a draw on time
    -- like a Tic-Tac-Go draw.
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'rally_result',
      case
        when rg.status = 'draw' then 15
        when p.team = rg.winner_team then 35
        else 5
      end,
      25,
      bones_trickle
    from public.rally_players p
    where p.challenge_id = p_challenge_id and p.joined and p.user_id is not null;

  elsif c.kind = 'cricket' then
    -- The winning side scores like a Soccer winner, a tie like a draw.
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'cricket_result',
      case
        when cg.winner_team is null then 15
        when p.team = cg.winner_team then 35
        else 5
      end,
      25,
      bones_trickle
    from public.cricket_players p
    where p.challenge_id = p_challenge_id and p.joined and p.user_id is not null;

  elsif c.kind = 'baseball' then
    -- The winning side scores like a Soccer winner, a tie like a draw.
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'baseball_result',
      case
        when bg.winner_team is null then 15
        when p.team = bg.winner_team then 35
        else 5
      end,
      25,
      bones_trickle
    from public.baseball_players p
    where p.challenge_id = p_challenge_id and p.joined and p.user_id is not null;

  elsif c.kind::text = 'hoops' then
    -- The winning side scores like a Soccer winner and gets Admin's win
    -- Bones; everyone who played gets the play Bones.
    select * into hcfg from public.hoops_config where id;
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'hoops_result',
      case
        when hg.winner_team is null then 15
        when p.team = hg.winner_team then 35
        else 5
      end,
      25,
      bones_trickle + coalesce(hcfg.play_bones, 10)
        + case when p.team = hg.winner_team then coalesce(hcfg.win_bones, 40) else 0 end
    from public.hoops_players p
    where p.challenge_id = p_challenge_id and p.joined and p.user_id is not null;

  elsif c.kind::text = 'horse' then
    select * into hcfg from public.hoops_config where id;
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select cp.user_id, p_challenge_id, 'horse_result',
      case
        when xg.winner is null then 15
        when cp.user_id = xg.winner then 35
        else 5
      end,
      25,
      bones_trickle + coalesce(hcfg.play_bones, 10)
        + case when cp.user_id = xg.winner then coalesce(hcfg.win_bones, 40) else 0 end
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;

  elsif c.kind::text = 'bout' then
    -- Like H-O-R-S-E: the winner gets Hoops' win Bones, both the play Bones.
    select * into hcfg from public.hoops_config where id;
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select cp.user_id, p_challenge_id, 'bout_result',
      case
        when xb.winner is null then 15
        when cp.user_id = xb.winner then 35
        else 5
      end,
      25,
      bones_trickle + coalesce(hcfg.play_bones, 10)
        + case when cp.user_id = xb.winner then coalesce(hcfg.win_bones, 40) else 0 end
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;

  elsif c.kind::text = 'golf' then
    -- The winner scores like a Soccer winner and gets Admin's win Bones;
    -- everyone who finished every hole gets the play Bones, and each
    -- player their skins (a round alone has neither win nor skins).
    select * into gcfg from public.golf_config where id;
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'golf_result',
      case
        when gg.winner is null then 15
        when p.user_id = gg.winner then 35
        else 5
      end,
      25,
      bones_trickle
        + case when p.finished_at is not null then coalesce(gg.finish_bones, gcfg.play_bones, 10) else 0 end
        -- In a global game the prizes are the places (pay_global_places).
        + case when p.user_id = gg.winner and not c.is_global then coalesce(gcfg.win_bones, 40) else 0 end
        + public.golf_skin_bones(gg.skins, p.user_id)
        + p.sponsor_bones
    from public.golf_players p
    where p.challenge_id = p_challenge_id and p.joined
      -- A global game pays the field: whoever swung.
      and (not c.is_global
           or exists (select 1 from public.golf_shots sh where sh.challenge_id = p_challenge_id and sh.user_id = p.user_id));

  elsif c.kind = 'soccer' then
    -- The winning side scores like a Rally winner, a draw like a Rally draw.
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'soccer_result',
      case
        when sg.winner_team is null then 15
        when p.team = sg.winner_team then 35
        else 5
      end,
      25,
      bones_trickle
    from public.soccer_players p
    where p.challenge_id = p_challenge_id and p.joined and p.user_id is not null;

  elsif c.kind = 'seventyfive' then
    -- Total complete days (all 6 items true), not the reset-on-a-miss
    -- streak computeSeventyFiveStatus tracks client-side — same
    -- acceptable divergence Daily Streak's own "survived" scoring
    -- already has from its own richer client display: scoring reads a
    -- simpler, independently-derived signal from the same durable rows
    -- rather than replicating the display's own reset logic in SQL.
    with counts as (
      select cp.user_id,
        count(*) filter (
          where sc.workout1_done and sc.workout2_outdoor_done and sc.diet_done
            and sc.water_done and sc.reading_done and sc.photo_done
        ) as complete_days
      from public.challenge_participants cp
      left join public.seventyfive_checkins sc
        on sc.challenge_id = cp.challenge_id and sc.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'seventyfive_result', complete_days * 3, 25 + complete_days, bones_trickle
    from counts;

  elsif c.kind = 'checklist' then
    -- Complete days: every shared item ticked, and the person's own
    -- line too if they wrote one. Same shape as 75 Day above: total
    -- complete days, not the reset-on-a-miss streak the app shows.
    with days as (
      select ck.user_id, ck.day, count(distinct ck.item_id) as ticked
      from public.checklist_checkins ck
      where ck.challenge_id = p_challenge_id and ck.done
      group by ck.user_id, ck.day
    ),
    counts as (
      select cp.user_id,
        -- Every shared item, plus your own line from the day you wrote
        -- it (so a line added on day 10 doesn't undo days 1 to 9).
        count(d.day) filter (where d.ticked >= (
          select count(*) from public.checklist_items i
          where i.challenge_id = p_challenge_id
            and (i.owner_id is null
              or (i.owner_id = cp.user_id
                  and coalesce(i.from_day, (i.created_at at time zone 'utc')::date) <= d.day))
        )) as complete_days
      from public.challenge_participants cp
      left join days d on d.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'checklist_result', complete_days * 3, 25 + complete_days, bones_trickle
    from counts;

  elsif c.kind = 'houndopoly' then
    -- Every day rolled first, then richest wins: net worth is cash plus
    -- the price of every square owned. Places like a Step Race.
    perform public.houndopoly_advance(p_challenge_id);
    with worth as (
      select cp.user_id, public.houndopoly_net_worth(p_challenge_id, cp.user_id) as net
      from public.challenge_participants cp
      where cp.challenge_id = p_challenge_id
    ),
    ranked as (
      select user_id, rank() over (order by net desc) as rnk from worth
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'houndopoly_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
      25,
      bones_trickle
    from ranked;

  elsif c.kind = 'doors' then
    -- Most points wins, placed like a Step Race, and everyone gets the
    -- Bones for finishing. Every door's day is past by now, so each is
    -- counted as done, opened or missed.
    with ranked as (
      select b.user_id, rank() over (order by s.points desc, s.done desc) as rnk
      from public.challenge_participants b
      cross join lateral public.doors_points(p_challenge_id, b.user_id, public.doors_first_day(c) + c.duration_days) s
      where b.challenge_id = p_challenge_id
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'doors_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
      25,
      -- Everyone gets Admin's Bones for finishing, on top of the trickle.
      bones_trickle + coalesce((select d.finish_bones from public.doors_settings d), 25)
    from ranked;

  elsif c.kind::text = 'chess' then
    -- Like any one on one: a win 35, a draw 15, a loss 5; the winner gets
    -- Admin's win Bones (fewer against the bot).
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select u, p_challenge_id, 'chess_result',
      case when chg.result = 'draw' then 15 when (u = chg.white) = (chg.result = 'white') then 35 else 5 end,
      25,
      bones_trickle + case when chg.result <> 'draw' and (u = chg.white) = (chg.result = 'white')
                           then (select case when chg.bot is null then s.win_bones else s.bot_win_bones end from public.chess_settings s) else 0 end
    from (values (chg.white), (chg.black)) as players (u)
    where u is not null;

  elsif c.kind::text = 'roulette' then
    -- 0236: every day resolved and the rest of each ride banked; most
    -- banked wins, placed like a Step Race. Everyone gets the finishing
    -- Bones and one a banked point (Admin's cap); the winner's hound the
    -- Lucky Bandana.
    perform public.roulette_finish(p_challenge_id);
    with ranked as (
      select cp.user_id, coalesce(rp.banked, 0) as banked, rank() over (order by coalesce(rp.banked, 0) desc) as rnk
      from public.challenge_participants cp
      left join public.roulette_players rp on rp.challenge_id = cp.challenge_id and rp.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
    ),
    paid as (
      insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
      select r.user_id, p_challenge_id, 'roulette_result',
        case r.rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
        25,
        bones_trickle + s.finish_bones + least(s.bones_cap, r.banked * s.bones_per_point)
      from ranked r cross join public.roulette_settings s
      returning user_id
    )
    insert into public.kennel_purchases (user_id, item_id, bones)
    select r.user_id, 'bandana_lucky', 0 from ranked r where r.rnk = 1 and r.banked > 0
    on conflict do nothing;

  elsif c.kind = 'packs' then
    -- Every day played first, then the pack with the most ground wins (a
    -- tie shares it). Its members get Admin's win Bones, everyone else the
    -- finishing Bones, all on top of the trickle.
    perform public.pack_advance(p_challenge_id);
    with held as (
      select p as pack, (select count(*) from public.pack_territories t where t.challenge_id = p_challenge_id and t.owner = p) as n
      from unnest(array['wolves', 'goldens', 'collies', 'beagles']) p
    ),
    top as (select max(n) as n from held)
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select m.user_id, p_challenge_id, 'packs_result',
      case when h.n = (select n from top) and h.n > 0 then 40 else 10 end,
      25,
      bones_trickle + case when h.n = (select n from top) and h.n > 0
        then coalesce((select s.win_bones from public.pack_settings s), 50)
        else coalesce((select s.finish_bones from public.pack_settings s), 20) end
    from public.pack_members m
    join held h on h.pack = m.pack
    join public.challenge_participants cp on cp.challenge_id = m.challenge_id and cp.user_id = m.user_id
    where m.challenge_id = p_challenge_id;

  else
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select cp.user_id, p_challenge_id, 'participation', 10, 25, bones_trickle
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;
  end if;

  -- Safe to read activity_events back by challenge_id alone: the
  -- score_settled_at guard above means a challenge is only ever settled
  -- once, so every row here was inserted by this exact call, not a mix
  -- with some earlier run.
  with events as (
    select user_id, score_points, xp_points, bones_points
    from public.activity_events
    where challenge_id = p_challenge_id
  ),
  per_user as (
    select
      e.user_id, e.score_points, e.xp_points, e.bones_points,
      public.level_for_xp(p.xp_total) as old_level,
      public.level_for_xp(p.xp_total + e.xp_points) as new_level
    from events e
    join public.profiles p on p.id = e.user_id
  )
  update public.profiles p
    set hound_score = p.hound_score + pu.score_points,
        xp_total = p.xp_total + pu.xp_points,
        bones_balance = p.bones_balance + pu.bones_points + (pu.new_level - pu.old_level) * bones_per_level,
        bones_earned_total = p.bones_earned_total + pu.bones_points + (pu.new_level - pu.old_level) * bones_per_level
    from per_user pu
    where p.id = pu.user_id;
end;
$$;
revoke execute on function public.settle_challenge_score_core(uuid) from public, anon, authenticated;

create or replace function public.settle_challenge_score(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  grace constant interval := interval '24 hours';
  min_players constant int := 2;
  players int;
  caller uuid := auth.uid();
  personal boolean;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.score_settled_at is not null then
    return;
  end if;

  -- A signed-in caller must be in the challenge. The scheduled job runs as
  -- the database and has no signed-in user.
  if caller is not null and not exists (
    select 1 from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id and cp.user_id = caller
  ) then
    return;
  end if;

  select count(*) into players
  from public.challenge_participants cp
  where cp.challenge_id = p_challenge_id;

  -- Played for your own effort, so one player is enough.
  personal := c.kind::text in ('seventyfive', 'bingo', 'checklist', 'roulette');

  -- Game-event kinds (a Journey, which ends when someone reaches the end
  -- of the course, and a Rally, which ends on two games) can end before
  -- ends_at; the core decides if they have.
  -- A Rally's or a Soccer match's other players may all be bots: its own
  -- state says whether it's over, whatever the participant count.
  -- Hound Chess (0238): its own state says when it's over; a game nobody
  -- joined closes unpaid after the grace.
  if c.kind::text = 'chess' then
    if not exists (select 1 from public.chess_games g where g.challenge_id = p_challenge_id and g.status <> 'waiting') then
      if now() >= c.ends_at + grace then
        update public.challenges set score_settled_at = now() where id = p_challenge_id;
      end if;
      return;
    end if;
    perform public.settle_challenge_score_core(p_challenge_id);
    return;
  end if;

  if c.kind::text in ('rally', 'soccer', 'cricket', 'baseball', 'hoops', 'golf') then
    perform public.settle_challenge_score_core(p_challenge_id);
    return;
  end if;

  -- H-O-R-S-E and the Hound Bout (0225) need their second player.
  if c.kind::text in ('horse', 'bout') then
    if players >= min_players then
      perform public.settle_challenge_score_core(p_challenge_id);
    elsif now() >= c.ends_at + grace then
      update public.challenges set score_settled_at = now() where id = p_challenge_id;
    end if;
    return;
  end if;

  if c.kind::text in ('hunt', 'tag', 'tictacgo', 'journey') then
    if players >= min_players then
      perform public.settle_challenge_score_core(p_challenge_id);
    elsif now() >= c.ends_at + grace then
      -- Never had an opponent: close it without paying anyone.
      update public.challenges set score_settled_at = now() where id = p_challenge_id;
    end if;
    return;
  end if;

  -- Time-based kinds wait for the grace period.
  if now() < c.ends_at + grace then
    return;
  end if;

  if players < min_players and not personal then
    -- Nobody to compete against: close it without paying anyone.
    update public.challenges set score_settled_at = now() where id = p_challenge_id;
    return;
  end if;

  perform public.settle_challenge_score_core(p_challenge_id);
end;
$$;
revoke execute on function public.settle_challenge_score(uuid) from public, anon;
grant execute on function public.settle_challenge_score(uuid) to authenticated;

-- ── Admin → Overview → Games → Hound Chess ──

create or replace function public.admin_chess_overview()
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
    'live', (select count(*) from public.chess_games g where g.status = 'active'),
    'waiting', (select count(*) from public.chess_games g where g.status = 'waiting'),
    'finished', (select count(*) from public.chess_games g where g.status = 'final'),
    'vsFriend', (select count(*) from public.chess_games g where g.bot is null),
    'vsBot', (select jsonb_build_object('easy', count(*) filter (where g.bot = 'easy'), 'medium', count(*) filter (where g.bot = 'medium'),
                                        'hard', count(*) filter (where g.bot = 'hard')) from public.chess_games g),
    'botRecord', (select jsonb_build_object('won', count(*) filter (where g.result = 'white'), 'lost', count(*) filter (where g.result = 'black'),
                                            'drawn', count(*) filter (where g.result = 'draw'))
                  from public.chess_games g where g.bot is not null and g.status = 'final'),
    'endings', (select coalesce(jsonb_object_agg(x.method, x.n), '{}'::jsonb) from (
                  select g.method, count(*) as n from public.chess_games g where g.status = 'final' group by g.method) x),
    'players7d', (select count(distinct m.by_user) from public.chess_moves m where m.created_at > now() - interval '7 days' and m.by_user is not null),
    'moves7d', (select count(*) from public.chess_moves m where m.created_at > now() - interval '7 days' and m.by_user is not null),
    'autoMoves7d', (select count(*) from public.chess_moves m where m.created_at > now() - interval '7 days' and m.auto),
    'restingMoves7d', (select count(*) from public.chess_moves m where m.created_at > now() - interval '7 days' and m.by_user is not null and m.locked <> '' and not m.all_free),
    'queenResting7d', (select count(*) from public.chess_moves m where m.created_at > now() - interval '7 days' and m.by_user is not null and position('Q' in m.locked) > 0),
    'puzzlesOpened7d', (select count(*) from public.chess_puzzle_days d where d.day > (now() at time zone 'America/New_York')::date - 7),
    'puzzlers7d', (select count(distinct d.user_id) from public.chess_puzzle_days d where d.day > (now() at time zone 'America/New_York')::date - 7),
    'puzzlesSolved7d', (select count(*) from public.chess_puzzle_days d where d.day > (now() at time zone 'America/New_York')::date - 7 and d.solved_at is not null),
    'puzzlesFirstTry7d', (select count(*) from public.chess_puzzle_days d where d.day > (now() at time zone 'America/New_York')::date - 7 and d.first_try),
    'puzzleBones', (select coalesce(sum(d.bones), 0) from public.chess_puzzle_days d),
    'settings', (select to_jsonb(x) - 'id' - 'updated_at' from public.chess_settings x)
  );
end;
$$;
revoke execute on function public.admin_chess_overview() from public, anon;
grant execute on function public.admin_chess_overview() to authenticated;
