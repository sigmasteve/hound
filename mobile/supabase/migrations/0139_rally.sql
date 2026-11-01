-- Hound: Rally — badminton on your steps. See 0138_rally_challenge_kind.sql
-- for the enum value this depends on (must already be committed).
--
-- Singles or doubles. The shuttle is always on one team's side, with one
-- player due to return it: a step target and a deadline. Walk the target
-- before the deadline and the shuttle crosses to the other side with a
-- target 15% bigger. Miss the deadline and the other team scores. Rally
-- scoring, as in real badminton: every rally ends in a point, a game
-- goes to 21 (win by two, capped at 30), best of three games wins the
-- match. The team that lost the point receives the next serve, at the
-- base target again. In doubles the return duty alternates between the
-- two partners, so one strong walker can't carry the pair.
--
-- A smash, once per game per team: arm it while the shuttle is on your
-- side and your own return now needs double the target; land it and the
-- other team's next target doubles too. Miss it and the point is theirs
-- like any miss.
--
-- Steps come from progress_snapshots, the same daily rows every steps
-- challenge syncs (deviceSync.ts). A return is "your cumulative total for
-- this challenge grew by the target since the shuttle arrived", measured
-- server-side from those rows (tag_metric_total, 0045), never from a
-- number the client claims. A player whose phone last synced hours
-- before the shuttle arrived gets those hours' steps for free; that's the
-- same generosity Tag's own snapshots have, and the window is what keeps
-- it fair.
--
-- Deadlines skip the night: a return window counts only 07:00 to 21:00
-- in the returning player's own time zone (profiles.time_zone, 0088;
-- UTC when unknown). The "rest of the day" window ends at 21:00 local,
-- or at 21:00 the next day when the shuttle arrives after 19:00.
--
-- The creator names the teams at setup (rally_players): themselves and,
-- for doubles, a partner against one or two opponents. Only those people
-- can accept the invites, and the match starts when the last of them
-- joins. Like Tag's tag_rounds and Tic-Tac-Go's tictacgo_games, the
-- tables have no write policies at all; every write goes through the
-- security-definer functions below. When the match ends, the challenge's
-- ends_at is pulled in to now() (0057's own trick), so every existing
-- "is this challenge finished" check treats it as over.
--
-- Run this once, after 0138 (as its own, separately committed
-- transaction), in the SQL Editor. Push notifications need the
-- send-rally-notification Edge Function deployed and the 'project_url'
-- and 'service_role_key' vault secrets (0093); without them, notifications
-- silently no-op and the game itself still works.

create table public.rally_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  -- The serve: what the first return of every rally needs.
  serve_steps int not null default 1000 check (serve_steps between 250 and 10000),
  -- Active hours to return in (2, 4, 8), or 24 for the rest of the day.
  window_hours int not null default 4 check (window_hours in (2, 4, 8, 24)),
  doubles boolean not null default false,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'won', 'draw')),
  game_no int not null default 1,
  games_a int not null default 0,
  games_b int not null default 0,
  points_a int not null default 0,
  points_b int not null default 0,
  -- Whose side the shuttle is on, who has to return it, what the return
  -- needs, their total when it arrived, when it arrived, and when it has
  -- to be back by.
  side_team text check (side_team in ('a', 'b')),
  side_user_id uuid references public.profiles (id),
  target_steps int,
  side_start_total numeric,
  side_since timestamptz,
  due_at timestamptz,
  -- Returns so far in this rally.
  shot_no int not null default 0,
  -- Doubles: who returned last for each team, so the duty alternates.
  last_returner_a uuid references public.profiles (id),
  last_returner_b uuid references public.profiles (id),
  smash_a_left int not null default 1,
  smash_b_left int not null default 1,
  smash_armed boolean not null default false,
  winner_team text check (winner_team in ('a', 'b')),
  ended_reason text check (ended_reason in ('two_games', 'time_up')),
  updated_at timestamptz not null default now()
);

alter table public.rally_games enable row level security;
-- No in-app way to write this directly: every change goes through the
-- functions below (same lock-down as 0045's challenge_participants).
revoke all on public.rally_games from anon;
revoke insert, update, delete on public.rally_games from authenticated;

create policy "Participants can view their Rally game"
  on public.rally_games for select
  to authenticated
  using (
    exists (
      select 1 from public.challenge_participants cp
      where cp.challenge_id = rally_games.challenge_id and cp.user_id = auth.uid()
    )
  );

-- Who plays where. Team A is the creator's; seat 2 is the doubles
-- partner. `joined` flips when the person accepts the invite.
create table public.rally_players (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  team text not null check (team in ('a', 'b')),
  seat int not null check (seat in (1, 2)),
  joined boolean not null default false,
  primary key (challenge_id, user_id),
  unique (challenge_id, team, seat)
);

alter table public.rally_players enable row level security;
revoke all on public.rally_players from anon;
revoke insert, update, delete on public.rally_players from authenticated;

create policy "Participants can view their Rally's players"
  on public.rally_players for select
  to authenticated
  using (
    exists (
      select 1 from public.challenge_participants cp
      where cp.challenge_id = rally_players.challenge_id and cp.user_id = auth.uid()
    )
  );

-- Everything that happened, oldest first: the recap, and the numbers the
-- trash-talk wall can quote.
create table public.rally_events (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  kind text not null check (kind in ('start', 'return', 'smash', 'miss', 'game', 'match', 'time_up')),
  -- Who returned, smashed or missed; null for the game's own moments.
  user_id uuid references public.profiles (id),
  -- Which team the event went to: the returner's, or the point winner's.
  team text check (team in ('a', 'b')),
  steps int,
  target int,
  game_no int not null,
  points_a int not null,
  points_b int not null,
  created_at timestamptz not null default now()
);

create index rally_events_challenge_idx on public.rally_events (challenge_id, created_at);

alter table public.rally_events enable row level security;
revoke all on public.rally_events from anon;
revoke insert, update, delete on public.rally_events from authenticated;

create policy "Participants can view their Rally events"
  on public.rally_events for select
  to authenticated
  using (
    exists (
      select 1 from public.challenge_participants cp
      where cp.challenge_id = rally_events.challenge_id and cp.user_id = auth.uid()
    )
  );

-- When a return is due: p_hours of waking time (07:00 to 21:00 in p_tz)
-- from p_from, or, for 24, the end of the waking day. Nights never count
-- against anyone.
create or replace function public.rally_due(p_from timestamptz, p_hours int, p_tz text)
returns timestamptz
language plpgsql
immutable
as $$
declare
  tz text := coalesce(p_tz, 'UTC');
  t timestamptz := p_from;
  remaining interval := make_interval(hours => p_hours);
  local_t timestamp;
  day_start timestamp;
  day_end timestamp;
  avail interval;
begin
  if p_hours >= 24 then
    local_t := p_from at time zone tz;
    day_end := date_trunc('day', local_t) + interval '21 hours';
    -- Arriving after 19:00 (or overnight) gives the whole next day.
    if local_t + interval '2 hours' > day_end then
      day_end := day_end + interval '1 day';
    end if;
    return day_end at time zone tz;
  end if;

  loop
    local_t := t at time zone tz;
    day_start := date_trunc('day', local_t) + interval '7 hours';
    day_end := date_trunc('day', local_t) + interval '21 hours';
    if local_t < day_start then
      t := day_start at time zone tz;
      continue;
    elsif local_t >= day_end then
      t := (day_start + interval '1 day') at time zone tz;
      continue;
    end if;
    avail := day_end - local_t;
    if remaining <= avail then
      return (local_t + remaining) at time zone tz;
    end if;
    remaining := remaining - avail;
    t := (day_start + interval '1 day') at time zone tz;
  end loop;
end;
$$;

revoke execute on function public.rally_due(timestamptz, int, text) from public, anon;
grant execute on function public.rally_due(timestamptz, int, text) to authenticated;

-- The next rally's first target after one is returned: 15% more, rounded
-- up to a round 50.
create or replace function public.rally_next_target(p_target int)
returns int
language sql
immutable
as $$
  select (ceil(p_target * 1.15 / 50.0) * 50)::int;
$$;

revoke execute on function public.rally_next_target(int) from public, anon;
grant execute on function public.rally_next_target(int) to authenticated;

-- Fires the push for a game event, to one person. Skips the actor (they
-- are looking at the app). Wrapped so a notification failure never rolls
-- back the move that triggered it — same reasoning as 0048 and 0057.
create or replace function public.rally_notify(p_kind text, p_challenge_id uuid, p_recipient uuid, p_actor uuid, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;
  perform net.http_post(
    url := public.edge_function_url('send-rally-notification'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'kind', p_kind,
      'challenge_id', p_challenge_id,
      'recipient_id', p_recipient,
      'actor_id', p_actor
    ) || p_extra
  );
exception when others then
  null;
end;
$$;

revoke execute on function public.rally_notify(text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- The same, to everyone on a team.
create or replace function public.rally_notify_team(p_kind text, p_challenge_id uuid, p_team text, p_actor uuid, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
begin
  for r in select user_id from public.rally_players where challenge_id = p_challenge_id and team = p_team loop
    perform public.rally_notify(p_kind, p_challenge_id, r.user_id, p_actor, p_extra);
  end loop;
end;
$$;

revoke execute on function public.rally_notify_team(text, uuid, text, uuid, jsonb) from public, anon, authenticated;

-- A player's own time zone for deadlines, UTC when they've never synced one.
create or replace function public.rally_tz(p_user uuid)
returns text
language sql
stable
as $$
  select coalesce((select p.time_zone from public.profiles p where p.id = p_user), 'UTC');
$$;

revoke execute on function public.rally_tz(uuid) from public, anon, authenticated;

create or replace function public.rally_team_of(p_challenge_id uuid, p_user uuid)
returns text
language sql
stable
as $$
  select team from public.rally_players where challenge_id = p_challenge_id and user_id = p_user;
$$;

revoke execute on function public.rally_team_of(uuid, uuid) from public, anon, authenticated;

-- Who returns next for a team: in doubles, whichever partner didn't
-- return last (seat 1 to open); in singles, the one player.
create or replace function public.rally_next_returner(p_challenge_id uuid, p_team text)
returns uuid
language sql
stable
as $$
  select p.user_id
  from public.rally_players p, public.rally_games g
  where p.challenge_id = p_challenge_id and g.challenge_id = p_challenge_id and p.team = p_team
    and p.user_id is distinct from (case when p_team = 'a' then g.last_returner_a else g.last_returner_b end)
  order by p.seat
  limit 1;
$$;

revoke execute on function public.rally_next_returner(uuid, text) from public, anon, authenticated;

-- Hands the shuttle to a team: the next returner gets a fresh return with
-- p_target, measured from their total right now, due after the game's
-- window of their waking hours. Internal.
create or replace function public.rally_serve_to(p_challenge_id uuid, p_team text, p_target int, p_from timestamptz)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.rally_games%rowtype;
  returner uuid;
begin
  select * into g from public.rally_games where challenge_id = p_challenge_id;
  returner := public.rally_next_returner(p_challenge_id, p_team);
  update public.rally_games
    set side_team = p_team,
        side_user_id = returner,
        target_steps = p_target,
        side_start_total = public.tag_metric_total(p_challenge_id, returner, 'steps'),
        side_since = p_from,
        due_at = public.rally_due(p_from, g.window_hours, public.rally_tz(returner)),
        smash_armed = false,
        last_returner_a = case when p_team = 'a' then returner else last_returner_a end,
        last_returner_b = case when p_team = 'b' then returner else last_returner_b end,
        updated_at = now()
    where challenge_id = p_challenge_id;
end;
$$;

revoke execute on function public.rally_serve_to(uuid, text, int, timestamptz) from public, anon, authenticated;

-- Starts the match once everyone is in: the creator's team serves, so the
-- shuttle lands on the other side first. Internal; called by the join
-- trigger, or by rally_setup when everyone had already joined.
create or replace function public.rally_start(p_challenge_id uuid, p_actor uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.rally_games%rowtype;
  c public.challenges%rowtype;
  from_at timestamptz;
begin
  select * into g from public.rally_games where challenge_id = p_challenge_id for update;
  if not found or g.status != 'waiting' then
    return;
  end if;
  if not exists (select 1 from public.rally_players p where p.challenge_id = p_challenge_id)
    or exists (select 1 from public.rally_players p where p.challenge_id = p_challenge_id and not p.joined) then
    return;
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  from_at := greatest(now(), c.starts_at);
  update public.rally_games set status = 'active', updated_at = now() where challenge_id = p_challenge_id;
  perform public.rally_serve_to(p_challenge_id, 'b', g.serve_steps, from_at);
  insert into public.rally_events (challenge_id, kind, user_id, team, target, game_no, points_a, points_b)
    values (p_challenge_id, 'start', c.created_by, 'a', g.serve_steps, 1, 0, 0);
  select * into g from public.rally_games where challenge_id = p_challenge_id;
  perform public.rally_notify_team('started', p_challenge_id, 'a', p_actor,
    jsonb_build_object('target_steps', g.target_steps, 'due_at', g.due_at, 'returner_id', g.side_user_id));
  perform public.rally_notify_team('started', p_challenge_id, 'b', p_actor,
    jsonb_build_object('target_steps', g.target_steps, 'due_at', g.due_at, 'returner_id', g.side_user_id));
end;
$$;

revoke execute on function public.rally_start(uuid, uuid) from public, anon, authenticated;

-- The creator sets the serve, the window and the teams right after
-- creating the challenge, while the match is waiting: themselves and an
-- optional partner (doubles) against one or two opponents, who still have
-- to accept their invites.
create or replace function public.rally_setup(p_challenge_id uuid, p_serve_steps int, p_window_hours int, p_partner uuid, p_opponents uuid[])
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  existing_status text;
  is_doubles boolean := p_partner is not null;
  want_opponents int := case when p_partner is null then 1 else 2 end;
  everyone uuid[];
begin
  if not exists (
    select 1 from public.challenges c
    where c.id = p_challenge_id and c.kind = 'rally' and c.created_by = caller
  ) then
    raise exception 'Only the creator can set up this Rally.';
  end if;
  if p_serve_steps is null or p_serve_steps < 250 or p_serve_steps > 10000 then
    raise exception 'A serve is between 250 and 10,000 steps.';
  end if;
  if p_window_hours is null or p_window_hours not in (2, 4, 8, 24) then
    raise exception 'Pick a 2, 4 or 8 hour window, or the rest of the day.';
  end if;
  if coalesce(array_length(p_opponents, 1), 0) != want_opponents then
    raise exception 'Singles is you against one friend; doubles is you and a partner against two.';
  end if;
  everyone := array[caller] || case when is_doubles then array[p_partner] else '{}'::uuid[] end || p_opponents;
  if (select count(distinct u) from unnest(everyone) u) != array_length(everyone, 1) then
    raise exception 'Everyone in the match has to be a different person.';
  end if;

  select status into existing_status from public.rally_games where challenge_id = p_challenge_id;
  if existing_status is not null and existing_status != 'waiting' then
    raise exception 'This match has already started — its settings can''t change now.';
  end if;

  insert into public.rally_games (challenge_id, serve_steps, window_hours, doubles)
    values (p_challenge_id, p_serve_steps, p_window_hours, is_doubles)
    on conflict (challenge_id) do update
      set serve_steps = excluded.serve_steps, window_hours = excluded.window_hours, doubles = excluded.doubles, updated_at = now();

  delete from public.rally_players where challenge_id = p_challenge_id;
  insert into public.rally_players (challenge_id, user_id, team, seat, joined)
  select p_challenge_id, u, t, s,
    exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = u)
  from (
    select caller as u, 'a' as t, 1 as s
    union all select p_partner, 'a', 2 where is_doubles
    union all select p_opponents[1], 'b', 1
    union all select p_opponents[2], 'b', 2 where is_doubles
  ) plan;

  -- Everyone had already accepted before the settings landed: start now.
  perform public.rally_start(p_challenge_id, caller);
end;
$$;

revoke execute on function public.rally_setup(uuid, int, int, uuid, uuid[]) from public, anon;
grant execute on function public.rally_setup(uuid, int, int, uuid, uuid[]) to authenticated;

-- Only the people the creator named can join, whichever way the join
-- arrives. Before the teams are named, only the creator's own row (the
-- first one) gets in.
create or replace function public.rally_before_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.challenges c where c.id = new.challenge_id and c.kind = 'rally') then
    return new;
  end if;
  if exists (select 1 from public.rally_players p where p.challenge_id = new.challenge_id) then
    if not exists (select 1 from public.rally_players p where p.challenge_id = new.challenge_id and p.user_id = new.user_id) then
      raise exception 'This Rally''s teams are already set.';
    end if;
  elsif exists (select 1 from public.challenge_participants cp where cp.challenge_id = new.challenge_id) then
    raise exception 'This Rally isn''t set up yet.';
  end if;
  return new;
end;
$$;

revoke execute on function public.rally_before_join() from public, anon, authenticated;

create trigger rally_before_join
  before insert on public.challenge_participants
  for each row execute procedure public.rally_before_join();

-- The last player joining starts the match.
create or replace function public.rally_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.rally_players set joined = true
    where challenge_id = new.challenge_id and user_id = new.user_id and not joined;
  if found then
    perform public.rally_start(new.challenge_id, new.user_id);
  end if;
  return new;
end;
$$;

revoke execute on function public.rally_after_join() from public, anon, authenticated;

create trigger rally_after_join
  after insert on public.challenge_participants
  for each row execute procedure public.rally_after_join();

-- Scores a point for a team, then either ends the game or match, or
-- serves the next rally to the team that lost the point. Internal; the
-- row must already be locked by the caller.
create or replace function public.rally_award_point(p_challenge_id uuid, p_winner text, p_actor uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.rally_games%rowtype;
  loser text := case when p_winner = 'a' then 'b' else 'a' end;
  pa int;
  pb int;
  game_over boolean;
  match_over boolean := false;
  extra jsonb;
begin
  select * into g from public.rally_games where challenge_id = p_challenge_id;
  pa := g.points_a + case when p_winner = 'a' then 1 else 0 end;
  pb := g.points_b + case when p_winner = 'b' then 1 else 0 end;

  game_over := greatest(pa, pb) >= 30 or (greatest(pa, pb) >= 21 and abs(pa - pb) >= 2);

  if game_over then
    insert into public.rally_events (challenge_id, kind, team, game_no, points_a, points_b)
      values (p_challenge_id, 'game', p_winner, g.game_no, pa, pb);
    if p_winner = 'a' then g.games_a := g.games_a + 1; else g.games_b := g.games_b + 1; end if;
    match_over := greatest(g.games_a, g.games_b) >= 2;
  end if;

  if match_over then
    update public.rally_games
      set points_a = pa, points_b = pb, games_a = g.games_a, games_b = g.games_b,
          status = 'won', winner_team = p_winner, ended_reason = 'two_games',
          side_team = null, side_user_id = null, target_steps = null, side_start_total = null, side_since = null, due_at = null,
          smash_armed = false, updated_at = now()
      where challenge_id = p_challenge_id;
    insert into public.rally_events (challenge_id, kind, team, game_no, points_a, points_b)
      values (p_challenge_id, 'match', p_winner, g.game_no, pa, pb);
    update public.challenges set ends_at = now() where id = p_challenge_id and ends_at > now();
    extra := jsonb_build_object('winner_team', p_winner, 'games_a', g.games_a, 'games_b', g.games_b);
    perform public.rally_notify_team('match_over', p_challenge_id, 'a', p_actor, extra);
    perform public.rally_notify_team('match_over', p_challenge_id, 'b', p_actor, extra);
    return;
  end if;

  if game_over then
    update public.rally_games
      set points_a = 0, points_b = 0, games_a = g.games_a, games_b = g.games_b,
          game_no = g.game_no + 1, shot_no = 0,
          smash_a_left = 1, smash_b_left = 1, updated_at = now()
      where challenge_id = p_challenge_id;
  else
    update public.rally_games
      set points_a = pa, points_b = pb, shot_no = 0, updated_at = now()
      where challenge_id = p_challenge_id;
  end if;

  -- The team that lost the point receives the next serve.
  perform public.rally_serve_to(p_challenge_id, loser, g.serve_steps, now());
  select * into g from public.rally_games where challenge_id = p_challenge_id;
  extra := jsonb_build_object('target_steps', g.target_steps, 'due_at', g.due_at, 'returner_id', g.side_user_id,
    'points_a', g.points_a, 'points_b', g.points_b, 'games_a', g.games_a, 'games_b', g.games_b);
  perform public.rally_notify_team(case when game_over then 'game_lost' else 'point_lost' end, p_challenge_id, loser, p_actor, extra);
  perform public.rally_notify_team(case when game_over then 'game_won' else 'point_won' end, p_challenge_id, p_winner, p_actor, extra);
end;
$$;

revoke execute on function public.rally_award_point(uuid, text, uuid) from public, anon, authenticated;

-- Callable by any participant (the app calls it on load and before every
-- shot check); a no-op unless the challenge has run out (the match ends
-- on games, then points) or the return now due has been missed (a point
-- to the other team).
create or replace function public.rally_settle(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  g public.rally_games%rowtype;
  challenge_end timestamptz;
  leader text;
  extra jsonb;
begin
  if caller is not null and not exists (
    select 1 from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id and cp.user_id = caller
  ) then
    return;
  end if;

  select * into g from public.rally_games where challenge_id = p_challenge_id for update;
  if not found or g.status != 'active' then
    return;
  end if;

  select ends_at into challenge_end from public.challenges where id = p_challenge_id;
  if now() >= challenge_end then
    leader := case
      when g.games_a != g.games_b then (case when g.games_a > g.games_b then 'a' else 'b' end)
      when g.points_a != g.points_b then (case when g.points_a > g.points_b then 'a' else 'b' end)
      else null
    end;
    update public.rally_games
      set status = case when leader is null then 'draw' else 'won' end,
          winner_team = leader, ended_reason = 'time_up',
          side_team = null, side_user_id = null, target_steps = null, side_start_total = null, side_since = null, due_at = null,
          smash_armed = false, updated_at = now()
      where challenge_id = p_challenge_id;
    insert into public.rally_events (challenge_id, kind, team, game_no, points_a, points_b)
      values (p_challenge_id, 'time_up', leader, g.game_no, g.points_a, g.points_b);
    extra := jsonb_build_object('winner_team', leader, 'games_a', g.games_a, 'games_b', g.games_b);
    perform public.rally_notify_team('time_up', p_challenge_id, 'a', caller, extra);
    perform public.rally_notify_team('time_up', p_challenge_id, 'b', caller, extra);
    return;
  end if;

  if g.due_at is null or now() < g.due_at then
    return;
  end if;

  insert into public.rally_events (challenge_id, kind, user_id, team, target, game_no, points_a, points_b)
    values (p_challenge_id, 'miss', g.side_user_id, g.side_team, g.target_steps * case when g.smash_armed then 2 else 1 end, g.game_no, g.points_a, g.points_b);
  perform public.rally_award_point(p_challenge_id, case when g.side_team = 'a' then 'b' else 'a' end, coalesce(caller, g.side_user_id));
end;
$$;

revoke execute on function public.rally_settle(uuid) from public, anon;
grant execute on function public.rally_settle(uuid) to authenticated;

-- Whether the caller has returned the shuttle on their side: their own
-- total for this challenge, re-read from progress_snapshots, has grown
-- by the target (double it with a smash armed) since the shuttle
-- arrived. Called after every device sync while the shuttle is on the
-- caller's side, same "the client notices, then the server verifies"
-- shape tag_check_catch has. Settles first, so a missed deadline scores
-- before a late return can land. Returns what happened:
--   'returned' / 'smashed'  the shuttle crossed to the other team
--   'short'                 not enough steps yet
--   'not_your_side', 'not_started', 'inactive'
create or replace function public.rally_check_shot(p_challenge_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  g public.rally_games%rowtype;
  my_total numeric;
  need int;
  walked int;
  other text;
  next_target int;
  smashed boolean;
begin
  perform public.rally_settle(p_challenge_id);

  select * into g from public.rally_games where challenge_id = p_challenge_id for update;
  if not found or g.status != 'active' then
    return 'inactive';
  end if;
  if g.side_user_id is distinct from caller then
    return 'not_your_side';
  end if;
  if now() < g.side_since then
    return 'not_started';
  end if;

  my_total := public.tag_metric_total(p_challenge_id, caller, 'steps');
  walked := greatest(0, floor(my_total - g.side_start_total))::int;
  need := g.target_steps * case when g.smash_armed then 2 else 1 end;
  if walked < need then
    return 'short';
  end if;

  smashed := g.smash_armed;
  other := case when g.side_team = 'a' then 'b' else 'a' end;
  next_target := public.rally_next_target(g.target_steps);
  if smashed then
    next_target := next_target * 2;
    update public.rally_games
      set smash_a_left = smash_a_left - case when g.side_team = 'a' then 1 else 0 end,
          smash_b_left = smash_b_left - case when g.side_team = 'b' then 1 else 0 end
      where challenge_id = p_challenge_id;
  end if;

  insert into public.rally_events (challenge_id, kind, user_id, team, steps, target, game_no, points_a, points_b)
    values (p_challenge_id, case when smashed then 'smash' else 'return' end, caller, g.side_team, walked, need, g.game_no, g.points_a, g.points_b);
  update public.rally_games set shot_no = shot_no + 1 where challenge_id = p_challenge_id;
  perform public.rally_serve_to(p_challenge_id, other, next_target, now());
  select * into g from public.rally_games where challenge_id = p_challenge_id;
  perform public.rally_notify(case when smashed then 'smashed' else 'your_shot' end, p_challenge_id, g.side_user_id, caller,
    jsonb_build_object('target_steps', g.target_steps, 'due_at', g.due_at, 'walked', walked));
  return case when smashed then 'smashed' else 'returned' end;
end;
$$;

revoke execute on function public.rally_check_shot(uuid) from public, anon;
grant execute on function public.rally_check_shot(uuid) to authenticated;

-- Arms the team's smash for the return now on the caller's side: this
-- return needs double the target, and landing it doubles the other
-- team's next. Can't be taken back, and one per team per game.
create or replace function public.rally_arm_smash(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  g public.rally_games%rowtype;
  left_for_us int;
begin
  perform public.rally_settle(p_challenge_id);
  select * into g from public.rally_games where challenge_id = p_challenge_id for update;
  if not found or g.status != 'active' then
    raise exception 'This match isn''t on.';
  end if;
  if g.side_user_id is distinct from caller then
    raise exception 'The shuttle isn''t on your side.';
  end if;
  if g.smash_armed then
    raise exception 'Your smash is already armed.';
  end if;
  left_for_us := case when g.side_team = 'a' then g.smash_a_left else g.smash_b_left end;
  if left_for_us <= 0 then
    raise exception 'Your team''s smash is used up for this game.';
  end if;
  update public.rally_games set smash_armed = true, updated_at = now() where challenge_id = p_challenge_id;
end;
$$;

revoke execute on function public.rally_arm_smash(uuid) from public, anon;
grant execute on function public.rally_arm_smash(uuid) to authenticated;

-- Every Rally where the shuttle is on the caller's side right now, for
-- Home's Needs you card.
create or replace function public.my_rally_shots()
returns table (challenge_id uuid, target_steps int, due_at timestamptz, smash_armed boolean)
language sql
stable
security definer set search_path = public
as $$
  select g.challenge_id, g.target_steps, g.due_at, g.smash_armed
  from public.rally_games g
  where g.status = 'active' and g.side_user_id = auth.uid();
$$;

revoke execute on function public.my_rally_shots() from public, anon;
grant execute on function public.my_rally_shots() to authenticated;

-- Scoring. settle_challenge_score_core is 0136's, with a Rally branch;
-- settle_challenge_score is 0126's, with 'rally' among the game-event
-- kinds that can end before ends_at.
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
    where p.challenge_id = p_challenge_id and p.joined;

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
  if c.kind::text in ('hunt', 'tag', 'tictacgo', 'journey', 'rally') then
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
