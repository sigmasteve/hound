-- Hound: real boxing in Hound Bout and the Title Bout (the same ring).
-- Playable prototype: claude.ai/artifact/UhZUFuQSocRai4ekSoXXy4.
--
--   actions     10 a day: one per 1,500 steps (2 more after 20 minutes of
--               cardio). An action is an exchange or defending a combination.
--   exchange    ring_exchange_start: three openings on the opponent, chosen
--               by their guard (a high guard shows the chin, a body guard the
--               sides of the head, a counter guard easy jabs that are bait).
--               ring_exchange_punch, one per opening, as you tap: where the
--               opening is picks the punch (face jab 1, side of the head hook
--               2, chin uppercut 3); how far the ring had closed picks the
--               quality (early: a miss; nearly closed: perfect). A clean hook
--               into a high guard or uppercut into a body guard is blocked; a
--               clean jab into a counter guard is caught (+1 to them); perfect
--               beats any guard.
--   stars       up to 3 (ring_stars). A Star punch doubles a punch's points
--               and counts as two power punches; it costs a star whether it
--               lands or not. Earned by counters; one lost for each punch you
--               take while defending; all lost when knocked down.
--   defending   ring_defend_start: their oldest combination with anything
--               that got through. ring_defend_finish: for each punch, the way
--               you moved and when (ms from the strike): a jab, slip left or
--               right; a hook, away from it or duck; an uppercut, lean back.
--               In time (320 ms before to 140 after) it's slipped; in the last
--               170 ms it's tight, and each tight slip allows a counter (+2,
--               a star). Anything not slipped by the round's scoring lands.
--   knockdowns  a combination that lands all three with two power punches,
--               or three power (a Star punch is two); after a strength
--               workout, two power. Three down in a round is a KO, as before.
--
-- Running fights switch over today: punches already thrown today still
-- count, and ones still waiting to be slipped are grouped into
-- combinations the other hound can face in the new ring.
--
-- Run this once, after 0229, in the SQL Editor.

create table public.ring_exchanges (
  id bigserial primary key,
  game text not null check (game in ('bout', 'titlebout')),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  round int,
  fight_id bigint references public.tb_fights (id) on delete cascade,
  day date not null,
  attacker uuid not null references public.profiles (id) on delete cascade,
  -- null: a sparring hound (the Title Bout).
  defender uuid references public.profiles (id) on delete cascade,
  guard text not null,
  openings jsonb not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  defend_day date,
  defend_started_at timestamptz,
  defended_at timestamptz,
  -- Punches thrown with the old meter, grouped into a combination when
  -- this ran: they still count one action each.
  legacy boolean not null default false
);
create index ring_exchanges_attacker on public.ring_exchanges (challenge_id, attacker, day);
create index ring_exchanges_defender on public.ring_exchanges (challenge_id, defender, defend_started_at);
create index ring_exchanges_at on public.ring_exchanges (started_at desc);

create table public.ring_stars (
  game text not null check (game in ('bout', 'titlebout')),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  stars int not null default 0 check (stars between 0 and 3),
  primary key (game, challenge_id, user_id)
);

alter table public.ring_exchanges enable row level security;
alter table public.ring_stars enable row level security;
revoke all on public.ring_exchanges, public.ring_stars from anon, authenticated;

alter table public.bout_punches
  add column if not exists exchange_id bigint references public.ring_exchanges (id) on delete set null,
  add column if not exists seq int,
  add column if not exists side text check (side in ('L', 'R')),
  add column if not exists star boolean not null default false,
  add column if not exists counter boolean not null default false,
  add column if not exists slip_dir text;
alter table public.tb_punches
  add column if not exists exchange_id bigint references public.ring_exchanges (id) on delete set null,
  add column if not exists seq int,
  add column if not exists side text check (side in ('L', 'R')),
  add column if not exists star boolean not null default false,
  add column if not exists counter boolean not null default false,
  add column if not exists slip_dir text;
create index if not exists bout_punches_exchange on public.bout_punches (exchange_id, seq);
create index if not exists tb_punches_exchange on public.tb_punches (exchange_id, seq);

-- ── The day: 10 actions ──

create or replace function public.ring_used(p_game text, p_challenge_id uuid, p_user uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select (select count(*) from public.ring_exchanges x where x.game = p_game and x.challenge_id = p_challenge_id and x.attacker = p_user and x.day = p_day and not x.legacy)::int
       + (select count(*) from public.ring_exchanges x where x.game = p_game and x.challenge_id = p_challenge_id and x.defender = p_user and x.defend_day = p_day)::int
       + case when p_game = 'bout' then
           (select count(*) from public.bout_punches x where x.challenge_id = p_challenge_id and x.user_id = p_user and x.day = p_day
              and (x.exchange_id is null or exists (select 1 from public.ring_exchanges e where e.id = x.exchange_id and e.legacy)))::int
         + (select count(*) from public.bout_punches x where x.challenge_id = p_challenge_id and x.target = p_user and x.slip in ('slipped', 'missed') and x.slip_day = p_day and x.slip_dir is null)::int
         else
           (select count(*) from public.tb_punches x where x.challenge_id = p_challenge_id and x.user_id = p_user and x.day = p_day
              and (x.exchange_id is null or exists (select 1 from public.ring_exchanges e where e.id = x.exchange_id and e.legacy)))::int
         + (select count(*) from public.tb_punches x where x.challenge_id = p_challenge_id and x.target = p_user and x.slip in ('slipped', 'missed') and x.slip_day = p_day and x.slip_dir is null)::int
         end;
$$;
revoke execute on function public.ring_used(text, uuid, uuid, date) from public, anon, authenticated;

create or replace function public.ring_day(p_game text, p_challenge_id uuid, p_user uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  steps int := public.derby_steps_today(p_challenge_id, p_user, p_day);
  b record;
  cardio int := public.bout_cardio_min(p_user, p_day);
  earned int;
  used int := public.ring_used(p_game, p_challenge_id, p_user, p_day);
begin
  select * into b from public.sport_day_bonus(p_user, p_day, 'bout');
  earned := least(10, steps / 1500) + case when cardio >= 20 then 2 else 0 end;
  return jsonb_build_object('steps', steps, 'earned', earned, 'used', used, 'left', greatest(0, earned - used),
    'next_at', case when steps >= 15000 then null else (steps / 1500 + 1) * 1500 end,
    'cardio', cardio >= 20, 'cardio_min', cardio,
    'strength', coalesce(b.strength, 0) > 0, 'camp', coalesce(b.game_day, false), 'camp_workout', b.workout,
    'kd_needs', case when coalesce(b.strength, 0) > 0 then 2 else 3 end);
end;
$$;
revoke execute on function public.ring_day(text, uuid, uuid, date) from public, anon, authenticated;

create or replace function public.bout_day(p_challenge_id uuid, p_user uuid, p_day date)
returns jsonb language sql stable security definer set search_path = public
as $$ select public.ring_day('bout', p_challenge_id, p_user, p_day); $$;
revoke execute on function public.bout_day(uuid, uuid, date) from public, anon, authenticated;

create or replace function public.tb_day(p_challenge_id uuid, p_user uuid, p_day date)
returns jsonb language sql stable security definer set search_path = public
as $$ select public.ring_day('titlebout', p_challenge_id, p_user, p_day); $$;
revoke execute on function public.tb_day(uuid, uuid, date) from public, anon, authenticated;

-- 0225's and 0227's, with 10 the most a day.
create or replace function public.bout_reason(p_challenge_id uuid, p_user uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.bout_games%rowtype;
  today date;
  rnd int;
  dy jsonb;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.bout_games where challenge_id = p_challenge_id;
  if g.challenge_id is null or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = p_user) then
    return 'You''re not in this fight.';
  end if;
  if g.status <> 'active' then
    return 'The fight is over.';
  end if;
  if (select count(*) from public.challenge_participants cp where cp.challenge_id = p_challenge_id) < 2 then
    return 'Waiting for your opponent to join.';
  end if;
  today := public.soccer_today(p_user);
  rnd := today - public.soccer_first_day(c) + 1;
  if rnd < 1 then
    return 'The fight starts ' || to_char(public.soccer_first_day(c), 'FMDay') || '.';
  end if;
  if rnd > g.rounds or rnd <= g.rounds_played then
    return 'That round''s over: the scores come in tonight.';
  end if;
  dy := public.bout_day(p_challenge_id, p_user, today);
  if (dy ->> 'left')::int <= 0 then
    if (dy ->> 'earned')::int >= 10 then
      return 'That''s every action today. Back tomorrow.';
    end if;
    return 'No actions ready: your next comes at ' || to_char((dy ->> 'next_at')::int, 'FM999,999') || ' steps.';
  end if;
  return null;
end;
$$;
revoke execute on function public.bout_reason(uuid, uuid) from public, anon, authenticated;

create or replace function public.tb_reason(p_challenge_id uuid, p_user uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.tb_games%rowtype;
  today date;
  dn int;
  f public.tb_fights%rowtype;
  dy jsonb;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.tb_games where challenge_id = p_challenge_id;
  if g.challenge_id is null or not exists (select 1 from public.tb_players p where p.challenge_id = p_challenge_id and p.user_id = p_user) then
    return 'Join the Title Bout to fight.';
  end if;
  if g.status <> 'active' then
    return 'The Title Bout is over.';
  end if;
  today := public.soccer_today(p_user);
  dn := public.tb_day_no(c, today);
  if dn < 1 then
    return 'The first bell rings ' || to_char(public.soccer_first_day(c), 'FMDay') || '.';
  end if;
  if dn > 7 then
    return 'The Title Bout is over.';
  end if;
  f := public.tb_fight_for(p_challenge_id, p_user, today);
  if f.id is null then
    return 'Your first fight is tomorrow.';
  end if;
  if f.scored_at is not null then
    return 'Today''s fight has been scored.';
  end if;
  dy := public.tb_day(p_challenge_id, p_user, today);
  if (dy ->> 'left')::int <= 0 then
    if (dy ->> 'earned')::int >= 10 then
      return 'That''s every action today. Back tomorrow.';
    end if;
    return 'No actions ready: your next comes at ' || to_char((dy ->> 'next_at')::int, 'FM999,999') || ' steps.';
  end if;
  return null;
end;
$$;
revoke execute on function public.tb_reason(uuid, uuid) from public, anon, authenticated;

-- ── Helpers ──

-- Three openings for an exchange, by the defender's guard; never the same
-- spot twice running.
create or replace function public.ring_openings(p_guard text)
returns jsonb
language plpgsql
volatile
as $$
declare
  w jsonb := case p_guard
    when 'body' then '[["hookL",30],["hookR",30],["jab",30],["up",10]]'::jsonb
    when 'counter' then '[["jab",50],["hookL",15],["hookR",15],["up",20]]'::jsonb
    else '[["up",45],["jab",35],["hookL",10],["hookR",10]]'::jsonb end;
  out jsonb := '[]'::jsonb;
  prev text := null;
  tot numeric;
  r numeric;
  e jsonb;
  pick text;
begin
  for i in 1..3 loop
    select sum((x ->> 1)::numeric) into tot from jsonb_array_elements(w) x where x ->> 0 is distinct from prev;
    r := random() * tot;
    pick := null;
    for e in select x from jsonb_array_elements(w) x where x ->> 0 is distinct from prev loop
      r := r - (e ->> 1)::numeric;
      if r <= 0 then pick := e ->> 0; exit; end if;
    end loop;
    pick := coalesce(pick, 'jab');
    out := out || jsonb_build_array(pick);
    prev := pick;
  end loop;
  return out;
end;
$$;
revoke execute on function public.ring_openings(text) from public, anon, authenticated;

-- Moving the right way: a jab, either side; an uppercut, lean back; a
-- hook from their left hand (side 'L', at your right), slip left or duck.
create or replace function public.ring_dodge_ok(p_punch text, p_side text, p_dir text)
returns boolean language sql immutable as $$
  select case p_punch
    when 'jab' then p_dir in ('left', 'right')
    when 'up' then p_dir = 'back'
    else (p_side = 'L' and p_dir in ('left', 'duck')) or (p_side is distinct from 'L' and p_dir in ('right', 'duck')) end;
$$;
revoke execute on function public.ring_dodge_ok(text, text, text) from public, anon, authenticated;

create or replace function public.ring_stars_of(p_game text, p_challenge_id uuid, p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select s.stars from public.ring_stars s where s.game = p_game and s.challenge_id = p_challenge_id and s.user_id = p_user), 0);
$$;
revoke execute on function public.ring_stars_of(text, uuid, uuid) from public, anon, authenticated;

create or replace function public.ring_set_stars(p_game text, p_challenge_id uuid, p_user uuid, p_stars int)
returns int language sql security definer set search_path = public as $$
  insert into public.ring_stars (game, challenge_id, user_id, stars) values (p_game, p_challenge_id, p_user, greatest(0, least(3, p_stars)))
    on conflict (game, challenge_id, user_id) do update set stars = excluded.stars
  returning stars;
$$;
revoke execute on function public.ring_set_stars(text, uuid, uuid, int) from public, anon, authenticated;

-- Where the caller fights today: the reason they can't (or null), the
-- round or Title Bout fight, the opponent (null: a sparring hound) and
-- the opponent's guard.
create or replace function public.ring_ctx(p_game text, p_challenge_id uuid, p_user uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  today date := public.soccer_today(p_user);
  other uuid;
  f public.tb_fights%rowtype;
  v_reason text;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if c.id is null or c.kind::text <> p_game then
    raise exception 'That isn''t this fight.';
  end if;
  if p_game = 'bout' then
    v_reason := public.bout_reason(p_challenge_id, p_user);
    select cp.user_id into other from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id <> p_user limit 1;
    return jsonb_build_object('reason', v_reason, 'day', today, 'round', today - public.soccer_first_day(c) + 1, 'fight', null, 'opp', other,
      'guard', case when other is null then 'high' else public.bout_guard_on(p_challenge_id, other, public.soccer_today(other)) end);
  end if;
  v_reason := public.tb_reason(p_challenge_id, p_user);
  if v_reason is null or v_reason like 'No actions%' or v_reason like 'That''s every%' then
    f := public.tb_fight_for(p_challenge_id, p_user, today);
  end if;
  other := case when f.id is null then null when f.a = p_user then f.b else f.a end;
  return jsonb_build_object('reason', v_reason, 'day', today, 'round', f.round, 'fight', f.id, 'opp', other,
    'guard', case when f.id is null then 'high' when other is null then public.tb_bot_guard(f.id) else public.tb_guard_on(p_challenge_id, other, public.soccer_today(other)) end);
end;
$$;
revoke execute on function public.ring_ctx(text, uuid, uuid) from public, anon, authenticated;

-- Combinations waiting for someone to face: theirs to defend, finished
-- (or abandoned a couple of minutes back), in a round or fight not yet
-- scored, with something that got through.
create or replace function public.ring_waiting(p_game text, p_challenge_id uuid, p_user uuid)
returns setof public.ring_exchanges
language sql
stable
security definer set search_path = public
as $$
  select x.* from public.ring_exchanges x
  where x.game = p_game and x.challenge_id = p_challenge_id and x.defender = p_user and x.defend_started_at is null
    and (x.finished_at is not null or x.started_at < now() - interval '2 minutes')
    and case when p_game = 'bout'
      then x.round > coalesce((select g.rounds_played from public.bout_games g where g.challenge_id = p_challenge_id), 0)
        and exists (select 1 from public.bout_punches p where p.exchange_id = x.id and p.user_id = x.attacker
                      and p.quality <> 'miss' and not p.blocked and not p.countered and p.slip is null)
      else (select f.scored_at from public.tb_fights f where f.id = x.fight_id) is null
        and exists (select 1 from public.tb_punches p where p.exchange_id = x.id and p.user_id = x.attacker
                      and p.quality <> 'miss' and not p.blocked and not p.countered and p.slip is null) end
  order by x.started_at;
$$;
revoke execute on function public.ring_waiting(text, uuid, uuid) from public, anon, authenticated;

-- ── Throwing ──

create or replace function public.ring_exchange_start(p_game text, p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  ctx jsonb;
  x public.ring_exchanges%rowtype;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  ctx := public.ring_ctx(p_game, p_challenge_id, caller);
  if ctx ->> 'reason' is not null then
    raise exception '%', ctx ->> 'reason';
  end if;
  insert into public.ring_exchanges (game, challenge_id, round, fight_id, day, attacker, defender, guard, openings)
    values (p_game, p_challenge_id, (ctx ->> 'round')::int, (ctx ->> 'fight')::bigint, (ctx ->> 'day')::date, caller,
            (ctx ->> 'opp')::uuid, ctx ->> 'guard', public.ring_openings(ctx ->> 'guard'))
    returning * into x;
  return jsonb_build_object('id', x.id, 'openings', x.openings, 'stars', public.ring_stars_of(p_game, p_challenge_id, caller),
    'left', greatest(0, (public.ring_day(p_game, p_challenge_id, caller, x.day) ->> 'left')::int));
end;
$$;
revoke execute on function public.ring_exchange_start(text, uuid) from public, anon;
grant execute on function public.ring_exchange_start(text, uuid) to authenticated;

-- One punch of an exchange, as it's thrown. p_progress: how far the
-- opening's ring had closed (0..1, a little over in the grace after), or
-- null for a swing at the wrong spot or no tap.
create or replace function public.ring_exchange_punch(p_exchange_id bigint, p_index int, p_progress numeric, p_star boolean default false)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  x public.ring_exchanges%rowtype;
  kind text;
  v_punch text;
  v_side text;
  q text;
  v_blocked boolean;
  v_countered boolean;
  use_star boolean := false;
  stars int;
  pts int;
  nm text;
  msg text;
begin
  select * into x from public.ring_exchanges where id = p_exchange_id for update;
  if x.id is null or x.attacker is distinct from caller then
    raise exception 'That exchange isn''t yours.';
  end if;
  if x.started_at < now() - interval '2 minutes' or x.finished_at is not null then
    raise exception 'That exchange is over.';
  end if;
  if p_index is null or p_index not between 0 and 2 then
    raise exception 'Three punches to an exchange.';
  end if;
  if (x.game = 'bout' and exists (select 1 from public.bout_punches p where p.exchange_id = x.id and p.seq = p_index))
     or (x.game = 'titlebout' and exists (select 1 from public.tb_punches p where p.exchange_id = x.id and p.seq = p_index)) then
    raise exception 'That punch is already thrown.';
  end if;
  kind := x.openings ->> p_index;
  v_punch := case kind when 'jab' then 'jab' when 'up' then 'up' else 'hook' end;
  v_side := case kind when 'hookL' then 'L' when 'hookR' then 'R' end;
  q := case when p_progress is null or p_progress < 0.45 then 'miss' when p_progress < 0.85 then 'clean' else 'perfect' end;
  v_blocked := q = 'clean' and ((x.guard = 'high' and v_punch = 'hook') or (x.guard = 'body' and v_punch = 'up'));
  v_countered := q = 'clean' and x.guard = 'counter' and v_punch = 'jab';
  stars := public.ring_stars_of(x.game, x.challenge_id, caller);
  if coalesce(p_star, false) and stars > 0 then
    use_star := true;
    stars := public.ring_set_stars(x.game, x.challenge_id, caller, stars - 1);
  end if;
  pts := case when q = 'miss' or v_blocked or v_countered then 0 else public.bout_points(v_punch) * case when use_star then 2 else 1 end end;
  if x.game = 'bout' then
    insert into public.bout_punches (challenge_id, user_id, target, day, round, punch, pos, quality, guard, blocked, countered, points, exchange_id, seq, side, star)
      values (x.challenge_id, caller, x.defender, x.day, x.round, v_punch, round(coalesce(p_progress, 0) * 100, 1), q, x.guard, v_blocked, v_countered, pts, x.id, p_index, v_side, use_star);
  else
    insert into public.tb_punches (challenge_id, fight_id, user_id, target, day, punch, pos, quality, guard, blocked, countered, points, exchange_id, seq, side, star)
      values (x.challenge_id, x.fight_id, caller, x.defender, x.day, v_punch, round(coalesce(p_progress, 0) * 100, 1), q, x.guard, v_blocked, v_countered, pts, x.id, p_index, v_side, use_star);
  end if;
  if p_index = 2 then
    update public.ring_exchanges set finished_at = now() where id = x.id;
  end if;
  nm := case when x.defender is null then 'The sparring hound' else split_part(public.bout_name(x.defender), ' ', 1) end;
  msg := case
    when q = 'miss' then case when p_progress is null then 'Swung at air.' else 'Too early.' end
    when v_countered then nm || '’s counter guard caught your jab: +1 to ' || nm || '.'
    when v_blocked then 'Blocked: ' || nm || '’s guard was waiting for that.'
    when use_star then 'STAR PUNCH! +' || pts || '.'
    else initcap(case v_punch when 'up' then 'uppercut' else v_punch end) || ' +' || pts || case when q = 'perfect' then ', perfect' else '' end || '.' end;
  return jsonb_build_object('seq', p_index, 'punch', v_punch, 'side', v_side, 'quality', q, 'blocked', v_blocked, 'countered', v_countered,
    'points', pts, 'star', use_star, 'stars', stars, 'message', msg);
end;
$$;
revoke execute on function public.ring_exchange_punch(bigint, int, numeric, boolean) from public, anon;
grant execute on function public.ring_exchange_punch(bigint, int, numeric, boolean) to authenticated;

-- ── Defending ──

create or replace function public.ring_defend_start(p_game text, p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  ctx jsonb;
  x public.ring_exchanges%rowtype;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  ctx := public.ring_ctx(p_game, p_challenge_id, caller);
  if ctx ->> 'reason' is not null then
    raise exception '%', ctx ->> 'reason';
  end if;
  select w.* into x from public.ring_waiting(p_game, p_challenge_id, caller) w limit 1;
  if x.id is null then
    raise exception 'Nothing coming at you right now.';
  end if;
  update public.ring_exchanges set defend_started_at = now(), defend_day = (ctx ->> 'day')::date where id = x.id;
  return jsonb_build_object('id', x.id, 'from', public.bout_name(x.attacker), 'stars', public.ring_stars_of(p_game, p_challenge_id, caller),
    'punches', case when p_game = 'bout' then
      (select coalesce(jsonb_agg(jsonb_build_object('seq', p.seq, 'punch', p.punch, 'side', p.side, 'points', p.points, 'star', p.star) order by p.seq), '[]'::jsonb)
         from public.bout_punches p where p.exchange_id = x.id and p.user_id = x.attacker and p.quality <> 'miss' and not p.blocked and not p.countered and p.slip is null)
    else
      (select coalesce(jsonb_agg(jsonb_build_object('seq', p.seq, 'punch', p.punch, 'side', p.side, 'points', p.points, 'star', p.star) order by p.seq), '[]'::jsonb)
         from public.tb_punches p where p.exchange_id = x.id and p.user_id = x.attacker and p.quality <> 'miss' and not p.blocked and not p.countered and p.slip is null) end);
end;
$$;
revoke execute on function public.ring_defend_start(text, uuid) from public, anon;
grant execute on function public.ring_defend_start(text, uuid) to authenticated;

-- How you moved: p_moves, one per punch in the combination, in order:
-- {"dir": "left" | "right" | "duck" | "back", "dt": ms from the strike}
-- or null (didn't move). p_counters: counters landed (one per tight slip
-- at most).
create or replace function public.ring_defend_finish(p_exchange_id bigint, p_moves jsonb, p_counters int default 0)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  x public.ring_exchanges%rowtype;
  p record;
  j int := 0;
  m jsonb;
  dir text;
  dt int;
  ok boolean;
  tight int := 0;
  taken int := 0;
  results jsonb := '[]'::jsonb;
  c int;
  stars int;
  today date := public.soccer_today(caller);
  late boolean;
begin
  select * into x from public.ring_exchanges where id = p_exchange_id for update;
  if x.id is null or x.defender is distinct from caller or x.defend_started_at is null then
    raise exception 'That combination isn''t yours to face.';
  end if;
  if x.defended_at is not null then
    raise exception 'You''ve faced that one.';
  end if;
  late := x.defend_started_at < now() - interval '2 minutes';
  for p in
    select q.id, q.punch, q.side, q.points from public.bout_punches q
      where x.game = 'bout' and q.exchange_id = x.id and q.user_id = x.attacker and q.quality <> 'miss' and not q.blocked and not q.countered and q.slip is null
    union all
    select q.id, q.punch, q.side, q.points from public.tb_punches q
      where x.game = 'titlebout' and q.exchange_id = x.id and q.user_id = x.attacker and q.quality <> 'miss' and not q.blocked and not q.countered and q.slip is null
    order by 1
  loop
    m := case when late then null else p_moves -> j end;
    dir := m ->> 'dir';
    dt := (m ->> 'dt')::int;
    ok := dir is not null and dt between -320 and 140 and public.ring_dodge_ok(p.punch, p.side, dir);
    if ok and dt >= -170 then tight := tight + 1; end if;
    if not ok then taken := taken + 1; end if;
    if x.game = 'bout' then
      update public.bout_punches set slip = case when ok then 'slipped' else 'taken' end, slip_day = today, slip_dir = coalesce(dir, 'none'), slipped_at = now() where id = p.id;
    else
      update public.tb_punches set slip = case when ok then 'slipped' else 'taken' end, slip_day = today, slip_dir = coalesce(dir, 'none'), slipped_at = now() where id = p.id;
    end if;
    results := results || jsonb_build_array(jsonb_build_object('punch', p.punch, 'side', p.side, 'dir', dir, 'slipped', ok, 'tight', ok and dt >= -170, 'points', p.points));
    j := j + 1;
  end loop;
  c := least(greatest(coalesce(p_counters, 0), 0), tight);
  for k in 1..c loop
    if x.game = 'bout' then
      insert into public.bout_punches (challenge_id, user_id, target, day, round, punch, pos, quality, guard, points, exchange_id, seq, counter, slip, slip_day)
        values (x.challenge_id, caller, x.attacker, today, x.round, 'jab', 100, 'perfect', 'counter', 2, x.id, 10 + k, true, 'taken', today);
    else
      insert into public.tb_punches (challenge_id, fight_id, user_id, target, day, punch, pos, quality, guard, points, exchange_id, seq, counter, slip, slip_day)
        values (x.challenge_id, x.fight_id, caller, x.attacker, today, 'jab', 100, 'perfect', 'counter', 2, x.id, 10 + k, true, 'taken', today);
    end if;
  end loop;
  stars := public.ring_set_stars(x.game, x.challenge_id, caller, public.ring_stars_of(x.game, x.challenge_id, caller) - taken + c);
  update public.ring_exchanges set defended_at = now() where id = x.id;
  return jsonb_build_object('results', results, 'counters', c, 'stars', stars,
    'message', case when taken = 0 and c > 0 then 'Slipped it all and countered: ★ +' || c || '.'
                    when taken = 0 then 'Slipped the lot.'
                    when j = taken then 'Caught by all of it.'
                    else 'Slipped ' || (j - taken) || ' of ' || j || '.' end);
end;
$$;
revoke execute on function public.ring_defend_finish(bigint, jsonb, int) from public, anon;
grant execute on function public.ring_defend_finish(bigint, jsonb, int) to authenticated;

-- The ring's state for the caller: stars and combinations waiting.
create or replace function public.ring_state(p_game text, p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object('stars', public.ring_stars_of(p_game, p_challenge_id, caller),
    'combos', (select count(*) from public.ring_waiting(p_game, p_challenge_id, caller)),
    'exchanges_today', (select count(*) from public.ring_exchanges x where x.game = p_game and x.challenge_id = p_challenge_id
                          and x.attacker = caller and x.day = public.soccer_today(caller)));
end;
$$;
revoke execute on function public.ring_state(text, uuid) from public, anon;
grant execute on function public.ring_state(text, uuid) to authenticated;

-- ── Knockdowns from combinations (at the round's or fight's scoring) ──

create or replace function public.ring_mark_knockdowns(p_game text, p_challenge_id uuid, p_round int, p_fight_id bigint, p_needs_a int, p_needs_b int, p_a uuid, p_b uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  needs int;
begin
  for r in
    select q.exchange_id, q.user_id,
      count(*) filter (where q.landed and not q.counter) as n,
      coalesce(sum(case when q.landed and not q.counter and q.punch <> 'jab' then case when q.star then 2 else 1 end else 0 end), 0) as pw,
      max(q.id) filter (where q.landed and not q.counter) as last_id
    from public.bout_punches q
    where p_game = 'bout' and q.challenge_id = p_challenge_id and q.round = p_round and q.exchange_id is not null
    group by q.exchange_id, q.user_id
    union all
    select q.exchange_id, q.user_id,
      count(*) filter (where q.landed and not q.counter),
      coalesce(sum(case when q.landed and not q.counter and q.punch <> 'jab' then case when q.star then 2 else 1 end else 0 end), 0),
      max(q.id) filter (where q.landed and not q.counter)
    from public.tb_punches q
    where p_game = 'titlebout' and q.fight_id = p_fight_id and q.exchange_id is not null
    group by q.exchange_id, q.user_id
  loop
    needs := case when r.user_id = p_a then p_needs_a else p_needs_b end;
    if r.last_id is not null and (r.pw >= 3 or (r.n >= 3 and r.pw >= 2) or (needs <= 2 and r.pw >= 2)) then
      if p_game = 'bout' then
        update public.bout_punches set knockdown = true where id = r.last_id;
      else
        update public.tb_punches set knockdown = true where id = r.last_id;
      end if;
    end if;
  end loop;
end;
$$;
revoke execute on function public.ring_mark_knockdowns(text, uuid, int, bigint, int, int, uuid, uuid) from public, anon, authenticated;

-- 0225's and 0227's scoring, with knockdowns from combinations and stars
-- lost on a knockdown.
create or replace function public.bout_advance(p_challenge_id uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.bout_games%rowtype;
  caller uuid := auth.uid();
  first_day date;
  cutoff date;
  d date;
  rnd int;
  a uuid;
  b uuid;
  a_pts int;
  b_pts int;
  a_down int;
  b_down int;
  a_sc int;
  b_sc int;
  needs_a int;
  needs_b int;
  v_ko boolean;
  v_winner uuid;
  ta int;
  tb int;
  da int;
  db int;
  n int := 0;
  x record;
  run int;
  who uuid;
  r record;
  line text;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.kind::text <> 'bout' then
    return 0;
  end if;
  if caller is not null and not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller) then
    return 0;
  end if;
  select * into g from public.bout_games where challenge_id = p_challenge_id for update;
  if not found or g.status <> 'active' then
    return 0;
  end if;
  first_day := public.soccer_first_day(c);
  cutoff := (now() at time zone 'utc')::date - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end;
  select p.a, p.b into a, b from public.bout_pair(p_challenge_id) p;

  loop
    rnd := g.rounds_played + 1;
    d := first_day + rnd - 1;
    exit when rnd > g.rounds or d > cutoff;
    -- Whatever wasn't slipped lands; whatever's waiting is taken.
    update public.bout_punches set landed = (quality <> 'miss' and not blocked and slip is distinct from 'slipped')
      where challenge_id = p_challenge_id and round = rnd;
    update public.bout_punches set slip = 'taken' where challenge_id = p_challenge_id and round = rnd and slip is null and landed;
    -- Knockdowns: each attacker's runs of landed power punches.
    needs_a := (public.bout_day(p_challenge_id, a, d) ->> 'kd_needs')::int;
    needs_b := case when b is null then 3 else (public.bout_day(p_challenge_id, b, d) ->> 'kd_needs')::int end;
    for who in select unnest(array[a, b]) loop
      continue when who is null;
      run := 0;
      for x in select * from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.user_id = who and p.exchange_id is null order by p.id loop
        if x.landed and x.punch <> 'jab' then
          run := run + 1;
          if run >= (case when who = a then needs_a else needs_b end) then
            update public.bout_punches set knockdown = true where id = x.id;
            run := 0;
          end if;
        else
          run := 0;
        end if;
      end loop;
    end loop;
    -- 0230: knockdowns from the new ring's combinations.
    perform public.ring_mark_knockdowns('bout', p_challenge_id, rnd, null, needs_a, needs_b, a, b);
    -- Points: landed punches, and counters (an opponent's jab caught by a counter guard).
    a_pts := coalesce((select sum(p.points) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.user_id = a and p.landed), 0)
           + (select count(*) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.target = a and p.countered);
    b_pts := coalesce((select sum(p.points) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.user_id = b and p.landed), 0)
           + (select count(*) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.target = b and p.countered);
    b_down := (select count(*) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.user_id = a and p.knockdown);
    a_down := (select count(*) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.user_id = b and p.knockdown);
    a_sc := case when a_pts < b_pts then 9 else 10 end - a_down;
    b_sc := case when b_pts < a_pts then 9 else 10 end - b_down;
    -- A KO: three down in the round, or four in the fight.
    da := a_down + coalesce((select sum(r2.a_down) from public.bout_rounds r2 where r2.challenge_id = p_challenge_id), 0);
    db := b_down + coalesce((select sum(r2.b_down) from public.bout_rounds r2 where r2.challenge_id = p_challenge_id), 0);
    v_ko := a_down >= 3 or b_down >= 3 or da >= 4 or db >= 4;
    -- Knocked down: the stars go.
    update public.ring_stars set stars = 0 where game = 'bout' and challenge_id = p_challenge_id
      and ((user_id = a and a_down > 0) or (user_id = b and b_down > 0));
    insert into public.bout_rounds (challenge_id, round, day, a_user, b_user, a_points, b_points, a_down, b_down, a_score, b_score, ko)
      values (p_challenge_id, rnd, d, a, b, a_pts, b_pts, a_down, b_down, a_sc, b_sc, v_ko);
    update public.bout_games set rounds_played = rnd, updated_at = now() where challenge_id = p_challenge_id;
    n := n + 1;

    if v_ko or rnd >= g.rounds then
      ta := (select sum(r2.a_score) from public.bout_rounds r2 where r2.challenge_id = p_challenge_id);
      tb := (select sum(r2.b_score) from public.bout_rounds r2 where r2.challenge_id = p_challenge_id);
      if v_ko then
        v_winner := case when (a_down >= 3 or da >= 4) and not (b_down >= 3 or db >= 4) then b
                       when (b_down >= 3 or db >= 4) and not (a_down >= 3 or da >= 4) then a
                       when da > db then b when db > da then a
                       when ta > tb then a when tb > ta then b end;
      else
        v_winner := case when ta > tb then a when tb > ta then b end;
      end if;
      update public.bout_games set status = 'final', winner = v_winner,
          method = case when v_winner is null then 'draw' when v_ko then 'ko' else 'decision' end,
          ko_round = case when v_ko and v_winner is not null then rnd end, updated_at = now()
        where challenge_id = p_challenge_id;
    end if;
    select * into g from public.bout_games where challenge_id = p_challenge_id;

    -- Tell them both.
    ta := (select sum(r2.a_score) from public.bout_rounds r2 where r2.challenge_id = p_challenge_id);
    tb := (select sum(r2.b_score) from public.bout_rounds r2 where r2.challenge_id = p_challenge_id);
    for r in select unnest(array[a, b]) as u loop
      continue when r.u is null;
      if g.status = 'final' then
        line := case
          when g.winner is null then 'A draw after ' || g.rounds_played || ' rounds, ' || ta || '–' || tb || '.'
          when g.winner = r.u and g.method = 'ko' then 'You won by KO in round ' || g.ko_round || '!'
          when g.winner = r.u then 'You won on the cards, ' || greatest(ta, tb) || '–' || least(ta, tb) || '!'
          when g.method = 'ko' then split_part(public.bout_name(g.winner), ' ', 1) || ' won by KO in round ' || g.ko_round || '. Rematch?'
          else split_part(public.bout_name(g.winner), ' ', 1) || ' won on the cards, ' || greatest(ta, tb) || '–' || least(ta, tb) || '. Rematch?' end;
      else
        line := 'Round ' || rnd || ': ' || case
          when (r.u = a and a_sc > b_sc) or (r.u = b and b_sc > a_sc) then 'yours, '
          when a_sc = b_sc then 'even, '
          else 'theirs, ' end
          || case when r.u = a then a_sc || '–' || b_sc else b_sc || '–' || a_sc end
          || case when (r.u = a and b_down > 0) or (r.u = b and a_down > 0) then ', with a knockdown' else '' end
          || '. ' || case when r.u = a then ta || '–' || tb else tb || '–' || ta end || ' after ' || rnd || '.';
      end if;
      perform public.bout_notify(p_challenge_id, r.u, c.name, line);
    end loop;
    exit when g.status = 'final';
  end loop;
  return n;
end;
$$;
revoke execute on function public.bout_advance(uuid) from public, anon;
grant execute on function public.bout_advance(uuid) to authenticated;

create or replace function public.tb_score_fight(p_fight bigint)
returns public.tb_fights
language plpgsql
security definer set search_path = public
as $$
declare
  f public.tb_fights%rowtype;
  who uuid;
  needs int;
  run int;
  x record;
  a_pts int;
  b_pts int;
  a_dn int;
  b_dn int;
  a_threw int;
  b_threw int;
  res text;
begin
  select * into f from public.tb_fights where id = p_fight for update;
  if f.scored_at is not null then
    return f;
  end if;
  update public.tb_punches set landed = (quality <> 'miss' and not blocked and slip is distinct from 'slipped') where fight_id = f.id;
  update public.tb_punches set slip = 'taken' where fight_id = f.id and slip is null and landed;
  for who in select unnest(array[f.a, f.b]) loop
    continue when who is null;
    needs := (public.tb_day(f.challenge_id, who, f.day) ->> 'kd_needs')::int;
    run := 0;
    for x in select * from public.tb_punches p where p.fight_id = f.id and p.user_id = who and p.exchange_id is null order by p.id loop
      if x.landed and x.punch <> 'jab' then
        run := run + 1;
        if run >= needs then
          update public.tb_punches set knockdown = true where id = x.id;
          run := 0;
        end if;
      else
        run := 0;
      end if;
    end loop;
  end loop;
  -- 0230: knockdowns from the new ring's combinations.
  perform public.ring_mark_knockdowns('titlebout', f.challenge_id, null, f.id,
    (public.tb_day(f.challenge_id, f.a, f.day) ->> 'kd_needs')::int,
    case when f.b is null then 3 else (public.tb_day(f.challenge_id, f.b, f.day) ->> 'kd_needs')::int end, f.a, f.b);
  a_threw := (select count(*) from public.tb_punches p where p.fight_id = f.id and p.user_id = f.a)
           + (select count(*) from public.tb_punches p where p.fight_id = f.id and p.target = f.a and p.slip in ('slipped', 'missed'));
  b_threw := case when f.b is null then 1 else
             (select count(*) from public.tb_punches p where p.fight_id = f.id and p.user_id = f.b)
           + (select count(*) from public.tb_punches p where p.fight_id = f.id and p.target = f.b and p.slip in ('slipped', 'missed')) end;
  a_pts := coalesce((select sum(p.points) from public.tb_punches p where p.fight_id = f.id and p.user_id = f.a and p.landed), 0)
         + (select count(*) from public.tb_punches p where p.fight_id = f.id and p.target = f.a and p.countered);
  b_pts := case when f.b is null then case when a_threw > 0 then public.tb_bot_points(f.id) else 0 end else
           coalesce((select sum(p.points) from public.tb_punches p where p.fight_id = f.id and p.user_id = f.b and p.landed), 0)
         + (select count(*) from public.tb_punches p where p.fight_id = f.id and p.target = f.b and p.countered) end;
  b_dn := (select count(*) from public.tb_punches p where p.fight_id = f.id and p.user_id = f.a and p.knockdown);
  a_dn := case when f.b is null then 0 else (select count(*) from public.tb_punches p where p.fight_id = f.id and p.user_id = f.b and p.knockdown) end;
  res := case
    when a_threw = 0 and b_threw = 0 then 'none'
    when a_threw = 0 then 'b'
    when b_threw = 0 then 'a'
    when a_dn >= 3 and b_dn < 3 then 'b'
    when b_dn >= 3 and a_dn < 3 then 'a'
    when (case when a_pts < b_pts then 9 else 10 end) - a_dn > (case when b_pts < a_pts then 9 else 10 end) - b_dn then 'a'
    when (case when a_pts < b_pts then 9 else 10 end) - a_dn < (case when b_pts < a_pts then 9 else 10 end) - b_dn then 'b'
    else 'draw' end;
  update public.ring_stars set stars = 0 where game = 'titlebout' and challenge_id = f.challenge_id
    and ((user_id = f.a and a_dn > 0) or (user_id = f.b and b_dn > 0));
  update public.tb_fights set a_points = a_pts, b_points = b_pts, a_down = a_dn, b_down = b_dn,
      a_score = (case when a_pts < b_pts then 9 else 10 end) - a_dn,
      b_score = (case when b_pts < a_pts then 9 else 10 end) - b_dn,
      result = res, ko = (a_dn >= 3 or b_dn >= 3), scored_at = now()
    where id = f.id returning * into f;
  return f;
end;
$$;
revoke execute on function public.tb_score_fight(bigint) from public, anon, authenticated;

-- ── The old meter is gone ──

create or replace function public.bout_throw(p_challenge_id uuid, p_punch text, p_pos numeric)
returns jsonb language plpgsql as $$ begin raise exception 'Hound Bout has a new ring: update Hound to fight.'; end; $$;
create or replace function public.bout_slip(p_challenge_id uuid, p_punch_id bigint, p_pos numeric)
returns jsonb language plpgsql as $$ begin raise exception 'Hound Bout has a new ring: update Hound to fight.'; end; $$;
create or replace function public.tb_throw(p_challenge_id uuid, p_punch text, p_pos numeric)
returns jsonb language plpgsql as $$ begin raise exception 'Hound Bout has a new ring: update Hound to fight.'; end; $$;
create or replace function public.tb_slip(p_challenge_id uuid, p_punch_id bigint, p_pos numeric)
returns jsonb language plpgsql as $$ begin raise exception 'Hound Bout has a new ring: update Hound to fight.'; end; $$;

-- ── Replays: each punch's combination, side, star, counter and the way the other hound moved ──

create or replace function public.bout_punch_json(p public.bout_punches)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p.id, 'by', p.user_id, 'round', p.round, 'punch', p.punch, 'quality', p.quality,
    'blocked', p.blocked, 'countered', p.countered, 'points', p.points, 'slip', p.slip, 'landed', p.landed,
    'knockdown', p.knockdown, 'at', p.created_at, 'slipped_at', p.slipped_at,
    'exchange', p.exchange_id, 'seq', p.seq, 'side', p.side, 'star', p.star, 'counter', p.counter, 'slip_dir', p.slip_dir);
$$;
revoke execute on function public.bout_punch_json(public.bout_punches) from public, anon, authenticated;

create or replace function public.tb_punch_json(p public.tb_punches)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p.id, 'by', p.user_id, 'round', 1, 'punch', p.punch, 'quality', p.quality,
    'blocked', p.blocked, 'countered', p.countered, 'points', p.points, 'slip', p.slip, 'landed', p.landed,
    'knockdown', p.knockdown, 'at', p.created_at, 'slipped_at', p.slipped_at,
    'exchange', p.exchange_id, 'seq', p.seq, 'side', p.side, 'star', p.star, 'counter', p.counter, 'slip_dir', p.slip_dir);
$$;
revoke execute on function public.tb_punch_json(public.tb_punches) from public, anon, authenticated;

-- ── Admin → Overview → Games → Hound Bout: the new ring ──

create or replace function public.admin_ring_overview()
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
    'exchanges_7d', (select count(*) from public.ring_exchanges x where x.started_at > now() - interval '7 days'),
    'attackers_7d', (select count(distinct x.attacker) from public.ring_exchanges x where x.started_at > now() - interval '7 days'),
    'attackers_ever', (select count(distinct x.attacker) from public.ring_exchanges x),
    'defenses_7d', (select count(*) from public.ring_exchanges x where x.defend_started_at > now() - interval '7 days'),
    'defenders_7d', (select count(distinct x.defender) from public.ring_exchanges x where x.defend_started_at > now() - interval '7 days'),
    'slipped_7d', (select count(*) from (select slip from public.bout_punches where exchange_id is not null and slipped_at > now() - interval '7 days' and slip = 'slipped' and not counter
                                         union all select slip from public.tb_punches where exchange_id is not null and slipped_at > now() - interval '7 days' and slip = 'slipped' and not counter) z),
    'faced_7d', (select count(*) from (select slip from public.bout_punches where exchange_id is not null and slipped_at > now() - interval '7 days' and slip_dir is not null and not counter
                                       union all select slip from public.tb_punches where exchange_id is not null and slipped_at > now() - interval '7 days' and slip_dir is not null and not counter) z),
    'counters_7d', (select count(*) from (select 1 from public.bout_punches where counter and created_at > now() - interval '7 days'
                                          union all select 1 from public.tb_punches where counter and created_at > now() - interval '7 days') z),
    'star_punches_7d', (select count(*) from (select 1 from public.bout_punches where star and created_at > now() - interval '7 days'
                                              union all select 1 from public.tb_punches where star and created_at > now() - interval '7 days') z),
    'combo_knockdowns_7d', (select count(*) from (select 1 from public.bout_punches where knockdown and exchange_id is not null and created_at > now() - interval '7 days'
                                                  union all select 1 from public.tb_punches where knockdown and exchange_id is not null and created_at > now() - interval '7 days') z));
end;
$$;
revoke execute on function public.admin_ring_overview() from public, anon;
grant execute on function public.admin_ring_overview() to authenticated;

-- ── Running fights: today's waiting punches become combinations ──

do $$
declare
  r record;
  ex bigint;
  i int := 0;
  cur_key text := null;
begin
  for r in
    select 'bout' as game, p.id, p.challenge_id, p.round, null::bigint as fight_id, p.day, p.user_id, p.target, p.punch, p.guard
    from public.bout_punches p
    join public.bout_games g on g.challenge_id = p.challenge_id
    where g.status = 'active' and p.round > g.rounds_played and p.exchange_id is null
      and p.quality <> 'miss' and not p.blocked and not p.countered and p.slip is null
    union all
    select 'titlebout', p.id, p.challenge_id, null, p.fight_id, p.day, p.user_id, p.target, p.punch, p.guard
    from public.tb_punches p
    join public.tb_fights f on f.id = p.fight_id
    where f.scored_at is null and p.exchange_id is null and p.target is not null
      and p.quality <> 'miss' and not p.blocked and not p.countered and p.slip is null
    order by 1, 3, 7, 2
  loop
    if cur_key is distinct from r.game || r.challenge_id || r.user_id || coalesce(r.round::text, r.fight_id::text) or i >= 3 then
      insert into public.ring_exchanges (game, challenge_id, round, fight_id, day, attacker, defender, guard, openings, started_at, finished_at, legacy)
        values (r.game, r.challenge_id, r.round, r.fight_id, r.day, r.user_id, r.target, r.guard, '[]'::jsonb, now() - interval '5 minutes', now(), true)
        returning id into ex;
      cur_key := r.game || r.challenge_id || r.user_id || coalesce(r.round::text, r.fight_id::text);
      i := 0;
    end if;
    if r.game = 'bout' then
      update public.bout_punches set exchange_id = ex, seq = i, side = case when r.punch = 'hook' then case when r.id % 2 = 0 then 'L' else 'R' end end where id = r.id;
    else
      update public.tb_punches set exchange_id = ex, seq = i, side = case when r.punch = 'hook' then case when r.id % 2 = 0 then 'L' else 'R' end end where id = r.id;
    end if;
    update public.ring_exchanges set openings = openings || jsonb_build_array(case when r.punch = 'hook' then case when r.id % 2 = 0 then 'hookL' else 'hookR' end else r.punch end)
      where id = ex;
    i := i + 1;
  end loop;
end;
$$;
