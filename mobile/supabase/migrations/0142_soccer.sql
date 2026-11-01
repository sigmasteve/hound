-- Hound: Soccer — a match played on everyone's steps, one day at a time.
-- See 0141_soccer_challenge_kind.sql for the enum value this depends on
-- (must already be committed).
--
-- Two teams of one to nine, friends or bots, each player a Forward, a
-- Defender or the Keeper. The match runs for the challenge's days (nine
-- by default: ten minutes of the clock a day) and each day is resolved
-- once it's over everywhere, at 11:00 UTC the next morning, the way
-- Hound'opoly rolls (0136). Every step counts:
--
--   forwards   one shot per shot_steps walked that day (3,000 by default),
--              up to four; the more they walked, the likelier a shot is
--              on target
--   defenders  their average steps lower the chance a shot is on target
--   keeper     their steps raise the chance a shot on target is saved
--
-- Every outcome is a seeded roll (rally_js_rand, 0140): a strong defense
-- makes goals rarer, never impossible, and the same day resolves the
-- same way wherever it's computed. A team with no keeper lets its best
-- defender stand in at 60%; a team with no defense at all concedes
-- freely. Most goals after the last day wins; a level match is a draw.
--
-- The creator names both teams and positions at setup (soccer_players),
-- and only those people can accept the invites. A player who hasn't
-- accepted yet contributes nothing until they do. Late-synced steps don't
-- count for a day already resolved. Like the other games, the tables
-- have no write policies; every write goes through the functions below.
--
-- Run this once, after 0141 (as its own, separately committed
-- transaction), in the SQL Editor. Push notifications need the
-- send-soccer-notification Edge Function deployed and the 'project_url'
-- and 'service_role_key' vault secrets (0093); without them the match
-- still plays, quietly.

create table public.soccer_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  shot_steps int not null default 3000 check (shot_steps between 1000 and 10000),
  goals_a int not null default 0,
  goals_b int not null default 0,
  -- Days resolved so far (1-based count).
  days_played int not null default 0,
  status text not null default 'active' check (status in ('active', 'final')),
  winner_team text check (winner_team in ('a', 'b')),
  updated_at timestamptz not null default now()
);

alter table public.soccer_games enable row level security;
revoke all on public.soccer_games from anon;
revoke insert, update, delete on public.soccer_games from authenticated;

create policy "Participants can view their Soccer match"
  on public.soccer_games for select
  to authenticated
  using (
    exists (
      select 1 from public.challenge_participants cp
      where cp.challenge_id = soccer_games.challenge_id and cp.user_id = auth.uid()
    )
  );

-- Who plays where. Team A is the creator's. A seat holds a person or one
-- of the challenge's bots; player_id is whichever it is.
create table public.soccer_players (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid references public.profiles (id),
  bot_id uuid references public.challenge_bots (id) on delete cascade,
  player_id uuid generated always as (coalesce(user_id, bot_id)) stored,
  team text not null check (team in ('a', 'b')),
  position text not null check (position in ('forward', 'defender', 'keeper')),
  joined boolean not null default false,
  constraint soccer_players_one_kind check ((user_id is null) <> (bot_id is null))
);

create unique index soccer_players_player_idx on public.soccer_players (challenge_id, player_id);
create unique index soccer_players_keeper_idx on public.soccer_players (challenge_id, team) where position = 'keeper';

alter table public.soccer_players enable row level security;
revoke all on public.soccer_players from anon;
revoke insert, update, delete on public.soccer_players from authenticated;

create policy "Participants can view their Soccer line-ups"
  on public.soccer_players for select
  to authenticated
  using (
    exists (
      select 1 from public.challenge_participants cp
      where cp.challenge_id = soccer_players.challenge_id and cp.user_id = auth.uid()
    )
  );

-- One row per resolved day: the day's score and the shot counts.
create table public.soccer_days (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  day_no int not null,
  goals_a int not null default 0,
  goals_b int not null default 0,
  shots_a int not null default 0,
  shots_b int not null default 0,
  on_target_a int not null default 0,
  on_target_b int not null default 0,
  saves_a int not null default 0,
  saves_b int not null default 0,
  resolved_at timestamptz not null default now(),
  primary key (challenge_id, day)
);

alter table public.soccer_days enable row level security;
revoke all on public.soccer_days from anon;
revoke insert, update, delete on public.soccer_days from authenticated;

create policy "Participants can view their Soccer days"
  on public.soccer_days for select
  to authenticated
  using (
    exists (
      select 1 from public.challenge_participants cp
      where cp.challenge_id = soccer_days.challenge_id and cp.user_id = auth.uid()
    )
  );

-- One row per shot: who took it, who was in goal, how it went.
create table public.soccer_events (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  day_no int not null,
  team text not null check (team in ('a', 'b')),
  shooter_id uuid not null,
  keeper_id uuid,
  shooter_steps int not null,
  shot_no int not null,
  outcome text not null check (outcome in ('miss', 'saved', 'goal')),
  created_at timestamptz not null default now()
);

create index soccer_events_challenge_idx on public.soccer_events (challenge_id, day, created_at);

alter table public.soccer_events enable row level security;
revoke all on public.soccer_events from anon;
revoke insert, update, delete on public.soccer_events from authenticated;

create policy "Participants can view their Soccer shots"
  on public.soccer_events for select
  to authenticated
  using (
    exists (
      select 1 from public.challenge_participants cp
      where cp.challenge_id = soccer_events.challenge_id and cp.user_id = auth.uid()
    )
  );

-- The match's first day (0085's start_day, same rule as Hound'opoly).
create or replace function public.soccer_first_day(c public.challenges)
returns date
language sql
immutable
as $$
  select coalesce(c.start_day, (c.starts_at at time zone 'America/New_York')::date);
$$;

revoke execute on function public.soccer_first_day(public.challenges) from public, anon, authenticated;

-- A player's steps on one day: a person's synced row, or a bot's
-- simulated day (0140's rally_bot_day_steps, day 0 being the first day).
create or replace function public.soccer_steps(p_challenge_id uuid, p_player uuid, p_day date, p_first_day date)
returns int
language plpgsql
stable
as $$
declare
  lvl text;
begin
  select fitness_level::text into lvl from public.challenge_bots where id = p_player and challenge_id = p_challenge_id;
  if lvl is not null then
    return round(public.rally_bot_day_steps(p_player, lvl, (p_day - p_first_day)))::int;
  end if;
  return coalesce((select ps.steps from public.progress_snapshots ps
    where ps.challenge_id = p_challenge_id and ps.user_id = p_player and ps.day = p_day), 0);
end;
$$;

revoke execute on function public.soccer_steps(uuid, uuid, date, date) from public, anon, authenticated;

create or replace function public.soccer_notify(p_kind text, p_challenge_id uuid, p_recipient uuid, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_recipient is null or not exists (select 1 from public.profiles p where p.id = p_recipient) then
    return;
  end if;
  perform net.http_post(
    url := public.edge_function_url('send-soccer-notification'),
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

revoke execute on function public.soccer_notify(text, uuid, uuid, jsonb) from public, anon, authenticated;

-- The creator sets the shot size and both line-ups right after creating
-- the challenge: a JSON list of {id, team, position}, the creator among
-- them on team A. An id is a friend (who still has to accept) or one of
-- this challenge's bots (in from the start).
create or replace function public.soccer_setup(p_challenge_id uuid, p_shot_steps int, p_players jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  r record;
  n_a int;
  n_b int;
begin
  if not exists (
    select 1 from public.challenges c
    where c.id = p_challenge_id and c.kind = 'soccer' and c.created_by = caller
  ) then
    raise exception 'Only the creator can set up this match.';
  end if;
  if p_shot_steps is null or p_shot_steps < 1000 or p_shot_steps > 10000 then
    raise exception 'A shot is between 1,000 and 10,000 steps.';
  end if;
  if exists (select 1 from public.soccer_days d where d.challenge_id = p_challenge_id) then
    raise exception 'This match is under way — the line-ups can''t change now.';
  end if;
  if jsonb_typeof(p_players) != 'array' or jsonb_array_length(p_players) < 2 or jsonb_array_length(p_players) > 18 then
    raise exception 'A match needs two to eighteen players.';
  end if;
  if (select count(distinct e->>'id') from jsonb_array_elements(p_players) e) != jsonb_array_length(p_players) then
    raise exception 'Everyone in the match has to be a different person.';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_players) e where (e->>'id')::uuid = caller and e->>'team' = 'a') then
    raise exception 'You play on your own team.';
  end if;
  for r in select (e->>'id')::uuid as id, e->>'team' as team, e->>'position' as position from jsonb_array_elements(p_players) e loop
    if r.team not in ('a', 'b') or r.position not in ('forward', 'defender', 'keeper') then
      raise exception 'Each player is a forward, a defender or the keeper, on team A or B.';
    end if;
    if r.id != caller
      and not exists (select 1 from public.profiles p where p.id = r.id)
      and not exists (select 1 from public.challenge_bots b where b.id = r.id and b.challenge_id = p_challenge_id) then
      raise exception 'One of the players isn''t a person or one of this challenge''s bots.';
    end if;
  end loop;
  select count(*) filter (where e->>'team' = 'a'), count(*) filter (where e->>'team' = 'b') into n_a, n_b from jsonb_array_elements(p_players) e;
  if n_a < 1 or n_b < 1 or n_a > 9 or n_b > 9 then
    raise exception 'Each team has one to nine players.';
  end if;
  if (select count(*) from jsonb_array_elements(p_players) e where e->>'position' = 'keeper' and e->>'team' = 'a') > 1
    or (select count(*) from jsonb_array_elements(p_players) e where e->>'position' = 'keeper' and e->>'team' = 'b') > 1 then
    raise exception 'One keeper a team.';
  end if;

  insert into public.soccer_games (challenge_id, shot_steps)
    values (p_challenge_id, p_shot_steps)
    on conflict (challenge_id) do update set shot_steps = excluded.shot_steps, updated_at = now();

  delete from public.soccer_players where challenge_id = p_challenge_id;
  insert into public.soccer_players (challenge_id, user_id, bot_id, team, position, joined)
  select p_challenge_id,
    case when is_bot then null else pid end,
    case when is_bot then pid else null end,
    e->>'team', e->>'position',
    is_bot or exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = pid)
  from jsonb_array_elements(p_players) e
  cross join lateral (select (e->>'id')::uuid as pid) i
  cross join lateral (select exists (select 1 from public.challenge_bots b where b.id = i.pid and b.challenge_id = p_challenge_id) as is_bot) k;
end;
$$;

revoke execute on function public.soccer_setup(uuid, int, jsonb) from public, anon;
grant execute on function public.soccer_setup(uuid, int, jsonb) to authenticated;

-- Only the people the creator named can join. Before the line-ups are
-- set, only the creator's own row (the first one) gets in.
create or replace function public.soccer_before_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.challenges c where c.id = new.challenge_id and c.kind = 'soccer') then
    return new;
  end if;
  if exists (select 1 from public.soccer_players p where p.challenge_id = new.challenge_id) then
    if not exists (select 1 from public.soccer_players p where p.challenge_id = new.challenge_id and p.user_id = new.user_id) then
      raise exception 'This match''s line-ups are already set.';
    end if;
  elsif exists (select 1 from public.challenge_participants cp where cp.challenge_id = new.challenge_id) then
    raise exception 'This match isn''t set up yet.';
  end if;
  return new;
end;
$$;

revoke execute on function public.soccer_before_join() from public, anon, authenticated;

create trigger soccer_before_join
  before insert on public.challenge_participants
  for each row execute procedure public.soccer_before_join();

create or replace function public.soccer_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.soccer_players set joined = true
    where challenge_id = new.challenge_id and user_id = new.user_id and not joined;
  return new;
end;
$$;

revoke execute on function public.soccer_after_join() from public, anon, authenticated;

create trigger soccer_after_join
  after insert on public.challenge_participants
  for each row execute procedure public.soccer_after_join();

-- Resolves one day: both teams' shots, with every roll seeded by the
-- challenge, the day, the shooter and the shot, so it comes out the same
-- anywhere. Internal; soccer_advance holds the challenge row lock.
create or replace function public.soccer_play_day(p_challenge_id uuid, p_day date, p_day_no int, p_first_day date)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.soccer_games%rowtype;
  t text;
  o text;
  f record;
  defense numeric;
  keeper_steps numeric;
  keeper_id uuid;
  s int;
  shots int;
  i int;
  p_on double precision;
  p_save double precision;
  outcome text;
  goals int;
  tot_shots int;
  tot_on int;
  tot_saves int;
  day_goals_a int := 0;
  day_goals_b int := 0;
  shots_a int := 0;
  shots_b int := 0;
  on_a int := 0;
  on_b int := 0;
  saves_a int := 0;
  saves_b int := 0;
begin
  select * into g from public.soccer_games where challenge_id = p_challenge_id;

  foreach t in array array['a', 'b'] loop
    o := case when t = 'a' then 'b' else 'a' end;
    goals := 0; tot_shots := 0; tot_on := 0; tot_saves := 0;

    -- The other side's defense: their defenders' and keeper's average
    -- steps, and the keeper's own (a stand-in defender at 60% without one).
    select coalesce(avg(public.soccer_steps(p_challenge_id, p.player_id, p_day, p_first_day)), 0) into defense
      from public.soccer_players p
      where p.challenge_id = p_challenge_id and p.team = o and p.joined and p.position in ('defender', 'keeper');
    select p.player_id, public.soccer_steps(p_challenge_id, p.player_id, p_day, p_first_day) into keeper_id, keeper_steps
      from public.soccer_players p
      where p.challenge_id = p_challenge_id and p.team = o and p.joined and p.position = 'keeper';
    if keeper_id is null then
      select p.player_id, public.soccer_steps(p_challenge_id, p.player_id, p_day, p_first_day) * 0.6 into keeper_id, keeper_steps
        from public.soccer_players p
        where p.challenge_id = p_challenge_id and p.team = o and p.joined and p.position = 'defender'
        order by public.soccer_steps(p_challenge_id, p.player_id, p_day, p_first_day) desc
        limit 1;
    end if;
    keeper_steps := coalesce(keeper_steps, 0);

    for f in
      select p.player_id from public.soccer_players p
      where p.challenge_id = p_challenge_id and p.team = t and p.joined and p.position = 'forward'
      order by p.player_id
    loop
      s := public.soccer_steps(p_challenge_id, f.player_id, p_day, p_first_day);
      shots := least(4, floor(s::numeric / g.shot_steps))::int;
      for i in 1..shots loop
        p_on := least(0.80, greatest(0.15, 0.20 + 0.40 * s / nullif(s + defense, 0)));
        if public.rally_js_rand(public.rally_js_hash(p_challenge_id::text || ':' || p_day || ':' || f.player_id || ':' || i || ':on')) >= p_on then
          outcome := 'miss';
        else
          p_save := least(0.85, greatest(0.05, 0.25 + 0.55 * keeper_steps / nullif(keeper_steps + s, 0)));
          if public.rally_js_rand(public.rally_js_hash(p_challenge_id::text || ':' || p_day || ':' || f.player_id || ':' || i || ':save')) < p_save then
            outcome := 'saved';
          else
            outcome := 'goal';
          end if;
        end if;
        insert into public.soccer_events (challenge_id, day, day_no, team, shooter_id, keeper_id, shooter_steps, shot_no, outcome)
          values (p_challenge_id, p_day, p_day_no, t, f.player_id, keeper_id, s, i, outcome);
        tot_shots := tot_shots + 1;
        if outcome != 'miss' then tot_on := tot_on + 1; end if;
        if outcome = 'saved' then tot_saves := tot_saves + 1; end if;
        if outcome = 'goal' then goals := goals + 1; end if;
      end loop;
    end loop;

    if t = 'a' then
      day_goals_a := goals; shots_a := tot_shots; on_a := tot_on; saves_b := tot_saves;
    else
      day_goals_b := goals; shots_b := tot_shots; on_b := tot_on; saves_a := tot_saves;
    end if;
  end loop;

  insert into public.soccer_days (challenge_id, day, day_no, goals_a, goals_b, shots_a, shots_b, on_target_a, on_target_b, saves_a, saves_b)
    values (p_challenge_id, p_day, p_day_no, day_goals_a, day_goals_b, shots_a, shots_b, on_a, on_b, saves_a, saves_b);
  update public.soccer_games
    set goals_a = goals_a + day_goals_a, goals_b = goals_b + day_goals_b, days_played = p_day_no, updated_at = now()
    where challenge_id = p_challenge_id;
end;
$$;

revoke execute on function public.soccer_play_day(uuid, date, int, date) from public, anon, authenticated;

-- Resolves every day that's over everywhere (yesterday, UTC, once 11:00
-- UTC has passed) and not yet played, then ends the match after its last
-- day. Callable by any participant (the app calls it on load); the
-- nightly job calls it for every running match.
create or replace function public.soccer_advance(p_challenge_id uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.soccer_games%rowtype;
  caller uuid := auth.uid();
  first_day date;
  last_day date;
  cutoff date;
  d date;
  n int := 0;
  r record;
  extra jsonb;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.kind <> 'soccer' then
    return 0;
  end if;
  if caller is not null and not exists (
    select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller
  ) then
    return 0;
  end if;
  select * into g from public.soccer_games where challenge_id = p_challenge_id;
  if not found or g.status != 'active' then
    return 0;
  end if;
  first_day := public.soccer_first_day(c);
  last_day := first_day + c.duration_days - 1;
  cutoff := (now() at time zone 'utc')::date - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end;

  for d in
    select s::date from generate_series(first_day::timestamp, least(last_day, cutoff)::timestamp, interval '1 day') s
    where not exists (select 1 from public.soccer_days sd where sd.challenge_id = p_challenge_id and sd.day = s::date)
    order by s
  loop
    perform public.soccer_play_day(p_challenge_id, d, (d - first_day) + 1, first_day);
    n := n + 1;
    select * into g from public.soccer_games where challenge_id = p_challenge_id;
    if d = last_day then
      update public.soccer_games
        set status = 'final',
            winner_team = case when g.goals_a > g.goals_b then 'a' when g.goals_b > g.goals_a then 'b' else null end,
            updated_at = now()
        where challenge_id = p_challenge_id;
      select * into g from public.soccer_games where challenge_id = p_challenge_id;
    end if;
    select jsonb_build_object('day_no', (d - first_day) + 1, 'days', c.duration_days, 'goals_a', g.goals_a, 'goals_b', g.goals_b,
      'today_a', sd.goals_a, 'today_b', sd.goals_b, 'shots_a', sd.shots_a, 'shots_b', sd.shots_b,
      'on_target_a', sd.on_target_a, 'on_target_b', sd.on_target_b, 'saves_a', sd.saves_a, 'saves_b', sd.saves_b,
      'winner_team', g.winner_team)
      into extra from public.soccer_days sd where sd.challenge_id = p_challenge_id and sd.day = d;
    for r in select user_id from public.soccer_players p where p.challenge_id = p_challenge_id and p.user_id is not null and p.joined loop
      perform public.soccer_notify(case when g.status = 'final' then 'final' else 'day' end, p_challenge_id, r.user_id, extra);
    end loop;
  end loop;
  return n;
end;
$$;

revoke execute on function public.soccer_advance(uuid) from public, anon;
grant execute on function public.soccer_advance(uuid) to authenticated;

create or replace function public.soccer_advance_all()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.id from public.challenges c
    join public.soccer_games g on g.challenge_id = c.id
    where c.kind = 'soccer' and g.status = 'active' and c.starts_at < now()
    order by c.starts_at
  loop
    begin
      n := n + public.soccer_advance(r.id);
    exception when others then
      raise warning 'soccer_advance_all: % failed: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;

revoke execute on function public.soccer_advance_all() from public, anon, authenticated;

-- Every morning once the day is over everywhere, a little after
-- Hound'opoly's roll.
select cron.schedule('hound-soccer-advance', '25 11 * * *', $$ select public.soccer_advance_all(); $$);

-- Scoring: 0140's core with a Soccer branch; 0140's wrapper, with a
-- Soccer match settling on its own state like a Rally.
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
  if c.kind::text in ('rally', 'soccer') then
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
