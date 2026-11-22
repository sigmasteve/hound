-- Hound: Long Shot (0246 adds the kind). Mockup:
-- claude.ai/artifact/RLwuPmWsbH8sEpiALUhUWf.
--
-- Long-range steel plates, played on your steps:
--
--   rounds      one every 1,000 steps on your own date, up to 10 a day.
--               Unused rounds carry to tomorrow, up to 10. A 20-minute
--               workout steadies your hold for the day (less sway).
--   the range   steel plates at 300, 600, 1,000, 1,500, 2,000, 2,500 and
--               3,000 yards (18 to 48 in, 1 to 20 points), out to the
--               farthest the maker picked. A center hit (the inner third)
--               doubles; the day's first round, if it hits, adds 2 (cold
--               bore). The gold plate (2,500 yards; 1,500 when the range
--               stops at 2,000) pays its Bones to the first hound to ring
--               it each day, straight away.
--   the day     the same for everyone in the game on a date: the air (the
--               place's altitude and the day's temperature) and the wind
--               (its speed, side, gusts and how it differs near, mid and
--               far down the range) come from the challenge and the date
--               (longshot_conditions). Moon days (Saturdays, or every day,
--               if the maker says): 1/6 gravity, no air, no wind, plates
--               from 1,000 to 5,000 yards.
--   a round     the server flies it: a point-mass trajectory with G7 drag
--               (longshot_fly), from the rifle's muzzle velocity (the
--               caliber and the barrel's length) and ballistic coefficient,
--               zeroed at 100 yards. The scope comes up dialed to your
--               data card's number for that plate; you hold off on the
--               reticle (mils) for the rest. Where it lands is the dial and
--               the hold, less the real drop, plus the wind's drift (the
--               wind when you fire, give or take), your sway (the same
--               formula the app draws, longshot_sway, from the aim's seed
--               and how long you'd held) and the rifle's own spread (more
--               once it's slower than sound).
--   the card    a hit writes the elevation that worked (the dial plus your
--               hold) to your data card for that rifle, place and plate;
--               until then it's the book (sea level, 59°F, no wind).
--   rifles      .223, 6.5 Creedmoor and .308 from the start; .338 Lapua at
--               40,000 steps in the game, .375 CheyTac at 80,000, .50 BMG at
--               120,000. Each has its barrels: longer is faster but sways
--               more.
--
-- Nothing here takes money or Bones in.
--
-- When it ends: the pool is Admin's (2,500 Bones with 11 or more hounds,
-- 200 a hound below that; a Global's can be set when it's published),
-- paid by points: 1st 30%, 2nd 18%, 3rd 12%, 4th to 10th 4% each and 12%
-- shared by everyone else who shot on 3 days (scaled to the places there
-- are, ties sharing). Anyone who shot on 3 days gets at least 5. On top of
-- the usual 5.
--
-- Pushes through send-golf-notification's 'longshot' kind (worded here):
-- an evening "rounds waiting" to anyone in a live game with 3 or more who
-- hasn't fired today.
--
-- Run this once, after 0246 (committed on its own), in the SQL Editor.
-- Then redeploy send-golf-notification.

-- ── Settings ──

create table public.longshot_settings (
  id boolean primary key default true,
  constraint longshot_settings_singleton check (id),
  steps_per_round int not null default 1000 check (steps_per_round between 100 and 10000),
  max_rounds int not null default 10 check (max_rounds between 1 and 100),
  carry_max int not null default 10 check (carry_max between 0 and 100),
  workout_min int not null default 20 check (workout_min between 5 and 120),
  -- The hold, in mils, before the rifle, the barrel and a workout.
  sway_mil numeric(4, 2) not null default 0.30 check (sway_mil between 0 and 2),
  steady numeric(3, 2) not null default 0.55 check (steady between 0.1 and 1),
  -- The rifle's own spread (mils, roughly a standard deviation) and how
  -- much the wind in flight differs from the wind when you fired.
  spread_mil numeric(4, 3) not null default 0.090 check (spread_mil between 0 and 1),
  transonic_mil numeric(4, 3) not null default 0.350 check (transonic_mil between 0 and 2),
  wind_noise numeric(3, 2) not null default 0.12 check (wind_noise between 0 and 1),
  cold_bore int not null default 2 check (cold_bore between 0 and 50),
  bounty_bones int not null default 150 check (bounty_bones between 0 and 2000),
  big_pool int not null default 2500 check (big_pool between 0 and 20000),
  big_pool_players int not null default 11 check (big_pool_players between 2 and 1000),
  per_player_bones int not null default 200 check (per_player_bones between 0 and 2000),
  finish_days int not null default 3 check (finish_days between 1 and 30),
  finish_min_bones int not null default 5 check (finish_min_bones between 0 and 500),
  updated_at timestamptz not null default now()
);
insert into public.longshot_settings (id) values (true);
alter table public.longshot_settings enable row level security;
create policy "Anyone signed in can read the Long Shot settings"
  on public.longshot_settings for select to authenticated using (true);
create policy "Only admins can change the Long Shot settings"
  on public.longshot_settings for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
revoke all on public.longshot_settings from anon;
revoke insert, delete on public.longshot_settings from authenticated;

-- The rifles: muzzle velocity at the reference barrel, G7 ballistic
-- coefficient, fps an inch of barrel, how much it sways, and the steps in
-- the game that unlock it. The app shows the same list (longshot_state).
create table public.longshot_calibers (
  id text primary key,
  name text not null,
  bullet text not null,
  mv int not null,
  bc numeric(5, 3) not null,
  ref_barrel int not null,
  fps_inch int not null,
  sway numeric(4, 2) not null,
  unlock_steps int not null default 0,
  barrels int[] not null,
  sort int not null
);
insert into public.longshot_calibers (id, name, bullet, mv, bc, ref_barrel, fps_inch, sway, unlock_steps, barrels, sort) values
  ('223', '.223 Rem', '77 gr', 2800, 0.190, 24, 25, 0.85, 0, array[16, 20, 24, 26], 1),
  ('65', '6.5 Creedmoor', '140 gr', 2710, 0.315, 24, 25, 1.00, 0, array[16, 20, 24, 26], 2),
  ('308', '.308 Win', '175 gr', 2600, 0.243, 24, 25, 1.00, 0, array[16, 20, 24, 26], 3),
  ('338', '.338 Lapua', '300 gr', 2750, 0.419, 27, 20, 1.15, 40000, array[20, 24, 27, 30], 4),
  ('375', '.375 CheyTac', '350 gr', 3000, 0.480, 29, 20, 1.25, 80000, array[22, 26, 29, 32], 5),
  ('50', '.50 BMG', '750 gr', 2820, 0.520, 29, 20, 1.40, 120000, array[22, 26, 29, 32], 6);
alter table public.longshot_calibers enable row level security;
create policy "Anyone signed in can read the Long Shot rifles"
  on public.longshot_calibers for select to authenticated using (true);
revoke all on public.longshot_calibers from anon;
revoke insert, update, delete on public.longshot_calibers from authenticated;

-- ── Tables ──

-- How a game is set up: where (the air), the farthest plate, Moon days,
-- the gold plate, a Global's own pool.
create table public.longshot_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  place text not null default 'desert' check (place in ('sea', 'desert', 'mountain')),
  far int not null default 3000 check (far in (1000, 2000, 3000)),
  moon text not null default 'sat' check (moon in ('none', 'sat', 'all')),
  bounty boolean not null default true,
  pool int check (pool between 0 and 20000),
  created_at timestamptz not null default now()
);

create table public.longshot_players (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  points int not null default 0 check (points >= 0),
  hits int not null default 0,
  shots int not null default 0,
  longest int not null default 0,
  caliber text not null default '65' references public.longshot_calibers (id),
  barrel int not null default 24,
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index longshot_players_rank on public.longshot_players (challenge_id, points desc);

-- One row a member a day they played: rounds carried in and used.
create table public.longshot_days (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  carried_in int not null default 0 check (carried_in >= 0),
  used int not null default 0 check (used >= 0),
  primary key (challenge_id, user_id, day)
);

-- Your data card: the elevation (mils) that rang each plate, by rifle,
-- place and world. It goes with you from game to game.
create table public.longshot_cards (
  user_id uuid not null references public.profiles (id) on delete cascade,
  caliber text not null references public.longshot_calibers (id),
  barrel int not null,
  place text not null,
  world text not null check (world in ('earth', 'moon')),
  dist int not null,
  elev numeric(6, 2) not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, caliber, barrel, place, world, dist)
);

-- The book: each rifle at sea level, 59°F, no wind (or on the Moon),
-- worked out once.
create table public.longshot_book (
  caliber text not null references public.longshot_calibers (id),
  barrel int not null,
  world text not null,
  dist int not null,
  drop_mil double precision not null,
  lag double precision not null,
  tof double precision not null,
  v_end double precision not null,
  primary key (caliber, barrel, world, dist)
);

-- Looking through the scope: a seed for the sway and when it started.
create table public.longshot_aims (
  id bigserial primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  dist int not null,
  seed int not null,
  amp numeric(5, 3) not null,
  started_at timestamptz not null default now(),
  fired boolean not null default false
);
create index longshot_aims_user on public.longshot_aims (user_id, started_at desc);

-- Every round fired.
create table public.longshot_shots (
  id bigserial primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  world text not null,
  dist int not null,
  caliber text not null,
  barrel int not null,
  dial numeric(6, 2) not null,
  hold_x numeric(6, 2) not null,
  hold_y numeric(6, 2) not null,
  sway_x numeric(6, 3) not null,
  sway_y numeric(6, 3) not null,
  wind_mph numeric(5, 2) not null,
  impact_x numeric(8, 2) not null,
  impact_y numeric(8, 2) not null,
  hit boolean not null,
  center boolean not null,
  points int not null default 0,
  cold_bore boolean not null default false,
  bounty boolean not null default false,
  tof numeric(6, 3) not null,
  v_end int not null,
  created_at timestamptz not null default now()
);
create index longshot_shots_challenge on public.longshot_shots (challenge_id, created_at desc);
create index longshot_shots_user on public.longshot_shots (user_id, created_at desc);

-- The gold plate: who rang it first each day, and what it paid.
create table public.longshot_bounties (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  dist int not null,
  bones int not null,
  created_at timestamptz not null default now(),
  primary key (challenge_id, day)
);

alter table public.longshot_games enable row level security;
alter table public.longshot_players enable row level security;
alter table public.longshot_days enable row level security;
alter table public.longshot_cards enable row level security;
alter table public.longshot_book enable row level security;
alter table public.longshot_aims enable row level security;
alter table public.longshot_shots enable row level security;
alter table public.longshot_bounties enable row level security;
revoke all on public.longshot_games, public.longshot_players, public.longshot_days, public.longshot_cards, public.longshot_book,
  public.longshot_aims, public.longshot_shots, public.longshot_bounties from anon;
revoke insert, update, delete on public.longshot_games, public.longshot_players, public.longshot_days, public.longshot_cards,
  public.longshot_book, public.longshot_aims, public.longshot_shots, public.longshot_bounties from authenticated;
-- Everything is read through longshot_state.

-- ── The physics ──

-- The G7 drag coefficient at a Mach number (the standard table, thinned).
create or replace function public.longshot_g7(p_mach double precision)
returns double precision
language plpgsql
immutable
as $$
declare
  m double precision[] := array[0, 0.5, 0.7, 0.8, 0.85, 0.9, 0.95, 0.975, 1.0, 1.025, 1.05, 1.1, 1.2, 1.3, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0];
  c double precision[] := array[0.1198, 0.1197, 0.1196, 0.1210, 0.1235, 0.1295, 0.1450, 0.2000, 0.3803, 0.4000, 0.4043, 0.4014, 0.3900, 0.3770, 0.3507, 0.3200, 0.2980, 0.2606, 0.2366, 0.2050];
  i int;
begin
  if p_mach >= m[20] then
    return c[20];
  end if;
  for i in 2..20 loop
    if p_mach <= m[i] then
      return c[i - 1] + (c[i] - c[i - 1]) * (p_mach - m[i - 1]) / (m[i] - m[i - 1]);
    end if;
  end loop;
  return c[20];
end;
$$;
revoke execute on function public.longshot_g7(double precision) from public, anon, authenticated;

-- A round's flight to p_yd yards: the drop in mils below the line that
-- zeroes at 100 yards, the wind's lag time (flight time less the time in
-- a vacuum: drift = crosswind x lag), the flight time and the speed at
-- the plate (fps). In air of density p_rho (kg/m3; 0 on the Moon) under
-- gravity p_g, in 3 m steps.
create or replace function public.longshot_fly(p_mv double precision, p_bc double precision, p_yd int, p_rho double precision, p_g double precision)
returns table (drop_mil double precision, lag double precision, tof double precision, v_end double precision)
language plpgsql
immutable
as $$
declare
  v0 double precision := p_mv * 0.3048;
  r double precision := p_yd * 0.9144;
  bcs double precision := p_bc * 703.0696;
  vx double precision := v0;
  vy double precision := 0;
  x double precision := 0;
  y double precision := 0;
  t double precision := 0;
  y100 double precision;
  v double precision;
  a double precision;
  dt double precision;
  step double precision;
begin
  while x < r - 1e-9 loop
    step := least(3.0, r - x);
    if y100 is null and x + step >= 91.44 then
      step := greatest(1e-6, 91.44 - x);
    end if;
    v := sqrt(vx * vx + vy * vy);
    a := case when p_rho > 0 then p_rho * v * v * public.longshot_g7(v / 343.0) * pi() / 8 / bcs else 0 end;
    dt := step / vx;
    vx := vx - a * vx / v * dt;
    vy := vy - (a * vy / v + p_g) * dt;
    x := x + step;
    y := y + vy * dt;
    t := t + dt;
    if y100 is null and x >= 91.44 - 1e-9 then
      y100 := y;
    end if;
  end loop;
  drop_mil := -(y - coalesce(y100, 0) * r / 91.44) / r * 1000;
  lag := t - r / v0;
  tof := t;
  v_end := sqrt(vx * vx + vy * vy) / 0.3048;
  return next;
end;
$$;
revoke execute on function public.longshot_fly(double precision, double precision, int, double precision, double precision) from public, anon, authenticated;

-- A rifle: its muzzle velocity with this barrel, its BC and its sway.
create or replace function public.longshot_rifle(p_caliber text, p_barrel int)
returns table (mv double precision, bc double precision, sway double precision)
language sql
stable
security definer set search_path = public
as $$
  select (k.mv + k.fps_inch * (p_barrel - k.ref_barrel))::double precision, k.bc::double precision,
         (k.sway * (1 + 0.02 * (p_barrel - k.ref_barrel)))::double precision
  from public.longshot_calibers k where k.id = p_caliber;
$$;
revoke execute on function public.longshot_rifle(text, int) from public, anon, authenticated;

-- The book for a rifle and plate (worked out once, then kept).
create or replace function public.longshot_book_get(p_caliber text, p_barrel int, p_world text, p_dist int)
returns public.longshot_book
language plpgsql
security definer set search_path = public
as $$
declare
  b public.longshot_book%rowtype;
  rf record;
  f record;
begin
  select * into b from public.longshot_book where caliber = p_caliber and barrel = p_barrel and world = p_world and dist = p_dist;
  if found then
    return b;
  end if;
  select * into rf from public.longshot_rifle(p_caliber, p_barrel);
  select * into f from public.longshot_fly(rf.mv, rf.bc, p_dist,
    case when p_world = 'moon' then 0 else 1.225 end, case when p_world = 'moon' then 1.62 else 9.80665 end);
  insert into public.longshot_book (caliber, barrel, world, dist, drop_mil, lag, tof, v_end)
  values (p_caliber, p_barrel, p_world, p_dist, f.drop_mil, f.lag, f.tof, f.v_end)
  on conflict do nothing;
  select * into b from public.longshot_book where caliber = p_caliber and barrel = p_barrel and world = p_world and dist = p_dist;
  return b;
end;
$$;
revoke execute on function public.longshot_book_get(text, int, text, int) from public, anon, authenticated;

-- The plates: distance, size (inches) and points, on Earth (out to the
-- farthest) or the Moon.
create or replace function public.longshot_plates(p_far int, p_world text)
returns table (dist int, size int, pts int)
language sql
immutable
as $$
  select x.d, x.s, x.p from (values
    ('earth', 300, 18, 1), ('earth', 600, 18, 2), ('earth', 1000, 24, 3), ('earth', 1500, 30, 5),
    ('earth', 2000, 36, 8), ('earth', 2500, 48, 12), ('earth', 3000, 48, 20),
    ('moon', 1000, 24, 3), ('moon', 2000, 30, 6), ('moon', 3000, 36, 10), ('moon', 4000, 48, 15), ('moon', 5000, 48, 25)
  ) x (w, d, s, p)
  where x.w = p_world and (p_world = 'moon' or x.d <= p_far)
  order by x.d;
$$;
revoke execute on function public.longshot_plates(int, text) from public, anon, authenticated;

-- The gold plate's distance.
create or replace function public.longshot_gold(p_far int, p_world text)
returns int
language sql
immutable
as $$
  select case when p_world = 'moon' then 4000 when p_far >= 3000 then 2500 when p_far >= 2000 then 1500 else 1000 end;
$$;
revoke execute on function public.longshot_gold(int, text) from public, anon, authenticated;

-- A day's range, the same for everyone in the game: the world, the air,
-- the temperature, and the wind (mph at its strongest steady, which side
-- it comes from, the gusts' size, period and phase, and how much stronger
-- or weaker it is near, mid and far).
create or replace function public.longshot_conditions(p_challenge_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  g public.longshot_games%rowtype;
  h bigint;
  moon boolean;
  temp int;
  rho double precision;
begin
  select * into g from public.longshot_games where challenge_id = p_challenge_id;
  if not found then
    g.place := 'desert';
    g.far := 3000;
    g.moon := 'sat';
    g.bounty := true;
  end if;
  h := abs(hashtext(p_challenge_id::text || ':' || p_day::text)::bigint);
  moon := g.moon = 'all' or (g.moon = 'sat' and extract(isodow from p_day) = 6);
  temp := 35 + (h % 51)::int;
  rho := case g.place when 'sea' then 1.225 when 'desert' then 1.06 else 0.94 end * (519.0 / (460 + temp));
  return jsonb_build_object(
    'world', case when moon then 'moon' else 'earth' end,
    'place', g.place,
    'far', g.far,
    'bounty', g.bounty,
    'gold', public.longshot_gold(g.far, case when moon then 'moon' else 'earth' end),
    'tempF', temp,
    'altitudeFt', case g.place when 'sea' then 0 when 'desert' then 4800 else 9000 end,
    'rho', case when moon then 0 else round(rho::numeric, 4) end,
    'wind', case when moon then jsonb_build_object('mph', 0, 'from', 'none', 'gust', 0, 'period', 30, 'phase', 0, 'near', 1, 'mid', 1, 'far', 1)
            else jsonb_build_object(
              'mph', 3 + ((h / 51) % 1201)::numeric / 100,
              'from', case when (h / 61261) % 2 = 0 then 'left' else 'right' end,
              'gust', 0.15 + ((h / 122522) % 21)::numeric / 100,
              'period', 20 + ((h / 2572962) % 21)::int,
              'phase', round((((h / 54032202) % 628)::numeric / 100), 2),
              'near', 0.85 + ((h / 7) % 31)::numeric / 100,
              'mid', 0.85 + ((h / 217) % 31)::numeric / 100,
              'far', 0.85 + ((h / 6727) % 31)::numeric / 100) end
  );
end;
$$;
revoke execute on function public.longshot_conditions(uuid, date) from public, anon, authenticated;

-- The wind (mph, full value; + from the left, pushing right) down the
-- whole range at a moment: the gust cycle, then near, mid and far
-- weighted 45 / 35 / 20 (the wind near the muzzle moves it most).
create or replace function public.longshot_wind_at(p_cond jsonb, p_at timestamptz)
returns double precision
language sql
immutable
as $$
  select case when w ->> 'from' = 'none' then 0 else
    (case when w ->> 'from' = 'left' then 1 else -1 end)
    * (w ->> 'mph')::double precision
    * (1 + (w ->> 'gust')::double precision * sin(2 * pi() * extract(epoch from p_at) / (w ->> 'period')::double precision + (w ->> 'phase')::double precision))
    * (0.45 * (w ->> 'near')::double precision + 0.35 * (w ->> 'mid')::double precision + 0.2 * (w ->> 'far')::double precision)
  end
  from (select p_cond -> 'wind' as w) x;
$$;
revoke execute on function public.longshot_wind_at(jsonb, timestamptz) from public, anon, authenticated;

-- The reticle's sway (mils) p_t ms into an aim: two slow waves each way
-- from the seed, quietest in the breath's natural pause (2.8 to 4.2 s of
-- every 4.5), growing after 9 s held. The app draws the same.
create or replace function public.longshot_sway(p_seed int, p_amp double precision, p_t int)
returns table (x double precision, y double precision)
language plpgsql
immutable
as $$
declare
  s bigint := abs(p_seed::bigint);
  ph double precision[] := array[0, 0, 0, 0];
  i int;
  cyc int := p_t % 4500;
  breath double precision;
  tired double precision;
  a double precision;
begin
  for i in 1..4 loop
    ph[i] := ((s / (32 ^ (i - 1))::bigint) % 32) / 32.0 * 2 * pi();
  end loop;
  breath := case when cyc >= 2800 and cyc < 4200 then 0.35 else 1 end;
  tired := least(2.5, 1 + greatest(0, p_t - 9000) / 6000.0);
  a := p_amp * breath * tired;
  x := a * (0.62 * sin(2 * pi() * p_t / 1700.0 + ph[1]) + 0.38 * sin(2 * pi() * p_t / 690.0 + ph[2]));
  y := a * (0.62 * sin(2 * pi() * p_t / 2100.0 + ph[3]) + 0.38 * sin(2 * pi() * p_t / 810.0 + ph[4]));
  return next;
end;
$$;
revoke execute on function public.longshot_sway(int, double precision, int) from public, anon, authenticated;

-- ── Rounds ──

create or replace function public.longshot_notify(p_challenge_id uuid, p_recipient uuid, p_title text, p_message text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.golf_notify('longshot', p_challenge_id, p_recipient, jsonb_build_object('title', p_title, 'message', p_message));
end;
$$;
revoke execute on function public.longshot_notify(uuid, uuid, text, text) from public, anon, authenticated;

-- What a day's steps give.
create or replace function public.longshot_granted(p_user uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select least(s.max_rounds, public.chess_steps(p_user, p_day) / s.steps_per_round) from public.longshot_settings s;
$$;
revoke execute on function public.longshot_granted(uuid, date) from public, anon, authenticated;

-- What's left of a day: carried in and granted, less used.
create or replace function public.longshot_left(p_challenge_id uuid, p_user uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select greatest(0, coalesce(d.carried_in - d.used, 0) + public.longshot_granted(p_user, p_day))
  from (select 1) one
  left join public.longshot_days d on d.challenge_id = p_challenge_id and d.user_id = p_user and d.day = p_day;
$$;
revoke execute on function public.longshot_left(uuid, uuid, date) from public, anon, authenticated;

-- Today's row, made on the first look of the day with what carried over.
create or replace function public.longshot_day_row(p_challenge_id uuid, p_user uuid, p_day date)
returns public.longshot_days
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  d public.longshot_days%rowtype;
  carry int := 0;
begin
  select * into d from public.longshot_days where challenge_id = p_challenge_id and user_id = p_user and day = p_day;
  if found then
    return d;
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if p_day - 1 >= public.soccer_first_day(c) then
    carry := least((select s.carry_max from public.longshot_settings s), public.longshot_left(p_challenge_id, p_user, p_day - 1));
  end if;
  insert into public.longshot_days (challenge_id, user_id, day, carried_in) values (p_challenge_id, p_user, p_day, carry)
  on conflict do nothing;
  select * into d from public.longshot_days where challenge_id = p_challenge_id and user_id = p_user and day = p_day;
  return d;
end;
$$;
revoke execute on function public.longshot_day_row(uuid, uuid, date) from public, anon, authenticated;

-- Steps walked in the game so far (they unlock the bigger rifles).
create or replace function public.longshot_game_steps(p_challenge_id uuid, p_user uuid)
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
revoke execute on function public.longshot_game_steps(uuid, uuid) from public, anon, authenticated;

-- The pool when it ends: a Global's own, else Admin's for its size.
create or replace function public.longshot_pool(p_challenge_id uuid)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select g.pool from public.longshot_games g where g.challenge_id = p_challenge_id),
    (select case when n >= s.big_pool_players then s.big_pool else least(s.big_pool, n * s.per_player_bones) end
     from public.longshot_settings s,
          (select count(*)::int as n from public.challenge_participants cp where cp.challenge_id = p_challenge_id) x));
$$;
revoke execute on function public.longshot_pool(uuid) from public, anon, authenticated;

-- ── Joining and setting up ──

create or replace function public.longshot_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (select kind::text from public.challenges where id = new.challenge_id) is distinct from 'longshot' then
    return new;
  end if;
  insert into public.longshot_players (challenge_id, user_id) values (new.challenge_id, new.user_id) on conflict do nothing;
  return new;
end;
$$;
revoke execute on function public.longshot_after_join() from public, anon, authenticated;
create trigger longshot_after_join
  after insert on public.challenge_participants
  for each row execute procedure public.longshot_after_join();

-- Where, how far, Moon days and the gold plate, set by whoever made it
-- (an admin for a Global, who can also set its pool) before anyone fires.
create or replace function public.longshot_setup(p_challenge_id uuid, p_place text, p_far int, p_moon text, p_bounty boolean, p_pool int default null)
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
  if not found or c.kind::text <> 'longshot' then
    raise exception 'That isn''t a Long Shot challenge.';
  end if;
  admin := exists (select 1 from public.profiles p where p.id = me and p.is_admin);
  if me is null or (c.created_by is distinct from me and not (c.is_global and admin)) then
    raise exception 'Only whoever made it can set it up.';
  end if;
  if p_place is null or p_place not in ('sea', 'desert', 'mountain') then
    raise exception 'Pick sea level, the desert or the mountain.';
  end if;
  if p_far is null or p_far not in (1000, 2000, 3000) then
    raise exception 'The farthest plate is 1,000, 2,000 or 3,000 yards.';
  end if;
  if p_moon is null or p_moon not in ('none', 'sat', 'all') then
    raise exception 'Moon days: none, Saturdays or every day.';
  end if;
  if p_pool is not null and not (c.is_global and admin) then
    raise exception 'Only an admin can set a Global''s prize pool.';
  end if;
  if p_pool is not null and (p_pool < 0 or p_pool > 20000) then
    raise exception 'The pool is 0 to 20,000 Bones.';
  end if;
  if exists (select 1 from public.longshot_shots s where s.challenge_id = p_challenge_id) then
    raise exception 'It''s started: the range is set.';
  end if;
  insert into public.longshot_games (challenge_id, place, far, moon, bounty, pool)
  values (p_challenge_id, p_place, p_far, p_moon, coalesce(p_bounty, true), p_pool)
  on conflict (challenge_id) do update set place = excluded.place, far = excluded.far, moon = excluded.moon,
    bounty = excluded.bounty, pool = coalesce(excluded.pool, public.longshot_games.pool);
  insert into public.longshot_players (challenge_id, user_id)
    select cp.challenge_id, cp.user_id from public.challenge_participants cp where cp.challenge_id = p_challenge_id
    on conflict do nothing;
end;
$$;
revoke execute on function public.longshot_setup(uuid, text, int, text, boolean, int) from public, anon;
grant execute on function public.longshot_setup(uuid, text, int, text, boolean, int) to authenticated;

-- ── What the app does ──

-- Checks a member can play today; returns the challenge.
create or replace function public.longshot_live(p_challenge_id uuid, p_user uuid)
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
  if not found or c.kind::text <> 'longshot' then
    raise exception 'That isn''t a Long Shot challenge.';
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
  insert into public.longshot_players (challenge_id, user_id) values (p_challenge_id, p_user) on conflict do nothing;
  return c;
end;
$$;
revoke execute on function public.longshot_live(uuid, uuid) from public, anon, authenticated;

-- The elevation the scope comes up dialed to: your card's, else the book's.
create or replace function public.longshot_dial(p_user uuid, p_caliber text, p_barrel int, p_place text, p_world text, p_dist int)
returns double precision
language plpgsql
security definer set search_path = public
as $$
declare
  e numeric;
begin
  select k.elev into e from public.longshot_cards k
  where k.user_id = p_user and k.caliber = p_caliber and k.barrel = p_barrel and k.place = p_place and k.world = p_world and k.dist = p_dist;
  if found then
    return e;
  end if;
  return round((public.longshot_book_get(p_caliber, p_barrel, p_world, p_dist)).drop_mil::numeric, 1);
end;
$$;
revoke execute on function public.longshot_dial(uuid, text, int, text, text, int) from public, anon, authenticated;

-- Pick a rifle and barrel (one you've unlocked in this game).
create or replace function public.longshot_loadout(p_challenge_id uuid, p_caliber text, p_barrel int)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  k public.longshot_calibers%rowtype;
begin
  perform public.longshot_live(p_challenge_id, me);
  select * into k from public.longshot_calibers where id = p_caliber;
  if not found then
    raise exception 'That rifle isn''t on the rack.';
  end if;
  if p_barrel is null or not (p_barrel = any (k.barrels)) then
    raise exception 'That barrel doesn''t fit the %.', k.name;
  end if;
  if k.unlock_steps > public.longshot_game_steps(p_challenge_id, me) then
    raise exception 'The % unlocks at % steps in this game.', k.name, to_char(k.unlock_steps, 'FM999,999');
  end if;
  update public.longshot_players set caliber = p_caliber, barrel = p_barrel, updated_at = now()
  where challenge_id = p_challenge_id and user_id = me;
end;
$$;
revoke execute on function public.longshot_loadout(uuid, text, int) from public, anon;
grant execute on function public.longshot_loadout(uuid, text, int) to authenticated;

-- Up to the scope on a plate: a seed for the sway, and what the scope
-- shows (the dial, the sway's size). Uses no round.
create or replace function public.longshot_aim(p_challenge_id uuid, p_dist int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  s public.longshot_settings%rowtype;
  p public.longshot_players%rowtype;
  today date;
  cond jsonb;
  world text;
  rf record;
  amp double precision;
  seed int := floor(random() * 2000000000)::int;
  aid bigint;
  plate record;
begin
  perform public.longshot_live(p_challenge_id, me);
  select * into s from public.longshot_settings;
  select * into p from public.longshot_players where challenge_id = p_challenge_id and user_id = me;
  today := public.soccer_today(me);
  perform public.longshot_day_row(p_challenge_id, me, today);
  if public.longshot_left(p_challenge_id, me, today) < 1 then
    raise exception 'No rounds left: walk 1,000 steps for the next.';
  end if;
  cond := public.longshot_conditions(p_challenge_id, today);
  world := cond ->> 'world';
  select * into plate from public.longshot_plates((cond ->> 'far')::int, world) x where x.dist = p_dist;
  if not found then
    raise exception 'There''s no plate at % yards today.', p_dist;
  end if;
  select * into rf from public.longshot_rifle(p.caliber, p.barrel);
  amp := s.sway_mil * rf.sway * case when public.chess_workout_min(me, today) >= s.workout_min then s.steady else 1 end;
  insert into public.longshot_aims (challenge_id, user_id, day, dist, seed, amp) values (p_challenge_id, me, today, p_dist, seed, amp)
  returning id into aid;
  return jsonb_build_object('aimId', aid, 'seed', seed, 'amp', round(amp::numeric, 3), 'dist', p_dist, 'size', plate.size, 'pts', plate.pts,
    'dial', round(public.longshot_dial(me, p.caliber, p.barrel, cond ->> 'place', world, p_dist)::numeric, 2),
    'learned', exists (select 1 from public.longshot_cards k where k.user_id = me and k.caliber = p.caliber and k.barrel = p.barrel
                         and k.place = cond ->> 'place' and k.world = world and k.dist = p_dist),
    'conditions', cond);
end;
$$;
revoke execute on function public.longshot_aim(uuid, int) from public, anon;
grant execute on function public.longshot_aim(uuid, int) to authenticated;

-- Fire: the hold (mils; + right and + up) and how long you'd been aiming
-- by your phone (ms; the server keeps it honest). The server flies it.
create or replace function public.longshot_fire(p_challenge_id uuid, p_aim_id bigint, p_hold_x double precision, p_hold_y double precision, p_t int default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  c public.challenges%rowtype;
  s public.longshot_settings%rowtype;
  p public.longshot_players%rowtype;
  a public.longshot_aims%rowtype;
  today date;
  cond jsonb;
  world text;
  place text;
  plate record;
  rf record;
  f record;
  elapsed int;
  t int;
  sw record;
  dial double precision;
  wind double precision;
  drift double precision;
  spread double precision;
  ix double precision;
  iy double precision;
  in_per_mil double precision;
  miss_in double precision;
  hit boolean;
  center boolean;
  pts int := 0;
  first_today boolean;
  cold boolean := false;
  gold boolean := false;
  gold_paid int := 0;
  learned double precision;
  msg text;
  hx double precision := least(30, greatest(-30, coalesce(p_hold_x, 0)));
  hy double precision := least(30, greatest(-30, coalesce(p_hold_y, 0)));
begin
  c := public.longshot_live(p_challenge_id, me);
  select * into s from public.longshot_settings;
  select * into a from public.longshot_aims where id = p_aim_id and user_id = me and challenge_id = p_challenge_id for update;
  if not found then
    raise exception 'Get back on the scope and try again.';
  end if;
  if a.fired then
    raise exception 'That one''s already gone.';
  end if;
  today := public.soccer_today(me);
  if a.day <> today then
    raise exception 'A new day: get back on the scope.';
  end if;
  elapsed := floor(extract(epoch from (clock_timestamp() - a.started_at)) * 1000)::int;
  if elapsed > 120000 then
    raise exception 'You held that too long. Get back on the scope.';
  end if;
  perform public.longshot_day_row(p_challenge_id, me, today);
  if public.longshot_left(p_challenge_id, me, today) < 1 then
    raise exception 'No rounds left: walk 1,000 steps for the next.';
  end if;
  update public.longshot_aims set fired = true where id = a.id;
  -- Your phone's time, but never later than the server's or more than 2 s earlier.
  t := least(elapsed, greatest(greatest(0, elapsed - 2000), coalesce(p_t, elapsed)));

  select * into p from public.longshot_players where challenge_id = p_challenge_id and user_id = me for update;
  cond := public.longshot_conditions(p_challenge_id, today);
  world := cond ->> 'world';
  place := cond ->> 'place';
  select * into plate from public.longshot_plates((cond ->> 'far')::int, world) x where x.dist = a.dist;
  select * into rf from public.longshot_rifle(p.caliber, p.barrel);
  select * into f from public.longshot_fly(rf.mv, rf.bc, a.dist, (cond ->> 'rho')::double precision,
    case when world = 'moon' then 1.62 else 9.80665 end);
  select * into sw from public.longshot_sway(a.seed, a.amp::double precision, t);
  dial := public.longshot_dial(me, p.caliber, p.barrel, place, world, a.dist);
  wind := public.longshot_wind_at(cond, now()) * (1 + s.wind_noise * (random() * 2 - 1));
  -- The drift (mils): crosswind (m/s) x lag over the distance.
  drift := wind * 0.44704 * f.lag / (a.dist * 0.9144) * 1000;
  spread := s.spread_mil + case when f.v_end < 1125 then s.transonic_mil else 0 end;
  ix := hx + sw.x + drift + spread * (random() + random() + random() - 1.5) * 1.15;
  iy := dial + hy + sw.y - f.drop_mil + spread * (random() + random() + random() - 1.5) * 1.15;
  in_per_mil := a.dist * 0.036;
  miss_in := sqrt(ix * ix + iy * iy) * in_per_mil;
  hit := miss_in <= plate.size / 2.0;
  center := miss_in <= plate.size / 6.0;

  first_today := not exists (select 1 from public.longshot_shots x where x.challenge_id = p_challenge_id and x.user_id = me and x.day = today);
  if hit then
    pts := plate.pts * case when center then 2 else 1 end;
    if first_today then
      cold := true;
      pts := pts + s.cold_bore;
    end if;
    -- The gold plate: the first hound to ring it today.
    if (cond ->> 'bounty')::boolean and a.dist = (cond ->> 'gold')::int and s.bounty_bones > 0 then
      insert into public.longshot_bounties (challenge_id, day, user_id, dist, bones)
      values (p_challenge_id, today, me, a.dist, s.bounty_bones)
      on conflict do nothing;
      if found then
        gold := true;
        gold_paid := s.bounty_bones;
        update public.profiles x set bones_balance = x.bones_balance + gold_paid, bones_earned_total = x.bones_earned_total + gold_paid
          where x.id = me;
      end if;
    end if;
    -- The card learns what rang it.
    learned := round((dial + hy)::numeric, 2);
    insert into public.longshot_cards (user_id, caliber, barrel, place, world, dist, elev)
    values (me, p.caliber, p.barrel, place, world, a.dist, learned)
    on conflict on constraint longshot_cards_pkey do update set elev = excluded.elev, updated_at = now();
  end if;

  update public.longshot_days set used = used + 1 where challenge_id = p_challenge_id and user_id = me and day = today;
  update public.longshot_players set points = points + pts, hits = hits + case when hit then 1 else 0 end, shots = shots + 1,
    longest = case when hit then greatest(longest, a.dist) else longest end, updated_at = now()
  where challenge_id = p_challenge_id and user_id = me;
  insert into public.longshot_shots (challenge_id, user_id, day, world, dist, caliber, barrel, dial, hold_x, hold_y, sway_x, sway_y,
    wind_mph, impact_x, impact_y, hit, center, points, cold_bore, bounty, tof, v_end)
  values (p_challenge_id, me, today, world, a.dist, p.caliber, p.barrel, dial, hx, hy, sw.x, sw.y,
    abs(wind), ix * in_per_mil, iy * in_per_mil, hit, center, pts, cold, gold, f.tof, round(f.v_end));

  msg := case
    when gold then 'The gold plate! ' || gold_paid || ' Bones, and ' || pts || ' points.'
    when center then 'Center! ' || pts || ' points.'
    when hit then 'Clang! ' || pts || ' points.'
    else 'Miss: ' || round(abs(iy * in_per_mil)) || ' in ' || case when iy > 0 then 'high' else 'low' end
         || ', ' || round(abs(ix * in_per_mil)) || ' in ' || case when ix > 0 then 'right' else 'left' end || '.'
  end;
  return jsonb_build_object(
    'hit', hit, 'center', center, 'points', pts, 'coldBore', cold, 'gold', gold, 'goldBones', gold_paid, 'message', msg,
    'dist', a.dist, 'size', plate.size,
    'impact', jsonb_build_object('xIn', round((ix * in_per_mil)::numeric, 1), 'yIn', round((iy * in_per_mil)::numeric, 1),
                'xMil', round(ix::numeric, 2), 'yMil', round(iy::numeric, 2)),
    'dial', round(dial::numeric, 2), 'hold', jsonb_build_object('x', round(hx::numeric, 2), 'y', round(hy::numeric, 2)),
    'sway', jsonb_build_object('x', round(sw.x::numeric, 2), 'y', round(sw.y::numeric, 2)),
    'windMph', round(abs(wind)::numeric, 1), 'tof', round(f.tof::numeric, 2), 'vEnd', round(f.v_end), 'muzzle', round(rf.mv),
    'dropMil', round(f.drop_mil::numeric, 2),
    'learned', case when hit then learned end,
    'left', public.longshot_left(p_challenge_id, me, today),
    'total', (select x.points from public.longshot_players x where x.challenge_id = p_challenge_id and x.user_id = me)
  );
end;
$$;
revoke execute on function public.longshot_fire(uuid, bigint, double precision, double precision, int) from public, anon;
grant execute on function public.longshot_fire(uuid, bigint, double precision, double precision, int) to authenticated;

-- A place's share of the pool: 30, 18, 12, then 4 to 10th.
create or replace function public.longshot_place_weight(p_rank bigint)
returns int
language sql
immutable
as $$
  select case when p_rank between 1 and 10 then (array[30, 18, 12, 4, 4, 4, 4, 4, 4, 4])[p_rank] else 0 end;
$$;
revoke execute on function public.longshot_place_weight(bigint) from public, anon, authenticated;

-- ── What the app shows ──

-- Everything the range, the scope and the challenge page need. p_steps is
-- the phone's own count for today, kept like Hound Chess's.
create or replace function public.longshot_state(p_challenge_id uuid, p_steps int default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  c public.challenges%rowtype;
  s public.longshot_settings%rowtype;
  p public.longshot_players%rowtype;
  today date;
  day_no int;
  d public.longshot_days%rowtype;
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
  world text;
  game_steps int;
  board jsonb;
  plates jsonb;
  rifles jsonb;
  card jsonb;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'longshot' then
    raise exception 'That isn''t a Long Shot challenge.';
  end if;
  joined := exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me);
  if not joined and not c.is_global then
    raise exception 'Join the challenge to see it.';
  end if;
  select * into s from public.longshot_settings;
  today := public.soccer_today(me);
  if p_steps is not null and p_steps between 0 and 150000 then
    insert into public.chess_claims (user_id, day, steps) values (me, today, p_steps)
    on conflict (user_id, day) do update set steps = greatest(public.chess_claims.steps, excluded.steps);
  end if;
  day_no := today - public.soccer_first_day(c) + 1;
  if joined then
    insert into public.longshot_players (challenge_id, user_id) values (p_challenge_id, me) on conflict do nothing;
  end if;
  if day_no between 1 and c.duration_days and c.score_settled_at is null and joined then
    d := public.longshot_day_row(p_challenge_id, me, today);
  end if;
  select * into p from public.longshot_players where challenge_id = p_challenge_id and user_id = me;
  steps := public.chess_steps(me, today);
  wmin := public.chess_workout_min(me, today);
  from_steps := least(s.max_rounds, steps / s.steps_per_round);
  select count(*)::int into n from public.challenge_participants cp where cp.challenge_id = p_challenge_id;
  pool := public.longshot_pool(p_challenge_id);
  select 1 + count(*) into my_rank from public.longshot_players x where x.challenge_id = p_challenge_id and x.points > coalesce(p.points, 0);
  places_w := (select coalesce(sum(public.longshot_place_weight(i)), 0) from generate_series(1, least(n, 10)) i);
  rest_n := greatest(0, n - 10);
  w_total := places_w + case when rest_n > 0 then 12 else 0 end;
  cond := public.longshot_conditions(p_challenge_id, today);
  world := cond ->> 'world';
  game_steps := case when joined then public.longshot_game_steps(p_challenge_id, me) else 0 end;

  with ranked as (
    select x.user_id, x.points, x.hits, x.shots, x.longest, rank() over (order by x.points desc) as rnk,
           row_number() over (order by x.points desc, x.longest desc, x.updated_at, x.user_id) as rn
    from public.longshot_players x where x.challenge_id = p_challenge_id
  ),
  mine as (select rn from ranked where user_id = me)
  select coalesce(jsonb_agg(jsonb_build_object('rank', r.rnk, 'tied', (select count(*) from ranked y where y.rnk = r.rnk) > 1,
           'userId', r.user_id, 'name', public.horse_name(r.user_id), 'points', r.points, 'hits', r.hits, 'shots', r.shots,
           'longest', r.longest, 'me', r.user_id = me) order by r.rn), '[]'::jsonb)
    into board
  from ranked r
  where r.rn <= 10 or abs(r.rn - coalesce((select rn from mine), -100)) <= 1;

  select coalesce(jsonb_agg(jsonb_build_object('dist', x.dist, 'size', x.size, 'pts', x.pts,
           'gold', (cond ->> 'bounty')::boolean and x.dist = (cond ->> 'gold')::int,
           'hitToday', exists (select 1 from public.longshot_shots y where y.challenge_id = p_challenge_id and y.user_id = me
                                and y.day = today and y.dist = x.dist and y.hit)) order by x.dist), '[]'::jsonb)
    into plates
  from public.longshot_plates((cond ->> 'far')::int, world) x;

  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'bullet', k.bullet, 'barrels', to_jsonb(k.barrels),
           'refBarrel', k.ref_barrel, 'unlockSteps', k.unlock_steps, 'unlocked', k.unlock_steps <= game_steps,
           'mv', k.mv, 'fpsInch', k.fps_inch, 'sway', k.sway,
           'at1000', jsonb_build_object('drop', round((public.longshot_book_get(k.id, k.ref_barrel, 'earth', 1000)).drop_mil::numeric, 1),
                       'wind10', round(((public.longshot_book_get(k.id, k.ref_barrel, 'earth', 1000)).lag * 4.4704 / 914.4 * 1000)::numeric, 1)),
           'drops', (select jsonb_agg(round((public.longshot_book_get(k.id, k.ref_barrel, 'earth', dd)).drop_mil::numeric, 1) order by dd)
                     from unnest(array[300, 600, 1000, 1500, 2000, 2500, 3000]) dd),
           'subsonicAt', (select min(dd) from unnest(array[300, 600, 1000, 1500, 2000, 2500, 3000]) dd
                          where (public.longshot_book_get(k.id, k.ref_barrel, 'earth', dd)).v_end < 1125))
           order by k.sort), '[]'::jsonb)
    into rifles
  from public.longshot_calibers k;

  if p.user_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('dist', x.dist,
             'elev', round(public.longshot_dial(me, p.caliber, p.barrel, cond ->> 'place', world, x.dist)::numeric, 1),
             'book', round((public.longshot_book_get(p.caliber, p.barrel, world, x.dist)).drop_mil::numeric, 1),
             'learned', exists (select 1 from public.longshot_cards k where k.user_id = me and k.caliber = p.caliber and k.barrel = p.barrel
                                  and k.place = cond ->> 'place' and k.world = world and k.dist = x.dist),
             'wind10', round(((public.longshot_book_get(p.caliber, p.barrel, world, x.dist)).lag * 4.4704 / (x.dist * 0.9144) * 1000)::numeric, 2),
             'tof', round((public.longshot_book_get(p.caliber, p.barrel, world, x.dist)).tof::numeric, 2)) order by x.dist), '[]'::jsonb)
      into card
    from public.longshot_plates((cond ->> 'far')::int, world) x;
  end if;

  return jsonb_build_object(
    'settings', jsonb_build_object('stepsPerRound', s.steps_per_round, 'maxRounds', s.max_rounds, 'carryMax', s.carry_max,
                  'workoutMin', s.workout_min, 'coldBore', s.cold_bore, 'bountyBones', s.bounty_bones, 'finishDays', s.finish_days),
    'name', c.name,
    'isGlobal', c.is_global,
    'dayNo', day_no,
    'days', c.duration_days,
    'endsAt', c.ends_at,
    'over', c.score_settled_at is not null or day_no > c.duration_days,
    'players', n,
    'pool', pool,
    'prizes', jsonb_build_object(
      'places', (select coalesce(jsonb_agg(case when w_total > 0 then floor(pool * public.longshot_place_weight(i)::numeric / w_total)::int else 0 end order by i), '[]'::jsonb)
                 from generate_series(1, least(n, 10)) i),
      'rest', case when rest_n > 0 then floor(pool * 12::numeric / w_total)::int end,
      'restMin', s.finish_min_bones),
    'conditions', cond,
    'goldTaker', (select jsonb_build_object('name', public.horse_name(b.user_id), 'me', b.user_id = me, 'dist', b.dist, 'bones', b.bones)
                  from public.longshot_bounties b where b.challenge_id = p_challenge_id and b.day = today),
    'plates', plates,
    'rifles', rifles,
    'card', coalesce(card, '[]'::jsonb),
    'me', jsonb_build_object('joined', joined, 'points', coalesce(p.points, 0), 'rank', my_rank, 'hits', coalesce(p.hits, 0),
            'shots', coalesce(p.shots, 0), 'longest', coalesce(p.longest, 0), 'caliber', coalesce(p.caliber, '65'),
            'barrel', coalesce(p.barrel, 24), 'gameSteps', game_steps,
            'shotDays', (select count(distinct x.day) from public.longshot_shots x where x.challenge_id = p_challenge_id and x.user_id = me)),
    'today', jsonb_build_object('steps', steps, 'fromSteps', from_steps, 'workoutMin', wmin, 'steady', wmin >= s.workout_min,
               'carried', coalesce(d.carried_in, 0), 'used', coalesce(d.used, 0),
               'left', case when d.challenge_id is null then 0 else greatest(0, d.carried_in - d.used + public.longshot_granted(me, today)) end,
               'nextAt', case when from_steps >= s.max_rounds then null else (from_steps + 1) * s.steps_per_round end),
    'board', board,
    'feed', coalesce((select jsonb_agg(jsonb_build_object('name', public.horse_name(x.user_id), 'dist', x.dist, 'center', x.center,
                        'gold', x.bounty, 'points', x.points, 'at', x.created_at) order by x.created_at desc)
                      from (select * from public.longshot_shots x where x.challenge_id = p_challenge_id and x.hit and x.dist >= 1500
                            and x.created_at > now() - interval '1 day' order by x.created_at desc limit 5) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('dist', x.dist, 'hit', x.hit, 'center', x.center, 'points', x.points,
                          'xIn', x.impact_x, 'yIn', x.impact_y, 'at', x.created_at) order by x.created_at desc)
                        from (select * from public.longshot_shots x where x.challenge_id = p_challenge_id and x.user_id = me
                              order by x.created_at desc limit 6) x), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.longshot_state(uuid, int) from public, anon;
grant execute on function public.longshot_state(uuid, int) to authenticated;

-- ── The evening nudge ──

create or replace function public.longshot_push()
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
    where c.kind::text = 'longshot' and c.score_settled_at is null
      and public.soccer_today(cp.user_id) - public.soccer_first_day(c) + 1 between 1 and c.duration_days
      and not exists (select 1 from public.longshot_shots s where s.challenge_id = cp.challenge_id and s.user_id = cp.user_id and s.day = public.soccer_today(cp.user_id))
  loop
    left_now := public.longshot_left(r.challenge_id, r.user_id, public.soccer_today(r.user_id));
    if not exists (select 1 from public.longshot_days d where d.challenge_id = r.challenge_id and d.user_id = r.user_id and d.day = public.soccer_today(r.user_id)) then
      left_now := left_now + least((select s.carry_max from public.longshot_settings s),
                                   public.longshot_left(r.challenge_id, r.user_id, public.soccer_today(r.user_id) - 1));
    end if;
    if left_now >= 3 then
      perform public.longshot_notify(r.challenge_id, r.user_id, r.name, 'Your steps have earned ' || left_now || ' rounds. The range is open.');
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.longshot_push() from public, anon, authenticated;
select cron.schedule('hound-longshot-evening', '41 23 * * *', $$ select public.longshot_push(); $$);

-- ── The payout ──

create or replace function public.longshot_payout(p_challenge_id uuid)
returns table (user_id uuid, score int, bones int)
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_column
declare
  c public.challenges%rowtype;
  s public.longshot_settings%rowtype;
  pool int;
  need int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into s from public.longshot_settings;
  pool := public.longshot_pool(p_challenge_id);
  need := least(s.finish_days, c.duration_days);
  return query
  with p as (
    select cp.user_id, coalesce(lp.points, 0) as points,
           (select count(distinct x.day) from public.longshot_shots x where x.challenge_id = p_challenge_id and x.user_id = cp.user_id)::int as days
    from public.challenge_participants cp
    left join public.longshot_players lp on lp.challenge_id = cp.challenge_id and lp.user_id = cp.user_id
    where cp.challenge_id = p_challenge_id
  ),
  r as (select p.*, rank() over (order by p.points desc) as rnk from p where p.days > 0),
  w as (select r.*, public.longshot_place_weight(r.rnk::int) as pw, (r.rnk > 10 and r.days >= need) as rest from r),
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
revoke execute on function public.longshot_payout(uuid) from public, anon, authenticated;

-- ── Global: publish_global_challenge takes 'longshot' ──

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
  if p_kind::text not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly', 'doors', 'packs', 'golf', 'derby', 'shootout', 'titlebout', 'slots', 'longshot') then
    raise exception 'That kind of challenge can''t be global — pick Step Race, Daily Streak, Distance, Bingo, 75 Day, Journey, Accountability, Hound''opoly, Daily Doors, Pack Wars, Golf, the Home Run Derby, the Hound Shootout, the Title Bout, Paw Slots or Long Shot.';
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

-- ── Scoring (0242's, with Long Shot) ──

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

-- ── Admin → Overview → Games → Long Shot ──

create or replace function public.admin_longshot_overview()
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
    'games', (select count(*) from public.challenges c where c.kind::text = 'longshot'),
    'live', (select count(*) from public.challenges c where c.kind::text = 'longshot' and c.score_settled_at is null and now() < c.ends_at),
    'tried', (select count(distinct s.user_id) from public.longshot_shots s),
    'active7d', (select count(distinct s.user_id) from public.longshot_shots s where s.created_at > now() - interval '7 days'),
    'rounds7d', (select count(*) from public.longshot_shots s where s.created_at > now() - interval '7 days'),
    'hits7d', (select count(*) from public.longshot_shots s where s.hit and s.created_at > now() - interval '7 days'),
    'moon7d', (select count(*) from public.longshot_shots s where s.world = 'moon' and s.created_at > now() - interval '7 days'),
    'gold7d', (select count(*) from public.longshot_bounties b where b.created_at > now() - interval '7 days'),
    'goldBones', (select coalesce(sum(b.bones), 0) from public.longshot_bounties b),
    'plates', coalesce((
      select jsonb_agg(jsonb_build_object('dist', x.dist, 'shots', x.n, 'hits', x.h) order by x.dist)
      from (select s.dist, count(*) as n, count(*) filter (where s.hit) as h
            from public.longshot_shots s where s.world = 'earth' and s.created_at > now() - interval '7 days' group by s.dist) x
    ), '[]'::jsonb),
    'rifles', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.caliber, 'name', k.name, 'shots', x.n) order by x.n desc)
      from (select s.caliber, count(*) as n from public.longshot_shots s where s.created_at > now() - interval '7 days' group by s.caliber) x
      join public.longshot_calibers k on k.id = x.caliber
    ), '[]'::jsonb),
    'cards', (select count(distinct k.user_id) from public.longshot_cards k)
  );
end;
$$;
revoke execute on function public.admin_longshot_overview() from public, anon;
grant execute on function public.admin_longshot_overview() to authenticated;
