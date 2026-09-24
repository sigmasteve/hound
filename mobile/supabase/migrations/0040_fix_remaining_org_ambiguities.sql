-- 0039 fixed org_set_labels' own "column reference organization_id is
-- ambiguous" error, but a full audit of 0035_organizations.sql turned up
-- the same class of bug in three more places — hit for real when "Add
-- member" on OrgDetailScreen (#161) called admin_add_org_member. Postgres
-- resolves a bare identifier against BOTH a plpgsql parameter and any
-- column of that name on a table the same SQL command touches (its
-- INSERT target list, or an unaliased table in FROM) — not just the
-- clause the identifier actually sits in. Fixed here by qualifying every
-- occurrence, same pattern 0039 used.
--
-- Run this once, after 0039, in the SQL Editor.

-- admin_create_organization's INSERT ... VALUES (name, kind, ...)
-- referenced its own name/kind parameters unqualified — organizations
-- has columns of both names, in the same INSERT's target list.
create or replace function public.admin_create_organization(name text, kind text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  new_id uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  insert into public.organizations (name, kind, invite_code)
  values (admin_create_organization.name, admin_create_organization.kind, public.generate_org_invite_code())
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.admin_create_organization(text, text) to authenticated;

-- admin_add_org_member's own "already in an organization" check meant to
-- read the target row's own organization_id column, not its own
-- organization_id parameter (the org being added TO) — qualified to the
-- column via an alias, the opposite fix from the other two functions
-- here, since the column is what this check actually needs.
create or replace function public.admin_add_org_member(target_user_id uuid, organization_id uuid, role text default 'member')
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  if role not in ('member', 'admin') then
    raise exception 'role must be ''member'' or ''admin''';
  end if;
  if exists (select 1 from public.profiles p where p.id = target_user_id and p.organization_id is not null) then
    raise exception 'That person is already in an organization — remove them first.';
  end if;

  update public.profiles set organization_id = admin_add_org_member.organization_id, org_role = role
  where id = target_user_id;
end;
$$;

grant execute on function public.admin_add_org_member(uuid, uuid, text) to authenticated;

-- admin_regenerate_org_invite_code's own caller-lookup selected
-- organization_id into a variable unqualified, ambiguous against its own
-- organization_id parameter (the org whose code is being regenerated).
create or replace function public.admin_regenerate_org_invite_code(organization_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  caller_is_platform_admin boolean;
  caller_org uuid;
  caller_org_role text;
  new_code text;
begin
  select p.is_admin, p.organization_id, p.org_role
    into caller_is_platform_admin, caller_org, caller_org_role
    from public.profiles p where p.id = auth.uid();

  if not (caller_is_platform_admin or (caller_org = admin_regenerate_org_invite_code.organization_id and caller_org_role = 'admin')) then
    raise exception 'not authorized';
  end if;

  new_code := public.generate_org_invite_code();
  update public.organizations set invite_code = new_code where id = admin_regenerate_org_invite_code.organization_id;
  return new_code;
end;
$$;

grant execute on function public.admin_regenerate_org_invite_code(uuid) to authenticated;
