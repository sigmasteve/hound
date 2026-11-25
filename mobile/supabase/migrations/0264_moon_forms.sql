-- 0264: Moon forms (a tester, Nov 2026: "I need my hound animated... like
-- a werewolf as I grow in levels. Let's get some cut scenes going"; Steve:
-- "show the scenes for levels already attained"). Each rank has a cut
-- scene (the app's MoonScene: First Moon at Tracker, Forest Moon at
-- Hunter, Full Moon at Alpha, Blue Moon at Legend) and adds to how the
-- hound looks. This keeps:
--
--   moon_settings  your switch for the hound's moon look (on unless you
--                  turn it off), and when you were offered the catch-up:
--                  the one-time "watch your hound's moon forms" for ranks
--                  reached before this shipped.
--   moon_views     every scene watched: at a rank up, in the catch-up or
--                  again from the Kennel, and whether it was skipped.
--
-- Admin → Overview → Hound → Moon forms reads admin_moon_overview.
--
-- Run this once, after 0001-0263, in the SQL Editor.

create table public.moon_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  forms_on boolean not null default true,
  catchup_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.moon_settings enable row level security;
revoke all on public.moon_settings from anon, authenticated;

create table public.moon_views (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rank text not null check (rank in ('tracker', 'hunter', 'alpha', 'legend')),
  how text not null check (how in ('rankup', 'catchup', 'replay')),
  skipped boolean not null default false,
  created_at timestamptz not null default now()
);
create index moon_views_user on public.moon_views (user_id, rank);
alter table public.moon_views enable row level security;
revoke all on public.moon_views from anon, authenticated;

-- The ranks a level has reached, in order (as challenges/ranks.ts).
create or replace function public.moon_ranks_for(p_level int)
returns text[]
language sql
immutable
as $$
  select array(select r from (values ('tracker', 5), ('hunter', 10), ('alpha', 15), ('legend', 20)) v(r, lvl)
               where p_level >= v.lvl order by v.lvl);
$$;
revoke execute on function public.moon_ranks_for(int) from public, anon, authenticated;

-- Your switch, the forms you've reached, the ones you've watched, and
-- whether the catch-up is still to offer.
create or replace function public.moon_state()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  ms public.moon_settings;
  lvl int;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into ms from public.moon_settings where user_id = me;
  select public.level_for_xp(coalesce(p.xp_total, 0)) into lvl from public.profiles p where p.id = me;
  return jsonb_build_object(
    'on', coalesce(ms.forms_on, true),
    'level', coalesce(lvl, 0),
    'reached', to_jsonb(public.moon_ranks_for(coalesce(lvl, 0))),
    'watched', coalesce((select jsonb_agg(distinct v.rank) from public.moon_views v where v.user_id = me and not v.skipped), '[]'),
    'catchup_due', ms.catchup_at is null and cardinality(public.moon_ranks_for(coalesce(lvl, 0))) > 0
      and not exists (select 1 from public.moon_views v where v.user_id = me));
end;
$$;
revoke execute on function public.moon_state() from public, anon;
grant execute on function public.moon_state() to authenticated;

create or replace function public.moon_set(p_on boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  insert into public.moon_settings (user_id, forms_on) values (auth.uid(), coalesce(p_on, true))
  on conflict (user_id) do update set forms_on = excluded.forms_on, updated_at = now();
end;
$$;
revoke execute on function public.moon_set(boolean) from public, anon;
grant execute on function public.moon_set(boolean) to authenticated;

-- A scene was watched (or skipped). Only a rank you've reached.
create or replace function public.moon_watched(p_rank text, p_how text, p_skipped boolean default false)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  lvl int;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select public.level_for_xp(coalesce(p.xp_total, 0)) into lvl from public.profiles p where p.id = me;
  if not (p_rank = any (public.moon_ranks_for(coalesce(lvl, 0)))) then
    raise exception 'Your hound hasn''t reached that form yet.';
  end if;
  insert into public.moon_views (user_id, rank, how, skipped) values (me, p_rank, p_how, coalesce(p_skipped, false));
  if p_how = 'catchup' then
    insert into public.moon_settings (user_id, catchup_at) values (me, now())
    on conflict (user_id) do update set catchup_at = coalesce(public.moon_settings.catchup_at, now());
  end if;
end;
$$;
revoke execute on function public.moon_watched(text, text, boolean) from public, anon;
grant execute on function public.moon_watched(text, text, boolean) to authenticated;

-- "Later" on the catch-up: it isn't offered again (the Kennel still has
-- every scene).
create or replace function public.moon_catchup_seen()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  insert into public.moon_settings (user_id, catchup_at) values (auth.uid(), now())
  on conflict (user_id) do update set catchup_at = coalesce(public.moon_settings.catchup_at, now());
end;
$$;
revoke execute on function public.moon_catchup_seen() from public, anon;
grant execute on function public.moon_catchup_seen() to authenticated;

-- Whether someone's hound shows its moon look (their switch), for their
-- friend page.
create or replace function public.moon_forms_on(p_user uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select ms.forms_on from public.moon_settings ms where ms.user_id = p_user), true);
$$;
revoke execute on function public.moon_forms_on(uuid) from public, anon;
grant execute on function public.moon_forms_on(uuid) to authenticated;

create or replace function public.admin_moon_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  return jsonb_build_object(
    'watchers', (select count(distinct user_id) from public.moon_views where not skipped),
    'watchers_7d', (select count(distinct user_id) from public.moon_views where not skipped and created_at > now() - interval '7 days'),
    'views_7d', (select count(*) from public.moon_views where created_at > now() - interval '7 days'),
    'skipped_7d', (select count(*) from public.moon_views where skipped and created_at > now() - interval '7 days'),
    'by_how_7d', coalesce((select jsonb_object_agg(how, n) from (select how, count(*) n from public.moon_views
                            where created_at > now() - interval '7 days' group by how) x), '{}'),
    'by_rank', coalesce((select jsonb_object_agg(rank, n) from (select rank, count(distinct user_id) n from public.moon_views
                          where not skipped group by rank) x), '{}'),
    'replayers', (select count(distinct user_id) from public.moon_views where how = 'replay'),
    'catchup_offered', (select count(*) from public.moon_settings where catchup_at is not null),
    'catchup_watched', (select count(distinct user_id) from public.moon_views where how = 'catchup' and not skipped),
    'switched_off', (select count(*) from public.moon_settings where not forms_on),
    'reached', coalesce((select jsonb_object_agg(r, n) from (
                 select r, count(*) n from public.profiles p, unnest(public.moon_ranks_for(public.level_for_xp(coalesce(p.xp_total, 0)))) r
                 group by r) x), '{}'));
end;
$$;
revoke execute on function public.admin_moon_overview() from public, anon;
grant execute on function public.admin_moon_overview() to authenticated;
