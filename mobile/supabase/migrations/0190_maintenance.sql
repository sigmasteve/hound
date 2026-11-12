-- Hound: maintenance (Steve: "If database connectivity is down, how can
-- we show a maintenance screen... even if I have to set it in Admin
-- before I make infrastructure changes").
--
-- Admin → Maintenance sets a window: a message, when it starts and how
-- long it takes. Phones read it whenever they open Hound and keep a copy,
-- so during the window, when this server can't be reached, they show the
-- maintenance screen with that message instead of "can't reach its
-- server". From a few hours before, Today shows a heads-up, and
-- maintenance_seen counts who saw it.
--
-- "Maintenance now" shows the maintenance screen to everyone while the
-- server is up (a big migration, say). Admins can continue past it.
--
-- The website's status file (site/status.json) is the other half: it
-- stays up when this database doesn't, for phones that never saw the
-- schedule.
--
-- Read before sign-in too (the app checks it as it opens), so anon can
-- read it. Run once, after 0189, in the SQL Editor.

create table if not exists public.app_maintenance (
  id boolean primary key default true,
  constraint app_maintenance_singleton check (id),
  message text check (message is null or char_length(message) <= 200),
  starts_at timestamptz,
  ends_at timestamptz,
  heads_up_hours integer not null default 6 check (heads_up_hours between 0 and 72),
  now_on boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint app_maintenance_window check (starts_at is null or (ends_at is not null and ends_at > starts_at))
);
insert into public.app_maintenance (id) values (true) on conflict (id) do nothing;

alter table public.app_maintenance enable row level security;
drop policy if exists "Anyone can read the maintenance window" on public.app_maintenance;
create policy "Anyone can read the maintenance window"
  on public.app_maintenance for select to anon, authenticated using (true);
grant select on public.app_maintenance to anon, authenticated;
revoke insert, update, delete on public.app_maintenance from anon, authenticated;

-- Who saw the heads-up for which window (starts_at names the window).
create table if not exists public.maintenance_seen (
  user_id uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, starts_at)
);
alter table public.maintenance_seen enable row level security;
revoke all on public.maintenance_seen from anon, authenticated;

create or replace function public.maintenance_require_admin()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
end;
$$;
revoke execute on function public.maintenance_require_admin() from public, anon, authenticated;

-- A window: starts at p_starts_at, lasts p_minutes (1 to 8 hours).
create or replace function public.admin_set_maintenance(p_message text, p_starts_at timestamptz, p_minutes integer)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_message text := nullif(trim(coalesce(p_message, '')), '');
begin
  perform public.maintenance_require_admin();
  if p_starts_at is null then
    raise exception 'Pick when it starts.';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 480 then
    raise exception 'It can last from 1 minute to 8 hours.';
  end if;
  if p_starts_at + make_interval(mins => p_minutes) <= now() then
    raise exception 'That window is already over.';
  end if;
  if v_message is not null and char_length(v_message) > 200 then
    raise exception 'Keep the message under 200 characters.';
  end if;
  update public.app_maintenance m
     set message = v_message,
         starts_at = p_starts_at,
         ends_at = p_starts_at + make_interval(mins => p_minutes),
         updated_at = now(),
         updated_by = auth.uid()
   where m.id;
end;
$$;
revoke execute on function public.admin_set_maintenance(text, timestamptz, integer) from public, anon;
grant execute on function public.admin_set_maintenance(text, timestamptz, integer) to authenticated;

create or replace function public.admin_clear_maintenance()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.maintenance_require_admin();
  update public.app_maintenance m
     set message = null, starts_at = null, ends_at = null, updated_at = now(), updated_by = auth.uid()
   where m.id;
end;
$$;
revoke execute on function public.admin_clear_maintenance() from public, anon;
grant execute on function public.admin_clear_maintenance() to authenticated;

create or replace function public.admin_set_maintenance_now(p_on boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.maintenance_require_admin();
  update public.app_maintenance m
     set now_on = coalesce(p_on, false), updated_at = now(), updated_by = auth.uid()
   where m.id;
end;
$$;
revoke execute on function public.admin_set_maintenance_now(boolean) from public, anon;
grant execute on function public.admin_set_maintenance_now(boolean) to authenticated;

-- Today calls this once per window when the heads-up shows.
create or replace function public.mark_maintenance_seen(p_starts_at timestamptz)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if not exists (select 1 from public.app_maintenance m where m.id and m.starts_at = p_starts_at) then
    return;
  end if;
  insert into public.maintenance_seen (user_id, starts_at) values (auth.uid(), p_starts_at)
  on conflict do nothing;
end;
$$;
revoke execute on function public.mark_maintenance_seen(timestamptz) from public, anon;
grant execute on function public.mark_maintenance_seen(timestamptz) to authenticated;

-- Admin → Maintenance: the window, the switch, and who saw the heads-up.
create or replace function public.admin_maintenance_overview()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  m public.app_maintenance;
begin
  perform public.maintenance_require_admin();
  select * into m from public.app_maintenance where id;
  return jsonb_build_object(
    'message', m.message,
    'starts_at', m.starts_at,
    'ends_at', m.ends_at,
    'heads_up_hours', m.heads_up_hours,
    'now_on', m.now_on,
    'seen', (select count(*) from public.maintenance_seen s where m.starts_at is not null and s.starts_at = m.starts_at),
    'windows', (select count(distinct s.starts_at) from public.maintenance_seen s),
    'seen_all', (select count(*) from public.maintenance_seen s)
  );
end;
$$;
revoke execute on function public.admin_maintenance_overview() from public, anon;
grant execute on function public.admin_maintenance_overview() to authenticated;
