-- Hound: holiday themes on Today (Diwali, Thanksgiving, Christmas, New
-- Year, Chinese New Year), scheduled from Admin → Overview.
--
-- A schedule of runs (holiday_theme_runs): a theme, the days it shows
-- (inclusive) and whether its falling sparkles / leaves / snow /
-- confetti / lanterns show. So "Diwali for three more days, then
-- Christmas" is two runs, and it switches by itself. Where runs overlap
-- the one that started last shows (Thanksgiving week inside a long
-- Christmas run shows Thanksgiving, then Christmas again). The app asks
-- get_holiday_theme() with the phone's own day, so it changes at local
-- midnight, and a run added or changed reaches everyone on their next
-- open, with no update.
--
-- Who's seen it (holiday_theme_views, one row a person a theme a day)
-- feeds the Admin numbers: how many have seen each run, today, who
-- turned the falling effects off for themselves, and who tapped the
-- countdown.
--
-- Run this once, after 0183, in the SQL Editor, before publishing the
-- app update that goes with it.

create table if not exists public.holiday_theme_runs (
  id bigint generated always as identity primary key,
  theme text not null check (theme in ('diwali', 'thanksgiving', 'christmas', 'newyear', 'lunarnewyear')),
  starts_on date not null,
  ends_on date not null,
  effects boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint holiday_theme_runs_order check (ends_on >= starts_on)
);

-- Read and written only through the functions below.
alter table public.holiday_theme_runs enable row level security;

create table if not exists public.holiday_theme_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  theme text not null,
  day date not null,
  effects_off boolean not null default false,
  countdown_taps int not null default 0,
  primary key (user_id, theme, day)
);

alter table public.holiday_theme_views enable row level security;

-- The run showing on p_day (the phone's day), or null when none is.
create or replace function public.get_holiday_theme(p_day date default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', r.id, 'theme', r.theme, 'effects', r.effects, 'starts_on', r.starts_on, 'ends_on', r.ends_on)
  from public.holiday_theme_runs r
  where coalesce(p_day, current_date) between r.starts_on and r.ends_on
  order by r.starts_on desc, r.id desc
  limit 1;
$$;

revoke execute on function public.get_holiday_theme(date) from public, anon;
grant execute on function public.get_holiday_theme(date) to authenticated;

-- Today showed the theme: once a day a person (effects_off is whether
-- they've turned the falling effects off in Settings).
create or replace function public.holiday_theme_seen(p_theme text, p_day date, p_effects_off boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_theme is null or p_theme not in ('diwali', 'thanksgiving', 'christmas', 'newyear', 'lunarnewyear') then
    raise exception 'unknown theme';
  end if;
  insert into public.holiday_theme_views (user_id, theme, day, effects_off)
  values (auth.uid(), p_theme, p_day, coalesce(p_effects_off, false))
  on conflict (user_id, theme, day) do update set effects_off = excluded.effects_off;
end;
$$;

revoke execute on function public.holiday_theme_seen(text, date, boolean) from public, anon;
grant execute on function public.holiday_theme_seen(text, date, boolean) to authenticated;

-- The countdown pill was tapped.
create or replace function public.holiday_countdown_tap(p_theme text, p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_theme is null or p_theme not in ('diwali', 'thanksgiving', 'christmas', 'newyear', 'lunarnewyear') then
    raise exception 'unknown theme';
  end if;
  insert into public.holiday_theme_views (user_id, theme, day, countdown_taps)
  values (auth.uid(), p_theme, p_day, 1)
  on conflict (user_id, theme, day) do update set countdown_taps = public.holiday_theme_views.countdown_taps + 1;
end;
$$;

revoke execute on function public.holiday_countdown_tap(text, date) from public, anon;
grant execute on function public.holiday_countdown_tap(text, date) to authenticated;

-- Admin: add a run (p_id null) or change one. Returns its id.
create or replace function public.admin_save_holiday_run(
  p_id bigint,
  p_theme text,
  p_starts_on date,
  p_ends_on date,
  p_effects boolean default true
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  rid bigint;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  if p_theme is null or p_theme not in ('diwali', 'thanksgiving', 'christmas', 'newyear', 'lunarnewyear') then
    raise exception 'unknown theme';
  end if;
  if p_starts_on is null or p_ends_on is null then
    raise exception 'Pick the days it runs.';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'It ends before it starts.';
  end if;
  if p_id is null then
    insert into public.holiday_theme_runs (theme, starts_on, ends_on, effects, created_by)
    values (p_theme, p_starts_on, p_ends_on, coalesce(p_effects, true), auth.uid())
    returning id into rid;
  else
    update public.holiday_theme_runs r
      set theme = p_theme, starts_on = p_starts_on, ends_on = p_ends_on, effects = coalesce(p_effects, true)
      where r.id = p_id
      returning r.id into rid;
    if rid is null then
      raise exception 'That run is gone.';
    end if;
  end if;
  return rid;
end;
$$;

revoke execute on function public.admin_save_holiday_run(bigint, text, date, date, boolean) from public, anon;
grant execute on function public.admin_save_holiday_run(bigint, text, date, date, boolean) to authenticated;

-- Admin: stop a run. One that's begun ends yesterday (p_day is the
-- admin's day), so its numbers stay; one that hasn't begun is removed.
create or replace function public.admin_stop_holiday_run(p_id bigint, p_day date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := coalesce(p_day, current_date);
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  delete from public.holiday_theme_runs r where r.id = p_id and r.starts_on >= d;
  update public.holiday_theme_runs r set ends_on = d - 1 where r.id = p_id and r.starts_on < d and r.ends_on >= d;
end;
$$;

revoke execute on function public.admin_stop_holiday_run(bigint, date) from public, anon;
grant execute on function public.admin_stop_holiday_run(bigint, date) to authenticated;

-- Admin → Overview → Holiday themes: what's showing, the schedule, and
-- each run's numbers.
create or replace function public.admin_holiday_overview(p_day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d date := coalesce(p_day, current_date);
  result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'showing', public.get_holiday_theme(d),
    'active_14d', (select count(*) from public.profiles p where p.last_active_at > now() - interval '14 days'),
    -- Runs still to come or on now, soonest first, then the last few
    -- that have ended.
    'runs', coalesce((
      select jsonb_agg(x.j order by x.past, x.sort_on)
      from (
        select
          r.ends_on < d as past,
          case when r.ends_on < d then (date '9999-12-31' - r.ends_on) else (r.starts_on - date '0001-01-01') end as sort_on,
          jsonb_build_object(
            'id', r.id,
            'theme', r.theme,
            'starts_on', r.starts_on,
            'ends_on', r.ends_on,
            'effects', r.effects,
            'seen', (select count(distinct v.user_id) from public.holiday_theme_views v where v.theme = r.theme and v.day between r.starts_on and r.ends_on),
            'seen_today', (select count(distinct v.user_id) from public.holiday_theme_views v where v.theme = r.theme and v.day = d and d between r.starts_on and r.ends_on),
            'effects_off', (
              select count(*) from (
                select distinct on (v.user_id) v.effects_off
                from public.holiday_theme_views v
                where v.theme = r.theme and v.day between r.starts_on and r.ends_on
                order by v.user_id, v.day desc
              ) l where l.effects_off
            ),
            'tappers', (select count(distinct v.user_id) from public.holiday_theme_views v where v.theme = r.theme and v.day between r.starts_on and r.ends_on and v.countdown_taps > 0),
            'taps', (select coalesce(sum(v.countdown_taps), 0) from public.holiday_theme_views v where v.theme = r.theme and v.day between r.starts_on and r.ends_on)
          ) as j
        from public.holiday_theme_runs r
        where r.ends_on >= d - 60
      ) x
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke execute on function public.admin_holiday_overview(date) from public, anon;
grant execute on function public.admin_holiday_overview(date) to authenticated;
