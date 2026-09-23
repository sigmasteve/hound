-- Hound: the concrete piece of the organization model 0015_app_labels.sql's
-- own comment named as "real follow-up work once this app has an
-- organization model to scope it to" — each org now gets its own label
-- set instead of every signed-in user sharing the one global row. See
-- 0035_organizations.sql / GitHub issue #158 for the rest of the model
-- this hangs off of.
--
-- The existing public.app_labels singleton is untouched and keeps its
-- current role: the default wording for anyone with no organization_id
-- (an "individual" profile). Nothing here changes what an independent
-- user sees — this only adds a second, org-scoped source a future
-- client-side LabelsContext change can prefer when the signed-in user
-- (or their current org context, once that switch exists) has an org.
--
-- Run this once, after 0035, in the SQL Editor.

create table public.organization_labels (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  hunter_label text not null default 'Hound',
  hunted_label text not null default 'Fox',
  zombie_label text not null default 'Out',
  updated_at timestamptz not null default now()
);

alter table public.organization_labels enable row level security;

-- Readable by that org's own members and platform admins only — unlike
-- the global app_labels row (open to any signed-in user, since it's
-- the one shared default), one org's custom wording isn't meant to be
-- visible to people outside it.
create policy "Members and platform admins can view their org's labels"
  on public.organization_labels for select
  to authenticated
  using (
    organization_id = (select organization_id from public.profiles where id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- Only that org's own admin (or a platform admin) can change them —
-- same shape as 0022_admin_gate_app_labels.sql's tightening of the
-- global row, just scoped per-org instead of platform-wide.
create policy "Org admins and platform admins can update their org's labels"
  on public.organization_labels for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_admin or (p.organization_id = organization_labels.organization_id and p.org_role = 'admin'))
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_admin or (p.organization_id = organization_labels.organization_id and p.org_role = 'admin'))
    )
  );

-- The row itself is created on demand, not at org-creation time —
-- admin_create_organization (0035) doesn't insert one, so a brand new
-- org has no override until its own admin actually sets one, same
-- "nothing to fake here" reasoning 0015's own comment used for the
-- global singleton.
create or replace function public.org_set_labels(organization_id uuid, hunter_label text, hunted_label text, zombie_label text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.is_admin or (p.organization_id = org_set_labels.organization_id and p.org_role = 'admin'))
  ) then
    raise exception 'not authorized';
  end if;

  insert into public.organization_labels (organization_id, hunter_label, hunted_label, zombie_label, updated_at)
  values (organization_id, hunter_label, hunted_label, zombie_label, now())
  on conflict (organization_id) do update
    set hunter_label = excluded.hunter_label,
        hunted_label = excluded.hunted_label,
        zombie_label = excluded.zombie_label,
        updated_at = now();
end;
$$;

grant execute on function public.org_set_labels(uuid, text, text, text) to authenticated;
