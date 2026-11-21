-- 0234: Cricket, bat and bowl yourself (approved mockup
-- claude.ai/artifact/QUXJkAEQntumiEYV7kafn5). A match made with "Bat and
-- bowl yourself" (cricket_games.hands_on, set by the creator with
-- cricket_set_hands_on) lets people play today's over by hand:
--
--   balls       one per 1,000 steps so far today, up to 6 (an over).
--   batting     anyone on today's batting side. cricket_bowl_to_me()
--               delivers a ball, seeded: pace 50%, spin 35%, a yorker
--               15%; a yorker pitches at the toes, the rest full 30%, a
--               good length 45%, short 25%; a line across the stumps
--               (-0.55 off side .. 0.45 leg side; |line| <= 0.28 hits
--               them), and spin turns 0.1 - 0.35 after it pitches.
--               cricket_play_shot(timing_ms, miss) plays it: when you
--               tapped against the ball reaching the bat (null: you left
--               it) and how far your tap was from it (1 = the edge of the
--               bat). Past 230 ms early, 150 ms either way or 1.4 off:
--               missed (bowled if it was hitting the stumps); past 95 ms
--               or 1.0 off: an edge (caught behind 45%, else a single);
--               else q = (1 - miss) x (1 - |timing| / 110), a yorker
--               x 0.6, + 0.15 x (your share of the two players' steps -
--               0.5), + 0.2 x (power - 1): a six at 0.78 on a full or
--               short ball, a four at 0.55, two at 0.35, else caught 25%
--               of the time or a single. Early goes to the leg side,
--               late to the off side.
--   bowling     today's bowler. cricket_bowl(kind, aim_line,
--               aim_length, ring): where you aimed on the pitch (line as
--               above, length 0 at the batter's stumps to 1 at yours) and
--               how far the closing ring was from the circle (0 - 1).
--               It lands off your spot by (ring - 0.08) x 0.5 in a
--               seeded direction. The batter answers it at once, by the
--               mockup's table for where it landed: a good length on or
--               just outside off is the hardest to score off (dot 45%,
--               caught 15% (spin 20%), bowled 10% on the stumps), full
--               gets driven, short gets pulled, a yorker on the stumps
--               bowls them 32% of the time. The same ball again, or a
--               batter out-walking you, makes boundaries likelier.
--   tonight     cricket_play_day uses them ball by ball: the batter's own
--               ball first, then the bowler's, then the roll as before.
--               Balls not used that night are gone. cricket_balls.by_hand
--               marks which were.
--
-- Admin: admin_cricket_overview().
--
-- Run after 0233.

alter table public.cricket_games add column if not exists hands_on boolean not null default false;
alter table public.cricket_balls add column if not exists by_hand text check (by_hand in ('bat', 'bowl'));

create table public.cricket_hand_balls (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('bat', 'bowl')),
  day date not null,
  n int not null check (n >= 1),
  kind text not null check (kind in ('pace', 'spin', 'yorker')),
  length text not null check (length in ('yorker', 'full', 'good', 'short')),
  -- Where it pitched: across (|line| <= 0.28 hits the stumps; - the off
  -- side) and along (0 the batter's stumps .. 1 the bowler's).
  line double precision not null,
  bounce double precision not null,
  turn double precision not null default 0,
  mph int not null,
  ms int not null,
  -- Batting: the swing.
  timing_ms int,
  miss double precision,
  -- Bowling: the aim and the ring.
  aim_line double precision,
  aim_length double precision,
  ring double precision,
  -- Who it was against: the bowler (batting), the batter (bowling).
  opponent_id uuid,
  share double precision,
  outcome text check (outcome in ('0', '1', '2', '4', '6', 'W')),
  how text,
  used_innings int,
  used_over int,
  used_ball int,
  created_at timestamptz not null default now(),
  unique (challenge_id, user_id, role, day, n)
);
create index cricket_hand_balls_day_idx on public.cricket_hand_balls (challenge_id, day, user_id, role);
create index cricket_hand_balls_created_idx on public.cricket_hand_balls (created_at);
alter table public.cricket_hand_balls enable row level security;
revoke all on public.cricket_hand_balls from anon;
revoke insert, update, delete on public.cricket_hand_balls from authenticated;
create policy "People can view their own Cricket balls by hand"
  on public.cricket_hand_balls for select to authenticated
  using (user_id = auth.uid());

-- ── The creator's switch ──

create or replace function public.cricket_set_hands_on(p_challenge_id uuid, p_on boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.challenges c where c.id = p_challenge_id and c.kind = 'cricket' and c.created_by = auth.uid()) then
    raise exception 'Only the creator can change this match.';
  end if;
  if exists (select 1 from public.cricket_days d where d.challenge_id = p_challenge_id) then
    raise exception 'This match is under way.';
  end if;
  update public.cricket_games set hands_on = coalesce(p_on, false), updated_at = now() where challenge_id = p_challenge_id;
end;
$$;
revoke execute on function public.cricket_set_hands_on(uuid, boolean) from public, anon;
grant execute on function public.cricket_set_hands_on(uuid, boolean) to authenticated;

-- ── The numbers ──

create or replace function public.cricket_rand(p_seed text)
returns double precision
language sql
immutable
as $$
  select public.rally_js_rand(public.rally_js_hash(p_seed));
$$;
revoke execute on function public.cricket_rand(text) from public, anon, authenticated;

-- A shot: the ball, the swing, the batter's share of the steps and
-- power, and two rolls. {outcome, how}.
create or replace function public.cricket_shot_outcome(
  p_length text, p_line double precision, p_turn double precision, p_timing int, p_miss double precision,
  p_share double precision, p_power double precision, p_r1 double precision, p_r2 double precision
)
returns jsonb
language plpgsql
immutable
as $$
declare
  stumps boolean := abs(coalesce(p_line, 0) + coalesce(p_turn, 0)) <= 0.28 and p_length <> 'short';
  a double precision;
  m double precision := greatest(0, coalesce(p_miss, 0));
  q double precision;
  dir text;
  shot text;
begin
  if p_timing is null then
    return case when stumps then '{"outcome":"W","how":"bowled"}' else '{"outcome":"0","how":"left"}' end::jsonb;
  end if;
  a := abs(p_timing);
  if p_timing < -230 or m > 1.4 or a > 150 then
    return case when stumps then '{"outcome":"W","how":"bowled"}' else '{"outcome":"0","how":"beaten"}' end::jsonb;
  end if;
  if m > 1.0 or a > 95 then
    return case when p_r1 < 0.45 then '{"outcome":"W","how":"caught_behind"}' else '{"outcome":"1","how":"edge"}' end::jsonb;
  end if;
  q := greatest(0, 1 - m) * greatest(0, 1 - a / 110.0);
  if p_length = 'yorker' then
    q := q * 0.6;
  end if;
  q := q + 0.15 * (coalesce(p_share, 0.5) - 0.5) + 0.2 * (greatest(1, coalesce(p_power, 1)) - 1);
  dir := case when p_timing < -30 then 'leg' when p_timing > 30 then 'off' else 'straight' end;
  shot := case dir
    when 'leg' then case when p_length = 'short' then 'pulled' else 'flicked' end
    when 'off' then case when p_length = 'short' then 'cut' else 'driven' end
    else 'straight' end;
  if q >= 0.78 and p_length in ('short', 'full') then
    return jsonb_build_object('outcome', '6', 'how', shot);
  elsif q >= 0.55 then
    return jsonb_build_object('outcome', '4', 'how', shot);
  elsif q >= 0.35 then
    return jsonb_build_object('outcome', '2', 'how', shot);
  elsif p_r2 < 0.25 then
    return jsonb_build_object('outcome', 'W', 'how', 'caught');
  end if;
  return jsonb_build_object('outcome', '1', 'how', shot);
end;
$$;

-- A ball you bowled: where it landed, the kind, the batter's share of the
-- steps, the same ball again, and a roll. {outcome, how}.
create or replace function public.cricket_delivery_outcome(
  p_kind text, p_line double precision, p_bounce double precision, p_turn double precision,
  p_share double precision, p_same boolean, p_r double precision
)
returns jsonb
language plpgsql
immutable
as $$
declare
  len text := case when p_bounce < 0.09 then 'yorker' when p_bounce < 0.22 then 'full' when p_bounce < 0.4 then 'good' else 'short' end;
  x double precision := coalesce(p_line, 0) + coalesce(p_turn, 0);
  stumps boolean := abs(x) <= 0.28;
  corridor boolean := x < -0.28 and x > -0.65;
  wide boolean := abs(coalesce(p_line, 0)) > 0.95;
  bump double precision := (case when p_same then 12 else 0 end) + 40 * (coalesce(p_share, 0.5) - 0.5);
  w jsonb;
  tot double precision := 0;
  r double precision;
  e jsonb;
begin
  w := case
    when wide then jsonb_build_array(jsonb_build_array('0', 20), jsonb_build_array('1', 30), jsonb_build_array('4', greatest(5, 50 + bump)))
    when len = 'yorker' and stumps then jsonb_build_array(jsonb_build_array('bowled', case when p_kind = 'yorker' then 32 else 18 end),
      jsonb_build_array('0', 48), jsonb_build_array('1', greatest(5, 20 + bump)))
    when len = 'yorker' then jsonb_build_array(jsonb_build_array('0', 55), jsonb_build_array('1', 35), jsonb_build_array('4', greatest(2, 10 + bump)))
    when len = 'good' and (stumps or corridor) then jsonb_build_array(jsonb_build_array('0', 45),
      jsonb_build_array('caught', case when p_kind = 'spin' then 20 else 15 end), jsonb_build_array('bowled', case when stumps then 10 else 0 end),
      jsonb_build_array('1', 20), jsonb_build_array('4', greatest(2, 10 + bump)))
    when len = 'good' then jsonb_build_array(jsonb_build_array('0', 30), jsonb_build_array('1', 30), jsonb_build_array('2', 15),
      jsonb_build_array('4', greatest(5, 25 + bump)))
    when len = 'full' then jsonb_build_array(jsonb_build_array('0', 20), jsonb_build_array('1', 25), jsonb_build_array('2', 10),
      jsonb_build_array('4', greatest(5, 30 + bump)), jsonb_build_array('6', greatest(2, 10 + bump / 2)), jsonb_build_array('caught', 5))
    else jsonb_build_array(jsonb_build_array('0', 25), jsonb_build_array('1', 20), jsonb_build_array('4', greatest(5, 30 + bump)),
      jsonb_build_array('6', greatest(2, 15 + bump / 2)), jsonb_build_array('caught', 10))
  end;
  for e in select value from jsonb_array_elements(w) loop
    tot := tot + (e ->> 1)::double precision;
  end loop;
  r := coalesce(p_r, 0) * tot;
  for e in select value from jsonb_array_elements(w) loop
    r := r - (e ->> 1)::double precision;
    if r < 0 then
      return case e ->> 0
        when 'bowled' then jsonb_build_object('outcome', 'W', 'how', 'bowled', 'length', len)
        when 'caught' then jsonb_build_object('outcome', 'W', 'how', 'caught', 'length', len)
        else jsonb_build_object('outcome', e ->> 0, 'how', case when wide then 'wide' else len end, 'length', len) end;
    end if;
  end loop;
  return jsonb_build_object('outcome', '0', 'how', len, 'length', len);
end;
$$;

revoke execute on function public.cricket_shot_outcome(text, double precision, double precision, int, double precision, double precision, double precision, double precision, double precision) from public, anon;
revoke execute on function public.cricket_delivery_outcome(text, double precision, double precision, double precision, double precision, boolean, double precision) from public, anon;
grant execute on function public.cricket_shot_outcome(text, double precision, double precision, int, double precision, double precision, double precision, double precision, double precision) to authenticated;
grant execute on function public.cricket_delivery_outcome(text, double precision, double precision, double precision, double precision, boolean, double precision) to authenticated;

create or replace function public.cricket_name(p_challenge_id uuid, p_player uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select case when pr.use_username and pr.username is not null then pr.username else pr.name end
                     from public.profiles pr where pr.id = p_player),
                  (select b.name from public.challenge_bots b where b.id = p_player), 'Someone');
$$;
revoke execute on function public.cricket_name(uuid, uuid) from public, anon, authenticated;

-- ── Where a person stands today ──

create or replace function public.cricket_hand_state(p_challenge_id uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  c public.challenges%rowtype;
  g public.cricket_games%rowtype;
  me public.cricket_players%rowtype;
  today date;
  first_day date;
  os record;
  role text;
  reason text;
  steps int := 0;
  earned int := 0;
  taken int := 0;
  opp uuid;
  opp_steps int := 0;
  pend public.cricket_hand_balls%rowtype;
  balls_j jsonb := '[]'::jsonb;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.cricket_games where challenge_id = p_challenge_id;
  if c.id is null or g.challenge_id is null then
    raise exception 'not authorized';
  end if;
  today := public.soccer_today(p_user);
  first_day := public.soccer_first_day(c);
  select * into me from public.cricket_players p where p.challenge_id = p_challenge_id and p.user_id = p_user and p.joined;
  select * into os from public.cricket_on_strike(p_challenge_id) limit 1;

  if me.id is not null and os.innings is not null then
    role := case when os.bowler_id = p_user then 'bowl' when me.team = os.batting_team then 'bat' end;
  end if;
  if me.id is not null then
    steps := public.soccer_steps(p_challenge_id, me.player_id, today, first_day);
    earned := least(6, steps / 1000);
  end if;
  if role is not null then
    select count(*) into taken from public.cricket_hand_balls h
      where h.challenge_id = p_challenge_id and h.user_id = p_user and h.role = role and h.day = today and h.outcome is not null;
    select * into pend from public.cricket_hand_balls h
      where h.challenge_id = p_challenge_id and h.user_id = p_user and h.role = 'bat' and h.day = today and h.outcome is null
      order by h.n desc limit 1;
    opp := case when role = 'bat' then os.bowler_id else os.batter_id end;
    opp_steps := public.soccer_steps(p_challenge_id, opp, today, first_day);
    select coalesce(jsonb_agg(jsonb_build_object('n', h.n, 'outcome', h.outcome, 'how', h.how, 'kind', h.kind, 'used', h.used_over is not null) order by h.n), '[]'::jsonb)
      into balls_j
      from public.cricket_hand_balls h
      where h.challenge_id = p_challenge_id and h.user_id = p_user and h.role = role and h.day = today and h.outcome is not null;
  end if;

  reason := case
    when not g.hands_on then 'This match plays itself.'
    when me.id is null then 'You''re not playing in this match.'
    when g.status <> 'active' then 'This match is over.'
    when today < first_day then 'The match hasn''t started yet.'
    when exists (select 1 from public.cricket_days d where d.challenge_id = p_challenge_id and d.day = today)
      then 'Today''s over is already played.'
    when os.innings is null then 'No over today.'
    when role is null then 'You''re in the field today: ' || public.cricket_name(p_challenge_id, os.bowler_id) || ' has the ball.'
    when pend.id is not null then null
    when taken >= 6 then 'That''s your over today.'
    when earned - taken <= 0 then 'No balls ready: your next one comes at ' || to_char((taken + 1) * 1000, 'FM999,999') || ' steps.'
  end;

  return jsonb_build_object(
    'hands_on', g.hands_on,
    'role', role,
    'can_play', reason is null,
    'reason', reason,
    'day', today,
    'steps', steps,
    'earned', earned,
    'taken', taken,
    'ready', greatest(0, earned - taken),
    'next_at', case when earned < 6 then (earned + 1) * 1000 end,
    'innings', os.innings,
    'over_no', os.over_no,
    'overs', g.overs,
    'batting_team', os.batting_team,
    'my_team', me.team,
    'score', jsonb_build_object('runs', case when os.batting_team = 'a' then g.runs_a else g.runs_b end,
      'wickets', case when os.batting_team = 'a' then g.wickets_a else g.wickets_b end, 'target', g.target),
    'opponent', case when opp is not null then jsonb_build_object('name', public.cricket_name(p_challenge_id, opp), 'steps', opp_steps) end,
    'pending', case when pend.id is not null then jsonb_build_object('n', pend.n, 'kind', pend.kind, 'length', pend.length, 'line', pend.line,
      'bounce', pend.bounce, 'turn', pend.turn, 'mph', pend.mph, 'ms', pend.ms) end,
    'balls', balls_j,
    '_os_batter', os.batter_id,
    '_os_bowler', os.bowler_id,
    '_player', me.player_id,
    '_first_day', first_day,
    '_opp_steps', opp_steps,
    '_pending', pend.id
  );
end;
$$;
revoke execute on function public.cricket_hand_state(uuid, uuid) from public, anon, authenticated;

create or replace function public.cricket_hand(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller) then
    raise exception 'not authorized';
  end if;
  return public.cricket_hand_state(p_challenge_id, caller) - array['_os_batter', '_os_bowler', '_player', '_first_day', '_opp_steps', '_pending'];
end;
$$;
revoke execute on function public.cricket_hand(uuid) from public, anon;
grant execute on function public.cricket_hand(uuid) to authenticated;

-- ── Batting: a ball bowled to you, then your shot ──

create or replace function public.cricket_bowl_to_me(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  s jsonb;
  n int;
  seed text;
  k text;
  len text;
  r double precision;
  line double precision;
  turn double precision := 0;
  b public.cricket_hand_balls%rowtype;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  perform 1 from public.challenges where id = p_challenge_id for share;
  perform 1 from public.cricket_players p where p.challenge_id = p_challenge_id and p.user_id = caller for update;
  s := public.cricket_hand_state(p_challenge_id, caller);
  if not (s ->> 'can_play')::boolean then
    raise exception '%', s ->> 'reason';
  end if;
  if s ->> 'role' <> 'bat' then
    raise exception 'You''re bowling today: bowl your over.';
  end if;
  if s ->> '_pending' is not null then
    return s -> 'pending';
  end if;
  n := coalesce((select max(h.n) from public.cricket_hand_balls h where h.challenge_id = p_challenge_id and h.user_id = caller
                 and h.role = 'bat' and h.day = (s ->> 'day')::date), 0) + 1;
  seed := p_challenge_id::text || ':' || caller || ':' || (s ->> 'day') || ':bat:' || n;
  r := public.cricket_rand(seed || ':kind');
  k := case when r < 0.5 then 'pace' when r < 0.85 then 'spin' else 'yorker' end;
  r := public.cricket_rand(seed || ':len');
  len := case when k = 'yorker' then 'yorker' when r < 0.3 then 'full' when r < 0.75 then 'good' else 'short' end;
  line := -0.55 + public.cricket_rand(seed || ':line');
  if k = 'spin' then
    turn := (case when public.cricket_rand(seed || ':way') < 0.5 then -1 else 1 end) * (0.1 + 0.25 * public.cricket_rand(seed || ':turn'));
  end if;
  insert into public.cricket_hand_balls (challenge_id, user_id, role, day, n, kind, length, line, bounce, turn, mph, ms, opponent_id)
    values (p_challenge_id, caller, 'bat', (s ->> 'day')::date, n, k, len, round(line::numeric, 3), case len when 'yorker' then 0.05 when 'full' then 0.16 when 'good' then 0.3 else 0.5 end,
      round(turn::numeric, 3),
      case k when 'spin' then 48 + floor(public.cricket_rand(seed || ':mph') * 8)::int else 82 + floor(public.cricket_rand(seed || ':mph') * 9)::int end,
      case k when 'pace' then 640 when 'spin' then 960 else 620 end,
      (s ->> '_os_bowler')::uuid)
    returning * into b;
  return jsonb_build_object('n', b.n, 'kind', b.kind, 'length', b.length, 'line', b.line, 'bounce', b.bounce, 'turn', b.turn, 'mph', b.mph, 'ms', b.ms);
end;
$$;
revoke execute on function public.cricket_bowl_to_me(uuid) from public, anon;
grant execute on function public.cricket_bowl_to_me(uuid) to authenticated;

-- p_timing_ms: when you tapped against the ball reaching the bat (−
-- early, + late), null when you left it; p_miss: how far your tap was from
-- the ball (1 = the edge of the bat).
create or replace function public.cricket_play_shot(p_challenge_id uuid, p_timing_ms int, p_miss double precision)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  caller uuid := auth.uid();
  s jsonb;
  b public.cricket_hand_balls%rowtype;
  t int;
  mine int;
  opp int;
  share double precision;
  bb record;
  pw double precision;
  seed text;
  res jsonb;
  o text;
  how text;
  msg text;
  names jsonb := '{"pulled":"pulled","flicked":"flicked off the pads","cut":"cut","driven":"driven through the covers","straight":"driven straight"}';
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  perform 1 from public.challenges where id = p_challenge_id for share;
  perform 1 from public.cricket_players p where p.challenge_id = p_challenge_id and p.user_id = caller for update;
  s := public.cricket_hand_state(p_challenge_id, caller);
  if s ->> '_pending' is null then
    raise exception 'Bowl it first.';
  end if;
  if not (s ->> 'can_play')::boolean then
    raise exception '%', s ->> 'reason';
  end if;
  select * into b from public.cricket_hand_balls where id = (s ->> '_pending')::uuid for update;
  t := case when p_timing_ms is null then null else least(2000, greatest(-2000, p_timing_ms)) end;
  mine := (s ->> 'steps')::int;
  opp := coalesce((s ->> '_opp_steps')::int, 0);
  share := case when mine + opp = 0 then 0.5 else mine::double precision / (mine + opp) end;
  select * into bb from public.sport_bonus_for(p_challenge_id, (s ->> '_player')::uuid, (s ->> 'day')::date, 'cricket');
  pw := 1 + 0.25 * coalesce(bb.strength, 0);
  seed := p_challenge_id::text || ':' || caller || ':' || b.day || ':bat:' || b.n;
  res := public.cricket_shot_outcome(b.length, b.line, b.turn, t, p_miss, share, pw,
    public.cricket_rand(seed || ':r1'), public.cricket_rand(seed || ':r2'));
  o := res ->> 'outcome';
  how := res ->> 'how';
  msg := case
    when how = 'bowled' then case when t is null then 'You left it, and it hit the stumps. Bowled!' else 'Played and missed, and it hit the stumps. Bowled!' end
    when how = 'left' then 'Left alone: outside the stumps. A good leave.'
    when how = 'beaten' then 'Played and missed: beaten.'
    when how = 'caught_behind' then 'An edge, and the keeper takes it. Caught behind.'
    when how = 'edge' then 'A thick edge runs down to third man for one.'
    when how = 'caught' then 'Didn''t quite get hold of it: straight to the fielder. Caught.'
    when o = '6' then 'Middled it: ' || (names ->> how) || ' for SIX!'
    when o = '4' then 'Middled it: ' || (names ->> how) || ' for FOUR!'
    when o = '2' then (initcap(names ->> how)) || ' for two.'
    else (initcap(names ->> how)) || ' for a single.' end;
  update public.cricket_hand_balls set timing_ms = t, miss = case when t is null then null else p_miss end, share = share,
    outcome = o, how = how
  where id = b.id;
  s := public.cricket_hand_state(p_challenge_id, caller);
  return jsonb_build_object('outcome', o, 'how', how, 'runs', case when o = 'W' then 0 else o::int end, 'message', msg,
    'timing', t, 'miss', p_miss, 'ready', s -> 'ready', 'taken', s -> 'taken', 'balls', s -> 'balls');
end;
$$;
revoke execute on function public.cricket_play_shot(uuid, int, double precision) from public, anon;
grant execute on function public.cricket_play_shot(uuid, int, double precision) to authenticated;

-- ── Bowling: your over, a ball at a time ──

create or replace function public.cricket_bowl(p_challenge_id uuid, p_kind text, p_aim_line double precision, p_aim_length double precision, p_ring double precision)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  s jsonb;
  n int;
  seed text;
  ring double precision;
  miss double precision;
  ang double precision;
  line double precision;
  bounce double precision;
  turn double precision := 0;
  prev record;
  mine int;
  opp int;
  share double precision;
  res jsonb;
  o text;
  how text;
  len text;
  msg text;
  grade text;
  lens jsonb := '{"yorker":"a yorker","full":"full","good":"a good length","short":"short"}';
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  perform 1 from public.challenges where id = p_challenge_id for share;
  perform 1 from public.cricket_players p where p.challenge_id = p_challenge_id and p.user_id = caller for update;
  s := public.cricket_hand_state(p_challenge_id, caller);
  if not (s ->> 'can_play')::boolean then
    raise exception '%', s ->> 'reason';
  end if;
  if s ->> 'role' <> 'bowl' then
    raise exception 'You''re batting today: play your shots.';
  end if;
  if p_kind is null or p_kind not in ('pace', 'spin', 'yorker') then
    raise exception 'Pick a ball: pace, spin or a yorker.';
  end if;
  n := coalesce((select max(h.n) from public.cricket_hand_balls h where h.challenge_id = p_challenge_id and h.user_id = caller
                 and h.role = 'bowl' and h.day = (s ->> 'day')::date), 0) + 1;
  seed := p_challenge_id::text || ':' || caller || ':' || (s ->> 'day') || ':bowl:' || n;
  ring := least(1, greatest(0, coalesce(p_ring, 1)));
  miss := greatest(0, ring - 0.08) * 0.5;
  ang := public.cricket_rand(seed || ':ang') * 2 * pi();
  line := least(1.2, greatest(-1.2, coalesce(p_aim_line, 0))) + cos(ang) * miss * 1.4;
  bounce := greatest(0.02, least(0.7, coalesce(p_aim_length, 0.3)) + sin(ang) * miss * 0.4);
  if p_kind = 'spin' then
    turn := (case when public.cricket_rand(seed || ':way') < 0.5 then -1 else 1 end) * (0.15 + 0.2 * public.cricket_rand(seed || ':turn'));
  end if;
  select h.kind, h.length into prev from public.cricket_hand_balls h
    where h.challenge_id = p_challenge_id and h.user_id = caller and h.role = 'bowl' and h.day = (s ->> 'day')::date
    order by h.n desc limit 1;
  mine := (s ->> 'steps')::int;
  opp := coalesce((s ->> '_opp_steps')::int, 0);
  share := case when mine + opp = 0 then 0.5 else opp::double precision / (mine + opp) end;
  len := case when bounce < 0.09 then 'yorker' when bounce < 0.22 then 'full' when bounce < 0.4 then 'good' else 'short' end;
  res := public.cricket_delivery_outcome(p_kind, line, bounce, turn, share, prev.kind = p_kind and prev.length = len, public.cricket_rand(seed || ':r'));
  o := res ->> 'outcome';
  how := res ->> 'how';
  grade := case when ring <= 0.08 then 'Right on your spot' when ring <= 0.25 then 'Close to your spot' else 'Missed your spot' end;
  msg := grade || ': ' || p_kind || ', ' || (lens ->> len) || case
    when abs(line + turn) <= 0.28 then ', on the stumps. '
    when line + turn < -0.28 and line + turn > -0.65 then ', just outside off. '
    when abs(line) > 0.95 then ', way too wide. '
    else ', wide of the stumps. ' end
    || case
      when how = 'bowled' then 'Through the gate: bowled!'
      when how = 'caught' then 'Found the edge: caught!'
      when o = '0' then 'Nothing to hit: a dot ball.'
      when o in ('4', '6') then case when prev.kind = p_kind and prev.length = len then 'They''d seen that one: mix it up.'
        when len = 'short' then 'Too short: pulled away.' when len = 'full' then 'Too full: driven.' else 'Put away.' end
      else 'Worked away for ' || case o when '1' then 'one.' else o || '.' end end;
  insert into public.cricket_hand_balls (challenge_id, user_id, role, day, n, kind, length, line, bounce, turn, mph, ms,
      aim_line, aim_length, ring, opponent_id, share, outcome, how)
    values (p_challenge_id, caller, 'bowl', (s ->> 'day')::date, n, p_kind, len, round(line::numeric, 3), round(bounce::numeric, 3), round(turn::numeric, 3),
      case p_kind when 'spin' then 52 else 86 end, case p_kind when 'pace' then 640 when 'spin' then 960 else 620 end,
      p_aim_line, p_aim_length, ring, (s ->> '_os_batter')::uuid, share, o, how);
  s := public.cricket_hand_state(p_challenge_id, caller);
  return jsonb_build_object('outcome', o, 'how', how, 'length', len, 'line', round(line::numeric, 3), 'bounce', round(bounce::numeric, 3),
    'turn', round(turn::numeric, 3), 'grade', grade, 'message', msg, 'batter', s -> 'opponent' -> 'name',
    'ready', s -> 'ready', 'taken', s -> 'taken', 'balls', s -> 'balls');
end;
$$;
revoke execute on function public.cricket_bowl(uuid, text, double precision, double precision, double precision) from public, anon;
grant execute on function public.cricket_bowl(uuid, text, double precision, double precision, double precision) to authenticated;

-- ── Tonight's over (0198's, plus the balls played by hand) ──

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
  -- 0234: balls played by hand.
  hands boolean := coalesce((select cg.hands_on from public.cricket_games cg where cg.challenge_id = p_challenge_id), false);
  hb public.cricket_hand_balls%rowtype;
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
    -- 0234: the batter's own ball by hand first, then the bowler's.
    hb.id := null;
    hb.role := null;
    if hands then
      select * into hb from public.cricket_hand_balls h
        where h.challenge_id = p_challenge_id and h.role = 'bat' and h.user_id = batter and h.day = p_day
          and h.outcome is not null and h.used_over is null
        order by h.n limit 1 for update;
      if hb.id is null then
        select * into hb from public.cricket_hand_balls h
          where h.challenge_id = p_challenge_id and h.role = 'bowl' and h.user_id = bowler and h.day = p_day
            and h.outcome is not null and h.used_over is null
          order by h.n limit 1 for update;
      end if;
    end if;
    if hb.id is not null then
      outcome := hb.outcome;
      update public.cricket_hand_balls set used_innings = g.innings, used_over = over_no, used_ball = ball where id = hb.id;
    elsif edge = 0 and pw = 1 then
      outcome := public.cricket_ball_outcome(share, roll);
    else
      outcome := public.cricket_ball_outcome(least(1, greatest(0, share + edge)), roll, pw);
    end if;
    insert into public.cricket_balls (challenge_id, day, day_no, innings, over_no, ball_no, batting_team, batter_id, bowler_id, batter_steps, bowler_steps, outcome, runs, bonus, by_hand)
      values (p_challenge_id, p_day, p_day_no, g.innings, over_no, ball, bt, batter, bowler, b, w, outcome,
              case when outcome = 'W' then 0 else outcome::int end,
              case when bb.game_day then 'game_day' when bb.strength > 0 then 'power' end,
              case when hb.id is not null then hb.role end);
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

-- ── Admin ──

create or replace function public.admin_cricket_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return (
    with h as (select * from public.cricket_hand_balls x where x.created_at > now() - interval '7 days' and x.outcome is not null)
    select jsonb_build_object(
      'active', (select count(*) from public.cricket_games g where g.status = 'active'),
      'finished', (select count(*) from public.cricket_games g where g.status = 'final'),
      'hands_on', (select count(*) from public.cricket_games g where g.status = 'active' and g.hands_on),
      'chased', (select count(*) from public.cricket_games g where g.result = 'chased'),
      'defended', (select count(*) from public.cricket_games g where g.result = 'defended'),
      'ties', (select count(*) from public.cricket_games g where g.result = 'tie'),
      'batters_7d', (select count(distinct h.user_id) from h where h.role = 'bat'),
      'bowlers_7d', (select count(distinct h.user_id) from h where h.role = 'bowl'),
      'bat_balls_7d', (select count(*) from h where h.role = 'bat'),
      'bowl_balls_7d', (select count(*) from h where h.role = 'bowl'),
      'sixes_7d', (select count(*) from h where h.role = 'bat' and h.outcome = '6'),
      'fours_7d', (select count(*) from h where h.role = 'bat' and h.outcome = '4'),
      'outs_batting_7d', (select count(*) from h where h.role = 'bat' and h.outcome = 'W'),
      'wickets_bowling_7d', (select count(*) from h where h.role = 'bowl' and h.outcome = 'W'),
      'used_7d', (select count(*) from h where h.used_over is not null),
      'runs_per_ball_hand', (select round(avg(b.runs)::numeric, 2) from public.cricket_balls b where b.by_hand is not null and b.created_at > now() - interval '7 days'),
      'runs_per_ball_rolled', (select round(avg(b.runs)::numeric, 2) from public.cricket_balls b where b.by_hand is null and b.created_at > now() - interval '7 days')
    )
  );
end;
$$;
revoke execute on function public.admin_cricket_overview() from public, anon;
grant execute on function public.admin_cricket_overview() to authenticated;
