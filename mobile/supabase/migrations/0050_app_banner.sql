-- Hound: an admin-controlled announcement banner shown at the top of
-- everyone's Home screen — same "one shared row, anyone signed in can
-- read it, only an admin can write it" shape as
-- 0015/0022_app_labels.sql, not a history table: there's only ever one
-- current banner, and editing it (rather than inserting a new row) is
-- exactly what "update the announcement" means here. Gated on
-- is_admin from creation (no separate hardening migration needed, since
-- unlike app_labels this table never had a wide-open update policy to
-- begin with).
--
-- Deliberately no starts_at — this isn't a scheduling tool, just "show
-- this now, until this time (or dismissed)." An admin who wants a
-- banner to appear later just saves it later.
--
-- Run this once, after 0001-0049, in the SQL Editor.

create table public.app_banner (
  id boolean primary key default true,
  constraint app_banner_singleton check (id),
  message text not null default '',
  enabled boolean not null default false,
  -- null = no expiry, shown until an admin disables it (or a viewer
  -- dismisses it locally — that's purely client-side, see
  -- src/banner/supabaseBanner.ts).
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.app_banner (id) values (true);

alter table public.app_banner enable row level security;

create policy "Anyone signed in can read the app banner"
  on public.app_banner for select
  to authenticated
  using (true);

create policy "Only admins can update the app banner"
  on public.app_banner for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
