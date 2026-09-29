-- Hound: the first limited-time cosmetics drop — a Halloween set in the
-- Bones shop, on sale only until Halloween is over.
--
-- A shop item can now carry an optional available_until: after that
-- moment purchase_cosmetic refuses to sell it, but anyone who already
-- bought it keeps it for good — cosmetic_purchases is untouched and
-- equip_cosmetic only ever checks ownership, never the sale window. A
-- null available_until (every item before this migration) means "always
-- on sale," so nothing already in the shop changes.
--
-- The render side (ring colors, gradients, icon glyphs, and the
-- "Halloween" grouping in the Locker's Shop tab) lives only in
-- src/cosmetics/catalog.ts, same split 0059/0060/0069 already use — this
-- only needs to know the price and when the sale ends.
--
-- 2026-11-01 07:00 UTC is midnight at the end of Oct 31 in US Pacific
-- time, so the sale runs through Halloween night for every US time zone.
-- To extend or end it early, update available_until on these rows (and
-- HALLOWEEN_2026's availableUntil in catalog.ts to match the Shop's
-- countdown).
--
-- Entirely additive: one new nullable column, seven new rows, and
-- purchase_cosmetic gains one extra check. Run this once, after
-- 0001-0070, in the SQL Editor.

alter table public.cosmetic_items add column available_until timestamptz;

insert into public.cosmetic_items (id, slot, name, cost_bones, available_until) values
  ('frame_pumpkin', 'frame', 'Pumpkin Ring', 300, '2026-11-01 07:00:00+00'),
  ('frame_slime', 'frame', 'Slime Ring', 450, '2026-11-01 07:00:00+00'),
  ('bg_candy_corn', 'background', 'Candy Corn', 350, '2026-11-01 07:00:00+00'),
  ('bg_haunted', 'background', 'Haunted Night', 600, '2026-11-01 07:00:00+00'),
  ('icon_ghost', 'icon', 'Ghost', 300, '2026-11-01 07:00:00+00'),
  ('icon_broom', 'icon', 'Witch''s Broom', 400, '2026-11-01 07:00:00+00'),
  ('icon_skull', 'icon', 'Skull', 550, '2026-11-01 07:00:00+00');

-- Byte-for-byte 0060_bones_shop.sql's purchase_cosmetic, plus the sale
-- window check right after the "is this a shop item" check.
create or replace function public.purchase_cosmetic(p_item_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  item public.cosmetic_items%rowtype;
  my_balance int;
begin
  select * into item from public.cosmetic_items where id = p_item_id;
  if not found then
    raise exception 'That item doesn''t exist.';
  end if;
  if item.cost_bones is null then
    raise exception 'That item isn''t sold in the shop.';
  end if;
  if item.available_until is not null and now() >= item.available_until then
    raise exception 'That item is no longer for sale.';
  end if;
  if exists (select 1 from public.cosmetic_purchases where user_id = caller and item_id = p_item_id) then
    raise exception 'You already own that.';
  end if;

  select bones_balance into my_balance from public.profiles where id = caller for update;
  if coalesce(my_balance, 0) < item.cost_bones then
    raise exception 'Not enough Bones.';
  end if;

  update public.profiles set bones_balance = bones_balance - item.cost_bones where id = caller;
  insert into public.cosmetic_purchases (user_id, item_id) values (caller, p_item_id);
end;
$$;

-- Signed-in users only — same tightening 0070's claim_daily_bonus got.
-- A signed-out caller could never buy anything anyway (no profile row,
-- so "Not enough Bones"), this just stops it being callable at all.
revoke execute on function public.purchase_cosmetic(text) from public, anon;
grant execute on function public.purchase_cosmetic(text) to authenticated;
