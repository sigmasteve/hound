-- 0206: Hoops, take your own shots.
--
-- A game can be hands-on (Create's "Take my own shots"): then a joined
-- person shoots during the game day, live. Steps still decide how many
-- shots you get (and the defender's steps how hard they are); the shot
-- meter's timing nudges each one's chance, within limits, and the server
-- rolls it. Live shots are kept in hoops_live_shots and become real when
-- the day is played next morning: hoops_play_day plays a seat's live
-- shots first, as they happened, and rolls only the rest. Hands-off
-- games, bots and anyone who doesn't open the app play as before.
--
-- Live shooting is on regulation days only (an overtime day isn't known
-- to be one until the day before is played, the next morning).

alter table public.hoops_games add column if not exists hands_on boolean not null default false;
alter table public.hoops_events add column if not exists by_hand boolean not null default false;

create table public.hoops_live_shots (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  seat uuid not null references public.hoops_players (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  n int not null check (n between 1 and 12),
  kind text not null check (kind in ('drive', 'mid', 'three')),
  timing numeric not null,
  quality text not null check (quality in ('swish', 'green', 'near', 'off')),
  window_size double precision not null,
  chance double precision not null,
  made boolean not null,
  pts int not null,
  dunk boolean not null default false,
  on_fire boolean not null default false,
  rebound text check (rebound in ('home', 'away')),
  putback_made boolean,
  putback_pts int,
  mine_steps int not null,
  theirs_steps int not null,
  defense text not null,
  created_at timestamptz not null default now(),
  unique (challenge_id, day, seat, n)
);
create index hoops_live_shots_created_idx on public.hoops_live_shots (created_at);

alter table public.hoops_live_shots enable row level security;
revoke all on public.hoops_live_shots from anon;
revoke insert, update, delete on public.hoops_live_shots from authenticated;
create policy "People can view their own Hoops shots"
  on public.hoops_live_shots for select to authenticated
  using (user_id = auth.uid());

-- ── Setting up: p_hands_on (0195's, with "Take my own shots") ──

drop function if exists public.hoops_setup(uuid, int, int, boolean, jsonb, text, text);
create or replace function public.hoops_setup(
  p_challenge_id uuid, p_shot_steps int, p_days_per_quarter int, p_fill_bots boolean, p_players jsonb,
  p_home_name text default 'Hounds', p_away_name text default 'Strays', p_hands_on boolean default false
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  r record;
  n_home int;
  n_away int;
  bot_names text[] := array['Rex', 'Biscuit', 'Scout', 'Maple', 'Duke', 'Pepper', 'Ziggy', 'Bruno', 'Luna', 'Rocket'];
  side text;
  k int := 0;
  b uuid;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'hoops' or c.created_by is distinct from caller then
    raise exception 'Only whoever made this game can set it up.';
  end if;
  if not (public.hoops_cfg()).enabled then
    raise exception 'Hoops is paused right now.';
  end if;
  if exists (select 1 from public.hoops_games g where g.challenge_id = p_challenge_id) then
    raise exception 'This game is already set up.';
  end if;
  if p_shot_steps not in (1500, 2000, 2500, 3000) then
    raise exception 'A shot is 1,500, 2,000, 2,500 or 3,000 steps.';
  end if;
  if p_days_per_quarter not in (1, 2) then
    raise exception 'A quarter is one day or two.';
  end if;
  if c.duration_days <> 4 * p_days_per_quarter then
    raise exception 'A game is four quarters: % days.', 4 * p_days_per_quarter;
  end if;
  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) < 1 then
    raise exception 'Who''s playing?';
  end if;
  if (select count(distinct e ->> 'user_id') from jsonb_array_elements(p_players) e) <> jsonb_array_length(p_players) then
    raise exception 'Everyone in the game has to be a different person.';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_players) e where (e ->> 'user_id')::uuid = caller and e ->> 'team' = 'home') then
    raise exception 'You play for the home side.';
  end if;
  for r in select (e ->> 'user_id')::uuid as id, e ->> 'team' as team from jsonb_array_elements(p_players) e loop
    if r.team not in ('home', 'away') then
      raise exception 'Each player is home or away.';
    end if;
    if not exists (select 1 from public.profiles p where p.id = r.id) then
      raise exception 'One of the players isn''t on Hound.';
    end if;
  end loop;
  select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
    into n_home, n_away from jsonb_array_elements(p_players) e;
  if n_home > 9 or n_away > 9 then
    raise exception 'A side has one to nine people.';
  end if;
  if n_away = 0 and not coalesce(p_fill_bots, false) then
    raise exception 'The other side needs someone: invite a friend or fill it with bots.';
  end if;

  insert into public.hoops_games (challenge_id, shot_steps, days_per_quarter, home_name, away_name, hands_on)
  values (p_challenge_id, p_shot_steps, p_days_per_quarter,
          coalesce(nullif(left(trim(p_home_name), 24), ''), 'Hounds'), coalesce(nullif(left(trim(p_away_name), 24), ''), 'Strays'), coalesce(p_hands_on, false));

  insert into public.hoops_players (challenge_id, user_id, team, baseline, joined)
  select p_challenge_id, (e ->> 'user_id')::uuid, e ->> 'team', public.hoops_baseline((e ->> 'user_id')::uuid),
    exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = (e ->> 'user_id')::uuid)
  from jsonb_array_elements(p_players) e;

  if coalesce(p_fill_bots, false) then
    foreach side in array array['home', 'away'] loop
      while (select count(*) from public.hoops_players p where p.challenge_id = p_challenge_id and p.team = side) < 5 loop
        k := k + 1;
        insert into public.challenge_bots (challenge_id, name, fitness_level)
          values (p_challenge_id, bot_names[1 + (k - 1) % array_length(bot_names, 1)], 'active')
          returning id into b;
        insert into public.hoops_players (challenge_id, bot_id, team, baseline, joined, shot)
          values (p_challenge_id, b, side, (public.hoops_cfg()).bot_steps, true,
                  (array['drive', 'mid', 'three'])[1 + floor(public.rally_js_rand(public.rally_js_hash(b::text || ':shot')) * 3)::int]);
      end loop;
    end loop;
  end if;

  perform public.hoops_pair(p_challenge_id);
end;
$$;

revoke execute on function public.hoops_setup(uuid, int, int, boolean, jsonb, text, text, boolean) from public, anon;
grant execute on function public.hoops_setup(uuid, int, int, boolean, jsonb, text, text, boolean) to authenticated;
-- ── Shooting live ──

-- The make window for a shot (the meter's green, as a share of its
-- width): narrower when the defender has walked more than you.
create or replace function public.hoops_window(p_kind text, p_mine numeric, p_theirs numeric)
returns double precision
language sql
immutable
as $$
  select (case p_kind when 'drive' then 0.36 when 'mid' then 0.26 else 0.20 end)
    * (1 - least(0.5, greatest(0, (greatest(p_theirs, 0) - greatest(p_mine, 0)) / greatest(p_theirs, p_mine, 1))))::double precision;
$$;
revoke execute on function public.hoops_window(text, numeric, numeric) from public, anon, authenticated;

-- How a release landed, and what it does to the chance.
create or replace function public.hoops_quality(p_timing numeric, p_window double precision)
returns text
language sql
immutable
as $$
  select case when abs(p_timing) <= p_window / 4 then 'swish'
              when abs(p_timing) <= p_window / 2 then 'green'
              when abs(p_timing) <= p_window then 'near'
              else 'off' end;
$$;
revoke execute on function public.hoops_quality(numeric, double precision) from public, anon, authenticated;

create or replace function public.hoops_quality_bonus(p_quality text)
returns double precision
language sql
immutable
as $$
  select (case p_quality when 'swish' then 0.20 when 'green' then 0.10 when 'near' then -0.10 else -0.30 end)::double precision;
$$;
revoke execute on function public.hoops_quality_bonus(text) from public, anon, authenticated;

-- Someone's shooting today, as the app shows it, plus the engine's
-- working (keys starting with "_", which hoops_live drops).
create or replace function public.hoops_live_state(p_challenge_id uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.hoops_games%rowtype;
  me public.hoops_players%rowtype;
  d public.hoops_players%rowtype;
  today date;
  first_day date;
  reg int;
  day_no int;
  per int;
  mine int := 0;
  theirs int := 0;
  their_def text := 'none';
  bn record;
  base int := 0;
  earned int := 0;
  taken int := 0;
  ready int := 0;
  next_at int;
  share double precision := 0.5;
  sh numeric;
  sa numeric;
  streak int := 0;
  l record;
  shots jsonb := '[]'::jsonb;
  today_pts int := 0;
  reason text;
  gdm double precision := coalesce((select cf.game_day_make from public.sport_bonus_config cf limit 1), 0);
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.hoops_games where challenge_id = p_challenge_id;
  if c.id is null or g.challenge_id is null then
    raise exception 'not authorized';
  end if;
  today := public.soccer_today(p_user);
  first_day := public.soccer_first_day(c);
  reg := public.hoops_reg_days(g.days_per_quarter);
  day_no := today - first_day + 1;
  per := case when day_no between 1 and reg then public.hoops_period_of(day_no, g.days_per_quarter) end;
  select * into me from public.hoops_players p where p.challenge_id = p_challenge_id and p.user_id = p_user and p.joined;

  if me.id is not null then
    mine := public.hoops_steps(p_challenge_id, p_user, today);
    select * into d from public.hoops_players x where x.id = public.hoops_defender_of(me.id) and x.joined;
    if d.id is not null then
      theirs := public.hoops_steps(p_challenge_id, d.player_id, today);
    end if;
    their_def := public.hoops_defense(p_challenge_id, case when me.team = 'home' then 'away' else 'home' end, today);
    select * into bn from public.sport_day_bonus(p_user, today, 'hoops');
    base := least(5, floor(mine::numeric / g.shot_steps))::int;
    earned := base + coalesce(bn.strength, 0) + case when coalesce(bn.game_day, false) then 1 else 0 end;
    next_at := case when base < 5 then (base + 1) * g.shot_steps end;
    select coalesce(sum(public.hoops_steps(p_challenge_id, x.player_id, today)) filter (where x.team = 'home'), 0),
           coalesce(sum(public.hoops_steps(p_challenge_id, x.player_id, today)) filter (where x.team = 'away'), 0)
      into sh, sa from public.hoops_players x where x.challenge_id = p_challenge_id and x.joined;
    share := case when sh + sa = 0 then 0.5 when me.team = 'home' then sh / (sh + sa) else sa / (sh + sa) end;
    for l in select * from public.hoops_live_shots s where s.challenge_id = p_challenge_id and s.day = today and s.seat = me.id order by s.n loop
      taken := taken + 1;
      today_pts := today_pts + l.pts + coalesce(l.putback_pts, 0);
      streak := case when l.made then streak + 1 else 0 end;
      if l.putback_made is not null then
        streak := case when l.putback_made then streak + 1 else 0 end;
      end if;
      shots := shots || jsonb_build_object('n', l.n, 'kind', l.kind, 'quality', l.quality, 'made', l.made, 'pts', l.pts,
        'dunk', l.dunk and l.made, 'on_fire', l.on_fire,
        'putback', case when l.putback_made is not null then jsonb_build_object('made', l.putback_made, 'pts', l.putback_pts) end);
    end loop;
    ready := greatest(0, earned - taken);
  end if;

  reason := case
    when not g.hands_on then 'This game plays itself.'
    when me.id is null then 'You''re not playing in this game.'
    when g.status <> 'active' then 'This game is over.'
    when day_no < 1 then 'The game hasn''t started yet.'
    when day_no > reg then 'Not a game day.'
    when day_no <= g.days_played or exists (select 1 from public.hoops_days hd where hd.challenge_id = p_challenge_id and hd.day = today)
      then 'Today''s already been played.'
    when ready = 0 and next_at is null then 'That''s all your shots today.'
    when ready = 0 then 'No shots ready: your next one comes at ' || to_char(next_at, 'FM999,999,999') || ' steps.'
  end;

  return jsonb_build_object(
    'hands_on', g.hands_on,
    'can_shoot', reason is null,
    'reason', reason,
    'day', today,
    'day_no', case when day_no between 1 and reg then day_no end,
    'period', per,
    'label', case when per is not null then public.hoops_label(per) end,
    'steps', mine,
    'shot_steps', g.shot_steps,
    'earned', earned,
    'taken', taken,
    'ready', ready,
    'next_at', next_at,
    'defender', case when d.id is not null then jsonb_build_object('name', public.hoops_name(d.id), 'steps', theirs) end,
    'their_defense', their_def,
    'windows', jsonb_build_object(
      'drive', round(public.hoops_window('drive', mine, theirs)::numeric, 3),
      'mid', round(public.hoops_window('mid', mine, theirs)::numeric, 3),
      'three', round(public.hoops_window('three', mine, theirs)::numeric, 3)),
    'streak', streak,
    'today_pts', today_pts,
    'shots', shots,
    '_seat', me.id,
    '_team', me.team,
    '_theirs', theirs,
    '_share', share,
    '_gd', case when coalesce(bn.game_day, false) then gdm else 0 end
  );
end;
$$;
revoke execute on function public.hoops_live_state(uuid, uuid) from public, anon, authenticated;

create or replace function public.hoops_live(p_challenge_id uuid)
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
         and not exists (select 1 from public.hoops_players p where p.challenge_id = p_challenge_id and p.user_id = caller)) then
    raise exception 'not authorized';
  end if;
  return public.hoops_live_state(p_challenge_id, caller) - array['_seat', '_team', '_theirs', '_share', '_gd'];
end;
$$;
revoke execute on function public.hoops_live(uuid) from public, anon;
grant execute on function public.hoops_live(uuid) to authenticated;

-- Take one shot: p_kind drive | mid | three, p_timing where the meter
-- stopped (−0.5 early … 0 the middle … 0.5 late).
create or replace function public.hoops_take_shot(p_challenge_id uuid, p_kind text, p_timing numeric)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  s jsonb;
  seat uuid;
  team text;
  o text;
  n int;
  mine int;
  theirs int;
  their_def text;
  gd double precision;
  tm numeric;
  w double precision;
  q text;
  dunk boolean;
  fire boolean;
  ch double precision;
  made boolean;
  p int;
  reb text;
  pb_made boolean;
  pb_pts int;
  seed text;
  msg text;
  pts_word text;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  if p_kind is null or p_kind not in ('drive', 'mid', 'three') then
    raise exception 'Pick drive, mid-range or three.';
  end if;
  if p_timing is null then
    raise exception 'Release the shot first.';
  end if;
  -- One shot at a time per seat, and not while the day is being played.
  perform 1 from public.challenges where id = p_challenge_id for share;
  perform 1 from public.hoops_players hp where hp.challenge_id = p_challenge_id and hp.user_id = caller for update;

  s := public.hoops_live_state(p_challenge_id, caller);
  if not (s ->> 'can_shoot')::boolean then
    raise exception '%', s ->> 'reason';
  end if;
  seat := (s ->> '_seat')::uuid;
  team := s ->> '_team';
  o := case when team = 'home' then 'away' else 'home' end;
  n := (s ->> 'taken')::int + 1;
  mine := (s ->> 'steps')::int;
  theirs := (s ->> '_theirs')::int;
  their_def := s ->> 'their_defense';
  gd := (s ->> '_gd')::double precision;
  tm := least(0.5, greatest(-0.5, p_timing));
  w := public.hoops_window(p_kind, mine, theirs);
  q := public.hoops_quality(tm, w);
  dunk := p_kind = 'drive' and mine >= 15000;
  fire := (s ->> 'streak')::int >= 3;
  ch := least(0.97, greatest(0.03,
          least(0.95, public.hoops_chance(p_kind, mine, theirs, their_def, dunk, fire) + gd) + public.hoops_quality_bonus(q)));
  seed := p_challenge_id::text || ':' || (s ->> 'day') || ':' || seat || ':live:' || n;
  made := public.rally_js_rand(public.rally_js_hash(seed)) < ch;
  p := case when not made then 0 when p_kind = 'three' then 3 else 2 end;
  if not made then
    reb := case when public.rally_js_rand(public.rally_js_hash(seed || ':reb')) < 0.6 * (s ->> '_share')::double precision then team else o end;
    if reb = team then
      pb_made := public.rally_js_rand(public.rally_js_hash(seed || ':putback'))
                 < least(0.95, public.hoops_chance('putback', mine, theirs, their_def, false, false) + gd);
      pb_pts := case when pb_made then 2 else 0 end;
    end if;
  end if;

  insert into public.hoops_live_shots (challenge_id, day, seat, user_id, n, kind, timing, quality, window_size, chance, made, pts,
                                       dunk, on_fire, rebound, putback_made, putback_pts, mine_steps, theirs_steps, defense)
    values (p_challenge_id, (s ->> 'day')::date, seat, caller, n, p_kind, tm, q, w, ch, made, p,
            dunk, fire, reb, pb_made, pb_pts, mine, theirs, their_def);

  pts_word := case when p = 3 then 'Three points.' else 'Two points.' end;
  msg := case
    when made and dunk then 'Dunk!'
    when made and q = 'swish' then 'Swish! ' || pts_word
    when made then 'In off the rim. ' || pts_word
    when pb_made then 'Rims out. Your side grabs it… putback, two points.'
    when pb_made is not null then 'Rims out. Your side grabs it… the putback rolls off.'
    when q in ('swish', 'green') then 'Rims out.'
    when tm < 0 then 'Short.'
    else 'Long.'
  end;

  return jsonb_build_object(
    'n', n, 'kind', p_kind, 'quality', q, 'chance', round(ch::numeric, 2), 'made', made, 'pts', p,
    'dunk', dunk and made, 'on_fire', fire,
    'putback', case when pb_made is not null then jsonb_build_object('made', pb_made, 'pts', pb_pts) end,
    'ready', greatest(0, (s ->> 'ready')::int - 1),
    'today_pts', (s ->> 'today_pts')::int + p + coalesce(pb_pts, 0),
    'message', msg);
end;
$$;
revoke execute on function public.hoops_take_shot(uuid, text, numeric) from public, anon;
grant execute on function public.hoops_take_shot(uuid, text, numeric) to authenticated;

-- ── The day: shots taken by hand first (0198's, plus 0206) ──

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
  lv public.hoops_live_shots%rowtype;
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
      'base', least(5, floor(s.steps::numeric / g.shot_steps))::int, 'str', bn.strength, 'gd', bn.game_day,
      -- 0206: the shots this seat took by hand today, played first.
      'live', (select count(*) from public.hoops_live_shots l where l.challenge_id = p_challenge_id and l.day = p_day and l.seat = s.id));
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
      for st in select x from jsonb_array_elements(seats) x where x ->> 'team' = t and greatest((x ->> 'shots')::int, (x ->> 'live')::int) >= rnd loop
        mine := (st ->> 'steps')::int;
        theirs := (st ->> 'def_steps')::int;
        streak := coalesce((streaks ->> (st ->> 'id'))::int, 0);
        seed := p_challenge_id::text || ':' || p_day || ':' || (st ->> 'id') || ':' || rnd;
        gd := case when (st ->> 'gd')::boolean then gdm else 0 end;

        -- 0206: a shot taken by hand plays as it happened (no foul on it).
        if rnd <= (st ->> 'live')::int then
          select * into lv from public.hoops_live_shots l
            where l.challenge_id = p_challenge_id and l.day = p_day and l.seat = (st ->> 'id')::uuid and l.n = rnd;
          seq := seq + 1;
          insert into public.hoops_events (challenge_id, day, day_no, period, seq, team, shooter, defender, kind, dunk, made, pts, on_fire, rebound, shooter_steps, defender_steps, defense, bonus, by_hand)
            values (p_challenge_id, p_day, p_day_no, per, seq, t, (st ->> 'id')::uuid, (st ->> 'def')::uuid, lv.kind, lv.dunk and lv.made, lv.made, lv.pts, lv.on_fire, lv.rebound,
                    lv.mine_steps, lv.theirs_steps, lv.defense,
                    case when rnd > (st ->> 'base')::int + (st ->> 'str')::int then 'game_day' when rnd > (st ->> 'base')::int then 'power' end, true);
          if t = 'home' then pts_home := pts_home + lv.pts; else pts_away := pts_away + lv.pts; end if;
          streak := case when lv.made then streak + 1 else 0 end;
          if lv.putback_made is not null then
            seq := seq + 1;
            insert into public.hoops_events (challenge_id, day, day_no, period, seq, team, shooter, defender, kind, made, pts, rebound, shooter_steps, defender_steps, defense, by_hand)
              values (p_challenge_id, p_day, p_day_no, per, seq, t, (st ->> 'id')::uuid, (st ->> 'def')::uuid, 'putback', lv.putback_made, lv.putback_pts,
                      case when lv.putback_made then null else o end, lv.mine_steps, lv.theirs_steps, lv.defense, true);
            if t = 'home' then pts_home := pts_home + lv.putback_pts; else pts_away := pts_away + lv.putback_pts; end if;
            streak := case when lv.putback_made then streak + 1 else 0 end;
          end if;
          streaks := streaks || jsonb_build_object(st ->> 'id', streak);
          continue;
        end if;

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

-- The plays, now with which were taken by hand.
create or replace function public.hoops_events_json(p_challenge_id uuid, p_period int, p_day date)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'seq', e.seq, 'team', e.team, 'shooter', e.shooter, 'defender', e.defender, 'kind', e.kind, 'dunk', e.dunk,
      'made', e.made, 'pts', e.pts, 'on_fire', e.on_fire, 'rebound', e.rebound,
      'shooter_steps', e.shooter_steps, 'defender_steps', e.defender_steps, 'defense', e.defense, 'bonus', e.bonus, 'by_hand', e.by_hand)
    order by e.day, e.seq), '[]'::jsonb)
  from public.hoops_events e
  where e.challenge_id = p_challenge_id
    and (p_period is null or e.period = p_period)
    and (p_day is null or e.day = p_day);
$$;

revoke execute on function public.hoops_events_json(uuid, int, date) from public, anon, authenticated;

-- ── Reading the game: hands_on and today's shots (0195's, plus 0206) ──

create or replace function public.hoops_view(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.hoops_games%rowtype;
  first_day date;
  today date;
  reg int;
  me public.hoops_players%rowtype;
  my_steps int;
  def_steps int;
  their_def text;
  last_day public.hoops_days%rowtype;
  status text;
  periods int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.hoops_games where challenge_id = p_challenge_id;
  if c.id is null or g.challenge_id is null then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller)
     and not exists (select 1 from public.hoops_players p where p.challenge_id = p_challenge_id and p.user_id = caller) then
    raise exception 'not authorized';
  end if;
  first_day := public.soccer_first_day(c);
  today := public.soccer_today(caller);
  reg := public.hoops_reg_days(g.days_per_quarter);
  status := case when g.status = 'final' then 'final' when today < first_day and g.days_played = 0 then 'upcoming' else 'live' end;
  periods := greatest(4, public.hoops_period_of(greatest(g.days_played, 1), g.days_per_quarter));

  select * into me from public.hoops_players p where p.challenge_id = p_challenge_id and p.user_id = caller;
  if me.id is not null and status = 'live' then
    my_steps := public.hoops_steps(p_challenge_id, caller, today);
    def_steps := coalesce((select public.hoops_steps(p_challenge_id, d.player_id, today) from public.hoops_players d where d.id = public.hoops_defender_of(me.id) and d.joined), 0);
    their_def := public.hoops_defense(p_challenge_id, case when me.team = 'home' then 'away' else 'home' end, today);
  end if;
  select * into last_day from public.hoops_days d where d.challenge_id = p_challenge_id order by d.day desc limit 1;

  return jsonb_build_object(
    'status', status,
    'first_day', first_day,
    'day_no', greatest(0, today - first_day + 1),
    'days', greatest(reg, g.days_played),
    'days_per_quarter', g.days_per_quarter,
    'shot_steps', g.shot_steps,
    'teams', jsonb_build_object(
      'home', jsonb_build_object('name', g.home_name, 'score', g.score_home),
      'away', jsonb_build_object('name', g.away_name, 'score', g.score_away)),
    'line', (select jsonb_agg(jsonb_build_object(
        'period', pr, 'label', public.hoops_label(pr),
        'home', (select sum(d.home) from public.hoops_days d where d.challenge_id = p_challenge_id and d.period = pr),
        'away', (select sum(d.away) from public.hoops_days d where d.challenge_id = p_challenge_id and d.period = pr),
        'played', (select count(*) from public.hoops_days d where d.challenge_id = p_challenge_id and d.period = pr)
                    >= case when pr <= 4 then g.days_per_quarter else 1 end)
      order by pr) from generate_series(1, periods) pr),
    'winner', g.winner_team,
    'me', me.id,
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'user_id', p.user_id,
        'name', public.hoops_name(p.id),
        'initials', coalesce(pr.initials, upper(left(b.name, 1))),
        'icon_id', pr.equipped_icon_id, 'frame_id', pr.equipped_frame_id, 'background_id', pr.equipped_background_id,
        'bot', p.bot_id is not null, 'team', p.team, 'guarding', p.guarding, 'shot', p.shot, 'joined', p.joined,
        'steps_today', case when p.joined then public.hoops_steps(p_challenge_id, p.player_id, today) else 0 end,
        'shots_today', case when p.joined then least(5, floor(public.hoops_steps(p_challenge_id, p.player_id, today)::numeric / g.shot_steps))::int else 0 end,
        'pts', coalesce(t.pts, 0), 'fg_made', coalesce(t.fg_made, 0), 'fg_att', coalesce(t.fg_att, 0),
        'three_made', coalesce(t.three_made, 0), 'three_att', coalesce(t.three_att, 0),
        'ft_made', coalesce(t.ft_made, 0), 'ft_att', coalesce(t.ft_att, 0))
      order by p.team, p.baseline desc, p.seated_at), '[]'::jsonb)
      from public.hoops_players p
      left join public.profiles pr on pr.id = p.user_id
      left join public.challenge_bots b on b.id = p.bot_id
      left join lateral (
        select sum(e.pts) as pts,
          count(*) filter (where e.kind <> 'ft' and e.made) as fg_made, count(*) filter (where e.kind <> 'ft') as fg_att,
          count(*) filter (where e.kind = 'three' and e.made) as three_made, count(*) filter (where e.kind = 'three') as three_att,
          count(*) filter (where e.kind = 'ft' and e.made) as ft_made, count(*) filter (where e.kind = 'ft') as ft_att
        from public.hoops_events e where e.challenge_id = p_challenge_id and e.shooter = p.id
      ) t on true
      where p.challenge_id = p_challenge_id),
    'my_odds', case when me.id is null or status <> 'live' then null else jsonb_build_object(
        'drive', round(public.hoops_chance('drive', my_steps, def_steps, their_def, my_steps >= 15000, false)::numeric, 2),
        'mid', round(public.hoops_chance('mid', my_steps, def_steps, their_def, false, false)::numeric, 2),
        'three', round(public.hoops_chance('three', my_steps, def_steps, their_def, false, false)::numeric, 2)) end,
    'hands_on', g.hands_on,
    -- 0206: your shots to take today, when you take your own.
    'live', case when g.hands_on and me.id is not null then public.hoops_live_state(p_challenge_id, caller) end,
    'my_vote', (select v.choice from public.hoops_votes v where v.challenge_id = p_challenge_id and v.day = today and v.user_id = caller),
    'team_votes', jsonb_build_object(
      'paint', (select count(*) from public.hoops_votes v where v.challenge_id = p_challenge_id and v.day = today and v.team = me.team and v.choice = 'paint'),
      'arc', (select count(*) from public.hoops_votes v where v.challenge_id = p_challenge_id and v.day = today and v.team = me.team and v.choice = 'arc')),
    'last', case when last_day.day is null then null else jsonb_build_object(
        'period', last_day.period, 'label', last_day.label, 'home', last_day.home, 'away', last_day.away,
        'events', public.hoops_events_json(p_challenge_id, null, last_day.day)) end
  );
end;
$$;

revoke execute on function public.hoops_view(uuid) from public, anon;
grant execute on function public.hoops_view(uuid) to authenticated;

-- ── Admin (0196's, plus shots taken by hand) ──

create or replace function public.admin_hoops_overview()
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
    'config', to_jsonb(public.hoops_cfg()),
    'hoops_live', (select count(*) from public.hoops_games g where g.status = 'active'),
    'hoops_7d', (select count(*) from public.hoops_games g join public.challenges c on c.id = g.challenge_id where c.created_at > now() - interval '7 days'),
    'hoops_all', (select count(*) from public.hoops_games),
    'players_7d', (select count(distinct p.user_id) from public.hoops_players p join public.challenges c on c.id = p.challenge_id
                   where p.user_id is not null and p.joined and c.created_at > now() - interval '7 days'),
    'shots_7d', (select count(*) from public.hoops_events e where e.created_at > now() - interval '7 days'),
    'dunks_7d', (select count(*) from public.hoops_events e where e.dunk and e.created_at > now() - interval '7 days'),
    'on_fire_7d', (select count(*) from public.hoops_events e where e.on_fire and e.created_at > now() - interval '7 days'),
    'horse_live', (select count(*) from public.horse_games g where g.status = 'active'),
    'horse_7d', (select count(*) from public.horse_games g join public.challenges c on c.id = g.challenge_id where c.created_at > now() - interval '7 days'),
    'horse_all', (select count(*) from public.horse_games),
    'bones_7d', (select coalesce(sum(e.bones_points), 0) from public.activity_events e
                 where e.kind in ('hoops_result', 'horse_result') and e.created_at > now() - interval '7 days'),
    -- 0206: shots taken by hand.
    'live', jsonb_build_object(
      'games_hands_on', (select count(*) from public.hoops_games g where g.hands_on and g.status = 'active'),
      'people_7d', (select count(distinct l.user_id) from public.hoops_live_shots l where l.created_at > now() - interval '7 days'),
      'shots_7d', (select count(*) from public.hoops_live_shots l where l.created_at > now() - interval '7 days'),
      'make_rate_7d', (select round(avg(case when l.made then 1.0 else 0.0 end), 3) from public.hoops_live_shots l where l.created_at > now() - interval '7 days'),
      'auto_make_rate_7d', (select round(avg(case when e.made then 1.0 else 0.0 end), 3) from public.hoops_events e
                            where not e.by_hand and e.kind in ('drive', 'mid', 'three') and e.created_at > now() - interval '7 days'),
      'swish_7d', (select count(*) from public.hoops_live_shots l where l.quality = 'swish' and l.created_at > now() - interval '7 days'))
  );
end;
$$;

revoke execute on function public.admin_hoops_overview() from public, anon;
grant execute on function public.admin_hoops_overview() to authenticated;
