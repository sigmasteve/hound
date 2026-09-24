-- Fixes a real "column reference "organization_id" is ambiguous" error
-- hit when saving an org's Chase labels from OrgDetailScreen (#161).
--
-- org_set_labels' INSERT ... VALUES (0036_organization_labels.sql) used
-- the bare parameter name organization_id, which Postgres can't tell
-- apart from organization_labels' own organization_id column in that
-- position — the same disambiguation issue 0035_organizations.sql's
-- admin_add_org_member/admin_regenerate_org_invite_code already had to
-- qualify (org_set_labels.organization_id), just missed here since the
-- ambiguity only bites inside an INSERT's VALUES list, not the WHERE
-- clause this function already qualified correctly.
--
-- Run this once, after 0038, in the SQL Editor.

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
  values (org_set_labels.organization_id, org_set_labels.hunter_label, org_set_labels.hunted_label, org_set_labels.zombie_label, now())
  on conflict (organization_id) do update
    set hunter_label = excluded.hunter_label,
        hunted_label = excluded.hunted_label,
        zombie_label = excluded.zombie_label,
        updated_at = now();
end;
$$;

grant execute on function public.org_set_labels(uuid, text, text, text) to authenticated;
