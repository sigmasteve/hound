-- Hound: Golf — your steps are yards, your workouts are power, and you
-- take every shot yourself. See 0199_golf_kind.sql for the enum value
-- this depends on (must already be committed) and 0201_golf_courses.sql
-- for the four courses.
--
-- Each player plays their own ball, whenever they like, nothing waits for
-- midnight:
--
--   yards bank  steps on the game's days ÷ steps_per_yard (10), minus
--               the yards already hit
--   power bank  workout minutes on the game's days (the player's local
--               day, as Daily Doors counts them): strength ×2, golf ×3,
--               anything else ×1, minus the power already used
--   a shot      the app sends the choices (club, yards, aim, power and
--               the swing meter's timing) and golf_shot works out where
--               it goes, with the approved prototype's maths:
--                 carry = yards × (1 + power/100) × (1 − |timing| × 0.35)
--                 curve = timing × yards × 0.3 × the club's spread
--                 wind  = yards/100 × mph × 0.375 × max(0, 1 − power/40)
--               plus roll on the fairway (6%) and green (3%). From the
--               rough the carry is ×0.85, from a bunker or the trees ×0.7.
--   lies        water: a penalty stroke and a drop; out of bounds: a
--               penalty stroke and the shot again. A hole stops at par + 4.
--   the limit   holes_per_day (3, or 0 for none) holes started a day
--   hands-off   if the creator turned off "Take every shot myself", every
--               Kennel walk (hound_walks, 10 minutes or more) is a shot,
--               played at night: walk steps ÷ 10 yards, the caddie's
--               club, at the pin, timing seeded within ±0.2
--
-- Formats: stroke (fewest strokes), skins (each hole's lowest score wins
-- skin_bones, a tie carries over) and match (two players, holes won). The
-- game ends at the challenge's end (or when everyone's holed out); an
-- unfinished hole scores par + 4. settle_challenge_score_core pays it:
-- win_bones to the winner, play_bones to everyone who finished, and each
-- player's skins.
--
-- The app creates the challenge (duration_days 4 for 9 holes, 7 for 18),
-- adds the creator as a participant, then calls golf_setup. Like the
-- other games, the tables have no write policies; every write goes
-- through the functions below. Every roll is seeded (rally_js_rand, 0140).
--
-- Run this once, after 0199 (as its own, separately committed
-- transaction), then 0201, in the SQL Editor. Pushes need
-- send-golf-notification deployed; without it the game still plays,
-- quietly.

-- ── Admin's settings ──

create table if not exists public.golf_config (
  id boolean primary key default true,
  constraint golf_config_singleton check (id),
  enabled boolean not null default true,
  steps_per_yard integer not null default 10 check (steps_per_yard between 1 and 100),
  strength_mult integer not null default 2 check (strength_mult between 0 and 10),
  golf_mult integer not null default 3 check (golf_mult between 0 and 10),
  other_mult integer not null default 1 check (other_mult between 0 and 10),
  max_power integer not null default 30 check (max_power in (0, 10, 20, 30)),
  skin_bones integer not null default 10 check (skin_bones between 0 and 500),
  win_bones integer not null default 40 check (win_bones between 0 and 500),
  play_bones integer not null default 10 check (play_bones between 0 and 500),
  -- How close counts as in: yards from the pin on a putt, and otherwise.
  putt_cup numeric(3, 2) not null default 1.3 check (putt_cup between 0.2 and 3),
  cup numeric(3, 2) not null default 0.6 check (cup between 0.2 and 3),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.golf_config (id) values (true) on conflict (id) do nothing;
alter table public.golf_config enable row level security;
drop policy if exists "Anyone signed in reads the Golf settings" on public.golf_config;
create policy "Anyone signed in reads the Golf settings" on public.golf_config for select to authenticated using (true);
revoke insert, update, delete on public.golf_config from anon, authenticated;

create or replace function public.golf_cfg()
returns public.golf_config
language sql
stable
security definer set search_path = public
as $$
  select * from public.golf_config where id;
$$;
revoke execute on function public.golf_cfg() from public, anon, authenticated;

create or replace function public.admin_set_golf_config(p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin) then
    raise exception 'not authorized';
  end if;
  update public.golf_config c set
    enabled = coalesce((p ->> 'enabled')::boolean, c.enabled),
    steps_per_yard = coalesce((p ->> 'steps_per_yard')::int, c.steps_per_yard),
    strength_mult = coalesce((p ->> 'strength_mult')::int, c.strength_mult),
    golf_mult = coalesce((p ->> 'golf_mult')::int, c.golf_mult),
    other_mult = coalesce((p ->> 'other_mult')::int, c.other_mult),
    max_power = coalesce((p ->> 'max_power')::int, c.max_power),
    skin_bones = coalesce((p ->> 'skin_bones')::int, c.skin_bones),
    win_bones = coalesce((p ->> 'win_bones')::int, c.win_bones),
    play_bones = coalesce((p ->> 'play_bones')::int, c.play_bones),
    putt_cup = coalesce((p ->> 'putt_cup')::numeric, c.putt_cup),
    cup = coalesce((p ->> 'cup')::numeric, c.cup),
    updated_at = now(), updated_by = auth.uid()
  where c.id;
end;
$$;
revoke execute on function public.admin_set_golf_config(jsonb) from public, anon;
grant execute on function public.admin_set_golf_config(jsonb) to authenticated;

-- ── Courses (the holes themselves are in 0201) ──

create table public.golf_courses (
  id text primary key check (id ~ '^[a-z]+$'),
  name text not null,
  style text not null check (style in ('links', 'desert', 'park', 'mountain')),
  note text not null default '',
  sort integer not null default 0
);

-- One hole: d is yards from the tee, lat yards across (right is +). The
-- hole column is the JSON the app draws from and the engine plays on:
-- no, par, length, name, center [[d, lat] …], fairway_w (half-width),
-- fairway_from, fairway_to, green {d, lat, r, break}, pin {d, lat}, hazards
-- [{type water|bunker|trees|waste, d, lat, rd, rl, drop {d, lat} on
-- water}], ob, wind {mph, deg} (deg 90 blows right), slope.
create table public.golf_holes (
  course_id text not null references public.golf_courses (id) on delete cascade,
  no integer not null check (no between 1 and 9),
  par integer not null check (par between 3 and 5),
  length integer not null check (length between 100 and 600),
  name text not null,
  hole jsonb not null,
  primary key (course_id, no)
);

alter table public.golf_courses enable row level security;
alter table public.golf_holes enable row level security;
revoke all on public.golf_courses, public.golf_holes from anon;
revoke insert, update, delete on public.golf_courses, public.golf_holes from authenticated;
create policy "Anyone signed in sees the golf courses" on public.golf_courses for select to authenticated using (true);
create policy "Anyone signed in sees the golf holes" on public.golf_holes for select to authenticated using (true);

-- ── The game ──

create table public.golf_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  course_id text not null references public.golf_courses (id),
  holes integer not null check (holes in (9, 18)),
  format text not null check (format in ('stroke', 'skins', 'match')),
  hands_on boolean not null default true,
  holes_per_day integer not null default 3 check (holes_per_day between 0 and 18),
  status text not null default 'active' check (status in ('active', 'final')),
  winner uuid references public.profiles (id) on delete set null,
  -- Settled skins, in hole order: [{hole, winner, bones, carried}].
  skins jsonb not null default '[]'::jsonb,
  carry integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.golf_games enable row level security;
revoke all on public.golf_games from anon;
revoke insert, update, delete on public.golf_games from authenticated;
create policy "Participants can view their golf game"
  on public.golf_games for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = golf_games.challenge_id and cp.user_id = auth.uid()));

-- Where each player is: the hole they're on (the game's number, 1 to 18),
-- strokes so far on it, the ball and its lie, and their card.
create table public.golf_players (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined boolean not null default false,
  hole integer not null default 1,
  strokes integer not null default 0,
  ball_d numeric(7, 2) not null default 0,
  ball_lat numeric(7, 2) not null default 0,
  lie text not null default 'tee' check (lie in ('tee', 'fairway', 'rough', 'bunker', 'green')),
  scores integer[] not null,
  yards_spent integer not null default 0,
  power_spent integer not null default 0,
  finished_at timestamptz,
  -- Hands-off: walks that started at or before this have had their turn.
  walks_through timestamptz,
  reminded_on date,
  seated_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index golf_players_user_idx on public.golf_players (user_id);

alter table public.golf_players enable row level security;
revoke all on public.golf_players from anon;
revoke insert, update, delete on public.golf_players from authenticated;
create policy "Participants can view their golf field"
  on public.golf_players for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = golf_players.challenge_id and cp.user_id = auth.uid()));

-- Every swing. seq counts swings on the hole (penalties aren't swings);
-- to is where it came down, ball where the next one's played from (a
-- drop, or the same spot after out of bounds). score is set on the shot
-- that ends the hole.
create table public.golf_shots (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  hole integer not null,
  seq integer not null,
  club text not null check (club in ('driver', 'wood', 'i5', 'i7', 'i9', 'wedge', 'putter')),
  yards integer not null,
  aim numeric(5, 2) not null,
  power integer not null,
  timing numeric(5, 3) not null,
  from_d numeric(7, 2) not null,
  from_lat numeric(7, 2) not null,
  to_d numeric(7, 2) not null,
  to_lat numeric(7, 2) not null,
  ball_d numeric(7, 2) not null,
  ball_lat numeric(7, 2) not null,
  carry numeric(6, 1) not null,
  lie text not null check (lie in ('tee', 'fairway', 'rough', 'bunker', 'green', 'water', 'out')),
  penalty integer not null default 0,
  holed boolean not null default false,
  picked_up boolean not null default false,
  par integer not null,
  score integer,
  wind_mph integer not null default 0,
  wind_deg integer not null default 0,
  walk_id uuid unique references public.hound_walks (id) on delete set null,
  day date not null,
  created_at timestamptz not null default now(),
  unique (challenge_id, user_id, hole, seq)
);
create index golf_shots_day_idx on public.golf_shots (challenge_id, user_id, day);
create index golf_shots_created_idx on public.golf_shots (created_at);

alter table public.golf_shots enable row level security;
revoke all on public.golf_shots from anon;
revoke insert, update, delete on public.golf_shots from authenticated;
create policy "Participants can view their golf shots"
  on public.golf_shots for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = golf_shots.challenge_id and cp.user_id = auth.uid()));

-- ── Clubs ──

create or replace function public.golf_club_max(p_club text)
returns int
language sql
immutable
as $$
  select case p_club when 'driver' then 250 when 'wood' then 225 when 'i5' then 190 when 'i7' then 160
    when 'i9' then 130 when 'wedge' then 100 when 'putter' then 30 end;
$$;
revoke execute on function public.golf_club_max(text) from public, anon, authenticated;

create or replace function public.golf_club_spread(p_club text)
returns numeric
language sql
immutable
as $$
  select case p_club when 'driver' then 1 when 'wood' then 0.85 when 'i5' then 0.7 when 'i7' then 0.6
    when 'i9' then 0.5 when 'wedge' then 0.4 when 'putter' then 0.12 end;
$$;
revoke execute on function public.golf_club_spread(text) from public, anon, authenticated;

create or replace function public.golf_club_name(p_club text)
returns text
language sql
immutable
as $$
  select case p_club when 'driver' then 'Driver' when 'wood' then '3-wood' when 'i5' then '5-iron' when 'i7' then '7-iron'
    when 'i9' then '9-iron' when 'wedge' then 'Wedge' when 'putter' then 'Putter' end;
$$;
revoke execute on function public.golf_club_name(text) from public, anon, authenticated;

-- The caddie: the shortest club that reaches, the driver past that.
create or replace function public.golf_auto_club(p_yards numeric)
returns text
language sql
immutable
as $$
  select case when p_yards <= 100 then 'wedge' when p_yards <= 130 then 'i9' when p_yards <= 160 then 'i7'
    when p_yards <= 190 then 'i5' when p_yards <= 225 then 'wood' else 'driver' end;
$$;
revoke execute on function public.golf_auto_club(numeric) from public, anon, authenticated;

-- ── The hole's ground ──

-- The fairway's centre line at d yards: straight lines between the points.
create or replace function public.golf_center(h jsonb, p_d numeric)
returns numeric
language plpgsql
immutable
as $$
declare
  pts jsonb := coalesce(h -> 'center', '[]'::jsonb);
  n int := jsonb_array_length(coalesce(h -> 'center', '[]'::jsonb));
  i int;
  d0 numeric;
  d1 numeric;
  l0 numeric;
  l1 numeric;
begin
  if n = 0 then
    return 0;
  end if;
  if p_d <= (pts -> 0 ->> 0)::numeric then
    return (pts -> 0 ->> 1)::numeric;
  end if;
  for i in 1 .. n - 1 loop
    d1 := (pts -> i ->> 0)::numeric;
    if p_d <= d1 then
      d0 := (pts -> (i - 1) ->> 0)::numeric;
      l0 := (pts -> (i - 1) ->> 1)::numeric;
      l1 := (pts -> i ->> 1)::numeric;
      if d1 = d0 then
        return l1;
      end if;
      return l0 + (l1 - l0) * (p_d - d0) / (d1 - d0);
    end if;
  end loop;
  return (pts -> (n - 1) ->> 1)::numeric;
end;
$$;
revoke execute on function public.golf_center(jsonb, numeric) from public, anon, authenticated;

-- The first hazard of these types the point is in, or null.
create or replace function public.golf_hazard_at(h jsonb, p_d numeric, p_lat numeric, p_types text[])
returns jsonb
language sql
immutable
as $$
  select e from jsonb_array_elements(coalesce(h -> 'hazards', '[]'::jsonb)) with ordinality x(e, k)
  where e ->> 'type' = any (p_types)
    and power((p_d - (e ->> 'd')::numeric) / (e ->> 'rd')::numeric, 2)
      + power((p_lat - (e ->> 'lat')::numeric) / (e ->> 'rl')::numeric, 2) <= 1
  order by k
  limit 1;
$$;
revoke execute on function public.golf_hazard_at(jsonb, numeric, numeric, text[]) from public, anon, authenticated;

-- What the ball's lying on. Waste areas play as sand; trees as rough
-- (with the trees' own penalty on the next shot, golf_lie_factor).
create or replace function public.golf_lie(h jsonb, p_d numeric, p_lat numeric)
returns text
language plpgsql
immutable
as $$
begin
  if abs(p_lat) > (h ->> 'ob')::numeric or p_d > (h -> 'green' ->> 'd')::numeric + 40 or p_d < -20 then
    return 'out';
  end if;
  if public.golf_hazard_at(h, p_d, p_lat, array['water']) is not null then
    return 'water';
  end if;
  if public.golf_hazard_at(h, p_d, p_lat, array['bunker', 'waste']) is not null then
    return 'bunker';
  end if;
  if sqrt(power(p_d - (h -> 'green' ->> 'd')::numeric, 2) + power(p_lat - (h -> 'green' ->> 'lat')::numeric, 2))
     <= (h -> 'green' ->> 'r')::numeric then
    return 'green';
  end if;
  if p_d < 16 and abs(p_lat) < 7 then
    return 'tee';
  end if;
  if public.golf_hazard_at(h, p_d, p_lat, array['trees']) is not null then
    return 'rough';
  end if;
  if p_d > (h ->> 'fairway_from')::numeric and p_d < (h ->> 'fairway_to')::numeric
     and abs(p_lat - public.golf_center(h, p_d)) <= (h ->> 'fairway_w')::numeric then
    return 'fairway';
  end if;
  return 'rough';
end;
$$;
revoke execute on function public.golf_lie(jsonb, numeric, numeric) from public, anon, authenticated;

-- How much of a full carry the lie allows (putts roll true from anywhere
-- on the green).
create or replace function public.golf_lie_factor(h jsonb, p_d numeric, p_lat numeric, p_lie text, p_club text)
returns numeric
language sql
immutable
as $$
  select case
    when p_club = 'putter' then 1
    when p_lie = 'bunker' then 0.7
    when p_lie = 'rough' and public.golf_hazard_at(h, p_d, p_lat, array['trees']) is not null then 0.7
    when p_lie = 'rough' then 0.85
    else 1 end;
$$;
revoke execute on function public.golf_lie_factor(jsonb, numeric, numeric, text, text) from public, anon, authenticated;

-- One shot's flight, the prototype's maths. Aim is degrees off the line
-- to the pin (right +); timing is the meter's offset from the middle
-- (early is negative and goes left, late right). Curve bends square to
-- the line of the shot; the wind pushes across the hole (deg 90 blows
-- right, 270 left), and on a putt the green's break does. Returns where
-- it came to rest and on what.
create or replace function public.golf_flight(
  h jsonb, p_d numeric, p_lat numeric, p_lie text, p_club text, p_yards numeric, p_aim numeric,
  p_power numeric, p_timing numeric, p_wind_mph numeric, p_wind_deg numeric,
  p_putt_cup numeric default 1.3, p_cup numeric default 0.6
)
returns jsonb
language plpgsql
immutable
as $$
declare
  pin_d numeric := (h -> 'pin' ->> 'd')::numeric;
  pin_lat numeric := (h -> 'pin' ->> 'lat')::numeric;
  putt boolean := p_club = 'putter';
  th double precision := atan2((pin_lat - p_lat)::double precision, (pin_d - p_d)::double precision) + radians(p_aim::double precision);
  carry numeric := p_yards * (1 + p_power / 100.0) * public.golf_lie_factor(h, p_d, p_lat, p_lie, p_club);
  dist numeric := carry * (1 - abs(p_timing) * 0.35);
  curve numeric := p_timing * p_yards * 0.3 * public.golf_club_spread(p_club);
  wind numeric := case when putt then 0
    else p_yards / 100.0 * p_wind_mph * 0.375 * greatest(0, 1 - p_power / 40.0) * sin(radians(p_wind_deg::double precision))::numeric end;
  -- The green's break (0201): a putt drifts across the hole by this share
  -- of how far it rolls, + to the right.
  brk numeric := case when putt then coalesce((h -> 'green' ->> 'break')::numeric, 0) * dist else 0 end;
  to_d numeric;
  to_lat numeric;
  lie text;
  holed boolean;
begin
  to_d := p_d + dist * cos(th)::numeric - curve * sin(th)::numeric;
  to_lat := p_lat + dist * sin(th)::numeric + curve * cos(th)::numeric + wind + brk;
  lie := public.golf_lie(h, to_d, to_lat);
  if not putt and lie in ('fairway', 'green') then
    to_d := to_d + dist * (case when lie = 'fairway' then 0.06 else 0.03 end) * cos(th)::numeric;
    to_lat := to_lat + dist * (case when lie = 'fairway' then 0.06 else 0.03 end) * sin(th)::numeric;
    lie := public.golf_lie(h, to_d, to_lat);
  end if;
  holed := lie <> 'out' and sqrt(power(to_d - pin_d, 2) + power(to_lat - pin_lat, 2)) <= case when putt then p_putt_cup else p_cup end;
  if holed then
    to_d := pin_d;
    to_lat := pin_lat;
    lie := 'green';
  end if;
  return jsonb_build_object('to_d', round(to_d, 2), 'to_lat', round(to_lat, 2), 'carry', round(dist, 1), 'lie', lie, 'holed', holed);
end;
$$;
revoke execute on function public.golf_flight(jsonb, numeric, numeric, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric)
  from public, anon, authenticated;

-- The hole's wind on a day: its base, ± up to 3 mph, the same for
-- everyone on that course that day.
create or replace function public.golf_wind(p_course text, p_no int, p_day date)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'mph', greatest(0, round(coalesce((h.hole -> 'wind' ->> 'mph')::numeric, 0)
      + (public.rally_js_rand(public.rally_js_hash(p_course || ':' || p_no || ':' || p_day || ':wind')) - 0.5) * 6))::int,
    'deg', coalesce((h.hole -> 'wind' ->> 'deg')::int, 90))
  from public.golf_holes h where h.course_id = p_course and h.no = p_no;
$$;
revoke execute on function public.golf_wind(text, int, date) from public, anon, authenticated;

-- The course hole a game hole plays (18 holes is the nine twice).
create or replace function public.golf_course_no(p_hole int)
returns int
language sql
immutable
as $$
  select ((p_hole - 1) % 9) + 1;
$$;
revoke execute on function public.golf_course_no(int) from public, anon, authenticated;

create or replace function public.golf_par(p_course text, p_hole int)
returns int
language sql
stable
security definer set search_path = public
as $$
  select h.par from public.golf_holes h where h.course_id = p_course and h.no = public.golf_course_no(p_hole);
$$;
revoke execute on function public.golf_par(text, int) from public, anon, authenticated;

-- A card's total and its score against par, over the holes played.
create or replace function public.golf_to_par(p_course text, p_scores int[])
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce(sum(s - public.golf_par(p_course, k::int)), 0)::int
  from unnest(p_scores) with ordinality x(s, k) where s is not null;
$$;
revoke execute on function public.golf_to_par(text, int[]) from public, anon, authenticated;

create or replace function public.golf_total(p_scores int[])
returns int
language sql
immutable
as $$
  select coalesce(sum(s), 0)::int from unnest(p_scores) s;
$$;
revoke execute on function public.golf_total(int[]) from public, anon, authenticated;

-- ── Banks ──

-- The game's days: the first day through its last.
create or replace function public.golf_days(c public.challenges)
returns daterange
language sql
immutable
as $$
  select daterange(public.soccer_first_day(c), public.soccer_first_day(c) + greatest(c.duration_days, 1), '[)');
$$;
revoke execute on function public.golf_days(public.challenges) from public, anon, authenticated;

-- Workouts on the game's days, by the player's local day (Daily Doors'
-- rule), each worth its minutes (three hours at most) × its kind's
-- multiplier.
create or replace function public.golf_workouts(p_challenge_id uuid, p_user uuid)
returns table (name text, minutes int, mult int, power int)
language sql
stable
security definer set search_path = public
as $$
  with c as (select * from public.challenges where id = p_challenge_id),
  cfg as (select * from public.golf_config where id),
  tz as (select coalesce((select p.time_zone from public.profiles p where p.id = p_user), 'America/New_York') as z),
  w as (
    select w.name, least(greatest(coalesce(w.duration_min, 0), 0), 180) as minutes,
      case
        when w.name ~* 'golf' then cfg.golf_mult
        when w.name ~* '(strength|weight|functional|lift|resistance|crossfit|cross training|core training|kettlebell)' then cfg.strength_mult
        else cfg.other_mult end as mult
    from public.workout_history w, c, cfg, tz
    where w.user_id = p_user
      and w.occurred_at >= (lower(public.golf_days(c)) - 1)::timestamp at time zone 'utc'
      and w.occurred_at < (upper(public.golf_days(c)) + 1)::timestamp at time zone 'utc'
      and (w.occurred_at at time zone tz.z)::date <@ public.golf_days(c)
  )
  select w.name, sum(w.minutes)::int, w.mult, sum(w.minutes * w.mult)::int
  from w group by w.name, w.mult order by sum(w.minutes * w.mult) desc, w.name;
$$;
revoke execute on function public.golf_workouts(uuid, uuid) from public, anon, authenticated;

-- What's left to hit with: {steps, yards, power}.
create or replace function public.golf_banks(p_challenge_id uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  p public.golf_players%rowtype;
  steps int;
  earned int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into p from public.golf_players where challenge_id = p_challenge_id and user_id = p_user;
  select coalesce(sum(ps.steps), 0)::int into steps from public.progress_snapshots ps
    where ps.challenge_id = p_challenge_id and ps.user_id = p_user and ps.day <@ public.golf_days(c);
  select coalesce(sum(w.power), 0)::int into earned from public.golf_workouts(p_challenge_id, p_user) w;
  return jsonb_build_object(
    'steps', steps,
    'yards', greatest(0, steps / (public.golf_cfg()).steps_per_yard - coalesce(p.yards_spent, 0)),
    'power', greatest(0, earned - coalesce(p.power_spent, 0)));
end;
$$;
revoke execute on function public.golf_banks(uuid, uuid) from public, anon, authenticated;

-- Holes someone's started on a day (a hole starts with its first swing).
create or replace function public.golf_started_on(p_challenge_id uuid, p_user uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select count(*)::int from public.golf_shots s
  where s.challenge_id = p_challenge_id and s.user_id = p_user and s.day = p_day and s.seq = 1;
$$;
revoke execute on function public.golf_started_on(uuid, uuid, date) from public, anon, authenticated;

-- ── Names and pushes ──

create or replace function public.golf_name(p_user uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select case when p.use_username and p.username is not null then p.username else p.name end
    from public.profiles p where p.id = p_user), 'Someone');
$$;
revoke execute on function public.golf_name(uuid) from public, anon, authenticated;

create or replace function public.golf_notify(p_kind text, p_challenge_id uuid, p_recipient uuid, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_recipient is null or not exists (select 1 from public.profiles p where p.id = p_recipient) then
    return;
  end if;
  perform net.http_post(
    url := public.edge_function_url('send-golf-notification'),
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
revoke execute on function public.golf_notify(text, uuid, uuid, jsonb) from public, anon, authenticated;

-- ── Setting up and joining ──

-- The creator picks the course, 9 or 18 holes, the format, whether
-- everyone takes their own shots, the daily limit and who's invited
-- (themselves included), right after creating the challenge. Anyone named
-- still has to accept their invite.
create or replace function public.golf_setup(
  p_challenge_id uuid, p_course text, p_holes int, p_format text, p_hands_on boolean,
  p_holes_per_day int, p_players uuid[]
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  n int := coalesce(array_length(p_players, 1), 0);
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'golf' or c.created_by is distinct from caller then
    raise exception 'Only whoever made this game can set it up.';
  end if;
  if not (public.golf_cfg()).enabled then
    raise exception 'Golf is paused right now.';
  end if;
  if exists (select 1 from public.golf_games g where g.challenge_id = p_challenge_id) then
    raise exception 'This game is already set up.';
  end if;
  if not exists (select 1 from public.golf_courses k where k.id = p_course) then
    raise exception 'Pick a course.';
  end if;
  if p_holes is null or p_holes not in (9, 18) then
    raise exception 'A round is 9 holes or 18.';
  end if;
  if p_format is null or p_format not in ('stroke', 'skins', 'match') then
    raise exception 'Pick stroke play, skins or match play.';
  end if;
  if p_holes_per_day is null or p_holes_per_day not between 0 and 18 then
    raise exception 'Holes a day is a number, or 0 for no limit.';
  end if;
  if n < 1 or not (caller = any (p_players)) then
    raise exception 'You''re playing too.';
  end if;
  if (select count(distinct x) from unnest(p_players) x) <> n then
    raise exception 'Everyone in the game has to be a different person.';
  end if;
  if exists (select 1 from unnest(p_players) x where x is null or not exists (select 1 from public.profiles p where p.id = x)) then
    raise exception 'One of the players isn''t on Hound.';
  end if;
  if p_format = 'match' and n <> 2 then
    raise exception 'Match play is one on one: you and one friend.';
  end if;
  if n > 12 then
    raise exception 'Up to 12 can play.';
  end if;

  insert into public.golf_games (challenge_id, course_id, holes, format, hands_on, holes_per_day)
  values (p_challenge_id, p_course, p_holes, p_format, coalesce(p_hands_on, true), p_holes_per_day);

  insert into public.golf_players (challenge_id, user_id, joined, scores)
  select p_challenge_id, x,
    exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = x),
    array_fill(null::int, array[p_holes])
  from unnest(p_players) x;
end;
$$;
revoke execute on function public.golf_setup(uuid, text, int, text, boolean, int, uuid[]) from public, anon;
grant execute on function public.golf_setup(uuid, text, int, text, boolean, int, uuid[]) to authenticated;

-- Before the game's set up, only the creator's own row gets in. After,
-- anyone invited can join while it's on (a match only the two named).
create or replace function public.golf_before_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  g public.golf_games%rowtype;
begin
  if not exists (select 1 from public.challenges c where c.id = new.challenge_id and c.kind::text = 'golf') then
    return new;
  end if;
  select * into g from public.golf_games where challenge_id = new.challenge_id;
  if not found then
    if exists (select 1 from public.challenge_participants cp where cp.challenge_id = new.challenge_id) then
      raise exception 'This game isn''t set up yet.';
    end if;
    return new;
  end if;
  if g.status <> 'active' then
    raise exception 'This round is over.';
  end if;
  if not exists (select 1 from public.golf_players p where p.challenge_id = new.challenge_id and p.user_id = new.user_id) then
    if g.format = 'match' then
      raise exception 'This match is already one on one.';
    end if;
    if (select count(*) from public.golf_players p where p.challenge_id = new.challenge_id) >= 12 then
      raise exception 'This game is full.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.golf_before_join() from public, anon, authenticated;
create trigger golf_before_join
  before insert on public.challenge_participants
  for each row execute procedure public.golf_before_join();

create or replace function public.golf_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  g public.golf_games%rowtype;
begin
  select * into g from public.golf_games where challenge_id = new.challenge_id;
  if not found then
    return new;
  end if;
  insert into public.golf_players (challenge_id, user_id, joined, scores)
  values (new.challenge_id, new.user_id, true, array_fill(null::int, array[g.holes]))
  on conflict (challenge_id, user_id) do update set joined = true;
  return new;
end;
$$;
revoke execute on function public.golf_after_join() from public, anon, authenticated;
create trigger golf_after_join
  after insert on public.challenge_participants
  for each row execute procedure public.golf_after_join();

-- ── Skins, the end ──

-- Settles skins holes in order, as far as everyone's holed out (or every
-- hole, at the end). A hole's lowest score alone wins the pot: Admin's
-- skin Bones plus whatever carried in. A tie carries it on.
create or replace function public.golf_settle_skins(p_challenge_id uuid, p_final boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.golf_games%rowtype;
  k int;
  low int;
  n_low int;
  n_players int;
  who uuid;
  pot int;
  carry_in int;
  v_skins jsonb;
  v_carry int;
  cname text;
begin
  select * into g from public.golf_games where challenge_id = p_challenge_id for update;
  if not found or g.format <> 'skins' then
    return;
  end if;
  select count(*) into n_players from public.golf_players p where p.challenge_id = p_challenge_id and p.joined;
  if n_players = 0 then
    return;
  end if;
  v_skins := g.skins;
  v_carry := g.carry;
  select k2.name into cname from public.golf_courses k2 where k2.id = g.course_id;
  for k in jsonb_array_length(g.skins) + 1 .. g.holes loop
    exit when not p_final and exists (
      select 1 from public.golf_players p where p.challenge_id = p_challenge_id and p.joined and p.scores[k] is null);
    select min(coalesce(p.scores[k], public.golf_par(g.course_id, k) + 4)) into low
      from public.golf_players p where p.challenge_id = p_challenge_id and p.joined;
    select count(*), min(p.user_id::text)::uuid into n_low, who
      from public.golf_players p
      where p.challenge_id = p_challenge_id and p.joined and coalesce(p.scores[k], public.golf_par(g.course_id, k) + 4) = low;
    carry_in := v_carry;
    pot := (public.golf_cfg()).skin_bones + v_carry;
    if n_low = 1 and n_players >= 2 then
      v_skins := v_skins || jsonb_build_array(jsonb_build_object('hole', k, 'winner', who, 'bones', pot, 'carried', carry_in));
      v_carry := 0;
      perform public.golf_notify('skin', p_challenge_id, who, jsonb_build_object('hole', k, 'bones', pot, 'course_name', cname));
    else
      v_skins := v_skins || jsonb_build_array(jsonb_build_object('hole', k, 'winner', null, 'bones', pot, 'carried', carry_in));
      v_carry := pot;
    end if;
  end loop;
  update public.golf_games set skins = v_skins, carry = v_carry, updated_at = now() where challenge_id = p_challenge_id;
end;
$$;
revoke execute on function public.golf_settle_skins(uuid, boolean) from public, anon, authenticated;

-- A player's Bones from skins.
create or replace function public.golf_skin_bones(p_skins jsonb, p_user uuid)
returns int
language sql
immutable
as $$
  select coalesce(sum((e ->> 'bones')::int), 0)::int from jsonb_array_elements(coalesce(p_skins, '[]'::jsonb)) e
  where e ->> 'winner' = p_user::text;
$$;
revoke execute on function public.golf_skin_bones(jsonb, uuid) from public, anon, authenticated;

-- Match play from one side: holes won minus holes lost, over the holes
-- both have finished.
create or replace function public.golf_match_up(p_challenge_id uuid, p_user uuid)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce(sum(sign(o.scores[k] - m.scores[k])), 0)::int
  from public.golf_players m
  join public.golf_players o on o.challenge_id = m.challenge_id and o.user_id <> m.user_id and o.joined
  cross join generate_series(1, array_length(m.scores, 1)) k
  where m.challenge_id = p_challenge_id and m.user_id = p_user and m.scores[k] is not null and o.scores[k] is not null;
$$;
revoke execute on function public.golf_match_up(uuid, uuid) from public, anon, authenticated;

create or replace function public.golf_match_text(p_up int)
returns text
language sql
immutable
as $$
  select case when p_up = 0 then 'All square' when p_up > 0 then p_up || ' up' else (-p_up) || ' down' end;
$$;
revoke execute on function public.golf_match_text(int) from public, anon, authenticated;

-- The end: every unfinished hole scores par + 4, the last skins settle,
-- and the winner is the lowest total (stroke), the most skin Bones
-- (skins) or the most holes won (match); a tie, or a round alone, has
-- none.
create or replace function public.golf_finish(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.golf_games%rowtype;
  win uuid;
  r record;
  cname text;
begin
  select * into g from public.golf_games where challenge_id = p_challenge_id for update;
  if not found or g.status <> 'active' then
    return;
  end if;
  update public.golf_players p
    set scores = (select array_agg(coalesce(p.scores[k], public.golf_par(g.course_id, k) + 4) order by k)
                  from generate_series(1, g.holes) k)
    where p.challenge_id = p_challenge_id and p.joined and p.finished_at is null;
  perform public.golf_settle_skins(p_challenge_id, true);
  select * into g from public.golf_games where challenge_id = p_challenge_id;

  if (select count(*) from public.golf_players p where p.challenge_id = p_challenge_id and p.joined) >= 2 then
    with s as (
      select p.user_id,
        case g.format
          when 'stroke' then -public.golf_total(p.scores)
          when 'skins' then public.golf_skin_bones(g.skins, p.user_id) * 100
            + (select count(*) from jsonb_array_elements(g.skins) e where e ->> 'winner' = p.user_id::text)
          else public.golf_match_up(p_challenge_id, p.user_id) end as v
      from public.golf_players p where p.challenge_id = p_challenge_id and p.joined
    )
    select s.user_id into win from s
    where s.v = (select max(v) from s) and (select count(*) from s s2 where s2.v = s.v) = 1;
  end if;

  update public.golf_games set status = 'final', winner = win, finished_at = now(), updated_at = now()
    where challenge_id = p_challenge_id;
  select k.name into cname from public.golf_courses k where k.id = g.course_id;
  for r in select p.user_id, p.scores from public.golf_players p where p.challenge_id = p_challenge_id and p.joined loop
    perform public.golf_notify('final', p_challenge_id, r.user_id, jsonb_build_object(
      'winner_id', win, 'winner_name', case when win is null then null else public.golf_name(win) end,
      'total', public.golf_total(r.scores), 'to_par', public.golf_to_par(g.course_id, r.scores), 'course_name', cname));
  end loop;
end;
$$;
revoke execute on function public.golf_finish(uuid) from public, anon, authenticated;

-- ── The shot ──

-- Plays one swing for a player whose row is locked and whose choices are
-- already checked, and moves them on. Internal: golf_shot (by hand) and
-- golf_play_walks (hands-off) call it.
create or replace function public.golf_strike(
  p_challenge_id uuid, p_user uuid, p_club text, p_yards int, p_aim numeric, p_power int, p_timing numeric,
  p_walk uuid, p_day date
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  g public.golf_games%rowtype;
  pl public.golf_players%rowtype;
  h jsonb;
  hpar int;
  cno int;
  cname text;
  w jsonb;
  f jsonb;
  v_to_d numeric;
  v_to_lat numeric;
  v_ball_d numeric;
  v_ball_lat numeric;
  v_lie text;
  v_rest_lie text;
  v_penalty int := 0;
  v_holed boolean;
  v_strokes int;
  v_score int;
  v_picked boolean := false;
  n_seq int;
  hz jsonb;
  msg text;
  word text;
  in_trees boolean;
  r record;
  finished boolean := false;
  banks jsonb;
begin
  select * into g from public.golf_games where challenge_id = p_challenge_id;
  select * into pl from public.golf_players where challenge_id = p_challenge_id and user_id = p_user;
  cno := public.golf_course_no(pl.hole);
  select x.hole, x.par into h, hpar from public.golf_holes x where x.course_id = g.course_id and x.no = cno;
  select k.name into cname from public.golf_courses k where k.id = g.course_id;
  w := public.golf_wind(g.course_id, cno, p_day);
  f := public.golf_flight(h, pl.ball_d, pl.ball_lat, pl.lie, p_club, p_yards, p_aim, p_power, p_timing,
    (w ->> 'mph')::numeric, (w ->> 'deg')::numeric, (public.golf_cfg()).putt_cup, (public.golf_cfg()).cup);
  v_to_d := (f ->> 'to_d')::numeric;
  v_to_lat := (f ->> 'to_lat')::numeric;
  v_lie := f ->> 'lie';
  v_holed := (f ->> 'holed')::boolean;
  v_strokes := pl.strokes + 1;
  v_ball_d := v_to_d;
  v_ball_lat := v_to_lat;
  v_rest_lie := v_lie;

  if v_lie = 'water' then
    v_penalty := 1;
    hz := public.golf_hazard_at(h, v_to_d, v_to_lat, array['water']);
    if hz ? 'drop' then
      v_ball_d := (hz -> 'drop' ->> 'd')::numeric;
      v_ball_lat := (hz -> 'drop' ->> 'lat')::numeric;
      v_rest_lie := public.golf_lie(h, v_ball_d, v_ball_lat);
      if v_rest_lie in ('water', 'out', 'tee') then
        v_rest_lie := 'rough';
      end if;
    else
      v_ball_d := pl.ball_d;
      v_ball_lat := pl.ball_lat;
      v_rest_lie := pl.lie;
    end if;
  elsif v_lie = 'out' then
    v_penalty := 1;
    v_ball_d := pl.ball_d;
    v_ball_lat := pl.ball_lat;
    v_rest_lie := pl.lie;
  end if;
  v_strokes := v_strokes + v_penalty;

  if v_holed then
    v_score := v_strokes;
  elsif v_strokes >= hpar + 4 then
    v_score := hpar + 4;
    v_picked := true;
  end if;

  select coalesce(max(s.seq), 0) + 1 into n_seq from public.golf_shots s
    where s.challenge_id = p_challenge_id and s.user_id = p_user and s.hole = pl.hole;
  insert into public.golf_shots (challenge_id, user_id, hole, seq, club, yards, aim, power, timing,
    from_d, from_lat, to_d, to_lat, ball_d, ball_lat, carry, lie, penalty, holed, picked_up, par, score,
    wind_mph, wind_deg, walk_id, day)
  values (p_challenge_id, p_user, pl.hole, n_seq, p_club, p_yards, p_aim, p_power, p_timing,
    pl.ball_d, pl.ball_lat, v_to_d, v_to_lat, v_ball_d, v_ball_lat, (f ->> 'carry')::numeric, v_lie, v_penalty, v_holed, v_picked, hpar, v_score,
    (w ->> 'mph')::int, (w ->> 'deg')::int, p_walk, p_day);

  if v_score is not null then
    finished := pl.hole >= g.holes;
    update public.golf_players p set
      scores[pl.hole] = v_score,
      hole = least(pl.hole + 1, g.holes),
      strokes = 0, ball_d = 0, ball_lat = 0, lie = 'tee',
      yards_spent = p.yards_spent + p_yards, power_spent = p.power_spent + p_power,
      finished_at = case when finished then now() else null end
    where p.challenge_id = p_challenge_id and p.user_id = p_user;
  else
    update public.golf_players p set
      strokes = v_strokes, ball_d = v_ball_d, ball_lat = v_ball_lat, lie = v_rest_lie,
      yards_spent = p.yards_spent + p_yards, power_spent = p.power_spent + p_power
    where p.challenge_id = p_challenge_id and p.user_id = p_user;
  end if;

  -- What to tell them.
  in_trees := v_lie = 'rough' and public.golf_hazard_at(h, v_to_d, v_to_lat, array['trees']) is not null;
  if v_holed then
    word := case
      when v_score = 1 then 'Hole in one!'
      when v_score - hpar <= -3 then 'Albatross!'
      when v_score - hpar = -2 then 'Eagle!'
      when v_score - hpar = -1 then 'Birdie!'
      when v_score - hpar = 0 then 'Par.'
      when v_score - hpar = 1 then 'Bogey.'
      when v_score - hpar = 2 then 'Double bogey.'
      else 'In at last.' end;
    msg := word || ' In the hole in ' || v_score || '.';
  else
    msg := case
      when p_club = 'putter' then case when abs(p_timing) < 0.06 then 'Good putt.' when p_timing < 0 then 'Pulled it.' else 'Pushed it.' end
      when abs(p_timing) < 0.06 then 'Pure.'
      when p_timing < -0.2 then 'Hooked it.'
      when p_timing < 0 then 'A little left.'
      when p_timing > 0.2 then 'Sliced it.'
      else 'A little right.' end
      || ' ' || round((f ->> 'carry')::numeric) || ' yd, '
      || case v_lie
        when 'fairway' then 'fairway.'
        when 'rough' then case when in_trees then 'in the trees.' else 'rough.' end
        when 'bunker' then case when public.golf_hazard_at(h, v_to_d, v_to_lat, array['waste']) is not null then 'in the waste area.' else 'in the bunker.' end
        when 'green' then 'on the green.'
        when 'tee' then 'still on the tee.'
        when 'water' then 'in the water: a penalty stroke, dropped short of it.'
        when 'out' then 'out of bounds: a penalty stroke, play it again.'
        else v_lie || '.' end;
    if v_picked then
      msg := msg || ' That''s ' || v_score || ': picked up.';
    end if;
  end if;

  -- A birdie or better: everyone else in the game hears about it.
  if v_holed and v_score <= hpar - 1 then
    for r in select p.user_id from public.golf_players p
      where p.challenge_id = p_challenge_id and p.joined and p.user_id <> p_user loop
      perform public.golf_notify(case when v_score = 1 then 'ace' else 'birdie' end, p_challenge_id, r.user_id, jsonb_build_object(
        'player_id', p_user, 'player_name', public.golf_name(p_user), 'hole', pl.hole, 'to_par', v_score - hpar,
        'score', v_score, 'course_name', cname));
    end loop;
  end if;

  if v_score is not null then
    perform public.golf_settle_skins(p_challenge_id, false);
  end if;

  banks := public.golf_banks(p_challenge_id, p_user);
  return jsonb_build_object(
    'hole', pl.hole,
    'from', jsonb_build_object('d', pl.ball_d, 'lat', pl.ball_lat),
    'to', jsonb_build_object('d', v_to_d, 'lat', v_to_lat),
    'ball', jsonb_build_object('d', v_ball_d, 'lat', v_ball_lat),
    'carry', round((f ->> 'carry')::numeric),
    'lie', v_lie,
    'penalty', v_penalty,
    'holed', v_holed,
    'picked_up', v_picked,
    'hole_score', v_score,
    'strokes_on_hole', case when v_score is not null then v_score else v_strokes end,
    'next_hole', case when v_score is not null and not finished then pl.hole + 1 end,
    'finished', finished,
    'banks', jsonb_build_object('yards', banks -> 'yards', 'power', banks -> 'power'),
    'wind', w,
    'message', msg);
end;
$$;
revoke execute on function public.golf_strike(uuid, uuid, text, int, numeric, int, numeric, uuid, date) from public, anon, authenticated;

-- Ends the game if everyone's finished (or it's past its end), and pays
-- it when p_settle.
create or replace function public.golf_check_end(p_challenge_id uuid, p_settle boolean)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not exists (select 1 from public.golf_games g where g.challenge_id = p_challenge_id and g.status = 'active') then
    return false;
  end if;
  if now() >= c.ends_at
     or (exists (select 1 from public.golf_players p where p.challenge_id = p_challenge_id and p.joined)
         and not exists (select 1 from public.golf_players p where p.challenge_id = p_challenge_id and p.joined and p.finished_at is null)) then
    perform public.golf_finish(p_challenge_id);
    if p_settle then
      perform public.settle_challenge_score_core(p_challenge_id);
    end if;
    return true;
  end if;
  return false;
end;
$$;
revoke execute on function public.golf_check_end(uuid, boolean) from public, anon, authenticated;

-- A swing, by hand: the app's choices, checked, then played.
create or replace function public.golf_shot(
  p_challenge_id uuid, p_club text, p_yards int, p_aim numeric, p_power int, p_timing numeric
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.golf_games%rowtype;
  pl public.golf_players%rowtype;
  today date;
  banks jsonb;
  res jsonb;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.golf_games where challenge_id = p_challenge_id;
  select * into pl from public.golf_players p where p.challenge_id = p_challenge_id and p.user_id = caller and p.joined for update;
  if c.id is null or g.challenge_id is null or pl.user_id is null then
    raise exception 'not authorized';
  end if;
  if g.status <> 'active' or now() >= c.ends_at then
    raise exception 'This round is over.';
  end if;
  today := public.soccer_today(caller);
  if today < public.soccer_first_day(c) then
    raise exception 'The course opens %.', to_char(public.soccer_first_day(c), 'FMDay, FMMonth FMDD');
  end if;
  if not g.hands_on then
    raise exception 'This game plays itself: every walk of 10 minutes or more is a shot.';
  end if;
  if pl.finished_at is not null then
    raise exception 'You''ve played every hole.';
  end if;
  if public.golf_club_max(p_club) is null then
    raise exception 'Pick a club.';
  end if;
  if pl.lie = 'green' and p_club <> 'putter' then
    raise exception 'That''s the putter''s job.';
  end if;
  if pl.lie <> 'green' and p_club = 'putter' then
    raise exception 'The putter''s for the green.';
  end if;
  if p_yards is null or p_yards < 1 then
    raise exception 'Pull back for at least a yard.';
  end if;
  if p_yards > public.golf_club_max(p_club) then
    raise exception 'The % goes % yards at most.', lower(public.golf_club_name(p_club)), public.golf_club_max(p_club);
  end if;
  if p_aim is null or abs(p_aim) > 35 then
    raise exception 'Aim within 35 degrees of the pin.';
  end if;
  if p_power is null or p_power not in (0, 10, 20, 30) or p_power > (public.golf_cfg()).max_power then
    raise exception 'Power is 0, 10, 20 or 30, up to %.', (public.golf_cfg()).max_power;
  end if;
  if p_club = 'putter' and p_power > 0 then
    raise exception 'No power on a putt.';
  end if;
  if p_timing is null or abs(p_timing) > 0.5 then
    raise exception 'Timing is between -0.5 and 0.5.';
  end if;
  banks := public.golf_banks(p_challenge_id, caller);
  if p_yards > (banks ->> 'yards')::int then
    raise exception 'You have % yards banked.', to_char((banks ->> 'yards')::int, 'FM999,999,990');
  end if;
  if p_power > (banks ->> 'power')::int then
    raise exception 'You have % power banked.', (banks ->> 'power')::int;
  end if;
  if pl.strokes = 0 and g.holes_per_day > 0
     and public.golf_started_on(p_challenge_id, caller, today) >= g.holes_per_day then
    raise exception 'That''s % hole% today. More tomorrow.', g.holes_per_day, case when g.holes_per_day = 1 then '' else 's' end;
  end if;

  res := public.golf_strike(p_challenge_id, caller, p_club, p_yards, p_aim, p_power, p_timing, null, today);
  if (res ->> 'finished')::boolean then
    perform public.golf_check_end(p_challenge_id, true);
  end if;
  return res;
end;
$$;
revoke execute on function public.golf_shot(uuid, text, int, numeric, int, numeric) from public, anon;
grant execute on function public.golf_shot(uuid, text, int, numeric, int, numeric) to authenticated;

-- ── Hands-off: every walk is a shot ──

-- Plays a player's waiting walks, oldest first: every walk of 10 minutes
-- or more from a day that's over for them (or every walk, once the game's
-- ending), each a shot of its steps ÷ steps_per_yard yards with the
-- caddie's club, at the pin, timing seeded within ±0.2, no power. A walk
-- that would start one hole too many that day, or finds the bank empty,
-- is passed over.
create or replace function public.golf_play_walks(p_challenge_id uuid, p_user uuid, p_all boolean)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.golf_games%rowtype;
  pl public.golf_players%rowtype;
  h jsonb;
  wk record;
  today date := public.soccer_today(p_user);
  bank int;
  dist numeric;
  club text;
  yd int;
  n int := 0;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.golf_games where challenge_id = p_challenge_id;
  for wk in
    select w.id, w.day, w.steps, w.started_at from public.hound_walks w
    where w.user_id = p_user and w.day <@ public.golf_days(c)
      and (p_all or w.day < today)
      and w.ended_at - w.started_at >= interval '10 minutes'
      and w.started_at > coalesce((select p.walks_through from public.golf_players p where p.challenge_id = p_challenge_id and p.user_id = p_user), '-infinity')
    order by w.started_at
  loop
    select * into pl from public.golf_players p where p.challenge_id = p_challenge_id and p.user_id = p_user for update;
    exit when pl.finished_at is not null;
    update public.golf_players p set walks_through = wk.started_at where p.challenge_id = p_challenge_id and p.user_id = p_user;
    continue when pl.strokes = 0 and g.holes_per_day > 0
      and public.golf_started_on(p_challenge_id, p_user, wk.day) >= g.holes_per_day;
    bank := (public.golf_banks(p_challenge_id, p_user) ->> 'yards')::int;
    select x.hole into h from public.golf_holes x where x.course_id = g.course_id and x.no = public.golf_course_no(pl.hole);
    dist := sqrt(power((h -> 'pin' ->> 'd')::numeric - pl.ball_d, 2) + power((h -> 'pin' ->> 'lat')::numeric - pl.ball_lat, 2));
    club := case when pl.lie = 'green' then 'putter' else public.golf_auto_club(dist) end;
    yd := least(greatest(round(dist)::int, 1), public.golf_club_max(club), wk.steps / (public.golf_cfg()).steps_per_yard, bank);
    continue when yd < 1;
    if club <> 'putter' then
      club := public.golf_auto_club(yd);
    end if;
    perform public.golf_strike(p_challenge_id, p_user, club, yd, 0, 0,
      round(((public.rally_js_rand(public.rally_js_hash(wk.id::text || ':golf')) - 0.5) * 0.4)::numeric, 3), wk.id, wk.day);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.golf_play_walks(uuid, uuid, boolean) from public, anon, authenticated;

-- One game's night: hands-off walks, skins, and the end once it's due.
-- p_settle pays a game that ends here (settle_challenge_score_core calls
-- it with false and pays it itself).
create or replace function public.golf_advance(p_challenge_id uuid, p_settle boolean)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.golf_games%rowtype;
  r record;
  n int := 0;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.golf_games where challenge_id = p_challenge_id;
  if c.id is null or g.challenge_id is null or g.status <> 'active' then
    return 0;
  end if;
  if not g.hands_on then
    null;
  else
    for r in select p.user_id from public.golf_players p
      where p.challenge_id = p_challenge_id and p.joined and p.finished_at is null order by p.seated_at loop
      n := n + public.golf_play_walks(p_challenge_id, r.user_id, now() >= c.ends_at);
    end loop;
  end if;
  perform public.golf_settle_skins(p_challenge_id, false);
  perform public.golf_check_end(p_challenge_id, p_settle);
  return n;
end;
$$;
revoke execute on function public.golf_advance(uuid, boolean) from public, anon, authenticated;

create or replace function public.golf_advance_all()
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
    join public.golf_games g on g.challenge_id = c.id
    where c.kind::text = 'golf' and g.status = 'active' and c.starts_at < now()
    order by c.starts_at
  loop
    begin
      n := n + public.golf_advance(r.id, true);
    exception when others then
      raise warning 'golf_advance_all: % failed: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;
revoke execute on function public.golf_advance_all() from public, anon, authenticated;

-- 09:17 UTC: night across the Americas, morning in Europe.
select cron.schedule('hound-golf-advance', '17 9 * * *', $$ select public.golf_advance_all(); $$);

-- Early evening (US): one nudge a day to anyone with 300+ yards banked
-- and a hole they can play today.
create or replace function public.golf_reminders()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
  yards int;
  d date;
begin
  for r in
    select p.challenge_id, p.user_id, p.hole, p.strokes, p.reminded_on, g.holes_per_day, k.name as course_name
    from public.golf_players p
    join public.golf_games g on g.challenge_id = p.challenge_id and g.status = 'active' and g.hands_on
    join public.golf_courses k on k.id = g.course_id
    join public.challenges c on c.id = p.challenge_id
    where p.joined and p.finished_at is null and now() < c.ends_at
      and public.soccer_today(p.user_id) <@ public.golf_days(c)
  loop
    d := public.soccer_today(r.user_id);
    continue when r.reminded_on = d;
    continue when r.strokes = 0 and r.holes_per_day > 0
      and public.golf_started_on(r.challenge_id, r.user_id, d) >= r.holes_per_day;
    yards := (public.golf_banks(r.challenge_id, r.user_id) ->> 'yards')::int;
    continue when yards < 300;
    perform public.golf_notify('reminder', r.challenge_id, r.user_id,
      jsonb_build_object('yards', yards, 'hole', r.hole, 'course_name', r.course_name));
    update public.golf_players set reminded_on = d where challenge_id = r.challenge_id and user_id = r.user_id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.golf_reminders() from public, anon, authenticated;

select cron.schedule('hound-golf-reminders', '43 22 * * *', $$ select public.golf_reminders(); $$);

-- ── Reading a game ──

create or replace function public.golf_view(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.golf_games%rowtype;
  me public.golf_players%rowtype;
  today date;
  status text;
  started int := 0;
  banks jsonb;
  k public.golf_courses%rowtype;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.golf_games where challenge_id = p_challenge_id;
  if c.id is null or g.challenge_id is null then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller)
     and not exists (select 1 from public.golf_players p where p.challenge_id = p_challenge_id and p.user_id = caller) then
    raise exception 'not authorized';
  end if;
  select * into k from public.golf_courses where id = g.course_id;
  select * into me from public.golf_players p where p.challenge_id = p_challenge_id and p.user_id = caller;
  today := public.soccer_today(caller);
  status := case when g.status = 'final' or now() >= c.ends_at then 'final'
                 when today < public.soccer_first_day(c) then 'upcoming' else 'live' end;
  if me.user_id is not null then
    banks := public.golf_banks(p_challenge_id, caller) || jsonb_build_object('power_from', (
      select coalesce(jsonb_agg(jsonb_build_object('name', w.name, 'minutes', w.minutes, 'mult', w.mult, 'power', w.power)), '[]'::jsonb)
      from public.golf_workouts(p_challenge_id, caller) w));
    started := public.golf_started_on(p_challenge_id, caller, today);
  end if;

  return jsonb_build_object(
    'course', jsonb_build_object('id', k.id, 'name', k.name, 'style', k.style, 'note', k.note,
      'holes', (select jsonb_agg(h.hole order by h.no) from public.golf_holes h where h.course_id = k.id)),
    'holes', g.holes,
    'pars', (select jsonb_agg(public.golf_par(g.course_id, x) order by x) from generate_series(1, g.holes) x),
    'format', g.format,
    'hands_on', g.hands_on,
    'holes_per_day', g.holes_per_day,
    'status', status,
    'first_day', public.soccer_first_day(c),
    'last_day', upper(public.golf_days(c)) - 1,
    'me', me.user_id,
    'banks', banks,
    'today', case when me.user_id is null then null else jsonb_build_object(
      'holes_started', started,
      'can_start', status = 'live' and me.finished_at is null and g.hands_on
        and (g.holes_per_day = 0 or me.strokes > 0 or started < g.holes_per_day)) end,
    'wind', case when me.user_id is null or me.finished_at is not null then null
      else public.golf_wind(g.course_id, public.golf_course_no(me.hole), today) end,
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', p.user_id,
        'name', public.golf_name(p.user_id),
        'initials', pr.initials,
        'icon_id', pr.equipped_icon_id, 'frame_id', pr.equipped_frame_id, 'background_id', pr.equipped_background_id,
        'joined', p.joined,
        'hole', p.hole,
        'strokes_on_hole', p.strokes,
        'ball', jsonb_build_object('d', p.ball_d, 'lat', p.ball_lat),
        'lie', p.lie,
        'scores', to_jsonb(p.scores),
        'total', public.golf_total(p.scores),
        'to_par', public.golf_to_par(g.course_id, p.scores),
        'thru', (select count(*) from unnest(p.scores) s where s is not null),
        'skins', (select count(*) from jsonb_array_elements(g.skins) e where e ->> 'winner' = p.user_id::text),
        'skin_bones', public.golf_skin_bones(g.skins, p.user_id),
        'match', case when g.format = 'match' then public.golf_match_text(public.golf_match_up(p_challenge_id, p.user_id)) end,
        'done', p.finished_at is not null or g.status = 'final')
      order by p.seated_at, p.user_id), '[]'::jsonb)
      from public.golf_players p
      join public.profiles pr on pr.id = p.user_id
      where p.challenge_id = p_challenge_id),
    'skins', g.skins,
    'carry', g.carry,
    'winner', g.winner
  );
end;
$$;
revoke execute on function public.golf_view(uuid) from public, anon;
grant execute on function public.golf_view(uuid) to authenticated;

-- A player's shots on one hole, for watching it back.
create or replace function public.golf_shots(p_challenge_id uuid, p_user uuid, p_hole int)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'seq', s.seq, 'club', s.club, 'yards', s.yards, 'power', s.power,
      'from', jsonb_build_object('d', s.from_d, 'lat', s.from_lat),
      'to', jsonb_build_object('d', s.to_d, 'lat', s.to_lat),
      'ball', jsonb_build_object('d', s.ball_d, 'lat', s.ball_lat),
      'carry', s.carry, 'lie', s.lie, 'penalty', s.penalty, 'holed', s.holed, 'picked_up', s.picked_up,
      'score', s.score, 'walk', s.walk_id is not null)
    order by s.seq), '[]'::jsonb)
    from public.golf_shots s
    where s.challenge_id = p_challenge_id and s.user_id = p_user and s.hole = p_hole);
end;
$$;
revoke execute on function public.golf_shots(uuid, uuid, int) from public, anon;
grant execute on function public.golf_shots(uuid, uuid, int) to authenticated;

-- ── Paying the game ──

-- 0196's core with Golf: the winner scores like a Soccer winner and gets
-- Admin's win Bones, everyone who finished the play Bones, and everyone
-- their skins.
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
  hg public.hoops_games%rowtype;
  xg public.horse_games%rowtype;
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
        + case when p.finished_at is not null then coalesce(gcfg.play_bones, 10) else 0 end
        + case when p.user_id = gg.winner then coalesce(gcfg.win_bones, 40) else 0 end
        + public.golf_skin_bones(gg.skins, p.user_id)
    from public.golf_players p
    where p.challenge_id = p_challenge_id and p.joined;

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

-- 0196's wrapper, with Golf settling on its own state like the other
-- games (a round alone still ends, and pays its play Bones).
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
  if c.kind::text in ('rally', 'soccer', 'cricket', 'baseball', 'hoops', 'golf') then
    perform public.settle_challenge_score_core(p_challenge_id);
    return;
  end if;

  -- H-O-R-S-E needs its second player.
  if c.kind::text = 'horse' then
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

-- 0196's trophies, with Golf wins.
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
        when 'hoops_result' then 'hoops'
        when 'horse_result' then 'horse'
        when 'golf_result' then 'golf'
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
        or (e.kind in ('soccer_result', 'rally_result', 'cricket_result', 'baseball_result', 'hoops_result', 'horse_result', 'golf_result', 'tictacgo_result') and e.score_points = 35)
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


-- ── Admin → Overview → Golf ──

create or replace function public.admin_golf_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  since timestamptz := now() - interval '7 days';
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'config', to_jsonb(public.golf_cfg()),
    'games_live', (select count(*) from public.golf_games g where g.status = 'active'),
    'games_7d', (select count(*) from public.golf_games g where g.created_at > since),
    'games_all', (select count(*) from public.golf_games),
    'players_7d', (select count(distinct s.user_id) from public.golf_shots s where s.created_at > since),
    'players_all', (select count(distinct s.user_id) from public.golf_shots s),
    'shots_7d', (select count(*) from public.golf_shots s where s.created_at > since),
    'walk_shots_7d', (select count(*) from public.golf_shots s where s.walk_id is not null and s.created_at > since),
    'holes_7d', (select count(*) from public.golf_shots s where s.score is not null and s.created_at > since),
    'birdies_7d', (select count(*) from public.golf_shots s where s.holed and s.score = s.par - 1 and s.created_at > since),
    'eagles_7d', (select count(*) from public.golf_shots s where s.holed and s.score <= s.par - 2 and s.created_at > since),
    'hole_in_ones_all', (select count(*) from public.golf_shots s where s.holed and s.score = 1),
    'pick_ups_7d', (select count(*) from public.golf_shots s where s.picked_up and s.created_at > since),
    'avg_to_par_7d', (select round(avg(s.score - s.par), 2) from public.golf_shots s where s.score is not null and s.created_at > since),
    'hands_on_share', (select round(avg(case when g.hands_on then 1 else 0 end), 2) from public.golf_games g),
    'by_course', (select coalesce(jsonb_object_agg(k.id, (select count(*) from public.golf_games g where g.course_id = k.id)), '{}'::jsonb)
                  from public.golf_courses k),
    'by_format', jsonb_build_object(
      'stroke', (select count(*) from public.golf_games g where g.format = 'stroke'),
      'skins', (select count(*) from public.golf_games g where g.format = 'skins'),
      'match', (select count(*) from public.golf_games g where g.format = 'match')),
    'power_spent_7d', (select coalesce(sum(s.power), 0) from public.golf_shots s where s.created_at > since),
    'yards_spent_7d', (select coalesce(sum(s.yards), 0) from public.golf_shots s where s.created_at > since),
    'bones_7d', (select coalesce(sum(e.bones_points), 0) from public.activity_events e
                 where e.kind = 'golf_result' and e.created_at > since)
  );
end;
$$;
revoke execute on function public.admin_golf_overview() from public, anon;
grant execute on function public.admin_golf_overview() to authenticated;
