-- Hound: a garden that grows with your steps (lifestyle phase 2).
--
-- A garden bed in the Yard with 3 plots. Plant a seed and your steps
-- water it: each kind needs so many steps after it's planted to bloom
-- (25,000 for a sunflower, a few days of walking). A day without steps
-- pauses it; nothing wilts or dies. Once it's bloomed, pick it (it goes
-- in your garden log) or leave it to show off.
--
-- Seeds: one free seed a week (Monday to Sunday), from the free kinds,
-- and seed packs for Bones. Seasonal seeds are only sold in their season.
--
--   garden_seed_kinds   the seeds, with steps to bloom and pack prices
--   garden_seeds        how many of each seed you have
--   garden_plantings    what's in each plot, and everything grown
--   garden_seed_buys    packs bought and free seeds claimed (Admin)
--   my_garden()         plots with their growth, seeds, kinds, log
--   claim_free_seed()  buy_seed_pack()  plant_seed()
--   pick_plant()  dig_up_plant()
--   admin_garden_overview()  Admin → Overview → Garden
--
-- Growth is steps from daily_step_totals: every day from the day it was
-- planted, less that day's steps when it went in.
--
-- Run this once, after 0001-0161, in the SQL Editor.

create table public.garden_seed_kinds (
  id text primary key,
  name text not null,
  steps_to_bloom integer not null check (steps_to_bloom > 0),
  pack_bones integer not null check (pack_bones > 0),
  pack_size integer not null check (pack_size > 0),
  -- Can be the week's free seed.
  free boolean not null default false,
  -- Only sold in this season (0161's walk_season); null is all year.
  season text check (season in ('autumn', 'winter', 'spring', 'summer')),
  sort integer not null
);

alter table public.garden_seed_kinds enable row level security;
revoke all on public.garden_seed_kinds from anon, authenticated;

insert into public.garden_seed_kinds (id, name, steps_to_bloom, pack_bones, pack_size, free, season, sort) values
  ('daisy', 'Daisy', 20000, 30, 3, true, null, 10),
  ('sunflower', 'Sunflower', 25000, 40, 3, true, null, 20),
  ('tulip', 'Tulip', 25000, 40, 3, true, null, 30),
  ('lavender', 'Lavender', 30000, 50, 3, false, null, 40),
  ('strawberry', 'Strawberries', 35000, 60, 3, false, null, 50),
  ('rose', 'Rose', 50000, 100, 3, false, null, 60),
  ('giant_sunflower', 'Giant sunflower', 70000, 150, 2, false, null, 70),
  ('pumpkin', 'Pumpkin', 40000, 80, 2, false, 'autumn', 80),
  ('holly', 'Holly', 30000, 60, 3, false, 'winter', 90),
  ('bluebell', 'Bluebells', 25000, 50, 3, false, 'spring', 100),
  ('watermelon', 'Watermelon', 45000, 90, 2, false, 'summer', 110);

create table public.garden_seeds (
  user_id uuid not null references public.profiles (id) on delete cascade,
  seed_id text not null references public.garden_seed_kinds (id),
  count integer not null default 0 check (count >= 0),
  primary key (user_id, seed_id)
);

alter table public.garden_seeds enable row level security;
revoke all on public.garden_seeds from anon, authenticated;

create table public.garden_plantings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plot smallint not null check (plot between 0 and 2),
  seed_id text not null references public.garden_seed_kinds (id),
  -- The planter's local day, and that day's steps when it went in.
  planted_on date not null,
  start_steps integer not null default 0,
  planted_at timestamptz not null default now(),
  -- When it bloomed (first seen grown), was picked, or left the plot.
  bloomed_at timestamptz,
  picked_at timestamptz,
  removed_at timestamptz
);

create unique index garden_plantings_plot on public.garden_plantings (user_id, plot) where removed_at is null;
create index garden_plantings_user on public.garden_plantings (user_id);

alter table public.garden_plantings enable row level security;
revoke all on public.garden_plantings from anon, authenticated;

create table public.garden_seed_buys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  seed_id text not null references public.garden_seed_kinds (id),
  seeds integer not null,
  bones integer not null default 0,
  -- A free seed's week (its Monday); null for a pack.
  free_week date,
  created_at timestamptz not null default now()
);

create unique index garden_seed_buys_free on public.garden_seed_buys (user_id, free_week) where free_week is not null;
create index garden_seed_buys_created on public.garden_seed_buys (created_at);

alter table public.garden_seed_buys enable row level security;
revoke all on public.garden_seed_buys from anon, authenticated;

-- Steps a planting has had, up to p_day.
create or replace function public.garden_growth(p_user uuid, p_planted_on date, p_start_steps integer, p_day date)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select greatest(0, coalesce(sum(s.steps), 0)::integer - p_start_steps)
  from public.daily_step_totals s
  where s.user_id = p_user and s.day >= p_planted_on and s.day <= p_day;
$$;

revoke execute on function public.garden_growth(uuid, date, integer, date) from public, anon, authenticated;

create or replace function public.garden_week(p_day date)
returns date
language sql
immutable
as $$
  select (date_trunc('week', p_day::timestamp))::date;
$$;

revoke execute on function public.garden_week(date) from public, anon, authenticated;

create or replace function public.my_garden(p_day date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
begin
  -- First seen grown: noted, for the diary and Admin.
  update public.garden_plantings g set bloomed_at = now()
    from public.garden_seed_kinds k
    where g.user_id = me and g.removed_at is null and g.bloomed_at is null and k.id = g.seed_id
      and public.garden_growth(me, g.planted_on, g.start_steps, p_day) >= k.steps_to_bloom;

  return jsonb_build_object(
    'plots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plot', g.plot,
        'seed_id', g.seed_id,
        'planted_on', g.planted_on,
        'steps', least(public.garden_growth(me, g.planted_on, g.start_steps, p_day), k.steps_to_bloom),
        'need', k.steps_to_bloom,
        'bloomed_at', g.bloomed_at
      ) order by g.plot)
      from public.garden_plantings g join public.garden_seed_kinds k on k.id = g.seed_id
      where g.user_id = me and g.removed_at is null
    ), '[]'::jsonb),
    'seeds', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.seed_id, 'count', s.count))
      from public.garden_seeds s where s.user_id = me and s.count > 0
    ), '[]'::jsonb),
    'kinds', (
      select jsonb_agg(jsonb_build_object(
        'id', k.id, 'name', k.name, 'steps', k.steps_to_bloom, 'pack_bones', k.pack_bones, 'pack_size', k.pack_size,
        'free', k.free, 'season', k.season,
        'on_sale', k.season is null or k.season = public.walk_season(p_day)
      ) order by k.sort)
      from public.garden_seed_kinds k
    ),
    'free_seed', not exists (
      select 1 from public.garden_seed_buys b where b.user_id = me and b.free_week = public.garden_week(p_day)
    ),
    'picked', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.seed_id, 'count', x.n))
      from (
        select g.seed_id, count(*) as n from public.garden_plantings g
        where g.user_id = me and g.picked_at is not null group by g.seed_id
      ) x
    ), '[]'::jsonb),
    'balance', (select p.bones_balance from public.profiles p where p.id = me)
  );
end;
$$;

revoke execute on function public.my_garden(date) from public, anon;
grant execute on function public.my_garden(date) to authenticated;

-- The week's free seed, one of the free kinds.
create or replace function public.claim_free_seed(p_day date, p_seed text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
begin
  if not exists (select 1 from public.garden_seed_kinds k where k.id = p_seed and k.free) then
    raise exception 'That one isn''t a free seed.';
  end if;
  begin
    insert into public.garden_seed_buys (user_id, seed_id, seeds, free_week) values (me, p_seed, 1, public.garden_week(p_day));
  exception when unique_violation then
    raise exception 'You''ve had this week''s free seed. Another comes on Monday.';
  end;
  insert into public.garden_seeds (user_id, seed_id, count) values (me, p_seed, 1)
    on conflict (user_id, seed_id) do update set count = public.garden_seeds.count + 1;
  return public.my_garden(p_day);
end;
$$;

revoke execute on function public.claim_free_seed(date, text) from public, anon;
grant execute on function public.claim_free_seed(date, text) to authenticated;

create or replace function public.buy_seed_pack(p_day date, p_seed text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
  k public.garden_seed_kinds;
  balance integer;
begin
  select * into k from public.garden_seed_kinds x where x.id = p_seed;
  if not found then
    raise exception 'That seed doesn''t exist.';
  end if;
  if k.season is not null and k.season <> public.walk_season(p_day) then
    raise exception 'Those seeds are only sold in %.', k.season;
  end if;
  select p.bones_balance into balance from public.profiles p where p.id = me for update;
  if coalesce(balance, 0) < k.pack_bones then
    raise exception 'Not enough Bones.';
  end if;
  update public.profiles p set bones_balance = p.bones_balance - k.pack_bones where p.id = me;
  insert into public.garden_seed_buys (user_id, seed_id, seeds, bones) values (me, p_seed, k.pack_size, k.pack_bones);
  insert into public.garden_seeds (user_id, seed_id, count) values (me, p_seed, k.pack_size)
    on conflict (user_id, seed_id) do update set count = public.garden_seeds.count + k.pack_size;
  return public.my_garden(p_day);
end;
$$;

revoke execute on function public.buy_seed_pack(date, text) from public, anon;
grant execute on function public.buy_seed_pack(date, text) to authenticated;

create or replace function public.plant_seed(p_day date, p_plot integer, p_seed text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
  today_steps integer;
begin
  if p_plot is null or p_plot < 0 or p_plot > 2 then
    raise exception 'There''s no plot there.';
  end if;
  if exists (select 1 from public.garden_plantings g where g.user_id = me and g.plot = p_plot and g.removed_at is null) then
    raise exception 'Something''s already growing there.';
  end if;
  update public.garden_seeds s set count = s.count - 1
    where s.user_id = me and s.seed_id = p_seed and s.count > 0;
  if not found then
    raise exception 'You don''t have that seed.';
  end if;
  select coalesce(s.steps, 0) into today_steps from public.daily_step_totals s where s.user_id = me and s.day = p_day;
  insert into public.garden_plantings (user_id, plot, seed_id, planted_on, start_steps)
    values (me, p_plot, p_seed, p_day, coalesce(today_steps, 0));
  return public.my_garden(p_day);
end;
$$;

revoke execute on function public.plant_seed(date, integer, text) from public, anon;
grant execute on function public.plant_seed(date, integer, text) to authenticated;

-- A bloomed plant, picked: into the garden log, and the plot's free.
create or replace function public.pick_plant(p_day date, p_plot integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
  g public.garden_plantings;
  need integer;
begin
  select * into g from public.garden_plantings x where x.user_id = me and x.plot = p_plot and x.removed_at is null;
  if not found then
    raise exception 'Nothing''s growing there.';
  end if;
  select k.steps_to_bloom into need from public.garden_seed_kinds k where k.id = g.seed_id;
  if public.garden_growth(me, g.planted_on, g.start_steps, p_day) < need then
    raise exception 'It hasn''t bloomed yet.';
  end if;
  update public.garden_plantings x set
    bloomed_at = coalesce(x.bloomed_at, now()), picked_at = now(), removed_at = now()
    where x.id = g.id;
  return public.my_garden(p_day);
end;
$$;

revoke execute on function public.pick_plant(date, integer) from public, anon;
grant execute on function public.pick_plant(date, integer) to authenticated;

-- Clears a plot before it blooms. The seed is used up.
create or replace function public.dig_up_plant(p_day date, p_plot integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
begin
  update public.garden_plantings x set removed_at = now()
    where x.user_id = me and x.plot = p_plot and x.removed_at is null;
  if not found then
    raise exception 'Nothing''s growing there.';
  end if;
  return public.my_garden(p_day);
end;
$$;

revoke execute on function public.dig_up_plant(date, integer) from public, anon;
grant execute on function public.dig_up_plant(date, integer) to authenticated;

-- Admin → Overview → Garden: who's gardening, what they grow, free seeds
-- and packs.
create or replace function public.admin_garden_overview()
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

  return jsonb_build_object(
    'gardeners_ever', (select count(distinct g.user_id) from public.garden_plantings g),
    'growing_now', (select count(distinct g.user_id) from public.garden_plantings g where g.removed_at is null),
    'planted_7d', (select count(*) from public.garden_plantings g where g.planted_at > now() - interval '7 days'),
    'bloomed_7d', (select count(*) from public.garden_plantings g where g.bloomed_at > now() - interval '7 days'),
    'bloomed_ever', (select count(*) from public.garden_plantings g where g.bloomed_at is not null),
    'picked_ever', (select count(*) from public.garden_plantings g where g.picked_at is not null),
    'dug_up_ever', (select count(*) from public.garden_plantings g where g.removed_at is not null and g.picked_at is null),
    'free_seeds_7d', (select count(*) from public.garden_seed_buys b where b.free_week is not null and b.created_at > now() - interval '7 days'),
    'packs_7d', (select count(*) from public.garden_seed_buys b where b.free_week is null and b.created_at > now() - interval '7 days'),
    'pack_buyers_ever', (select count(distinct b.user_id) from public.garden_seed_buys b where b.free_week is null),
    'bones_7d', (select coalesce(sum(b.bones), 0) from public.garden_seed_buys b where b.created_at > now() - interval '7 days'),
    'bones_ever', (select coalesce(sum(b.bones), 0) from public.garden_seed_buys b),
    'by_seed', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'planted', c.planted, 'bloomed', c.bloomed, 'packs', coalesce(b.packs, 0))
        order by c.planted desc, k.sort)
      from public.garden_seed_kinds k
      join (
        select g.seed_id, count(*) as planted, count(g.bloomed_at) as bloomed
        from public.garden_plantings g group by g.seed_id
      ) c on c.seed_id = k.id
      left join (
        select b.seed_id, count(*) as packs from public.garden_seed_buys b where b.free_week is null group by b.seed_id
      ) b on b.seed_id = k.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.admin_garden_overview() from public, anon;
grant execute on function public.admin_garden_overview() to authenticated;
