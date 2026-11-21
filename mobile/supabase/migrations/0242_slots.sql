-- Hound: Paw Slots (0241 adds the kind). Mockup:
-- claude.ai/artifact/PQ5Sv4xveiiTj5T9o39Jzh.
--
-- A slot machine played on your steps:
--
--   spins       one every 500 steps on your own date, up to 20 a day, plus
--               2 for a 20-minute workout. Unused spins carry to tomorrow,
--               up to 10. Steps are the synced day's total or the phone's
--               own count (chess_claims, sent with slots_state), whichever
--               is more.
--   buying      more spins for Paw Coins: 3 a spin, up to 10 a day. A spin
--               wins back about 3 coins on average, so buying is close
--               to even: it's for the thrill, not a way up the board.
--   a press     1, 3 or 5 lines (the middle; top and bottom; the two
--               diagonals) at x1, x2, x3 or x5 a line: it uses lines x bet
--               spins, and each line pays on its own, times the bet.
--   the reels   three strips of 20 (slots_strip; the app draws the same
--               ones in the same order): 6 Paws, 5 Hydrants, 3 Treats, 2
--               Balls, a Bone, 2 Collars and a Golden Hound. The server
--               picks where each stops (random) and pays it; the app only
--               turns the reels to it.
--   paying      three Golden Hounds 250, three Collars 100, three Bones 50,
--               Balls 25, Treats 15, Hydrants 10, Paws 5; any two on the
--               left 2. The Collar is wild (not for the Golden Hound) and
--               doubles a win. Some win comes up about 3 presses in 8 on
--               one line, 7 in 9 on three and 17 in 20 on five (Steve's
--               numbers; the order of each strip sets the last two).
--
-- Paw Coins are won only on the machine, are only for this challenge and
-- never turn into Bones one for one. Nothing here takes money or Bones in.
--
-- When it ends: the pool is Admin's (2,500 Bones with 11 or more hounds,
-- 200 a hound below that; a Global's can be set when it's published),
-- paid by place. Solo: 1st 30%, 2nd 18%, 3rd 12%, 4th to 10th 4% each and
-- 12% shared by everyone else who spun on 5 days (scaled to the places
-- there are, ties sharing). Teams (2 to 4 packs, filled evenly as hounds
-- join): ranked by Paw Coins per hound, 60% / 26% / 14% (scaled to the
-- teams there are), each team's share split by what each hound won.
-- Anyone who spun on 5 days gets at least 5. On top of the usual 5.
--
-- Pushes through send-golf-notification's 'slots' kind (worded here): an
-- evening "spins waiting" to anyone in a live game with 3 or more spins
-- who hasn't played today.
--
-- Run this once, after 0241 (committed on its own), in the SQL Editor.
-- Then redeploy send-golf-notification.

-- ── Settings ──

create table public.slots_settings (
  id boolean primary key default true,
  constraint slots_settings_singleton check (id),
  steps_per_spin int not null default 500 check (steps_per_spin between 100 and 5000),
  max_step_spins int not null default 20 check (max_step_spins between 1 and 100),
  workout_min int not null default 20 check (workout_min between 5 and 120),
  workout_spins int not null default 2 check (workout_spins between 0 and 20),
  carry_max int not null default 10 check (carry_max between 0 and 100),
  buy_price int not null default 3 check (buy_price between 1 and 100),
  buy_cap int not null default 10 check (buy_cap between 0 and 100),
  big_pool int not null default 2500 check (big_pool between 0 and 20000),
  big_pool_players int not null default 11 check (big_pool_players between 2 and 1000),
  per_player_bones int not null default 200 check (per_player_bones between 0 and 2000),
  finish_days int not null default 5 check (finish_days between 1 and 30),
  finish_min_bones int not null default 5 check (finish_min_bones between 0 and 500),
  updated_at timestamptz not null default now()
);
insert into public.slots_settings (id) values (true);
alter table public.slots_settings enable row level security;
create policy "Anyone signed in can read the Paw Slots settings"
  on public.slots_settings for select to authenticated using (true);
create policy "Only admins can change the Paw Slots settings"
  on public.slots_settings for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
revoke all on public.slots_settings from anon;
revoke insert, delete on public.slots_settings from authenticated;

-- ── Tables ──

-- How a game is played: solo, or 2 to 4 packs; a Global's own pool.
create table public.slots_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  teams int not null default 0 check (teams in (0, 2, 3, 4)),
  pool int check (pool between 0 and 20000),
  created_at timestamptz not null default now()
);

create table public.slots_players (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  coins int not null default 0 check (coins >= 0),
  team text check (team in ('wolves', 'goldens', 'collies', 'beagles')),
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index slots_players_rank on public.slots_players (challenge_id, coins desc);

-- One row a member a day they played: spins carried in, bought (and for
-- how many coins) and used. What steps and a workout give is worked out
-- from the day's evidence each time (slots_granted).
create table public.slots_days (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  carried_in int not null default 0 check (carried_in >= 0),
  bought int not null default 0 check (bought >= 0),
  bought_coins int not null default 0 check (bought_coins >= 0),
  used int not null default 0 check (used >= 0),
  primary key (challenge_id, user_id, day)
);

-- Every press: where the reels stopped, what each line paid.
create table public.slots_spins (
  id bigserial primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  lines int not null check (lines in (1, 3, 5)),
  bet int not null check (bet in (1, 2, 3, 5)),
  cost int not null,
  stops int[] not null,
  wins jsonb not null default '[]'::jsonb,
  -- The lines' pay added up, before the bet; the best line's; and the coins.
  base int not null default 0,
  best int not null default 0,
  coins int not null default 0,
  created_at timestamptz not null default now()
);
create index slots_spins_challenge on public.slots_spins (challenge_id, created_at desc);
create index slots_spins_user on public.slots_spins (user_id, created_at desc);

alter table public.slots_games enable row level security;
alter table public.slots_players enable row level security;
alter table public.slots_days enable row level security;
alter table public.slots_spins enable row level security;
revoke all on public.slots_games, public.slots_players, public.slots_days, public.slots_spins from anon;
revoke insert, update, delete on public.slots_games, public.slots_players, public.slots_days, public.slots_spins from authenticated;
-- Everything is read through slots_state.

-- ── The machine ──

-- The three reels, top to bottom as they pass (challenges/slots.ts has the
-- same ones in the same order).
create or replace function public.slots_strip(p_reel int)
returns text[]
language sql
immutable
as $$
  select case p_reel
    when 0 then array['hydrant','paw','bone','paw','paw','treat','paw','collar','hydrant','paw','paw','ball','hydrant','collar','hydrant','hydrant','gold','treat','ball','treat']
    when 1 then array['collar','treat','paw','paw','hydrant','hydrant','ball','bone','paw','hydrant','collar','hydrant','treat','gold','ball','paw','hydrant','treat','paw','paw']
    else array['collar','paw','ball','paw','collar','hydrant','ball','hydrant','paw','treat','treat','gold','hydrant','paw','paw','hydrant','bone','hydrant','treat','paw']
  end;
$$;
revoke execute on function public.slots_strip(int) from public, anon, authenticated;

-- The symbol in a row (0 top, 1 the middle, 2 the bottom) of a reel
-- stopped at p_stop: the middle row is the stop itself.
create or replace function public.slots_symbol(p_reel int, p_stop int, p_row int)
returns text
language sql
immutable
as $$
  select (public.slots_strip(p_reel))[(((p_stop + 1 - p_row) % 20) + 20) % 20 + 1];
$$;
revoke execute on function public.slots_symbol(int, int, int) from public, anon, authenticated;

-- The five lines, as the row on each reel: the middle, top, bottom, then
-- the two diagonals.
create or replace function public.slots_line_rows(p_line int)
returns int[]
language sql
immutable
as $$
  select case p_line when 1 then array[1, 1, 1] when 2 then array[0, 0, 0] when 3 then array[2, 2, 2]
                     when 4 then array[0, 1, 2] else array[2, 1, 0] end;
$$;
revoke execute on function public.slots_line_rows(int) from public, anon, authenticated;

-- What one line pays, before the bet: n, the kind ('three' or 'two'), the
-- symbol, how many reels count (k) and whether a Collar doubled it.
create or replace function public.slots_pay(p_line text[])
returns jsonb
language plpgsql
immutable
as $$
declare
  w int := 0;
  rest text[] := '{}';
  l text[] := '{}';
  s text;
  m int;
  base int;
begin
  foreach s in array p_line loop
    if s = 'collar' then w := w + 1; else rest := rest || s; end if;
  end loop;
  if w = 3 then
    return jsonb_build_object('n', 100, 'kind', 'three', 'sym', 'collar', 'k', 3, 'collar', false);
  end if;
  if p_line[1] = 'gold' and p_line[2] = 'gold' and p_line[3] = 'gold' then
    return jsonb_build_object('n', 250, 'kind', 'three', 'sym', 'gold', 'k', 3, 'collar', false);
  end if;
  m := case when w > 0 then 2 else 1 end;
  -- Three of a kind, the Collar standing in (never for the Golden Hound).
  if 'gold' <> all (rest) and (select count(distinct x) from unnest(rest) x) = 1 then
    base := case rest[1] when 'bone' then 50 when 'ball' then 25 when 'treat' then 15 when 'hydrant' then 10 else 5 end;
    return jsonb_build_object('n', base * m, 'kind', 'three', 'sym', rest[1], 'k', 3, 'collar', w > 0);
  end if;
  -- Two on the left.
  if p_line[1] <> 'collar' then l := l || p_line[1]; end if;
  if p_line[2] <> 'collar' then l := l || p_line[2]; end if;
  if coalesce(array_length(l, 1), 0) = 1 or (array_length(l, 1) = 2 and l[1] = l[2]) then
    return jsonb_build_object('n', 2 * m, 'kind', 'two', 'sym', l[1], 'k', 2, 'collar', (p_line[1] = 'collar' or p_line[2] = 'collar'));
  end if;
  return jsonb_build_object('n', 0);
end;
$$;
revoke execute on function public.slots_pay(text[]) from public, anon, authenticated;

-- ── Spins ──

create or replace function public.slots_notify(p_challenge_id uuid, p_recipient uuid, p_title text, p_message text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.golf_notify('slots', p_challenge_id, p_recipient, jsonb_build_object('title', p_title, 'message', p_message));
end;
$$;
revoke execute on function public.slots_notify(uuid, uuid, text, text) from public, anon, authenticated;

-- What a day's steps and workout give (before carrying, buying and using).
create or replace function public.slots_granted(p_user uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select least(s.max_step_spins, public.chess_steps(p_user, p_day) / s.steps_per_spin)
       + case when public.chess_workout_min(p_user, p_day) >= s.workout_min then s.workout_spins else 0 end
  from public.slots_settings s;
$$;
revoke execute on function public.slots_granted(uuid, date) from public, anon, authenticated;

-- What's left of a day: carried in, granted, bought, less used. A day
-- never opened is what its steps gave.
create or replace function public.slots_left(p_challenge_id uuid, p_user uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select greatest(0, coalesce(d.carried_in + d.bought - d.used, 0) + public.slots_granted(p_user, p_day))
  from (select 1) one
  left join public.slots_days d on d.challenge_id = p_challenge_id and d.user_id = p_user and d.day = p_day;
$$;
revoke execute on function public.slots_left(uuid, uuid, date) from public, anon, authenticated;

-- Today's row, made on the first look of the day with what carried over
-- from yesterday (if yesterday was in the game).
create or replace function public.slots_day_row(p_challenge_id uuid, p_user uuid, p_day date)
returns public.slots_days
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  d public.slots_days%rowtype;
  carry int := 0;
begin
  select * into d from public.slots_days where challenge_id = p_challenge_id and user_id = p_user and day = p_day;
  if found then
    return d;
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if p_day - 1 >= public.soccer_first_day(c) then
    carry := least((select s.carry_max from public.slots_settings s), public.slots_left(p_challenge_id, p_user, p_day - 1));
  end if;
  insert into public.slots_days (challenge_id, user_id, day, carried_in) values (p_challenge_id, p_user, p_day, carry)
  on conflict do nothing;
  select * into d from public.slots_days where challenge_id = p_challenge_id and user_id = p_user and day = p_day;
  return d;
end;
$$;
revoke execute on function public.slots_day_row(uuid, uuid, date) from public, anon, authenticated;

-- The pool when it ends: a Global's own, else Admin's for its size.
create or replace function public.slots_pool(p_challenge_id uuid)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select g.pool from public.slots_games g where g.challenge_id = p_challenge_id),
    (select case when n >= s.big_pool_players then s.big_pool else least(s.big_pool, n * s.per_player_bones) end
     from public.slots_settings s,
          (select count(*)::int as n from public.challenge_participants cp where cp.challenge_id = p_challenge_id) x));
$$;
revoke execute on function public.slots_pool(uuid) from public, anon, authenticated;

-- A place's share of the solo pool: 30, 18, 12, then 4 to 10th.
create or replace function public.slots_place_weight(p_rank bigint)
returns int
language sql
immutable
as $$
  select case when p_rank between 1 and 10 then (array[30, 18, 12, 4, 4, 4, 4, 4, 4, 4])[p_rank] else 0 end;
$$;
revoke execute on function public.slots_place_weight(bigint) from public, anon, authenticated;

-- A team place's share: 60, 26, 14.
create or replace function public.slots_team_weight(p_rank bigint)
returns int
language sql
immutable
as $$
  select case when p_rank between 1 and 3 then (array[60, 26, 14])[p_rank] else 0 end;
$$;
revoke execute on function public.slots_team_weight(bigint) from public, anon, authenticated;

-- ── Joining and teams ──

create or replace function public.slots_pick_team(p_challenge_id uuid, p_user uuid, p_teams int)
returns text
language sql
stable
security definer set search_path = public
as $$
  select t from unnest((array['wolves', 'goldens', 'collies', 'beagles'])[1:p_teams]) with ordinality as x (t, i)
  order by (select count(*) from public.slots_players p where p.challenge_id = p_challenge_id and p.team = x.t and p.user_id <> p_user), x.i
  limit 1;
$$;
revoke execute on function public.slots_pick_team(uuid, uuid, int) from public, anon, authenticated;

create or replace function public.slots_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  k text;
  teams int;
begin
  select kind::text into k from public.challenges where id = new.challenge_id;
  if k is distinct from 'slots' then
    return new;
  end if;
  -- Serialise joins on one game so two at once can't both pick the same
  -- smallest team.
  perform pg_advisory_xact_lock(hashtext('slots:' || new.challenge_id::text));
  select g.teams into teams from public.slots_games g where g.challenge_id = new.challenge_id;
  insert into public.slots_players (challenge_id, user_id, team)
  values (new.challenge_id, new.user_id, case when coalesce(teams, 0) >= 2 then public.slots_pick_team(new.challenge_id, new.user_id, teams) end)
  on conflict do nothing;
  return new;
end;
$$;
revoke execute on function public.slots_after_join() from public, anon, authenticated;
create trigger slots_after_join
  after insert on public.challenge_participants
  for each row execute procedure public.slots_after_join();

-- Solo or 2 to 4 packs, set by whoever made it (an admin for a Global,
-- who can also set its pool) before anyone has played. Everyone already
-- in is dealt into the teams in the order they joined.
create or replace function public.slots_setup(p_challenge_id uuid, p_teams int, p_pool int default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges%rowtype;
  admin boolean;
  r record;
  i int := 0;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'slots' then
    raise exception 'That isn''t a Paw Slots challenge.';
  end if;
  admin := exists (select 1 from public.profiles p where p.id = me and p.is_admin);
  if me is null or (c.created_by is distinct from me and not (c.is_global and admin)) then
    raise exception 'Only whoever made it can set it up.';
  end if;
  if p_teams is null or p_teams not in (0, 2, 3, 4) then
    raise exception 'Play solo, or in 2, 3 or 4 packs.';
  end if;
  if p_pool is not null and not (c.is_global and admin) then
    raise exception 'Only an admin can set a Global''s prize pool.';
  end if;
  if p_pool is not null and (p_pool < 0 or p_pool > 20000) then
    raise exception 'The pool is 0 to 20,000 Bones.';
  end if;
  if exists (select 1 from public.slots_spins s where s.challenge_id = p_challenge_id) then
    raise exception 'It''s started: the teams are set.';
  end if;
  insert into public.slots_games (challenge_id, teams, pool) values (p_challenge_id, p_teams, p_pool)
  on conflict (challenge_id) do update set teams = excluded.teams, pool = coalesce(excluded.pool, public.slots_games.pool);
  insert into public.slots_players (challenge_id, user_id)
    select cp.challenge_id, cp.user_id from public.challenge_participants cp where cp.challenge_id = p_challenge_id
    on conflict do nothing;
  for r in
    select cp.user_id from public.challenge_participants cp where cp.challenge_id = p_challenge_id order by cp.joined_at, cp.user_id
  loop
    update public.slots_players
      set team = case when p_teams >= 2 then (array['wolves', 'goldens', 'collies', 'beagles'])[i % p_teams + 1] end
      where challenge_id = p_challenge_id and user_id = r.user_id;
    i := i + 1;
  end loop;
end;
$$;
revoke execute on function public.slots_setup(uuid, int, int) from public, anon;
grant execute on function public.slots_setup(uuid, int, int) to authenticated;

-- ── What the app does ──

-- Today's day number in the game, on the member's own date (1 is the first).
create or replace function public.slots_day_no(p_challenge_id uuid, p_user uuid)
returns int
language sql
stable
security definer set search_path = public
as $$
  select public.soccer_today(p_user) - public.soccer_first_day(c) + 1 from public.challenges c where c.id = p_challenge_id;
$$;
revoke execute on function public.slots_day_no(uuid, uuid) from public, anon, authenticated;

-- Checks a member can play today; returns the challenge.
create or replace function public.slots_live(p_challenge_id uuid, p_user uuid)
returns public.challenges
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  n int;
begin
  if p_user is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'slots' then
    raise exception 'That isn''t a Paw Slots challenge.';
  end if;
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = p_user) then
    raise exception 'Join the challenge to play.';
  end if;
  n := public.slots_day_no(p_challenge_id, p_user);
  if c.score_settled_at is not null or n > c.duration_days then
    raise exception 'This one''s over.';
  end if;
  if n < 1 then
    raise exception 'It hasn''t started yet.';
  end if;
  return c;
end;
$$;
revoke execute on function public.slots_live(uuid, uuid) from public, anon, authenticated;

-- A press: p_lines lines at p_bet a line. The server picks the stops and
-- pays every line, times the bet.
create or replace function public.slots_spin(p_challenge_id uuid, p_lines int, p_bet int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges%rowtype;
  today date;
  d public.slots_days%rowtype;
  cost int;
  left_now int;
  stops int[];
  li int;
  rows int[];
  res jsonb;
  wins jsonb := '[]'::jsonb;
  base int := 0;
  best int := 0;
  won int;
begin
  c := public.slots_live(p_challenge_id, me);
  if p_lines is null or p_lines not in (1, 3, 5) then
    raise exception 'Play 1, 3 or 5 lines.';
  end if;
  if p_bet is null or p_bet not in (1, 2, 3, 5) then
    raise exception 'Bet 1, 2, 3 or 5 a line.';
  end if;
  today := public.soccer_today(me);
  perform public.slots_day_row(p_challenge_id, me, today);
  select * into d from public.slots_days where challenge_id = p_challenge_id and user_id = me and day = today for update;
  cost := p_lines * p_bet;
  left_now := greatest(0, d.carried_in + d.bought - d.used + public.slots_granted(me, today));
  if left_now < cost then
    raise exception 'That needs % spins and you have %.', cost, left_now;
  end if;
  stops := array[floor(random() * 20)::int, floor(random() * 20)::int, floor(random() * 20)::int];
  for li in 1 .. p_lines loop
    rows := public.slots_line_rows(li);
    res := public.slots_pay(array[public.slots_symbol(0, stops[1], rows[1]), public.slots_symbol(1, stops[2], rows[2]), public.slots_symbol(2, stops[3], rows[3])]);
    if (res ->> 'n')::int > 0 then
      wins := wins || jsonb_build_array(res || jsonb_build_object('line', li));
      base := base + (res ->> 'n')::int;
      best := greatest(best, (res ->> 'n')::int);
    end if;
  end loop;
  won := base * p_bet;
  update public.slots_days set used = used + cost where challenge_id = p_challenge_id and user_id = me and day = today;
  insert into public.slots_players (challenge_id, user_id) values (p_challenge_id, me) on conflict do nothing;
  update public.slots_players set coins = coins + won, updated_at = now() where challenge_id = p_challenge_id and user_id = me;
  insert into public.slots_spins (challenge_id, user_id, day, lines, bet, cost, stops, wins, base, best, coins)
  values (p_challenge_id, me, today, p_lines, p_bet, cost, stops, wins, base, best, won);
  return jsonb_build_object('stops', to_jsonb(stops), 'wins', wins, 'base', base, 'won', won,
    'coins', (select p.coins from public.slots_players p where p.challenge_id = p_challenge_id and p.user_id = me),
    'left', left_now - cost);
end;
$$;
revoke execute on function public.slots_spin(uuid, int, int) from public, anon;
grant execute on function public.slots_spin(uuid, int, int) to authenticated;

-- More spins for Paw Coins, up to Admin's cap a day.
create or replace function public.slots_buy(p_challenge_id uuid, p_spins int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges%rowtype;
  s public.slots_settings%rowtype;
  today date;
  d public.slots_days%rowtype;
  have int;
  price int;
begin
  c := public.slots_live(p_challenge_id, me);
  select * into s from public.slots_settings;
  if p_spins is null or p_spins < 1 or p_spins > 100 then
    raise exception 'Buy 1 or more spins.';
  end if;
  today := public.soccer_today(me);
  perform public.slots_day_row(p_challenge_id, me, today);
  select * into d from public.slots_days where challenge_id = p_challenge_id and user_id = me and day = today for update;
  if d.bought + p_spins > s.buy_cap then
    raise exception 'You can buy % more today.', greatest(0, s.buy_cap - d.bought);
  end if;
  price := p_spins * s.buy_price;
  insert into public.slots_players (challenge_id, user_id) values (p_challenge_id, me) on conflict do nothing;
  select p.coins into have from public.slots_players p where p.challenge_id = p_challenge_id and p.user_id = me for update;
  if have < price then
    raise exception 'That''s % Paw Coins and you have %.', price, have;
  end if;
  update public.slots_players set coins = coins - price, updated_at = now() where challenge_id = p_challenge_id and user_id = me;
  update public.slots_days set bought = bought + p_spins, bought_coins = bought_coins + price
    where challenge_id = p_challenge_id and user_id = me and day = today;
  return jsonb_build_object('coins', have - price, 'left', public.slots_left(p_challenge_id, me, today));
end;
$$;
revoke execute on function public.slots_buy(uuid, int) from public, anon;
grant execute on function public.slots_buy(uuid, int) to authenticated;

-- ── What the app shows ──

-- Everything the machine and the challenge page need. p_steps is the
-- phone's own count for today, kept like Hound Chess's.
create or replace function public.slots_state(p_challenge_id uuid, p_steps int default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  c public.challenges%rowtype;
  s public.slots_settings%rowtype;
  g public.slots_games%rowtype;
  today date;
  day_no int;
  d public.slots_days%rowtype;
  steps int;
  wmin int;
  from_steps int;
  n int;
  pool int;
  my_coins int := 0;
  my_team text;
  my_rank int;
  places_w int;
  w_total int;
  rest_n int;
  board jsonb;
  team_board jsonb := '[]'::jsonb;
  mates jsonb := '[]'::jsonb;
  team_prizes jsonb := '[]'::jsonb;
  k int;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'slots' then
    raise exception 'That isn''t a Paw Slots challenge.';
  end if;
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me) and not c.is_global then
    raise exception 'Join the challenge to see it.';
  end if;
  select * into s from public.slots_settings;
  select * into g from public.slots_games where challenge_id = p_challenge_id;
  today := public.soccer_today(me);
  if p_steps is not null and p_steps between 0 and 150000 then
    insert into public.chess_claims (user_id, day, steps) values (me, today, p_steps)
    on conflict (user_id, day) do update set steps = greatest(public.chess_claims.steps, excluded.steps);
  end if;
  day_no := today - public.soccer_first_day(c) + 1;
  if day_no between 1 and c.duration_days and c.score_settled_at is null
     and exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me) then
    d := public.slots_day_row(p_challenge_id, me, today);
  end if;
  steps := public.chess_steps(me, today);
  wmin := public.chess_workout_min(me, today);
  from_steps := least(s.max_step_spins, steps / s.steps_per_spin);
  select count(*)::int into n from public.challenge_participants cp where cp.challenge_id = p_challenge_id;
  pool := public.slots_pool(p_challenge_id);
  select p.coins, p.team into my_coins, my_team from public.slots_players p where p.challenge_id = p_challenge_id and p.user_id = me;
  my_coins := coalesce(my_coins, 0);
  select 1 + count(*) into my_rank from public.slots_players p where p.challenge_id = p_challenge_id and p.coins > my_coins;

  -- The solo ladder as it stands: the places there are, and the rest's share.
  places_w := (select coalesce(sum(public.slots_place_weight(i)), 0) from generate_series(1, least(n, 10)) i);
  rest_n := greatest(0, n - 10);
  w_total := places_w + case when rest_n > 0 then 12 else 0 end;

  -- The board: the top 10, and you with your neighbours.
  with ranked as (
    select p.user_id, p.coins, p.team, rank() over (order by p.coins desc) as rnk,
           row_number() over (order by p.coins desc, p.updated_at, p.user_id) as rn
    from public.slots_players p where p.challenge_id = p_challenge_id
  ),
  mine as (select rn from ranked where user_id = me)
  select coalesce(jsonb_agg(jsonb_build_object('rank', r.rnk, 'tied', (select count(*) from ranked x where x.rnk = r.rnk) > 1,
           'userId', r.user_id, 'name', public.horse_name(r.user_id), 'coins', r.coins, 'team', r.team, 'me', r.user_id = me) order by r.rn), '[]'::jsonb)
    into board
  from ranked r
  where r.rn <= 10 or abs(r.rn - coalesce((select rn from mine), -100)) <= 1;

  if coalesce(g.teams, 0) >= 2 then
    k := (select count(distinct p.team) from public.slots_players p where p.challenge_id = p_challenge_id and p.team is not null);
    with t as (
      select p.team, count(*)::int as members, sum(p.coins)::int as total, round(sum(p.coins)::numeric / count(*), 1) as avg
      from public.slots_players p where p.challenge_id = p_challenge_id and p.team is not null group by p.team
    ),
    tr as (select t.*, rank() over (order by t.avg desc) as rnk from t),
    tw as (select coalesce(sum(public.slots_team_weight(i)), 0) as w from generate_series(1, k) i)
    select coalesce(jsonb_agg(jsonb_build_object('team', tr.team, 'rank', tr.rnk, 'members', tr.members, 'total', tr.total, 'avg', tr.avg,
             'mine', tr.team = my_team,
             'bones', case when (select w from tw) > 0 then floor(pool * public.slots_team_weight(tr.rnk)::numeric / (select w from tw))::int else 0 end)
             order by tr.rnk, tr.team), '[]'::jsonb)
      into team_board from tr;
    select coalesce(jsonb_agg(jsonb_build_object('name', public.horse_name(p.user_id), 'coins', p.coins, 'me', p.user_id = me) order by p.coins desc, p.user_id), '[]'::jsonb)
      into mates from public.slots_players p where p.challenge_id = p_challenge_id and p.team = my_team;
    team_prizes := (select coalesce(jsonb_agg(case when tw > 0 then floor(pool * public.slots_team_weight(i)::numeric / tw)::int else 0 end order by i), '[]'::jsonb)
                    from generate_series(1, k) i, (select coalesce(sum(public.slots_team_weight(j)), 0) as tw from generate_series(1, k) j) x);
  end if;

  return jsonb_build_object(
    'settings', jsonb_build_object('stepsPerSpin', s.steps_per_spin, 'maxStepSpins', s.max_step_spins, 'workoutMin', s.workout_min,
                  'workoutSpins', s.workout_spins, 'carryMax', s.carry_max, 'buyPrice', s.buy_price, 'buyCap', s.buy_cap, 'finishDays', s.finish_days),
    'name', c.name,
    'isGlobal', c.is_global,
    'dayNo', day_no,
    'days', c.duration_days,
    'endsAt', c.ends_at,
    'over', c.score_settled_at is not null or day_no > c.duration_days,
    'teams', coalesce(g.teams, 0),
    'players', n,
    'pool', pool,
    'prizes', jsonb_build_object(
      'places', (select coalesce(jsonb_agg(case when w_total > 0 then floor(pool * public.slots_place_weight(i)::numeric / w_total)::int else 0 end order by i), '[]'::jsonb)
                 from generate_series(1, least(n, 10)) i),
      'rest', case when rest_n > 0 then floor(pool * 12::numeric / w_total)::int end,
      'restMin', s.finish_min_bones),
    'teamPrizes', team_prizes,
    'me', jsonb_build_object('coins', my_coins, 'rank', my_rank, 'team', my_team,
            'joined', exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me),
            'spinDays', (select count(distinct x.day) from public.slots_spins x where x.challenge_id = p_challenge_id and x.user_id = me),
            'presses', (select count(*) from public.slots_spins x where x.challenge_id = p_challenge_id and x.user_id = me)),
    'today', jsonb_build_object('steps', steps, 'fromSteps', from_steps, 'workoutMin', wmin,
               'workoutSpins', case when wmin >= s.workout_min then s.workout_spins else 0 end,
               'carried', coalesce(d.carried_in, 0), 'bought', coalesce(d.bought, 0), 'used', coalesce(d.used, 0),
               'left', case when d.challenge_id is null then 0 else greatest(0, d.carried_in + d.bought - d.used + public.slots_granted(me, today)) end,
               'nextAt', case when from_steps >= s.max_step_spins then null else (from_steps + 1) * s.steps_per_spin end,
               'buyLeft', greatest(0, s.buy_cap - coalesce(d.bought, 0))),
    'board', board,
    'teamBoard', team_board,
    'mates', mates,
    'feed', coalesce((select jsonb_agg(jsonb_build_object('name', public.horse_name(x.user_id), 'best', x.best, 'bet', x.bet, 'lines', x.lines,
                        'coins', x.coins, 'wins', x.wins, 'at', x.created_at) order by x.created_at desc)
                      from (select * from public.slots_spins x where x.challenge_id = p_challenge_id and x.best >= 25
                            and x.created_at > now() - interval '1 day' order by x.created_at desc limit 5) x), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.slots_state(uuid, int) from public, anon;
grant execute on function public.slots_state(uuid, int) to authenticated;

-- ── The evening nudge ──

-- "Spins waiting": the US evening, to anyone in a live game with 3 or
-- more who hasn't played today.
create or replace function public.slots_push()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
  left_now int;
begin
  for r in
    select cp.challenge_id, cp.user_id, c.name
    from public.challenge_participants cp
    join public.challenges c on c.id = cp.challenge_id
    where c.kind::text = 'slots' and c.score_settled_at is null
      and public.soccer_today(cp.user_id) - public.soccer_first_day(c) + 1 between 1 and c.duration_days
      and not exists (select 1 from public.slots_spins s where s.challenge_id = cp.challenge_id and s.user_id = cp.user_id and s.day = public.soccer_today(cp.user_id))
  loop
    left_now := public.slots_left(r.challenge_id, r.user_id, public.soccer_today(r.user_id));
    -- A day never opened hasn't had yesterday's carried in yet.
    if not exists (select 1 from public.slots_days d where d.challenge_id = r.challenge_id and d.user_id = r.user_id and d.day = public.soccer_today(r.user_id)) then
      left_now := left_now + least((select s.carry_max from public.slots_settings s),
                                   public.slots_left(r.challenge_id, r.user_id, public.soccer_today(r.user_id) - 1));
    end if;
    if left_now >= 3 then
      perform public.slots_notify(r.challenge_id, r.user_id, r.name, 'Your steps have earned ' || left_now || ' spins. The machine''s waiting.');
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.slots_push() from public, anon, authenticated;
select cron.schedule('hound-slots-evening', '37 23 * * *', $$ select public.slots_push(); $$);

-- ── The payout ──

-- Who gets what when it ends: the Hound Score points and the Bones from
-- the pool (the usual 5 are added by the settle).
create or replace function public.slots_payout(p_challenge_id uuid)
returns table (user_id uuid, score int, bones int)
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_column
declare
  c public.challenges%rowtype;
  s public.slots_settings%rowtype;
  teams int;
  pool int;
  need int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into s from public.slots_settings;
  teams := coalesce((select g.teams from public.slots_games g where g.challenge_id = p_challenge_id), 0);
  pool := public.slots_pool(p_challenge_id);
  need := least(s.finish_days, c.duration_days);

  if teams >= 2 then
    return query
    with p as (
      select cp.user_id, coalesce(sp.coins, 0) as coins, sp.team,
             (select count(distinct x.day) from public.slots_spins x where x.challenge_id = p_challenge_id and x.user_id = cp.user_id)::int as days
      from public.challenge_participants cp
      left join public.slots_players sp on sp.challenge_id = cp.challenge_id and sp.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
    ),
    t as (
      select p.team, sum(p.coins)::numeric as total, sum(p.coins)::numeric / count(*) as avg
      from p where p.team is not null group by p.team
    ),
    tr as (select t.*, rank() over (order by t.avg desc) as rnk from t),
    tw as (select coalesce(sum(public.slots_team_weight(tr.rnk)), 0)::numeric as w from tr)
    select p.user_id,
      case when tr.rnk = 1 and tr.total > 0 then 40 else 10 end,
      case when p.days = 0 then 0
           else greatest(case when p.days >= need then s.finish_min_bones else 0 end,
                         coalesce(floor(pool * public.slots_team_weight(tr.rnk) / nullif(tw.w, 0) * p.coins / nullif(tr.total, 0)), 0)::int) end
    from p
    left join tr on tr.team = p.team
    cross join tw;
    return;
  end if;

  return query
  with p as (
    select cp.user_id, coalesce(sp.coins, 0) as coins,
           (select count(distinct x.day) from public.slots_spins x where x.challenge_id = p_challenge_id and x.user_id = cp.user_id)::int as days
    from public.challenge_participants cp
    left join public.slots_players sp on sp.challenge_id = cp.challenge_id and sp.user_id = cp.user_id
    where cp.challenge_id = p_challenge_id
  ),
  -- Only hounds who played are placed.
  r as (select p.*, rank() over (order by p.coins desc) as rnk from p where p.days > 0),
  w as (select r.*, public.slots_place_weight(r.rnk::int) as pw, (r.rnk > 10 and r.days >= need) as rest from r),
  tot as (
    select coalesce(sum(w.pw), 0)::numeric + case when count(*) filter (where w.rest) > 0 then 12 else 0 end as wt,
           count(*) filter (where w.rest) as rest_n
    from w
  )
  select p.user_id,
    case when w.rnk = 1 then 50 when w.rnk = 2 then 25 when w.rnk = 3 then 15 else 5 end,
    case when w.user_id is null then 0
         else greatest(case when w.days >= need then s.finish_min_bones else 0 end,
                       coalesce(floor(pool * (w.pw + case when w.rest then 12.0 / nullif(tot.rest_n, 0) else 0 end) / nullif(tot.wt, 0)), 0)::int) end
  from p
  left join w on w.user_id = p.user_id
  cross join tot;
end;
$$;
revoke execute on function public.slots_payout(uuid) from public, anon, authenticated;

-- ── Global: publish_global_challenge takes 'slots' ──

create or replace function public.publish_global_challenge(
  p_name text,
  p_kind public.challenge_kind,
  p_duration_days int,
  p_starts_at timestamptz,
  p_join_closes_at timestamptz,
  p_daily_goal_steps int default null,
  p_distance_goal_unit text default null,
  p_distance_goal_mi numeric default null,
  p_distance_goal_steps int default null,
  p_bingo_card_type text default null,
  p_course_id text default null,
  p_distance_source text default null,
  -- 0179: the hound card's size (3, 4 or 5), or null to size it by length.
  p_bingo_size int default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  ends timestamptz;
  new_id uuid;
begin
  if p_bingo_size is not null and p_bingo_size not in (3, 4, 5) then
    raise exception 'A Bingo card is 3×3, 4×4 or 5×5.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only an admin can publish a global challenge.';
  end if;
  if p_kind::text not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly', 'doors', 'packs', 'golf', 'derby', 'shootout', 'titlebout', 'slots') then
    raise exception 'That kind of challenge can''t be global — pick Step Race, Daily Streak, Distance, Bingo, 75 Day, Journey, Accountability, Hound''opoly, Daily Doors, Pack Wars, Golf, the Home Run Derby, the Hound Shootout, the Title Bout or Paw Slots.';
  end if;
  if p_duration_days is null or p_duration_days < 1 or p_duration_days > 365 then
    raise exception 'A global challenge runs between 1 and 365 days.';
  end if;
  if p_starts_at is null or p_starts_at < now() - interval '1 day' then
    raise exception 'Pick a start date from today on.';
  end if;
  ends := p_starts_at + make_interval(days => p_duration_days);
  if p_join_closes_at is null or p_join_closes_at <= now() or p_join_closes_at > ends then
    raise exception 'Joining has to close after now and no later than the challenge ends.';
  end if;
  if p_kind = 'packs' and (p_duration_days < 7 or p_duration_days > 30) then
    raise exception 'Pack Wars runs 7 to 30 days.';
  end if;
  if p_kind = 'doors' and (p_duration_days < 3 or p_duration_days > 60) then
    raise exception 'Daily Doors runs 3 to 60 days, a door a day.';
  end if;
  if p_kind::text = 'golf' and (p_duration_days < 3 or p_duration_days > 30) then
    raise exception 'A Global Golf runs 3 to 30 days.';
  end if;
  if p_kind::text = 'derby' and (p_duration_days < 3 or p_duration_days > 30) then
    raise exception 'The Home Run Derby runs 3 to 30 days.';
  end if;
  if p_kind::text = 'shootout' and (p_duration_days < 3 or p_duration_days > 30) then
    raise exception 'The Hound Shootout runs 3 to 30 days.';
  end if;
  if p_kind::text = 'slots' and (p_duration_days < 3 or p_duration_days > 30) then
    raise exception 'Paw Slots runs 3 to 30 days.';
  end if;
  if p_kind::text = 'titlebout' and p_duration_days <> 7 then
    raise exception 'The Title Bout runs 7 days: 5 on the ladder, then the title fight.';
  end if;
  -- Joining closes after day 3 of the Title Bout at the latest.
  if p_kind::text = 'titlebout' and p_join_closes_at > p_starts_at + interval '3 days' then
    raise exception 'Joining the Title Bout closes by the end of day 3.';
  end if;
  if p_kind = 'streak' and coalesce(p_daily_goal_steps, 0) <= 0 then
    raise exception 'A Daily Streak needs a daily step goal.';
  end if;
  if p_kind = 'distance' and not (
    (p_distance_goal_unit = 'miles' and coalesce(p_distance_goal_mi, 0) > 0)
    or (p_distance_goal_unit = 'steps' and coalesce(p_distance_goal_steps, 0) > 0)
  ) then
    raise exception 'A Distance challenge needs a group target.';
  end if;
  if p_kind = 'journey' and (p_course_id is null or coalesce(p_distance_goal_mi, 0) <= 0) then
    raise exception 'A Journey needs a course.';
  end if;
  if p_distance_source is not null and p_distance_source not in ('workouts', 'all') then
    raise exception 'Miles count from logged workouts or every mile.';
  end if;

  insert into public.challenges (
    name, kind, created_by, duration_days, starts_at, ends_at,
    daily_goal_steps, distance_goal_unit, distance_goal_mi, distance_goal_steps, bingo_card_type, course_id,
    distance_source, bingo_size, is_global, join_closes_at
  ) values (
    trim(p_name), p_kind, auth.uid(), p_duration_days, p_starts_at, ends,
    case when p_kind = 'streak' then p_daily_goal_steps end,
    case when p_kind = 'distance' then p_distance_goal_unit when p_kind = 'journey' then 'miles' end,
    case when (p_kind = 'distance' and p_distance_goal_unit = 'miles') or p_kind = 'journey' then p_distance_goal_mi end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'steps' then p_distance_goal_steps end,
    case when p_kind = 'bingo' then coalesce(p_bingo_card_type, 'variety') end,
    case when p_kind = 'journey' or (p_kind = 'distance' and p_distance_goal_unit = 'miles') then p_course_id end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'miles' then p_distance_source end,
    case when p_kind = 'bingo' and coalesce(p_bingo_card_type, 'variety') = 'hound' then p_bingo_size end,
    true, p_join_closes_at
  )
  returning id into new_id;

  return new_id;
end;
$$;
revoke execute on function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text, text, text, int) from public, anon;
grant execute on function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text, text, text, int) to authenticated;

-- ── Scoring (0238's, with Paw Slots) ──

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

  elsif c.kind::text = 'slots' then
    -- 0242: the pool paid by place (solo) or by team and each hound's
    -- share of its team's Paw Coins; the Hound Score by place.
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select x.user_id, p_challenge_id, 'slots_result', x.score, 25, bones_trickle + x.bones
    from public.slots_payout(p_challenge_id) x;

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

-- ── Admin → Overview → Games → Paw Slots ──

create or replace function public.admin_slots_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return (
    with sp7 as (select * from public.slots_spins x where x.created_at > now() - interval '7 days'),
         d7 as (select * from public.slots_days d where d.day > (now() at time zone 'America/New_York')::date - 7)
    select jsonb_build_object(
      'live', (select count(*) from public.challenges c where c.kind::text = 'slots' and c.score_settled_at is null and c.ends_at > now()),
      'liveGlobal', (select count(*) from public.challenges c where c.kind::text = 'slots' and c.is_global and c.score_settled_at is null and c.ends_at > now()),
      'all', (select count(*) from public.challenges c where c.kind::text = 'slots'),
      'teamGames', (select count(*) from public.slots_games g where g.teams >= 2),
      'joined', (select count(distinct cp.user_id) from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id where c.kind::text = 'slots'),
      'playedEver', (select count(distinct x.user_id) from public.slots_spins x),
      'players7d', (select count(distinct sp7.user_id) from sp7),
      'presses7d', (select count(*) from sp7),
      'spinsUsed7d', (select coalesce(sum(sp7.cost), 0) from sp7),
      'coinsWon7d', (select coalesce(sum(sp7.coins), 0) from sp7),
      'hits7d', (select count(*) from sp7 where sp7.base > 0),
      'byLines7d', jsonb_build_object('l1', (select count(*) from sp7 where sp7.lines = 1), 'l3', (select count(*) from sp7 where sp7.lines = 3), 'l5', (select count(*) from sp7 where sp7.lines = 5)),
      'byBet7d', jsonb_build_object('b1', (select count(*) from sp7 where sp7.bet = 1), 'b2', (select count(*) from sp7 where sp7.bet = 2),
                                    'b3', (select count(*) from sp7 where sp7.bet = 3), 'b5', (select count(*) from sp7 where sp7.bet = 5)),
      'jackpots7d', (select count(*) from sp7 where sp7.wins @> '[{"sym": "gold", "kind": "three"}]'),
      'bigWins7d', (select count(*) from sp7 where sp7.best >= 50),
      'buyers7d', (select count(distinct d7.user_id) from d7 where d7.bought > 0),
      'bought7d', (select coalesce(sum(d7.bought), 0) from d7),
      'coinsSpent7d', (select coalesce(sum(d7.bought_coins), 0) from d7),
      'carried7d', (select coalesce(sum(d7.carried_in), 0) from d7),
      'bonesPaid', (select coalesce(sum(a.bones_points), 0) from public.activity_events a where a.kind = 'slots_result'),
      'topPlayers7d', coalesce((
        select jsonb_agg(jsonb_build_object('name', public.horse_name(x.user_id), 'presses', x.n, 'coins', x.coins) order by x.n desc)
        from (select sp7.user_id, count(*) as n, sum(sp7.coins) as coins from sp7 group by sp7.user_id order by count(*) desc limit 5) x
      ), '[]'::jsonb),
      'settings', (select to_jsonb(s) - 'id' - 'updated_at' from public.slots_settings s)
    )
  );
end;
$$;
revoke execute on function public.admin_slots_overview() from public, anon;
grant execute on function public.admin_slots_overview() to authenticated;
