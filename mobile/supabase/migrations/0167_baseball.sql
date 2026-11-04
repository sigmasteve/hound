-- Hound: Baseball — a game on everyone's steps, one inning a day. See
-- 0166_baseball_challenge_kind.sql for the enum value this depends on
-- (must already be committed). The design: "Hound baseball: design"
-- (claude.ai/artifact/CXriuh9wV3pdC17y9FGQHi).
--
-- Two sides of one to nine, friends or bots. The challenge's days are its
-- innings (3, 5, 7 or 9). Each day's inning, both halves, is played once
-- the day is over everywhere (11:40 UTC the next morning, like Soccer and
-- Cricket), from that day's steps:
--
--   positions  pitcher, catcher, 1B, 2B, SS, 3B, LF, CF, RF. They go in
--              batting order, round again on a smaller side, so a side of
--              one plays everywhere: 1st pitches, 2nd catches, then SS,
--              CF, 2B, 3B, LF, 1B, RF.
--   at-bat     batter's share of their and the pitcher's steps, r:
--                strikeout  7% + 30% x (1 - r)   walk  4% + 8% x r
--              otherwise the ball's in play, where the batter aimed
--              (left, center or right; a seeded zone with no pick).
--   how far    the batter's own steps that day:
--                under 4,000      singles
--                4,000 - 7,999    singles 75%, doubles 25%
--                8,000 or more    singles 64%, doubles 32%, triples 4%
--              and a home run (uncatchable) first: 4.5% of balls in play
--              from 8,000, 6% from 12,000, 9% from 18,000.
--   fielder    a would-be single goes to the infielder on that side, a
--              double or triple to the outfielder. Caught: 67% - 50% x
--              (b - 0.5), b the batter's share against the fielder, kept
--              to 40% - 90%. The catcher's shift: right zone x1.3 (to
--              90%), wrong x0.85. A fielder with under a quarter of the
--              batter's steps who misses throws late 10% of the time: an
--              extra base.
--   runners    a hit scores the runner on third; second scores on a
--              double, and tries on a single; first scores on a triple,
--              tries on a double. A try, and a sacrifice fly from third,
--              is a play at home: tagged 4% + 24% x c, c the catcher's
--              share against the runner.
--   steals     a runner who picked it steals the next base when it's open
--              (bots 30% of the time): safe 68% + 50% x (s - 0.5), s the
--              runner's share against the catcher, kept to 20% - 90%.
--   two        a caught ground ball with a runner on first and fewer than
--              two out is a double play 35% + 40% x (i - 0.5) of the time,
--              i the fielder's share against that runner, kept to 10% -
--              80%.
--   pitcher    Power: strikeouts +4 points, home runs x1.25, doubles and
--              triples x1.15. Finesse: walks +3 points, home runs x0.75,
--              doubles and triples x0.85.
--
-- Tuned by simulation: about 3.7 runs and 9 hits a game a side at 8,000
-- steps all round, 5 runs at 12,000. A half-inning ends at three outs, ten
-- runs or fifteen batters. The home side (a seeded toss) bats second and
-- skips the bottom of the last inning when ahead; a tie goes to extra
-- innings, one a day, up to three, then it's a tie. Every roll is seeded
-- (rally_js_rand, 0140), so a day plays the same wherever it's computed.
--
-- Picks (baseball_picks), one set a day per player, hidden from the other
-- side until the day's played: a batter's aim, the catcher's shift, the
-- pitcher's approach, and steal-when-on. No pick is never a penalty.
-- Bots aim, shift and pitch by seeded roll.
--
-- The creator names both sides at setup (baseball_players; the batting
-- order is the order named), and only those people can accept. Bots play
-- on simulated steps (soccer_steps, 0142). Like the other games, the
-- tables have no write policies; every write goes through the functions.
--
-- Run this once, after 0166 (as its own, separately committed
-- transaction), in the SQL Editor. Push notifications need the
-- send-baseball-notification Edge Function deployed; without it the game
-- still plays, quietly.

create table public.baseball_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  innings int not null check (innings in (3, 5, 7, 9)),
  home_team text not null check (home_team in ('a', 'b')),
  -- The next inning to play, from 1; extra innings go past `innings`.
  inning int not null default 1,
  runs_a int not null default 0,
  runs_b int not null default 0,
  hits_a int not null default 0,
  hits_b int not null default 0,
  -- Where each side's batting order is up to (an index, carried on).
  next_a int not null default 0,
  next_b int not null default 0,
  status text not null default 'active' check (status in ('active', 'final')),
  -- Null on a tie.
  winner_team text check (winner_team in ('a', 'b')),
  updated_at timestamptz not null default now()
);

alter table public.baseball_games enable row level security;
revoke all on public.baseball_games from anon;
revoke insert, update, delete on public.baseball_games from authenticated;
create policy "Participants can view their Baseball game"
  on public.baseball_games for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = baseball_games.challenge_id and cp.user_id = auth.uid()));

create table public.baseball_players (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid references public.profiles (id),
  bot_id uuid references public.challenge_bots (id) on delete cascade,
  player_id uuid generated always as (coalesce(user_id, bot_id)) stored,
  team text not null check (team in ('a', 'b')),
  -- Batting order within the side, from 1.
  seat int not null,
  positions text[] not null default '{}' check (positions <@ array['p', 'c', '1b', '2b', 'ss', '3b', 'lf', 'cf', 'rf']),
  joined boolean not null default false,
  constraint baseball_players_one_kind check ((user_id is null) <> (bot_id is null))
);
create unique index baseball_players_player_idx on public.baseball_players (challenge_id, player_id);
create unique index baseball_players_seat_idx on public.baseball_players (challenge_id, team, seat);

alter table public.baseball_players enable row level security;
revoke all on public.baseball_players from anon;
revoke insert, update, delete on public.baseball_players from authenticated;
create policy "Participants can view their Baseball sides"
  on public.baseball_players for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = baseball_players.challenge_id and cp.user_id = auth.uid()));

-- One row per played day, with the inning it played (null when there was
-- none: nobody to bat yet, or after the game).
create table public.baseball_days (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  day_no int not null,
  inning int,
  resolved_at timestamptz not null default now(),
  primary key (challenge_id, day)
);
alter table public.baseball_days enable row level security;
revoke all on public.baseball_days from anon;
revoke insert, update, delete on public.baseball_days from authenticated;
create policy "Participants can view their Baseball days"
  on public.baseball_days for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = baseball_days.challenge_id and cp.user_id = auth.uid()));

-- The line score: each inning's runs and hits, away (top) and home
-- (bottom; null when it wasn't needed).
create table public.baseball_innings (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  inning int not null,
  day date not null,
  away_runs int not null default 0,
  away_hits int not null default 0,
  home_runs int,
  home_hits int,
  primary key (challenge_id, inning)
);
alter table public.baseball_innings enable row level security;
revoke all on public.baseball_innings from anon;
revoke insert, update, delete on public.baseball_innings from authenticated;
create policy "Participants can view their Baseball innings"
  on public.baseball_innings for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = baseball_innings.challenge_id and cp.user_id = auth.uid()));

-- Every play, in order: the morning report and the replay are drawn from
-- these.
create table public.baseball_plays (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  inning int not null,
  half text not null check (half in ('top', 'bottom')),
  seq int not null,
  batting_team text not null check (batting_team in ('a', 'b')),
  kind text not null check (kind in (
    'strikeout', 'walk', 'single', 'double', 'triple', 'home_run',
    'ground_out', 'fly_out', 'double_play', 'sac_fly',
    'out_at_home', 'stolen_base', 'caught_stealing'
  )),
  batter_id uuid,
  pitcher_id uuid,
  -- The fielder who made (or missed) the play, and where.
  fielder_id uuid,
  fielder_pos text,
  -- A runner in a steal or a play at home.
  runner_id uuid,
  aim text check (aim in ('left', 'center', 'right')),
  shifted boolean,
  -- A late throw gave the batter an extra base.
  late_throw boolean not null default false,
  runs int not null default 0,
  outs int not null,
  -- Who's on after the play.
  on_first uuid,
  on_second uuid,
  on_third uuid,
  batter_steps int,
  pitcher_steps int,
  fielder_steps int,
  catcher_steps int,
  runner_steps int,
  created_at timestamptz not null default now()
);
create index baseball_plays_challenge_idx on public.baseball_plays (challenge_id, inning, half, seq);
alter table public.baseball_plays enable row level security;
revoke all on public.baseball_plays from anon;
revoke insert, update, delete on public.baseball_plays from authenticated;
create policy "Participants can view their Baseball plays"
  on public.baseball_plays for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = baseball_plays.challenge_id and cp.user_id = auth.uid()));

create table public.baseball_picks (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  player_id uuid not null,
  aim text check (aim in ('left', 'center', 'right')),
  -- The catcher's call for the fielding side.
  shift text check (shift in ('left', 'center', 'right')),
  approach text check (approach in ('power', 'finesse')),
  steal boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (challenge_id, day, player_id)
);
alter table public.baseball_picks enable row level security;
revoke all on public.baseball_picks from anon;
revoke insert, update, delete on public.baseball_picks from authenticated;
create policy "Your side's picks, and everyone's once the day is played"
  on public.baseball_picks for select to authenticated
  using (
    exists (
      select 1 from public.baseball_players me, public.baseball_players them
      where me.challenge_id = baseball_picks.challenge_id and me.user_id = auth.uid()
        and them.challenge_id = baseball_picks.challenge_id and them.player_id = baseball_picks.player_id
        and me.team = them.team
    )
    or (
      exists (select 1 from public.baseball_days d where d.challenge_id = baseball_picks.challenge_id and d.day = baseball_picks.day)
      and exists (select 1 from public.challenge_participants cp where cp.challenge_id = baseball_picks.challenge_id and cp.user_id = auth.uid())
    )
  );

-- A seeded 0-1 roll.
create or replace function public.baseball_rand(p_seed text)
returns double precision
language sql
immutable
as $$
  select public.rally_js_rand(public.rally_js_hash(p_seed));
$$;
revoke execute on function public.baseball_rand(text) from public, anon, authenticated;

-- The odds, on their own so they can be read and tested.
create or replace function public.baseball_strikeout_chance(p_batter numeric, p_pitcher numeric, p_approach text)
returns double precision
language sql
immutable
as $$
  select (0.07 + 0.30 * (1 - coalesce(p_batter / nullif(p_batter + p_pitcher, 0), 0.5))
    + case when p_approach = 'power' then 0.04 else 0 end)::double precision;
$$;

create or replace function public.baseball_walk_chance(p_batter numeric, p_pitcher numeric, p_approach text)
returns double precision
language sql
immutable
as $$
  select (0.04 + 0.08 * coalesce(p_batter / nullif(p_batter + p_pitcher, 0), 0.5)
    + case when p_approach = 'finesse' then 0.03 else 0 end)::double precision;
$$;

create or replace function public.baseball_home_run_chance(p_batter_steps int, p_approach text)
returns double precision
language sql
immutable
as $$
  select (case when p_batter_steps >= 18000 then 0.09 when p_batter_steps >= 12000 then 0.06 when p_batter_steps >= 8000 then 0.045 else 0 end
    * case p_approach when 'power' then 1.25 when 'finesse' then 0.75 else 1 end)::double precision;
$$;

-- How far a ball that isn't caught goes: 1, 2 or 3 bases, from a roll.
create or replace function public.baseball_hit_length(p_batter_steps int, p_approach text, p_roll double precision)
returns int
language plpgsql
immutable
as $$
declare
  dbl double precision := case when p_batter_steps >= 8000 then 0.32 when p_batter_steps >= 4000 then 0.25 else 0 end;
  tpl double precision := case when p_batter_steps >= 8000 then 0.04 else 0 end;
  k double precision := case p_approach when 'power' then 1.15 when 'finesse' then 0.85 else 1 end;
begin
  if p_roll < tpl * k then return 3; end if;
  if p_roll < (tpl + dbl) * k then return 2; end if;
  return 1;
end;
$$;

create or replace function public.baseball_catch_chance(p_batter numeric, p_fielder numeric, p_aim text, p_shift text)
returns double precision
language sql
immutable
as $$
  select case
    when p_shift is null then base
    when p_shift = p_aim then least(0.90, base * 1.3)
    else base * 0.85
  end
  from (select least(0.90, greatest(0.40, 0.67 - 0.50 * (coalesce(p_batter / nullif(p_batter + p_fielder, 0), 0.5) - 0.5)))::double precision as base) b;
$$;

create or replace function public.baseball_tag_chance(p_catcher numeric, p_runner numeric)
returns double precision
language sql
immutable
as $$
  select (0.04 + 0.24 * coalesce(p_catcher / nullif(p_catcher + p_runner, 0), 0.5))::double precision;
$$;

create or replace function public.baseball_steal_chance(p_runner numeric, p_catcher numeric)
returns double precision
language sql
immutable
as $$
  select least(0.90, greatest(0.20, 0.68 + 0.50 * (coalesce(p_runner / nullif(p_runner + p_catcher, 0), 0.5) - 0.5)))::double precision;
$$;

create or replace function public.baseball_double_play_chance(p_fielder numeric, p_runner numeric)
returns double precision
language sql
immutable
as $$
  select least(0.80, greatest(0.10, 0.35 + 0.40 * (coalesce(p_fielder / nullif(p_fielder + p_runner, 0), 0.5) - 0.5)))::double precision;
$$;

grant execute on function public.baseball_strikeout_chance(numeric, numeric, text) to authenticated;
grant execute on function public.baseball_walk_chance(numeric, numeric, text) to authenticated;
grant execute on function public.baseball_home_run_chance(int, text) to authenticated;
grant execute on function public.baseball_hit_length(int, text, double precision) to authenticated;
grant execute on function public.baseball_catch_chance(numeric, numeric, text, text) to authenticated;
grant execute on function public.baseball_tag_chance(numeric, numeric) to authenticated;
grant execute on function public.baseball_steal_chance(numeric, numeric) to authenticated;
grant execute on function public.baseball_double_play_chance(numeric, numeric) to authenticated;
revoke execute on function public.baseball_strikeout_chance(numeric, numeric, text) from public, anon;
revoke execute on function public.baseball_walk_chance(numeric, numeric, text) from public, anon;
revoke execute on function public.baseball_home_run_chance(int, text) from public, anon;
revoke execute on function public.baseball_hit_length(int, text, double precision) from public, anon;
revoke execute on function public.baseball_catch_chance(numeric, numeric, text, text) from public, anon;
revoke execute on function public.baseball_tag_chance(numeric, numeric) from public, anon;
revoke execute on function public.baseball_steal_chance(numeric, numeric) from public, anon;
revoke execute on function public.baseball_double_play_chance(numeric, numeric) from public, anon;

create or replace function public.baseball_notify(p_kind text, p_challenge_id uuid, p_recipient uuid, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_recipient is null or not exists (select 1 from public.profiles p where p.id = p_recipient) then
    return;
  end if;
  perform net.http_post(
    url := public.edge_function_url('send-baseball-notification'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('kind', p_kind, 'challenge_id', p_challenge_id, 'recipient_id', p_recipient) || p_extra
  );
exception when others then
  null;
end;
$$;

revoke execute on function public.baseball_notify(text, uuid, uuid, jsonb) from public, anon, authenticated;

-- Hands out a side's nine positions in batting order, round again on a
-- smaller side: 1st pitches, 2nd catches, then SS, CF, 2B, 3B, LF, 1B, RF.
create or replace function public.baseball_assign_positions(p_challenge_id uuid, p_team text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  order_pos text[] := array['p', 'c', 'ss', 'cf', '2b', '3b', 'lf', '1b', 'rf'];
  n int;
begin
  select count(*) into n from public.baseball_players p where p.challenge_id = p_challenge_id and p.team = p_team;
  if n = 0 then
    return;
  end if;
  update public.baseball_players p set positions = (
    select coalesce(array_agg(order_pos[i] order by i), '{}')
    from generate_series(1, 9) i
    where (i - 1) % n = x.k
  )
  from (
    select q.id, (row_number() over (order by q.seat)) - 1 as k
    from public.baseball_players q where q.challenge_id = p_challenge_id and q.team = p_team
  ) x
  where p.id = x.id;
end;
$$;

revoke execute on function public.baseball_assign_positions(uuid, text) from public, anon, authenticated;

-- The creator names both sides right after creating the challenge: a JSON
-- list of {id, team}, the creator on side A, in batting order. An id is a
-- friend (who still has to accept) or one of this challenge's bots.
create or replace function public.baseball_setup(p_challenge_id uuid, p_players jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  r record;
  n_a int;
  n_b int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind <> 'baseball' or c.created_by is distinct from caller then
    raise exception 'Only the creator can set up this game.';
  end if;
  if c.duration_days not in (3, 5, 7, 9) then
    raise exception 'A game is 3, 5, 7 or 9 innings, one a day.';
  end if;
  if exists (select 1 from public.baseball_days d where d.challenge_id = p_challenge_id) then
    raise exception 'This game is under way — the sides can''t change now.';
  end if;
  if jsonb_typeof(p_players) != 'array' or jsonb_array_length(p_players) < 2 or jsonb_array_length(p_players) > 18 then
    raise exception 'A game needs two to eighteen players.';
  end if;
  if (select count(distinct e->>'id') from jsonb_array_elements(p_players) e) != jsonb_array_length(p_players) then
    raise exception 'Everyone in the game has to be a different person.';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_players) e where (e->>'id')::uuid = caller and e->>'team' = 'a') then
    raise exception 'You play on your own side.';
  end if;
  for r in select (e->>'id')::uuid as id, e->>'team' as team from jsonb_array_elements(p_players) e loop
    if r.team not in ('a', 'b') then
      raise exception 'Each player is on side A or B.';
    end if;
    if r.id != caller
      and not exists (select 1 from public.profiles p where p.id = r.id)
      and not exists (select 1 from public.challenge_bots b where b.id = r.id and b.challenge_id = p_challenge_id) then
      raise exception 'One of the players isn''t a person or one of this challenge''s bots.';
    end if;
  end loop;
  select count(*) filter (where e->>'team' = 'a'), count(*) filter (where e->>'team' = 'b') into n_a, n_b from jsonb_array_elements(p_players) e;
  if n_a < 1 or n_b < 1 or n_a > 9 or n_b > 9 then
    raise exception 'Each side has one to nine players.';
  end if;

  insert into public.baseball_games (challenge_id, innings, home_team)
    values (p_challenge_id, c.duration_days,
      case when public.baseball_rand(p_challenge_id::text || ':toss') < 0.5 then 'a' else 'b' end)
    on conflict (challenge_id) do update set innings = excluded.innings, updated_at = now();

  delete from public.baseball_players where challenge_id = p_challenge_id;
  insert into public.baseball_players (challenge_id, user_id, bot_id, team, seat, joined)
  select p_challenge_id,
    case when is_bot then null else pid end,
    case when is_bot then pid else null end,
    e.value->>'team',
    row_number() over (partition by e.value->>'team' order by e.ordinality),
    is_bot or exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = pid)
  from jsonb_array_elements(p_players) with ordinality e
  cross join lateral (select (e.value->>'id')::uuid as pid) i
  cross join lateral (select exists (select 1 from public.challenge_bots b where b.id = i.pid and b.challenge_id = p_challenge_id) as is_bot) k;
  perform public.baseball_assign_positions(p_challenge_id, 'a');
  perform public.baseball_assign_positions(p_challenge_id, 'b');
end;
$$;

revoke execute on function public.baseball_setup(uuid, jsonb) from public, anon;
grant execute on function public.baseball_setup(uuid, jsonb) to authenticated;

-- A seat added after the game is made, at the end of that side's order;
-- the side's positions are handed out again.
create or replace function public.baseball_add_player(p_challenge_id uuid, p_user_id uuid, p_team text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.challenges c where c.id = p_challenge_id and c.kind = 'baseball' and c.created_by = auth.uid()) then
    raise exception 'Only the creator can change the sides.';
  end if;
  if not exists (select 1 from public.baseball_games g where g.challenge_id = p_challenge_id and g.status = 'active') then
    raise exception 'This game is over.';
  end if;
  if p_team not in ('a', 'b') then
    raise exception 'Pick side A or B.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'That person isn''t on Hound.';
  end if;
  if exists (select 1 from public.baseball_players p where p.challenge_id = p_challenge_id and p.user_id = p_user_id) then
    raise exception 'They already have a seat in this game.';
  end if;
  if (select count(*) from public.baseball_players p where p.challenge_id = p_challenge_id and p.team = p_team) >= 9 then
    raise exception 'That side already has nine players.';
  end if;
  insert into public.baseball_players (challenge_id, user_id, team, seat, joined)
  values (p_challenge_id, p_user_id, p_team,
    coalesce((select max(seat) from public.baseball_players p where p.challenge_id = p_challenge_id and p.team = p_team), 0) + 1,
    exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = p_user_id));
  perform public.baseball_assign_positions(p_challenge_id, p_team);
end;
$$;

revoke execute on function public.baseball_add_player(uuid, uuid, text) from public, anon;
grant execute on function public.baseball_add_player(uuid, uuid, text) to authenticated;

create or replace function public.baseball_before_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.challenges c where c.id = new.challenge_id and c.kind = 'baseball') then
    return new;
  end if;
  if exists (select 1 from public.baseball_players p where p.challenge_id = new.challenge_id) then
    if not exists (select 1 from public.baseball_players p where p.challenge_id = new.challenge_id and p.user_id = new.user_id) then
      raise exception 'This game''s sides are already set.';
    end if;
  elsif exists (select 1 from public.challenge_participants cp where cp.challenge_id = new.challenge_id) then
    raise exception 'This game isn''t set up yet.';
  end if;
  return new;
end;
$$;

revoke execute on function public.baseball_before_join() from public, anon, authenticated;
create trigger baseball_before_join before insert on public.challenge_participants
  for each row execute procedure public.baseball_before_join();

create or replace function public.baseball_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.baseball_players set joined = true where challenge_id = new.challenge_id and user_id = new.user_id and not joined;
  return new;
end;
$$;

revoke execute on function public.baseball_after_join() from public, anon, authenticated;
create trigger baseball_after_join after insert on public.challenge_participants
  for each row execute procedure public.baseball_after_join();

-- Who holds a position on a side, and their steps on a day (0 for a seat
-- nobody's accepted yet).
create or replace function public.baseball_holder(p_challenge_id uuid, p_team text, p_pos text)
returns uuid
language sql
stable
as $$
  select p.player_id from public.baseball_players p
  where p.challenge_id = p_challenge_id and p.team = p_team and p_pos = any (p.positions)
  order by p.seat limit 1;
$$;

create or replace function public.baseball_steps(p_challenge_id uuid, p_player uuid, p_day date, p_first_day date)
returns int
language sql
stable
as $$
  select case
    when p_player is null then 0
    when not exists (select 1 from public.baseball_players p where p.challenge_id = p_challenge_id and p.player_id = p_player and p.joined) then 0
    else public.soccer_steps(p_challenge_id, p_player, p_day, p_first_day)
  end;
$$;

revoke execute on function public.baseball_holder(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.baseball_steps(uuid, uuid, date, date) from public, anon, authenticated;

-- The caller's own today in a game, by their time zone (Soccer's rule).
-- Sets one of the caller's picks for it: 'aim' (left, center, right),
-- 'shift' (the catcher only), 'approach' (the pitcher only: power or
-- finesse), 'steal' ('on' or 'off'). A null value clears it. Returns the
-- day it's for.
create or replace function public.baseball_set_pick(p_challenge_id uuid, p_field text, p_value text)
returns date
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  me public.baseball_players%rowtype;
  c public.challenges%rowtype;
  g public.baseball_games%rowtype;
  d date;
  first_day date;
begin
  select * into me from public.baseball_players p where p.challenge_id = p_challenge_id and p.user_id = caller;
  if not found or not me.joined then
    raise exception 'You''re not playing in this game.';
  end if;
  select * into g from public.baseball_games where challenge_id = p_challenge_id;
  if not found or g.status <> 'active' then
    raise exception 'This game is over.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  first_day := public.soccer_first_day(c);
  d := public.soccer_today(caller);
  if d < first_day or d > first_day + c.duration_days + 2 then
    raise exception 'There''s no game day today.';
  end if;
  if exists (select 1 from public.baseball_days bd where bd.challenge_id = p_challenge_id and bd.day = d) then
    raise exception 'Today''s inning is already played.';
  end if;
  if p_field = 'aim' then
    if p_value is not null and p_value not in ('left', 'center', 'right') then
      raise exception 'Aim left, center or right.';
    end if;
  elsif p_field = 'shift' then
    if not ('c' = any (me.positions)) then
      raise exception 'The catcher calls the shift.';
    end if;
    if p_value is not null and p_value not in ('left', 'center', 'right') then
      raise exception 'Shift left, center or right.';
    end if;
  elsif p_field = 'approach' then
    if not ('p' = any (me.positions)) then
      raise exception 'Only the pitcher picks how to pitch.';
    end if;
    if p_value is not null and p_value not in ('power', 'finesse') then
      raise exception 'Pick Power or Finesse.';
    end if;
  elsif p_field = 'steal' then
    if p_value is not null and p_value not in ('on', 'off') then
      raise exception 'Steal on or off.';
    end if;
  else
    raise exception 'Pick an aim, a shift, an approach or steals.';
  end if;

  insert into public.baseball_picks (challenge_id, day, player_id) values (p_challenge_id, d, caller)
    on conflict (challenge_id, day, player_id) do nothing;
  update public.baseball_picks k set
    aim = case when p_field = 'aim' then p_value else k.aim end,
    shift = case when p_field = 'shift' then p_value else k.shift end,
    approach = case when p_field = 'approach' then p_value else k.approach end,
    steal = case when p_field = 'steal' then coalesce(p_value = 'on', false) else k.steal end,
    updated_at = now()
  where k.challenge_id = p_challenge_id and k.day = d and k.player_id = caller;
  return d;
end;
$$;

revoke execute on function public.baseball_set_pick(uuid, text, text) from public, anon;
grant execute on function public.baseball_set_pick(uuid, text, text) to authenticated;

-- A player's picks for a day. A bot picks by seeded roll: an aim each
-- at-bat, a shift and an approach for the day, and steals 30% of the
-- time. A person who didn't pick gets nothing (aim is then seeded per
-- at-bat by the caller).
create or replace function public.baseball_pick_of(p_challenge_id uuid, p_day date, p_player uuid)
returns public.baseball_picks
language plpgsql
stable
security definer set search_path = public
as $$
declare
  k public.baseball_picks%rowtype;
  zones text[] := array['left', 'center', 'right'];
  seed text := p_challenge_id::text || ':' || p_day || ':' || coalesce(p_player::text, '-');
begin
  if p_player is null then
    return null;
  end if;
  if exists (select 1 from public.baseball_players p where p.challenge_id = p_challenge_id and p.bot_id = p_player) then
    k.challenge_id := p_challenge_id;
    k.day := p_day;
    k.player_id := p_player;
    k.aim := null;
    k.shift := zones[1 + floor(public.baseball_rand(seed || ':shift') * 3)::int];
    k.approach := case when public.baseball_rand(seed || ':approach') < 0.5 then 'power' else 'finesse' end;
    k.steal := true;
    return k;
  end if;
  select * into k from public.baseball_picks t where t.challenge_id = p_challenge_id and t.day = p_day and t.player_id = p_player;
  return k;
end;
$$;

revoke execute on function public.baseball_pick_of(uuid, date, uuid) from public, anon, authenticated;

-- Plays one half-inning: p_bat bats against the other side, from their
-- batting order at p_cursor. With p_need set (the bottom of the last
-- inning or later), it stops as soon as the side has p_need runs: a
-- walk-off. Writes every play; returns the runs, hits, and where the
-- order is up to.
create or replace function public.baseball_half(
  p_challenge_id uuid, p_day date, p_first_day date, p_inning int, p_half text, p_bat text, p_cursor int, p_need int
)
returns table (runs int, hits int, next_cursor int)
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  ft text := case when p_bat = 'a' then 'b' else 'a' end;
  zones text[] := array['left', 'center', 'right'];
  bat uuid[];
  n int;
  cur int := p_cursor;
  pitcher uuid;
  catcher uuid;
  ps int;
  cs int;
  approach text;
  shift text;
  outs int := 0;
  v_runs int := 0;
  v_hits int := 0;
  faced int := 0;
  seq int := 0;
  b1 uuid;
  b2 uuid;
  b3 uuid;
  batter uuid;
  bs int;
  bpick public.baseball_picks%rowtype;
  rpick public.baseball_picks%rowtype;
  seed text;
  x double precision;
  pk double precision;
  pbb double precision;
  aim text;
  len int;
  fpos text;
  fid uuid;
  fs int;
  caught boolean;
  late boolean;
  go int;
  scored int;
  runner uuid;
  rs int;
  ok boolean;
  stealer uuid;
  to_base int;
begin
  select array_agg(p.player_id order by p.seat) into bat
  from public.baseball_players p where p.challenge_id = p_challenge_id and p.team = p_bat and p.joined;
  if bat is null then
    return query select 0, 0, p_cursor;
    return;
  end if;
  n := array_length(bat, 1);
  pitcher := public.baseball_holder(p_challenge_id, ft, 'p');
  catcher := public.baseball_holder(p_challenge_id, ft, 'c');
  ps := public.baseball_steps(p_challenge_id, pitcher, p_day, p_first_day);
  cs := public.baseball_steps(p_challenge_id, catcher, p_day, p_first_day);
  approach := (public.baseball_pick_of(p_challenge_id, p_day, pitcher)).approach;
  shift := (public.baseball_pick_of(p_challenge_id, p_day, catcher)).shift;

  while outs < 3 and v_runs < 10 and faced < 15 and (p_need is null or v_runs < p_need) loop
    batter := bat[(cur % n) + 1];
    cur := cur + 1;
    faced := faced + 1;
    seq := seq + 1;
    seed := p_challenge_id::text || ':' || p_day || ':' || p_half || ':' || seq;
    bs := public.baseball_steps(p_challenge_id, batter, p_day, p_first_day);
    bpick := public.baseball_pick_of(p_challenge_id, p_day, batter);

    -- A steal first: the lead runner, if the next base is open and they
    -- picked it (bots 30% of the time).
    stealer := null;
    if b2 is not null and b3 is null then
      stealer := b2; to_base := 3;
    elsif b1 is not null and b2 is null then
      stealer := b1; to_base := 2;
    end if;
    if stealer is not null then
      rpick := public.baseball_pick_of(p_challenge_id, p_day, stealer);
      if coalesce(rpick.steal, false) and (
        not exists (select 1 from public.baseball_players p where p.challenge_id = p_challenge_id and p.bot_id = stealer)
        or public.baseball_rand(seed || ':steal-try') < 0.3) then
        rs := public.baseball_steps(p_challenge_id, stealer, p_day, p_first_day);
        ok := public.baseball_rand(seed || ':steal') < public.baseball_steal_chance(rs, cs);
        if to_base = 3 then b2 := null; else b1 := null; end if;
        if ok then
          if to_base = 3 then b3 := stealer; else b2 := stealer; end if;
        else
          outs := outs + 1;
        end if;
        insert into public.baseball_plays (challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, runner_id,
          outs, on_first, on_second, on_third, catcher_steps, runner_steps)
        values (p_challenge_id, p_day, p_inning, p_half, seq, p_bat, case when ok then 'stolen_base' else 'caught_stealing' end, batter, pitcher, catcher, 'c', stealer,
          outs, b1, b2, b3, cs, rs);
        seq := seq + 1;
        seed := p_challenge_id::text || ':' || p_day || ':' || p_half || ':' || seq;
        if outs >= 3 then
          -- The batter comes up first next inning.
          cur := cur - 1;
          exit;
        end if;
      end if;
    end if;

    pk := public.baseball_strikeout_chance(bs, ps, approach);
    pbb := public.baseball_walk_chance(bs, ps, approach);
    x := public.baseball_rand(seed || ':pitch');

    if x < pk then
      outs := outs + 1;
      insert into public.baseball_plays (challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, outs, on_first, on_second, on_third, batter_steps, pitcher_steps)
        values (p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'strikeout', batter, pitcher, outs, b1, b2, b3, bs, ps);
      continue;
    end if;

    if x < pk + pbb then
      scored := 0;
      if b1 is not null then
        if b2 is not null then
          if b3 is not null then scored := 1; end if;
          b3 := b2;
        end if;
        b2 := b1;
      end if;
      b1 := batter;
      v_runs := v_runs + scored;
      insert into public.baseball_plays (challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, runs, outs, on_first, on_second, on_third, batter_steps, pitcher_steps)
        values (p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'walk', batter, pitcher, scored, outs, b1, b2, b3, bs, ps);
      continue;
    end if;

    -- In play, where the batter aimed.
    aim := coalesce(bpick.aim, zones[1 + floor(public.baseball_rand(seed || ':aim') * 3)::int]);

    if public.baseball_rand(seed || ':hr') < public.baseball_home_run_chance(bs, approach) then
      scored := 1 + (b1 is not null)::int + (b2 is not null)::int + (b3 is not null)::int;
      b1 := null; b2 := null; b3 := null;
      v_runs := v_runs + scored;
      v_hits := v_hits + 1;
      insert into public.baseball_plays (challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_pos, aim, shifted, runs, outs, on_first, on_second, on_third, batter_steps, pitcher_steps)
        values (p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'home_run', batter, pitcher,
          case aim when 'left' then 'lf' when 'center' then 'cf' else 'rf' end, aim, shift = aim, scored, outs, b1, b2, b3, bs, ps);
      continue;
    end if;

    len := public.baseball_hit_length(bs, approach, public.baseball_rand(seed || ':len'));
    if len = 1 then
      fpos := case aim
        when 'left' then case when public.baseball_rand(seed || ':inf') < 0.5 then '3b' else 'ss' end
        when 'center' then case when public.baseball_rand(seed || ':inf') < 0.5 then 'ss' else '2b' end
        else case when public.baseball_rand(seed || ':inf') < 0.5 then '2b' else '1b' end
      end;
    else
      fpos := case aim when 'left' then 'lf' when 'center' then 'cf' else 'rf' end;
    end if;
    fid := public.baseball_holder(p_challenge_id, ft, fpos);
    fs := public.baseball_steps(p_challenge_id, fid, p_day, p_first_day);
    caught := public.baseball_rand(seed || ':catch') < public.baseball_catch_chance(bs, fs, aim, shift);

    if caught then
      if len = 1 then
        if b1 is not null and outs < 2 then
          rs := public.baseball_steps(p_challenge_id, b1, p_day, p_first_day);
          if public.baseball_rand(seed || ':dp') < public.baseball_double_play_chance(fs, rs) then
            outs := outs + 2;
            runner := b1;
            b1 := null;
            insert into public.baseball_plays (challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, runner_id, aim, shifted, outs, on_first, on_second, on_third, batter_steps, pitcher_steps, fielder_steps, runner_steps)
              values (p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'double_play', batter, pitcher, fid, fpos, runner, aim, shift = aim, outs, b1, b2, b3, bs, ps, fs, rs);
            continue;
          end if;
        end if;
        outs := outs + 1;
        insert into public.baseball_plays (challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, aim, shifted, outs, on_first, on_second, on_third, batter_steps, pitcher_steps, fielder_steps)
          values (p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'ground_out', batter, pitcher, fid, fpos, aim, shift = aim, outs, b1, b2, b3, bs, ps, fs);
        continue;
      end if;

      outs := outs + 1;
      if b3 is not null and outs < 3 then
        -- Tagging up from third: a play at the plate.
        runner := b3;
        b3 := null;
        rs := public.baseball_steps(p_challenge_id, runner, p_day, p_first_day);
        if public.baseball_rand(seed || ':home3') < public.baseball_tag_chance(cs, rs) then
          outs := outs + 1;
          insert into public.baseball_plays (challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, aim, shifted, outs, on_first, on_second, on_third, batter_steps, pitcher_steps, fielder_steps)
            values (p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'fly_out', batter, pitcher, fid, fpos, aim, shift = aim, outs - 1, b1, b2, runner, bs, ps, fs);
          seq := seq + 1;
          insert into public.baseball_plays (challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, runner_id, outs, on_first, on_second, on_third, catcher_steps, runner_steps)
            values (p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'out_at_home', batter, pitcher, catcher, 'c', runner, outs, b1, b2, b3, cs, rs);
        else
          v_runs := v_runs + 1;
          insert into public.baseball_plays (challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, runner_id, aim, shifted, runs, outs, on_first, on_second, on_third, batter_steps, pitcher_steps, fielder_steps, catcher_steps, runner_steps)
            values (p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'sac_fly', batter, pitcher, fid, fpos, runner, aim, shift = aim, 1, outs, b1, b2, b3, bs, ps, fs, cs, rs);
        end if;
        continue;
      end if;
      insert into public.baseball_plays (challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, aim, shifted, outs, on_first, on_second, on_third, batter_steps, pitcher_steps, fielder_steps)
        values (p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'fly_out', batter, pitcher, fid, fpos, aim, shift = aim, outs, b1, b2, b3, bs, ps, fs);
      continue;
    end if;

    -- A hit: the fielder got to it late.
    late := fs * 4 < bs and public.baseball_rand(seed || ':late') < 0.10;
    go := len + case when late then 1 else 0 end;
    v_hits := v_hits + 1;
    scored := 0;
    if go >= 4 then
      scored := 1 + (b1 is not null)::int + (b2 is not null)::int + (b3 is not null)::int;
      b1 := null; b2 := null; b3 := null;
      v_runs := v_runs + scored;
      insert into public.baseball_plays (challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, aim, shifted, late_throw, runs, outs, on_first, on_second, on_third, batter_steps, pitcher_steps, fielder_steps)
        values (p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'home_run', batter, pitcher, fid, fpos, aim, shift = aim, true, scored, outs, b1, b2, b3, bs, ps, fs);
      continue;
    end if;

    -- Who tries for home: second on a single, first on a double.
    runner := case when go = 1 then b2 when go = 2 then b1 else null end;
    if b3 is not null then scored := scored + 1; end if;
    if go >= 2 and b2 is not null then scored := scored + 1; end if;
    if go >= 3 and b1 is not null then scored := scored + 1; end if;
    if go = 1 then
      b3 := null; b2 := b1; b1 := batter;
      -- b2 above is the runner from first; the runner from second is `runner`.
    elsif go = 2 then
      b3 := null; b2 := batter; b1 := null;
    else
      b3 := batter; b2 := null; b1 := null;
    end if;
    v_runs := v_runs + scored;
    insert into public.baseball_plays (challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, aim, shifted, late_throw, runs, outs, on_first, on_second, on_third, batter_steps, pitcher_steps, fielder_steps)
      values (p_challenge_id, p_day, p_inning, p_half, seq, p_bat, case go when 1 then 'single' when 2 then 'double' else 'triple' end,
        batter, pitcher, fid, fpos, aim, shift = aim, late, scored, outs, b1, b2, b3, bs, ps, fs);

    if runner is not null and (p_need is null or v_runs < p_need) then
      seq := seq + 1;
      rs := public.baseball_steps(p_challenge_id, runner, p_day, p_first_day);
      if public.baseball_rand(seed || ':home') < public.baseball_tag_chance(cs, rs) then
        outs := outs + 1;
        insert into public.baseball_plays (challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, runner_id, outs, on_first, on_second, on_third, catcher_steps, runner_steps)
          values (p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'out_at_home', batter, pitcher, catcher, 'c', runner, outs, b1, b2, b3, cs, rs);
      else
        v_runs := v_runs + 1;
        update public.baseball_plays bp set runs = bp.runs + 1
          where bp.challenge_id = p_challenge_id and bp.inning = p_inning and bp.half = p_half and bp.seq = seq - 1;
        seq := seq - 1;
      end if;
    end if;
  end loop;

  return query select v_runs, v_hits, cur;
end;
$$;

revoke execute on function public.baseball_half(uuid, date, date, int, text, text, int, int) from public, anon, authenticated;

-- Plays one day: the next inning, top and bottom, then moves the game on
-- or ends it. A day with nothing to play is still recorded. Internal.
create or replace function public.baseball_play_day(p_challenge_id uuid, p_day date, p_day_no int, p_first_day date)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.baseball_games%rowtype;
  away text;
  home text;
  away_total int;
  home_total int;
  top_r record;
  bot_r record;
  need int;
  play_bottom boolean;
begin
  select * into g from public.baseball_games where challenge_id = p_challenge_id;
  if g.status <> 'active'
    or not exists (select 1 from public.baseball_players p where p.challenge_id = p_challenge_id and p.team = 'a' and p.joined)
    or not exists (select 1 from public.baseball_players p where p.challenge_id = p_challenge_id and p.team = 'b' and p.joined) then
    insert into public.baseball_days (challenge_id, day, day_no) values (p_challenge_id, p_day, p_day_no);
    return;
  end if;
  select 0 as runs, 0 as hits, 0 as next_cursor into bot_r;
  home := g.home_team;
  away := case when home = 'a' then 'b' else 'a' end;
  away_total := case when away = 'a' then g.runs_a else g.runs_b end;
  home_total := case when home = 'a' then g.runs_a else g.runs_b end;

  select * into top_r from public.baseball_half(p_challenge_id, p_day, p_first_day, g.inning, 'top', away,
    case when away = 'a' then g.next_a else g.next_b end, null);
  away_total := away_total + top_r.runs;

  -- The bottom of the last inning (or an extra one) isn't needed when the
  -- home side is already ahead, and stops the moment they go ahead.
  play_bottom := not (g.inning >= g.innings and home_total > away_total);
  if play_bottom then
    need := case when g.inning >= g.innings then away_total - home_total + 1 else null end;
    select * into bot_r from public.baseball_half(p_challenge_id, p_day, p_first_day, g.inning, 'bottom', home,
      case when home = 'a' then g.next_a else g.next_b end, need);
    home_total := home_total + bot_r.runs;
  end if;

  insert into public.baseball_innings (challenge_id, inning, day, away_runs, away_hits, home_runs, home_hits)
    values (p_challenge_id, g.inning, p_day, top_r.runs, top_r.hits,
      case when play_bottom then bot_r.runs end, case when play_bottom then bot_r.hits end);
  insert into public.baseball_days (challenge_id, day, day_no, inning) values (p_challenge_id, p_day, p_day_no, g.inning);

  update public.baseball_games set
    runs_a = case when away = 'a' then away_total else home_total end,
    runs_b = case when away = 'b' then away_total else home_total end,
    hits_a = hits_a + case when away = 'a' then top_r.hits else coalesce(bot_r.hits, 0) end,
    hits_b = hits_b + case when away = 'b' then top_r.hits else coalesce(bot_r.hits, 0) end,
    next_a = case when away = 'a' then top_r.next_cursor when play_bottom then bot_r.next_cursor else next_a end,
    next_b = case when away = 'b' then top_r.next_cursor when play_bottom then bot_r.next_cursor else next_b end,
    inning = inning + 1,
    updated_at = now()
  where challenge_id = p_challenge_id;

  if g.inning >= g.innings then
    if away_total <> home_total then
      update public.baseball_games set status = 'final',
        winner_team = case when away_total > home_total then away else home end, updated_at = now()
        where challenge_id = p_challenge_id;
      update public.challenges set ends_at = now() where id = p_challenge_id and ends_at > now();
    elsif g.inning >= g.innings + 3 then
      update public.baseball_games set status = 'final', winner_team = null, updated_at = now() where challenge_id = p_challenge_id;
      update public.challenges set ends_at = now() where id = p_challenge_id and ends_at > now();
    else
      -- Extra innings: another day.
      update public.challenges set ends_at = greatest(ends_at, now()) + interval '1 day' where id = p_challenge_id;
    end if;
  end if;
end;
$$;

revoke execute on function public.baseball_play_day(uuid, date, int, date) from public, anon, authenticated;

-- Plays every day that's over everywhere (yesterday, UTC, once 11:00 UTC
-- has passed) and not yet played. Callable by any participant (the app
-- calls it on load); the morning job calls it for every running game.
create or replace function public.baseball_advance(p_challenge_id uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.baseball_games%rowtype;
  caller uuid := auth.uid();
  first_day date;
  last_day date;
  cutoff date;
  d date;
  n int := 0;
  r record;
  played date;
  extra jsonb;
  mine jsonb;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.kind <> 'baseball' then
    return 0;
  end if;
  if caller is not null and not exists (
    select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller) then
    return 0;
  end if;
  select * into g from public.baseball_games where challenge_id = p_challenge_id;
  if not found or g.status <> 'active' then
    return 0;
  end if;
  first_day := public.soccer_first_day(c);
  -- The innings, and up to three extra.
  last_day := first_day + g.innings + 2;
  cutoff := (now() at time zone 'utc')::date - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end;

  for d in
    select s::date from generate_series(first_day::timestamp, least(last_day, cutoff)::timestamp, interval '1 day') s
    where not exists (select 1 from public.baseball_days bd where bd.challenge_id = p_challenge_id and bd.day = s::date)
    order by s
  loop
    select * into g from public.baseball_games where challenge_id = p_challenge_id;
    exit when g.status <> 'active';
    perform public.baseball_play_day(p_challenge_id, d, (d - first_day) + 1, first_day);
    played := d;
    n := n + 1;
  end loop;

  -- Out of days with innings still to play (days nobody could play):
  -- it ends on the score as it stands.
  select * into g from public.baseball_games where challenge_id = p_challenge_id;
  if g.status = 'active' and cutoff >= last_day then
    update public.baseball_games set status = 'final',
      winner_team = case when runs_a > runs_b then 'a' when runs_b > runs_a then 'b' end, updated_at = now()
      where challenge_id = p_challenge_id;
    update public.challenges set ends_at = now() where id = p_challenge_id and ends_at > now();
  end if;

  if n > 0 then
    select * into g from public.baseball_games where challenge_id = p_challenge_id;
    extra := jsonb_build_object('status', g.status, 'inning', g.inning - 1, 'innings', g.innings, 'runs_a', g.runs_a, 'runs_b', g.runs_b,
      'home_team', g.home_team, 'winner_team', g.winner_team);
    for r in select p.user_id, p.player_id, p.team from public.baseball_players p where p.challenge_id = p_challenge_id and p.user_id is not null and p.joined loop
      -- Their line from the last day played: at-bats, hits, home runs, runs batted in.
      select jsonb_build_object(
          'team', r.team,
          'ab', count(*) filter (where bp.kind in ('strikeout', 'single', 'double', 'triple', 'home_run', 'ground_out', 'fly_out', 'double_play')),
          'h', count(*) filter (where bp.kind in ('single', 'double', 'triple', 'home_run')),
          'hr', count(*) filter (where bp.kind = 'home_run'),
          'rbi', coalesce(sum(bp.runs) filter (where bp.kind in ('single', 'double', 'triple', 'home_run', 'walk', 'sac_fly')), 0))
        into mine
      from public.baseball_plays bp
      where bp.challenge_id = p_challenge_id and bp.day = played and bp.batter_id = r.player_id;
      perform public.baseball_notify(case when g.status = 'final' then 'final' else 'day' end, p_challenge_id, r.user_id, extra || mine);
    end loop;
  end if;
  return n;
end;
$$;

revoke execute on function public.baseball_advance(uuid) from public, anon;
grant execute on function public.baseball_advance(uuid) to authenticated;

create or replace function public.baseball_advance_all()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.id from public.challenges c join public.baseball_games g on g.challenge_id = c.id
    where c.kind = 'baseball' and g.status = 'active' and c.starts_at < now()
    order by c.starts_at
  loop
    begin
      n := n + public.baseball_advance(r.id);
    exception when others then
      raise warning 'baseball_advance_all: % failed: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;

revoke execute on function public.baseball_advance_all() from public, anon, authenticated;

select cron.schedule('hound-baseball-advance', '40 11 * * *', $$ select public.baseball_advance_all(); $$);

-- A nudge at midday in the US to anyone who hasn't aimed today.
create or replace function public.baseball_pick_reminders()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.challenge_id, p.user_id, p.positions, public.soccer_today(p.user_id) as d,
           public.soccer_first_day(c) as first_day, g.inning, g.innings
    from public.baseball_players p
    join public.baseball_games g on g.challenge_id = p.challenge_id and g.status = 'active'
    join public.challenges c on c.id = p.challenge_id
    where p.user_id is not null and p.joined
  loop
    continue when r.d < r.first_day or r.d > r.first_day + r.innings + 2;
    continue when exists (select 1 from public.baseball_days bd where bd.challenge_id = r.challenge_id and bd.day = r.d);
    continue when exists (select 1 from public.baseball_picks k where k.challenge_id = r.challenge_id and k.day = r.d and k.player_id = r.user_id and k.aim is not null);
    perform public.baseball_notify('pick', r.challenge_id, r.user_id,
      jsonb_build_object('inning', r.inning, 'innings', r.innings, 'catcher', 'c' = any (r.positions), 'pitcher', 'p' = any (r.positions)));
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.baseball_pick_reminders() from public, anon, authenticated;

select cron.schedule('hound-baseball-pick-reminders', '9 17 * * *', $$ select public.baseball_pick_reminders(); $$);

-- Scoring: 0147's core with a Baseball branch; 0147's wrapper, with a
-- Baseball game settling on its own state like Cricket.
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
  bones_trickle constant int := 5;
  bones_per_level constant int := 25;
  first_day date;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.score_settled_at is not null then
    return;
  end if;

  concluded := now() >= c.ends_at;

  if not concluded and c.kind = 'tag' then
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

  -- A Baseball game ends after its last inning, which can be days past
  -- ends_at in extra innings, or before it on a skipped bottom half.
  if c.kind = 'baseball' then
    perform public.baseball_advance(p_challenge_id);
    select * into bg from public.baseball_games where challenge_id = p_challenge_id;
    concluded := found and bg.status = 'final';
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
  personal := c.kind::text in ('seventyfive', 'bingo', 'checklist');

  -- Game-event kinds (a Journey, which ends when someone reaches the end
  -- of the course, and a Rally, which ends on two games) can end before
  -- ends_at; the core decides if they have.
  -- A Rally's or a Soccer match's other players may all be bots: its own
  -- state says whether it's over, whatever the participant count.
  if c.kind::text in ('rally', 'soccer', 'cricket', 'baseball') then
    perform public.settle_challenge_score_core(p_challenge_id);
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

-- Admin → Overview → Baseball: games, players, bots, picks, and how the
-- games play.
create or replace function public.admin_baseball_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  return (
    with finished as (
      select g.* from public.baseball_games g where g.status = 'final'
    )
    select jsonb_build_object(
      'active', (select count(*) from public.baseball_games g where g.status = 'active'),
      'finished', (select count(*) from finished),
      'extra_innings', (select count(*) from finished f where f.inning - 1 > f.innings),
      'ties', (select count(*) from finished f where f.winner_team is null),
      'players', (select count(distinct p.user_id) from public.baseball_players p where p.user_id is not null and p.joined),
      'seats', (select count(*) from public.baseball_players p),
      'bot_seats', (select count(*) from public.baseball_players p where p.bot_id is not null),
      'avg_runs', (select coalesce(round(avg(f.runs_a + f.runs_b)::numeric, 1), 0) from finished f),
      'home_runs', (select count(*) from public.baseball_plays bp where bp.kind = 'home_run'),
      'stolen_bases', (select count(*) from public.baseball_plays bp where bp.kind = 'stolen_base'),
      'caught_stealing', (select count(*) from public.baseball_plays bp where bp.kind = 'caught_stealing'),
      'double_plays', (select count(*) from public.baseball_plays bp where bp.kind = 'double_play'),
      'picks_7d', jsonb_build_object(
        'aim', (select count(*) from public.baseball_picks k where k.aim is not null and k.updated_at > now() - interval '7 days'),
        'shift', (select count(*) from public.baseball_picks k where k.shift is not null and k.updated_at > now() - interval '7 days'),
        'approach', (select count(*) from public.baseball_picks k where k.approach is not null and k.updated_at > now() - interval '7 days'),
        'steal', (select count(*) from public.baseball_picks k where k.steal and k.updated_at > now() - interval '7 days')
      ),
      'pickers_7d', (select count(distinct k.player_id) from public.baseball_picks k where k.updated_at > now() - interval '7 days')
    )
  );
end;
$$;

revoke execute on function public.admin_baseball_overview() from public, anon;
grant execute on function public.admin_baseball_overview() to authenticated;

-- 0148's trophies, with a Baseball one for winning a game.
create or replace function public.yard_trophies(p_user uuid)
returns table (kind text, wins integer, last_won timestamptz)
language sql
stable
security definer set search_path = public
as $$
  with won as (
    select e.created_at,
      case e.kind
        when 'steps_result' then 'steps'
        when 'houndopoly_result' then 'houndopoly'
        when 'soccer_result' then 'soccer'
        when 'rally_result' then 'rally'
        when 'cricket_result' then 'cricket'
        when 'baseball_result' then 'baseball'
        when 'tictacgo_result' then 'tictacgo'
        when 'bingo_result' then 'bingo'
        when 'streak_result' then 'streak'
        when 'journey_result' then 'journey'
      end as trophy
    from public.activity_events e
    where e.user_id = p_user
      and (
        (e.kind in ('steps_result', 'houndopoly_result') and e.score_points >= 50
          and exists (
            select 1 from public.activity_events o
            where o.challenge_id = e.challenge_id and o.kind = e.kind and o.user_id <> p_user
          ))
        or (e.kind in ('soccer_result', 'rally_result', 'cricket_result', 'baseball_result', 'tictacgo_result') and e.score_points = 35)
        or (e.kind = 'bingo_result' and e.score_points >= 35)
        or (e.kind = 'streak_result' and e.score_points = 40)
        or (e.kind = 'journey_result' and exists (
          select 1 from public.challenges c
          where c.id = e.challenge_id
            and c.distance_goal_mi is not null
            and (select coalesce(sum(ps.distance_mi), 0) from public.progress_snapshots ps
                 where ps.challenge_id = e.challenge_id and ps.user_id = p_user) >= c.distance_goal_mi
        ))
      )
  )
  select trophy, count(*)::integer, max(created_at)
  from won
  group by trophy
  order by max(created_at) desc, trophy;
$$;

revoke execute on function public.yard_trophies(uuid) from public, anon, authenticated;
