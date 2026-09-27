-- Hound: cosmetics — Phase 2 of the gamification workshop (see GitHub
-- discussion). The first equippable slot: an avatar frame (a colored
-- ring) and a background style (a gradient instead of the flat tint),
-- both unlocked purely by reaching a level — no currency yet (that's
-- Phase 3's shop). See src/cosmetics/catalog.ts for the same 10 items
-- mirrored as plain TS data for rendering — kept in sync with this
-- table's own seed rows by hand, same "two lists, no generator" shape
-- bingo.ts's own BINGO_CATEGORIES already keeps in sync with its check
-- constraint.
--
-- unlock_xp is stored directly (not a level number) so nothing here
-- needs to duplicate leveling.ts's own xpForLevel formula in SQL — the
-- level shown in each row's comment is just for a human reading this
-- file; the actual gate is always the stored XP number.
--
-- This is entirely additive: one new table and two new nullable
-- profiles columns. Nothing existing is touched.
--
-- Run this once, in the SQL Editor.

create table public.cosmetic_items (
  id text primary key,
  slot text not null check (slot in ('frame', 'background')),
  name text not null,
  unlock_xp int not null
);

alter table public.cosmetic_items enable row level security;

create policy "Anyone signed in can browse the cosmetics catalog"
  on public.cosmetic_items for select
  to authenticated
  using (true);

insert into public.cosmetic_items (id, slot, name, unlock_xp) values
  ('frame_bronze', 'frame', 'Bronze Ring', 450),      -- level 3
  ('frame_silver', 'frame', 'Silver Ring', 2450),     -- level 7
  ('frame_gold', 'frame', 'Gold Ring', 7200),         -- level 12
  ('frame_glow', 'frame', 'Accent Glow', 16200),      -- level 18
  ('frame_diamond', 'frame', 'Diamond Ring', 31250),  -- level 25
  ('bg_sunset', 'background', 'Sunset', 1250),        -- level 5
  ('bg_ocean', 'background', 'Ocean', 5000),          -- level 10
  ('bg_forest', 'background', 'Forest', 11250),       -- level 15
  ('bg_aurora', 'background', 'Aurora', 20000),       -- level 20
  ('bg_midnight', 'background', 'Midnight', 45000);   -- level 30

-- Null means today's exact plain look (initials on a flat tint) — same
-- "null is the old-only meaning" convention distance_goal_unit and
-- bingo_card_type already use, so every existing account reads as
-- "nothing equipped" with no backfill needed.
alter table public.profiles
  add column equipped_frame_id text references public.cosmetic_items (id),
  add column equipped_background_id text references public.cosmetic_items (id);

-- profiles already denies UPDATE to everyone but a fixed column list
-- (0043_fix_profiles_column_revokes.sql's own real fix) — these two new
-- columns are deliberately NOT added to that grant. Equipping goes
-- through this function instead, so the unlock check (item.unlock_xp
-- against the caller's own real xp_total) can't be skipped by a direct
-- client update the way it could if these were just granted columns.
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
  if p_slot not in ('frame', 'background') then
    raise exception 'Unknown cosmetic slot.';
  end if;

  -- A null item id un-equips that slot — always allowed, no unlock to
  -- check for going back to the plain default look.
  if p_item_id is not null then
    select * into item from public.cosmetic_items where id = p_item_id and slot = p_slot;
    if not found then
      raise exception 'That item doesn''t exist for this slot.';
    end if;

    select xp_total into my_xp from public.profiles where id = caller;
    if coalesce(my_xp, 0) < item.unlock_xp then
      raise exception 'You haven''t unlocked that yet.';
    end if;
  end if;

  if p_slot = 'frame' then
    update public.profiles set equipped_frame_id = p_item_id where id = caller;
  else
    update public.profiles set equipped_background_id = p_item_id where id = caller;
  end if;
end;
$$;

grant execute on function public.equip_cosmetic(text, text) to authenticated;
