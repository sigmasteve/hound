-- Hound: the Kennel opens up as you level up (Steve, 17 Nov 2026: "for new
-- users it will be overwhelming"). The app hides what isn't open yet
-- (src/kennel/unlocks.ts); this is the server's side of the same ladder:
--
--   level 2  Tricks                      kennel_item_problem
--   level 3  the Garden (planting)       garden_plantings guard
--   level 4  the Kitchen (baking treats) hound_treats guard
--   level 5  the Porch (was 10)          kennel_item_problem
--   level 6  neck, face, body and feet   kennel_item_problem
--   level 7  bougie houses               kennel_item_problem
--   level 8  the Room                    kennel_item_problem
--   level 9  gifting                     kennel_gifts guard
--
-- Anyone who already uses something keeps it: each check passes when the
-- person has bought, planted, baked or gifted that kind of thing before.
-- Levels come from level_for_xp (0100), as everywhere else.
--
-- admin_kennel_unlocks_overview(): for people active in the last 30 days,
-- how many have reached each unlock and how many use it, for Admin →
-- Overview → Hound → Kennel unlocks.
--
-- Run this once, after 0001-0215, in the SQL Editor.

create or replace function public.kennel_level(p_user uuid)
returns int
language sql
stable
security definer set search_path = public
as $$
  select public.level_for_xp(coalesce((select p.xp_total from public.profiles p where p.id = p_user), 0));
$$;
revoke execute on function public.kennel_level(uuid) from public, anon, authenticated;

-- Already has something of this kind (bought before the ladder).
create or replace function public.kennel_owns_kind(p_user uuid, p_slots text[], p_paid_only boolean default false)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.kennel_purchases pu join public.kennel_items i on i.id = pu.item_id
    where pu.user_id = p_user and i.slot = any (p_slots) and (not p_paid_only or i.cost_bones > 0)
  );
$$;
revoke execute on function public.kennel_owns_kind(uuid, text[], boolean) from public, anon, authenticated;

-- 0157's, with the ladder.
create or replace function public.kennel_item_problem(p_user uuid, p_item public.kennel_items)
returns text
language sql
stable
security definer set search_path = public
as $$
  select case
    when p_item.slot = 'zone' and public.kennel_level(p_user) < 5
      then 'The Porch opens at Tracker (level 5).'
    when p_item.slot = 'porch' and not exists (
      select 1 from public.kennel_purchases pu where pu.user_id = p_user and pu.item_id = 'zone_porch'
    ) then 'Unlock the Porch first.'
    when p_item.slot = 'trick' and public.kennel_level(p_user) < 2
      and not public.kennel_owns_kind(p_user, array['trick'])
      then 'Tricks open at level 2.'
    when p_item.slot in ('neck', 'face', 'body', 'feet') and public.kennel_level(p_user) < 6
      and not public.kennel_owns_kind(p_user, array['neck', 'face', 'body', 'feet'])
      then 'The rest of the wardrobe opens at level 6.'
    when p_item.slot = 'house' and p_item.cost_bones > 0 and public.kennel_level(p_user) < 7
      and not public.kennel_owns_kind(p_user, array['house'], true)
      then 'Bougie houses open at level 7.'
    when p_item.slot = 'room' and public.kennel_level(p_user) < 8
      and not public.kennel_owns_kind(p_user, array['room'])
      then 'The Room opens at level 8.'
  end;
$$;
revoke execute on function public.kennel_item_problem(uuid, public.kennel_items) from public, anon, authenticated;

-- The Garden: planting, from level 3.
create or replace function public.garden_unlock_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if public.kennel_level(new.user_id) < 3
     and not exists (select 1 from public.garden_plantings g where g.user_id = new.user_id) then
    raise exception 'The Garden opens at level 3.';
  end if;
  return new;
end;
$$;
revoke execute on function public.garden_unlock_guard() from public, anon, authenticated;
drop trigger if exists garden_unlock_guard on public.garden_plantings;
create trigger garden_unlock_guard before insert on public.garden_plantings
  for each row execute procedure public.garden_unlock_guard();

-- The Kitchen: baking a treat, from level 4. Baking puts the treat in your
-- own pantry (user_id = made_by, not yet gifted); H-O-R-S-E's stakes (0209)
-- hand one over already gifted, so they don't count as baking.
create or replace function public.kitchen_unlock_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.user_id = new.made_by and new.gifted_at is null
     and public.kennel_level(new.made_by) < 4
     and not exists (select 1 from public.hound_treats t where t.made_by = new.made_by) then
    raise exception 'The Kitchen opens at level 4.';
  end if;
  return new;
end;
$$;
revoke execute on function public.kitchen_unlock_guard() from public, anon, authenticated;
drop trigger if exists kitchen_unlock_guard on public.hound_treats;
create trigger kitchen_unlock_guard before insert on public.hound_treats
  for each row execute procedure public.kitchen_unlock_guard();

-- Gifting a friend something for their yard, from level 9.
create or replace function public.gifting_unlock_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if public.kennel_level(new.from_id) < 9
     and not exists (select 1 from public.kennel_gifts g where g.from_id = new.from_id) then
    raise exception 'Gifting opens at level 9.';
  end if;
  return new;
end;
$$;
revoke execute on function public.gifting_unlock_guard() from public, anon, authenticated;
drop trigger if exists gifting_unlock_guard on public.kennel_gifts;
create trigger gifting_unlock_guard before insert on public.kennel_gifts
  for each row execute procedure public.gifting_unlock_guard();

-- ── Admin ──

create or replace function public.admin_kennel_unlocks_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return (
    with people as (
      select p.id, public.level_for_xp(coalesce(p.xp_total, 0)) as lvl
      from public.profiles p
      where p.last_active_at > now() - interval '30 days'
    ),
    ladder(key, name, lvl) as (values
      ('tricks', 'Tricks', 2), ('garden', 'The Garden', 3), ('kitchen', 'The Kitchen', 4), ('porch', 'The Porch', 5),
      ('wardrobe', 'The whole wardrobe', 6), ('houses', 'Bougie houses', 7), ('room', 'The Room', 8), ('gifting', 'Gifting', 9)
    ),
    uses as (
      select pe.id,
        exists (select 1 from public.kennel_purchases pu join public.kennel_items i on i.id = pu.item_id where pu.user_id = pe.id and i.slot = 'trick') as tricks,
        exists (select 1 from public.garden_plantings g where g.user_id = pe.id) as garden,
        exists (select 1 from public.hound_treats t where t.made_by = pe.id) as kitchen,
        exists (select 1 from public.kennel_purchases pu where pu.user_id = pe.id and pu.item_id = 'zone_porch') as porch,
        exists (select 1 from public.kennel_purchases pu join public.kennel_items i on i.id = pu.item_id where pu.user_id = pe.id and i.slot in ('neck', 'face', 'body', 'feet')) as wardrobe,
        exists (select 1 from public.kennel_purchases pu join public.kennel_items i on i.id = pu.item_id where pu.user_id = pe.id and i.slot = 'house' and i.cost_bones > 0) as houses,
        exists (select 1 from public.kennel_purchases pu join public.kennel_items i on i.id = pu.item_id where pu.user_id = pe.id and i.slot = 'room') as room,
        exists (select 1 from public.kennel_gifts g where g.from_id = pe.id) as gifting
      from people pe
    )
    select jsonb_build_object(
      'active_30d', (select count(*) from people),
      'just_starting', (select count(*) from people where lvl < 2),
      'unlocks', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'key', l.key, 'name', l.name, 'level', l.lvl,
          'reached', (select count(*) from people pe where pe.lvl >= l.lvl),
          'using', (select count(*) from uses u where case l.key
              when 'tricks' then u.tricks when 'garden' then u.garden when 'kitchen' then u.kitchen
              when 'porch' then u.porch when 'wardrobe' then u.wardrobe when 'houses' then u.houses
              when 'room' then u.room else u.gifting end)
        ) order by l.lvl), '[]'::jsonb)
        from ladder l
      )
    )
  );
end;
$$;
revoke execute on function public.admin_kennel_unlocks_overview() from public, anon;
grant execute on function public.admin_kennel_unlocks_overview() to authenticated;
