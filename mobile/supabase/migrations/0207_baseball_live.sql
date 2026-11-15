-- 0207: Baseball, take your own at-bats.
--
-- A game can be hands-on (Create's "Take my own at-bats"): then a joined
-- person bats during the day, live, pitch by pitch, against the other
-- side's pitcher. Steps decide how many at-bats you get (one per 3,000
-- steps, up to 3 a day) and how hard the pitcher is to hit (their steps
-- against yours); your timing decides the contact, and the server rolls
-- everything else with the engine's own odds. An at-bat taken by hand is
-- final at once, and waits in baseball_live_abs: the game uses it the
-- next time you come up in the batting order (tonight's inning, or a
-- later one when tonight's doesn't reach you). At most 3 wait at a time.
-- Bots, hands-off games and anyone who doesn't bat live play as before.
--
-- The numbers, tuned by simulation against the engine's rolled at-bat
-- (8,000 steps all round; a batter who swings at 90% of strikes and 30%
-- of balls; linear-weight runs):
--   pitches     changeup 30% (Power 15%, Finesse 45%); in the zone 50%
--               (Power 56%, Finesse 44%). Fastball 700 ms to the plate
--               x (1 - 0.3 x pressure) (Power x 0.93), 88 mph + 20 x
--               pressure (Power +3); changeup 1,000 ms, 80 mph. pressure
--               = clamp((pitcher - you) / the greater, 0, 0.5), steps so
--               far today.
--   a swing     |timing| within {barrel 27, solid 51, weak 81, foul 126}
--               ms x (1 - pressure), x 0.5 out of the zone; past that a
--               whiff. Contact still goes foul some of the time: barrel
--               20%, solid 35%, weak 65%.
--   in play     aim from the timing (under -15 ms pulled left, over 15
--               right). Home run: barrel hr x power (to 50%), solid 0.6 x
--               hr x power, weak none (hr = baseball_home_run_chance, at
--               least 3% with a strength bonus, as 0198). Length: the
--               engine's, barrel +1 base 30% of the time, weak a single.
--               Caught: the engine's catch chance (and game-day make) +
--               barrel 0, solid -0.05, weak +0.10, kept to 5% - 95%.
--   the result  timing error 60 ms: average .324 vs the engine's .274
--               (+18%), runs +16%, 8% strikeouts, 8% walks. 110 ms:
--               .243 (-11%), runs -9%, 27% strikeouts. Every swing
--               perfect: .358 (+31%), runs +38%. At 12,000 steps the
--               same within a point or two.
--
-- Run after 0206.

alter table public.baseball_games add column if not exists hands_on boolean not null default false;
alter table public.baseball_plays add column if not exists by_hand boolean not null default false;

create table public.baseball_live_abs (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  team text not null check (team in ('a', 'b')),
  -- The caller's at-bats in this game, from 1.
  n int not null check (n >= 1),
  -- The caller's day it was taken.
  day date not null,
  status text not null default 'open' check (status in ('open', 'done')),
  balls int not null default 0,
  strikes int not null default 0,
  pitches int not null default 0,
  result text check (result in ('strikeout', 'walk', 'home_run', 'single', 'double', 'triple', 'ground_out', 'fly_out')),
  contact text check (contact in ('barrel', 'solid', 'weak')),
  aim text check (aim in ('left', 'center', 'right')),
  fielder_pos text,
  -- In play: bases before a late throw (1 - 3), caught, and the late throw.
  len int,
  caught boolean,
  late boolean not null default false,
  timing_ms int,
  my_steps int,
  pitcher_id uuid,
  pitcher_steps int,
  -- Where the game used it.
  used_day date,
  used_inning int,
  used_half text,
  used_seq int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (challenge_id, user_id, n)
);
create index baseball_live_abs_waiting_idx on public.baseball_live_abs (challenge_id, user_id, n) where used_day is null;
create index baseball_live_abs_created_idx on public.baseball_live_abs (created_at);

create table public.baseball_live_pitches (
  ab_id uuid not null references public.baseball_live_abs (id) on delete cascade,
  pitch_no int not null check (pitch_no >= 1),
  kind text not null check (kind in ('fastball', 'changeup')),
  mph int not null,
  in_zone boolean not null,
  ms int not null,
  pressure double precision not null,
  -- Null until the swing (or the take).
  call text check (call in ('ball', 'strike', 'foul', 'whiff', 'in_play')),
  contact text check (contact in ('barrel', 'solid', 'weak')),
  timing_ms int,
  created_at timestamptz not null default now(),
  primary key (ab_id, pitch_no)
);
create index baseball_live_pitches_created_idx on public.baseball_live_pitches (created_at);

alter table public.baseball_live_abs enable row level security;
revoke all on public.baseball_live_abs from anon;
revoke insert, update, delete on public.baseball_live_abs from authenticated;
create policy "People can view their own Baseball at-bats"
  on public.baseball_live_abs for select to authenticated
  using (user_id = auth.uid());

alter table public.baseball_live_pitches enable row level security;
revoke all on public.baseball_live_pitches from anon;
revoke insert, update, delete on public.baseball_live_pitches from authenticated;
create policy "People can view their own Baseball pitches"
  on public.baseball_live_pitches for select to authenticated
  using (exists (select 1 from public.baseball_live_abs a where a.id = baseball_live_pitches.ab_id and a.user_id = auth.uid()));

-- ── Setting up: p_hands_on (0167's, with "Take my own at-bats") ──

drop function if exists public.baseball_setup(uuid, jsonb);
create or replace function public.baseball_setup(p_challenge_id uuid, p_players jsonb, p_hands_on boolean default false)
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

  insert into public.baseball_games (challenge_id, innings, home_team, hands_on)
    values (p_challenge_id, c.duration_days,
      case when public.baseball_rand(p_challenge_id::text || ':toss') < 0.5 then 'a' else 'b' end, coalesce(p_hands_on, false))
    on conflict (challenge_id) do update set innings = excluded.innings, hands_on = excluded.hands_on, updated_at = now();

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

revoke execute on function public.baseball_setup(uuid, jsonb, boolean) from public, anon;
grant execute on function public.baseball_setup(uuid, jsonb, boolean) to authenticated;

-- ── The numbers (see the header) ──

create or replace function public.baseball_live_pressure(p_pitcher numeric, p_mine numeric)
returns double precision
language sql
immutable
as $$
  select least(0.5, greatest(0, (coalesce(p_pitcher, 0) - coalesce(p_mine, 0)) / greatest(coalesce(p_pitcher, 0), coalesce(p_mine, 0), 1)))::double precision;
$$;

-- A band's edge in ms: barrel | solid | weak | foul.
create or replace function public.baseball_live_band(p_band text, p_pressure double precision, p_in_zone boolean)
returns double precision
language sql
immutable
as $$
  select (case p_band when 'barrel' then 27 when 'solid' then 51 when 'weak' then 81 else 126 end)
    * (1 - coalesce(p_pressure, 0)) * case when p_in_zone then 1 else 0.5 end;
$$;

-- What a swing at p_timing_ms does before the foul roll: barrel, solid,
-- weak, foul or whiff.
create or replace function public.baseball_live_contact(p_timing_ms int, p_pressure double precision, p_in_zone boolean)
returns text
language sql
immutable
as $$
  select case
    when abs(p_timing_ms) <= public.baseball_live_band('barrel', p_pressure, p_in_zone) then 'barrel'
    when abs(p_timing_ms) <= public.baseball_live_band('solid', p_pressure, p_in_zone) then 'solid'
    when abs(p_timing_ms) <= public.baseball_live_band('weak', p_pressure, p_in_zone) then 'weak'
    when abs(p_timing_ms) <= public.baseball_live_band('foul', p_pressure, p_in_zone) then 'foul'
    else 'whiff'
  end;
$$;

-- How often contact still goes foul, and how it moves the catch.
create or replace function public.baseball_live_foul_share(p_contact text)
returns double precision
language sql
immutable
as $$
  select case p_contact when 'barrel' then 0.20 when 'solid' then 0.35 when 'weak' then 0.65 else 0 end::double precision;
$$;

create or replace function public.baseball_live_catch_mod(p_contact text)
returns double precision
language sql
immutable
as $$
  select case p_contact when 'barrel' then 0 when 'solid' then -0.05 when 'weak' then 0.10 else 0 end::double precision;
$$;

create or replace function public.baseball_pos_name(p_pos text)
returns text
language sql
immutable
as $$
  select case p_pos
    when 'p' then 'pitcher' when 'c' then 'catcher' when '1b' then 'first baseman' when '2b' then 'second baseman'
    when 'ss' then 'shortstop' when '3b' then 'third baseman' when 'lf' then 'left fielder' when 'cf' then 'center fielder'
    else 'right fielder' end;
$$;

grant execute on function public.baseball_live_pressure(numeric, numeric) to authenticated;
grant execute on function public.baseball_live_band(text, double precision, boolean) to authenticated;
grant execute on function public.baseball_live_contact(int, double precision, boolean) to authenticated;
revoke execute on function public.baseball_live_foul_share(text) from public, anon, authenticated;
revoke execute on function public.baseball_live_catch_mod(text) from public, anon, authenticated;
revoke execute on function public.baseball_pos_name(text) from public, anon, authenticated;

-- ── Where a person stands today ──

create or replace function public.baseball_live_state(p_challenge_id uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.baseball_games%rowtype;
  me public.baseball_players%rowtype;
  ft text;
  today date;
  first_day date;
  mine int := 0;
  pitcher uuid;
  catcher uuid;
  ps int := 0;
  approach text;
  shift text;
  pressure double precision := 0;
  bn record;
  earned int := 0;
  taken int := 0;
  waiting int := 0;
  ready int := 0;
  next_at int;
  o public.baseball_live_abs%rowtype;
  pend public.baseball_live_pitches%rowtype;
  open_j jsonb;
  abs_j jsonb := '[]'::jsonb;
  reason text;
  gdm double precision := coalesce((select cf.game_day_make from public.sport_bonus_config cf limit 1), 0);
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.baseball_games where challenge_id = p_challenge_id;
  if c.id is null or g.challenge_id is null then
    raise exception 'not authorized';
  end if;
  today := public.soccer_today(p_user);
  first_day := public.soccer_first_day(c);
  select * into me from public.baseball_players p where p.challenge_id = p_challenge_id and p.user_id = p_user and p.joined;

  if me.id is not null then
    ft := case when me.team = 'a' then 'b' else 'a' end;
    mine := public.baseball_steps(p_challenge_id, me.player_id, today, first_day);
    pitcher := public.baseball_holder(p_challenge_id, ft, 'p');
    catcher := public.baseball_holder(p_challenge_id, ft, 'c');
    ps := public.baseball_steps(p_challenge_id, pitcher, today, first_day);
    approach := (public.baseball_pick_of(p_challenge_id, today, pitcher)).approach;
    shift := (public.baseball_pick_of(p_challenge_id, today, catcher)).shift;
    pressure := public.baseball_live_pressure(ps, mine);
    select * into bn from public.sport_day_bonus(p_user, today, 'baseball');
    earned := least(3, floor(mine::numeric / 3000))::int;
    next_at := case when earned < 3 then (earned + 1) * 3000 end;
    select count(*) filter (where a.day = today), count(*) filter (where a.used_day is null)
      into taken, waiting
      from public.baseball_live_abs a where a.challenge_id = p_challenge_id and a.user_id = p_user;
    ready := greatest(0, least(earned - taken, 3 - waiting));

    select * into o from public.baseball_live_abs a
      where a.challenge_id = p_challenge_id and a.user_id = p_user and a.status = 'open' order by a.n limit 1;
    if o.id is not null then
      select * into pend from public.baseball_live_pitches lp where lp.ab_id = o.id and lp.call is null order by lp.pitch_no desc limit 1;
      open_j := jsonb_build_object('ab', o.n, 'pitch_no', o.pitches, 'balls', o.balls, 'strikes', o.strikes,
        'pending', case when pend.ab_id is not null then
          jsonb_build_object('kind', pend.kind, 'mph', pend.mph, 'in_zone', pend.in_zone, 'ms', pend.ms) end);
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'n', a.n, 'day', a.day, 'result', a.result, 'contact', a.contact, 'aim', a.aim, 'fielder_pos', a.fielder_pos,
        'late', a.late, 'pitches', a.pitches, 'used', a.used_day is not null, 'inning', a.used_inning) order by a.n), '[]'::jsonb)
      into abs_j
      from public.baseball_live_abs a
      where a.challenge_id = p_challenge_id and a.user_id = p_user and a.status = 'done'
        and (a.day = today or a.used_day is null);
  end if;

  reason := case
    when not g.hands_on then 'This game plays itself.'
    when me.id is null then 'You''re not playing in this game.'
    when g.status <> 'active' or today > first_day + g.innings + 2 then 'This game is over.'
    when today < first_day then 'The game hasn''t started yet.'
    when exists (select 1 from public.baseball_days bd where bd.challenge_id = p_challenge_id and bd.day = today)
      then 'Today''s inning is already played.'
    when o.id is not null then null
    when earned - taken <= 0 and taken >= 3 then 'That''s all your at-bats today.'
    when earned - taken <= 0 then 'No at-bats ready: your next one comes at ' || to_char(next_at, 'FM999,999,999') || ' steps.'
    when waiting >= 3 then '3 at-bats waiting for your turn in the order.'
  end;

  return jsonb_build_object(
    'hands_on', g.hands_on,
    'can_bat', reason is null,
    'reason', reason,
    'day', today,
    'inning', g.inning,
    'team', me.team,
    'steps', mine,
    'ab_steps', 3000,
    'earned', earned,
    'taken', taken,
    'waiting', waiting,
    'ready', ready,
    'next_at', next_at,
    'pitcher', case when pitcher is not null then jsonb_build_object(
      'name', coalesce((select case when pr.use_username and pr.username is not null then pr.username else pr.name end
                          from public.profiles pr where pr.id = pitcher),
                       (select b.name from public.challenge_bots b where b.id = pitcher), 'The pitcher'),
      'steps', ps) end,
    'pressure', round(pressure::numeric, 3),
    'bands', jsonb_build_object(
      'barrel', round(public.baseball_live_band('barrel', pressure, true)),
      'solid', round(public.baseball_live_band('solid', pressure, true)),
      'weak', round(public.baseball_live_band('weak', pressure, true)),
      'foul', round(public.baseball_live_band('foul', pressure, true))),
    'power', jsonb_build_object('strength', coalesce(bn.strength, 0), 'pw', 1 + 0.25 * coalesce(bn.strength, 0)),
    'open', open_j,
    'abs', abs_j,
    '_player', me.player_id,
    '_team', me.team,
    '_ft', ft,
    '_first_day', first_day,
    '_pitcher', pitcher,
    '_ps', ps,
    '_approach', approach,
    '_shift', shift,
    '_open', o.id,
    '_strength', coalesce(bn.strength, 0),
    '_gd', case when coalesce(bn.game_day, false) then gdm else 0 end
  );
end;
$$;
revoke execute on function public.baseball_live_state(uuid, uuid) from public, anon, authenticated;

create or replace function public.baseball_live(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null
     or (not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller)
         and not exists (select 1 from public.baseball_players p where p.challenge_id = p_challenge_id and p.user_id = caller)) then
    raise exception 'not authorized';
  end if;
  return public.baseball_live_state(p_challenge_id, caller)
    - array['_player', '_team', '_ft', '_first_day', '_pitcher', '_ps', '_approach', '_shift', '_open', '_strength', '_gd'];
end;
$$;
revoke execute on function public.baseball_live(uuid) from public, anon;
grant execute on function public.baseball_live(uuid) to authenticated;

-- ── A pitch ──
-- Opens an at-bat when none is open (it needs one ready), then throws the
-- next pitch. Asking again before the swing returns the same pitch.
create or replace function public.baseball_pitch(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  s jsonb;
  ab public.baseball_live_abs%rowtype;
  pend public.baseball_live_pitches%rowtype;
  mine int;
  ps int;
  approach text;
  pressure double precision;
  no int;
  seed text;
  change boolean;
  inz boolean;
  ms int;
  mph int;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  -- One pitch at a time, and not while the day is being played.
  perform 1 from public.challenges where id = p_challenge_id for share;
  perform 1 from public.baseball_players bp where bp.challenge_id = p_challenge_id and bp.user_id = caller for update;

  s := public.baseball_live_state(p_challenge_id, caller);
  if not (s ->> 'can_bat')::boolean then
    raise exception '%', s ->> 'reason';
  end if;

  if s ->> '_open' is not null then
    select * into ab from public.baseball_live_abs where id = (s ->> '_open')::uuid;
    select * into pend from public.baseball_live_pitches lp where lp.ab_id = ab.id and lp.call is null order by lp.pitch_no desc limit 1;
    if pend.ab_id is not null then
      return jsonb_build_object('ab', ab.n, 'pitch_no', pend.pitch_no, 'kind', pend.kind, 'mph', pend.mph, 'in_zone', pend.in_zone,
        'ms', pend.ms, 'balls', ab.balls, 'strikes', ab.strikes,
        'bands', jsonb_build_object(
          'barrel', round(public.baseball_live_band('barrel', pend.pressure, pend.in_zone)),
          'solid', round(public.baseball_live_band('solid', pend.pressure, pend.in_zone)),
          'weak', round(public.baseball_live_band('weak', pend.pressure, pend.in_zone)),
          'foul', round(public.baseball_live_band('foul', pend.pressure, pend.in_zone))));
    end if;
  else
    insert into public.baseball_live_abs (challenge_id, user_id, team, n, day)
      values (p_challenge_id, caller, s ->> '_team',
        coalesce((select max(a.n) from public.baseball_live_abs a where a.challenge_id = p_challenge_id and a.user_id = caller), 0) + 1,
        (s ->> 'day')::date)
      returning * into ab;
  end if;

  mine := (s ->> 'steps')::int;
  ps := (s ->> '_ps')::int;
  approach := s ->> '_approach';
  pressure := public.baseball_live_pressure(ps, mine);
  no := ab.pitches + 1;
  seed := p_challenge_id::text || ':' || caller || ':live:' || ab.n || ':' || no;
  change := public.baseball_rand(seed || ':change') < case approach when 'power' then 0.15 when 'finesse' then 0.45 else 0.30 end;
  inz := public.baseball_rand(seed || ':zone') < case approach when 'power' then 0.56 when 'finesse' then 0.44 else 0.50 end;
  if change then
    ms := 1000;
    mph := 80;
  else
    ms := round(700 * (1 - 0.3 * pressure) * case when approach = 'power' then 0.93 else 1 end)::int;
    mph := round(88 + 20 * pressure)::int + case when approach = 'power' then 3 else 0 end;
  end if;

  insert into public.baseball_live_pitches (ab_id, pitch_no, kind, mph, in_zone, ms, pressure)
    values (ab.id, no, case when change then 'changeup' else 'fastball' end, mph, inz, ms, pressure);
  update public.baseball_live_abs set pitches = no, my_steps = mine, pitcher_id = (s ->> '_pitcher')::uuid, pitcher_steps = ps,
    updated_at = now() where id = ab.id;

  return jsonb_build_object('ab', ab.n, 'pitch_no', no, 'kind', case when change then 'changeup' else 'fastball' end, 'mph', mph,
    'in_zone', inz, 'ms', ms, 'balls', ab.balls, 'strikes', ab.strikes,
    'bands', jsonb_build_object(
      'barrel', round(public.baseball_live_band('barrel', pressure, inz)),
      'solid', round(public.baseball_live_band('solid', pressure, inz)),
      'weak', round(public.baseball_live_band('weak', pressure, inz)),
      'foul', round(public.baseball_live_band('foul', pressure, inz))));
end;
$$;
revoke execute on function public.baseball_pitch(uuid) from public, anon;
grant execute on function public.baseball_pitch(uuid) to authenticated;

-- ── A swing ──
-- p_timing_ms: when you swung minus when the ball reached the zone (−
-- early, + late); null when you took it.
create or replace function public.baseball_swing(p_challenge_id uuid, p_timing_ms int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  caller uuid := auth.uid();
  s jsonb;
  ab public.baseball_live_abs%rowtype;
  pend public.baseball_live_pitches%rowtype;
  t int;
  seed text;
  call text;
  contact text;
  balls int;
  strikes int;
  done boolean := false;
  res text;
  aim text;
  fpos text;
  fid uuid;
  fs int;
  mine int;
  approach text;
  shift text;
  strength int;
  pw double precision;
  hr double precision;
  hrc double precision;
  len int;
  caught boolean;
  late boolean := false;
  msg text;
  first_day date;
  today date;
  edge text;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  perform 1 from public.challenges where id = p_challenge_id for share;
  perform 1 from public.baseball_players bp where bp.challenge_id = p_challenge_id and bp.user_id = caller for update;

  s := public.baseball_live_state(p_challenge_id, caller);
  if s ->> '_open' is null then
    raise exception 'Pitch first.';
  end if;
  select * into ab from public.baseball_live_abs where id = (s ->> '_open')::uuid;
  select * into pend from public.baseball_live_pitches lp where lp.ab_id = ab.id and lp.call is null order by lp.pitch_no desc limit 1;
  if pend.ab_id is null then
    raise exception 'Pitch first.';
  end if;
  if not (s ->> 'can_bat')::boolean then
    raise exception '%', s ->> 'reason';
  end if;

  t := case when p_timing_ms is null then null else least(1000, greatest(-1000, p_timing_ms)) end;
  edge := case when t < 0 then 'early' else 'late' end;
  seed := p_challenge_id::text || ':' || caller || ':live:' || ab.n || ':' || pend.pitch_no;
  balls := ab.balls;
  strikes := ab.strikes;

  if t is null then
    call := case when pend.in_zone then 'strike' else 'ball' end;
  else
    contact := public.baseball_live_contact(t, pend.pressure, pend.in_zone);
    if contact in ('barrel', 'solid', 'weak') and public.baseball_rand(seed || ':foul') < public.baseball_live_foul_share(contact) then
      contact := 'foul';
    end if;
    call := case contact when 'foul' then 'foul' when 'whiff' then 'whiff' else 'in_play' end;
    if call <> 'in_play' then
      contact := null;
    end if;
  end if;

  if call = 'ball' then
    balls := balls + 1;
    if balls >= 4 then
      done := true; res := 'walk'; msg := 'Ball four: take your base.';
    else
      msg := 'Good eye.';
    end if;
  elsif call = 'strike' then
    strikes := strikes + 1;
    if strikes >= 3 then
      done := true; res := 'strikeout'; msg := 'Strike three.';
    else
      msg := 'It caught the zone.';
    end if;
  elsif call = 'whiff' then
    strikes := strikes + 1;
    if strikes >= 3 then
      done := true; res := 'strikeout'; msg := 'Strike three, swinging.';
    else
      msg := 'Missed it: you swung ' || edge || '.';
    end if;
  elsif call = 'foul' then
    if strikes < 2 then
      strikes := strikes + 1;
    elsif pend.pitch_no >= 10 then
      strikes := 3;
      done := true; res := 'strikeout'; msg := 'Foul tip, caught: strike three.';
    end if;
    if msg is null then
      msg := case when abs(t) <= 15 then 'Fouled straight back.' else 'Foul: close, but a little ' || edge || '.' end;
    end if;
  else
    -- In play, by the engine's odds (0167, 0198) and the contact.
    done := true;
    first_day := (s ->> '_first_day')::date;
    today := (s ->> 'day')::date;
    mine := (s ->> 'steps')::int;
    approach := s ->> '_approach';
    shift := s ->> '_shift';
    strength := (s ->> '_strength')::int;
    pw := 1 + 0.25 * strength;
    aim := case when t < -15 then 'left' when t > 15 then 'right' else 'center' end;
    hr := public.baseball_home_run_chance(mine, approach);
    if strength > 0 then
      hr := greatest(hr, 0.03);
    end if;
    hrc := case contact when 'barrel' then least(0.5, hr * pw) when 'solid' then 0.6 * hr * pw else 0 end;
    if public.baseball_rand(seed || ':hr') < hrc then
      res := 'home_run';
      fpos := case aim when 'left' then 'lf' when 'center' then 'cf' else 'rf' end;
      caught := false;
      len := 4;
      msg := case when strength > 0 then 'Right on time, and your workout power put it over the wall.' else 'Right on time. Over the wall!' end;
    else
      len := public.baseball_hit_length(mine, approach, public.baseball_rand(seed || ':len') / pw);
      if contact = 'barrel' and public.baseball_rand(seed || ':up') < 0.3 then
        len := least(3, len + 1);
      elsif contact = 'weak' then
        len := 1;
      end if;
      if len = 1 then
        fpos := case aim
          when 'left' then case when public.baseball_rand(seed || ':inf') < 0.5 then '3b' else 'ss' end
          when 'center' then case when public.baseball_rand(seed || ':inf') < 0.5 then 'ss' else '2b' end
          else case when public.baseball_rand(seed || ':inf') < 0.5 then '2b' else '1b' end
        end;
      else
        fpos := case aim when 'left' then 'lf' when 'center' then 'cf' else 'rf' end;
      end if;
      fid := public.baseball_holder(p_challenge_id, s ->> '_ft', fpos);
      fs := public.baseball_steps(p_challenge_id, fid, today, first_day);
      caught := public.baseball_rand(seed || ':catch') < least(0.95, greatest(0.05,
        public.baseball_catch_chance(mine, fs, aim, shift) - (s ->> '_gd')::double precision + public.baseball_live_catch_mod(contact)));
      if caught then
        res := case when len = 1 then 'ground_out' else 'fly_out' end;
        msg := case
          when contact in ('barrel', 'solid') then 'Hit hard, right at the ' || public.baseball_pos_name(fpos) || '.'
          else 'Rolled over: a grounder to ' || case fpos when 'ss' then 'short' when '3b' then 'third' when '2b' then 'second' else 'first' end || '.'
        end;
      else
        late := fs * 4 < mine and public.baseball_rand(seed || ':late') < 0.10;
        res := case len + late::int when 1 then 'single' when 2 then 'double' when 3 then 'triple' else 'home_run' end;
        msg := case
          when res = 'home_run' then 'Around the bases: the throw comes in late!'
          when contact = 'barrel' and strength = 0 then 'Squared up. A strength workout adds power for home runs.'
          when len >= 2 then 'Barrel on it, into the gap.'
          when t < -15 then 'A little early, but it finds a hole.'
          when t > 15 then 'A little late, but it finds a hole.'
          else 'Right up the middle: a base hit.'
        end;
        if late and res <> 'home_run' then
          msg := msg || ' The throw comes in late: an extra base.';
        end if;
      end if;
    end if;
  end if;

  update public.baseball_live_pitches set call = call, contact = contact, timing_ms = t
    where ab_id = pend.ab_id and pitch_no = pend.pitch_no;
  update public.baseball_live_abs a set balls = balls, strikes = least(strikes, 3), updated_at = now(),
    status = case when done then 'done' else 'open' end,
    result = res, contact = contact, aim = aim, fielder_pos = fpos,
    len = case when res in ('walk', 'strikeout') then null when res = 'home_run' and not late then null else len end,
    caught = caught, late = late, timing_ms = t
  where a.id = ab.id;

  return jsonb_build_object(
    'call', call,
    'contact', contact,
    'balls', balls,
    'strikes', least(strikes, 3),
    'done', done,
    'result', case when res in ('home_run', 'single', 'double', 'triple', 'ground_out', 'fly_out')
      then jsonb_build_object('kind', res, 'aim', aim, 'fielder_pos', fpos, 'contact', contact, 'late', late)
      when res is not null then jsonb_build_object('kind', res, 'aim', null, 'fielder_pos', null, 'contact', null, 'late', false) end,
    'message', msg,
    'ready', case when done then greatest(0, least((s ->> 'earned')::int - (s ->> 'taken')::int, 3 - (s ->> 'waiting')::int)) else (s ->> 'ready')::int end,
    'waiting', (s ->> 'waiting')::int);
end;
$$;
revoke execute on function public.baseball_swing(uuid, int) from public, anon;
grant execute on function public.baseball_swing(uuid, int) to authenticated;

-- ── The inning: at-bats taken by hand first (0198's, plus 0207) ──

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
  -- 0207: at-bats taken by hand.
  hands boolean := coalesce((select g.hands_on from public.baseball_games g where g.challenge_id = p_challenge_id), false);
  lv public.baseball_live_abs%rowtype;
  bh boolean := false;
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
    bh := false;
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
        insert into public.baseball_plays (by_hand, challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, runner_id,
          outs, on_first, on_second, on_third, catcher_steps, runner_steps)
        values (bh, p_challenge_id, p_day, p_inning, p_half, seq, p_bat, case when ok then 'stolen_base' else 'caught_stealing' end, batter, pitcher, catcher, 'c', stealer,
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

    -- 0207: the batter's oldest at-bat taken by hand and still waiting is
    -- this one: its result stands, and the engine plays what follows.
    if hands then
      select * into lv from public.baseball_live_abs la
        where la.challenge_id = p_challenge_id and la.user_id = batter and la.status = 'done'
          and la.used_day is null and la.day <= p_day
        order by la.n limit 1
        for update;
      bh := found;
      if bh then
        update public.baseball_live_abs la set used_day = p_day, used_inning = p_inning, used_half = p_half, used_seq = seq, updated_at = now()
          where la.id = lv.id;
      end if;
    end if;

    pk := public.baseball_strikeout_chance(bs, ps, approach) - case when bb.game_day then gdm / 2 else 0 end;
    pbb := public.baseball_walk_chance(bs, ps, approach);
    x := public.baseball_rand(seed || ':pitch');

    if (bh and lv.result = 'strikeout') or (not bh and x < pk) then
      outs := outs + 1;
      insert into public.baseball_plays (by_hand, challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, outs, on_first, on_second, on_third, batter_steps, pitcher_steps)
        values (bh, p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'strikeout', batter, pitcher, outs, b1, b2, b3, bs, ps);
      continue;
    end if;

    if (bh and lv.result = 'walk') or (not bh and x < pk + pbb) then
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
      insert into public.baseball_plays (by_hand, challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, runs, outs, on_first, on_second, on_third, batter_steps, pitcher_steps)
        values (bh, p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'walk', batter, pitcher, scored, outs, b1, b2, b3, bs, ps);
      continue;
    end if;

    -- In play, where the batter aimed.
    aim := case when bh then lv.aim else coalesce(bpick.aim, zones[1 + floor(public.baseball_rand(seed || ':aim') * 3)::int]) end;

    if (bh and lv.result = 'home_run' and not lv.late) or (not bh and public.baseball_rand(seed || ':hr') < (case when bb.strength = 0 then public.baseball_home_run_chance(bs, approach)
                                                      else greatest(public.baseball_home_run_chance(bs, approach), 0.03) * pw end)) then
      scored := 1 + (b1 is not null)::int + (b2 is not null)::int + (b3 is not null)::int;
      b1 := null; b2 := null; b3 := null;
      v_runs := v_runs + scored;
      v_hits := v_hits + 1;
      insert into public.baseball_plays (by_hand, challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_pos, aim, shifted, runs, outs, on_first, on_second, on_third, batter_steps, pitcher_steps)
        values (bh, p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'home_run', batter, pitcher,
          case aim when 'left' then 'lf' when 'center' then 'cf' else 'rf' end, aim, shift = aim, scored, outs, b1, b2, b3, bs, ps);
      continue;
    end if;

    len := case when bh then lv.len else public.baseball_hit_length(bs, approach, public.baseball_rand(seed || ':len') / pw) end;
    if bh then
      fpos := lv.fielder_pos;
    elsif len = 1 then
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
    caught := case when bh then lv.caught
      else public.baseball_rand(seed || ':catch') < public.baseball_catch_chance(bs, fs, aim, shift) - case when bb.game_day then gdm else 0 end end;

    if caught then
      if len = 1 then
        if b1 is not null and outs < 2 then
          rs := public.baseball_steps(p_challenge_id, b1, p_day, p_first_day);
          if public.baseball_rand(seed || ':dp') < public.baseball_double_play_chance(fs, rs) then
            outs := outs + 2;
            runner := b1;
            b1 := null;
            insert into public.baseball_plays (by_hand, challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, runner_id, aim, shifted, outs, on_first, on_second, on_third, batter_steps, pitcher_steps, fielder_steps, runner_steps)
              values (bh, p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'double_play', batter, pitcher, fid, fpos, runner, aim, shift = aim, outs, b1, b2, b3, bs, ps, fs, rs);
            continue;
          end if;
        end if;
        outs := outs + 1;
        insert into public.baseball_plays (by_hand, challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, aim, shifted, outs, on_first, on_second, on_third, batter_steps, pitcher_steps, fielder_steps)
          values (bh, p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'ground_out', batter, pitcher, fid, fpos, aim, shift = aim, outs, b1, b2, b3, bs, ps, fs);
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
          insert into public.baseball_plays (by_hand, challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, aim, shifted, outs, on_first, on_second, on_third, batter_steps, pitcher_steps, fielder_steps)
            values (bh, p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'fly_out', batter, pitcher, fid, fpos, aim, shift = aim, outs - 1, b1, b2, runner, bs, ps, fs);
          seq := seq + 1;
          insert into public.baseball_plays (by_hand, challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, runner_id, outs, on_first, on_second, on_third, catcher_steps, runner_steps)
            values (bh, p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'out_at_home', batter, pitcher, catcher, 'c', runner, outs, b1, b2, b3, cs, rs);
        else
          v_runs := v_runs + 1;
          insert into public.baseball_plays (by_hand, challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, runner_id, aim, shifted, runs, outs, on_first, on_second, on_third, batter_steps, pitcher_steps, fielder_steps, catcher_steps, runner_steps)
            values (bh, p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'sac_fly', batter, pitcher, fid, fpos, runner, aim, shift = aim, 1, outs, b1, b2, b3, bs, ps, fs, cs, rs);
        end if;
        continue;
      end if;
      insert into public.baseball_plays (by_hand, challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, aim, shifted, outs, on_first, on_second, on_third, batter_steps, pitcher_steps, fielder_steps)
        values (bh, p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'fly_out', batter, pitcher, fid, fpos, aim, shift = aim, outs, b1, b2, b3, bs, ps, fs);
      continue;
    end if;

    -- A hit: the fielder got to it late.
    late := case when bh then lv.late else fs * 4 < bs and public.baseball_rand(seed || ':late') < 0.10 end;
    go := len + case when late then 1 else 0 end;
    v_hits := v_hits + 1;
    scored := 0;
    if go >= 4 then
      scored := 1 + (b1 is not null)::int + (b2 is not null)::int + (b3 is not null)::int;
      b1 := null; b2 := null; b3 := null;
      v_runs := v_runs + scored;
      insert into public.baseball_plays (by_hand, challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, aim, shifted, late_throw, runs, outs, on_first, on_second, on_third, batter_steps, pitcher_steps, fielder_steps)
        values (bh, p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'home_run', batter, pitcher, fid, fpos, aim, shift = aim, true, scored, outs, b1, b2, b3, bs, ps, fs);
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
    insert into public.baseball_plays (by_hand, challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, aim, shifted, late_throw, runs, outs, on_first, on_second, on_third, batter_steps, pitcher_steps, fielder_steps)
      values (bh, p_challenge_id, p_day, p_inning, p_half, seq, p_bat, case go when 1 then 'single' when 2 then 'double' else 'triple' end,
        batter, pitcher, fid, fpos, aim, shift = aim, late, scored, outs, b1, b2, b3, bs, ps, fs);

    if runner is not null and (p_need is null or v_runs < p_need) then
      seq := seq + 1;
      rs := public.baseball_steps(p_challenge_id, runner, p_day, p_first_day);
      if public.baseball_rand(seed || ':home') < public.baseball_tag_chance(cs, rs) then
        outs := outs + 1;
        insert into public.baseball_plays (by_hand, challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, runner_id, outs, on_first, on_second, on_third, catcher_steps, runner_steps)
          values (bh, p_challenge_id, p_day, p_inning, p_half, seq, p_bat, 'out_at_home', batter, pitcher, catcher, 'c', runner, outs, b1, b2, b3, cs, rs);
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

-- ── Admin (0167's, plus the at-bats taken by hand) ──

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
      'pickers_7d', (select count(distinct k.player_id) from public.baseball_picks k where k.updated_at > now() - interval '7 days'),
      -- 0207: at-bats taken by hand.
      'live', jsonb_build_object(
        'games_hands_on', (select count(*) from public.baseball_games g where g.hands_on and g.status = 'active'),
        'people_7d', (select count(distinct a.user_id) from public.baseball_live_abs a where a.created_at > now() - interval '7 days'),
        'at_bats_7d', (select count(*) from public.baseball_live_abs a where a.status = 'done' and a.created_at > now() - interval '7 days'),
        'pitches_7d', (select count(*) from public.baseball_live_pitches lp where lp.created_at > now() - interval '7 days'),
        'avg_7d', (select round(avg(case when a.result in ('single', 'double', 'triple', 'home_run') then 1.0 else 0.0 end), 3)
                   from public.baseball_live_abs a
                   where a.status = 'done' and a.result <> 'walk' and a.created_at > now() - interval '7 days'),
        'auto_avg_7d', (select round(avg(case when bp.kind in ('single', 'double', 'triple', 'home_run') then 1.0 else 0.0 end), 3)
                        from public.baseball_plays bp
                        join public.baseball_games g on g.challenge_id = bp.challenge_id and g.hands_on
                        where not bp.by_hand and bp.created_at > now() - interval '7 days'
                          and bp.kind in ('strikeout', 'single', 'double', 'triple', 'home_run', 'ground_out', 'fly_out', 'double_play', 'sac_fly')
                          and exists (select 1 from public.baseball_players p where p.challenge_id = bp.challenge_id and p.user_id = bp.batter_id)),
        'hr_7d', (select count(*) from public.baseball_live_abs a where a.result = 'home_run' and a.created_at > now() - interval '7 days')
      )
    )
  );
end;
$$;

revoke execute on function public.admin_baseball_overview() from public, anon;
grant execute on function public.admin_baseball_overview() to authenticated;
