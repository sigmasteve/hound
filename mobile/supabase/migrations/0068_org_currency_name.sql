-- Hound: lets an org (school/company) rename "Bones" to something of its
-- own — closing GitHub issue #229's second fast-follow. The column
-- itself (organizations.currency_name) has existed since
-- 0060_bones_shop.sql; this is the first thing that actually writes to
-- it, via a security-definer RPC (organizations has no UPDATE policy at
-- all — see 0035_organizations.sql's own comment — so every write goes
-- through a function like this one, never a direct client update).
--
-- Same caller shape as org_set_member_role/admin_regenerate_org_invite_code
-- (0035_organizations.sql): a platform admin, or that org's own admin,
-- may call this for their org. Empty/whitespace-only input clears the
-- override back to null (falls back to "Bones" everywhere it's read —
-- see 0060's own comment on that default), rather than saving a blank
-- currency name.
--
-- Run this once, after 0001-0067, in the SQL Editor.

create or replace function public.org_set_currency_name(organization_id uuid, currency_name text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller_is_platform_admin boolean;
  caller_org uuid;
  caller_org_role text;
  trimmed text;
begin
  select is_admin, profiles.organization_id, org_role
    into caller_is_platform_admin, caller_org, caller_org_role
    from public.profiles where id = auth.uid();

  if not (caller_is_platform_admin or (caller_org = org_set_currency_name.organization_id and caller_org_role = 'admin')) then
    raise exception 'not authorized';
  end if;

  trimmed := nullif(trim(org_set_currency_name.currency_name), '');
  update public.organizations set currency_name = trimmed where id = org_set_currency_name.organization_id;
end;
$$;

grant execute on function public.org_set_currency_name(uuid, text) to authenticated;
