-- Hound: walks, walk finds and the diary (lifestyle phase 1).
--
-- Your walks become the Hound's walks. The phone reads your steps in
-- 15-minute buckets from Health, spots the walks in them (a run of steady
-- steps of 10 minutes or more) and saves them here. Each finished walk
-- brings something home: a stick, a feather, a golden acorn in autumn.
-- Longer walks find rarer things. The Kennel shows the day's walks, what
-- was found, a collection book of every kind of find, and Fluffy's
-- diary, a line a day written on the phone from these walks.
--
--   hound_walks         one row per walk, with what it found
--   walk_find_kinds     the 22 kinds of find (10 all year, 3 a season)
--   walk_events         collection book and diary opens, diary shares,
--                       one row per person per kind per day (Admin)
--   save_hound_walks()  the phone's walks for a day; returns my_walks()
--   my_walks()          the last 7 days of walks, the collection, the
--                       kinds, and steps by day for the diary
--   log_walk_event()    'book_open' | 'diary_open' | 'diary_share'
--   admin_walks_overview()  Admin → Overview → Walks
--
-- Run this once, after 0001-0160, in the SQL Editor.

create table public.walk_find_kinds (
  id text primary key,
  name text not null,
  rarity text not null check (rarity in ('common', 'uncommon', 'rare')),
  -- Only found in this season (by the walk's month); null is all year.
  season text check (season in ('autumn', 'winter', 'spring', 'summer')),
  sort integer not null
);

alter table public.walk_find_kinds enable row level security;
revoke all on public.walk_find_kinds from anon, authenticated;

insert into public.walk_find_kinds (id, name, rarity, season, sort) values
  ('stick', 'A good stick', 'common', null, 10),
  ('pebble', 'Smooth pebble', 'common', null, 20),
  ('feather', 'Feather', 'common', null, 30),
  ('clover', 'Clover', 'common', null, 40),
  ('old_ball', 'Old tennis ball', 'common', null, 50),
  ('snail_shell', 'Snail shell', 'uncommon', null, 60),
  ('marble', 'Marble', 'uncommon', null, 70),
  ('heart_stone', 'Heart-shaped stone', 'uncommon', null, 80),
  ('four_leaf', 'Four-leaf clover', 'rare', null, 90),
  ('dog_tag', 'Old dog tag', 'rare', null, 100),
  ('autumn_leaf', 'Autumn leaf', 'common', 'autumn', 110),
  ('acorn', 'Acorn', 'uncommon', 'autumn', 120),
  ('golden_acorn', 'Golden acorn', 'rare', 'autumn', 130),
  ('snowball', 'Snowball', 'common', 'winter', 140),
  ('icicle', 'Icicle', 'uncommon', 'winter', 150),
  ('snowflake', 'Perfect snowflake', 'rare', 'winter', 160),
  ('blossom', 'Blossom', 'common', 'spring', 170),
  ('eggshell', 'Robin''s eggshell', 'uncommon', 'spring', 180),
  ('rainbow_feather', 'Rainbow feather', 'rare', 'spring', 190),
  ('wildflower', 'Wildflower', 'common', 'summer', 200),
  ('frisbee', 'Lost frisbee', 'uncommon', 'summer', 210),
  ('sea_glass', 'Sea glass', 'rare', 'summer', 220);

create table public.hound_walks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The walker's local day, and minutes after their local midnight that
  -- it started (for "Morning walk"), since the server doesn't know their
  -- time zone.
  day date not null,
  start_minute smallint not null check (start_minute between 0 and 1439),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  steps integer not null check (steps > 0),
  distance_m integer check (distance_m >= 0),
  find_id text references public.walk_find_kinds (id),
  found_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at > started_at)
);

create index hound_walks_user_day on public.hound_walks (user_id, day);
create index hound_walks_find on public.hound_walks (find_id) where find_id is not null;

alter table public.hound_walks enable row level security;
revoke all on public.hound_walks from anon, authenticated;

create table public.walk_events (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('book_open', 'diary_open', 'diary_share')),
  day date not null default current_date,
  primary key (user_id, kind, day)
);

alter table public.walk_events enable row level security;
revoke all on public.walk_events from anon, authenticated;

-- The season of a day, by its month (northern hemisphere).
create or replace function public.walk_season(p_day date)
returns text
language sql
immutable
as $$
  select case
    when extract(month from p_day) in (9, 10, 11) then 'autumn'
    when extract(month from p_day) in (12, 1, 2) then 'winter'
    when extract(month from p_day) in (3, 4, 5) then 'spring'
    else 'summer'
  end;
$$;

revoke execute on function public.walk_season(date) from public, anon, authenticated;

-- A kind of find for a walk of this many steps on this day. Longer walks
-- find rarer things:
--   under 3,000 steps   70% common, 25% uncommon, 5% rare
--   3,000 to 6,000      50%, 35%, 15%
--   over 6,000          35%, 40%, 25%
-- Only kinds for all year or this day's season.
create or replace function public.walk_roll_find(p_steps integer, p_day date)
returns text
language plpgsql
volatile
security definer set search_path = public
as $$
declare
  r double precision := random();
  common_cut double precision;
  rare_cut double precision;
  pick_rarity text;
  pick text;
begin
  if p_steps > 6000 then
    common_cut := 0.35; rare_cut := 0.75;
  elsif p_steps >= 3000 then
    common_cut := 0.50; rare_cut := 0.85;
  else
    common_cut := 0.70; rare_cut := 0.95;
  end if;
  pick_rarity := case when r < common_cut then 'common' when r < rare_cut then 'uncommon' else 'rare' end;
  select k.id into pick from public.walk_find_kinds k
    where k.rarity = pick_rarity and (k.season is null or k.season = public.walk_season(p_day))
    order by random() limit 1;
  return pick;
end;
$$;

revoke execute on function public.walk_roll_find(integer, date) from public, anon, authenticated;

-- What the Kennel shows: the last 7 days of walks (newest first), how
-- many of each kind you've found, every kind, and steps by day.
create or replace function public.my_walks(p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  return jsonb_build_object(
    'walks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id,
        'day', w.day,
        'start_minute', w.start_minute,
        'started_at', w.started_at,
        'ended_at', w.ended_at,
        'steps', w.steps,
        'distance_m', w.distance_m,
        'find_id', w.find_id,
        -- Still going: no find until it's over.
        'walking', w.ended_at > now() - interval '20 minutes'
      ) order by w.started_at desc)
      from public.hound_walks w
      where w.user_id = me and w.day > p_day - 7 and w.day <= p_day
    ), '[]'::jsonb),
    'finds', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.find_id, 'count', f.n, 'first_at', f.first_at))
      from (
        select w.find_id, count(*) as n, min(w.found_at) as first_at
        from public.hound_walks w
        where w.user_id = me and w.find_id is not null
        group by w.find_id
      ) f
    ), '[]'::jsonb),
    'kinds', (
      select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'rarity', k.rarity, 'season', k.season) order by k.sort)
      from public.walk_find_kinds k
    ),
    'season', public.walk_season(p_day),
    'steps_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', s.day, 'steps', s.steps) order by s.day desc)
      from public.daily_step_totals s
      where s.user_id = me and s.day > p_day - 7 and s.day <= p_day
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.my_walks(date) from public, anon;
grant execute on function public.my_walks(date) to authenticated;

-- The phone's walks for a local day, as spotted so far: a JSON array of
-- {start, end, start_minute, steps, distance_m}. A walk that overlaps
-- one already saved (it went on, or Health caught up) grows that one;
-- otherwise it's new. Anything implausible is left out: shorter than 5
-- minutes, longer than 6 hours, over 250 steps a minute, or not on a
-- recent day. Then every finished walk without a find gets one, up to 5
-- finds a day. Returns my_walks(p_day).
create or replace function public.save_hound_walks(p_day date, p_walks jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  w jsonb;
  s timestamptz;
  e timestamptz;
  st integer;
  dist integer;
  sm integer;
  keep uuid;
  other record;
  todo record;
  found_today integer;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if p_day < current_date - 2 or p_day > current_date + 1 then
    return public.my_walks(p_day);
  end if;
  if jsonb_typeof(p_walks) <> 'array' or jsonb_array_length(p_walks) > 24 then
    raise exception 'Too many walks.';
  end if;

  for w in select * from jsonb_array_elements(p_walks) loop
    begin
      s := (w ->> 'start')::timestamptz;
      e := (w ->> 'end')::timestamptz;
      st := (w ->> 'steps')::integer;
      dist := nullif(w ->> 'distance_m', '')::integer;
      sm := (w ->> 'start_minute')::integer;
    exception when others then
      continue;
    end;
    if s is null or e is null or st is null or sm is null then continue; end if;
    if e - s < interval '5 minutes' or e - s > interval '6 hours' then continue; end if;
    if s < now() - interval '3 days' or e > now() + interval '10 minutes' then continue; end if;
    if st <= 0 or st > 250 * extract(epoch from (e - s)) / 60 then continue; end if;
    if sm < 0 or sm > 1439 then continue; end if;
    if dist is not null and (dist < 0 or dist > 60000) then dist := null; end if;

    -- The earliest saved walk this one overlaps (or touches, within a
    -- bucket) grows to cover both.
    select h.id into keep from public.hound_walks h
      where h.user_id = me
        and h.started_at <= e + interval '15 minutes'
        and h.ended_at >= s - interval '15 minutes'
      order by h.started_at
      limit 1;

    if keep is null then
      insert into public.hound_walks (user_id, day, start_minute, started_at, ended_at, steps, distance_m)
        values (me, p_day, sm, s, e, st, dist);
    else
      update public.hound_walks h set
        start_minute = case when s < h.started_at then sm else h.start_minute end,
        started_at = least(h.started_at, s),
        ended_at = greatest(h.ended_at, e),
        steps = greatest(h.steps, st),
        distance_m = greatest(coalesce(h.distance_m, 0), coalesce(dist, 0)),
        updated_at = now()
      where h.id = keep;
      -- Other saved walks it now joins: folded in, keeping a find.
      for other in
        select h.id, h.find_id, h.found_at from public.hound_walks h
        where h.user_id = me and h.id <> keep
          and h.started_at <= e + interval '15 minutes'
          and h.ended_at >= s - interval '15 minutes'
      loop
        if other.find_id is not null then
          if exists (select 1 from public.hound_walks h where h.id = keep and h.find_id is null) then
            update public.hound_walks h set find_id = other.find_id, found_at = other.found_at where h.id = keep;
            delete from public.hound_walks h where h.id = other.id;
          end if;
          -- Both found something: both stay, so neither find is lost.
        else
          delete from public.hound_walks h where h.id = other.id;
        end if;
      end loop;
    end if;
  end loop;

  -- Finds for finished walks, oldest first, up to 5 a day.
  for todo in
    select h.id, h.day, h.steps from public.hound_walks h
    where h.user_id = me and h.find_id is null
      and h.ended_at <= now() - interval '20 minutes'
      and h.ended_at - h.started_at >= interval '10 minutes'
      and h.day > current_date - 3
    order by h.started_at
  loop
    select count(*)::integer into found_today from public.hound_walks h
      where h.user_id = me and h.day = todo.day and h.find_id is not null;
    if found_today < 5 then
      update public.hound_walks h
        set find_id = public.walk_roll_find(todo.steps, todo.day), found_at = now()
        where h.id = todo.id;
    end if;
  end loop;

  return public.my_walks(p_day);
end;
$$;

revoke execute on function public.save_hound_walks(date, jsonb) from public, anon;
grant execute on function public.save_hound_walks(date, jsonb) to authenticated;

create or replace function public.log_walk_event(p_kind text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if p_kind not in ('book_open', 'diary_open', 'diary_share') then
    raise exception 'Unknown event.';
  end if;
  insert into public.walk_events (user_id, kind) values (auth.uid(), p_kind)
    on conflict do nothing;
end;
$$;

revoke execute on function public.log_walk_event(text) from public, anon;
grant execute on function public.log_walk_event(text) to authenticated;

-- Admin → Overview → Walks: who's walking, how, what they find, and who
-- opens the collection book and the diary.
create or replace function public.admin_walks_overview()
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
    with recent as (
      select * from public.hound_walks w where w.day > current_date - 7
    )
    select jsonb_build_object(
      'walkers_ever', (select count(distinct w.user_id) from public.hound_walks w),
      'walkers_7d', (select count(distinct r.user_id) from recent r),
      'walks_7d', (select count(*) from recent),
      'avg_minutes_7d', (select coalesce(round(avg(extract(epoch from (r.ended_at - r.started_at)) / 60)), 0) from recent r),
      'avg_steps_7d', (select coalesce(round(avg(r.steps)), 0) from recent r),
      'by_time_7d', jsonb_build_object(
        'morning', (select count(*) from recent r where r.start_minute >= 300 and r.start_minute < 660),
        'lunchtime', (select count(*) from recent r where r.start_minute >= 660 and r.start_minute < 840),
        'afternoon', (select count(*) from recent r where r.start_minute >= 840 and r.start_minute < 1020),
        'evening', (select count(*) from recent r where r.start_minute >= 1020 and r.start_minute < 1260),
        'late', (select count(*) from recent r where r.start_minute >= 1260 or r.start_minute < 300)
      ),
      'finders_ever', (select count(distinct w.user_id) from public.hound_walks w where w.find_id is not null),
      'finds_7d', (select count(*) from recent r where r.find_id is not null),
      'finds_by_kind', coalesce((
        select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'rarity', k.rarity, 'count', c.n) order by c.n desc, k.sort)
        from public.walk_find_kinds k
        join (select w.find_id, count(*) as n from public.hound_walks w where w.find_id is not null group by w.find_id) c
          on c.find_id = k.id
      ), '[]'::jsonb),
      'book_openers_7d', (select count(distinct v.user_id) from public.walk_events v where v.kind = 'book_open' and v.day > current_date - 7),
      'diary_readers_7d', (select count(distinct v.user_id) from public.walk_events v where v.kind = 'diary_open' and v.day > current_date - 7),
      'diary_shares_7d', (select count(*) from public.walk_events v where v.kind = 'diary_share' and v.day > current_date - 7)
    )
  );
end;
$$;

revoke execute on function public.admin_walks_overview() from public, anon;
grant execute on function public.admin_walks_overview() to authenticated;
