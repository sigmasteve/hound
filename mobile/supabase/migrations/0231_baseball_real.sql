-- 0231: Baseball, for real: hit the ball, pitch to them, steal second
-- (approved mockup: claude.ai/artifact/HGso1dZWWMbsHBxMMfSxP5).
--
-- Batting (0207's at-bats, in a game made with "Take my own at-bats"):
--   the pitch   now crosses the plate somewhere: px across, py up and
--               down, in half-widths of the zone (the zone is |px| <= 1,
--               |py| <= 1). In the zone (0207's roll) anywhere within
--               0.85; out of it, 1.15 - 1.6 off one side. A third pitch,
--               the curveball, when it isn't a changeup: Power 15%,
--               Finesse 35%, else 25%; 880 ms x (1 - 0.2 x pressure), 76
--               mph + 8 x pressure, crossing in the low half.
--   the swing   baseball_swing(challenge, timing, tap_x, tap_y): where you
--               tapped, in the same units. d = the distance to the ball;
--               the first 0.2 is free, then each half-width costs 100 ms:
--               the contact bands (0207's) judge sqrt(timing^2 + (100 x
--               (d - 0.2))^2). Where it goes still comes from the timing.
--               The two-argument call (older apps) is d = 0, as before.
--   the cap     one at-bat per 3,000 steps, up to 6 a day (was 3), shared
--               with pitching. At most 3 of each waiting.
--
-- Pitching (new): any joined person on a hands-on side can take an
--   at-bat on the mound against the other side's next batter (the other
--   side's order, by how many the side has pitched). baseball_throw
--   (challenge, kind, aim_x, aim_y, ring): the pitch, where you aimed, and
--   how far the closing ring was from the circle when you let it go (0
--   right on it, 1 nowhere near). Off by more than 0.08: the ball misses
--   your spot by (ring - 0.08) x 1.4 in a seeded direction; over 0.45,
--   half the time it drifts over the middle instead. The batter swings at
--   72% in the zone (+12% with two strikes) and 30% out of it (+15% with
--   two strikes, +12% on a slower pitch after a fastball, less the
--   further off it is, 0.6 a half-width). Contact q = 0.72 x (1 - how
--   near the edge) in the zone, a chase 0 - 0.45; +0.18 the same pitch
--   again, -0.16 slower after a fastball, +0.25 x their step lead over
--   you (-0.5..0.5), -0.05 a low curve, plus -0.12..+0.22. Under 0.25 a
--   whiff, 0.45 foul, 0.62 weak, 0.82 solid, else barrel, then the
--   engine's odds in play (as a swing). The at-bat waits for that batter
--   and the inning uses it when they come up without one of their own.
--
-- Steals (new): baseball_steal_jump(challenge, jump_ms, slide), once a
--   day: how long after the pitcher's leg kick you went (negative: before
--   it, picked off) and the slide (perfect, early, late, none). If you're
--   the lead runner with the next base open tonight, you go: 0167's steal
--   chance + 0.20 for a jump within 200 ms, + 0.05 within 400, - 0.15
--   later; the slide + 0.05 / - 0.10 / - 0.05 / - 0.08; kept to 5 - 95%.
--
-- The Home Run Derby (0211): the meatball crosses somewhere near the
--   middle (within 0.45), and derby_swing(challenge, timing, tap_x, tap_y)
--   judges sqrt(timing^2 + (60 x (d - 0.2))^2) against 0211's bands.
--
-- Admin: admin_baseball_overview's live block adds pitching, jumps and
-- the tap.
--
-- Run after 0230.

alter table public.baseball_live_abs add column if not exists role text not null default 'bat' check (role in ('bat', 'pitch'));
alter table public.baseball_live_abs add column if not exists batter_id uuid;
alter table public.baseball_live_abs add column if not exists batter_steps int;
create index if not exists baseball_live_abs_pitched_idx on public.baseball_live_abs (challenge_id, team, batter_id, created_at)
  where role = 'pitch' and used_day is null;

alter table public.baseball_live_pitches drop constraint if exists baseball_live_pitches_kind_check;
alter table public.baseball_live_pitches add constraint baseball_live_pitches_kind_check check (kind in ('fastball', 'changeup', 'curveball'));
alter table public.baseball_live_pitches add column if not exists px double precision;
alter table public.baseball_live_pitches add column if not exists py double precision;
alter table public.baseball_live_pitches add column if not exists tap_x double precision;
alter table public.baseball_live_pitches add column if not exists tap_y double precision;
alter table public.baseball_live_pitches add column if not exists miss double precision;
-- On the mound: where you aimed, the ring, and whether they swung.
alter table public.baseball_live_pitches add column if not exists aim_x double precision;
alter table public.baseball_live_pitches add column if not exists aim_y double precision;
alter table public.baseball_live_pitches add column if not exists ring double precision;
alter table public.baseball_live_pitches add column if not exists swung boolean;

alter table public.baseball_plays add column if not exists steal_jump int;

create table public.baseball_steal_jumps (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  jump_ms int not null,
  slide text not null check (slide in ('perfect', 'early', 'late', 'none')),
  used_inning int,
  used_half text,
  safe boolean,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id, day)
);
create index baseball_steal_jumps_created_idx on public.baseball_steal_jumps (created_at);
alter table public.baseball_steal_jumps enable row level security;
revoke all on public.baseball_steal_jumps from anon;
revoke insert, update, delete on public.baseball_steal_jumps from authenticated;
create policy "People can view their own steal jumps"
  on public.baseball_steal_jumps for select to authenticated
  using (user_id = auth.uid());

alter table public.derby_swings add column if not exists px double precision;
alter table public.derby_swings add column if not exists py double precision;
alter table public.derby_swings add column if not exists tap_x double precision;
alter table public.derby_swings add column if not exists tap_y double precision;
alter table public.derby_swings add column if not exists miss double precision;

-- ── The numbers ──

-- What a swing's location costs, in ms: the first 0.2 of a half-width is
-- free.
create or replace function public.baseball_tap_ms(p_miss double precision)
returns double precision
language sql
immutable
as $$
  select 100 * greatest(0, coalesce(p_miss, 0) - 0.2);
$$;

-- A steal jump's push on the steal chance; null when you went early.
create or replace function public.baseball_jump_bonus(p_jump_ms int, p_slide text)
returns double precision
language sql
immutable
as $$
  select case when p_jump_ms < 0 then null else
    (case when p_jump_ms <= 200 then 0.20 when p_jump_ms <= 400 then 0.05 else -0.15 end)
    + case p_slide when 'perfect' then 0.05 when 'early' then -0.10 when 'late' then -0.05 else -0.08 end end::double precision;
$$;

create or replace function public.baseball_jump_grade(p_jump_ms int)
returns text
language sql
immutable
as $$
  select case when p_jump_ms < 0 then 'picked' when p_jump_ms <= 200 then 'great' when p_jump_ms <= 400 then 'good' else 'late' end;
$$;

-- Where a pitch crosses, in words.
create or replace function public.baseball_where(p_px double precision, p_py double precision)
returns text
language sql
immutable
as $$
  select case
    when p_py > 1 then 'high'
    when p_py < -1 then 'in the dirt'
    when p_px < -1 then 'off the plate away'
    when p_px > 1 then 'inside'
    when greatest(abs(p_px), abs(p_py)) < 0.4 then 'right down the middle'
    else (case when p_py > 0.33 then 'up' when p_py < -0.33 then 'low' else 'belt-high' end) || ' and '
      || (case when p_px < -0.33 then 'away' when p_px > 0.33 then 'inside' else 'over the middle' end)
      || case when greatest(abs(p_px), abs(p_py)) > 0.8 then ', on the black' else '' end end;
$$;

revoke execute on function public.baseball_tap_ms(double precision) from public, anon;
revoke execute on function public.baseball_jump_bonus(int, text) from public, anon;
revoke execute on function public.baseball_jump_grade(int) from public, anon;
revoke execute on function public.baseball_where(double precision, double precision) from public, anon;
grant execute on function public.baseball_tap_ms(double precision) to authenticated;
grant execute on function public.baseball_jump_bonus(int, text) to authenticated;
grant execute on function public.baseball_jump_grade(int) to authenticated;
grant execute on function public.baseball_where(double precision, double precision) to authenticated;

-- What stops you playing by hand today at all (the first reasons of
-- baseball_live_state).
create or replace function public.baseball_hand_reason(p_challenge_id uuid, p_user uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.baseball_games%rowtype;
  today date;
  first_day date;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.baseball_games where challenge_id = p_challenge_id;
  today := public.soccer_today(p_user);
  first_day := public.soccer_first_day(c);
  return case
    when g.challenge_id is null or not g.hands_on then 'This game plays itself.'
    when not exists (select 1 from public.baseball_players p where p.challenge_id = p_challenge_id and p.user_id = p_user and p.joined)
      then 'You''re not playing in this game.'
    when g.status <> 'active' or today > first_day + g.innings + 2 then 'This game is over.'
    when today < first_day then 'The game hasn''t started yet.'
    when exists (select 1 from public.baseball_days bd where bd.challenge_id = p_challenge_id and bd.day = today)
      then 'Today''s inning is already played.'
  end;
end;
$$;
revoke execute on function public.baseball_hand_reason(uuid, uuid) from public, anon, authenticated;

create or replace function public.baseball_player_name(p_challenge_id uuid, p_player uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select case when pr.use_username and pr.username is not null then pr.username else pr.name end
                     from public.profiles pr where pr.id = p_player),
                  (select b.name from public.challenge_bots b where b.id = p_player), 'The batter');
$$;
revoke execute on function public.baseball_player_name(uuid, uuid) from public, anon, authenticated;
-- ── Where a person stands today (0207's: 6 a day, both roles) ──

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
  pwaiting int := 0;
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
  select 0 as strength, false as game_day into bn;

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
    earned := least(6, floor(mine::numeric / 3000))::int;
    next_at := case when earned < 6 then (earned + 1) * 3000 end;
    -- 0231: the day's at-bats count both roles; each role keeps 3 waiting.
    select count(*) filter (where a.day = today), count(*) filter (where a.used_day is null and a.role = 'bat'),
        count(*) filter (where a.used_day is null and a.role = 'pitch')
      into taken, waiting, pwaiting
      from public.baseball_live_abs a where a.challenge_id = p_challenge_id and a.user_id = p_user;
    ready := greatest(0, least(earned - taken, 3 - waiting));

    select * into o from public.baseball_live_abs a
      where a.challenge_id = p_challenge_id and a.user_id = p_user and a.status = 'open' and a.role = 'bat' order by a.n limit 1;
    if o.id is not null then
      select * into pend from public.baseball_live_pitches lp where lp.ab_id = o.id and lp.call is null order by lp.pitch_no desc limit 1;
      open_j := jsonb_build_object('ab', o.n, 'pitch_no', o.pitches, 'balls', o.balls, 'strikes', o.strikes,
        'pending', case when pend.ab_id is not null then
          jsonb_build_object('kind', pend.kind, 'mph', pend.mph, 'in_zone', pend.in_zone, 'ms', pend.ms, 'px', pend.px, 'py', pend.py) end);
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'n', a.n, 'day', a.day, 'result', a.result, 'contact', a.contact, 'aim', a.aim, 'fielder_pos', a.fielder_pos,
        'late', a.late, 'pitches', a.pitches, 'used', a.used_day is not null, 'inning', a.used_inning) order by a.n), '[]'::jsonb)
      into abs_j
      from public.baseball_live_abs a
      where a.challenge_id = p_challenge_id and a.user_id = p_user and a.status = 'done' and a.role = 'bat'
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
    when earned - taken <= 0 and taken >= 6 then 'That''s all your at-bats today.'
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
    'pitched_waiting', pwaiting,
    'cap', 6,
    'steal_jump', (select jsonb_build_object('jump_ms', j.jump_ms, 'slide', j.slide, 'grade', public.baseball_jump_grade(j.jump_ms),
        'used', j.used_inning is not null, 'safe', j.safe)
      from public.baseball_steal_jumps j where j.challenge_id = p_challenge_id and j.user_id = p_user and j.day = today),
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

-- ── A pitch (0207's, with the curveball and where it crosses) ──

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
  curve boolean;
  kind text;
  side int;
  px double precision;
  py double precision;
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
        'ms', pend.ms, 'px', pend.px, 'py', pend.py, 'balls', ab.balls, 'strikes', ab.strikes,
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
  -- 0231: the curveball, and where the pitch crosses.
  curve := not change and public.baseball_rand(seed || ':curve') < case approach when 'power' then 0.15 when 'finesse' then 0.35 else 0.25 end;
  kind := case when change then 'changeup' when curve then 'curveball' else 'fastball' end;
  if inz then
    px := (public.baseball_rand(seed || ':px') * 2 - 1) * 0.85;
    py := (public.baseball_rand(seed || ':py') * 2 - 1) * 0.85;
    if curve then
      py := -0.05 - abs(py) * 0.9;
    end if;
  else
    side := floor(public.baseball_rand(seed || ':side') * 4)::int;
    px := (public.baseball_rand(seed || ':px') * 2 - 1) * 0.9;
    py := (public.baseball_rand(seed || ':py') * 2 - 1) * 0.9;
    if side = 0 then
      px := -(1.15 + 0.45 * public.baseball_rand(seed || ':off'));
    elsif side = 1 then
      px := 1.15 + 0.45 * public.baseball_rand(seed || ':off');
    elsif side = 2 and not curve then
      py := 1.15 + 0.4 * public.baseball_rand(seed || ':off');
    else
      py := -(1.15 + 0.45 * public.baseball_rand(seed || ':off'));
    end if;
  end if;
  if change then
    ms := 1000;
    mph := 80;
  elsif curve then
    ms := round(880 * (1 - 0.2 * pressure))::int;
    mph := round(76 + 8 * pressure)::int;
  else
    ms := round(700 * (1 - 0.3 * pressure) * case when approach = 'power' then 0.93 else 1 end)::int;
    mph := round(88 + 20 * pressure)::int + case when approach = 'power' then 3 else 0 end;
  end if;

  insert into public.baseball_live_pitches (ab_id, pitch_no, kind, mph, in_zone, ms, pressure, px, py)
    values (ab.id, no, kind, mph, inz, ms, pressure, round(px::numeric, 3), round(py::numeric, 3));
  update public.baseball_live_abs set pitches = no, my_steps = mine, pitcher_id = (s ->> '_pitcher')::uuid, pitcher_steps = ps,
    updated_at = now() where id = ab.id;

  return jsonb_build_object('ab', ab.n, 'pitch_no', no, 'kind', kind, 'mph', mph,
    'in_zone', inz, 'ms', ms, 'px', round(px::numeric, 3), 'py', round(py::numeric, 3), 'balls', ab.balls, 'strikes', ab.strikes,
    'bands', jsonb_build_object(
      'barrel', round(public.baseball_live_band('barrel', pressure, inz)),
      'solid', round(public.baseball_live_band('solid', pressure, inz)),
      'weak', round(public.baseball_live_band('weak', pressure, inz)),
      'foul', round(public.baseball_live_band('foul', pressure, inz))));
end;
$$;
revoke execute on function public.baseball_pitch(uuid) from public, anon;
grant execute on function public.baseball_pitch(uuid) to authenticated;

-- ── A swing (0207's, with where you tapped) ──

create or replace function public.baseball_swing(p_challenge_id uuid, p_timing_ms int, p_tap_x double precision, p_tap_y double precision)
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
  d double precision := 0;
  dpen double precision := 0;
  te int;
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
  -- 0231: where you swung, against where it crossed.
  if t is not null and p_tap_x is not null and p_tap_y is not null and pend.px is not null then
    d := sqrt(power(least(3, greatest(-3, p_tap_x)) - pend.px, 2) + power(least(3, greatest(-3, p_tap_y)) - pend.py, 2));
    dpen := public.baseball_tap_ms(d);
  end if;
  te := case when t is null then null else round(sqrt(power(t, 2) + power(dpen, 2)))::int end;
  seed := p_challenge_id::text || ':' || caller || ':live:' || ab.n || ':' || pend.pitch_no;
  balls := ab.balls;
  strikes := ab.strikes;

  if t is null then
    call := case when pend.in_zone then 'strike' else 'ball' end;
  else
    contact := public.baseball_live_contact(te, pend.pressure, pend.in_zone);
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

  if t is not null and dpen > abs(t) and not done and call in ('whiff', 'foul') then
    msg := case when call = 'whiff' then 'Swung over it: tap where the ball crosses.' else 'Got a piece: tap right on the ball.' end;
  end if;

  update public.baseball_live_pitches set call = call, contact = contact, timing_ms = t,
      tap_x = p_tap_x, tap_y = p_tap_y, miss = case when p_tap_x is null or t is null then null else d end
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
    'px', pend.px,
    'py', pend.py,
    'kind', pend.kind,
    'miss', case when p_tap_x is null or t is null then null else round(d::numeric, 2) end,
    'timing', t,
    'ready', case when done then greatest(0, least((s ->> 'earned')::int - (s ->> 'taken')::int, 3 - (s ->> 'waiting')::int)) else (s ->> 'ready')::int end,
    'waiting', (s ->> 'waiting')::int);
end;
$$;
revoke execute on function public.baseball_swing(uuid, int, double precision, double precision) from public, anon;
grant execute on function public.baseball_swing(uuid, int, double precision, double precision) to authenticated;

-- Older apps: timing only, as if right on the ball.
create or replace function public.baseball_swing(p_challenge_id uuid, p_timing_ms int)
returns jsonb
language sql
as $$
  select public.baseball_swing(p_challenge_id, p_timing_ms, null::double precision, null::double precision);
$$;
revoke execute on function public.baseball_swing(uuid, int) from public, anon;
grant execute on function public.baseball_swing(uuid, int) to authenticated;

-- ── In play, by the engine's odds (0207's swing, as a helper for the mound) ──
-- The batter's steps, the pitcher's approach, the catcher's shift, the
-- batter's strength and game day, the contact and where it went.
create or replace function public.baseball_live_in_play(
  p_challenge_id uuid, p_seed text, p_ft text, p_day date, p_first_day date, p_bsteps int,
  p_approach text, p_shift text, p_strength int, p_gd double precision, p_contact text, p_aim text
)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  pw double precision := 1 + 0.25 * coalesce(p_strength, 0);
  hr double precision;
  hrc double precision;
  len int;
  fpos text;
  fid uuid;
  fs int;
  caught boolean := false;
  late boolean := false;
  res text;
  msg text;
begin
  hr := public.baseball_home_run_chance(p_bsteps, p_approach);
  if coalesce(p_strength, 0) > 0 then
    hr := greatest(hr, 0.03);
  end if;
  hrc := case p_contact when 'barrel' then least(0.5, hr * pw) when 'solid' then 0.6 * hr * pw else 0 end;
  if public.baseball_rand(p_seed || ':hr') < hrc then
    return jsonb_build_object('res', 'home_run', 'fpos', case p_aim when 'left' then 'lf' when 'center' then 'cf' else 'rf' end,
      'len', null, 'caught', false, 'late', false, 'msg', 'They got all of it: over the wall.');
  end if;
  len := public.baseball_hit_length(p_bsteps, p_approach, public.baseball_rand(p_seed || ':len') / pw);
  if p_contact = 'barrel' and public.baseball_rand(p_seed || ':up') < 0.3 then
    len := least(3, len + 1);
  elsif p_contact = 'weak' then
    len := 1;
  end if;
  if len = 1 then
    fpos := case p_aim
      when 'left' then case when public.baseball_rand(p_seed || ':inf') < 0.5 then '3b' else 'ss' end
      when 'center' then case when public.baseball_rand(p_seed || ':inf') < 0.5 then 'ss' else '2b' end
      else case when public.baseball_rand(p_seed || ':inf') < 0.5 then '2b' else '1b' end
    end;
  else
    fpos := case p_aim when 'left' then 'lf' when 'center' then 'cf' else 'rf' end;
  end if;
  fid := public.baseball_holder(p_challenge_id, p_ft, fpos);
  fs := public.baseball_steps(p_challenge_id, fid, p_day, p_first_day);
  caught := public.baseball_rand(p_seed || ':catch') < least(0.95, greatest(0.05,
    public.baseball_catch_chance(p_bsteps, fs, p_aim, p_shift) - coalesce(p_gd, 0) + public.baseball_live_catch_mod(p_contact)));
  if caught then
    res := case when len = 1 then 'ground_out' else 'fly_out' end;
    msg := case when len = 1 then 'A grounder to your ' || public.baseball_pos_name(fpos) || ': out.'
      else 'A fly ball to your ' || public.baseball_pos_name(fpos) || ': out.' end;
  else
    late := fs * 4 < p_bsteps and public.baseball_rand(p_seed || ':late') < 0.10;
    res := case len + late::int when 1 then 'single' when 2 then 'double' when 3 then 'triple' else 'home_run' end;
    msg := case res when 'single' then 'A base hit off you.' when 'double' then 'Into the gap off you: a double.'
      when 'triple' then 'Off the wall: a triple.' else 'Around the bases: the throw comes in late.' end;
  end if;
  return jsonb_build_object('res', res, 'fpos', fpos, 'len', len, 'caught', caught, 'late', late, 'msg', msg);
end;
$$;
revoke execute on function public.baseball_live_in_play(uuid, text, text, date, date, int, text, text, int, double precision, text, text) from public, anon, authenticated;

-- ── On the mound: where a person stands ──

create or replace function public.baseball_mound_state(p_challenge_id uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  s jsonb;
  c public.challenges%rowtype;
  me public.baseball_players%rowtype;
  ft text;
  today date;
  first_day date;
  reason text;
  o public.baseball_live_abs%rowtype;
  opp uuid[];
  nb uuid;
  bs int := 0;
  mine int := 0;
  earned int;
  taken int;
  pwaiting int;
  last_kind text;
  abs_j jsonb := '[]'::jsonb;
begin
  s := public.baseball_live_state(p_challenge_id, p_user);
  select * into c from public.challenges where id = p_challenge_id;
  select * into me from public.baseball_players p where p.challenge_id = p_challenge_id and p.user_id = p_user and p.joined;
  today := (s ->> 'day')::date;
  first_day := public.soccer_first_day(c);
  earned := coalesce((s ->> 'earned')::int, 0);
  taken := coalesce((s ->> 'taken')::int, 0);
  pwaiting := coalesce((s ->> 'pitched_waiting')::int, 0);
  reason := public.baseball_hand_reason(p_challenge_id, p_user);

  if me.id is not null then
    ft := case when me.team = 'a' then 'b' else 'a' end;
    mine := public.baseball_steps(p_challenge_id, me.player_id, today, first_day);
    select * into o from public.baseball_live_abs a
      where a.challenge_id = p_challenge_id and a.user_id = p_user and a.role = 'pitch' and a.status = 'open' order by a.n limit 1;
    select array_agg(p.player_id order by p.seat) into opp
      from public.baseball_players p where p.challenge_id = p_challenge_id and p.team = ft and p.joined;
    if o.id is not null then
      nb := o.batter_id;
      select lp.kind into last_kind from public.baseball_live_pitches lp where lp.ab_id = o.id order by lp.pitch_no desc limit 1;
    elsif opp is not null then
      nb := opp[1 + ((select count(*) from public.baseball_live_abs a
                      where a.challenge_id = p_challenge_id and a.role = 'pitch' and a.team = me.team)::int % array_length(opp, 1))];
    end if;
    if nb is not null then
      bs := public.baseball_steps(p_challenge_id, nb, today, first_day);
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('n', a.n, 'result', a.result, 'batter', public.baseball_player_name(p_challenge_id, a.batter_id),
        'pitches', a.pitches, 'used', a.used_day is not null, 'inning', a.used_inning) order by a.n), '[]'::jsonb)
      into abs_j
      from public.baseball_live_abs a
      where a.challenge_id = p_challenge_id and a.user_id = p_user and a.role = 'pitch' and a.status = 'done'
        and (a.day = today or a.used_day is null);
  end if;

  if reason is null and o.id is null then
    reason := case
      when nb is null then 'The other side has no one to bat.'
      when earned - taken <= 0 and taken >= 6 then 'That''s all your at-bats today.'
      when earned - taken <= 0 then 'No at-bats ready: your next one comes at ' || to_char((s ->> 'next_at')::int, 'FM999,999,999') || ' steps.'
      when pwaiting >= 3 then '3 pitched at-bats waiting for their batters.'
    end;
  end if;

  return jsonb_build_object(
    'can_pitch', reason is null,
    'reason', reason,
    'day', today,
    'steps', mine,
    'earned', earned,
    'taken', taken,
    'ready', greatest(0, least(earned - taken, 3 - pwaiting)),
    'next_at', s -> 'next_at',
    'cap', 6,
    'waiting', pwaiting,
    'batter', case when nb is not null then jsonb_build_object('name', public.baseball_player_name(p_challenge_id, nb), 'steps', bs) end,
    'open', case when o.id is not null then jsonb_build_object('ab', o.n, 'pitch_no', o.pitches, 'balls', o.balls, 'strikes', o.strikes, 'last_kind', last_kind) end,
    'abs', abs_j,
    '_team', me.team,
    '_ft', ft,
    '_open', o.id,
    '_batter', nb,
    '_bs', bs,
    '_first_day', first_day
  );
end;
$$;
revoke execute on function public.baseball_mound_state(uuid, uuid) from public, anon, authenticated;

create or replace function public.baseball_mound(p_challenge_id uuid)
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
  return public.baseball_mound_state(p_challenge_id, caller) - array['_team', '_ft', '_open', '_batter', '_bs', '_first_day'];
end;
$$;
revoke execute on function public.baseball_mound(uuid) from public, anon;
grant execute on function public.baseball_mound(uuid) to authenticated;

-- ── A pitch you throw ──
-- p_kind fastball, curveball or changeup; p_aim_x, p_aim_y where you
-- aimed (zone half-widths); p_ring how far the ring was from the circle
-- when you let go (0 on it, 1 nowhere near). The batter answers it at
-- once; the at-bat waits for them in the order.
create or replace function public.baseball_throw(p_challenge_id uuid, p_kind text, p_aim_x double precision, p_aim_y double precision, p_ring double precision)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  caller uuid := auth.uid();
  m jsonb;
  ab public.baseball_live_abs%rowtype;
  me public.baseball_players%rowtype;
  today date;
  first_day date;
  no int;
  seed text;
  ring double precision;
  ax double precision;
  ay double precision;
  miss double precision;
  ang double precision;
  meat boolean := false;
  px double precision;
  py double precision;
  inz boolean;
  e double precision;
  mine int;
  bs int;
  k double precision;
  prev text;
  same boolean;
  slower boolean;
  swung boolean;
  q double precision;
  contact text;
  call text;
  balls int;
  strikes int;
  done boolean := false;
  res text;
  aim text;
  ip jsonb;
  msg text;
  grade text;
  approach text;
  shift text;
  bb record;
  gdm double precision := coalesce((select cf.game_day_make from public.sport_bonus_config cf limit 1), 0);
  mph int;
  ms int;
  bname text;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  perform 1 from public.challenges where id = p_challenge_id for share;
  perform 1 from public.baseball_players bp where bp.challenge_id = p_challenge_id and bp.user_id = caller for update;

  m := public.baseball_mound_state(p_challenge_id, caller);
  if not (m ->> 'can_pitch')::boolean then
    raise exception '%', m ->> 'reason';
  end if;
  if p_kind is null or p_kind not in ('fastball', 'curveball', 'changeup') then
    raise exception 'Pick a pitch: a fastball, a curveball or a changeup.';
  end if;
  select * into me from public.baseball_players p where p.challenge_id = p_challenge_id and p.user_id = caller and p.joined;
  today := (m ->> 'day')::date;
  first_day := (m ->> '_first_day')::date;

  if m ->> '_open' is not null then
    select * into ab from public.baseball_live_abs where id = (m ->> '_open')::uuid;
  else
    insert into public.baseball_live_abs (challenge_id, user_id, team, n, day, role, batter_id, batter_steps)
      values (p_challenge_id, caller, me.team,
        coalesce((select max(a.n) from public.baseball_live_abs a where a.challenge_id = p_challenge_id and a.user_id = caller), 0) + 1,
        today, 'pitch', (m ->> '_batter')::uuid, (m ->> '_bs')::int)
      returning * into ab;
  end if;

  no := ab.pitches + 1;
  seed := p_challenge_id::text || ':' || caller || ':mound:' || ab.n || ':' || no;
  ring := least(1, greatest(0, coalesce(p_ring, 1)));
  ax := least(1.8, greatest(-1.8, coalesce(p_aim_x, 0)));
  ay := least(1.8, greatest(-1.8, coalesce(p_aim_y, 0)));

  -- Where it goes: your spot, missed by the ring.
  miss := greatest(0, ring - 0.08) * 1.4;
  ang := public.baseball_rand(seed || ':ang') * 2 * pi();
  px := ax + cos(ang) * miss;
  py := ay + sin(ang) * miss;
  if ring > 0.45 and public.baseball_rand(seed || ':meat') < 0.5 then
    meat := true;
    px := ax * 0.25 + (public.baseball_rand(seed || ':mx') - 0.5) * 0.3;
    py := ay * 0.25 + (public.baseball_rand(seed || ':my') - 0.5) * 0.3;
  end if;
  px := least(2.2, greatest(-2.2, px));
  py := least(2.2, greatest(-2.2, py));
  inz := abs(px) <= 1 and abs(py) <= 1;
  e := greatest(abs(px), abs(py));
  grade := case when ring <= 0.08 then 'Painted it' when ring <= 0.2 then 'Close to your spot'
    when meat then 'Missed your spot, over the middle' else 'Missed your spot' end;

  -- The batter.
  mine := (m ->> 'steps')::int;
  bs := public.baseball_steps(p_challenge_id, ab.batter_id, today, first_day);
  k := least(0.5, greatest(-0.5, (bs - mine)::double precision / greatest(bs, mine, 1)));
  select lp.kind into prev from public.baseball_live_pitches lp where lp.ab_id = ab.id order by lp.pitch_no desc limit 1;
  same := prev = p_kind;
  slower := prev = 'fastball' and p_kind <> 'fastball';
  if inz then
    swung := public.baseball_rand(seed || ':swing') < 0.72 + case when ab.strikes = 2 then 0.12 else 0 end;
  else
    swung := public.baseball_rand(seed || ':swing') < 0.30 + case when ab.strikes = 2 then 0.15 else 0 end
      + case when slower then 0.12 else 0 end - (e - 1) * 0.6;
  end if;
  if swung then
    q := case when inz then (1 - e) * 0.72 else public.baseball_rand(seed || ':chase') * 0.45 end
      + case when same then 0.18 else 0 end - case when slower then 0.16 else 0 end + 0.25 * k
      - case when p_kind = 'curveball' and py < -0.4 then 0.05 else 0 end
      + public.baseball_rand(seed || ':q') * 0.34 - 0.12;
    contact := case when q < 0.25 then 'whiff' when q < 0.45 then 'foul' when q < 0.62 then 'weak' when q < 0.82 then 'solid' else 'barrel' end;
    call := case contact when 'whiff' then 'whiff' when 'foul' then 'foul' else 'in_play' end;
    if call <> 'in_play' then
      contact := null;
    end if;
  else
    call := case when inz then 'strike' else 'ball' end;
  end if;

  balls := ab.balls;
  strikes := ab.strikes;
  bname := public.baseball_player_name(p_challenge_id, ab.batter_id);
  if call = 'ball' then
    balls := balls + 1;
    if balls >= 4 then
      done := true; res := 'walk'; msg := 'Ball four: ' || bname || ' walks.';
    else
      msg := bname || ' laid off it: ball.';
    end if;
  elsif call = 'strike' then
    strikes := strikes + 1;
    if strikes >= 3 then
      done := true; res := 'strikeout'; msg := 'Caught looking: strike three!';
    else
      msg := 'Taken for a strike.';
    end if;
  elsif call = 'whiff' then
    strikes := strikes + 1;
    if strikes >= 3 then
      done := true; res := 'strikeout'; msg := 'Struck out swinging!';
    else
      msg := case when slower then 'Changing speeds fooled ' || bname || ': swing and a miss.' else 'Swing and a miss.' end;
    end if;
  elsif call = 'foul' then
    if strikes < 2 then
      strikes := strikes + 1;
    elsif no >= 10 then
      strikes := 3;
      done := true; res := 'strikeout'; msg := 'Foul tip, caught: strike three.';
    end if;
    if msg is null then
      msg := bname || ' fouled it off.';
    end if;
  else
    done := true;
    approach := (public.baseball_pick_of(p_challenge_id, today, caller)).approach;
    shift := (public.baseball_pick_of(p_challenge_id, today, public.baseball_holder(p_challenge_id, me.team, 'c'))).shift;
    select * into bb from public.sport_bonus_for(p_challenge_id, ab.batter_id, today, 'baseball');
    aim := (array['left', 'center', 'right'])[1 + floor(public.baseball_rand(seed || ':aim') * 3)::int];
    ip := public.baseball_live_in_play(p_challenge_id, seed, me.team, today, first_day, bs, approach, shift,
      coalesce(bb.strength, 0), case when coalesce(bb.game_day, false) then gdm else 0 end, contact, aim);
    res := ip ->> 'res';
    msg := ip ->> 'msg';
    if same and res in ('single', 'double', 'triple', 'home_run') then
      msg := msg || ' They''d seen that pitch: mix it up.';
    end if;
  end if;

  mph := case p_kind when 'fastball' then 88 + round(8 * greatest(0, -k) * 2)::int when 'curveball' then 76 else 82 end;
  ms := case p_kind when 'fastball' then 700 when 'curveball' then 880 else 1000 end;
  insert into public.baseball_live_pitches (ab_id, pitch_no, kind, mph, in_zone, ms, pressure, call, contact, px, py, aim_x, aim_y, ring, swung)
    values (ab.id, no, p_kind, mph, inz, ms, k, call, contact, px, py, ax, ay, ring, swung);
  update public.baseball_live_abs a set pitches = no, balls = balls, strikes = least(strikes, 3), updated_at = now(),
    status = case when done then 'done' else 'open' end,
    result = res, contact = contact, aim = aim,
    fielder_pos = ip ->> 'fpos',
    len = case when res in ('single', 'double', 'triple', 'ground_out', 'fly_out') or (res = 'home_run' and (ip ->> 'late')::boolean)
      then (ip ->> 'len')::int end,
    caught = (ip ->> 'caught')::boolean,
    late = coalesce((ip ->> 'late')::boolean, false),
    my_steps = mine, pitcher_id = caller, pitcher_steps = mine, batter_steps = bs
  where a.id = ab.id;

  return jsonb_build_object(
    'call', call,
    'kind', p_kind,
    'mph', mph,
    'px', round(px::numeric, 3),
    'py', round(py::numeric, 3),
    'in_zone', inz,
    'swung', swung,
    'contact', contact,
    'grade', grade,
    'where', public.baseball_where(px, py),
    'balls', balls,
    'strikes', least(strikes, 3),
    'done', done,
    'batter', bname,
    'result', case when res in ('home_run', 'single', 'double', 'triple', 'ground_out', 'fly_out')
      then jsonb_build_object('kind', res, 'aim', aim, 'fielder_pos', ip ->> 'fpos', 'contact', contact, 'late', coalesce((ip ->> 'late')::boolean, false))
      when res is not null then jsonb_build_object('kind', res, 'aim', null, 'fielder_pos', null, 'contact', null, 'late', false) end,
    'message', grade || '. ' || msg);
end;
$$;
revoke execute on function public.baseball_throw(uuid, text, double precision, double precision, double precision) from public, anon;
grant execute on function public.baseball_throw(uuid, text, double precision, double precision, double precision) to authenticated;

-- ── Your jump on a steal, once a day ──
-- p_jump_ms: how long after the leg kick you went (negative: before it,
-- and you're picked off). p_slide: perfect, early, late or none. Used
-- tonight if you're the lead runner with the next base open.
create or replace function public.baseball_steal_jump(p_challenge_id uuid, p_jump_ms int, p_slide text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  reason text;
  today date;
  j int;
  sl text;
  g text;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  reason := public.baseball_hand_reason(p_challenge_id, caller);
  if reason is not null then
    raise exception '%', reason;
  end if;
  today := public.soccer_today(caller);
  if exists (select 1 from public.baseball_steal_jumps x where x.challenge_id = p_challenge_id and x.user_id = caller and x.day = today) then
    raise exception 'Your jump is set for today. It''s used if you reach base tonight.';
  end if;
  j := least(5000, greatest(-5000, coalesce(p_jump_ms, 5000)));
  sl := case when j < 0 then 'none' when p_slide in ('perfect', 'early', 'late', 'none') then p_slide else 'none' end;
  g := public.baseball_jump_grade(j);
  insert into public.baseball_steal_jumps (challenge_id, user_id, day, jump_ms, slide) values (p_challenge_id, caller, today, j, sl);
  return jsonb_build_object('jump_ms', j, 'slide', sl, 'grade', g,
    'bonus', public.baseball_jump_bonus(j, sl),
    'message', case g
      when 'picked' then 'You went before the leg kick: that''s a pickoff if you try it tonight.'
      when 'great' then 'A great jump (' || j || ' ms). If you reach base tonight with second open, you''re going.'
      when 'good' then 'A decent jump (' || j || ' ms). If you reach base tonight with second open, you''re going.'
      else 'A late jump (' || j || ' ms). You''ll go tonight if you reach base, but it''s a long shot.' end);
end;
$$;
revoke execute on function public.baseball_steal_jump(uuid, int, text) from public, anon;
grant execute on function public.baseball_steal_jump(uuid, int, text) to authenticated;

-- ── The inning (0207's, plus pitched at-bats and steal jumps) ──

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
  -- 0231: a steal jump taken by hand.
  sj public.baseball_steal_jumps%rowtype;
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
      -- 0231: a jump taken by hand today: the runner goes, and the jump
      -- decides it (going before the leg kick is a pickoff).
      sj.user_id := null;
      if hands then
        select * into sj from public.baseball_steal_jumps j
          where j.challenge_id = p_challenge_id and j.user_id = stealer and j.day = p_day and j.used_inning is null
          for update;
      end if;
      if sj.user_id is not null or coalesce(rpick.steal, false) and (
        not exists (select 1 from public.baseball_players p where p.challenge_id = p_challenge_id and p.bot_id = stealer)
        or public.baseball_rand(seed || ':steal-try') < 0.3) then
        rs := public.baseball_steps(p_challenge_id, stealer, p_day, p_first_day);
        if sj.user_id is not null then
          ok := sj.jump_ms >= 0 and public.baseball_rand(seed || ':steal') <
            least(0.95, greatest(0.05, public.baseball_steal_chance(rs, cs) + public.baseball_jump_bonus(sj.jump_ms, sj.slide)));
          update public.baseball_steal_jumps j set used_inning = p_inning, used_half = p_half, safe = ok
            where j.challenge_id = p_challenge_id and j.user_id = stealer and j.day = p_day;
        else
          ok := public.baseball_rand(seed || ':steal') < public.baseball_steal_chance(rs, cs);
        end if;
        if to_base = 3 then b2 := null; else b1 := null; end if;
        if ok then
          if to_base = 3 then b3 := stealer; else b2 := stealer; end if;
        else
          outs := outs + 1;
        end if;
        insert into public.baseball_plays (by_hand, challenge_id, day, inning, half, seq, batting_team, kind, batter_id, pitcher_id, fielder_id, fielder_pos, runner_id,
          outs, on_first, on_second, on_third, catcher_steps, runner_steps, steal_jump)
        values (bh, p_challenge_id, p_day, p_inning, p_half, seq, p_bat, case when ok then 'stolen_base' else 'caught_stealing' end, batter, pitcher, catcher, 'c', stealer,
          outs, b1, b2, b3, cs, rs, case when sj.user_id is not null then sj.jump_ms end);
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
        where la.challenge_id = p_challenge_id and la.user_id = batter and la.status = 'done' and la.role = 'bat'
          and la.used_day is null and la.day <= p_day
        order by la.n limit 1
        for update;
      bh := found;
      -- 0231: else an at-bat the other side pitched by hand to this batter.
      if not bh then
        select * into lv from public.baseball_live_abs la
          where la.challenge_id = p_challenge_id and la.role = 'pitch' and la.team = ft and la.batter_id = batter
            and la.status = 'done' and la.used_day is null and la.day <= p_day
          order by la.created_at, la.n limit 1
          for update;
        bh := found;
      end if;
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

-- ── Admin (0207's, plus 0231) ──

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
        'at_bats_7d', (select count(*) from public.baseball_live_abs a where a.status = 'done' and a.role = 'bat' and a.created_at > now() - interval '7 days'),
        'pitches_7d', (select count(*) from public.baseball_live_pitches lp where lp.created_at > now() - interval '7 days'),
        'avg_7d', (select round(avg(case when a.result in ('single', 'double', 'triple', 'home_run') then 1.0 else 0.0 end), 3)
                   from public.baseball_live_abs a
                   where a.status = 'done' and a.role = 'bat' and a.result <> 'walk' and a.created_at > now() - interval '7 days'),
        'auto_avg_7d', (select round(avg(case when bp.kind in ('single', 'double', 'triple', 'home_run') then 1.0 else 0.0 end), 3)
                        from public.baseball_plays bp
                        join public.baseball_games g on g.challenge_id = bp.challenge_id and g.hands_on
                        where not bp.by_hand and bp.created_at > now() - interval '7 days'
                          and bp.kind in ('strikeout', 'single', 'double', 'triple', 'home_run', 'ground_out', 'fly_out', 'double_play', 'sac_fly')
                          and exists (select 1 from public.baseball_players p where p.challenge_id = bp.challenge_id and p.user_id = bp.batter_id)),
        'hr_7d', (select count(*) from public.baseball_live_abs a where a.role = 'bat' and a.result = 'home_run' and a.created_at > now() - interval '7 days'),
        -- 0231: where they tapped, the curveball, the mound and steal jumps.
        'tapped_7d', (select count(*) from public.baseball_live_pitches lp where lp.tap_x is not null and lp.created_at > now() - interval '7 days'),
        'avg_miss_7d', (select round(avg(lp.miss)::numeric, 2) from public.baseball_live_pitches lp where lp.miss is not null and lp.created_at > now() - interval '7 days'),
        'curveballs_7d', (select count(*) from public.baseball_live_pitches lp
                          join public.baseball_live_abs a on a.id = lp.ab_id and a.role = 'bat'
                          where lp.kind = 'curveball' and lp.created_at > now() - interval '7 days'),
        'pitchers_7d', (select count(distinct a.user_id) from public.baseball_live_abs a where a.role = 'pitch' and a.created_at > now() - interval '7 days'),
        'pitched_7d', (select count(*) from public.baseball_live_abs a where a.role = 'pitch' and a.status = 'done' and a.created_at > now() - interval '7 days'),
        'pitched_k_7d', (select count(*) from public.baseball_live_abs a where a.role = 'pitch' and a.result = 'strikeout' and a.created_at > now() - interval '7 days'),
        'pitched_hits_7d', (select count(*) from public.baseball_live_abs a where a.role = 'pitch'
                            and a.result in ('single', 'double', 'triple', 'home_run') and a.created_at > now() - interval '7 days'),
        'painted_7d', (select count(*) from public.baseball_live_pitches lp where lp.ring is not null and lp.ring <= 0.08 and lp.created_at > now() - interval '7 days'),
        'mound_pitches_7d', (select count(*) from public.baseball_live_pitches lp where lp.ring is not null and lp.created_at > now() - interval '7 days'),
        'jumps_7d', (select count(*) from public.baseball_steal_jumps j where j.created_at > now() - interval '7 days'),
        'great_jumps_7d', (select count(*) from public.baseball_steal_jumps j where j.jump_ms between 0 and 200 and j.created_at > now() - interval '7 days'),
        'jump_steals_7d', (select count(*) from public.baseball_steal_jumps j where j.used_inning is not null and j.created_at > now() - interval '7 days'),
        'jump_safe_7d', (select count(*) from public.baseball_steal_jumps j where j.safe and j.created_at > now() - interval '7 days'),
        'derby_tapped_7d', (select count(*) from public.derby_swings s where s.tap_x is not null and s.swung_at > now() - interval '7 days')
      )
    )
  );
end;
$$;
revoke execute on function public.admin_baseball_overview() from public, anon;
grant execute on function public.admin_baseball_overview() to authenticated;

-- ── The Derby (0211's, with where the meatball crosses) ──

create or replace function public.derby_live(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.derby_games%rowtype;
  p public.derby_players%rowtype;
  d public.derby_days%rowtype;
  pend public.derby_swings%rowtype;
  today date;
  first_day date;
  day_no int;
  stage int;
  steps int;
  earned int;
  thrown int;
  strength int;
  v_rank int;
  v_shown int;
  v_reason text;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.derby_games where challenge_id = p_challenge_id;
  if c.id is null or c.kind::text <> 'derby' or g.challenge_id is null then
    raise exception 'That isn''t a Home Run Derby.';
  end if;
  select * into p from public.derby_players x where x.challenge_id = p_challenge_id and x.user_id = caller;
  today := public.soccer_today(caller);
  first_day := public.soccer_first_day(c);
  day_no := greatest(1, least(c.duration_days, today - first_day + 1));
  stage := public.derby_stage(c.duration_days, day_no);
  steps := public.derby_steps_today(p_challenge_id, caller, today);
  earned := least(20, steps / 1000);
  select count(*) into thrown from public.derby_swings s where s.challenge_id = p_challenge_id and s.user_id = caller and s.day = today;
  select * into pend from public.derby_swings s
    where s.challenge_id = p_challenge_id and s.user_id = caller and s.result is null
    order by s.id desc limit 1;
  select b.strength into strength from public.sport_day_bonus(caller, today, 'baseball') b;
  select * into d from public.derby_days x where x.challenge_id = p_challenge_id and x.user_id = caller and x.day = today;
  select count(*) into v_shown from public.derby_swings s where s.challenge_id = p_challenge_id and s.user_id = caller and s.day = today and s.golden;
  select x.pos into v_rank from public.derby_positions(p_challenge_id) x where x.user_id = caller;
  v_reason := case when pend.id is not null then null else public.derby_reason(p_challenge_id, caller) end;

  return jsonb_build_object(
    'day', today, 'day_no', day_no, 'days', c.duration_days, 'stage', stage,
    'mph', public.derby_mph(stage), 'factor', public.derby_factor(stage), 'ms', public.derby_ms(stage),
    'bands', public.derby_bands(public.derby_factor(stage)),
    'steps', steps, 'swings_earned', earned, 'swings_taken', thrown,
    'swings_left', greatest(0, least(earned, 20) - thrown),
    'next_swing_at', case when earned >= 20 then null else (earned + 1) * 1000 end,
    'cap', 20,
    'goldens', jsonb_build_object(
      'shown', v_shown,
      -- A golden ball still to come today (not which pitch).
      'due_next', d.day is null or (d.golden1 > thrown) or (d.golden2 is not null and d.golden2 > thrown),
      'second_unlocks_at', 15000,
      'second_unlocked', steps >= 15000),
    'power', jsonb_build_object('steps_ft', public.derby_steps_ft(steps), 'workout_ft', public.derby_workout_ft(strength)),
    'pending', case when pend.id is null then null else jsonb_build_object(
      'n', pend.n, 'golden', pend.golden, 'mph', pend.mph, 'ms', pend.ms, 'px', pend.px, 'py', pend.py,
      'bands', public.derby_bands(pend.factor)) end,
    'joined', p.user_id is not null,
    'me', case when p.user_id is null then null else jsonb_build_object(
      'hrs', p.hrs, 'longest_ft', p.longest_ft, 'rank', v_rank, 'moonshots', p.moonshots,
      'goldens_hit', p.goldens_hit, 'sign_hits', p.sign_hits, 'swings', p.swings) end,
    'field', (select count(*) from public.derby_players x where x.challenge_id = p_challenge_id),
    'recent', (select coalesce(jsonb_agg(public.derby_swing_json(s) order by s.id desc), '[]'::jsonb) from (
      select * from public.derby_swings s where s.challenge_id = p_challenge_id and s.user_id = caller and s.result is not null
      order by s.id desc limit 8) s),
    'sponsor', case when c.sponsor_name is null then null else jsonb_build_object(
      'name', c.sponsor_name, 'logo_url', c.sponsor_logo_url, 'color', c.sponsor_color,
      'sign_bones', g.sign_bones, 'sign_cap', g.sign_cap, 'sign_hits', coalesce(p.sign_hits, 0)) end,
    'can_swing', pend.id is not null or v_reason is null,
    'reason', v_reason);
end;
$$;
revoke execute on function public.derby_live(uuid) from public, anon;
grant execute on function public.derby_live(uuid) to authenticated;

create or replace function public.derby_pitch(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  p public.derby_players%rowtype;
  d public.derby_days%rowtype;
  pend public.derby_swings%rowtype;
  today date;
  day_no int;
  stage int;
  steps int;
  thrown int;
  n int;
  v_reason text;
  v_pos int;
  is_golden boolean;
  seed text;
  g2 int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if c.id is null or c.kind::text <> 'derby' then
    raise exception 'That isn''t a Home Run Derby.';
  end if;
  select * into p from public.derby_players x where x.challenge_id = p_challenge_id and x.user_id = caller for update;
  -- A pitch thrown and not swung at comes back as it was.
  select * into pend from public.derby_swings s
    where s.challenge_id = p_challenge_id and s.user_id = caller and s.result is null
    order by s.id desc limit 1;
  if pend.id is not null then
    return jsonb_build_object('n', pend.n, 'golden', pend.golden, 'mph', pend.mph, 'ms', pend.ms, 'px', pend.px, 'py', pend.py,
      'bands', public.derby_bands(pend.factor), 'swings_left',
      greatest(0, least(20, public.derby_steps_today(p_challenge_id, caller, pend.day) / 1000)
        - (select count(*) from public.derby_swings s where s.challenge_id = p_challenge_id and s.user_id = caller and s.day = pend.day)));
  end if;
  v_reason := public.derby_reason(p_challenge_id, caller);
  if v_reason is not null then
    raise exception '%', v_reason;
  end if;

  today := public.soccer_today(caller);
  day_no := today - public.soccer_first_day(c) + 1;
  stage := public.derby_stage(c.duration_days, day_no);
  steps := public.derby_steps_today(p_challenge_id, caller, today);
  seed := p_challenge_id::text || ':' || caller::text || ':' || today::text;

  select * into d from public.derby_days x where x.challenge_id = p_challenge_id and x.user_id = caller and x.day = today for update;
  if d.day is null then
    insert into public.derby_days (challenge_id, user_id, day, golden1)
      values (p_challenge_id, caller, today, 1 + floor(public.derby_rand(seed || ':golden1') * 10)::int)
      returning * into d;
    -- Where you stood when today's first pitch came, for "moved today".
    select x.pos into v_pos from public.derby_positions(p_challenge_id) x where x.user_id = caller;
    update public.derby_players set pos_mark = v_pos, pos_mark_day = today
      where challenge_id = p_challenge_id and user_id = caller;
  end if;
  select count(*) into thrown from public.derby_swings s where s.challenge_id = p_challenge_id and s.user_id = caller and s.day = today;
  n := thrown + 1;

  -- The second golden ball: due once you've passed 15,000 steps, within
  -- the 10 pitches from the first one thrown past 15K.
  if d.golden2 is null and steps >= 15000 then
    g2 := n + floor(public.derby_rand(seed || ':golden2') * 10)::int;
    if g2 = d.golden1 then
      g2 := g2 + 1;
    end if;
    update public.derby_days set golden2 = g2 where challenge_id = p_challenge_id and user_id = caller and day = today;
    d.golden2 := g2;
  end if;
  is_golden := n = d.golden1 or n = coalesce(d.golden2, 0);

  insert into public.derby_swings (challenge_id, user_id, day, n, golden, stage, mph, factor, ms, px, py)
    values (p_challenge_id, caller, today, n, is_golden, stage, public.derby_mph(stage), public.derby_factor(stage), public.derby_ms(stage),
      round(((public.derby_rand(seed || ':px:' || n) * 2 - 1) * 0.45)::numeric, 3),
      round(((public.derby_rand(seed || ':py:' || n) * 2 - 1) * 0.45)::numeric, 3))
    returning * into pend;

  return jsonb_build_object('n', n, 'golden', is_golden, 'mph', pend.mph, 'ms', pend.ms, 'px', pend.px, 'py', pend.py,
    'bands', public.derby_bands(pend.factor),
    'swings_left', greatest(0, least(20, steps / 1000) - n));
end;
$$;
revoke execute on function public.derby_pitch(uuid) from public, anon;
grant execute on function public.derby_pitch(uuid) to authenticated;

create or replace function public.derby_swing(p_challenge_id uuid, p_timing_ms integer, p_tap_x double precision, p_tap_y double precision)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.derby_games%rowtype;
  p public.derby_players%rowtype;
  s public.derby_swings%rowtype;
  f numeric;
  a numeric;
  t integer;
  base int;
  steps int;
  strength int;
  v_steps_ft int;
  v_workout_ft int;
  v_ft int;
  v_dir text;
  v_result text;
  v_moon boolean := false;
  v_sign boolean := false;
  v_sign_paid boolean := false;
  v_counts int := 0;
  v_msg text;
  v_rank int;
  v_swung int;
  v_left int;
  v_hrs int;
  v_d double precision := 0;
  v_dpen double precision := 0;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.derby_games where challenge_id = p_challenge_id;
  if c.id is null or c.kind::text <> 'derby' or g.challenge_id is null then
    raise exception 'That isn''t a Home Run Derby.';
  end if;
  select * into p from public.derby_players x where x.challenge_id = p_challenge_id and x.user_id = caller for update;
  if p.user_id is null then
    raise exception 'Join the Derby to swing.';
  end if;
  select * into s from public.derby_swings x
    where x.challenge_id = p_challenge_id and x.user_id = caller and x.result is null
    order by x.id desc limit 1 for update;
  if s.id is null then
    raise exception 'Pitch first.';
  end if;

  f := s.factor;
  t := case when p_timing_ms is null then null else greatest(-2000, least(2000, p_timing_ms)) end;
  -- 0231: where you swung, against where the meatball crossed.
  if t is not null and p_tap_x is not null and p_tap_y is not null and s.px is not null then
    v_d := sqrt(power(least(3, greatest(-3, p_tap_x)) - s.px, 2) + power(least(3, greatest(-3, p_tap_y)) - s.py, 2));
    v_dpen := 60 * greatest(0, v_d - 0.2);
  end if;
  steps := public.derby_steps_today(p_challenge_id, caller, s.day);
  select b.strength into strength from public.sport_day_bonus(caller, s.day, 'baseball') b;
  v_steps_ft := public.derby_steps_ft(steps);
  v_workout_ft := public.derby_workout_ft(strength);

  if t is null then
    v_result := 'take';
    v_msg := 'You have to swing in a derby. That one''s an out.';
  else
    a := round(sqrt(power(t, 2) + power(v_dpen, 2))::numeric, 1);
    base := public.derby_base_ft(a, f);
    if base is null and a > 120 * f then
      v_result := 'whiff';
      v_msg := 'Swing and a miss: way ' || case when t < 0 then 'early' else 'late' end || '.';
    elsif base is null then
      -- A long fly ball off the end of the bat: caught at the wall.
      v_result := 'fly_out';
      v_ft := round(340 - (a / f - 70))::int;
      v_dir := public.derby_dir(t, f);
      v_msg := 'Caught at the wall: a little ' || case when t < 0 then 'early' else 'late' end || '.';
    else
      v_ft := least(500, base + v_steps_ft + v_workout_ft - round(a / f * 0.2)::int);
      v_dir := public.derby_dir(t, f);
      if v_ft >= public.derby_fence(a, f) then
        v_result := 'hr';
        v_moon := v_ft >= 475;
        v_counts := (case when v_moon then 2 else 1 end) * (case when s.golden then 2 else 1 end);
        if c.sponsor_name is not null and g.sign_bones > 0 and a <= 20 * f and v_ft between 410 and 445
           and public.derby_rand(p_challenge_id::text || ':' || caller::text || ':' || s.day::text || ':' || s.n || ':sign') < 0.35 then
          v_sign := true;
          v_sign_paid := p.sign_hits < g.sign_cap;
        end if;
        v_msg := case
          when s.golden then 'Golden ball, out of the park: it counts as ' || v_counts || ' home runs.'
          when v_moon then 'Moonshot! ' || v_ft || ' ft: that counts as two.'
          when v_sign and v_sign_paid then 'Off the sign! +' || g.sign_bones || ' Bones from ' || c.sponsor_name || '.'
          when v_sign then 'Off the sign! ' || v_ft || ' ft.'
          when a <= 10 * f and v_workout_ft > 0 then 'Gone! ' || v_ft || ' ft. Barreled: your workout added ' || v_workout_ft || ' feet.'
          else 'Gone! ' || v_ft || ' ft.' end;
      else
        v_result := 'fly_out';
        v_msg := 'Caught at the wall: a little ' || case when t < 0 then 'early' else 'late' end || '.';
      end if;
    end if;
  end if;

  if t is not null and v_dpen > abs(t) and v_result in ('whiff', 'fly_out') then
    v_msg := case when v_result = 'whiff' then 'Swung right past it: tap right on the ball.'
      else 'Off the end of the bat, caught at the wall: tap right on the ball.' end;
  end if;

  update public.derby_swings set timing = t, result = v_result, ft = v_ft, dir = v_dir, moonshot = v_moon,
      tap_x = p_tap_x, tap_y = p_tap_y, miss = case when p_tap_x is null or t is null then null else v_d end,
      sign = v_sign, sign_paid = v_sign_paid, counts = v_counts, swung_at = now()
    where id = s.id;
  update public.derby_players set
      swings = swings + 1,
      hrs = hrs + v_counts,
      moonshots = moonshots + case when v_moon then 1 else 0 end,
      goldens_hit = goldens_hit + case when s.golden and v_result = 'hr' then 1 else 0 end,
      sign_hits = sign_hits + case when v_sign then 1 else 0 end,
      longest_ft = case when v_result = 'hr' and (longest_ft is null or v_ft > longest_ft) then v_ft else longest_ft end,
      longest_at = case when v_result = 'hr' and (longest_ft is null or v_ft > longest_ft) then now() else longest_at end
    where challenge_id = p_challenge_id and user_id = caller
    returning * into p;

  select x.pos into v_rank from public.derby_positions(p_challenge_id) x where x.user_id = caller;
  select count(*) into v_swung from public.derby_positions(p_challenge_id);
  -- The top 10, once the field's big enough to mean something.
  if v_swung >= 20 and v_rank <= 10 and p.top10_at is null then
    update public.derby_players set top10_at = now() where challenge_id = p_challenge_id and user_id = caller;
    perform public.derby_notify(p_challenge_id, caller, c.name,
      'You''re into the top 10: #' || v_rank || ' with ' || p.hrs || ' home runs. Keep swinging.');
  end if;
  select greatest(0, least(20, steps / 1000) - count(*))::int into v_left
    from public.derby_swings x where x.challenge_id = p_challenge_id and x.user_id = caller and x.day = s.day;

  return jsonb_build_object(
    'result', v_result, 'ft', v_ft, 'dir', v_dir, 'moonshot', v_moon, 'golden', s.golden,
    'sign', v_sign, 'sign_paid', v_sign_paid, 'counts', v_counts,
    'hrs', p.hrs, 'longest_ft', p.longest_ft, 'rank', v_rank, 'swings_left', v_left,
    'power', jsonb_build_object('steps_ft', v_steps_ft, 'workout_ft', v_workout_ft),
    'message', v_msg,
    'px', s.px, 'py', s.py, 'timing', t,
    'miss', case when p_tap_x is null or t is null then null else round(v_d::numeric, 2) end);
end;
$$;
revoke execute on function public.derby_swing(uuid, integer, double precision, double precision) from public, anon;
grant execute on function public.derby_swing(uuid, integer, double precision, double precision) to authenticated;

-- Older apps: timing only, as if right on the ball.
create or replace function public.derby_swing(p_challenge_id uuid, p_timing_ms integer)
returns jsonb
language sql
as $$
  select public.derby_swing(p_challenge_id, p_timing_ms, null::double precision, null::double precision);
$$;
revoke execute on function public.derby_swing(uuid, integer) from public, anon;
grant execute on function public.derby_swing(uuid, integer) to authenticated;
