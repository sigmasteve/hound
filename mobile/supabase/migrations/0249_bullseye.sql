-- Hound: Bullseye (0248 adds the kind). Mockup:
-- claude.ai/artifact/CSdPjLtXogwLZ47SydD168. Archery for everyone, kids
-- included: Long Shot's dynamics (0247) with bows, arrows and round faces.
--
--   ends        3 arrows an end, an end every 1,500 steps on your own
--               date, up to 6 a day. Unused arrows carry to tomorrow, up
--               to 18. A 20-minute workout steadies the hold for the day.
--   the field   round faces at 18, 30, 50, 70 and 90 m (out to the
--               farthest the maker picked) worth 1 to 5 stars, and the
--               clout flag at 150 m (6 stars) on the longest field. An
--               arrow scores its ring (10 in the gold down to 1) times the
--               target's stars; clout scores 5 to 1 by how close to the
--               flag it lands. An arrow that lands in one of yours already
--               in the same face this end is a Robin Hood (+25). The gold
--               balloon (by the 70 m target) pays its Bones to the first
--               hound to pop it each day.
--   the day     the same for everyone in the game on a date: the air (the
--               day's temperature) and the breeze (its side, gusts and near
--               / mid / far), from the challenge and the date. Moon days
--               (Saturdays, if the maker says): 1/6 gravity, no air, faces
--               out to 500 m. Balloon days (Wednesdays): balloons drift
--               across the field on the breeze (bullseye_balloon), so you
--               lead them.
--   an arrow    hold to draw, let go to shoot: the server flies it
--               (bullseye_fly: gravity and the arrow's drag, launched at
--               your sight mark plus your hold), with the breeze as it
--               flies, your sway (bullseye_sway, the same formula the app
--               draws: big while drawing, quiet at full draw, growing as
--               your arms tire) and the arrow's own spread. Let go before
--               full draw and it's slow and low.
--   sight tape  a gold (9 or 10) writes the sight mark that worked for that
--               bow, arrows and target; until then it's a guess (the book).
--   bows        the youth bow, longbow (no sight: +1 star) and recurve from
--               the start; the compound at 80,000 steps in the game.
--               Arrows: light (flatter, blown more), standard, heavy.
--   helper      an aim helper for everyone, if the maker turns it on: it
--               shows where the breeze will take the arrow.
--
-- Nothing here takes money or Bones in. When it ends the pool is paid by
-- points like Long Shot's (2,500 Bones with 11 or more hounds, 200 a
-- hound below that; 30 / 18 / 12%, 4% to 10th, the rest shared by
-- everyone who shot on 3 days). On top of the usual 5.
--
-- Pushes through send-golf-notification's 'bullseye' kind: an evening
-- "arrows waiting".
--
-- Run this once, after 0248 (committed on its own), in the SQL Editor.
-- Then redeploy send-golf-notification.

-- ── Settings ──

create table public.bullseye_settings (
  id boolean primary key default true,
  constraint bullseye_settings_singleton check (id),
  steps_per_end int not null default 1500 check (steps_per_end between 100 and 10000),
  max_ends int not null default 6 check (max_ends between 1 and 50),
  arrows_per_end int not null default 3 check (arrows_per_end between 1 and 6),
  carry_max int not null default 18 check (carry_max between 0 and 200),
  workout_min int not null default 20 check (workout_min between 5 and 120),
  full_draw_ms int not null default 900 check (full_draw_ms between 100 and 5000),
  sway_mil numeric(4, 2) not null default 0.80 check (sway_mil between 0 and 5),
  steady numeric(3, 2) not null default 0.55 check (steady between 0.1 and 1),
  spread_mil numeric(4, 3) not null default 0.300 check (spread_mil between 0 and 3),
  wind_noise numeric(3, 2) not null default 0.15 check (wind_noise between 0 and 1),
  robin_hood int not null default 25 check (robin_hood between 0 and 500),
  bounty_bones int not null default 100 check (bounty_bones between 0 and 2000),
  big_pool int not null default 2500 check (big_pool between 0 and 20000),
  big_pool_players int not null default 11 check (big_pool_players between 2 and 1000),
  per_player_bones int not null default 200 check (per_player_bones between 0 and 2000),
  finish_days int not null default 3 check (finish_days between 1 and 30),
  finish_min_bones int not null default 5 check (finish_min_bones between 0 and 500),
  updated_at timestamptz not null default now()
);
insert into public.bullseye_settings (id) values (true);
alter table public.bullseye_settings enable row level security;
create policy "Anyone signed in can read the Bullseye settings"
  on public.bullseye_settings for select to authenticated using (true);
create policy "Only admins can change the Bullseye settings"
  on public.bullseye_settings for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
revoke all on public.bullseye_settings from anon;
revoke insert, delete on public.bullseye_settings from authenticated;

-- The bows: arrow speed (m/s), drag (per m, at sea level), sway, whether
-- it has a sight, stars added, steps in the game that unlock it.
create table public.bullseye_bows (
  id text primary key,
  name text not null,
  v0 numeric(5, 1) not null,
  k numeric(6, 4) not null,
  sway numeric(4, 2) not null,
  sight boolean not null default true,
  star_bonus int not null default 0,
  unlock_steps int not null default 0,
  sort int not null
);
insert into public.bullseye_bows (id, name, v0, k, sway, sight, star_bonus, unlock_steps, sort) values
  ('youth', 'Youth bow', 44, 0.0018, 0.80, true, 0, 0, 1),
  ('longbow', 'Longbow', 49, 0.0022, 1.10, false, 1, 0, 2),
  ('recurve', 'Recurve', 62, 0.0018, 1.00, true, 0, 0, 3),
  ('compound', 'Compound', 91, 0.0020, 1.25, true, 0, 80000, 4);
alter table public.bullseye_bows enable row level security;
create policy "Anyone signed in can read the Bullseye bows"
  on public.bullseye_bows for select to authenticated using (true);
revoke all on public.bullseye_bows from anon;
revoke insert, update, delete on public.bullseye_bows from authenticated;

-- ── Tables ──

create table public.bullseye_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  far int not null default 150 check (far in (30, 70, 150)),
  moon text not null default 'sat' check (moon in ('none', 'sat')),
  balloons text not null default 'wed' check (balloons in ('none', 'wed')),
  helper boolean not null default false,
  bounty boolean not null default true,
  pool int check (pool between 0 and 20000),
  created_at timestamptz not null default now()
);

create table public.bullseye_players (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  points int not null default 0 check (points >= 0),
  arrows int not null default 0,
  golds int not null default 0,
  robin_hoods int not null default 0,
  best_end int not null default 0,
  bow text not null default 'recurve' references public.bullseye_bows (id),
  arrow text not null default 'standard' check (arrow in ('light', 'standard', 'heavy')),
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index bullseye_players_rank on public.bullseye_players (challenge_id, points desc);

create table public.bullseye_days (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  carried_in int not null default 0 check (carried_in >= 0),
  used int not null default 0 check (used >= 0),
  primary key (challenge_id, user_id, day)
);

-- Your sight tape: the sight mark (mils above level) that put one in the
-- gold, by bow, arrows, world and target. It goes with you.
create table public.bullseye_tapes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  bow text not null references public.bullseye_bows (id),
  arrow text not null,
  world text not null check (world in ('earth', 'moon')),
  dist int not null,
  mark numeric(7, 2) not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, bow, arrow, world, dist)
);

-- The book: each bow and arrow's sight mark at 59°F, no wind.
create table public.bullseye_book (
  bow text not null references public.bullseye_bows (id),
  arrow text not null,
  world text not null,
  dist int not null,
  mark double precision not null,
  lag double precision not null,
  tof double precision not null,
  apex double precision not null,
  primary key (bow, arrow, world, dist)
);

create table public.bullseye_aims (
  id bigserial primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  target text not null,
  seed int not null,
  amp numeric(5, 3) not null,
  started_at timestamptz not null default now(),
  fired boolean not null default false
);
create index bullseye_aims_user on public.bullseye_aims (user_id, started_at desc);

create table public.bullseye_shots (
  id bigserial primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  end_no int not null,
  arrow_no int not null,
  world text not null,
  target text not null,
  dist int not null,
  bow text not null,
  arrow text not null,
  mark numeric(7, 2) not null,
  hold_x numeric(6, 2) not null,
  hold_y numeric(6, 2) not null,
  draw_ms int not null,
  sway_x numeric(6, 3) not null,
  sway_y numeric(6, 3) not null,
  wind_mph numeric(5, 2) not null,
  -- Where it went, in cm from the target's center (+ right, + up); clout:
  -- metres from the flag across and along.
  x_cm numeric(8, 1) not null,
  y_cm numeric(8, 1) not null,
  ring int not null default 0,
  x_ring boolean not null default false,
  points int not null default 0,
  robin boolean not null default false,
  popped boolean not null default false,
  bounty boolean not null default false,
  tof numeric(6, 3) not null,
  apex numeric(6, 2) not null,
  created_at timestamptz not null default now()
);
create index bullseye_shots_challenge on public.bullseye_shots (challenge_id, created_at desc);
create index bullseye_shots_user on public.bullseye_shots (user_id, created_at desc);

create table public.bullseye_bounties (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  bones int not null,
  created_at timestamptz not null default now(),
  primary key (challenge_id, day)
);

alter table public.bullseye_games enable row level security;
alter table public.bullseye_players enable row level security;
alter table public.bullseye_days enable row level security;
alter table public.bullseye_tapes enable row level security;
alter table public.bullseye_book enable row level security;
alter table public.bullseye_aims enable row level security;
alter table public.bullseye_shots enable row level security;
alter table public.bullseye_bounties enable row level security;
revoke all on public.bullseye_games, public.bullseye_players, public.bullseye_days, public.bullseye_tapes, public.bullseye_book,
  public.bullseye_aims, public.bullseye_shots, public.bullseye_bounties from anon;
revoke insert, update, delete on public.bullseye_games, public.bullseye_players, public.bullseye_days, public.bullseye_tapes,
  public.bullseye_book, public.bullseye_aims, public.bullseye_shots, public.bullseye_bounties from authenticated;

-- ── The physics ──

-- An arrow launched at p_mil mils above level at p_v0 m/s with drag p_k
-- (a = k v^2), to p_dist metres under gravity p_g: its height there (m),
-- time, the breeze's lag (time less the time without drag), the top of
-- the arc (m) and how steeply it comes down (mils below level). 0.25 m
-- steps; with no drag (the Moon) it's worked out exactly.
create or replace function public.bullseye_fly(p_v0 double precision, p_k double precision, p_mil double precision, p_dist double precision, p_g double precision)
returns table (y double precision, tof double precision, lag double precision, apex double precision, descent double precision)
language plpgsql
immutable
as $$
declare
  th double precision := p_mil / 1000.0;
  vx double precision := p_v0 * cos(th);
  vy double precision := p_v0 * sin(th);
  x double precision := 0;
  yy double precision := 0;
  t double precision := 0;
  top double precision := 0;
  v double precision;
  dt double precision;
  step double precision;
begin
  if p_k <= 0 then
    t := p_dist / vx;
    y := vy * t - p_g * t * t / 2;
    tof := t;
    lag := 0;
    apex := greatest(0, least(vy * vy / (2 * p_g), y + 0));
    if vy / p_g < t then
      apex := vy * vy / (2 * p_g);
    else
      apex := greatest(0, y);
    end if;
    descent := -atan2(vy - p_g * t, vx) * 1000;
    return next;
    return;
  end if;
  while x < p_dist - 1e-9 loop
    step := least(0.25, p_dist - x);
    v := sqrt(vx * vx + vy * vy);
    dt := step / vx;
    vx := vx - p_k * v * vx * dt;
    vy := vy - (p_k * v * vy + p_g) * dt;
    x := x + step;
    yy := yy + vy * dt;
    t := t + dt;
    top := greatest(top, yy);
    if vx <= 0.5 then
      exit;
    end if;
  end loop;
  y := yy;
  tof := t;
  lag := t - p_dist / (p_v0 * cos(th));
  apex := top;
  descent := -atan2(vy, vx) * 1000;
  return next;
end;
$$;
revoke execute on function public.bullseye_fly(double precision, double precision, double precision, double precision, double precision) from public, anon, authenticated;

-- The sight mark (mils above level) that lands it on the middle.
create or replace function public.bullseye_mark(p_v0 double precision, p_k double precision, p_dist double precision, p_g double precision)
returns double precision
language plpgsql
immutable
as $$
declare
  lo double precision := 0;
  hi double precision := 780;
  m double precision;
  i int;
begin
  if p_k <= 0 then
    return 500 * asin(least(1, p_g * p_dist / (p_v0 * p_v0)));
  end if;
  for i in 1..34 loop
    m := (lo + hi) / 2;
    if (select f.y from public.bullseye_fly(p_v0, p_k, m, p_dist, p_g) f) < 0 then
      lo := m;
    else
      hi := m;
    end if;
  end loop;
  return (lo + hi) / 2;
end;
$$;
revoke execute on function public.bullseye_mark(double precision, double precision, double precision, double precision) from public, anon, authenticated;

-- A bow with its arrows: speed and drag.
create or replace function public.bullseye_rig(p_bow text, p_arrow text)
returns table (v0 double precision, k double precision, sway double precision, stars int, sight boolean)
language sql
stable
security definer set search_path = public
as $$
  select (b.v0 * case p_arrow when 'light' then 1.06 when 'heavy' then 0.94 else 1 end)::double precision,
         (b.k * case p_arrow when 'light' then 1.15 when 'heavy' then 0.85 else 1 end)::double precision,
         b.sway::double precision, b.star_bonus, b.sight
  from public.bullseye_bows b where b.id = p_bow;
$$;
revoke execute on function public.bullseye_rig(text, text) from public, anon, authenticated;

create or replace function public.bullseye_book_get(p_bow text, p_arrow text, p_world text, p_dist int)
returns public.bullseye_book
language plpgsql
security definer set search_path = public
as $$
declare
  b public.bullseye_book%rowtype;
  r record;
  f record;
  g double precision := case when p_world = 'moon' then 1.62 else 9.80665 end;
  kk double precision;
  m double precision;
begin
  select * into b from public.bullseye_book where bow = p_bow and arrow = p_arrow and world = p_world and dist = p_dist;
  if found then
    return b;
  end if;
  select * into r from public.bullseye_rig(p_bow, p_arrow);
  kk := case when p_world = 'moon' then 0 else r.k end;
  m := public.bullseye_mark(r.v0, kk, p_dist, g);
  select * into f from public.bullseye_fly(r.v0, kk, m, p_dist, g);
  insert into public.bullseye_book (bow, arrow, world, dist, mark, lag, tof, apex)
  values (p_bow, p_arrow, p_world, p_dist, m, f.lag, f.tof, f.apex)
  on conflict do nothing;
  select * into b from public.bullseye_book where bow = p_bow and arrow = p_arrow and world = p_world and dist = p_dist;
  return b;
end;
$$;
revoke execute on function public.bullseye_book_get(text, text, text, int) from public, anon, authenticated;

-- The day's targets: id, distance, face (cm across; the clout's is its
-- 7.5 m ring), stars, and what kind ('face', 'clout', 'balloon', 'gold').
create or replace function public.bullseye_targets(p_far int, p_world text, p_balloons boolean, p_bounty boolean)
returns table (id text, dist int, face int, stars int, kind text)
language sql
immutable
as $$
  select x.id, x.d, x.f, x.s, x.k from (values
    ('earth', false, '18', 18, 40, 1, 'face'), ('earth', false, '30', 30, 80, 2, 'face'), ('earth', false, '50', 50, 80, 3, 'face'),
    ('earth', false, '70', 70, 122, 4, 'face'), ('earth', false, '90', 90, 122, 5, 'face'), ('earth', false, 'clout', 150, 1500, 6, 'clout'),
    ('earth', true, 'b30', 30, 30, 2, 'balloon'), ('earth', true, 'b50', 50, 30, 3, 'balloon'), ('earth', true, 'b70', 70, 30, 4, 'balloon'),
    ('moon', false, 'm50', 50, 122, 3, 'face'), ('moon', false, 'm100', 100, 122, 5, 'face'), ('moon', false, 'm200', 200, 122, 8, 'face'),
    ('moon', false, 'm300', 300, 122, 12, 'face'), ('moon', false, 'm500', 500, 122, 20, 'face')
  ) x (w, bd, id, d, f, s, k)
  where x.w = p_world and (p_world = 'moon' or x.bd = p_balloons) and (p_world = 'moon' or x.d <= p_far or (x.id = 'clout' and p_far >= 150))
    and not (x.id = 'clout' and p_far < 150)
  union all
  -- The gold balloon: by the 70 m target (30 m on the shortest field).
  select 'gold', case when p_far >= 70 then 70 else 30 end, 25, case when p_far >= 70 then 4 else 2 end, 'gold'
  where p_world = 'earth' and p_bounty
  order by 2, 1;
$$;
revoke execute on function public.bullseye_targets(int, text, boolean, boolean) from public, anon, authenticated;

-- A day, the same for everyone: Earth or the Moon, a Balloon day, the
-- temperature and the air, and the breeze (Long Shot's shape, lighter).
create or replace function public.bullseye_conditions(p_challenge_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  g public.bullseye_games%rowtype;
  h bigint;
  moon boolean;
  balloon boolean;
  temp int;
begin
  select * into g from public.bullseye_games where challenge_id = p_challenge_id;
  if not found then
    g.far := 150;
    g.moon := 'sat';
    g.balloons := 'wed';
    g.helper := false;
    g.bounty := true;
  end if;
  h := abs(hashtext('bullseye:' || p_challenge_id::text || ':' || p_day::text)::bigint);
  moon := g.moon = 'sat' and extract(isodow from p_day) = 6;
  balloon := not moon and g.balloons = 'wed' and extract(isodow from p_day) = 3;
  temp := 45 + (h % 41)::int;
  return jsonb_build_object(
    'world', case when moon then 'moon' else 'earth' end,
    'balloons', balloon,
    'far', g.far,
    'helper', g.helper,
    'bounty', g.bounty and not moon,
    'tempF', temp,
    'air', case when moon then 0 else round((519.0 / (460 + temp))::numeric, 4) end,
    'wind', case when moon then jsonb_build_object('mph', 0, 'from', 'none', 'gust', 0, 'period', 30, 'phase', 0, 'near', 1, 'mid', 1, 'far', 1)
            else jsonb_build_object(
              'mph', 2 + ((h / 41) % 801)::numeric / 100,
              'from', case when (h / 32841) % 2 = 0 then 'left' else 'right' end,
              'gust', 0.15 + ((h / 65682) % 21)::numeric / 100,
              'period', 14 + ((h / 1379322) % 15)::int,
              'phase', round((((h / 20689830) % 628)::numeric / 100), 2),
              'near', 0.85 + ((h / 7) % 31)::numeric / 100,
              'mid', 0.85 + ((h / 217) % 31)::numeric / 100,
              'far', 0.85 + ((h / 6727) % 31)::numeric / 100) end,
    -- Balloon days: each balloon's drift (cm either side, period s, phase).
    'drift', case when balloon then jsonb_build_object(
              'amp', 90 + (h % 61), 'period', 9 + ((h / 13) % 6)::int, 'phase', round((((h / 97) % 628)::numeric / 100), 2)) end
  );
end;
$$;
revoke execute on function public.bullseye_conditions(uuid, date) from public, anon, authenticated;

-- Where a balloon is (cm from its spot, + right / + up) at a moment: it
-- sways across on the breeze and bobs, each its own way. The app draws
-- the same.
create or replace function public.bullseye_balloon(p_cond jsonb, p_target text, p_at timestamptz)
returns table (x double precision, y double precision)
language plpgsql
immutable
as $$
declare
  d jsonb := p_cond -> 'drift';
  i int := case p_target when 'b30' then 0 when 'b50' then 1 when 'b70' then 2 else 3 end;
  s double precision := extract(epoch from p_at);
  per double precision;
begin
  if d is null or jsonb_typeof(d) = 'null' or p_target not in ('b30', 'b50', 'b70', 'gold') then
    x := 0;
    y := 0;
    return next;
    return;
  end if;
  per := (d ->> 'period')::double precision + i * 1.7;
  x := (d ->> 'amp')::double precision * (1 - i * 0.12) * sin(2 * pi() * s / per + (d ->> 'phase')::double precision + i * 1.9);
  y := 12 * sin(2 * pi() * s / (per * 0.43) + i);
  return next;
end;
$$;
revoke execute on function public.bullseye_balloon(jsonb, text, timestamptz) from public, anon, authenticated;

-- The pin's sway (mils) p_t ms into a draw: big while drawing, quietest
-- at full draw (1.2 to 3.5 s), then growing as the arms tire. The app
-- draws the same.
create or replace function public.bullseye_sway(p_seed int, p_amp double precision, p_t int)
returns table (x double precision, y double precision)
language plpgsql
immutable
as $$
declare
  s bigint := abs(p_seed::bigint);
  ph double precision[] := array[0, 0, 0, 0];
  i int;
  f double precision;
  a double precision;
begin
  for i in 1..4 loop
    ph[i] := ((s / (32 ^ (i - 1))::bigint) % 32) / 32.0 * 2 * pi();
  end loop;
  f := case when p_t < 1200 then 1.0 when p_t < 3500 then 0.4 else least(3.0, 0.4 + (p_t - 3500) / 1500.0) end;
  a := p_amp * f;
  x := a * (0.62 * sin(2 * pi() * p_t / 1300.0 + ph[1]) + 0.38 * sin(2 * pi() * p_t / 530.0 + ph[2]));
  y := a * (0.62 * sin(2 * pi() * p_t / 1600.0 + ph[3]) + 0.38 * sin(2 * pi() * p_t / 610.0 + ph[4]));
  return next;
end;
$$;
revoke execute on function public.bullseye_sway(int, double precision, int) from public, anon, authenticated;

-- The ring at r cm from the middle of a face d cm across: 10 to 1, 0 off it.
create or replace function public.bullseye_ring(p_r double precision, p_face int)
returns int
language sql
immutable
as $$
  select case when p_r >= p_face / 2.0 then 0 else 10 - floor(p_r / (p_face / 20.0))::int end;
$$;
revoke execute on function public.bullseye_ring(double precision, int) from public, anon, authenticated;

-- ── Arrows ──

create or replace function public.bullseye_notify(p_challenge_id uuid, p_recipient uuid, p_title text, p_message text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.golf_notify('bullseye', p_challenge_id, p_recipient, jsonb_build_object('title', p_title, 'message', p_message));
end;
$$;
revoke execute on function public.bullseye_notify(uuid, uuid, text, text) from public, anon, authenticated;

-- Arrows a day's steps give (3 an end).
create or replace function public.bullseye_granted(p_user uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select least(s.max_ends, public.chess_steps(p_user, p_day) / s.steps_per_end) * s.arrows_per_end from public.bullseye_settings s;
$$;
revoke execute on function public.bullseye_granted(uuid, date) from public, anon, authenticated;

create or replace function public.bullseye_left(p_challenge_id uuid, p_user uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select greatest(0, coalesce(d.carried_in - d.used, 0) + public.bullseye_granted(p_user, p_day))
  from (select 1) one
  left join public.bullseye_days d on d.challenge_id = p_challenge_id and d.user_id = p_user and d.day = p_day;
$$;
revoke execute on function public.bullseye_left(uuid, uuid, date) from public, anon, authenticated;

create or replace function public.bullseye_day_row(p_challenge_id uuid, p_user uuid, p_day date)
returns public.bullseye_days
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  d public.bullseye_days%rowtype;
  carry int := 0;
begin
  select * into d from public.bullseye_days where challenge_id = p_challenge_id and user_id = p_user and day = p_day;
  if found then
    return d;
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if p_day - 1 >= public.soccer_first_day(c) then
    carry := least((select s.carry_max from public.bullseye_settings s), public.bullseye_left(p_challenge_id, p_user, p_day - 1));
  end if;
  insert into public.bullseye_days (challenge_id, user_id, day, carried_in) values (p_challenge_id, p_user, p_day, carry)
  on conflict do nothing;
  select * into d from public.bullseye_days where challenge_id = p_challenge_id and user_id = p_user and day = p_day;
  return d;
end;
$$;
revoke execute on function public.bullseye_day_row(uuid, uuid, date) from public, anon, authenticated;

create or replace function public.bullseye_pool(p_challenge_id uuid)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select g.pool from public.bullseye_games g where g.challenge_id = p_challenge_id),
    (select case when n >= s.big_pool_players then s.big_pool else least(s.big_pool, n * s.per_player_bones) end
     from public.bullseye_settings s,
          (select count(*)::int as n from public.challenge_participants cp where cp.challenge_id = p_challenge_id) x));
$$;
revoke execute on function public.bullseye_pool(uuid) from public, anon, authenticated;

-- ── Joining and setting up ──

create or replace function public.bullseye_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (select kind::text from public.challenges where id = new.challenge_id) is distinct from 'bullseye' then
    return new;
  end if;
  insert into public.bullseye_players (challenge_id, user_id) values (new.challenge_id, new.user_id) on conflict do nothing;
  return new;
end;
$$;
revoke execute on function public.bullseye_after_join() from public, anon, authenticated;
create trigger bullseye_after_join
  after insert on public.challenge_participants
  for each row execute procedure public.bullseye_after_join();

create or replace function public.bullseye_setup(p_challenge_id uuid, p_far int, p_moon text, p_balloons text, p_helper boolean, p_bounty boolean, p_pool int default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges%rowtype;
  admin boolean;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'bullseye' then
    raise exception 'That isn''t a Bullseye challenge.';
  end if;
  admin := exists (select 1 from public.profiles p where p.id = me and p.is_admin);
  if me is null or (c.created_by is distinct from me and not (c.is_global and admin)) then
    raise exception 'Only whoever made it can set it up.';
  end if;
  if p_far is null or p_far not in (30, 70, 150) then
    raise exception 'The farthest target is 30 m, 70 m or 90 m and the clout.';
  end if;
  if p_moon is null or p_moon not in ('none', 'sat') or p_balloons is null or p_balloons not in ('none', 'wed') then
    raise exception 'Moon days are Saturdays or none; Balloon days are Wednesdays or none.';
  end if;
  if p_pool is not null and not (c.is_global and admin) then
    raise exception 'Only an admin can set a Global''s prize pool.';
  end if;
  if p_pool is not null and (p_pool < 0 or p_pool > 20000) then
    raise exception 'The pool is 0 to 20,000 Bones.';
  end if;
  if exists (select 1 from public.bullseye_shots s where s.challenge_id = p_challenge_id) then
    raise exception 'It''s started: the field is set.';
  end if;
  insert into public.bullseye_games (challenge_id, far, moon, balloons, helper, bounty, pool)
  values (p_challenge_id, p_far, p_moon, p_balloons, coalesce(p_helper, false), coalesce(p_bounty, true), p_pool)
  on conflict (challenge_id) do update set far = excluded.far, moon = excluded.moon, balloons = excluded.balloons,
    helper = excluded.helper, bounty = excluded.bounty, pool = coalesce(excluded.pool, public.bullseye_games.pool);
  insert into public.bullseye_players (challenge_id, user_id)
    select cp.challenge_id, cp.user_id from public.challenge_participants cp where cp.challenge_id = p_challenge_id
    on conflict do nothing;
end;
$$;
revoke execute on function public.bullseye_setup(uuid, int, text, text, boolean, boolean, int) from public, anon;
grant execute on function public.bullseye_setup(uuid, int, text, text, boolean, boolean, int) to authenticated;

-- ── What the app does ──

create or replace function public.bullseye_live(p_challenge_id uuid, p_user uuid)
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
  if not found or c.kind::text <> 'bullseye' then
    raise exception 'That isn''t a Bullseye challenge.';
  end if;
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = p_user) then
    raise exception 'Join the challenge to shoot.';
  end if;
  n := public.soccer_today(p_user) - public.soccer_first_day(c) + 1;
  if c.score_settled_at is not null or n > c.duration_days then
    raise exception 'This one''s over.';
  end if;
  if n < 1 then
    raise exception 'It hasn''t started yet.';
  end if;
  insert into public.bullseye_players (challenge_id, user_id) values (p_challenge_id, p_user) on conflict do nothing;
  return c;
end;
$$;
revoke execute on function public.bullseye_live(uuid, uuid) from public, anon, authenticated;

create or replace function public.bullseye_game_steps(p_challenge_id uuid, p_user uuid)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce(sum(public.chess_steps(p_user, d::date)), 0)::int
  from public.challenges c,
       generate_series(public.soccer_first_day(c), least(public.soccer_today(p_user), public.soccer_first_day(c) + c.duration_days - 1), interval '1 day') d
  where c.id = p_challenge_id;
$$;
revoke execute on function public.bullseye_game_steps(uuid, uuid) from public, anon, authenticated;

-- The sight mark: your tape's, else the book's.
create or replace function public.bullseye_sight(p_user uuid, p_bow text, p_arrow text, p_world text, p_dist int)
returns double precision
language plpgsql
security definer set search_path = public
as $$
declare
  m numeric;
begin
  select t.mark into m from public.bullseye_tapes t
  where t.user_id = p_user and t.bow = p_bow and t.arrow = p_arrow and t.world = p_world and t.dist = p_dist;
  if found then
    return m;
  end if;
  return round((public.bullseye_book_get(p_bow, p_arrow, p_world, p_dist)).mark::numeric, 1);
end;
$$;
revoke execute on function public.bullseye_sight(uuid, text, text, text, int) from public, anon, authenticated;

create or replace function public.bullseye_loadout(p_challenge_id uuid, p_bow text, p_arrow text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  b public.bullseye_bows%rowtype;
begin
  perform public.bullseye_live(p_challenge_id, me);
  select * into b from public.bullseye_bows where id = p_bow;
  if not found then
    raise exception 'That bow isn''t on the rack.';
  end if;
  if p_arrow is null or p_arrow not in ('light', 'standard', 'heavy') then
    raise exception 'Light, standard or heavy arrows.';
  end if;
  if b.unlock_steps > public.bullseye_game_steps(p_challenge_id, me) then
    raise exception 'The % unlocks at % steps in this game.', b.name, to_char(b.unlock_steps, 'FM999,999');
  end if;
  update public.bullseye_players set bow = p_bow, arrow = p_arrow, updated_at = now()
  where challenge_id = p_challenge_id and user_id = me;
end;
$$;
revoke execute on function public.bullseye_loadout(uuid, text, text) from public, anon;
grant execute on function public.bullseye_loadout(uuid, text, text) to authenticated;

-- Up to the line on a target: a seed for the sway, the sight mark, and
-- (with the helper on) where the breeze would take it right now.
create or replace function public.bullseye_aim(p_challenge_id uuid, p_target text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  s public.bullseye_settings%rowtype;
  p public.bullseye_players%rowtype;
  today date;
  cond jsonb;
  v_world text;
  rg record;
  tg record;
  amp double precision;
  seed int := floor(random() * 2000000000)::int;
  aid bigint;
  bk public.bullseye_book%rowtype;
  drift_cm double precision := 0;
begin
  perform public.bullseye_live(p_challenge_id, me);
  select * into s from public.bullseye_settings;
  select * into p from public.bullseye_players where challenge_id = p_challenge_id and user_id = me;
  today := public.soccer_today(me);
  perform public.bullseye_day_row(p_challenge_id, me, today);
  if public.bullseye_left(p_challenge_id, me, today) < 1 then
    raise exception 'No arrows left: walk 1,500 steps for the next end.';
  end if;
  cond := public.bullseye_conditions(p_challenge_id, today);
  v_world := cond ->> 'world';
  select * into tg from public.bullseye_targets((cond ->> 'far')::int, v_world, (cond ->> 'balloons')::boolean, (cond ->> 'bounty')::boolean) x
  where x.id = p_target;
  if not found then
    raise exception 'That target isn''t on the field today.';
  end if;
  select * into rg from public.bullseye_rig(p.bow, p.arrow);
  amp := s.sway_mil * rg.sway * case when public.chess_workout_min(me, today) >= s.workout_min then s.steady else 1 end;
  insert into public.bullseye_aims (challenge_id, user_id, day, target, seed, amp) values (p_challenge_id, me, today, p_target, seed, amp)
  returning id into aid;
  bk := public.bullseye_book_get(p.bow, p.arrow, v_world, tg.dist);
  if (cond ->> 'helper')::boolean then
    drift_cm := public.longshot_wind_at(cond, now()) * 0.44704 * bk.lag * 100;
  end if;
  return jsonb_build_object('aimId', aid, 'seed', seed, 'amp', round(amp::numeric, 3), 'target', p_target, 'dist', tg.dist,
    'face', tg.face, 'stars', tg.stars + rg.stars, 'kind', tg.kind, 'sight', rg.sight,
    'mark', round(public.bullseye_sight(me, p.bow, p.arrow, v_world, tg.dist)::numeric, 2),
    'learned', exists (select 1 from public.bullseye_tapes t where t.user_id = me and t.bow = p.bow and t.arrow = p.arrow and t.world = v_world and t.dist = tg.dist),
    'tof', round(bk.tof::numeric, 2), 'apex', round(bk.apex::numeric, 2),
    'helper', case when (cond ->> 'helper')::boolean then jsonb_build_object('xCm', round(drift_cm::numeric, 1)) end,
    'fullDrawMs', s.full_draw_ms,
    'conditions', cond);
end;
$$;
revoke execute on function public.bullseye_aim(uuid, text) from public, anon;
grant execute on function public.bullseye_aim(uuid, text) to authenticated;

-- Let go: the hold (mils; + right, + up) and how long you drew (ms).
create or replace function public.bullseye_shoot(p_challenge_id uuid, p_aim_id bigint, p_hold_x double precision, p_hold_y double precision, p_draw_ms int default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  s public.bullseye_settings%rowtype;
  p public.bullseye_players%rowtype;
  a public.bullseye_aims%rowtype;
  today date;
  cond jsonb;
  v_world text;
  tg record;
  rg record;
  f record;
  elapsed int;
  t int;
  sw record;
  mark double precision;
  g double precision;
  kk double precision;
  v0 double precision;
  wind double precision;
  spread double precision;
  ix double precision;
  iy double precision;
  bx double precision := 0;
  by_ double precision := 0;
  bal record;
  r double precision;
  v_ring int := 0;
  xr boolean := false;
  popped boolean := false;
  robin boolean := false;
  pts int := 0;
  gold boolean := false;
  gold_paid int := 0;
  used_before int;
  end_no int;
  arrow_no int;
  land_along double precision;
  msg text;
  end_total int;
  hx double precision := least(80, greatest(-80, coalesce(p_hold_x, 0)));
  hy double precision := least(80, greatest(-80, coalesce(p_hold_y, 0)));
begin
  perform public.bullseye_live(p_challenge_id, me);
  select * into s from public.bullseye_settings;
  select * into a from public.bullseye_aims where id = p_aim_id and user_id = me and challenge_id = p_challenge_id for update;
  if not found then
    raise exception 'Step back up to the line and try again.';
  end if;
  if a.fired then
    raise exception 'That arrow''s already gone.';
  end if;
  today := public.soccer_today(me);
  if a.day <> today then
    raise exception 'A new day: step back up to the line.';
  end if;
  elapsed := floor(extract(epoch from (clock_timestamp() - a.started_at)) * 1000)::int;
  if elapsed > 120000 then
    raise exception 'You waited too long. Step back up to the line.';
  end if;
  perform public.bullseye_day_row(p_challenge_id, me, today);
  if public.bullseye_left(p_challenge_id, me, today) < 1 then
    raise exception 'No arrows left: walk 1,500 steps for the next end.';
  end if;
  update public.bullseye_aims set fired = true where id = a.id;
  t := least(elapsed, greatest(0, coalesce(p_draw_ms, elapsed)));

  select * into p from public.bullseye_players where challenge_id = p_challenge_id and user_id = me for update;
  cond := public.bullseye_conditions(p_challenge_id, today);
  v_world := cond ->> 'world';
  select * into tg from public.bullseye_targets((cond ->> 'far')::int, v_world, (cond ->> 'balloons')::boolean, (cond ->> 'bounty')::boolean) x
  where x.id = a.target;
  select * into rg from public.bullseye_rig(p.bow, p.arrow);
  g := case when v_world = 'moon' then 1.62 else 9.80665 end;
  kk := case when v_world = 'moon' then 0 else rg.k * (cond ->> 'air')::double precision end;
  -- Let go before full draw and it's slow.
  v0 := rg.v0 * case when t < s.full_draw_ms then 0.55 + 0.45 * t / s.full_draw_ms else 1 end;
  select * into sw from public.bullseye_sway(a.seed, a.amp::double precision, t);
  mark := public.bullseye_sight(me, p.bow, p.arrow, v_world, tg.dist);
  select * into f from public.bullseye_fly(v0, kk, mark + hy + sw.y, tg.dist, g);
  wind := public.longshot_wind_at(cond, now()) * (1 + s.wind_noise * (random() * 2 - 1));
  spread := s.spread_mil;
  -- Where it reaches the target (cm from the middle).
  ix := (hx + sw.x + spread * (random() + random() + random() - 1.5) * 1.15) * tg.dist / 10.0 + wind * 0.44704 * f.lag * 100;
  iy := f.y * 100 + spread * (random() + random() + random() - 1.5) * 1.15 * tg.dist / 10.0;

  if tg.kind in ('balloon', 'gold') then
    -- Where the balloon is when it gets there.
    select * into bal from public.bullseye_balloon(cond, a.target, now() + make_interval(secs => f.tof));
    bx := bal.x;
    by_ := bal.y;
    r := sqrt((ix - bx) ^ 2 + (iy - by_) ^ 2);
    popped := r <= tg.face / 2.0;
    if popped then
      pts := tg.stars * 5 + rg.stars * 5;
    end if;
  elsif tg.kind = 'clout' then
    -- Clout: where it lands on the ground (m from the flag).
    land_along := (iy / 100) / greatest(0.05, tan(f.descent / 1000));
    r := sqrt((ix / 100) ^ 2 + land_along ^ 2);
    v_ring := case when r <= 1.5 then 5 when r <= 3 then 4 when r <= 4.5 then 3 when r <= 6 then 2 when r <= 7.5 then 1 else 0 end;
    pts := v_ring * (tg.stars + rg.stars);
    ix := ix / 100;
    iy := land_along;
  else
    r := sqrt(ix * ix + iy * iy);
    v_ring := public.bullseye_ring(r, tg.face);
    xr := r < tg.face / 40.0;
    pts := v_ring * (tg.stars + rg.stars);
  end if;

  select coalesce(d.used, 0) into used_before from public.bullseye_days d where d.challenge_id = p_challenge_id and d.user_id = me and d.day = today;
  end_no := used_before / s.arrows_per_end + 1;
  arrow_no := used_before % s.arrows_per_end + 1;

  -- A Robin Hood: into one of yours already in this face this end.
  if tg.kind = 'face' and v_ring > 0 and exists (
    select 1 from public.bullseye_shots x where x.challenge_id = p_challenge_id and x.user_id = me and x.day = today and x.end_no = end_no
      and x.target = a.target and x.ring > 0 and sqrt((x.x_cm - ix) ^ 2 + (x.y_cm - iy) ^ 2) <= 1.0) then
    robin := true;
    pts := pts + s.robin_hood;
  end if;

  if popped and tg.kind = 'gold' and (cond ->> 'bounty')::boolean and s.bounty_bones > 0 then
    insert into public.bullseye_bounties (challenge_id, day, user_id, bones) values (p_challenge_id, today, me, s.bounty_bones)
    on conflict do nothing;
    if found then
      gold := true;
      gold_paid := s.bounty_bones;
      update public.profiles x set bones_balance = x.bones_balance + gold_paid, bones_earned_total = x.bones_earned_total + gold_paid
        where x.id = me;
    end if;
  end if;

  -- The tape learns from a gold (a 9 or 10).
  if tg.kind = 'face' and v_ring >= 9 then
    insert into public.bullseye_tapes (user_id, bow, arrow, world, dist, mark)
    values (me, p.bow, p.arrow, v_world, tg.dist, round((mark + hy)::numeric, 2))
    on conflict on constraint bullseye_tapes_pkey do update set mark = excluded.mark, updated_at = now();
  end if;

  update public.bullseye_days set used = used + 1 where challenge_id = p_challenge_id and user_id = me and day = today;
  insert into public.bullseye_shots (challenge_id, user_id, day, end_no, arrow_no, world, target, dist, bow, arrow, mark, hold_x, hold_y, draw_ms,
    sway_x, sway_y, wind_mph, x_cm, y_cm, ring, x_ring, points, robin, popped, bounty, tof, apex)
  values (p_challenge_id, me, today, end_no, arrow_no, v_world, a.target, tg.dist, p.bow, p.arrow, mark, hx, hy, t,
    sw.x, sw.y, abs(wind), ix, iy, v_ring, xr, pts, robin, popped, gold, f.tof, f.apex);
  select coalesce(sum(x.points), 0) into end_total from public.bullseye_shots x
  where x.challenge_id = p_challenge_id and x.user_id = me and x.day = today and x.end_no = end_no;
  update public.bullseye_players set points = points + pts, arrows = arrows + 1, golds = golds + case when v_ring >= 9 then 1 else 0 end,
    robin_hoods = robin_hoods + case when robin then 1 else 0 end,
    best_end = case when arrow_no = s.arrows_per_end then greatest(best_end, end_total) else best_end end, updated_at = now()
  where challenge_id = p_challenge_id and user_id = me;

  msg := case
    when gold then 'The gold balloon! ' || gold_paid || ' Bones.'
    when robin then 'Robin Hood! Right into your own arrow: +' || s.robin_hood || '.'
    when popped then 'Pop! +' || pts || '.'
    when tg.kind in ('balloon', 'gold') then 'Missed the balloon by ' || round(r - tg.face / 2.0) || ' cm.'
    when tg.kind = 'clout' and v_ring > 0 then v_ring || ' at the clout, ' || round(r::numeric, 1) || ' m from the flag.'
    when tg.kind = 'clout' then 'Landed ' || round(r::numeric, 1) || ' m from the flag.'
    when xr then 'Dead center! An X: +' || pts || '.'
    when v_ring >= 9 then 'Gold! A ' || v_ring || ': +' || pts || '.'
    when v_ring > 0 then 'A ' || v_ring || ': +' || pts || '.'
    else 'Off the face: ' || round(abs(iy)) || ' cm ' || case when iy > 0 then 'high' else 'low' end || ', ' || round(abs(ix)) || ' cm ' || case when ix > 0 then 'right' else 'left' end || '.'
  end;
  return jsonb_build_object(
    'target', a.target, 'kind', tg.kind, 'dist', tg.dist, 'face', tg.face, 'stars', tg.stars + rg.stars,
    'ring', v_ring, 'x', xr, 'popped', popped, 'robin', robin, 'gold', gold, 'goldBones', gold_paid, 'points', pts, 'message', msg,
    'xCm', round(ix::numeric, 1), 'yCm', round(iy::numeric, 1), 'balloon', jsonb_build_object('xCm', round(bx::numeric, 1), 'yCm', round(by_::numeric, 1)),
    'mark', round(mark::numeric, 2), 'hold', jsonb_build_object('x', round(hx::numeric, 2), 'y', round(hy::numeric, 2)),
    'sway', jsonb_build_object('x', round(sw.x::numeric, 2), 'y', round(sw.y::numeric, 2)), 'drawMs', t,
    'windMph', round(abs(wind)::numeric, 1), 'tof', round(f.tof::numeric, 2), 'apex', round(f.apex::numeric, 2),
    'fps', round(v0 / 0.3048), 'endNo', end_no, 'arrowNo', arrow_no, 'endTotal', end_total,
    'left', public.bullseye_left(p_challenge_id, me, today),
    'total', (select x.points from public.bullseye_players x where x.challenge_id = p_challenge_id and x.user_id = me)
  );
end;
$$;
revoke execute on function public.bullseye_shoot(uuid, bigint, double precision, double precision, int) from public, anon;
grant execute on function public.bullseye_shoot(uuid, bigint, double precision, double precision, int) to authenticated;

create or replace function public.bullseye_place_weight(p_rank bigint)
returns int
language sql
immutable
as $$
  select case when p_rank between 1 and 10 then (array[30, 18, 12, 4, 4, 4, 4, 4, 4, 4])[p_rank] else 0 end;
$$;
revoke execute on function public.bullseye_place_weight(bigint) from public, anon, authenticated;

-- ── What the app shows ──

create or replace function public.bullseye_state(p_challenge_id uuid, p_steps int default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  c public.challenges%rowtype;
  s public.bullseye_settings%rowtype;
  p public.bullseye_players%rowtype;
  today date;
  day_no int;
  d public.bullseye_days%rowtype;
  joined boolean;
  steps int;
  wmin int;
  from_steps int;
  n int;
  pool int;
  my_rank int;
  places_w int;
  w_total int;
  rest_n int;
  cond jsonb;
  v_world text;
  game_steps int;
  board jsonb;
  targets jsonb;
  bows jsonb;
  tape jsonb;
  ends jsonb;
  rig record;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'bullseye' then
    raise exception 'That isn''t a Bullseye challenge.';
  end if;
  joined := exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me);
  if not joined and not c.is_global then
    raise exception 'Join the challenge to see it.';
  end if;
  select * into s from public.bullseye_settings;
  today := public.soccer_today(me);
  if p_steps is not null and p_steps between 0 and 150000 then
    insert into public.chess_claims (user_id, day, steps) values (me, today, p_steps)
    on conflict (user_id, day) do update set steps = greatest(public.chess_claims.steps, excluded.steps);
  end if;
  day_no := today - public.soccer_first_day(c) + 1;
  if joined then
    insert into public.bullseye_players (challenge_id, user_id) values (p_challenge_id, me) on conflict do nothing;
  end if;
  if day_no between 1 and c.duration_days and c.score_settled_at is null and joined then
    d := public.bullseye_day_row(p_challenge_id, me, today);
  end if;
  select * into p from public.bullseye_players where challenge_id = p_challenge_id and user_id = me;
  steps := public.chess_steps(me, today);
  wmin := public.chess_workout_min(me, today);
  from_steps := least(s.max_ends, steps / s.steps_per_end);
  select count(*)::int into n from public.challenge_participants cp where cp.challenge_id = p_challenge_id;
  pool := public.bullseye_pool(p_challenge_id);
  select 1 + count(*) into my_rank from public.bullseye_players x where x.challenge_id = p_challenge_id and x.points > coalesce(p.points, 0);
  places_w := (select coalesce(sum(public.bullseye_place_weight(i)), 0) from generate_series(1, least(n, 10)) i);
  rest_n := greatest(0, n - 10);
  w_total := places_w + case when rest_n > 0 then 12 else 0 end;
  cond := public.bullseye_conditions(p_challenge_id, today);
  v_world := cond ->> 'world';
  game_steps := case when joined then public.bullseye_game_steps(p_challenge_id, me) else 0 end;
  select * into rig from public.bullseye_rig(coalesce(p.bow, 'recurve'), coalesce(p.arrow, 'standard'));

  with ranked as (
    select x.user_id, x.points, x.golds, x.arrows, x.best_end, x.robin_hoods, rank() over (order by x.points desc) as rnk,
           row_number() over (order by x.points desc, x.best_end desc, x.updated_at, x.user_id) as rn
    from public.bullseye_players x where x.challenge_id = p_challenge_id
  ),
  mine as (select rn from ranked where user_id = me)
  select coalesce(jsonb_agg(jsonb_build_object('rank', r.rnk, 'tied', (select count(*) from ranked y where y.rnk = r.rnk) > 1,
           'userId', r.user_id, 'name', public.horse_name(r.user_id), 'points', r.points, 'golds', r.golds, 'arrows', r.arrows,
           'bestEnd', r.best_end, 'robinHoods', r.robin_hoods, 'me', r.user_id = me) order by r.rn), '[]'::jsonb)
    into board
  from ranked r
  where r.rn <= 10 or abs(r.rn - coalesce((select rn from mine), -100)) <= 1;

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'dist', x.dist, 'face', x.face, 'stars', x.stars + rig.stars, 'kind', x.kind,
           'mark', round(public.bullseye_sight(me, coalesce(p.bow, 'recurve'), coalesce(p.arrow, 'standard'), v_world, x.dist)::numeric, 1),
           'learned', exists (select 1 from public.bullseye_tapes t where t.user_id = me and t.bow = coalesce(p.bow, 'recurve')
                                and t.arrow = coalesce(p.arrow, 'standard') and t.world = v_world and t.dist = x.dist),
           'tof', round((public.bullseye_book_get(coalesce(p.bow, 'recurve'), coalesce(p.arrow, 'standard'), v_world, x.dist)).tof::numeric, 2),
           'apex', round((public.bullseye_book_get(coalesce(p.bow, 'recurve'), coalesce(p.arrow, 'standard'), v_world, x.dist)).apex::numeric, 1),
           'wind10Cm', round(((public.bullseye_book_get(coalesce(p.bow, 'recurve'), coalesce(p.arrow, 'standard'), v_world, x.dist)).lag * 4.4704 * 100)::numeric),
           'bestToday', (select max(y.ring) from public.bullseye_shots y where y.challenge_id = p_challenge_id and y.user_id = me
                          and y.day = today and y.target = x.id)) order by x.dist, x.id), '[]'::jsonb)
    into targets
  from public.bullseye_targets((cond ->> 'far')::int, v_world, (cond ->> 'balloons')::boolean, (cond ->> 'bounty')::boolean) x;

  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'fps', round(b.v0 / 0.3048), 'sight', b.sight, 'starBonus', b.star_bonus,
           'sway', b.sway, 'unlockSteps', b.unlock_steps, 'unlocked', b.unlock_steps <= game_steps,
           'at70', jsonb_build_object('apex', round((public.bullseye_book_get(b.id, 'standard', 'earth', 70)).apex::numeric, 1),
                     'wind10Cm', round(((public.bullseye_book_get(b.id, 'standard', 'earth', 70)).lag * 4.4704 * 100)::numeric)),
           'apex90', round((public.bullseye_book_get(b.id, 'standard', 'earth', 90)).apex::numeric, 1)) order by b.sort), '[]'::jsonb)
    into bows
  from public.bullseye_bows b;

  -- Today's ends: each arrow's ring (or pop) and the end's total.
  select coalesce(jsonb_agg(jsonb_build_object('endNo', e.end_no, 'total', e.total, 'arrows', e.arrows) order by e.end_no), '[]'::jsonb)
    into ends
  from (select x.end_no, sum(x.points)::int as total,
               jsonb_agg(jsonb_build_object('target', x.target, 'ring', x.ring, 'x', x.x_ring, 'popped', x.popped, 'robin', x.robin,
                 'points', x.points, 'xCm', x.x_cm, 'yCm', x.y_cm) order by x.arrow_no) as arrows
        from public.bullseye_shots x where x.challenge_id = p_challenge_id and x.user_id = me and x.day = today group by x.end_no) e;

  return jsonb_build_object(
    'settings', jsonb_build_object('stepsPerEnd', s.steps_per_end, 'maxEnds', s.max_ends, 'arrowsPerEnd', s.arrows_per_end,
                  'workoutMin', s.workout_min, 'robinHood', s.robin_hood, 'bountyBones', s.bounty_bones, 'fullDrawMs', s.full_draw_ms),
    'name', c.name,
    'isGlobal', c.is_global,
    'dayNo', day_no,
    'days', c.duration_days,
    'endsAt', c.ends_at,
    'over', c.score_settled_at is not null or day_no > c.duration_days,
    'players', n,
    'pool', pool,
    'prizes', jsonb_build_object(
      'places', (select coalesce(jsonb_agg(case when w_total > 0 then floor(pool * public.bullseye_place_weight(i)::numeric / w_total)::int else 0 end order by i), '[]'::jsonb)
                 from generate_series(1, least(n, 10)) i),
      'rest', case when rest_n > 0 then floor(pool * 12::numeric / w_total)::int end,
      'restMin', s.finish_min_bones),
    'conditions', cond,
    'goldTaker', (select jsonb_build_object('name', public.horse_name(b.user_id), 'me', b.user_id = me, 'bones', b.bones)
                  from public.bullseye_bounties b where b.challenge_id = p_challenge_id and b.day = today),
    'targets', targets,
    'bows', bows,
    'ends', ends,
    'me', jsonb_build_object('joined', joined, 'points', coalesce(p.points, 0), 'rank', my_rank, 'golds', coalesce(p.golds, 0),
            'arrows', coalesce(p.arrows, 0), 'bestEnd', coalesce(p.best_end, 0), 'robinHoods', coalesce(p.robin_hoods, 0),
            'bow', coalesce(p.bow, 'recurve'), 'arrow', coalesce(p.arrow, 'standard'), 'gameSteps', game_steps,
            'shotDays', (select count(distinct x.day) from public.bullseye_shots x where x.challenge_id = p_challenge_id and x.user_id = me)),
    'today', jsonb_build_object('steps', steps, 'fromSteps', from_steps, 'workoutMin', wmin, 'steady', wmin >= s.workout_min,
               'carried', coalesce(d.carried_in, 0), 'used', coalesce(d.used, 0),
               'left', case when d.challenge_id is null then 0 else greatest(0, d.carried_in - d.used + public.bullseye_granted(me, today)) end,
               'nextAt', case when from_steps >= s.max_ends then null else (from_steps + 1) * s.steps_per_end end),
    'board', board,
    'feed', coalesce((select jsonb_agg(jsonb_build_object('name', public.horse_name(x.user_id), 'dist', x.dist, 'target', x.target,
                        'ring', x.ring, 'x', x.x_ring, 'robin', x.robin, 'popped', x.popped, 'gold', x.bounty, 'points', x.points) order by x.created_at desc)
                      from (select * from public.bullseye_shots x where x.challenge_id = p_challenge_id
                            and (x.robin or x.bounty or (x.x_ring and x.dist >= 50)) and x.created_at > now() - interval '1 day'
                            order by x.created_at desc limit 5) x), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.bullseye_state(uuid, int) from public, anon;
grant execute on function public.bullseye_state(uuid, int) to authenticated;

-- ── The evening nudge ──

create or replace function public.bullseye_push()
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
    where c.kind::text = 'bullseye' and c.score_settled_at is null
      and public.soccer_today(cp.user_id) - public.soccer_first_day(c) + 1 between 1 and c.duration_days
      and not exists (select 1 from public.bullseye_shots s where s.challenge_id = cp.challenge_id and s.user_id = cp.user_id and s.day = public.soccer_today(cp.user_id))
  loop
    left_now := public.bullseye_left(r.challenge_id, r.user_id, public.soccer_today(r.user_id));
    if not exists (select 1 from public.bullseye_days d where d.challenge_id = r.challenge_id and d.user_id = r.user_id and d.day = public.soccer_today(r.user_id)) then
      left_now := left_now + least((select s.carry_max from public.bullseye_settings s),
                                   public.bullseye_left(r.challenge_id, r.user_id, public.soccer_today(r.user_id) - 1));
    end if;
    if left_now >= 3 then
      perform public.bullseye_notify(r.challenge_id, r.user_id, r.name, 'Your steps have earned ' || left_now || ' arrows. The field is open.');
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.bullseye_push() from public, anon, authenticated;
select cron.schedule('hound-bullseye-evening', '43 23 * * *', $$ select public.bullseye_push(); $$);

-- ── The payout ──

create or replace function public.bullseye_payout(p_challenge_id uuid)
returns table (user_id uuid, score int, bones int)
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_column
declare
  c public.challenges%rowtype;
  s public.bullseye_settings%rowtype;
  pool int;
  need int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into s from public.bullseye_settings;
  pool := public.bullseye_pool(p_challenge_id);
  need := least(s.finish_days, c.duration_days);
  return query
  with p as (
    select cp.user_id, coalesce(bp.points, 0) as points,
           (select count(distinct x.day) from public.bullseye_shots x where x.challenge_id = p_challenge_id and x.user_id = cp.user_id)::int as days
    from public.challenge_participants cp
    left join public.bullseye_players bp on bp.challenge_id = cp.challenge_id and bp.user_id = cp.user_id
    where cp.challenge_id = p_challenge_id
  ),
  r as (select p.*, rank() over (order by p.points desc) as rnk from p where p.days > 0),
  w as (select r.*, public.bullseye_place_weight(r.rnk::int) as pw, (r.rnk > 10 and r.days >= need) as rest from r),
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
revoke execute on function public.bullseye_payout(uuid) from public, anon, authenticated;

-- ── Global: publish_global_challenge takes 'bullseye' ──

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
  if p_kind::text not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly', 'doors', 'packs', 'golf', 'derby', 'shootout', 'titlebout', 'slots', 'longshot', 'bullseye') then
    raise exception 'That kind of challenge can''t be global — pick Step Race, Daily Streak, Distance, Bingo, 75 Day, Journey, Accountability, Hound''opoly, Daily Doors, Pack Wars, Golf, the Home Run Derby, the Hound Shootout, the Title Bout, Paw Slots, Long Shot or Bullseye.';
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
  if p_kind::text = 'bullseye' and (p_duration_days < 3 or p_duration_days > 14) then
    raise exception 'Bullseye runs 3 to 14 days.';
  end if;
  if p_kind::text = 'longshot' and (p_duration_days < 3 or p_duration_days > 14) then
    raise exception 'Long Shot runs 3 to 14 days.';
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

-- ── Scoring (0247's, with Bullseye) ──

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

  elsif c.kind::text = 'bullseye' then
    -- 0249: the pool paid by points; the Hound Score by place.
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select x.user_id, p_challenge_id, 'bullseye_result', x.score, 25, bones_trickle + x.bones
    from public.bullseye_payout(p_challenge_id) x;

  elsif c.kind::text = 'longshot' then
    -- 0247: the pool paid by points; the Hound Score by place.
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select x.user_id, p_challenge_id, 'longshot_result', x.score, 25, bones_trickle + x.bones
    from public.longshot_payout(p_challenge_id) x;

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

-- ── Admin → Overview → Games → Bullseye ──

create or replace function public.admin_bullseye_overview()
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
    'games', (select count(*) from public.challenges c where c.kind::text = 'bullseye'),
    'live', (select count(*) from public.challenges c where c.kind::text = 'bullseye' and c.score_settled_at is null and now() < c.ends_at),
    'helperGames', (select count(*) from public.bullseye_games g where g.helper),
    'tried', (select count(distinct s.user_id) from public.bullseye_shots s),
    'active7d', (select count(distinct s.user_id) from public.bullseye_shots s where s.created_at > now() - interval '7 days'),
    'arrows7d', (select count(*) from public.bullseye_shots s where s.created_at > now() - interval '7 days'),
    'golds7d', (select count(*) from public.bullseye_shots s where s.ring >= 9 and s.created_at > now() - interval '7 days'),
    'robins7d', (select count(*) from public.bullseye_shots s where s.robin and s.created_at > now() - interval '7 days'),
    'pops7d', (select count(*) from public.bullseye_shots s where s.popped and s.created_at > now() - interval '7 days'),
    'moon7d', (select count(*) from public.bullseye_shots s where s.world = 'moon' and s.created_at > now() - interval '7 days'),
    'gold7d', (select count(*) from public.bullseye_bounties b where b.created_at > now() - interval '7 days'),
    'goldBones', (select coalesce(sum(b.bones), 0) from public.bullseye_bounties b),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object('target', x.target, 'dist', x.dist, 'arrows', x.n, 'golds', x.g) order by x.dist, x.target)
      from (select s.target, s.dist, count(*) as n, count(*) filter (where s.ring >= 9 or s.popped) as g
            from public.bullseye_shots s where s.world = 'earth' and s.created_at > now() - interval '7 days' group by s.target, s.dist) x
    ), '[]'::jsonb),
    'bows', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.bow, 'name', b.name, 'arrows', x.n) order by x.n desc)
      from (select s.bow, count(*) as n from public.bullseye_shots s where s.created_at > now() - interval '7 days' group by s.bow) x
      join public.bullseye_bows b on b.id = x.bow
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_bullseye_overview() from public, anon;
grant execute on function public.admin_bullseye_overview() to authenticated;
