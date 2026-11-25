-- 0269: Fasting phase games (Steve, 25 Nov 2026: "what type of mini-games
-- or activities can be done as each phase of the Fast is hit... an
-- all-time, continuous leaderboard of points"). Mock-ups:
-- claude.ai/artifact/U1CrpWcmrmk9ijwxZSaAuK.
--
-- A fast has up to four slots, each a short game played once, scored 0-100:
--
--   settling  from 4 h   Craving Control or Steady Pour (they take turns
--                        by day, the same for everyone)
--   fatburn   from 12 h  Burn Zone
--   ketosis   from 16 h  Clarity
--   goal      at the fast's goal  Refeed
--
-- Only slots up to the goal count (a phase slot whose hour is past the
-- goal never opens), so a 12:12 plays 3 and a 16:8 plays 4, and nothing
-- rewards fasting longer than planned (goals are at most 24 h). A slot
-- opens when its hour is reached and stays open for the rest of the fast
-- and 12 hours after it ends; ending early costs nothing already earned.
--
-- Each day's games are the same test for everyone: the seed comes from
-- the game and the UTC date, and the app builds the game from it. The app
-- sends the run's numbers (fasting_game_finish) and the server works the
-- score out from them, after checking they're possible and the run took
-- long enough. A run left unfinished for 15 minutes counts as played, 0.
--
-- Fast Points are the sum of scores. Boards (fasting_games_board): all-
-- time, this week (from Monday) and friends; like the rest of Fasting,
-- only people who share are on them (and you, always). Each finished game
-- pays fasting_config.game_bones (Admin → Bones, default 5).
--
-- Run this once, after 0001-0268, in the SQL Editor.

alter table public.fasting_config
  add column if not exists game_bones int not null default 5 check (game_bones >= 0),
  add column if not exists games_on boolean not null default true;

create table public.fasting_games (
  id uuid primary key default gen_random_uuid(),
  fast_id uuid not null references public.fasts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  slot text not null check (slot in ('settling', 'fatburn', 'ketosis', 'goal')),
  game text not null check (game in ('craving', 'pour', 'burn', 'clarity', 'refeed')),
  seed int not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score int check (score between 0 and 100),
  stats jsonb,
  bones int not null default 0,
  unique (fast_id, slot)
);
create index fasting_games_user on public.fasting_games (user_id, finished_at);
create index fasting_games_finished on public.fasting_games (finished_at);
alter table public.fasting_games enable row level security;
create policy "Owners can view their fasting games"
  on public.fasting_games for select to authenticated using (user_id = auth.uid());
revoke all on public.fasting_games from anon;
revoke insert, update, delete on public.fasting_games from authenticated;

-- ── Helpers ──

-- The hour a slot opens on a fast with this goal, or null if it doesn't
-- count on that goal.
create or replace function public.fasting_slot_at(p_slot text, p_goal int)
returns numeric
language sql
immutable
as $$
  select case
    when p_slot = 'goal' then p_goal::numeric
    when p_slot = 'settling' and 4 <= p_goal then 4
    when p_slot = 'fatburn' and 12 <= p_goal then 12
    when p_slot = 'ketosis' and 16 <= p_goal then 16
  end;
$$;
revoke execute on function public.fasting_slot_at(text, int) from public, anon, authenticated;

-- Which game a slot plays on a (UTC) day. Settling's two take turns.
create or replace function public.fasting_slot_game(p_slot text, p_day date)
returns text
language sql
immutable
as $$
  select case p_slot
    when 'settling' then case when (p_day - date '2026-01-05') % 2 = 0 then 'craving' else 'pour' end
    when 'fatburn' then 'burn'
    when 'ketosis' then 'clarity'
    else 'refeed' end;
$$;
revoke execute on function public.fasting_slot_game(text, date) from public, anon, authenticated;

create or replace function public.fasting_game_seed(p_game text, p_day date)
returns int
language sql
immutable
as $$ select (abs(hashtext(p_game || ':' || p_day::text)::bigint) % 2147483646 + 1)::int; $$;
revoke execute on function public.fasting_game_seed(text, date) from public, anon, authenticated;

-- A run's score from its numbers (mirrored in the app's fastingGames.ts).
-- Raises if the numbers aren't possible.
create or replace function public.fasting_game_score(p_game text, s jsonb, p_secs numeric)
returns int
language plpgsql
immutable
as $$
declare
  a numeric;
  b numeric;
  bad constant text := 'That score doesn''t add up.';
begin
  if s is null or jsonb_typeof(s) <> 'object' then
    raise exception '%', bad;
  end if;
  if p_game = 'craving' then
    a := (s ->> 'right')::numeric; b := (s ->> 'streak')::numeric;
    if a is null or b is null or a <> floor(a) or b <> floor(b) or a not between 0 and 20 or b not between 0 and a or p_secs < 10 then
      raise exception '%', bad;
    end if;
    return least(100, round(a / 20 * 85 + least(b, 10) * 1.5));
  elsif p_game = 'pour' then
    a := (s ->> 'off')::numeric;
    if a is null or a not between 0 and 100 or p_secs < 3 then raise exception '%', bad; end if;
    return greatest(0, round(100 - a * 6));
  elsif p_game = 'burn' then
    a := (s ->> 'pct')::numeric;
    if a is null or a not between 0 and 100 or p_secs < 29 then raise exception '%', bad; end if;
    return least(100, round(a * 1.12));
  elsif p_game = 'clarity' then
    a := (s ->> 'ms')::numeric;
    if a is null or a not between 130 and 5000 or p_secs < 4 then raise exception '%', bad; end if;
    return greatest(0, least(100, round((560 - a) / 2.8)));
  elsif p_game = 'refeed' then
    a := (s ->> 'pts')::numeric; b := (s ->> 'left')::numeric;
    if a is null or b is null or a <> floor(a) or a not between -12 and 12 or b not between 0 and 12 or p_secs < 11 - b then
      raise exception '%', bad;
    end if;
    return greatest(0, least(100, round(a / 12 * 85 + b * 1.5)));
  end if;
  raise exception '%', bad;
end;
$$;
revoke execute on function public.fasting_game_score(text, jsonb, numeric) from public, anon, authenticated;

-- Runs left unfinished for 15 minutes count as played, 0.
create or replace function public.fasting_games_close_stale(p_user uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.fasting_games g set finished_at = g.started_at + interval '15 minutes', score = 0, stats = '{"abandoned": true}'::jsonb
  where g.user_id = p_user and g.finished_at is null and g.started_at < now() - interval '15 minutes';
$$;
revoke execute on function public.fasting_games_close_stale(uuid) from public, anon, authenticated;

-- My latest fast that games can still be played on: open, or ended in the
-- last 12 hours.
create or replace function public.fasting_games_fast(p_user uuid)
returns public.fasts
language sql
stable
security definer set search_path = public
as $$
  select f.* from public.fasts f
  where f.user_id = p_user and (f.ended_at is null or f.ended_at > now() - interval '12 hours')
  order by f.started_at desc limit 1;
$$;
revoke execute on function public.fasting_games_fast(uuid) from public, anon, authenticated;

-- Who can be on a board: shares fasting and is 16+.
create or replace function public.fasting_games_visible(p_user uuid, p_me uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select p_user = p_me or exists (select 1 from public.fasting_profiles fp where fp.user_id = p_user and fp.share and fp.age = 'ok');
$$;
revoke execute on function public.fasting_games_visible(uuid, uuid) from public, anon, authenticated;

-- ── The slots on my fast ──

create or replace function public.fasting_games_state()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.fasting_config;
  f public.fasts;
  h numeric;
  today date := (now() at time zone 'utc')::date;
  slots jsonb := '[]'::jsonb;
  sl text;
  at_h numeric;
  g public.fasting_games;
  pts int;
begin
  perform public.fasting_require_ok(me);
  select * into c from public.fasting_config where id;
  if not c.games_on then
    return jsonb_build_object('on', false);
  end if;
  perform public.fasting_games_close_stale(me);
  select coalesce(sum(score), 0) into pts from public.fasting_games where user_id = me and finished_at is not null;
  f := public.fasting_games_fast(me);
  if f.id is not null then
    h := extract(epoch from (coalesce(f.ended_at, now()) - f.started_at)) / 3600.0;
    foreach sl in array array['settling', 'fatburn', 'ketosis', 'goal'] loop
      at_h := public.fasting_slot_at(sl, f.goal_hours);
      continue when at_h is null;
      select * into g from public.fasting_games x where x.fast_id = f.id and x.slot = sl;
      slots := slots || jsonb_build_object(
        'slot', sl,
        'at', at_h,
        'game', coalesce(g.game, public.fasting_slot_game(sl, today)),
        'status', case
          when g.id is not null and g.finished_at is not null then case when g.stats ? 'abandoned' then 'left' else 'played' end
          when h >= at_h then 'open'
          else 'locked' end,
        'score', g.score,
        'id', g.id);
    end loop;
  end if;
  return jsonb_build_object(
    'on', true,
    'bones', c.game_bones,
    'points', pts,
    'fast', case when f.id is null then null else jsonb_build_object(
      'id', f.id, 'goal_hours', f.goal_hours, 'started_at', f.started_at, 'ended_at', f.ended_at) end,
    'slots', slots);
end;
$$;
revoke execute on function public.fasting_games_state() from public, anon;
grant execute on function public.fasting_games_state() to authenticated;

-- ── Play ──

-- Start (or pick back up) the slot's run. Returns the game and its seed.
create or replace function public.fasting_game_start(p_fast_id uuid, p_slot text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.fasting_config;
  f public.fasts;
  at_h numeric;
  h numeric;
  g public.fasting_games;
  today date := (now() at time zone 'utc')::date;
  gm text;
begin
  perform public.fasting_require_ok(me);
  select * into c from public.fasting_config where id;
  if not c.games_on then
    raise exception 'Fasting games are off right now.';
  end if;
  perform public.fasting_games_close_stale(me);
  f := public.fasting_games_fast(me);
  if f.id is null or f.id <> p_fast_id then
    raise exception 'That fast''s games have closed.';
  end if;
  at_h := public.fasting_slot_at(p_slot, f.goal_hours);
  if at_h is null then
    raise exception 'That game isn''t part of this fast.';
  end if;
  h := extract(epoch from (coalesce(f.ended_at, now()) - f.started_at)) / 3600.0;
  if h < at_h then
    raise exception 'That game opens at % h.', trim(to_char(at_h, 'FM990'));
  end if;
  select * into g from public.fasting_games x where x.fast_id = f.id and x.slot = p_slot for update;
  if g.id is not null and g.finished_at is not null then
    raise exception 'You''ve played that one.';
  end if;
  if g.id is null then
    gm := public.fasting_slot_game(p_slot, today);
    insert into public.fasting_games (fast_id, user_id, slot, game, seed)
      values (f.id, me, p_slot, gm, public.fasting_game_seed(gm, today))
      returning * into g;
  end if;
  return jsonb_build_object('id', g.id, 'slot', g.slot, 'game', g.game, 'seed', g.seed, 'started_at', g.started_at);
end;
$$;
revoke execute on function public.fasting_game_start(uuid, text) from public, anon;
grant execute on function public.fasting_game_start(uuid, text) to authenticated;

-- Finish a run with its numbers. Scores it, pays the Bones, and says
-- where that puts you today and all-time.
create or replace function public.fasting_game_finish(p_id uuid, p_stats jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.fasting_config;
  g public.fasting_games;
  sc int;
  pay int;
  pts int;
  beat int;
  played int;
begin
  perform public.fasting_require_ok(me);
  select * into c from public.fasting_config where id;
  select * into g from public.fasting_games x where x.id = p_id and x.user_id = me for update;
  if g.id is null then
    raise exception 'That game isn''t yours.';
  end if;
  if g.finished_at is not null then
    raise exception 'You''ve played that one.';
  end if;
  if g.started_at < now() - interval '15 minutes' then
    perform public.fasting_games_close_stale(me);
    return jsonb_build_object('score', 0, 'bones', 0, 'timed_out', true,
      'points', (select coalesce(sum(score), 0) from public.fasting_games where user_id = me and finished_at is not null));
  end if;
  sc := public.fasting_game_score(g.game, p_stats, extract(epoch from (now() - g.started_at)));
  pay := c.game_bones;
  update public.fasting_games set finished_at = now(), score = sc, stats = p_stats, bones = pay where id = g.id;
  if pay > 0 then
    update public.profiles set bones_balance = bones_balance + pay where id = me;
    insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
      values (me, 'fasting', 0, 0, pay);
  end if;
  select coalesce(sum(score), 0) into pts from public.fasting_games where user_id = me and finished_at is not null;
  -- Today's field for this game (UTC day): how many you beat.
  select count(*) filter (where x.score < sc), count(*) into beat, played
    from public.fasting_games x
    where x.game = g.game and x.seed = g.seed and x.finished_at is not null and not (x.stats ? 'abandoned');
  return jsonb_build_object(
    'score', sc, 'bones', pay, 'points', pts,
    'top_pct', case when played <= 1 then null else greatest(1, ceil(100.0 * (played - beat) / played))::int end,
    'played_today', played);
end;
$$;
revoke execute on function public.fasting_game_finish(uuid, jsonb) from public, anon;
grant execute on function public.fasting_game_finish(uuid, jsonb) to authenticated;

-- ── Boards ──

-- p_scope: 'all', 'week' (from Monday of p_local_date) or 'friends'.
create or replace function public.fasting_games_board(p_scope text, p_local_date date default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  since timestamptz;
  res jsonb;
begin
  perform public.fasting_require_ok(me);
  if p_scope not in ('all', 'week', 'friends') then
    raise exception 'All-time, this week or friends.';
  end if;
  since := case when p_scope = 'week'
    then public.fasting_monday(coalesce(p_local_date, (now() at time zone 'utc')::date))::timestamp at time zone 'utc'
    else '-infinity'::timestamptz end;
  with t as (
    select g.user_id, sum(g.score)::int as points, count(*)::int as games, round(avg(g.score))::int as avg
    from public.fasting_games g
    where g.finished_at is not null and g.finished_at >= since
      and public.fasting_games_visible(g.user_id, me)
      and (p_scope <> 'friends' or g.user_id = me or g.user_id in (select public.fasting_friend_ids(me)))
    group by g.user_id
  ), r as (
    select t.*, rank() over (order by t.points desc, t.avg desc) as rk from t
  )
  select jsonb_build_object(
    'scope', p_scope,
    'of', (select count(*) from r),
    'me', (select jsonb_build_object('rank', r.rk, 'points', r.points, 'games', r.games, 'avg', r.avg) from r where r.user_id = me),
    'rows', coalesce((
      select jsonb_agg(public.fasting_person(x.user_id) || jsonb_build_object(
        'rank', x.rk, 'points', x.points, 'games', x.games, 'avg', x.avg, 'me', x.user_id = me) order by x.rk, x.user_id)
      from (select * from r order by rk limit 50) x), '[]'::jsonb))
  into res;
  return res;
end;
$$;
revoke execute on function public.fasting_games_board(text, date) from public, anon;
grant execute on function public.fasting_games_board(text, date) to authenticated;

-- ── Admin ──

create or replace function public.admin_fasting_games_overview()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  res jsonb;
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'not authorized';
  end if;
  with done as (select * from public.fasting_games where finished_at is not null),
  wk as (select * from done where finished_at > now() - interval '7 days')
  select jsonb_build_object(
    'players', (select count(distinct user_id) from done where not (stats ? 'abandoned')),
    'players_7d', (select count(distinct user_id) from wk where not (stats ? 'abandoned')),
    'games_7d', (select count(*) from wk where not (stats ? 'abandoned')),
    'left_7d', (select count(*) from wk where stats ? 'abandoned'),
    'bones_7d', (select coalesce(sum(bones), 0) from wk),
    'fasts_7d', (select count(distinct fast_id) from wk),
    'games_per_fast_7d', (select round(avg(n), 1) from (select count(*) n from wk group by fast_id) z),
    'points_all', (select coalesce(sum(score), 0) from done),
    'by_game', coalesce((
      select jsonb_object_agg(game, jsonb_build_object('n', n, 'avg', av))
      from (select game, count(*) n, round(avg(score))::int av from wk where not (stats ? 'abandoned') group by game) z), '{}'::jsonb),
    'top', coalesce((
      select jsonb_agg(public.fasting_person(user_id) || jsonb_build_object('points', pts, 'games', n) order by pts desc)
      from (select user_id, sum(score)::int pts, count(*) n from done group by user_id order by 2 desc limit 5) z), '[]'::jsonb),
    'games_on', (select games_on from public.fasting_config where id),
    'game_bones', (select game_bones from public.fasting_config where id))
  into res;
  return res;
end;
$$;
revoke execute on function public.admin_fasting_games_overview() from public, anon;
grant execute on function public.admin_fasting_games_overview() to authenticated;

-- Admin → Bones: game_bones and games_on join the fasting settings.
create or replace function public.admin_set_fasting_config(p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  k text;
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'Admins only.';
  end if;
  for k in select jsonb_object_keys(p) loop
    if k = 'games_on' then
      if jsonb_typeof(p -> k) <> 'boolean' then
        raise exception 'On or off.';
      end if;
      continue;
    end if;
    if k not in ('bones_12', 'bones_14', 'bones_16', 'bones_18', 'bones_20', 'streak_3', 'streak_7', 'streak_14', 'streak_30', 'streak_100', 'pack_bonus', 'game_bones') then
      raise exception 'Unknown setting %.', k;
    end if;
    if jsonb_typeof(p -> k) <> 'number' or (p ->> k)::numeric < 0 or (p ->> k)::numeric > 100000 or (p ->> k)::numeric <> floor((p ->> k)::numeric) then
      raise exception 'Enter a whole number of Bones from 0 to 100,000.';
    end if;
  end loop;
  update public.fasting_config c set
    bones_12 = coalesce((p ->> 'bones_12')::int, c.bones_12),
    bones_14 = coalesce((p ->> 'bones_14')::int, c.bones_14),
    bones_16 = coalesce((p ->> 'bones_16')::int, c.bones_16),
    bones_18 = coalesce((p ->> 'bones_18')::int, c.bones_18),
    bones_20 = coalesce((p ->> 'bones_20')::int, c.bones_20),
    streak_3 = coalesce((p ->> 'streak_3')::int, c.streak_3),
    streak_7 = coalesce((p ->> 'streak_7')::int, c.streak_7),
    streak_14 = coalesce((p ->> 'streak_14')::int, c.streak_14),
    streak_30 = coalesce((p ->> 'streak_30')::int, c.streak_30),
    streak_100 = coalesce((p ->> 'streak_100')::int, c.streak_100),
    pack_bonus = coalesce((p ->> 'pack_bonus')::int, c.pack_bonus),
    game_bones = coalesce((p ->> 'game_bones')::int, c.game_bones),
    games_on = coalesce((p ->> 'games_on')::boolean, c.games_on),
    updated_at = now()
  where c.id;
end;
$$;
revoke execute on function public.admin_set_fasting_config(jsonb) from public, anon;
grant execute on function public.admin_set_fasting_config(jsonb) to authenticated;
