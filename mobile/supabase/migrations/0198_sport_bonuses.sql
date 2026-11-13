-- 0198: Workouts count in the sports games.
--
-- A strength workout earns extra attempts: 1 at 15 minutes, +1 for every
-- 30 minutes after (2 at 45), capped at 2 (the day's strength workouts
-- added together). Playing the game's own sport for 20 minutes or more
-- makes it a game day. Both come from workout_history on the player's
-- own day (Daily Doors' rule: their profile's time zone). One workout
-- never counts as both: one of the game's sport is a game day.
--
-- What they do, per game (every number is in sport_bonus_config):
--   hoops    each strength bonus a shot past the step cap (their pick);
--            a game day one more shot and +0.08 on every make that day
--   soccer   each strength bonus a shot past the cap; a game day one
--            more shot and +0.08 on target
--   baseball power: home runs and extra-base hits 1.25x per bonus (a 3%
--            home-run floor once there's a bonus); a game day 0.04 fewer
--            strikeouts and 0.08 fewer of their balls caught
--   cricket  power: fours and sixes 1.25x per bonus (plus 4 points each);
--            a game day moves the batter's or the bowler's share 0.08
--            their way
--   rally    each strength bonus one power return a day (a shuttle sent
--            back short of its target); a game day makes their target
--            20% easier that day
--   horse    each strength bonus 2,000 steps toward the target, a game
--            day 4,000
-- With no workouts (and with the config off) every game plays exactly as
-- before, seeded rolls and all: the engines below are their latest
-- definitions with only these additions.

create table if not exists public.sport_bonus_config (
  id boolean primary key default true,
  constraint sport_bonus_config_singleton check (id),
  enabled boolean not null default true,
  strength_first_min integer not null default 15 check (strength_first_min between 5 and 120),
  strength_extra_min integer not null default 30 check (strength_extra_min between 5 and 120),
  strength_max integer not null default 2 check (strength_max between 0 and 5),
  game_day_min integer not null default 20 check (game_day_min between 5 and 180),
  game_day_make numeric(4, 3) not null default 0.08 check (game_day_make between 0 and 0.3),
  horse_strength_steps integer not null default 2000 check (horse_strength_steps between 0 and 10000),
  horse_game_day_steps integer not null default 4000 check (horse_game_day_steps between 0 and 10000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.sport_bonus_config (id) values (true) on conflict (id) do nothing;
alter table public.sport_bonus_config enable row level security;
drop policy if exists "Anyone signed in reads the sport bonus settings" on public.sport_bonus_config;
create policy "Anyone signed in reads the sport bonus settings" on public.sport_bonus_config for select to authenticated using (true);
revoke insert, update, delete on public.sport_bonus_config from anon, authenticated;

-- Each bonus a game used, for Admin's numbers.
create table if not exists public.sport_bonus_log (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null,
  day date not null,
  kind text not null,
  strength integer not null default 0,
  game_day boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id, day)
);
alter table public.sport_bonus_log enable row level security;
revoke all on public.sport_bonus_log from anon, authenticated;

-- Where the engines mark a bonus on a play: 'power' (a strength shot) or
-- 'game_day'.
alter table public.soccer_events add column if not exists bonus text check (bonus in ('power', 'game_day'));
alter table public.hoops_events add column if not exists bonus text check (bonus in ('power', 'game_day'));
alter table public.cricket_balls add column if not exists bonus text check (bonus in ('power', 'game_day'));
alter table public.rally_events add column if not exists bonus text check (bonus in ('power', 'game_day'));

-- Power returns used in Rally, a day at a time.
create table if not exists public.rally_power_used (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null,
  day date not null,
  used integer not null default 0,
  primary key (challenge_id, user_id, day)
);
alter table public.rally_power_used enable row level security;
revoke all on public.rally_power_used from anon, authenticated;

-- The real sport each game counts, as a pattern on the workout's name.
create or replace function public.sport_bonus_sport(p_kind text)
returns text
language sql
immutable
as $$
  select case p_kind
    when 'hoops' then 'basketball' when 'horse' then 'basketball'
    when 'soccer' then 'soccer' when 'baseball' then 'baseball'
    when 'cricket' then 'cricket' when 'rally' then 'racquet' end;
$$;
revoke execute on function public.sport_bonus_sport(text) from public, anon, authenticated;

create or replace function public.sport_bonus_pattern(p_kind text)
returns text
language sql
immutable
as $$
  select case public.sport_bonus_sport(p_kind)
    when 'basketball' then 'basketball'
    -- Not American or Australian football.
    when 'soccer' then 'soccer'
    when 'baseball' then 'baseball|softball'
    when 'cricket' then 'cricket'
    when 'racquet' then 'badminton|tennis|squash|pickleball|racquetball|padel' end;
$$;
revoke execute on function public.sport_bonus_pattern(text) from public, anon, authenticated;

-- Someone's bonuses for a game on one of their days.
create or replace function public.sport_day_bonus(p_user uuid, p_day date, p_kind text)
returns table (strength_min int, strength int, game_day boolean, game_day_min int, workout text)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  cfg public.sport_bonus_config%rowtype;
  tz text;
  sport_re text := public.sport_bonus_pattern(p_kind);
  strength_re text := 'strength|weight|functional|lift|resistance|crossfit|cross ?training|core training|kettlebell';
  s_min int;
  g_min int;
  w_name text;
begin
  select * into cfg from public.sport_bonus_config limit 1;
  if p_user is null or p_day is null or not coalesce(cfg.enabled, false) then
    return query select 0, 0, false, 0, null::text;
    return;
  end if;
  tz := coalesce((select p.time_zone from public.profiles p where p.id = p_user), 'America/New_York');
  select coalesce(sum(coalesce(w.duration_min, 0)) filter (where sport_re is not null and w.name ~* sport_re), 0)::int,
         coalesce(sum(coalesce(w.duration_min, 0)) filter (where w.name ~* strength_re and (sport_re is null or w.name !~* sport_re)), 0)::int,
         (array_agg(w.name order by coalesce(w.duration_min, 0) desc) filter (where sport_re is not null and w.name ~* sport_re))[1]
    into g_min, s_min, w_name
    from public.workout_history w
    where w.user_id = p_user
      and w.occurred_at >= (p_day - 1)::timestamp at time zone 'utc'
      and w.occurred_at < (p_day + 2)::timestamp at time zone 'utc'
      and (w.occurred_at at time zone tz)::date = p_day;
  return query select
    s_min,
    case when s_min < cfg.strength_first_min then 0
         else least(cfg.strength_max, 1 + floor((s_min - cfg.strength_first_min)::numeric / cfg.strength_extra_min)::int) end,
    g_min >= cfg.game_day_min,
    g_min,
    w_name;
end;
$$;
revoke execute on function public.sport_day_bonus(uuid, date, text) from public, anon, authenticated;

-- The same, as an engine uses it: noted for Admin when there's a bonus.
create or replace function public.sport_bonus_for(p_challenge_id uuid, p_user uuid, p_day date, p_kind text)
returns table (strength_min int, strength int, game_day boolean, game_day_min int, workout text)
language plpgsql
security definer set search_path = public
as $$
declare
  b record;
begin
  select * into b from public.sport_day_bonus(p_user, p_day, p_kind);
  if b.strength > 0 or b.game_day then
    insert into public.sport_bonus_log (challenge_id, user_id, day, kind, strength, game_day)
      values (p_challenge_id, p_user, p_day, p_kind, b.strength, b.game_day)
      on conflict (challenge_id, user_id, day) do update
        set strength = greatest(sport_bonus_log.strength, excluded.strength),
            game_day = sport_bonus_log.game_day or excluded.game_day;
  end if;
  return query select b.strength_min, b.strength, b.game_day, b.game_day_min, b.workout;
end;
$$;
revoke execute on function public.sport_bonus_for(uuid, uuid, date, text) from public, anon, authenticated;

-- H-O-R-S-E: the steps a bonus is worth toward the target.
create or replace function public.horse_bonus_steps(p_challenge_id uuid, p_user uuid, p_day date)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  b record;
  cfg public.sport_bonus_config%rowtype;
begin
  if p_user is null then
    return 0;
  end if;
  select * into cfg from public.sport_bonus_config limit 1;
  select * into b from public.sport_bonus_for(p_challenge_id, p_user, p_day, 'horse');
  return b.strength * cfg.horse_strength_steps + case when b.game_day then cfg.horse_game_day_steps else 0 end;
end;
$$;
revoke execute on function public.horse_bonus_steps(uuid, uuid, date) from public, anon, authenticated;

-- Everyone's bonuses in a game on a day (the caller's today by default),
-- for the app.
create or replace function public.sport_bonuses(p_challenge_id uuid, p_day date default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  d date;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found
     or (not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller)
         and not exists (select 1 from public.profiles x where x.id = caller and x.is_admin)) then
    raise exception 'not authorized';
  end if;
  if public.sport_bonus_sport(c.kind::text) is null then
    raise exception 'That isn''t a sports game.';
  end if;
  d := coalesce(p_day, (now() at time zone coalesce((select p.time_zone from public.profiles p where p.id = caller), 'America/New_York'))::date);
  return jsonb_build_object(
    'day', d,
    'sport', public.sport_bonus_sport(c.kind::text),
    'enabled', coalesce((select cfg.enabled from public.sport_bonus_config cfg limit 1), false),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
          'user_id', cp.user_id, 'strength_min', b.strength_min, 'strength', b.strength,
          'game_day', b.game_day, 'game_day_min', b.game_day_min, 'workout', b.workout)
        order by cp.user_id)
      from public.challenge_participants cp
      cross join lateral public.sport_day_bonus(cp.user_id, d, c.kind::text) b
      where cp.challenge_id = p_challenge_id
    ), '[]'::jsonb));
end;
$$;
revoke execute on function public.sport_bonuses(uuid, date) from public, anon;
grant execute on function public.sport_bonuses(uuid, date) to authenticated;

-- ── Admin ──

create or replace function public.admin_sport_bonus_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'config', (select to_jsonb(cfg) - 'id' from public.sport_bonus_config cfg limit 1),
    'strength_7d', (select coalesce(sum(l.strength), 0) from public.sport_bonus_log l where l.day > current_date - 7),
    'strength_people_7d', (select count(distinct l.user_id) from public.sport_bonus_log l where l.day > current_date - 7 and l.strength > 0),
    'game_days_7d', (select count(*) from public.sport_bonus_log l where l.day > current_date - 7 and l.game_day),
    'game_day_people_7d', (select count(distinct l.user_id) from public.sport_bonus_log l where l.day > current_date - 7 and l.game_day),
    'by_sport', jsonb_build_object(
      'basketball', (select count(*) from public.sport_bonus_log l where l.day > current_date - 7 and l.game_day and l.kind in ('hoops', 'horse')),
      'soccer', (select count(*) from public.sport_bonus_log l where l.day > current_date - 7 and l.game_day and l.kind = 'soccer'),
      'baseball', (select count(*) from public.sport_bonus_log l where l.day > current_date - 7 and l.game_day and l.kind = 'baseball'),
      'cricket', (select count(*) from public.sport_bonus_log l where l.day > current_date - 7 and l.game_day and l.kind = 'cricket'),
      'racquet', (select count(*) from public.sport_bonus_log l where l.day > current_date - 7 and l.game_day and l.kind = 'rally')));
end;
$$;
revoke execute on function public.admin_sport_bonus_overview() from public, anon;
grant execute on function public.admin_sport_bonus_overview() to authenticated;

create or replace function public.admin_set_sport_bonus_config(p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin) then
    raise exception 'not authorized';
  end if;
  update public.sport_bonus_config c set
    enabled = coalesce((p ->> 'enabled')::boolean, c.enabled),
    strength_first_min = coalesce((p ->> 'strength_first_min')::int, c.strength_first_min),
    strength_extra_min = coalesce((p ->> 'strength_extra_min')::int, c.strength_extra_min),
    strength_max = coalesce((p ->> 'strength_max')::int, c.strength_max),
    game_day_min = coalesce((p ->> 'game_day_min')::int, c.game_day_min),
    game_day_make = coalesce((p ->> 'game_day_make')::numeric, c.game_day_make),
    horse_strength_steps = coalesce((p ->> 'horse_strength_steps')::int, c.horse_strength_steps),
    horse_game_day_steps = coalesce((p ->> 'horse_game_day_steps')::int, c.horse_game_day_steps),
    updated_at = now(), updated_by = auth.uid()
  where c.id;
end;
$$;
revoke execute on function public.admin_set_sport_bonus_config(jsonb) from public, anon;
grant execute on function public.admin_set_sport_bonus_config(jsonb) to authenticated;

-- Cricket: the ball's outcome with power (fours and sixes more likely).
-- At a power of 1 it's exactly cricket_ball_outcome.
create or replace function public.cricket_ball_outcome(p_share double precision, p_roll double precision, p_power double precision)
returns text
language plpgsql
immutable
as $$
declare
  r double precision := least(1, greatest(0, coalesce(p_share, 0.5)));
  k double precision := greatest(1, coalesce(p_power, 1));
  p_out double precision := least(0.20, greatest(0.02, 0.20 - 0.30 * r));
  p_six double precision := least(0.20 + 0.20 * (k - 1), greatest(0, 0.30 * r - 0.08) * k + 0.04 * (k - 1));
  p_four double precision := least(0.25 + 0.20 * (k - 1), greatest(0.02, 0.36 * r - 0.06) * k + 0.04 * (k - 1));
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
grant execute on function public.cricket_ball_outcome(double precision, double precision, double precision) to authenticated;
revoke execute on function public.cricket_ball_outcome(double precision, double precision, double precision) from public, anon;

-- ── The engines, each its latest definition plus the bonuses ──

-- Soccer (0145).
create or replace function public.soccer_play_day(p_challenge_id uuid, p_day date, p_day_no int, p_first_day date)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.soccer_games%rowtype;
  seed text := p_challenge_id::text || ':' || p_day;
  t text;
  o text;
  f record;
  defense numeric;
  keeper_steps numeric;
  keeper_id uuid;
  keeper_bot boolean;
  dive text;
  aim text;
  markers uuid[];
  mark_defense numeric;
  f_defense numeric;
  s int;
  shots int;
  i int;
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
  bn record;
  base int;
  gdm double precision := (select c.game_day_make from public.sport_bonus_config c limit 1);
begin
  select * into g from public.soccer_games where challenge_id = p_challenge_id;

  foreach t in array array['a', 'b'] loop
    o := case when t = 'a' then 'b' else 'a' end;
    goals := 0; tot_shots := 0; tot_on := 0; tot_saves := 0;

    -- The other side's general defense: the keeper and every defender who
    -- isn't marking someone.
    select coalesce(avg(public.soccer_steps(p_challenge_id, p.player_id, p_day, p_first_day)), 0) into defense
      from public.soccer_players p
      where p.challenge_id = p_challenge_id and p.team = o and p.joined and p.position in ('defender', 'keeper')
        and not (p.position = 'defender' and exists (
          select 1 from public.soccer_tactics st
          where st.challenge_id = p_challenge_id and st.day = p_day and st.player_id = p.player_id and st.mark_id is not null));

    -- Their keeper (a stand-in defender at 60% without one), and the dive.
    keeper_id := null; keeper_steps := null; keeper_bot := false; dive := null;
    select p.player_id, p.bot_id is not null, public.soccer_steps(p_challenge_id, p.player_id, p_day, p_first_day)
      into keeper_id, keeper_bot, keeper_steps
      from public.soccer_players p
      where p.challenge_id = p_challenge_id and p.team = o and p.joined and p.position = 'keeper';
    if keeper_id is null then
      select p.player_id, public.soccer_steps(p_challenge_id, p.player_id, p_day, p_first_day) * 0.6 into keeper_id, keeper_steps
        from public.soccer_players p
        where p.challenge_id = p_challenge_id and p.team = o and p.joined and p.position = 'defender'
        order by public.soccer_steps(p_challenge_id, p.player_id, p_day, p_first_day) desc
        limit 1;
    else
      select st.dive into dive from public.soccer_tactics st
        where st.challenge_id = p_challenge_id and st.day = p_day and st.player_id = keeper_id;
      if dive is null and keeper_bot then
        dive := public.soccer_seeded_zone(seed || ':' || keeper_id || ':dive');
      end if;
    end if;
    keeper_steps := coalesce(keeper_steps, 0);

    for f in
      select p.player_id from public.soccer_players p
      where p.challenge_id = p_challenge_id and p.team = t and p.joined and p.position = 'forward'
      order by p.player_id
    loop
      s := public.soccer_steps(p_challenge_id, f.player_id, p_day, p_first_day);
      -- 0198: a strength workout's shots, and a game day's.
      select * into bn from public.sport_bonus_for(p_challenge_id, f.player_id, p_day, 'soccer');
      base := least(4, floor(s::numeric / g.shot_steps))::int;
      shots := base + bn.strength + case when bn.game_day then 1 else 0 end;
      if shots = 0 then
        continue;
      end if;

      select array_agg(st.player_id order by st.player_id), coalesce(sum(public.soccer_steps(p_challenge_id, st.player_id, p_day, p_first_day)), 0)
        into markers, mark_defense
        from public.soccer_tactics st
        join public.soccer_players p on p.challenge_id = st.challenge_id and p.player_id = st.player_id
        where st.challenge_id = p_challenge_id and st.day = p_day and st.mark_id = f.player_id
          and p.joined and p.team = o and p.position = 'defender';
      f_defense := case when markers is not null then mark_defense else defense end;

      aim := null;
      select st.aim into aim from public.soccer_tactics st
        where st.challenge_id = p_challenge_id and st.day = p_day and st.player_id = f.player_id;
      if aim is null then
        aim := public.soccer_seeded_zone(seed || ':' || f.player_id || ':aim');
      end if;

      for i in 1..shots loop
        if public.rally_js_rand(public.rally_js_hash(seed || ':' || f.player_id || ':' || i || ':on')) >= least(0.95, public.soccer_on_target_chance(s, f_defense) + case when bn.game_day then gdm else 0 end) then
          outcome := 'miss';
        elsif public.rally_js_rand(public.rally_js_hash(seed || ':' || f.player_id || ':' || i || ':save')) < public.soccer_save_chance(keeper_steps, s, aim, dive) then
          outcome := 'saved';
        else
          outcome := 'goal';
        end if;
        insert into public.soccer_events (challenge_id, day, day_no, team, shooter_id, keeper_id, shooter_steps, shot_no, outcome, aim, dive, marker_ids, bonus)
          values (p_challenge_id, p_day, p_day_no, t, f.player_id, keeper_id, s, i, outcome, aim, dive, markers,
                  case when i > base + bn.strength then 'game_day' when i > base then 'power' end);
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

-- Cricket (0147).
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
  bb record;
  bw record;
  share double precision;
  edge double precision;
  pw double precision;
  roll double precision;
  gdm double precision := (select c.game_day_make from public.sport_bonus_config c limit 1);
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
  select * into bw from public.sport_bonus_for(p_challenge_id, bowler, p_day, 'cricket');

  for ball in 1..6 loop
    batter := batters[(wk % nb) + 1];
    b := public.soccer_steps(p_challenge_id, batter, p_day, p_first_day);
    bowled := bowled + 1;
    -- 0198: the batter's power and either side's game day.
    select * into bb from public.sport_bonus_for(p_challenge_id, batter, p_day, 'cricket');
    share := case when b + w = 0 then 0.5 else b::double precision / (b + w) end;
    edge := (case when bb.game_day then gdm else 0 end) - (case when bw.game_day then gdm else 0 end);
    pw := 1 + 0.25 * bb.strength;
    roll := public.rally_js_rand(public.rally_js_hash(p_challenge_id::text || ':' || p_day || ':' || g.innings || ':' || over_no || ':' || ball));
    if edge = 0 and pw = 1 then
      outcome := public.cricket_ball_outcome(share, roll);
    else
      outcome := public.cricket_ball_outcome(least(1, greatest(0, share + edge)), roll, pw);
    end if;
    insert into public.cricket_balls (challenge_id, day, day_no, innings, over_no, ball_no, batting_team, batter_id, bowler_id, batter_steps, bowler_steps, outcome, runs, bonus)
      values (p_challenge_id, p_day, p_day_no, g.innings, over_no, ball, bt, batter, bowler, b, w, outcome,
              case when outcome = 'W' then 0 else outcome::int end,
              case when bb.game_day then 'game_day' when bb.strength > 0 then 'power' end);
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

-- Baseball (0167).
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
  bb record;
  pw double precision;
  gdm double precision := (select c.game_day_make from public.sport_bonus_config c limit 1);
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
    -- 0198: the batter's power and game day.
    select * into bb from public.sport_bonus_for(p_challenge_id, batter, p_day, 'baseball');
    pw := 1 + 0.25 * bb.strength;

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

    pk := public.baseball_strikeout_chance(bs, ps, approach) - case when bb.game_day then gdm / 2 else 0 end;
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

    if public.baseball_rand(seed || ':hr') < (case when bb.strength = 0 then public.baseball_home_run_chance(bs, approach)
                                                      else greatest(public.baseball_home_run_chance(bs, approach), 0.03) * pw end) then
      scored := 1 + (b1 is not null)::int + (b2 is not null)::int + (b3 is not null)::int;
      b1 := null; b2 := null; b3 := null;
      v_runs := v_runs + scored;
      v_hits := v_hits + 1;
      insert into public.baseball_plays (challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_pos, aim, shifted, runs, outs, on_first, on_second, on_third, batter_steps, pitcher_steps)
        values (p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'home_run', batter, pitcher,
          case aim when 'left' then 'lf' when 'center' then 'cf' else 'rf' end, aim, shift = aim, scored, outs, b1, b2, b3, bs, ps);
      continue;
    end if;

    len := public.baseball_hit_length(bs, approach, public.baseball_rand(seed || ':len') / pw);
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
    caught := public.baseball_rand(seed || ':catch') < public.baseball_catch_chance(bs, fs, aim, shift) - case when bb.game_day then gdm else 0 end;

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

-- Rally (0140).
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
  today date;
  bn record;
  powered boolean := false;
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
  -- 0198: a game day makes the target 20% easier; a strength bonus sends
  -- back one shuttle a day short of it.
  today := (now() at time zone public.rally_tz(p_challenge_id, caller))::date;
  select * into bn from public.sport_bonus_for(p_challenge_id, caller, today, 'rally');
  if bn.game_day then
    need := ceil(need * 0.8)::int;
  end if;
  if walked < need then
    if bn.strength > coalesce((select u.used from public.rally_power_used u where u.challenge_id = p_challenge_id and u.user_id = caller and u.day = today), 0) then
      insert into public.rally_power_used (challenge_id, user_id, day, used) values (p_challenge_id, caller, today, 1)
        on conflict (challenge_id, user_id, day) do update set used = rally_power_used.used + 1;
      powered := true;
    else
      return 'short';
    end if;
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

  insert into public.rally_events (challenge_id, kind, user_id, team, steps, target, game_no, points_a, points_b, bonus)
    values (p_challenge_id, case when smashed then 'smash' else 'return' end, caller, g.side_team, walked, need, g.game_no, g.points_a, g.points_b,
            case when powered then 'power' when bn.game_day then 'game_day' end);
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

-- Hoops (0197).
create or replace function public.hoops_play_day(p_challenge_id uuid, p_day date, p_day_no int)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.hoops_games%rowtype;
  per int;
  def_home text;
  def_away text;
  team_steps jsonb;
  seats jsonb := '[]'::jsonb;
  s record;
  rnd int;
  t text;
  o text;
  seq int := 0;
  pts_home int := 0;
  pts_away int := 0;
  st jsonb;
  i int;
  mine int;
  theirs int;
  their_def text;
  kind text;
  dunk boolean;
  fire boolean;
  ch double precision;
  made boolean;
  p int;
  streaks jsonb := '{}'::jsonb;
  streak int;
  share double precision;
  reb text;
  seed text;
  steps_home numeric;
  steps_away numeric;
  bn record;
  gdm double precision := (select c.game_day_make from public.sport_bonus_config c limit 1);
  gd double precision;
begin
  select * into g from public.hoops_games where challenge_id = p_challenge_id;
  per := public.hoops_period_of(p_day_no, g.days_per_quarter);
  def_home := public.hoops_defense(p_challenge_id, 'home', p_day);
  def_away := public.hoops_defense(p_challenge_id, 'away', p_day);

  -- Every joined seat's steps, its defender's, and its shots.
  for s in
    select hp.id, hp.player_id, hp.team, hp.shot, public.hoops_steps(p_challenge_id, hp.player_id, p_day) as steps,
           public.hoops_defender_of(hp.id) as def_id
    from public.hoops_players hp
    where hp.challenge_id = p_challenge_id and hp.joined
    order by hp.team, hp.baseline desc, hp.seated_at, hp.id
  loop
    -- 0198: a strength workout's shots past the cap, and a game day's.
    select * into bn from public.sport_bonus_for(p_challenge_id, s.player_id, p_day, 'hoops');
    seats := seats || jsonb_build_object('id', s.id, 'team', s.team, 'shot', s.shot, 'steps', s.steps, 'def', s.def_id,
      'shots', least(5, floor(s.steps::numeric / g.shot_steps))::int + bn.strength + case when bn.game_day then 1 else 0 end,
      'base', least(5, floor(s.steps::numeric / g.shot_steps))::int, 'str', bn.strength, 'gd', bn.game_day);
  end loop;
  -- Defenders' steps (a defender who hasn't joined walks nothing).
  select coalesce(jsonb_agg(x || jsonb_build_object('def_steps',
      coalesce((select (y ->> 'steps')::int from jsonb_array_elements(seats) y where y ->> 'id' = x ->> 'def'), 0))), '[]'::jsonb)
    into seats from jsonb_array_elements(seats) x;
  select coalesce(sum((x ->> 'steps')::numeric) filter (where x ->> 'team' = 'home'), 0),
         coalesce(sum((x ->> 'steps')::numeric) filter (where x ->> 'team' = 'away'), 0)
    into steps_home, steps_away from jsonb_array_elements(seats) x;

  for rnd in 1..8 loop
    foreach t in array array['home', 'away'] loop
      o := case when t = 'home' then 'away' else 'home' end;
      their_def := case when t = 'home' then def_away else def_home end;
      share := case when steps_home + steps_away = 0 then 0.5
                    when t = 'home' then steps_home / (steps_home + steps_away) else steps_away / (steps_home + steps_away) end;
      for st in select x from jsonb_array_elements(seats) x where x ->> 'team' = t and (x ->> 'shots')::int >= rnd loop
        mine := (st ->> 'steps')::int;
        theirs := (st ->> 'def_steps')::int;
        streak := coalesce((streaks ->> (st ->> 'id'))::int, 0);
        seed := p_challenge_id::text || ':' || p_day || ':' || (st ->> 'id') || ':' || rnd;
        gd := case when (st ->> 'gd')::boolean then gdm else 0 end;

        if rnd = 1 and mine >= 4000 and theirs >= 1000 and mine >= 2 * theirs then
          -- Fouled: two free throws.
          for i in 1..2 loop
            seq := seq + 1;
            made := public.rally_js_rand(public.rally_js_hash(seed || ':ft' || i)) < least(0.95, public.hoops_chance('ft', mine, theirs, their_def, false, false) + gd);
            p := case when made then 1 else 0 end;
            insert into public.hoops_events (challenge_id, day, day_no, period, seq, team, shooter, defender, kind, made, pts, shooter_steps, defender_steps, defense)
              values (p_challenge_id, p_day, p_day_no, per, seq, t, (st ->> 'id')::uuid, (st ->> 'def')::uuid, 'ft', made, p, mine, theirs, their_def);
            if t = 'home' then pts_home := pts_home + p; else pts_away := pts_away + p; end if;
          end loop;
          continue;
        end if;

        kind := st ->> 'shot';
        dunk := kind = 'drive' and mine >= 15000;
        fire := streak >= 3;
        ch := least(0.95, public.hoops_chance(kind, mine, theirs, their_def, dunk, fire) + gd);
        made := public.rally_js_rand(public.rally_js_hash(seed || ':shot')) < ch;
        p := case when not made then 0 when kind = 'three' then 3 else 2 end;
        reb := null;
        if not made then
          reb := case when public.rally_js_rand(public.rally_js_hash(seed || ':reb')) < 0.6 * share then t else o end;
        end if;
        seq := seq + 1;
        insert into public.hoops_events (challenge_id, day, day_no, period, seq, team, shooter, defender, kind, dunk, made, pts, on_fire, rebound, shooter_steps, defender_steps, defense, bonus)
          values (p_challenge_id, p_day, p_day_no, per, seq, t, (st ->> 'id')::uuid, (st ->> 'def')::uuid, kind, dunk and made, made, p, fire, reb, mine, theirs, their_def,
                  case when rnd > (st ->> 'base')::int + (st ->> 'str')::int then 'game_day' when rnd > (st ->> 'base')::int then 'power' end);
        if t = 'home' then pts_home := pts_home + p; else pts_away := pts_away + p; end if;
        streak := case when made then streak + 1 else 0 end;

        if reb = t then
          -- The putback.
          ch := least(0.95, public.hoops_chance('putback', mine, theirs, their_def, false, false) + gd);
          made := public.rally_js_rand(public.rally_js_hash(seed || ':putback')) < ch;
          p := case when made then 2 else 0 end;
          seq := seq + 1;
          insert into public.hoops_events (challenge_id, day, day_no, period, seq, team, shooter, defender, kind, made, pts, rebound, shooter_steps, defender_steps, defense)
            values (p_challenge_id, p_day, p_day_no, per, seq, t, (st ->> 'id')::uuid, (st ->> 'def')::uuid, 'putback', made, p,
                    case when made then null else o end, mine, theirs, their_def);
          if t = 'home' then pts_home := pts_home + p; else pts_away := pts_away + p; end if;
          streak := case when made then streak + 1 else 0 end;
        end if;
        streaks := streaks || jsonb_build_object(st ->> 'id', streak);
      end loop;
    end loop;
  end loop;

  insert into public.hoops_days (challenge_id, day, day_no, period, label, home, away, defense_home, defense_away)
    values (p_challenge_id, p_day, p_day_no, per, public.hoops_label(per), pts_home, pts_away, def_home, def_away);
  update public.hoops_games
    set score_home = score_home + pts_home, score_away = score_away + pts_away, days_played = p_day_no, updated_at = now()
    where challenge_id = p_challenge_id;
end;
$$;

revoke execute on function public.hoops_play_day(uuid, date, int) from public, anon, authenticated;

-- The plays, now with which were a bonus.
create or replace function public.hoops_events_json(p_challenge_id uuid, p_period int, p_day date)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'seq', e.seq, 'team', e.team, 'shooter', e.shooter, 'defender', e.defender, 'kind', e.kind, 'dunk', e.dunk,
      'made', e.made, 'pts', e.pts, 'on_fire', e.on_fire, 'rebound', e.rebound,
      'shooter_steps', e.shooter_steps, 'defender_steps', e.defender_steps, 'defense', e.defense, 'bonus', e.bonus)
    order by e.day, e.seq), '[]'::jsonb)
  from public.hoops_events e
  where e.challenge_id = p_challenge_id
    and (p_period is null or e.period = p_period)
    and (p_day is null or e.day = p_day);
$$;

revoke execute on function public.hoops_events_json(uuid, int, date) from public, anon, authenticated;

-- H-O-R-S-E (0196).
create or replace function public.horse_advance(p_challenge_id uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.horse_games%rowtype;
  caller uuid := auth.uid();
  first_day date;
  last_day date;
  cutoff date;
  d date;
  other uuid;
  target int;
  s_steps int;
  m_steps int;
  made boolean;
  matched boolean;
  letter uuid;
  n int := 0;
  wlen int;
  r record;
  extra jsonb;
  p_a uuid;
  p_b uuid;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.kind::text <> 'horse' then
    return 0;
  end if;
  if caller is not null and not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller) then
    return 0;
  end if;
  select * into g from public.horse_games where challenge_id = p_challenge_id;
  if not found or g.status <> 'active' then
    return 0;
  end if;
  first_day := public.soccer_first_day(c);
  last_day := first_day + c.duration_days - 1;
  cutoff := (now() at time zone 'utc')::date - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end;
  wlen := length(g.word);

  loop
    d := first_day + g.days_played;
    exit when d > cutoff or d > last_day;
    select cp.user_id into other from public.challenge_participants cp
      where cp.challenge_id = p_challenge_id and cp.user_id <> g.setter limit 1;
    if other is not null then
      target := public.horse_target(g.shot);
      s_steps := coalesce((select ps.steps from public.progress_snapshots ps where ps.challenge_id = p_challenge_id and ps.user_id = g.setter and ps.day = d), 0);
      m_steps := coalesce((select ps.steps from public.progress_snapshots ps where ps.challenge_id = p_challenge_id and ps.user_id = other and ps.day = d), 0);
      -- 0198: strength and a game day count as steps toward the target.
      s_steps := s_steps + public.horse_bonus_steps(p_challenge_id, g.setter, d);
      m_steps := m_steps + public.horse_bonus_steps(p_challenge_id, other, d);
      made := s_steps >= target;
      matched := case when made then m_steps >= target end;
      letter := case when made and not matched then other end;
      insert into public.horse_days (challenge_id, day, day_no, setter, matcher, shot, target, setter_steps, made, matcher_steps, matched, letter_to)
        values (p_challenge_id, d, g.days_played + 1, g.setter, other, g.shot, target, s_steps, made, case when made then m_steps end, matched, letter);
      update public.horse_games set
        days_played = days_played + 1,
        letters = case when letter is null then letters
                       else letters || jsonb_build_object(letter::text, public.horse_letter_count(g, letter) + 1) end,
        setter = case when made then setter else other end,
        updated_at = now()
        where challenge_id = p_challenge_id;
      n := n + 1;
    else
      -- Nobody to play yet: the day passes.
      update public.horse_games set days_played = days_played + 1, updated_at = now() where challenge_id = p_challenge_id;
    end if;
    select * into g from public.horse_games where challenge_id = p_challenge_id;

    select min(cp.user_id::text)::uuid, max(cp.user_id::text)::uuid into p_a, p_b
      from public.challenge_participants cp where cp.challenge_id = p_challenge_id;
    if exists (select 1 from jsonb_each_text(g.letters) l where l.value::int >= wlen)
       or first_day + g.days_played > last_day then
      update public.horse_games set
        status = 'final',
        winner = case
          when p_a is null or p_b is null or p_a = p_b then p_a
          when public.horse_letter_count(g, p_a) < public.horse_letter_count(g, p_b) then p_a
          when public.horse_letter_count(g, p_b) < public.horse_letter_count(g, p_a) then p_b
        end,
        updated_at = now()
        where challenge_id = p_challenge_id;
      select * into g from public.horse_games where challenge_id = p_challenge_id;
    end if;

    if other is not null then
      extra := (select jsonb_build_object('day_no', hd.day_no, 'word', g.word,
          'setter_id', hd.setter, 'matcher_id', hd.matcher, 'setter_name', public.horse_name(hd.setter), 'matcher_name', public.horse_name(hd.matcher),
          'shot_name', public.horse_shot_name(hd.shot), 'target', hd.target, 'made', hd.made, 'matched', hd.matched,
          'letter_to', hd.letter_to, 'letters', g.letters, 'winner', g.winner, 'next_setter', g.setter)
        from public.horse_days hd where hd.challenge_id = p_challenge_id and hd.day = d);
      for r in select cp.user_id from public.challenge_participants cp where cp.challenge_id = p_challenge_id loop
        perform public.hoops_notify(case when g.status = 'final' then 'horse_final' else 'horse_result' end, p_challenge_id, r.user_id, extra);
      end loop;
    end if;
    exit when g.status = 'final';
  end loop;
  return n;
end;
$$;

revoke execute on function public.horse_advance(uuid) from public, anon;
grant execute on function public.horse_advance(uuid) to authenticated;
