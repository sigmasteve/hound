-- Hound: a minimum app version (Steve: once a new build is approved and
-- out, move everyone onto it, "forcing folks to update the AppStore
-- version"). Below the minimum, the app shows a full-screen "Update
-- Hound" with the App Store or download link, instead of the app. Blank
-- means nobody's blocked. Admins can still continue past it, so a wrong
-- number can't lock the people who set it out.
--
-- Set on Admin → App versions, which shows how many people a minimum
-- would block before it's saved.
--
-- Run this once, after 0187, in the SQL Editor, then publish the app
-- update that goes with it, so every phone has the screen before the
-- first minimum is set.

create table if not exists public.app_version_gate (
  id boolean primary key default true,
  constraint app_version_gate_singleton check (id),
  min_version text check (min_version is null or min_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.app_version_gate (id) values (true) on conflict (id) do nothing;

alter table public.app_version_gate enable row level security;
drop policy if exists "Anyone signed in can read the minimum version" on public.app_version_gate;
create policy "Anyone signed in can read the minimum version"
  on public.app_version_gate for select to authenticated using (true);
revoke all on public.app_version_gate from anon;
revoke insert, update, delete on public.app_version_gate from authenticated;

create or replace function public.admin_set_min_app_version(p_version text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v text := nullif(trim(coalesce(p_version, '')), '');
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  if v is not null and v !~ '^[0-9]+\.[0-9]+\.[0-9]+$' then
    raise exception 'A version looks like 0.12.0.';
  end if;
  update public.app_version_gate g set min_version = v, updated_at = now(), updated_by = auth.uid() where g.id;
end;
$$;
revoke execute on function public.admin_set_min_app_version(text) from public, anon;
grant execute on function public.admin_set_min_app_version(text) to authenticated;
