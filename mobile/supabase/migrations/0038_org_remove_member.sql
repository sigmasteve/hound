-- The one org-membership operation 0035_organizations.sql left out: an
-- admin removing someone else from their org. admin_add_org_member is the
-- bootstrap-in path, leave_organization is self-serve-out, and
-- org_set_member_role changes a standing member's role — but nothing let
-- an admin take a member OUT other than that member leaving on their own.
-- Needed for the org-management screen's member list (remove a member,
-- not just promote/demote them).
--
-- Same caller shape as org_set_member_role: a platform admin, or an
-- existing admin of the SAME org. No self-service path for removing your
-- own membership here — that's leave_organization, unchanged.
create or replace function public.org_remove_member(target_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  target_org uuid;
  caller_is_platform_admin boolean;
  caller_org_role text;
  caller_org uuid;
begin
  select organization_id into target_org from public.profiles where id = target_user_id;
  if target_org is null then
    raise exception 'That person is not in an organization.';
  end if;

  select is_admin, organization_id, org_role
    into caller_is_platform_admin, caller_org, caller_org_role
    from public.profiles where id = auth.uid();

  if not (caller_is_platform_admin or (caller_org = target_org and caller_org_role = 'admin')) then
    raise exception 'not authorized';
  end if;

  update public.profiles set organization_id = null, org_role = null where id = target_user_id;
end;
$$;

grant execute on function public.org_remove_member(uuid) to authenticated;
