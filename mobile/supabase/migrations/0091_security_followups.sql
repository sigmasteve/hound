-- Hound: security follow-ups to Roshan Trivedi's review (0090).
--
-- The parts of his review that 0090 leaves to later and that can still
-- ship to the current 0.10 app as an over-the-air update:
--
--   H7  Push token stays with whoever signed in first on a phone.
--       claim_push_token() hands the phone's token to whoever is signed
--       in now. (The app also removes it on sign-out.)
--   H8  No way to delete your own account. delete_account_data() is the
--       server half of the new delete-my-account function: it hands
--       shared challenges to another player, removes the rest, and
--       clears the workout archive, which has no link to the user.
--   M7  Some links to a user had no ON DELETE rule, so deleting a user
--       failed. They now cascade or clear. (challenge_participants.
--       last_tagged_by has no foreign key on purpose, see 0046; it is
--       cleared by delete_account_data instead.)
--   H1  Step 1 of hiding email and friend code from other users: the
--       functions the app needs instead of reading those columns
--       (my_friend_code, profile_id_for_email, admin_search_users,
--       org_members). Step 2, the actual hiding, is 0092, run later.
--   Low Organization with no admin left: the last admin can't be demoted
--       or removed by anyone but a platform admin.
--
-- Run this once, after 0090, in the SQL Editor.

-- ── H7: push tokens ──────────────────────────────────────────────────

-- The phone's token belongs to whoever is signed in on it now. A plain
-- upsert can't move it: the row belongs to the previous person, and
-- row-level security only lets you change your own rows.
create or replace function public.claim_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[^\]]{1,200}\]$' then
    raise exception 'That is not a push token.';
  end if;
  insert into public.device_push_tokens (user_id, expo_push_token, platform, updated_at)
    values (auth.uid(), p_token, p_platform, now())
  on conflict (expo_push_token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

revoke execute on function public.claim_push_token(text, text) from public, anon;
grant execute on function public.claim_push_token(text, text) to authenticated;

-- ── M7: links to a user that blocked deleting them ───────────────────

-- Finds the foreign key on (table, column) whatever it was named, and
-- recreates it with the given ON DELETE rule. Never adds a foreign key
-- that isn't there: a new link to profiles can make PostgREST refuse
-- older apps' embeds as ambiguous (0046).
do $$
declare
  r record;
  con text;
begin
  for r in
    select * from (values
      ('organizations', 'created_by', 'set null'),
      ('tag_rounds', 'it_user_id', 'cascade'),
      ('tag_rounds', 'target_user_id', 'set null'),
      ('tag_events', 'tagger_id', 'cascade'),
      ('tag_events', 'tagged_id', 'cascade'),
      ('tictacgo_games', 'x_user_id', 'set null'),
      ('tictacgo_games', 'o_user_id', 'set null'),
      ('tictacgo_games', 'turn_user_id', 'set null'),
      ('tictacgo_games', 'winner_user_id', 'set null')
    ) as t (tbl, col, rule)
  loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = r.tbl and column_name = r.col) then
      continue;
    end if;
    con := null;
    select c.conname into con
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.conrelid = ('public.' || r.tbl)::regclass
        and c.contype = 'f'
        and c.confrelid = 'public.profiles'::regclass
        and a.attname = r.col;
    if con is null then
      continue;
    end if;
    execute format('alter table public.%I drop constraint %I', r.tbl, con);
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.profiles (id) on delete %s',
      r.tbl, r.tbl || '_' || r.col || '_fkey', r.col, r.rule
    );
  end loop;
end $$;

-- ── H8: deleting your own account ────────────────────────────────────

-- Called by the delete-my-account function (service role) just before it
-- deletes the sign-in, which cascades to the profile and everything that
-- hangs off it. challenges.created_by can't cascade: other people may
-- still be playing. So a challenge someone else is in is handed to them
-- (an admin, for a global challenge); one nobody else is in is deleted.
create or replace function public.delete_account_data(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ch record;
  heir uuid;
begin
  for ch in select id, is_global from public.challenges where created_by = p_user loop
    heir := null;
    if ch.is_global then
      select p.id into heir from public.profiles p
        where p.is_admin and p.id <> p_user order by p.created_at limit 1;
    end if;
    if heir is null then
      select cp.user_id into heir from public.challenge_participants cp
        where cp.challenge_id = ch.id and cp.user_id <> p_user
        order by cp.joined_at limit 1;
    end if;
    if heir is null then
      delete from public.challenges where id = ch.id;
    else
      update public.challenges set created_by = heir where id = ch.id;
    end if;
  end loop;

  -- No foreign key here (0046), so clear it by hand.
  update public.challenge_participants set last_tagged_by = null where last_tagged_by = p_user;

  if to_regclass('public.workout_history_archive') is not null then
    delete from public.workout_history_archive where user_id = p_user;
  end if;
end;
$$;

revoke execute on function public.delete_account_data(uuid) from public, anon, authenticated;
-- Only the delete-my-account and admin-delete-user functions call it,
-- with the service role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.delete_account_data(uuid) to service_role;
  end if;
end $$;

-- ── H1 step 1: what the app reads instead of email / friend code ─────

create or replace function public.my_friend_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select friend_code from public.profiles where id = auth.uid();
$$;

-- Invite by email: who, if anyone, has this address. One answer per
-- call, instead of the whole table being readable.
create or replace function public.profile_id_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles
  where auth.uid() is not null and lower(email) = lower(trim(p_email))
  limit 1;
$$;

-- Admin → Users and the organization "add member" search. Platform
-- admins only; same columns and order as the app's old direct query.
create or replace function public.admin_search_users(p_query text)
returns table (
  id uuid, name text, initials text, username text, use_username boolean, email text,
  is_admin boolean, last_active_at timestamptz, created_at timestamptz, organization_id uuid,
  equipped_frame_id text, equipped_background_id text, equipped_icon_id text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := nullif(trim(coalesce(p_query, '')), '');
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return query
    select p.id, p.name, p.initials, p.username, p.use_username, p.email,
           p.is_admin, p.last_active_at, p.created_at, p.organization_id,
           p.equipped_frame_id, p.equipped_background_id, p.equipped_icon_id
    from public.profiles p
    where q is null
       or p.name ilike '%' || q || '%'
       or p.username ilike '%' || q || '%'
       or p.email ilike '%' || q || '%'
    order by p.is_admin desc, p.name asc
    limit 25;
end;
$$;

-- An organization's members. Members of the organization (and platform
-- admins) can list them; only its admins (and platform admins) see the
-- email addresses.
create or replace function public.org_members(p_org uuid)
returns table (
  id uuid, name text, initials text, username text, use_username boolean, email text,
  org_role text, equipped_frame_id text, equipped_background_id text, equipped_icon_id text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me public.profiles;
  sees_email boolean;
begin
  select * into me from public.profiles where profiles.id = auth.uid();
  if me.id is null or not (coalesce(me.is_admin, false) or me.organization_id is not distinct from p_org) then
    raise exception 'not authorized';
  end if;
  sees_email := coalesce(me.is_admin, false) or (me.organization_id = p_org and me.org_role = 'admin');
  return query
    select p.id, p.name, p.initials, p.username, p.use_username,
           case when sees_email then p.email else null end,
           p.org_role, p.equipped_frame_id, p.equipped_background_id, p.equipped_icon_id
    from public.profiles p
    where p.organization_id = p_org
    order by p.org_role desc nulls last, p.name asc;
end;
$$;

revoke execute on function public.my_friend_code() from public, anon;
revoke execute on function public.profile_id_for_email(text) from public, anon;
revoke execute on function public.admin_search_users(text) from public, anon;
revoke execute on function public.org_members(uuid) from public, anon;
grant execute on function public.my_friend_code() to authenticated;
grant execute on function public.profile_id_for_email(text) to authenticated;
grant execute on function public.admin_search_users(text) to authenticated;
grant execute on function public.org_members(uuid) to authenticated;

-- ── Low: an organization always keeps an admin ───────────────────────

-- Same as 0090's versions, plus: an organization admin can't demote or
-- remove its last admin (a platform admin still can).
create or replace function public.org_set_member_role(target_user_id uuid, role text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  target_org uuid;
  target_role text;
  caller_is_platform_admin boolean;
  caller_org_role text;
  caller_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  if role not in ('member', 'admin') then
    raise exception 'role must be ''member'' or ''admin''';
  end if;

  select organization_id, org_role into target_org, target_role from public.profiles where id = target_user_id;
  if target_org is null then
    raise exception 'That person is not in an organization.';
  end if;

  select is_admin, organization_id, org_role
    into caller_is_platform_admin, caller_org, caller_org_role
    from public.profiles where id = auth.uid();

  if not (
    coalesce(caller_is_platform_admin, false)
    or (coalesce(caller_org = target_org, false) and coalesce(caller_org_role = 'admin', false))
  ) then
    raise exception 'not authorized';
  end if;

  if role = 'member' and target_role = 'admin' and not coalesce(caller_is_platform_admin, false)
     and not exists (select 1 from public.profiles p
                     where p.organization_id = target_org and p.org_role = 'admin' and p.id <> target_user_id) then
    raise exception 'An organization needs at least one admin. Make someone else an admin first.';
  end if;

  update public.profiles set org_role = role where id = target_user_id;
end;
$$;

create or replace function public.org_remove_member(target_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  target_org uuid;
  target_role text;
  caller_is_platform_admin boolean;
  caller_org_role text;
  caller_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;

  select organization_id, org_role into target_org, target_role from public.profiles where id = target_user_id;
  if target_org is null then
    raise exception 'That person is not in an organization.';
  end if;

  select is_admin, organization_id, org_role
    into caller_is_platform_admin, caller_org, caller_org_role
    from public.profiles where id = auth.uid();

  if not (
    coalesce(caller_is_platform_admin, false)
    or (coalesce(caller_org = target_org, false) and coalesce(caller_org_role = 'admin', false))
  ) then
    raise exception 'not authorized';
  end if;

  if target_role = 'admin' and not coalesce(caller_is_platform_admin, false)
     and not exists (select 1 from public.profiles p
                     where p.organization_id = target_org and p.org_role = 'admin' and p.id <> target_user_id) then
    raise exception 'An organization needs at least one admin. Make someone else an admin first.';
  end if;

  update public.profiles set organization_id = null, org_role = null where id = target_user_id;
end;
$$;

revoke execute on function public.org_set_member_role(uuid, text) from public, anon;
revoke execute on function public.org_remove_member(uuid) from public, anon;
grant execute on function public.org_set_member_role(uuid, text) to authenticated;
grant execute on function public.org_remove_member(uuid) to authenticated;
