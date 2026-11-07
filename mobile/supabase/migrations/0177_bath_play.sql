-- Hound: bath time you play (testers' ask: scrub the hound with a finger,
-- pop bubbles for Bones).
--
-- Still one bath a day, earned by an active day. What earns it changes:
-- a long walk, 6,000 steps (was 8,000), today's goals done, or buying a
-- Bones pack today (any credited pack, on the buyer's own date).
--
-- The bath is now a little game on the phone: scrub, pop the bubbles
-- that rise from the tub (+1 Bone each, and one golden bubble for more),
-- rinse, shake dry. finish_bath() records it and pays the Bones, capped
-- here at the settings' numbers so the phone can't claim more. "Quick
-- bath" skips the game: give_bath() as before, no Bones.
--
--   bath_settings   the admin knobs: bubbles per bath (each +1 Bone) and
--                   the golden bubble's Bones (one row)
--   hound_baths     + kind (quick or play), what earned it, bubbles
--                   popped, golden found, Bones paid
--   care_bath()     6,000 steps; a Bones pack earns it; today's bath's
--                   kind and Bones; the settings, for the game
--   give_bath()     the quick bath, now noting what earned it
--   finish_bath()   the played bath, with its Bones
--   admin_bath_overview()   Admin → Overview → Bath time
--
-- Run this once, after 0176, in the SQL Editor, before publishing the
-- app update that goes with it. The app before it keeps working: its
-- "Give a bath" is the quick bath.
--
-- Undo, if needed: re-run care_bath and give_bath from 0169; drop
-- finish_bath, admin_bath_overview and bath_settings. The new
-- hound_baths columns can stay.

-- ── Settings ─────────────────────────────────────────────────────────

create table public.bath_settings (
  id boolean primary key default true,
  constraint bath_settings_singleton check (id),
  -- Bubbles that rise in a bath, each +1 Bone when popped.
  bubbles int not null default 10 check (bubbles between 0 and 30),
  -- The one golden bubble's Bones (0: no golden bubble).
  golden_bones int not null default 5 check (golden_bones between 0 and 100),
  updated_at timestamptz not null default now()
);

insert into public.bath_settings (id) values (true);

alter table public.bath_settings enable row level security;

create policy "Anyone signed in can read the bath settings"
  on public.bath_settings for select to authenticated
  using (true);

create policy "Only admins can change the bath settings"
  on public.bath_settings for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

revoke all on public.bath_settings from anon;
revoke insert, delete on public.bath_settings from authenticated;

-- ── Baths ────────────────────────────────────────────────────────────

alter table public.hound_baths
  add column kind text not null default 'quick' check (kind in ('quick', 'play')),
  add column earned text check (earned in ('walk', 'steps', 'goal', 'pack')),
  add column bubbles int not null default 0,
  add column golden boolean not null default false,
  add column bones int not null default 0;

-- The bath, as the Kennel shows it. From 0169: 6,000 steps, and a Bones
-- pack bought today earns it too.
create or replace function public.care_bath(p_user uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  walk public.hound_walks;
  bath public.hound_baths;
  cfg public.bath_settings;
  steps integer;
  goal boolean;
  pack boolean;
  muddy boolean;
  earned text;
begin
  walk := public.care_long_walk(p_user, p_day);
  select * into bath from public.hound_baths b where b.user_id = p_user and b.day = p_day;
  select * into cfg from public.bath_settings;
  select s.steps into steps from public.daily_step_totals s where s.user_id = p_user and s.day = p_day;
  goal := exists (select 1 from public.goal_streaks g where g.user_id = p_user and g.last_hit_on >= p_day);
  pack := exists (
    select 1 from public.bones_purchases bp
    join public.profiles p on p.id = bp.user_id
    where bp.user_id = p_user and bp.status = 'credited'
      and (bp.created_at at time zone coalesce(p.time_zone, 'UTC'))::date = p_day
  );
  -- Muddy from a long walk that ended after today's bath (or with no bath).
  muddy := walk.id is not null and (bath.user_id is null or walk.ended_at > bath.created_at);
  earned := case
    when walk.id is not null then 'walk'
    when coalesce(steps, 0) >= 6000 then 'steps'
    when goal then 'goal'
    when pack then 'pack'
  end;
  return jsonb_build_object(
    'bathed', bath.user_id is not null,
    'bathed_at', bath.created_at,
    'bath_kind', bath.kind,
    'bath_bones', bath.bones,
    'muddy', muddy,
    'earned', earned,
    'can_bath', bath.user_id is null and earned is not null,
    'walk_steps', walk.steps,
    'walk_minutes', case when walk.id is null then null
      else round(extract(epoch from walk.ended_at - walk.started_at) / 60)::int end,
    'bubbles', coalesce(cfg.bubbles, 10),
    'golden_bones', coalesce(cfg.golden_bones, 5)
  );
end;
$$;

revoke execute on function public.care_bath(uuid, date) from public, anon, authenticated;

-- Today's bath, if it can be had: what earned it. Raises otherwise.
create or replace function public.bath_check(p_user uuid, p_day date)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  b jsonb := public.care_bath(p_user, p_day);
begin
  if (b ->> 'bathed')::boolean then
    raise exception 'Already had a bath today. Squeaky clean.';
  end if;
  if not (b ->> 'can_bath')::boolean then
    raise exception 'A bath comes after an active day: a long walk, 6,000 steps, your goals done or a Bones pack.';
  end if;
  return b ->> 'earned';
end;
$$;

revoke execute on function public.bath_check(uuid, date) from public, anon, authenticated;

-- The quick bath, once it's been earned: no game, no Bones. Returns
-- my_care. From 0169, noting what earned it.
create or replace function public.give_bath(p_day date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
  why text := public.bath_check(me, p_day);
begin
  insert into public.hound_baths (user_id, day, kind, earned) values (me, p_day, 'quick', why);
  return public.my_care(p_day);
end;
$$;

revoke execute on function public.give_bath(date) from public, anon;
grant execute on function public.give_bath(date) to authenticated;

-- The bath you played: the bubbles you popped (+1 Bone each, up to the
-- settings' number) and the golden one if you got it. Returns my_care.
create or replace function public.finish_bath(p_day date, p_bubbles int, p_golden boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
  why text := public.bath_check(me, p_day);
  cfg public.bath_settings;
  n int;
  gold boolean;
  paid int;
begin
  select * into cfg from public.bath_settings;
  n := greatest(0, least(coalesce(p_bubbles, 0), coalesce(cfg.bubbles, 10)));
  gold := coalesce(p_golden, false) and coalesce(cfg.golden_bones, 5) > 0;
  paid := n + case when gold then coalesce(cfg.golden_bones, 5) else 0 end;
  insert into public.hound_baths (user_id, day, kind, earned, bubbles, golden, bones)
  values (me, p_day, 'play', why, n, gold, paid);
  if paid > 0 then
    update public.profiles p
      set bones_balance = p.bones_balance + paid, bones_earned_total = p.bones_earned_total + paid
      where p.id = me;
  end if;
  return public.my_care(p_day);
end;
$$;

revoke execute on function public.finish_bath(date, int, boolean) from public, anon;
grant execute on function public.finish_bath(date, int, boolean) to authenticated;

-- ── Admin ────────────────────────────────────────────────────────────

-- Admin → Overview → Bath time: who's played it, how, and the Bones.
create or replace function public.admin_bath_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  cfg public.bath_settings;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  select * into cfg from public.bath_settings;
  return (
    with wk as (select * from public.hound_baths b where b.created_at > now() - interval '7 days')
    select jsonb_build_object(
      'bubbles', cfg.bubbles,
      'golden_bones', cfg.golden_bones,
      'played_7d', (select count(*) from wk where wk.kind = 'play'),
      'players_7d', (select count(distinct wk.user_id) from wk where wk.kind = 'play'),
      'quick_7d', (select count(*) from wk where wk.kind = 'quick'),
      'bubbles_7d', (select coalesce(sum(wk.bubbles), 0) from wk),
      'golden_7d', (select count(*) from wk where wk.golden),
      'bones_7d', (select coalesce(sum(wk.bones), 0) from wk),
      'all_bubbles_7d', (select count(*) from wk where wk.kind = 'play' and wk.bubbles >= cfg.bubbles),
      'played_all', (select count(*) from public.hound_baths b where b.kind = 'play'),
      'players_all', (select count(distinct b.user_id) from public.hound_baths b where b.kind = 'play'),
      'bones_all', (select coalesce(sum(b.bones), 0) from public.hound_baths b),
      'by_earned_7d', (
        select coalesce(jsonb_object_agg(e.earned, e.n), '{}'::jsonb)
        from (select wk.earned, count(*) as n from wk where wk.earned is not null group by wk.earned) e
      )
    )
  );
end;
$$;

revoke execute on function public.admin_bath_overview() from public, anon;
grant execute on function public.admin_bath_overview() to authenticated;
