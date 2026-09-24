-- 0041's create-or-replace failed outright:
--   ERROR: 42P13: cannot change name of input parameter "organization_id"
--   HINT: Use DROP FUNCTION org_set_labels(uuid,text,text,text) first.
-- Postgres allows create-or-replace to change a function's body, but not
-- to rename a parameter even when every type stays the same — that
-- needs an explicit drop. 0041 never actually took effect, so the
-- database is still on the old (organization_id uuid, ...) signature
-- from 0039/0040.
--
-- Run this once, after 0040 (0041 never applied — skip straight past
-- it), in the SQL Editor.

drop function if exists public.org_set_labels(uuid, text, text, text);

create function public.org_set_labels(p_organization_id uuid, hunter_label text, hunted_label text, zombie_label text)
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

grant execute on function public.org_set_labels(uuid, text, text, text) to authenticated;
