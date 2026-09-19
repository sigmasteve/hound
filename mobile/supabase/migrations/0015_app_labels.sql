-- Hound: customizable terminology for the Hunter/Hunted/Zombie roles a
-- hunt assigns — some schools/companies running Hound for their own
-- group don't want "Zombie" (or "Hunter"/"Hunted") as the wording their
-- people see. Lets anyone change it from Settings ("Data & account" →
-- "Hunt labels") instead of it being fixed in the app's own source.
--
-- Deliberately app-wide, not per-user or per-organization: this app has
-- no organization/tenant concept yet, and different users seeing
-- different words for the same role on the same shared hunt would be
-- actively confusing (a Hunter on one phone reading "Chaser" on
-- another's). One shared row is the simplest thing that actually works
-- for "our whole group uses these words" — a true per-organization
-- version (each school/company getting its own label set, scoped to its
-- own users) is real follow-up work once this app has an organization
-- model to scope it to, not something to fake here.
--
-- Run this once, after 0001-0014, in the SQL Editor.

-- The `id boolean primary key default true` + check(id) pair is the
-- standard Postgres "exactly one row, ever" trick: a second insert would
-- need id = true too, which the primary key already forbids. Simpler
-- than a serial id plus an application-level "only ever read/write row
-- 1" convention, and it's enforced by the schema instead of by every
-- caller remembering to filter on it.
create table public.app_labels (
  id boolean primary key default true,
  constraint app_labels_singleton check (id),
  hunter_label text not null default 'Hunter',
  hunted_label text not null default 'Hunted',
  zombie_label text not null default 'Zombie',
  updated_at timestamptz not null default now()
);

insert into public.app_labels (id) values (true);

alter table public.app_labels enable row level security;

create policy "Anyone signed in can read the app's labels"
  on public.app_labels for select
  to authenticated
  using (true);

-- Wide open to any signed-in user, not just an admin — there's no
-- admin/role concept in this schema yet either. Acceptable for a single
-- group's own deployment (the "shared, app-wide" scope this migration
-- was deliberately built for — see the comment above), but this is
-- exactly the policy a real per-organization follow-up needs to
-- tighten: scope both this row (per-org instead of singleton) and this
-- policy (org admins only) together.
create policy "Anyone signed in can update the app's labels"
  on public.app_labels for update
  to authenticated
  using (true)
  with check (true);
