-- Hound: H-O-R-S-E, call your shot (Steve, Nov 2026). The approved
-- prototype: claude.ai/artifact/WuPVh6Hv6p6CGQBsnoxjbc (Horse.dc.html).
--
-- A hands-on game (horse_games.hands_on, Create's "Take my own shots")
-- is played turn by turn, 24 hours a turn, like Tic-Tac-Go:
--
--   set     pick a spot anywhere on the half court (or up on the bench,
--           or beyond the court), chain your calls, one shot. Made: the
--           other player has to match it. Missed (or "in, but not all
--           net"): no letter, and the turn passes; they set next.
--   match   same spot, same calls, one shot; two on your last letter
--           (the rebuttal). Made: no letter, the setter sets again.
--           Missed: you take the next letter, and the setter sets again.
--   24 h    a match not tried in time counts as a miss (a letter); a set
--           not taken passes the turn. Settled lazily (horse_live,
--           horse_shoot, horse_view) and by the daily job.
--   tries   floor(steps today / 2,000), less the shots taken today.
--   spots   beyond the court, unlocked for the rest of the game once your
--           best day in it reaches: the stands 4,000, the rafters 7,000,
--           the parking lot (through the gym window) 10,000, the rooftop
--           across the street 15,000. Unlocking spends nothing; matching
--           a shot needs its spot unlocked too.
--   window  the share of the meter that makes it (timing -0.5..0.5):
--           base: the stands .10, the rafters .09, the lot and the roof
--           .085, else clamp(0.42 - 0.0085 x feet, 0.06, 0.40) (the bench
--           x0.85); x each call (off the floor .65, off the scoreboard .5,
--           off the glass .9 inside; off the billboard .6 outside; behind
--           the back .8); x0.85 when the line to the rim passes within
--           2.5 ft of today's chair; x steadiness 0.85 + 0.3 x min(1,
--           steps today / 12,000); at least 0.025. Made: |timing| <=
--           w / 2; calling nothing but net, only a swish counts (<= w / 4).
--           No roll: the timing decides. Stars from the window.
--   talk    a made shot of 4-5 stars is posted to the challenge's Talk.
--   stakes  a treat (treat_recipes): when the game ends with a winner,
--           the loser "bakes" it into the winner's pantry and pays its
--           Bones (down to 0, never below). A tie pays nothing.
--
-- Hands-off games keep 0196's daily step-target engine. horse_advance
-- (0198, its latest) ends a hands-on game when the challenge is over
-- (fewer letters wins; level is a tie), as before.
--
-- Run this once, after 0001-0208, in the SQL Editor. The pushes need
-- send-hoops-notification redeployed (its new 'horse_turn' kind); without
-- it the game plays the same, quietly.

alter table public.horse_games
  add column hands_on boolean not null default false,
  add column stakes text references public.treat_recipes (id),
  add column stakes_paid_at timestamptz,
  add column turn_user uuid references public.profiles (id) on delete set null,
  add column turn_kind text check (turn_kind in ('set', 'match')),
  add column turn_started_at timestamptz,
  add column shots_left int not null default 1,
  -- The shot to match: spot, calls, over_chair, stars, description, by, at.
  add column pending jsonb;

-- Every live shot, and every turn that ran out (timeout).
create table public.horse_shots (
  id uuid primary key default gen_random_uuid(),
  -- In the order they happened (several can share a transaction's now()).
  seq bigserial,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('set', 'match')),
  -- The shooter's own day (soccer_today), for tries.
  day date not null,
  spot jsonb,
  calls text[] not null default '{}',
  timing numeric,
  win numeric,
  stars int,
  made boolean not null default false,
  swish boolean not null default false,
  highlight boolean not null default false,
  timeout boolean not null default false,
  created_at timestamptz not null default now()
);
create index horse_shots_challenge on public.horse_shots (challenge_id, seq desc);
create index horse_shots_user_day on public.horse_shots (user_id, day);
create index horse_shots_created on public.horse_shots (created_at);
alter table public.horse_shots enable row level security;
revoke all on public.horse_shots from anon;
revoke insert, update, delete on public.horse_shots from authenticated;
create policy "Players can view their H-O-R-S-E shots"
  on public.horse_shots for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = horse_shots.challenge_id and cp.user_id = auth.uid()));

-- ── The court ──

-- The spots beyond the court.
create or replace function public.horse_far(p_kind text)
returns jsonb
language sql
immutable
as $$
  select case p_kind
    when 'stands' then '{"name":"From the stands","need":4000,"base":0.10,"feet":48}'::jsonb
    when 'rafters' then '{"name":"From the rafters","need":7000,"base":0.09,"feet":55}'::jsonb
    when 'lot' then '{"name":"Parking lot, through the window","need":10000,"base":0.085,"feet":120,"out":true}'::jsonb
    when 'roof' then '{"name":"Rooftop across the street","need":15000,"base":0.085,"feet":160,"out":true}'::jsonb
  end;
$$;
revoke execute on function public.horse_far(text) from public, anon, authenticated;

-- A spot as the app sends it, checked: {kind:'floor', u, v} (u -1..1
-- across, v 0 at the baseline to 1 at half court), {kind:'bench'}, or one
-- of the four beyond the court.
create or replace function public.horse_spot(p_spot jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  k text := p_spot ->> 'kind';
  u numeric;
  v numeric;
begin
  if k = 'floor' then
    begin
      u := (p_spot ->> 'u')::numeric;
      v := (p_spot ->> 'v')::numeric;
    exception when others then
      u := null;
    end;
    if u is null or v is null or u < -1 or u > 1 or v < 0 or v > 1 then
      raise exception 'Pick a spot on the court.';
    end if;
    return jsonb_build_object('kind', 'floor', 'u', round(u, 3), 'v', round(v, 3));
  elsif k in ('bench', 'stands', 'rafters', 'lot', 'roof') then
    return jsonb_build_object('kind', k);
  end if;
  raise exception 'Pick a spot on the court.';
end;
$$;
revoke execute on function public.horse_spot(jsonb) from public, anon, authenticated;

create or replace function public.horse_spot_out(p_spot jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce((public.horse_far(p_spot ->> 'kind') ->> 'out')::boolean, false);
$$;
revoke execute on function public.horse_spot_out(jsonb) from public, anon, authenticated;

create or replace function public.horse_spot_feet(p_spot jsonb)
returns numeric
language sql
immutable
as $$
  select case
    when public.horse_far(p_spot ->> 'kind') is not null then (public.horse_far(p_spot ->> 'kind') ->> 'feet')::numeric
    when p_spot ->> 'kind' = 'bench' then sqrt(power(25 * 1.13, 2) + power(47 * (0.6 - 0.112), 2))::numeric
    else sqrt(power(25 * (p_spot ->> 'u')::numeric, 2) + power(47 * ((p_spot ->> 'v')::numeric - 0.112), 2))::numeric
  end;
$$;
revoke execute on function public.horse_spot_feet(jsonb) from public, anon, authenticated;

-- A floor spot's name, for the chip and the description.
create or replace function public.horse_spot_name(p_spot jsonb)
returns text
language plpgsql
immutable
as $$
declare
  k text := p_spot ->> 'kind';
  u numeric;
  v numeric;
  f numeric;
  ang numeric;
  side text;
begin
  if k = 'bench' then
    return 'Up on the bench';
  elsif public.horse_far(k) is not null then
    return public.horse_far(k) ->> 'name';
  end if;
  u := (p_spot ->> 'u')::numeric;
  v := (p_spot ->> 'v')::numeric;
  f := public.horse_spot_feet(p_spot);
  ang := degrees(atan2(25 * u, 47 * (v - 0.112)));
  side := case when u < 0 then 'Left' else 'Right' end;
  if v >= 0.9 then
    return 'Half court';
  elsif f <= 6 then
    return 'Under the hoop';
  elsif abs(u) between 0.18 and 0.32 and v between 0.33 and 0.46 then
    return side || ' elbow';
  elsif abs(u) <= 0.24 and v <= 0.46 and v >= 0.34 then
    return 'Free-throw line';
  elsif abs(u) <= 0.36 and v <= 0.22 then
    return side || ' block';
  elsif abs(u) <= 0.24 and v < 0.34 then
    return 'Middle of the lane';
  elsif v <= 0.2 and abs(u) >= 0.6 then
    return side || ' corner';
  elsif abs(ang) < 20 then
    return case when f > 30 then 'Deep top of the key' else 'Top of the key' end;
  elsif abs(ang) < 65 then
    return case when f > 30 then 'Deep ' || lower(side) || ' wing' else side || ' wing' end;
  end if;
  return side || ' baseline';
end;
$$;
revoke execute on function public.horse_spot_name(jsonb) from public, anon, authenticated;

-- Today's chair in the lane: one of four spots, seeded by the game and day.
create or replace function public.horse_obstacle(p_challenge_id uuid, p_day date)
returns jsonb
language sql
immutable
as $$
  select (array[
    '{"u":-0.06,"v":0.30}'::jsonb, '{"u":0.08,"v":0.26}'::jsonb,
    '{"u":-0.14,"v":0.22}'::jsonb, '{"u":0.12,"v":0.33}'::jsonb
  ])[1 + least(3, floor(public.rally_js_rand(public.rally_js_hash(p_challenge_id::text || ':' || p_day || ':obstacle')) * 4)::int)];
$$;
revoke execute on function public.horse_obstacle(uuid, date) from public, anon, authenticated;

-- Does the straight line from the spot to the rim pass within 2.5 ft of
-- the chair? (Beyond the court, never.)
create or replace function public.horse_over_chair(p_spot jsonb, p_obstacle jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  u numeric;
  v numeric;
  ax numeric; ay numeric; bx numeric := 0; by_ numeric := 47 * 0.112;
  px numeric; py numeric; dx numeric; dy numeric; t numeric;
begin
  if p_spot ->> 'kind' = 'bench' then
    u := 1.13; v := 0.6;
  elsif p_spot ->> 'kind' = 'floor' then
    u := (p_spot ->> 'u')::numeric; v := (p_spot ->> 'v')::numeric;
  else
    return false;
  end if;
  if p_obstacle is null or v <= (p_obstacle ->> 'v')::numeric + 0.02 then
    return false;
  end if;
  ax := 25 * u; ay := 47 * v;
  px := 25 * (p_obstacle ->> 'u')::numeric; py := 47 * (p_obstacle ->> 'v')::numeric;
  dx := bx - ax; dy := by_ - ay;
  t := greatest(0, least(1, ((px - ax) * dx + (py - ay) * dy) / nullif(dx * dx + dy * dy, 0)));
  return sqrt(power(ax + t * dx - px, 2) + power(ay + t * dy - py, 2)) < 2.5;
end;
$$;
revoke execute on function public.horse_over_chair(jsonb, jsonb) from public, anon, authenticated;

-- The calls, checked against the spot's scene and put in their order.
create or replace function public.horse_calls(p_spot jsonb, p_calls text[])
returns text[]
language plpgsql
immutable
as $$
declare
  c text;
  out_ boolean := public.horse_spot_out(p_spot);
begin
  foreach c in array coalesce(p_calls, '{}') loop
    if c not in ('floor', 'board', 'glass', 'billboard', 'back', 'net') then
      raise exception 'That call doesn''t exist.';
    end if;
    if out_ and c in ('floor', 'board', 'glass') then
      raise exception '"%" is for shots inside the gym.', case c when 'floor' then 'Off the floor' when 'board' then 'Off the scoreboard' else 'Off the glass' end;
    end if;
    if not out_ and c = 'billboard' then
      raise exception '"Off the billboard" is for shots from outside.';
    end if;
  end loop;
  return array(select x from unnest(array['floor', 'board', 'glass', 'billboard', 'back', 'net']) with ordinality o(x, n)
               where x = any(coalesce(p_calls, '{}')) order by n);
end;
$$;
revoke execute on function public.horse_calls(jsonb, text[]) from public, anon, authenticated;

create or replace function public.horse_window(p_spot jsonb, p_calls text[], p_over_chair boolean, p_steps int)
returns numeric
language plpgsql
immutable
as $$
declare
  far jsonb := public.horse_far(p_spot ->> 'kind');
  w numeric;
begin
  if far is not null then
    w := (far ->> 'base')::numeric;
  else
    w := greatest(0.06, least(0.40, 0.42 - 0.0085 * public.horse_spot_feet(p_spot)));
    if p_spot ->> 'kind' = 'bench' then w := w * 0.85; end if;
  end if;
  if 'floor' = any(p_calls) then w := w * 0.65; end if;
  if 'board' = any(p_calls) then w := w * 0.5; end if;
  if 'glass' = any(p_calls) then w := w * 0.9; end if;
  if 'billboard' = any(p_calls) then w := w * 0.6; end if;
  if 'back' = any(p_calls) then w := w * 0.8; end if;
  if coalesce(p_over_chair, false) then w := w * 0.85; end if;
  w := w * (0.85 + 0.3 * least(1, greatest(0, coalesce(p_steps, 0)) / 12000.0));
  return round(greatest(0.025, w), 4);
end;
$$;
revoke execute on function public.horse_window(jsonb, text[], boolean, int) from public, anon, authenticated;

create or replace function public.horse_stars(p_window numeric)
returns int
language sql
immutable
as $$
  select case when p_window >= 0.28 then 1 when p_window >= 0.20 then 2 when p_window >= 0.13 then 3 when p_window >= 0.08 then 4 else 5 end;
$$;
revoke execute on function public.horse_stars(numeric) from public, anon, authenticated;

create or replace function public.horse_star_text(p_stars int)
returns text
language sql
immutable
as $$
  select repeat('★', p_stars) || repeat('☆', 5 - p_stars);
$$;
revoke execute on function public.horse_star_text(int) from public, anon, authenticated;

-- The call in words, as the prototype's describe(): "From the top of the
-- key, over the chair, off the floor, off the scoreboard, off the glass.
-- Nothing but net."
create or replace function public.horse_describe(p_spot jsonb, p_calls text[], p_over_chair boolean)
returns text
language plpgsql
immutable
as $$
declare
  k text := p_spot ->> 'kind';
  name text := public.horse_spot_name(p_spot);
  lead text;
  parts text[] := '{}';
begin
  if coalesce(p_over_chair, false) then parts := parts || 'over the chair'::text; end if;
  if 'back' = any(p_calls) then parts := parts || 'behind the back'::text; end if;
  if 'floor' = any(p_calls) then parts := parts || 'off the floor'::text; end if;
  if 'board' = any(p_calls) then parts := parts || 'off the scoreboard'::text; end if;
  if 'glass' = any(p_calls) then parts := parts || 'off the glass'::text; end if;
  if 'billboard' = any(p_calls) then parts := parts || 'off the billboard'::text; end if;
  if public.horse_spot_out(p_spot) then parts := parts || 'through the gym window'::text; end if;
  lead := case
    when k = 'bench' then 'Up on the bench'
    when k in ('stands', 'rafters', 'roof') then name
    when k = 'lot' then 'Parking lot'
    when name in ('Under the hoop', 'Half court') then 'From ' || lower(name)
    else 'From the ' || lower(name)
  end;
  return lead || case when cardinality(parts) > 0 then ', ' || array_to_string(parts, ', ') else '' end
    || case when 'net' = any(p_calls) then '. Nothing but net.' else '.' end;
end;
$$;
revoke execute on function public.horse_describe(jsonb, text[], boolean) from public, anon, authenticated;

-- ── Steps ──

create or replace function public.horse_steps_today(p_challenge_id uuid, p_user uuid)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select ps.steps from public.progress_snapshots ps
    where ps.challenge_id = p_challenge_id and ps.user_id = p_user and ps.day = public.soccer_today(p_user)), 0)::int;
$$;
revoke execute on function public.horse_steps_today(uuid, uuid) from public, anon, authenticated;

-- Your best day in this game so far, today included.
create or replace function public.horse_best_day(p_challenge_id uuid, p_user uuid)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select max(ps.steps) from public.progress_snapshots ps
    where ps.challenge_id = p_challenge_id and ps.user_id = p_user), 0)::int;
$$;
revoke execute on function public.horse_best_day(uuid, uuid) from public, anon, authenticated;

create or replace function public.horse_tries(p_challenge_id uuid, p_user uuid)
returns int
language sql
stable
security definer set search_path = public
as $$
  select greatest(0, floor(public.horse_steps_today(p_challenge_id, p_user) / 2000.0)::int
    - (select count(*)::int from public.horse_shots s
       where s.challenge_id = p_challenge_id and s.user_id = p_user and not s.timeout and s.day = public.soccer_today(p_user)));
$$;
revoke execute on function public.horse_tries(uuid, uuid) from public, anon, authenticated;

-- The unlock needed for a spot, or null when it's open to this player.
create or replace function public.horse_locked(p_challenge_id uuid, p_user uuid, p_spot jsonb)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  far jsonb := public.horse_far(p_spot ->> 'kind');
  place text;
begin
  if far is null or public.horse_best_day(p_challenge_id, p_user) >= (far ->> 'need')::int then
    return null;
  end if;
  place := case p_spot ->> 'kind' when 'stands' then 'the stands' when 'rafters' then 'the rafters'
    when 'lot' then 'the parking lot' else 'the rooftop across the street' end;
  return 'A ' || ((far ->> 'need')::int / 1000) || 'K day unlocks ' || place || ' for the rest of the game.';
end;
$$;
revoke execute on function public.horse_locked(uuid, uuid, jsonb) from public, anon, authenticated;

-- ── Turns ──

create or replace function public.horse_other(p_challenge_id uuid, p_user uuid)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select cp.user_id from public.challenge_participants cp
  where cp.challenge_id = p_challenge_id and cp.user_id <> p_user
  order by cp.joined_at limit 1;
$$;
revoke execute on function public.horse_other(uuid, uuid) from public, anon, authenticated;

create or replace function public.horse_turn_push(p_challenge_id uuid, p_recipient uuid, p_message text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.hoops_notify('horse_turn', p_challenge_id, p_recipient, jsonb_build_object('message', p_message));
end;
$$;
revoke execute on function public.horse_turn_push(uuid, uuid, text) from public, anon, authenticated;

-- Ends a hands-on game: the winner (null on a tie), the stakes, the pushes.
create or replace function public.horse_end(p_challenge_id uuid, p_winner uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.horse_games%rowtype;
  r public.treat_recipes%rowtype;
  loser uuid;
  word_text text;
begin
  update public.horse_games set status = 'final', winner = p_winner, turn_user = null, turn_kind = null,
      pending = null, updated_at = now()
    where challenge_id = p_challenge_id and status = 'active'
    returning * into g;
  if not found then
    return;
  end if;
  word_text := array_to_string(regexp_split_to_array(g.word, ''), '-');
  if p_winner is null then
    for loser in select cp.user_id from public.challenge_participants cp where cp.challenge_id = p_challenge_id loop
      perform public.horse_turn_push(p_challenge_id, loser, 'H-O-R-S-E ends level: a tie.');
    end loop;
    return;
  end if;
  loser := public.horse_other(p_challenge_id, p_winner);
  if g.stakes is not null and g.stakes_paid_at is null and loser is not null then
    select * into r from public.treat_recipes t where t.id = g.stakes;
    insert into public.hound_treats (user_id, made_by, recipe_id, used, bones, gifted_at, note)
      values (p_winner, loser, r.id, '{}', r.bones, now(), 'Lost at H-O-R-S-E');
    update public.profiles p set bones_balance = greatest(0, coalesce(p.bones_balance, 0) - r.bones) where p.id = loser;
    update public.horse_games set stakes_paid_at = now() where challenge_id = p_challenge_id;
  end if;
  perform public.horse_turn_push(p_challenge_id, p_winner, 'You won ' || word_text || ' against ' || public.horse_name(loser) || '!'
    || case when r.id is not null then ' ' || public.horse_name(loser) || ' baked your hound a ' || r.name || '.' else '' end);
  if loser is not null then
    perform public.horse_turn_push(p_challenge_id, loser, public.horse_name(p_winner) || ' won ' || word_text || '.'
      || case when r.id is not null then ' You baked their hound a ' || r.name || ' (' || r.bones || ' Bones).' else '' end);
  end if;
end;
$$;
revoke execute on function public.horse_end(uuid, uuid) from public, anon, authenticated;

-- A letter to the matcher; ends the game if it spells the word. Returns
-- true when it did.
create or replace function public.horse_give_letter(p_challenge_id uuid, p_to uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  g public.horse_games%rowtype;
  n int;
begin
  select * into g from public.horse_games where challenge_id = p_challenge_id;
  n := public.horse_letter_count(g, p_to) + 1;
  update public.horse_games set letters = letters || jsonb_build_object(p_to::text, n), updated_at = now()
    where challenge_id = p_challenge_id;
  if n >= length(g.word) then
    perform public.horse_end(p_challenge_id, public.horse_other(p_challenge_id, p_to));
    return true;
  end if;
  return false;
end;
$$;
revoke execute on function public.horse_give_letter(uuid, uuid) from public, anon, authenticated;

-- Brings a hands-on game up to now: starts the first turn once both are
-- in, settles turns that ran out (a match not tried is a letter, a set not
-- taken passes), and ends it once the challenge is over.
create or replace function public.horse_sync(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.horse_games%rowtype;
  opp uuid;
  deadline timestamptz;
  nxt uuid;
  ended boolean;
  i int := 0;
  a_letters int;
  b_letters int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.horse_games where challenge_id = p_challenge_id for update;
  if not found or not g.hands_on or g.status <> 'active' then
    return;
  end if;
  opp := public.horse_other(p_challenge_id, c.created_by);

  if g.turn_user is null and opp is not null then
    update public.horse_games set turn_user = c.created_by, turn_kind = 'set', shots_left = 1,
        turn_started_at = greatest(c.starts_at, (select cp.joined_at from public.challenge_participants cp
                                                 where cp.challenge_id = p_challenge_id and cp.user_id = opp)),
        updated_at = now()
      where challenge_id = p_challenge_id
      returning * into g;
  end if;

  while g.status = 'active' and g.turn_user is not null and i < 60 loop
    deadline := g.turn_started_at + interval '24 hours';
    exit when deadline > now() or deadline > c.ends_at;
    i := i + 1;
    insert into public.horse_shots (challenge_id, user_id, kind, day, spot, calls, timeout)
      values (p_challenge_id, g.turn_user, g.turn_kind, (deadline at time zone 'America/New_York')::date,
              g.pending -> 'spot', coalesce((select array_agg(x) from jsonb_array_elements_text(g.pending -> 'calls') x), '{}'), true);
    if g.turn_kind = 'match' then
      nxt := (g.pending ->> 'by')::uuid;
      ended := public.horse_give_letter(p_challenge_id, g.turn_user);
      if not ended then
        update public.horse_games set turn_user = nxt, turn_kind = 'set', shots_left = 1, pending = null,
            turn_started_at = deadline, updated_at = now()
          where challenge_id = p_challenge_id;
        perform public.horse_turn_push(p_challenge_id, nxt, public.horse_name(g.turn_user)
          || ' ran out of time to match your shot and takes a letter. Your turn to set a shot.');
      end if;
    else
      nxt := public.horse_other(p_challenge_id, g.turn_user);
      update public.horse_games set turn_user = nxt, turn_kind = 'set', shots_left = 1, pending = null,
          turn_started_at = deadline, updated_at = now()
        where challenge_id = p_challenge_id;
      perform public.horse_turn_push(p_challenge_id, nxt, public.horse_name(g.turn_user)
        || ' didn''t set a shot in time. Your turn to set a shot.');
    end if;
    select * into g from public.horse_games where challenge_id = p_challenge_id;
  end loop;

  if g.status = 'active' and now() >= c.ends_at then
    if opp is null then
      update public.horse_games set status = 'final', winner = null, turn_user = null, turn_kind = null, updated_at = now()
        where challenge_id = p_challenge_id;
    else
      a_letters := public.horse_letter_count(g, c.created_by);
      b_letters := public.horse_letter_count(g, opp);
      perform public.horse_end(p_challenge_id,
        case when a_letters < b_letters then c.created_by when b_letters < a_letters then opp end);
    end if;
  end if;
end;
$$;
revoke execute on function public.horse_sync(uuid) from public, anon, authenticated;

-- ── Setting up ──

drop function public.horse_setup(uuid, text);
create or replace function public.horse_setup(p_challenge_id uuid, p_word text default 'HORSE', p_hands_on boolean default false, p_stakes text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'horse' or c.created_by is distinct from auth.uid() then
    raise exception 'Only whoever made this game can set it up.';
  end if;
  if not (public.hoops_cfg()).enabled then
    raise exception 'Hoops is paused right now.';
  end if;
  if coalesce(p_word, 'HORSE') not in ('HORSE', 'PIG') then
    raise exception 'Play to HORSE or PIG.';
  end if;
  if c.duration_days < 3 or c.duration_days > 14 then
    raise exception 'A game of H-O-R-S-E is 3 to 14 days.';
  end if;
  if p_stakes is not null and not exists (select 1 from public.treat_recipes r where r.id = p_stakes) then
    raise exception 'Pick a treat for the stakes.';
  end if;
  if exists (select 1 from public.horse_games g where g.challenge_id = p_challenge_id) then
    raise exception 'This game is already set up.';
  end if;
  insert into public.horse_games (challenge_id, word, setter, hands_on, stakes)
    values (p_challenge_id, coalesce(p_word, 'HORSE'), auth.uid(), coalesce(p_hands_on, false),
            case when coalesce(p_hands_on, false) then p_stakes end);
end;
$$;
revoke execute on function public.horse_setup(uuid, text, boolean, text) from public, anon;
grant execute on function public.horse_setup(uuid, text, boolean, text) to authenticated;

-- ── Playing ──

create or replace function public.horse_shot_json(s public.horse_shots, p_over_chair boolean)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'by', s.user_id, 'kind', s.kind, 'spot', s.spot, 'calls', to_jsonb(s.calls), 'made', s.made, 'swish', s.swish,
    'stars', s.stars, 'highlight', s.highlight, 'timeout', s.timeout, 'at', s.created_at,
    'description', case when s.spot is not null then public.horse_describe(s.spot, s.calls, p_over_chair) end);
$$;
revoke execute on function public.horse_shot_json(public.horse_shots, boolean) from public, anon, authenticated;

create or replace function public.horse_live(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges%rowtype;
  g public.horse_games%rowtype;
  them uuid;
  steps int;
  best int;
  tries int;
  today date;
  reason text;
  r public.treat_recipes%rowtype;
  last_shot public.horse_shots%rowtype;
  wname text;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if c.id is null or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me) then
    raise exception 'You''re not playing in this game.';
  end if;
  perform public.horse_sync(p_challenge_id);
  select * into g from public.horse_games where challenge_id = p_challenge_id;
  if not found then
    raise exception 'This game''s court isn''t set up yet.';
  end if;
  them := public.horse_other(p_challenge_id, me);
  today := public.soccer_today(me);
  steps := public.horse_steps_today(p_challenge_id, me);
  best := public.horse_best_day(p_challenge_id, me);
  tries := public.horse_tries(p_challenge_id, me);
  if g.stakes is not null then
    select * into r from public.treat_recipes t where t.id = g.stakes;
  end if;
  select * into last_shot from public.horse_shots s where s.challenge_id = p_challenge_id order by s.seq desc limit 1;

  reason := case
    when not g.hands_on then 'This game plays itself.'
    when g.status <> 'active' then 'This game is over.'
    when g.turn_user is null then 'Waiting for your opponent to join.'
    when g.turn_user <> me then public.horse_name(g.turn_user) || '''s turn.'
    when g.turn_kind = 'match' and public.horse_locked(p_challenge_id, me, g.pending -> 'spot') is not null
      then public.horse_locked(p_challenge_id, me, g.pending -> 'spot')
    when tries <= 0 then 'No tries ready: the next comes at ' || to_char((floor(steps / 2000.0)::int + 1) * 2000, 'FM999,999') || ' steps.'
  end;

  return jsonb_build_object(
    'hands_on', g.hands_on,
    'status', case when g.status = 'final' then 'final' else 'live' end,
    'word', g.word,
    'letters', (select coalesce(jsonb_object_agg(cp.user_id::text, public.horse_letter_count(g, cp.user_id)), '{}'::jsonb)
                from public.challenge_participants cp where cp.challenge_id = p_challenge_id),
    'me', me,
    'them', case when them is not null then jsonb_build_object('id', them, 'name', public.horse_name(them)) end,
    'turn', case when g.turn_user is not null then jsonb_build_object(
        'user', g.turn_user, 'kind', g.turn_kind, 'ends_at', g.turn_started_at + interval '24 hours',
        'mine', g.turn_user = me, 'shots_left', g.shots_left) end,
    'pending', g.pending,
    'steps', steps,
    'best_day', best,
    'tries', tries,
    'next_try_at', (floor(steps / 2000.0)::int + 1) * 2000,
    'unlocks', (select jsonb_agg(jsonb_build_object('kind', k, 'name', public.horse_far(k) ->> 'name',
        'need', (public.horse_far(k) ->> 'need')::int, 'unlocked', best >= (public.horse_far(k) ->> 'need')::int,
        'feet', (public.horse_far(k) ->> 'feet')::int) order by n)
      from unnest(array['stands', 'rafters', 'lot', 'roof']) with ordinality u(k, n)),
    'obstacle', public.horse_obstacle(p_challenge_id, today),
    'steady', round(0.85 + 0.3 * least(1, steps / 12000.0), 3),
    'stakes', case when r.id is not null then jsonb_build_object('recipe', r.id, 'name', r.name, 'bones', r.bones,
        'paid', g.stakes_paid_at is not null) end,
    'last', case when last_shot.id is not null then public.horse_shot_json(last_shot,
        coalesce((last_shot.spot is not null and public.horse_over_chair(last_shot.spot, public.horse_obstacle(p_challenge_id, last_shot.day))), false)) end,
    'winner', g.winner,
    'can_shoot', reason is null,
    'reason', reason
  );
end;
$$;
revoke execute on function public.horse_live(uuid) from public, anon;
grant execute on function public.horse_live(uuid) to authenticated;

-- What a call is worth before you shoot it, as the server will judge it.
create or replace function public.horse_preview(p_challenge_id uuid, p_spot jsonb, p_calls text[])
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  spot jsonb;
  calls text[];
  chair boolean;
  w numeric;
begin
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me) then
    raise exception 'You''re not playing in this game.';
  end if;
  spot := public.horse_spot(p_spot);
  calls := public.horse_calls(spot, p_calls);
  chair := public.horse_over_chair(spot, public.horse_obstacle(p_challenge_id, public.soccer_today(me)));
  w := public.horse_window(spot, calls, chair, public.horse_steps_today(p_challenge_id, me));
  return jsonb_build_object('window', w, 'stars', public.horse_stars(w), 'feet', round(public.horse_spot_feet(spot)),
    'over_chair', chair, 'spot_name', public.horse_spot_name(spot), 'scene', case when public.horse_spot_out(spot) then 'out' else 'in' end,
    'locked', public.horse_locked(p_challenge_id, me, spot),
    'description', public.horse_describe(spot, calls, chair));
end;
$$;
revoke execute on function public.horse_preview(uuid, jsonb, text[]) from public, anon;
grant execute on function public.horse_preview(uuid, jsonb, text[]) to authenticated;

-- One shot: your call (spot and calls) when you're setting, the pending
-- shot when you're matching (p_spot and p_calls are ignored then).
create or replace function public.horse_shoot(p_challenge_id uuid, p_spot jsonb, p_calls text[], p_timing numeric)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  g public.horse_games%rowtype;
  them uuid;
  them_name text;
  spot jsonb;
  calls text[];
  chair boolean;
  w numeric;
  stars int;
  a numeric;
  in_green boolean;
  swish boolean;
  is_net boolean;
  made boolean;
  not_net boolean;
  highlight boolean := false;
  descr text;
  locked text;
  letter_to uuid;
  ended boolean := false;
  msg text;
  today date;
  r public.treat_recipes%rowtype;
  letter_ch text;
  word_text text;
begin
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me) then
    raise exception 'You''re not playing in this game.';
  end if;
  perform public.horse_sync(p_challenge_id);
  select * into g from public.horse_games where challenge_id = p_challenge_id for update;
  if not found then
    raise exception 'This game''s court isn''t set up yet.';
  end if;
  if not g.hands_on then
    raise exception 'This game plays itself.';
  end if;
  if g.status <> 'active' then
    raise exception 'This game is over.';
  end if;
  if g.turn_user is null then
    raise exception 'Waiting for your opponent to join.';
  end if;
  if g.turn_user <> me then
    raise exception '%''s turn.', public.horse_name(g.turn_user);
  end if;
  if p_timing is null then
    raise exception 'Release the shot first.';
  end if;
  them := public.horse_other(p_challenge_id, me);
  them_name := public.horse_name(them);
  today := public.soccer_today(me);

  if g.turn_kind = 'match' then
    spot := g.pending -> 'spot';
    calls := coalesce((select array_agg(x) from jsonb_array_elements_text(g.pending -> 'calls') x), '{}');
    chair := coalesce((g.pending ->> 'over_chair')::boolean, false);
  else
    spot := public.horse_spot(p_spot);
    calls := public.horse_calls(spot, p_calls);
    chair := public.horse_over_chair(spot, public.horse_obstacle(p_challenge_id, today));
  end if;
  locked := public.horse_locked(p_challenge_id, me, spot);
  if locked is not null then
    raise exception '%', locked;
  end if;
  if public.horse_tries(p_challenge_id, me) <= 0 then
    raise exception 'No tries ready: the next comes at % steps.',
      to_char((floor(public.horse_steps_today(p_challenge_id, me) / 2000.0)::int + 1) * 2000, 'FM999,999');
  end if;

  w := public.horse_window(spot, calls, chair, public.horse_steps_today(p_challenge_id, me));
  stars := public.horse_stars(w);
  descr := public.horse_describe(spot, calls, chair);
  a := abs(greatest(-0.5, least(0.5, p_timing)));
  in_green := a <= w / 2;
  swish := a <= w / 4;
  is_net := 'net' = any(calls);
  made := case when is_net then swish else in_green end;
  not_net := is_net and in_green and not swish;
  highlight := made and stars >= 4;

  insert into public.horse_shots (challenge_id, user_id, kind, day, spot, calls, timing, win, stars, made, swish, highlight)
    values (p_challenge_id, me, g.turn_kind, today, spot, calls, p_timing, w, stars, made, swish, highlight);
  if highlight then
    insert into public.challenge_messages (challenge_id, user_id, kind, body)
      values (p_challenge_id, me, 'text', left('🏀 Highlight in H-O-R-S-E: ' || descr || ' ' || public.horse_star_text(stars), 200));
  end if;

  if g.turn_kind = 'set' then
    if made then
      update public.horse_games set turn_user = them, turn_kind = 'match',
          shots_left = case when public.horse_letter_count(g, them) = length(g.word) - 1 then 2 else 1 end,
          pending = jsonb_build_object('by', me, 'spot', spot, 'calls', to_jsonb(calls), 'over_chair', chair, 'stars', stars,
                                       'description', descr, 'at', now()),
          turn_started_at = now(), updated_at = now()
        where challenge_id = p_challenge_id;
      msg := case when highlight then 'Highlight! The crowd''s on its feet, and it''s posted to the challenge''s Talk. ' else 'Shot set. ' end
        || them_name || ' has 24 hours to match it: ' || descr || ' Miss it and they take the next letter.';
      perform public.horse_turn_push(p_challenge_id, them, public.horse_name(me) || ' set a shot: ' || descr || ' You have 24 hours to match it.');
    else
      update public.horse_games set turn_user = them, turn_kind = 'set', shots_left = 1, pending = null,
          turn_started_at = now(), updated_at = now()
        where challenge_id = p_challenge_id;
      msg := case when not_net
        then 'In, but you called nothing but net, so it doesn''t count. No letter either way: the turn passes and ' || them_name || ' sets the next shot.'
        else 'Missed your own call. No letter, but the turn passes: ' || them_name || ' sets the next shot.' end;
      perform public.horse_turn_push(p_challenge_id, them, public.horse_name(me) || ' missed their call. Your turn to set a shot.');
    end if;
  else
    if made then
      update public.horse_games set turn_user = them, turn_kind = 'set', shots_left = 1, pending = null,
          turn_started_at = now(), updated_at = now()
        where challenge_id = p_challenge_id;
      msg := 'Matched it. No letter, and ' || them_name || ' keeps setting.';
      perform public.horse_turn_push(p_challenge_id, them, public.horse_name(me) || ' matched it. Your turn to set a shot.');
    elsif g.shots_left > 1 then
      update public.horse_games set shots_left = shots_left - 1, updated_at = now() where challenge_id = p_challenge_id;
      msg := 'Missed, but it''s your last letter, so you get one more try (the rebuttal).';
    else
      letter_to := me;
      letter_ch := substr(g.word, public.horse_letter_count(g, me) + 1, 1);
      ended := public.horse_give_letter(p_challenge_id, me);
      if ended then
        word_text := array_to_string(regexp_split_to_array(g.word, ''), '-');
        if g.stakes is not null then
          select * into r from public.treat_recipes t where t.id = g.stakes;
        end if;
        msg := word_text || '. ' || them_name || ' wins'
          || case when r.id is not null then ', and you owe ' || them_name || '''s hound a ' || r.name || '.' else '.' end;
      else
        update public.horse_games set turn_user = them, turn_kind = 'set', shots_left = 1, pending = null,
            turn_started_at = now(), updated_at = now()
          where challenge_id = p_challenge_id;
        msg := 'You take the ' || letter_ch || '. ' || them_name || ' sets the next shot.';
        perform public.horse_turn_push(p_challenge_id, them, public.horse_name(me) || ' missed and takes the ' || letter_ch || '. Your turn to set a shot.');
      end if;
    end if;
  end if;

  select * into g from public.horse_games where challenge_id = p_challenge_id;
  return jsonb_build_object(
    'made', made, 'swish', swish, 'not_net', not_net, 'window', w, 'stars', stars, 'description', descr,
    'highlight', highlight, 'letter_to', letter_to, 'game_over', g.status = 'final', 'winner', g.winner,
    'turn', case when g.turn_user is not null then jsonb_build_object('user', g.turn_user, 'kind', g.turn_kind,
        'ends_at', g.turn_started_at + interval '24 hours', 'mine', g.turn_user = me, 'shots_left', g.shots_left) end,
    'message', msg,
    'tries', public.horse_tries(p_challenge_id, me));
end;
$$;
revoke execute on function public.horse_shoot(uuid, jsonb, text[], numeric) from public, anon;
grant execute on function public.horse_shoot(uuid, jsonb, text[], numeric) to authenticated;

-- ── The daily job: hands-on games are kept up to date and end on time ──

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
  -- 0209: a hands-on game is played turn by turn.
  if g.hands_on then
    perform public.horse_sync(p_challenge_id);
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

-- ── The view (0196's, with the hands-on game) ──

create or replace function public.horse_view(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.horse_games%rowtype;
  first_day date;
  today date;
  live jsonb;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.horse_games where challenge_id = p_challenge_id;
  if c.id is null or g.challenge_id is null
     or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller) then
    raise exception 'not authorized';
  end if;
  -- 0209: brings a hands-on game up to date first.
  if g.hands_on then
    live := public.horse_live(p_challenge_id);
    select * into g from public.horse_games where challenge_id = p_challenge_id;
  end if;
  first_day := public.soccer_first_day(c);
  today := public.soccer_today(caller);
  return jsonb_build_object(
    'status', case when g.status = 'final' then 'final' when today < first_day and g.days_played = 0 and not g.hands_on then 'upcoming' else 'live' end,
    'first_day', first_day,
    'day_no', greatest(0, today - first_day + 1),
    'days', c.duration_days,
    'word', g.word,
    'setter', g.setter,
    'me', caller,
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', cp.user_id, 'name', public.horse_name(cp.user_id), 'initials', p.initials,
        'icon_id', p.equipped_icon_id, 'frame_id', p.equipped_frame_id, 'background_id', p.equipped_background_id,
        'letters', left(g.word, public.horse_letter_count(g, cp.user_id)),
        'steps_today', coalesce((select ps.steps from public.progress_snapshots ps where ps.challenge_id = p_challenge_id and ps.user_id = cp.user_id and ps.day = today), 0))
      order by (cp.user_id = c.created_by) desc, cp.joined_at), '[]'::jsonb)
      from public.challenge_participants cp join public.profiles p on p.id = cp.user_id
      where cp.challenge_id = p_challenge_id),
    'shot', jsonb_build_object('id', g.shot, 'name', public.horse_shot_name(g.shot), 'target', public.horse_target(g.shot)),
    'shots', public.horse_shots(),
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
        'day_no', hd.day_no, 'setter', hd.setter, 'shot', hd.shot, 'target', hd.target, 'setter_steps', hd.setter_steps,
        'made', hd.made, 'matcher_steps', hd.matcher_steps, 'matched', hd.matched, 'letter_to', hd.letter_to)
      order by hd.day_no), '[]'::jsonb)
      from public.horse_days hd where hd.challenge_id = p_challenge_id),
    'winner', g.winner,
    'hands_on', g.hands_on,
    'live', live,
    'recent', (select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) from (
        select public.horse_shot_json(s, coalesce((s.spot is not null and public.horse_over_chair(s.spot, public.horse_obstacle(p_challenge_id, s.day))), false)) as j,
               s.seq as at
        from public.horse_shots s where s.challenge_id = p_challenge_id
        order by s.seq desc limit 10) x)
  );
end;
$$;
revoke execute on function public.horse_view(uuid) from public, anon;
grant execute on function public.horse_view(uuid) to authenticated;

-- ── Admin (0206's, with H-O-R-S-E by hand) ──

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
      'swish_7d', (select count(*) from public.hoops_live_shots l where l.quality = 'swish' and l.created_at > now() - interval '7 days')),
    -- 0209: H-O-R-S-E, call your shot.
    'horse_hands_on', jsonb_build_object(
      'games_hands_on', (select count(*) from public.horse_games g where g.hands_on and g.status = 'active'),
      'people_7d', (select count(distinct s.user_id) from public.horse_shots s where not s.timeout and s.created_at > now() - interval '7 days'),
      'shots_7d', (select count(*) from public.horse_shots s where not s.timeout and s.created_at > now() - interval '7 days'),
      'made_rate_7d', (select round(avg(case when s.made then 1.0 else 0.0 end), 3) from public.horse_shots s
                       where not s.timeout and s.created_at > now() - interval '7 days'),
      'highlights_7d', (select count(*) from public.horse_shots s where s.highlight and s.created_at > now() - interval '7 days'),
      'far_shots_7d', (select count(*) from public.horse_shots s where not s.timeout and s.spot ->> 'kind' in ('stands', 'rafters', 'lot', 'roof')
                       and s.created_at > now() - interval '7 days'),
      'stakes_paid_all', (select count(*) from public.horse_games g where g.stakes_paid_at is not null),
      'timeouts_7d', (select count(*) from public.horse_shots s where s.timeout and s.created_at > now() - interval '7 days'))
  );
end;
$$;

revoke execute on function public.admin_hoops_overview() from public, anon;
grant execute on function public.admin_hoops_overview() to authenticated;
