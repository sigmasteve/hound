-- Hound: Customize Today (the streamlining, Steve Nov 2026).
--
-- Today now opens on the basics: Your day (Steps & workouts, Fasting,
-- Move), what needs you, and your challenges. The extras are switches in
-- Customize Today, off for everyone until they turn one on, and saved per
-- account so they follow someone to a new phone:
--   week         Week in review (Monday until Tuesday noon)
--   rank         today's Step rank
--   journey      the Journey card
--   fasting_card the Fasting card you swipe to across the top
--   holiday      holiday decorations (the pill, the trims, the snow)
--   hound_top    your hound at the top of Today instead of the bottom
--
--   - today_prefs: one row per person who's changed anything.
--   - my_today_prefs() / set_today_prefs(p): read and save them. Unknown
--     keys and anything that isn't true / false are dropped.
--   - note_today_tap(what): Your day's taps (steps, fasting, move, water)
--     and opening Customize Today, counted per person per day.
--   - admin_today_overview(): how many have customized, how many have each
--     extra on, and Your day's taps over the last 7 days (Admin → Overview
--     → Status → Customize Today).
--
-- Run this once, after 0277, in the SQL Editor.

create table if not exists public.today_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.today_prefs enable row level security;

create table if not exists public.today_taps (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  what text not null,
  n integer not null default 1,
  primary key (user_id, day, what)
);

alter table public.today_taps enable row level security;

create or replace function public.my_today_prefs()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  return coalesce((select t.prefs from public.today_prefs t where t.user_id = caller), '{}'::jsonb);
end;
$$;

revoke execute on function public.my_today_prefs() from public, anon;
grant execute on function public.my_today_prefs() to authenticated;

create or replace function public.set_today_prefs(p_prefs jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  allowed constant text[] := array['week', 'rank', 'journey', 'fasting_card', 'holiday', 'hound_top'];
  cleaned jsonb;
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into cleaned
    from jsonb_each(case when jsonb_typeof(p_prefs) = 'object' then p_prefs else '{}'::jsonb end) e
    where e.key = any (allowed) and jsonb_typeof(e.value) = 'boolean';
  insert into public.today_prefs (user_id, prefs, updated_at)
    values (caller, cleaned, now())
    on conflict (user_id) do update set prefs = excluded.prefs, updated_at = now();
  return cleaned;
end;
$$;

revoke execute on function public.set_today_prefs(jsonb) from public, anon;
grant execute on function public.set_today_prefs(jsonb) to authenticated;

create or replace function public.note_today_tap(p_what text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  today date;
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_what is null or p_what not in ('steps', 'fasting', 'move', 'water', 'customize') then
    return;
  end if;
  select (now() at time zone coalesce(nullif(p.time_zone, ''), 'UTC'))::date into today
    from public.profiles p where p.id = caller;
  insert into public.today_taps (user_id, day, what, n)
    values (caller, coalesce(today, (now() at time zone 'UTC')::date), p_what, 1)
    on conflict (user_id, day, what) do update set n = public.today_taps.n + 1;
end;
$$;

revoke execute on function public.note_today_tap(text) from public, anon;
grant execute on function public.note_today_tap(text) to authenticated;

create or replace function public.admin_today_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  since date := (now() at time zone 'UTC')::date - 7;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'customized', (select count(*) from public.today_prefs t where exists (select 1 from jsonb_each(t.prefs) e where e.value = 'true'::jsonb)),
    'saved', (select count(*) from public.today_prefs),
    'customized_7d', (select count(*) from public.today_prefs t where t.updated_at >= now() - interval '7 days'),
    'extras', (
      select jsonb_object_agg(k, (select count(*) from public.today_prefs t where t.prefs -> k = 'true'::jsonb))
      from unnest(array['week', 'rank', 'journey', 'fasting_card', 'holiday', 'hound_top']) k
    ),
    'taps_7d', coalesce((
      select jsonb_object_agg(what, jsonb_build_object('people', people, 'taps', taps))
      from (
        select what, count(distinct user_id) as people, sum(n) as taps
        from public.today_taps where day > since group by what
      ) g
    ), '{}'::jsonb),
    'tapped_ever', (select count(distinct user_id) from public.today_taps where what <> 'customize')
  ) into result;
  return result;
end;
$$;

revoke execute on function public.admin_today_overview() from public, anon;
grant execute on function public.admin_today_overview() to authenticated;

-- To undo:
--   drop function public.admin_today_overview();
--   drop function public.note_today_tap(text);
--   drop function public.set_today_prefs(jsonb);
--   drop function public.my_today_prefs();
--   drop table public.today_taps;
--   drop table public.today_prefs;
