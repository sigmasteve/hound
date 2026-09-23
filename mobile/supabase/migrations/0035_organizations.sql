-- Hound: the first real piece of the organization/cross-tenancy model —
-- see GitHub issue #158 for the full design discussion this implements.
-- Identity stays singular: a profile is still exactly one row, one
-- person. Org membership is a tag on that same row (organization_id +
-- org_role), not a fork — "individual" vs. "org" is a client-side
-- context switch on top of the same account, not a different login.
--
-- One org max per person, to start (a plain nullable FK on profiles,
-- not a join table) — a real multi-org model is real follow-up work
-- once single-org membership has been validated in practice, not
-- something to build preemptively (see issue #158's own note on this).
--
-- Run this once, after 0001-0034, in the SQL Editor.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('school', 'company')),
  invite_code text not null unique,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;

-- A member can see their own org's row; a platform admin can see every
-- org (needed for the future org-management tab). Nobody else can see
-- anything about an org they're not in — unlike profiles/app_labels,
-- there's no "any signed-in user" read here, since an org's existence
-- and name aren't meant to be discoverable platform-wide.
create policy "Members and platform admins can view an organization"
  on public.organizations for select
  to authenticated
  using (
    id = (select organization_id from public.profiles where id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- No insert/update/delete policy at all — every write goes through the
-- security-definer RPCs below, same "no in-app way to do this directly"
-- shape as is_admin (0021_admin_flag.sql). A client with only the
-- authenticated role can never create or modify an organization except
-- through those functions' own admin checks.

alter table public.profiles
  add column organization_id uuid references public.organizations (id),
  add column org_role text check (org_role in ('member', 'admin'));

-- Same reasoning as is_admin's own revoke (0021_admin_flag.sql): only a
-- connection that bypasses grants entirely (SQL Editor, service_role, or
-- one of the security-definer functions below, which run as their
-- owner regardless of the caller's own grants) can change who belongs
-- to an org or what role they hold there.
revoke update (organization_id, org_role) on public.profiles from authenticated, anon;

-- Same alphabet/shape as generate_friend_code() (0019_friend_codes.sql),
-- just a separate namespace (organizations.invite_code) rather than
-- reusing that one.
create or replace function public.generate_org_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  code text;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.organizations where invite_code = code);
  end loop;
  return code;
end;
$$;

-- Platform-admin only, on purpose — org creation isn't self-serve (see
-- issue #158). Returns the new org's id so the caller can immediately
-- bootstrap its first member via admin_add_org_member below.
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
  values (name, kind, public.generate_org_invite_code())
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.admin_create_organization(text, text) to authenticated;

-- The bootstrap/override path: a platform admin directly places someone
-- into an org at a given role, e.g. to seed an org's very first admin
-- (nobody else has an invite code to hand out yet) or for support/
-- override cases. Deliberately platform-admin only, not an org admin's
-- own tool — org admins invite people in via redeem_organization_invite
-- below, which they can hand out themselves without needing this.
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
  if exists (select 1 from public.profiles where id = target_user_id and organization_id is not null) then
    raise exception 'That person is already in an organization — remove them first.';
  end if;

  update public.profiles set organization_id = admin_add_org_member.organization_id, org_role = role
  where id = target_user_id;
end;
$$;

grant execute on function public.admin_add_org_member(uuid, uuid, text) to authenticated;

-- Self-serve join, gated only by holding the code — same "anyone with
-- the code can use it" shape as add_friend_by_code
-- (0019_friend_codes.sql), not an approval step. Blocks anyone already
-- in an org rather than moving them: per issue #158, switching orgs
-- means leaving first (leave_organization below), not a direct A→B
-- move, while the model itself is still unproven.
create or replace function public.redeem_organization_invite(code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  org_id uuid;
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if exists (select 1 from public.profiles where id = me and organization_id is not null) then
    raise exception 'Leave your current organization before joining another one.';
  end if;

  select id into org_id from public.organizations where invite_code = code;
  if org_id is null then
    raise exception 'That invite code doesn''t match any organization.';
  end if;

  update public.profiles set organization_id = org_id, org_role = 'member' where id = me;
  return org_id;
end;
$$;

grant execute on function public.redeem_organization_invite(text) to authenticated;

-- Always allowed for your own membership — no admin check, since
-- leaving your own org is never something that needs permission.
create or replace function public.leave_organization()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and organization_id is not null) then
    raise exception 'You''re not in an organization.';
  end if;

  update public.profiles set organization_id = null, org_role = null where id = auth.uid();
end;
$$;

grant execute on function public.leave_organization() to authenticated;

-- Callable by a platform admin, or by an existing admin of the SAME
-- org promoting/demoting a fellow member — not by an ordinary member,
-- and not across org boundaries (an admin of org A can't touch org B).
create or replace function public.org_set_member_role(target_user_id uuid, role text)
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
  if role not in ('member', 'admin') then
    raise exception 'role must be ''member'' or ''admin''';
  end if;

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

  update public.profiles set org_role = role where id = target_user_id;
end;
$$;

grant execute on function public.org_set_member_role(uuid, text) to authenticated;

-- Same caller shape as org_set_member_role — a platform admin, or that
-- org's own admin, can rotate the code (e.g. if it leaked). Returns the
-- new code directly so the caller doesn't need a second read.
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
  select is_admin, organization_id, org_role
    into caller_is_platform_admin, caller_org, caller_org_role
    from public.profiles where id = auth.uid();

  if not (caller_is_platform_admin or (caller_org = admin_regenerate_org_invite_code.organization_id and caller_org_role = 'admin')) then
    raise exception 'not authorized';
  end if;

  new_code := public.generate_org_invite_code();
  update public.organizations set invite_code = new_code where id = admin_regenerate_org_invite_code.organization_id;
  return new_code;
end;
$$;

grant execute on function public.admin_regenerate_org_invite_code(uuid) to authenticated;
