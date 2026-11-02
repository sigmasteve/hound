-- Hound: Cricket — a limited-overs match on everyone's steps, one over a
-- day. See 0146_cricket_challenge_kind.sql for the enum value this
-- depends on (must already be committed).
--
-- Two teams of one to nine, friends or bots. A seeded toss decides who
-- bats first. Each innings has floor(days / 2) overs (five for the
-- default ten days; an odd last day is a rest day), and each day of an
-- innings is one over, played once the day is over everywhere (11:00 UTC
-- the next morning, like Soccer and Hound'opoly):
--
--   the bowler   the fielding side takes turns, one over each, in order
--   the batter   the batting side bats in order; a wicket brings in the
--                next batter, who faces the rest of the over
--   each ball    a seeded roll on the batter's share of the two players'
--                steps that day, r = batter / (batter + bowler):
--                  out   20% - 30% x r            (2% to 20%)
--                  six   30% x r - 8%             (0% to 20%)
--                  four  36% x r - 6%             (2% to 25%)
--                  the rest: a two (15% of it), a dot (55% - 30% x r of
--                  it), otherwise a single
--                Level steps: about one wicket every three overs and
--                seven runs an over; out-walk your bowler two to one and
--                it's closer to eleven an over, with a wicket rare.
--
-- An innings ends after its overs, or when the side loses max(3, its
-- size) wickets — a one- or two-player side gets three lives. The second
-- side chases the first innings plus one: reach it and they win at once;
-- otherwise the first side wins by the runs short, or it's a tie. The
-- second innings starts the day after the first ends, so a collapse
-- brings the chase forward and the match can finish early (ends_at is
-- pulled in, 0057's trick).
--
-- The creator names both sides at setup (cricket_players; the batting
-- order is the order they're named), and only those people can accept
-- the invites. A seat can be added later (cricket_add_player). Bots bat
-- and bowl on simulated steps (soccer_steps, 0142). Like the other
-- games, the tables have no write policies; every write goes through the
-- functions below.
--
-- Run this once, after 0146 (as its own, separately committed
-- transaction), in the SQL Editor. Push notifications need the
-- send-cricket-notification Edge Function deployed; without it the match
-- still plays, quietly.

create table public.cricket_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  overs int not null check (overs between 1 and 50),
  batting_first text not null check (batting_first in ('a', 'b')),
  innings int not null default 1 check (innings in (1, 2)),
  runs_a int not null default 0,
  wickets_a int not null default 0,
  balls_a int not null default 0,
  runs_b int not null default 0,
  wickets_b int not null default 0,
  balls_b int not null default 0,
  -- The second side's target, once the first innings is over.
  target int,
  status text not null default 'active' check (status in ('active', 'final')),
  -- Null on a tie.
  winner_team text check (winner_team in ('a', 'b')),
  -- 'chased', 'defended' or 'tie'.
  result text check (result in ('chased', 'defended', 'tie')),
  updated_at timestamptz not null default now()
);

alter table public.cricket_games enable row level security;
revoke all on public.cricket_games from anon;
revoke insert, update, delete on public.cricket_games from authenticated;
create policy "Participants can view their Cricket match"
  on public.cricket_games for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = cricket_games.challenge_id and cp.user_id = auth.uid()));

create table public.cricket_players (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid references public.profiles (id),
  bot_id uuid references public.challenge_bots (id) on delete cascade,
  player_id uuid generated always as (coalesce(user_id, bot_id)) stored,
  team text not null check (team in ('a', 'b')),
  -- Batting order within the side, from 1.
  seat int not null,
  joined boolean not null default false,
  constraint cricket_players_one_kind check ((user_id is null) <> (bot_id is null))
);
create unique index cricket_players_player_idx on public.cricket_players (challenge_id, player_id);
create unique index cricket_players_seat_idx on public.cricket_players (challenge_id, team, seat);

alter table public.cricket_players enable row level security;
revoke all on public.cricket_players from anon;
revoke insert, update, delete on public.cricket_players from authenticated;
create policy "Participants can view their Cricket sides"
  on public.cricket_players for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = cricket_players.challenge_id and cp.user_id = auth.uid()));

-- One row per played day: which innings and over it was (null on a rest
-- day or after the match), and what the over brought.
create table public.cricket_days (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  day_no int not null,
  innings int,
  over_no int,
  batting_team text check (batting_team in ('a', 'b')),
  bowler_id uuid,
  runs int not null default 0,
  wickets int not null default 0,
  resolved_at timestamptz not null default now(),
  primary key (challenge_id, day)
);
alter table public.cricket_days enable row level security;
revoke all on public.cricket_days from anon;
revoke insert, update, delete on public.cricket_days from authenticated;
create policy "Participants can view their Cricket days"
  on public.cricket_days for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = cricket_days.challenge_id and cp.user_id = auth.uid()));

-- Every ball.
create table public.cricket_balls (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  day_no int not null,
  innings int not null,
  over_no int not null,
  ball_no int not null,
  batting_team text not null check (batting_team in ('a', 'b')),
  batter_id uuid not null,
  bowler_id uuid not null,
  batter_steps int not null,
  bowler_steps int not null,
  outcome text not null check (outcome in ('0', '1', '2', '4', '6', 'W')),
  runs int not null,
  created_at timestamptz not null default now()
);
create index cricket_balls_challenge_idx on public.cricket_balls (challenge_id, innings, over_no, ball_no);
alter table public.cricket_balls enable row level security;
revoke all on public.cricket_balls from anon;
revoke insert, update, delete on public.cricket_balls from authenticated;
create policy "Participants can view their Cricket balls"
  on public.cricket_balls for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = cricket_balls.challenge_id and cp.user_id = auth.uid()));

-- One ball, from the batter's share of the steps and a 0-1 roll.
create or replace function public.cricket_ball_outcome(p_share double precision, p_roll double precision)
returns text
language plpgsql
immutable
as $$
declare
  r double precision := least(1, greatest(0, coalesce(p_share, 0.5)));
  p_out double precision := least(0.20, greatest(0.02, 0.20 - 0.30 * r));
  p_six double precision := least(0.20, greatest(0, 0.30 * r - 0.08));
  p_four double precision := least(0.25, greatest(0.02, 0.36 * r - 0.06));
  rest double precision;
  p_two double precision;
  p_dot double precision;
  x double precision := p_roll;
begin
  rest := 1 - p_out - p_six - p_four;
  p_two := rest * 0.15;
  p_dot := rest * (0.55 - 0.30 * r);
  if x < p_out then return 'W'; end if;
  x := x - p_out;
  if x < p_six then return '6'; end if;
  x := x - p_six;
  if x < p_four then return '4'; end if;
  x := x - p_four;
  if x < p_two then return '2'; end if;
  x := x - p_two;
  if x < p_dot then return '0'; end if;
  return '1';
end;
$$;

grant execute on function public.cricket_ball_outcome(double precision, double precision) to authenticated;
revoke execute on function public.cricket_ball_outcome(double precision, double precision) from public, anon;

create or replace function public.cricket_notify(p_kind text, p_challenge_id uuid, p_recipient uuid, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_recipient is null or not exists (select 1 from public.profiles p where p.id = p_recipient) then
    return;
  end if;
  perform net.http_post(
    url := public.edge_function_url('send-cricket-notification'),
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

revoke execute on function public.cricket_notify(text, uuid, uuid, jsonb) from public, anon, authenticated;

-- The creator names both sides right after creating the challenge: a JSON
-- list of {id, team}, the creator on team A, in batting order. An id is a
-- friend (who still has to accept) or one of this challenge's bots.
create or replace function public.cricket_setup(p_challenge_id uuid, p_players jsonb)
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
  if not found or c.kind <> 'cricket' or c.created_by is distinct from caller then
    raise exception 'Only the creator can set up this match.';
  end if;
  if c.duration_days < 2 then
    raise exception 'A match needs at least two days, one an innings.';
  end if;
  if exists (select 1 from public.cricket_days d where d.challenge_id = p_challenge_id) then
    raise exception 'This match is under way — the sides can''t change now.';
  end if;
  if jsonb_typeof(p_players) != 'array' or jsonb_array_length(p_players) < 2 or jsonb_array_length(p_players) > 18 then
    raise exception 'A match needs two to eighteen players.';
  end if;
  if (select count(distinct e->>'id') from jsonb_array_elements(p_players) e) != jsonb_array_length(p_players) then
    raise exception 'Everyone in the match has to be a different person.';
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

  insert into public.cricket_games (challenge_id, overs, batting_first)
    values (p_challenge_id, c.duration_days / 2,
      case when public.rally_js_rand(public.rally_js_hash(p_challenge_id::text || ':toss')) < 0.5 then 'a' else 'b' end)
    on conflict (challenge_id) do update set overs = excluded.overs, updated_at = now();

  delete from public.cricket_players where challenge_id = p_challenge_id;
  insert into public.cricket_players (challenge_id, user_id, bot_id, team, seat, joined)
  select p_challenge_id,
    case when is_bot then null else pid end,
    case when is_bot then pid else null end,
    e.value->>'team',
    row_number() over (partition by e.value->>'team' order by e.ordinality),
    is_bot or exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = pid)
  from jsonb_array_elements(p_players) with ordinality e
  cross join lateral (select (e.value->>'id')::uuid as pid) i
  cross join lateral (select exists (select 1 from public.challenge_bots b where b.id = i.pid and b.challenge_id = p_challenge_id) as is_bot) k;
end;
$$;

revoke execute on function public.cricket_setup(uuid, jsonb) from public, anon;
grant execute on function public.cricket_setup(uuid, jsonb) to authenticated;

-- A seat added after the match is made, at the end of that side's order.
create or replace function public.cricket_add_player(p_challenge_id uuid, p_user_id uuid, p_team text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.challenges c where c.id = p_challenge_id and c.kind = 'cricket' and c.created_by = auth.uid()) then
    raise exception 'Only the creator can change the sides.';
  end if;
  if not exists (select 1 from public.cricket_games g where g.challenge_id = p_challenge_id and g.status = 'active') then
    raise exception 'This match is over.';
  end if;
  if p_team not in ('a', 'b') then
    raise exception 'Pick side A or B.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'That person isn''t on Hound.';
  end if;
  if exists (select 1 from public.cricket_players p where p.challenge_id = p_challenge_id and p.user_id = p_user_id) then
    raise exception 'They already have a seat in this match.';
  end if;
  if (select count(*) from public.cricket_players p where p.challenge_id = p_challenge_id and p.team = p_team) >= 9 then
    raise exception 'That side already has nine players.';
  end if;
  insert into public.cricket_players (challenge_id, user_id, team, seat, joined)
  values (p_challenge_id, p_user_id, p_team,
    coalesce((select max(seat) from public.cricket_players p where p.challenge_id = p_challenge_id and p.team = p_team), 0) + 1,
    exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = p_user_id));
end;
$$;

revoke execute on function public.cricket_add_player(uuid, uuid, text) from public, anon;
grant execute on function public.cricket_add_player(uuid, uuid, text) to authenticated;

create or replace function public.cricket_before_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.challenges c where c.id = new.challenge_id and c.kind = 'cricket') then
    return new;
  end if;
  if exists (select 1 from public.cricket_players p where p.challenge_id = new.challenge_id) then
    if not exists (select 1 from public.cricket_players p where p.challenge_id = new.challenge_id and p.user_id = new.user_id) then
      raise exception 'This match''s sides are already set.';
    end if;
  elsif exists (select 1 from public.challenge_participants cp where cp.challenge_id = new.challenge_id) then
    raise exception 'This match isn''t set up yet.';
  end if;
  return new;
end;
$$;

revoke execute on function public.cricket_before_join() from public, anon, authenticated;
create trigger cricket_before_join before insert on public.challenge_participants
  for each row execute procedure public.cricket_before_join();

create or replace function public.cricket_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.cricket_players set joined = true where challenge_id = new.challenge_id and user_id = new.user_id and not joined;
  return new;
end;
$$;

revoke execute on function public.cricket_after_join() from public, anon, authenticated;
create trigger cricket_after_join after insert on public.challenge_participants
  for each row execute procedure public.cricket_after_join();

-- Who is on for the next over to be played: the innings, the over, the
-- batter on strike and the bowler. Nothing once the match is over.
create or replace function public.cricket_on_strike(p_challenge_id uuid)
returns table (innings int, over_no int, batting_team text, batter_id uuid, bowler_id uuid)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  g public.cricket_games%rowtype;
  bt text;
  ft text;
  done_overs int;
  wk int;
  nb int;
  nf int;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = auth.uid()) then
    return;
  end if;
  select * into g from public.cricket_games where challenge_id = p_challenge_id;
  if not found or g.status <> 'active' then
    return;
  end if;
  bt := case when g.innings = 1 then g.batting_first else (case when g.batting_first = 'a' then 'b' else 'a' end) end;
  ft := case when bt = 'a' then 'b' else 'a' end;
  select count(*) into done_overs from public.cricket_days d where d.challenge_id = p_challenge_id and d.innings = g.innings;
  wk := case when bt = 'a' then g.wickets_a else g.wickets_b end;
  select count(*) into nb from public.cricket_players p where p.challenge_id = p_challenge_id and p.team = bt and p.joined;
  select count(*) into nf from public.cricket_players p where p.challenge_id = p_challenge_id and p.team = ft and p.joined;
  if nb = 0 or nf = 0 then
    return;
  end if;
  return query
    select g.innings, done_overs + 1, bt,
      (select p.player_id from public.cricket_players p where p.challenge_id = p_challenge_id and p.team = bt and p.joined order by p.seat offset (wk % nb) limit 1),
      (select p.player_id from public.cricket_players p where p.challenge_id = p_challenge_id and p.team = ft and p.joined order by p.seat offset (done_overs % nf) limit 1);
end;
$$;

revoke execute on function public.cricket_on_strike(uuid) from public, anon;
grant execute on function public.cricket_on_strike(uuid) to authenticated;

-- Plays one day: the next over of the current innings, ball by ball, then
-- moves the innings on or ends the match. A day with no over to play (a
-- rest day, or after the match) is still recorded. Internal.
create or replace function public.cricket_play_day(p_challenge_id uuid, p_day date, p_day_no int, p_first_day date)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.cricket_games%rowtype;
  bt text;
  ft text;
  over_no int;
  batters uuid[];
  fielders uuid[];
  nb int;
  bowler uuid;
  w int;
  batter uuid;
  b int;
  runs int;
  wk int;
  allowed int;
  ball int;
  outcome text;
  over_runs int := 0;
  over_wk int := 0;
  bowled int := 0;
  innings_over boolean := false;
  chased boolean := false;
begin
  select * into g from public.cricket_games where challenge_id = p_challenge_id;
  if g.status <> 'active' then
    insert into public.cricket_days (challenge_id, day, day_no) values (p_challenge_id, p_day, p_day_no);
    return;
  end if;
  bt := case when g.innings = 1 then g.batting_first else (case when g.batting_first = 'a' then 'b' else 'a' end) end;
  ft := case when bt = 'a' then 'b' else 'a' end;
  select count(*) + 1 into over_no from public.cricket_days d where d.challenge_id = p_challenge_id and d.innings = g.innings;
  select array_agg(p.player_id order by p.seat) into batters from public.cricket_players p where p.challenge_id = p_challenge_id and p.team = bt and p.joined;
  select array_agg(p.player_id order by p.seat) into fielders from public.cricket_players p where p.challenge_id = p_challenge_id and p.team = ft and p.joined;
  if batters is null or fielders is null then
    -- Nobody to bat or bowl yet: the day passes without an over.
    insert into public.cricket_days (challenge_id, day, day_no) values (p_challenge_id, p_day, p_day_no);
    return;
  end if;
  nb := array_length(batters, 1);
  allowed := greatest(3, nb);
  runs := case when bt = 'a' then g.runs_a else g.runs_b end;
  wk := case when bt = 'a' then g.wickets_a else g.wickets_b end;
  bowler := fielders[((over_no - 1) % array_length(fielders, 1)) + 1];
  w := public.soccer_steps(p_challenge_id, bowler, p_day, p_first_day);

  for ball in 1..6 loop
    batter := batters[(wk % nb) + 1];
    b := public.soccer_steps(p_challenge_id, batter, p_day, p_first_day);
    bowled := bowled + 1;
    outcome := public.cricket_ball_outcome(
      case when b + w = 0 then 0.5 else b::double precision / (b + w) end,
      public.rally_js_rand(public.rally_js_hash(p_challenge_id::text || ':' || p_day || ':' || g.innings || ':' || over_no || ':' || ball)));
    insert into public.cricket_balls (challenge_id, day, day_no, innings, over_no, ball_no, batting_team, batter_id, bowler_id, batter_steps, bowler_steps, outcome, runs)
      values (p_challenge_id, p_day, p_day_no, g.innings, over_no, ball, bt, batter, bowler, b, w, outcome,
              case when outcome = 'W' then 0 else outcome::int end);
    if outcome = 'W' then
      wk := wk + 1; over_wk := over_wk + 1;
    else
      runs := runs + outcome::int; over_runs := over_runs + outcome::int;
    end if;
    if wk >= allowed then innings_over := true; exit; end if;
    if g.innings = 2 and runs >= g.target then chased := true; exit; end if;
  end loop;
  if over_no >= g.overs then innings_over := true; end if;

  insert into public.cricket_days (challenge_id, day, day_no, innings, over_no, batting_team, bowler_id, runs, wickets)
    values (p_challenge_id, p_day, p_day_no, g.innings, over_no, bt, bowler, over_runs, over_wk);
  update public.cricket_games
    set runs_a = case when bt = 'a' then runs else runs_a end,
        wickets_a = case when bt = 'a' then wk else wickets_a end,
        balls_a = balls_a + case when bt = 'a' then bowled else 0 end,
        runs_b = case when bt = 'b' then runs else runs_b end,
        wickets_b = case when bt = 'b' then wk else wickets_b end,
        balls_b = balls_b + case when bt = 'b' then bowled else 0 end,
        updated_at = now()
    where challenge_id = p_challenge_id;

  if g.innings = 1 and innings_over then
    update public.cricket_games set innings = 2, target = runs + 1, updated_at = now() where challenge_id = p_challenge_id;
  elsif g.innings = 2 and (chased or innings_over) then
    update public.cricket_games
      set status = 'final',
          winner_team = case when runs >= g.target then bt when runs = g.target - 1 then null else ft end,
          result = case when runs >= g.target then 'chased' when runs = g.target - 1 then 'tie' else 'defended' end,
          updated_at = now()
      where challenge_id = p_challenge_id;
    update public.challenges set ends_at = now() where id = p_challenge_id and ends_at > now();
  end if;
end;
$$;

revoke execute on function public.cricket_play_day(uuid, date, int, date) from public, anon, authenticated;

-- Plays every day that's over everywhere (yesterday, UTC, once 11:00 UTC
-- has passed) and not yet played. Callable by any participant (the app
-- calls it on load); the morning job calls it for every running match.
create or replace function public.cricket_advance(p_challenge_id uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.cricket_games%rowtype;
  caller uuid := auth.uid();
  first_day date;
  last_day date;
  cutoff date;
  d date;
  n int := 0;
  r record;
  nxt record;
  extra jsonb;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.kind <> 'cricket' then
    return 0;
  end if;
  if caller is not null and not exists (
    select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller) then
    return 0;
  end if;
  select * into g from public.cricket_games where challenge_id = p_challenge_id;
  if not found or g.status <> 'active' then
    return 0;
  end if;
  first_day := public.soccer_first_day(c);
  last_day := first_day + c.duration_days - 1;
  cutoff := (now() at time zone 'utc')::date - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end;

  for d in
    select s::date from generate_series(first_day::timestamp, least(last_day, cutoff)::timestamp, interval '1 day') s
    where not exists (select 1 from public.cricket_days cd where cd.challenge_id = p_challenge_id and cd.day = s::date)
    order by s
  loop
    select * into g from public.cricket_games where challenge_id = p_challenge_id;
    exit when g.status <> 'active';
    perform public.cricket_play_day(p_challenge_id, d, (d - first_day) + 1, first_day);
    n := n + 1;
  end loop;

  if n > 0 then
    select * into g from public.cricket_games where challenge_id = p_challenge_id;
    select * into nxt from public.cricket_on_strike(p_challenge_id);
    extra := jsonb_build_object('status', g.status, 'innings', g.innings, 'runs_a', g.runs_a, 'wickets_a', g.wickets_a, 'balls_a', g.balls_a,
      'runs_b', g.runs_b, 'wickets_b', g.wickets_b, 'balls_b', g.balls_b, 'target', g.target, 'winner_team', g.winner_team, 'result', g.result,
      'batting_first', g.batting_first, 'batter_id', nxt.batter_id, 'bowler_id', nxt.bowler_id, 'over_no', nxt.over_no);
    for r in select user_id from public.cricket_players p where p.challenge_id = p_challenge_id and p.user_id is not null and p.joined loop
      perform public.cricket_notify(case when g.status = 'final' then 'final' else 'day' end, p_challenge_id, r.user_id, extra);
    end loop;
  end if;
  return n;
end;
$$;

revoke execute on function public.cricket_advance(uuid) from public, anon;
grant execute on function public.cricket_advance(uuid) to authenticated;

create or replace function public.cricket_advance_all()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.id from public.challenges c join public.cricket_games g on g.challenge_id = c.id
    where c.kind = 'cricket' and g.status = 'active' and c.starts_at < now()
    order by c.starts_at
  loop
    begin
      n := n + public.cricket_advance(r.id);
    exception when others then
      raise warning 'cricket_advance_all: % failed: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;

revoke execute on function public.cricket_advance_all() from public, anon, authenticated;

select cron.schedule('hound-cricket-advance', '35 11 * * *', $$ select public.cricket_advance_all(); $$);

-- Scoring: 0142's core with a Cricket branch; 0142's wrapper, with a
-- Cricket match settling on its own state like Soccer.
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
  if c.kind::text in ('rally', 'soccer', 'cricket') then
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
