-- 0039 qualified every plain column reference in org_set_labels, but the
-- error persisted — turns out Postgres's ambiguous-name check also
-- applies to an ON CONFLICT conflict target list ("on conflict
-- (organization_id)"), and *that* position can't be qualified at all
-- (it has to be a bare column name, there's no table alias or function
-- prefix valid there). With a plpgsql parameter also named
-- organization_id still in scope, "on conflict (organization_id)" stays
-- ambiguous no matter how the rest of the function is qualified.
--
-- The only real fix is to stop the parameter and the column sharing a
-- name at all. Renamed the parameter to p_organization_id (only that
-- one — hunter_label/hunted_label/zombie_label never appear in a
-- conflict target, so they're not at risk here and stay as they are).
-- This changes the RPC's named-parameter contract, so
-- src/organizations/supabaseOrganizations.ts's setOrgLabels() is
-- updated in the same commit to send p_organization_id instead of
-- organization_id.
--
-- Run this once, after 0040, in the SQL Editor.

create or replace function public.org_set_labels(p_organization_id uuid, hunter_label text, hunted_label text, zombie_label text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.is_admin or (p.organization_id = p_organization_id and p.org_role = 'admin'))
  ) then
    raise exception 'not authorized';
  end if;

  insert into public.organization_labels (organization_id, hunter_label, hunted_label, zombie_label, updated_at)
  values (p_organization_id, org_set_labels.hunter_label, org_set_labels.hunted_label, org_set_labels.zombie_label, now())
  on conflict (organization_id) do update
    set hunter_label = excluded.hunter_label,
        hunted_label = excluded.hunted_label,
        zombie_label = excluded.zombie_label,
        updated_at = now();
end;
$$;

-- The old (organization_id uuid, text, text, text) signature is gone —
-- create or replace above only updates it in place because the
-- parameter TYPES are unchanged (Postgres overloads by type, not name),
-- so there's nothing to drop separately.
grant execute on function public.org_set_labels(uuid, text, text, text) to authenticated;
