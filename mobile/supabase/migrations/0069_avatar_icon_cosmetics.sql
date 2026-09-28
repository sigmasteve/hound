-- Hound: a third equippable slot — an avatar icon, replacing the
-- plain initials with a picked glyph (a paw print, an animal, etc.).
-- Requested directly as "more personalization" alongside real-money
-- Bones purchases: a curated icon set fits the existing cosmetics
-- economy (level-unlocked or Bones-shop, exactly like frame/background)
-- with no new infra, unlike letting someone upload their own photo —
-- that's deliberately out of scope here (needs storage + moderation,
-- tracked separately) and this migration doesn't touch it.
--
-- Same shape as 0059_cosmetics.sql/0060_bones_shop.sql throughout: icon
-- ids/names/thresholds mirrored by hand in src/cosmetics/catalog.ts,
-- equip_cosmetic re-supplied whole (not just its new branch — Postgres
-- create-or-replace needs the full body every time a branch is added,
-- same note 0060's own copy of this function left for the next one).
--
-- This is entirely additive: the slot check constraint gains one more
-- allowed value, five new leveled rows and three new shop rows in the
-- existing cosmetic_items table, one new nullable profiles column, and
-- equip_cosmetic's replacement is strictly additive — every existing
-- frame/background branch is byte-for-byte unchanged.
--
-- Run this once, after 0001-0068, in the SQL Editor.

alter table public.cosmetic_items drop constraint if exists cosmetic_items_slot_check;
alter table public.cosmetic_items add constraint cosmetic_items_slot_check
  check (slot in ('frame', 'background', 'icon'));

insert into public.cosmetic_items (id, slot, name, unlock_xp) values
  ('icon_paw', 'icon', 'Paw Print', 800),      -- level 4
  ('icon_dog', 'icon', 'Dog', 4050),           -- level 9
  ('icon_cat', 'icon', 'Cat', 9800),           -- level 14
  ('icon_rabbit', 'icon', 'Rabbit', 20000),    -- level 20
  ('icon_fire', 'icon', 'Fire', 36450);        -- level 27

insert into public.cosmetic_items (id, slot, name, cost_bones) values
  ('icon_robot', 'icon', 'Robot', 300),
  ('icon_rocket', 'icon', 'Rocket', 550),
  ('icon_crown', 'icon', 'Crown', 800);

-- Null means today's exact plain look (initials, same as
-- equipped_frame_id/equipped_background_id's own null meaning) — every
-- existing account reads as "no icon equipped," no backfill needed.
alter table public.profiles
  add column equipped_icon_id text references public.cosmetic_items (id);

-- Same signature and null-un-equips-always shape as 0060's own copy —
-- the only change is accepting 'icon' as a third slot and updating the
-- matching profiles column.
create or replace function public.equip_cosmetic(p_slot text, p_item_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  item public.cosmetic_items%rowtype;
  my_xp int;
begin
  if p_slot not in ('frame', 'background', 'icon') then
    raise exception 'Unknown cosmetic slot.';
  end if;

  if p_item_id is not null then
    select * into item from public.cosmetic_items where id = p_item_id and slot = p_slot;
    if not found then
      raise exception 'That item doesn''t exist for this slot.';
    end if;

    if item.unlock_xp is not null then
      select xp_total into my_xp from public.profiles where id = caller;
      if coalesce(my_xp, 0) < item.unlock_xp then
        raise exception 'You haven''t unlocked that yet.';
      end if;
    else
      if not exists (select 1 from public.cosmetic_purchases where user_id = caller and item_id = p_item_id) then
        raise exception 'You need to buy that first.';
      end if;
    end if;
  end if;

  if p_slot = 'frame' then
    update public.profiles set equipped_frame_id = p_item_id where id = caller;
  elsif p_slot = 'background' then
    update public.profiles set equipped_background_id = p_item_id where id = caller;
  else
    update public.profiles set equipped_icon_id = p_item_id where id = caller;
  end if;
end;
$$;

grant execute on function public.equip_cosmetic(text, text) to authenticated;
