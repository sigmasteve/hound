-- Hound: admins can give a member an item, for testing.
--
-- Admin → People → a member → Testing: give them the Porch (skipping its
-- Hunter level and its Bones) and, if wanted, everything that goes on it,
-- so testers can try the Porch and the hot tub before they've earned
-- them. Also takes it back. Every grant and take-back is kept in
-- admin_item_grants, so it's clear later what was given and by whom.
--
-- A given item is a kennel_purchases row with 0 Bones, the same as a
-- gift's, so the rest of the app treats it as owned.
--
-- Run this once, after 0001-0159, in the SQL Editor.

create table public.admin_item_grants (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.kennel_items (id),
  action text not null check (action in ('give', 'take')),
  created_at timestamptz not null default now()
);

alter table public.admin_item_grants enable row level security;
revoke all on public.admin_item_grants from anon, authenticated;

create or replace function public.admin_require()
returns void
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only an admin can do that.';
  end if;
end;
$$;

revoke execute on function public.admin_require() from public, anon, authenticated;

-- Gives each item they don't have yet; returns how many were new.
create or replace function public.admin_give_items(p_user uuid, p_item_ids text[])
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  added integer;
begin
  perform public.admin_require();
  if not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'No such member.';
  end if;
  if exists (select 1 from unnest(p_item_ids) x where not exists (select 1 from public.kennel_items i where i.id = x)) then
    raise exception 'One of those items doesn''t exist.';
  end if;
  with fresh as (
    insert into public.kennel_purchases (user_id, item_id, bones)
    select p_user, x, 0 from unnest(p_item_ids) x
    on conflict do nothing
    returning item_id
  ), logged as (
    insert into public.admin_item_grants (admin_id, user_id, item_id, action)
    select auth.uid(), p_user, f.item_id, 'give' from fresh f
    returning 1
  )
  select count(*)::integer into added from logged;
  return added;
end;
$$;

revoke execute on function public.admin_give_items(uuid, text[]) from public, anon;
grant execute on function public.admin_give_items(uuid, text[]) to authenticated;

-- Takes back items an admin gave (never ones they paid for or were
-- gifted). Returns how many.
create or replace function public.admin_take_items(p_user uuid, p_item_ids text[])
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  removed integer;
begin
  perform public.admin_require();
  with gone as (
    delete from public.kennel_purchases pu
    where pu.user_id = p_user
      and pu.item_id = any (p_item_ids)
      and pu.bones = 0
      and exists (select 1 from public.admin_item_grants g where g.user_id = p_user and g.item_id = pu.item_id and g.action = 'give')
      and not exists (select 1 from public.kennel_gifts k where k.to_id = p_user and k.item_id = pu.item_id)
    returning pu.item_id
  ), logged as (
    insert into public.admin_item_grants (admin_id, user_id, item_id, action)
    select auth.uid(), p_user, g.item_id, 'take' from gone g
    returning 1
  )
  select count(*)::integer into removed from logged;
  return removed;
end;
$$;

revoke execute on function public.admin_take_items(uuid, text[]) from public, anon;
grant execute on function public.admin_take_items(uuid, text[]) to authenticated;

-- What a member owns, for the Testing card: item ids, and which of those
-- an admin gave.
create or replace function public.admin_member_items(p_user uuid)
returns table (item_id text, given boolean)
language plpgsql
stable
security definer set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.admin_require();
  return query
    select pu.item_id,
      exists (
        select 1 from public.admin_item_grants g
        where g.user_id = p_user and g.item_id = pu.item_id and g.action = 'give'
      ) and pu.bones = 0
    from public.kennel_purchases pu
    where pu.user_id = p_user;
end;
$$;

revoke execute on function public.admin_member_items(uuid) from public, anon;
grant execute on function public.admin_member_items(uuid) to authenticated;
