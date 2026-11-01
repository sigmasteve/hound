-- Hound: Rally bots — a bot can take any seat but the creator's.
--
-- The app has simulated bots since 0003 (challenge_bots): a bot never
-- signs in and never writes progress_snapshots; its steps are recomputed
-- on every read from its id and fitness level (src/challenges/
-- botSimulation.ts). A Rally return is verified server-side from steps,
-- so for a bot to play, the server has to know the bot's steps too.
-- rally_bot_total below is that simulation, ported line for line (the
-- same string hash, the same generator, the same UTC day fraction), so
-- the bot's total on the leaderboard and the total its returns are judged
-- on are one number.
--
-- A bot walks at a steady rate through each UTC day, so the moment it
-- has walked its target is exact arithmetic (rally_bot_return_at). The
-- return is applied at that moment, not when someone noticed, and the
-- human's window starts from it. A scheduled job (every 15 minutes)
-- settles every active Rally with a bot on the shuttle, so the human is
-- told within a quarter of an hour; opening the app settles it sooner.
-- Bots never smash. A match against a bot pays out like any other.
--
-- Run this once, after 0139, in the SQL Editor.

-- A seat can hold a bot. player_id is whichever of the two the seat has,
-- and it is what side_user_id / last_returner_* / rally_events.user_id
-- hold (a profile id or a challenge_bots id), so those lose their
-- profiles foreign keys.
alter table public.rally_players
  drop constraint rally_players_pkey,
  drop constraint rally_players_challenge_id_team_seat_key,
  alter column user_id drop not null,
  add column bot_id uuid references public.challenge_bots (id) on delete cascade,
  add column player_id uuid generated always as (coalesce(user_id, bot_id)) stored,
  add constraint rally_players_one_kind check ((user_id is null) <> (bot_id is null)),
  add primary key (challenge_id, team, seat);
create unique index rally_players_user_idx on public.rally_players (challenge_id, user_id) where user_id is not null;
create unique index rally_players_bot_idx on public.rally_players (challenge_id, bot_id) where bot_id is not null;

alter table public.rally_games
  drop constraint rally_games_side_user_id_fkey,
  drop constraint rally_games_last_returner_a_fkey,
  drop constraint rally_games_last_returner_b_fkey;
alter table public.rally_events drop constraint rally_events_user_id_fkey;

comment on column public.rally_games.side_user_id is 'The player due to return: a profiles id, or a challenge_bots id.';

-- The app's own string hash (botSimulation.ts hashSeed), on unsigned
-- 32-bit arithmetic. Every JavaScript bit operation there coerces to
-- 32 bits, so working mod 2^32 throughout gives the identical number.
create or replace function public.rally_js_hash(input text)
returns bigint
language plpgsql
immutable
as $$
declare
  m constant numeric := 4294967296;
  h bigint := (1779033703 # length(input));
  i int;
begin
  for i in 1..length(input) loop
    h := mod((h # ascii(substr(input, i, 1)))::numeric * 3432918353, m)::bigint;
    h := mod(((h << 13) | (h >> 19))::numeric, m)::bigint;
  end loop;
  return h;
end;
$$;

revoke execute on function public.rally_js_hash(text) from public, anon, authenticated;

-- The app's own generator (botSimulation.ts pseudoRandom): 0 to 1 from a seed.
create or replace function public.rally_js_rand(seed bigint)
returns double precision
language plpgsql
immutable
as $$
declare
  m constant numeric := 4294967296;
  t bigint;
  u bigint;
begin
  t := mod((seed + 1831565813)::numeric, m)::bigint;
  t := mod((t # (t >> 15))::numeric * (t | 1), m)::bigint;
  u := mod((t # (t >> 7))::numeric * (t | 61), m)::bigint;
  t := t # (mod((t + u)::numeric, m)::bigint);
  return (mod((t # (t >> 14))::numeric, m)) / 4294967296.0;
end;
$$;

revoke execute on function public.rally_js_rand(bigint) from public, anon, authenticated;

-- How many days of a challenge have elapsed at p_at, with the current
-- UTC day as a fraction — botSimulation.ts daysElapsedFraction.
create or replace function public.rally_bot_elapsed(p_starts_at timestamptz, p_duration_days int, p_at timestamptz)
returns double precision
language sql
immutable
as $$
  select least(p_duration_days::double precision, greatest(0,
    floor(extract(epoch from (p_at - date_trunc('day', p_starts_at at time zone 'UTC') at time zone 'UTC')) / 86400)
    + extract(epoch from ((p_at at time zone 'UTC') - date_trunc('day', p_at at time zone 'UTC'))) / 86400));
$$;

revoke execute on function public.rally_bot_elapsed(timestamptz, int, timestamptz) from public, anon, authenticated;

-- A bot's steps on one day of a challenge (day 0 is the day it was made).
create or replace function public.rally_bot_day_steps(p_bot_id uuid, p_level text, p_day int)
returns double precision
language sql
immutable
as $$
  select lo + public.rally_js_rand(public.rally_js_hash(p_bot_id::text || ':' || p_day)) * (hi - lo)
  from (
    select case p_level when 'casual' then 2500 when 'active' then 6500 when 'athletic' then 10000 else 15000 end as lo,
           case p_level when 'casual' then 7000 when 'active' then 12000 when 'athletic' then 16000 else 23000 end as hi
  ) r;
$$;

revoke execute on function public.rally_bot_day_steps(uuid, text, int) from public, anon, authenticated;

-- A bot's total steps for a challenge at a moment — botSimulation.ts
-- simulateBotSteps, so it matches the leaderboard to the step.
create or replace function public.rally_bot_total(p_challenge_id uuid, p_bot_id uuid, p_at timestamptz)
returns numeric
language plpgsql
stable
as $$
declare
  c public.challenges%rowtype;
  lvl text;
  elapsed double precision;
  full_days int;
  frac double precision;
  total double precision := 0;
  d int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select fitness_level::text into lvl from public.challenge_bots where id = p_bot_id;
  if c.id is null or lvl is null then
    return 0;
  end if;
  elapsed := public.rally_bot_elapsed(c.starts_at, c.duration_days, p_at);
  full_days := floor(elapsed);
  frac := elapsed - full_days;
  for d in 0..full_days - 1 loop
    total := total + public.rally_bot_day_steps(p_bot_id, lvl, d);
  end loop;
  if frac > 0 then
    total := total + public.rally_bot_day_steps(p_bot_id, lvl, full_days) * frac;
  end if;
  return round(total::numeric);
end;
$$;

revoke execute on function public.rally_bot_total(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Any player's total for a challenge: a human's synced steps, or a bot's
-- simulated ones at p_at.
create or replace function public.rally_player_total(p_challenge_id uuid, p_player uuid, p_at timestamptz)
returns numeric
language plpgsql
stable
as $$
begin
  if exists (select 1 from public.challenge_bots b where b.id = p_player and b.challenge_id = p_challenge_id) then
    return public.rally_bot_total(p_challenge_id, p_player, p_at);
  end if;
  return public.tag_metric_total(p_challenge_id, p_player, 'steps');
end;
$$;

revoke execute on function public.rally_player_total(uuid, uuid, timestamptz) from public, anon, authenticated;

-- A bot keeps the creator's hours.
create or replace function public.rally_tz(p_challenge_id uuid, p_player uuid)
returns text
language sql
stable
as $$
  select coalesce(
    (select p.time_zone from public.profiles p where p.id = p_player),
    (select p.time_zone from public.challenges c join public.profiles p on p.id = c.created_by where c.id = p_challenge_id),
    'UTC');
$$;

revoke execute on function public.rally_tz(uuid, uuid) from public, anon, authenticated;
drop function public.rally_tz(uuid);

-- Only people get pushes.
create or replace function public.rally_notify_team(p_kind text, p_challenge_id uuid, p_team text, p_actor uuid, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
begin
  for r in select user_id from public.rally_players where challenge_id = p_challenge_id and team = p_team and user_id is not null loop
    perform public.rally_notify(p_kind, p_challenge_id, r.user_id, p_actor, p_extra);
  end loop;
end;
$$;

create or replace function public.rally_notify(p_kind text, p_challenge_id uuid, p_recipient uuid, p_actor uuid, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_recipient is null or p_recipient = p_actor
    or not exists (select 1 from public.profiles p where p.id = p_recipient) then
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

-- Seats hold player ids now. Whoever didn't return last goes first; in
-- singles that is the one player again (0139 excluded them outright,
-- which left the seat empty after a point was lost back to them).
create or replace function public.rally_next_returner(p_challenge_id uuid, p_team text)
returns uuid
language sql
stable
as $$
  select p.player_id
  from public.rally_players p, public.rally_games g
  where p.challenge_id = p_challenge_id and g.challenge_id = p_challenge_id and p.team = p_team
  order by (p.player_id is not distinct from (case when p_team = 'a' then g.last_returner_a else g.last_returner_b end)), p.seat
  limit 1;
$$;

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
        side_start_total = public.rally_player_total(p_challenge_id, returner, p_from),
        side_since = p_from,
        due_at = public.rally_due(p_from, g.window_hours, public.rally_tz(p_challenge_id, returner)),
        smash_armed = false,
        last_returner_a = case when p_team = 'a' then returner else last_returner_a end,
        last_returner_b = case when p_team = 'b' then returner else last_returner_b end,
        updated_at = now()
    where challenge_id = p_challenge_id;
end;
$$;

-- The creator's partner and opponents may be bots: an id is either a
-- profile or one of this challenge's own bots. A bot is in from the
-- start, so a match against bots alone begins at setup.
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
  r record;
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
    raise exception 'Singles is you against one; doubles is you and a partner against two.';
  end if;
  everyone := array[caller] || case when is_doubles then array[p_partner] else '{}'::uuid[] end || p_opponents;
  if (select count(distinct u) from unnest(everyone) u) != array_length(everyone, 1) then
    raise exception 'Everyone in the match has to be a different person.';
  end if;
  for r in select u from unnest(everyone) u where u != caller loop
    if not exists (select 1 from public.profiles p where p.id = r.u)
      and not exists (select 1 from public.challenge_bots b where b.id = r.u and b.challenge_id = p_challenge_id) then
      raise exception 'One of the players isn''t a person or one of this challenge''s bots.';
    end if;
  end loop;

  select status into existing_status from public.rally_games where challenge_id = p_challenge_id;
  if existing_status is not null and existing_status != 'waiting' then
    raise exception 'This match has already started — its settings can''t change now.';
  end if;

  insert into public.rally_games (challenge_id, serve_steps, window_hours, doubles)
    values (p_challenge_id, p_serve_steps, p_window_hours, is_doubles)
    on conflict (challenge_id) do update
      set serve_steps = excluded.serve_steps, window_hours = excluded.window_hours, doubles = excluded.doubles, updated_at = now();

  delete from public.rally_players where challenge_id = p_challenge_id;
  insert into public.rally_players (challenge_id, user_id, bot_id, team, seat, joined)
  select p_challenge_id,
    case when is_bot then null else u end,
    case when is_bot then u else null end,
    t, s,
    is_bot or exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = u)
  from (
    select caller as u, 'a' as t, 1 as s
    union all select p_partner, 'a', 2 where is_doubles
    union all select p_opponents[1], 'b', 1
    union all select p_opponents[2], 'b', 2 where is_doubles
  ) plan
  cross join lateral (select exists (select 1 from public.challenge_bots b where b.id = plan.u and b.challenge_id = p_challenge_id) as is_bot) k;

  perform public.rally_start(p_challenge_id, caller);
end;
$$;

-- When the bot on the shuttle will have walked its target: exact, since
-- it walks at a steady rate through each UTC day. Null while that moment
-- is still ahead of now, or past the challenge's days.
create or replace function public.rally_bot_return_at(p_challenge_id uuid)
returns timestamptz
language plpgsql
stable
as $$
declare
  g public.rally_games%rowtype;
  c public.challenges%rowtype;
  lvl text;
  goal numeric;
  day0 timestamptz;
  d int;
  day_start timestamptz;
  at_start numeric;
  daily double precision;
  frac double precision;
  t timestamptz;
begin
  select * into g from public.rally_games where challenge_id = p_challenge_id;
  select fitness_level::text into lvl from public.challenge_bots where id = g.side_user_id and challenge_id = p_challenge_id;
  if lvl is null or g.status != 'active' then
    return null;
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  goal := g.side_start_total + g.target_steps * case when g.smash_armed then 2 else 1 end;
  day0 := date_trunc('day', c.starts_at at time zone 'UTC') at time zone 'UTC';
  d := floor(extract(epoch from (g.side_since - day0)) / 86400);
  loop
    if d >= c.duration_days then
      return null;
    end if;
    day_start := day0 + make_interval(days => d);
    if day_start > now() then
      return null;
    end if;
    at_start := public.rally_bot_total(p_challenge_id, g.side_user_id, day_start);
    daily := public.rally_bot_day_steps(g.side_user_id, lvl, d);
    if at_start + daily >= goal then
      frac := greatest(0, (goal - at_start) / daily);
      t := day_start + make_interval(secs => frac * 86400);
      if t < g.side_since then t := g.side_since; end if;
      return case when t <= now() then t else null end;
    end if;
    d := d + 1;
  end loop;
end;
$$;

revoke execute on function public.rally_bot_return_at(uuid) from public, anon, authenticated;

-- Plays the bot's returns that are due: applied at the moment each one
-- happened, so the next player's window runs from then. Internal; the
-- caller holds the row lock. Stops at a human's return, a bot that hasn't
-- made it yet, or a deadline the bot missed (rally_settle scores that).
create or replace function public.rally_bot_play(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.rally_games%rowtype;
  t timestamptz;
  other text;
  next_target int;
  n int := 0;
begin
  loop
    n := n + 1;
    exit when n > 200;
    select * into g from public.rally_games where challenge_id = p_challenge_id;
    exit when g.status != 'active' or g.side_user_id is null
      or not exists (select 1 from public.challenge_bots b where b.id = g.side_user_id);
    t := public.rally_bot_return_at(p_challenge_id);
    exit when t is null or t > g.due_at;
    other := case when g.side_team = 'a' then 'b' else 'a' end;
    next_target := public.rally_next_target(g.target_steps);
    insert into public.rally_events (challenge_id, kind, user_id, team, steps, target, game_no, points_a, points_b, created_at)
      values (p_challenge_id, 'return', g.side_user_id, g.side_team, g.target_steps, g.target_steps, g.game_no, g.points_a, g.points_b, t);
    update public.rally_games set shot_no = shot_no + 1 where challenge_id = p_challenge_id;
    perform public.rally_serve_to(p_challenge_id, other, next_target, t);
    select * into g from public.rally_games where challenge_id = p_challenge_id;
    perform public.rally_notify('your_shot', p_challenge_id, g.side_user_id, null,
      jsonb_build_object('target_steps', g.target_steps, 'due_at', g.due_at, 'walked', g.target_steps));
  end loop;
end;
$$;

revoke execute on function public.rally_bot_play(uuid) from public, anon, authenticated;

-- A missed point hands the serve to the loser's team, which may be a bot:
-- play it straight away, in the same settle, so a bot's return never
-- waits for the next tick. (rally_award_point is 0139's; this wraps the
-- one call site that can hand a bot the shuttle.)
create or replace function public.rally_award_point_then_play(p_challenge_id uuid, p_winner text, p_actor uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.rally_award_point(p_challenge_id, p_winner, p_actor);
  perform public.rally_bot_play(p_challenge_id);
end;
$$;

revoke execute on function public.rally_award_point_then_play(uuid, text, uuid) from public, anon, authenticated;

-- As 0139, with the bot's returns played first — so a bot that made its
-- target before the deadline is never scored as a miss, and a human's
-- own window is measured from the bot's real return.
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

  perform public.rally_bot_play(p_challenge_id);
  select * into g from public.rally_games where challenge_id = p_challenge_id;

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
  perform public.rally_award_point_then_play(p_challenge_id, case when g.side_team = 'a' then 'b' else 'a' end, coalesce(caller, g.side_user_id));
end;
$$;

-- 0139's shot check, with a bot's reply played straight after a human's
-- return instead of waiting for the next tick.
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
  -- A bot on the other side may already have its reply in: play it now.
  perform public.rally_bot_play(p_challenge_id);
  return case when smashed then 'smashed' else 'returned' end;
end;
$$;

revoke execute on function public.rally_check_shot(uuid) from public, anon;
grant execute on function public.rally_check_shot(uuid) to authenticated;

-- Every active Rally with a bot on the shuttle, every 15 minutes, as the
-- database (no signed-in caller), so a human hears about a bot's return
-- within a quarter of an hour.
create or replace function public.rally_bots_tick()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select g.challenge_id from public.rally_games g
    where g.status = 'active'
      and exists (select 1 from public.challenge_bots b where b.id = g.side_user_id)
  loop
    begin
      perform public.rally_settle(r.challenge_id);
      n := n + 1;
    exception when others then
      raise warning 'rally_bots_tick: % failed: %', r.challenge_id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;

revoke execute on function public.rally_bots_tick() from public, anon, authenticated;

select cron.schedule('hound-rally-bots', '*/15 * * * *', $$ select public.rally_bots_tick(); $$);

-- Scoring: 0139's core, paying only the people on each team; 0139's
-- wrapper, with a Rally settling on its own state whatever the
-- participant count, since the other players may all be bots.
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
  -- A Rally's other players may all be bots: its own state says whether
  -- it's over, whatever the participant count.
  if c.kind::text = 'rally' then
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
