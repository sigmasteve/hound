-- Hound: Halloween in the Kennel. Five limited-time items, on sale
-- through October 31; anyone who buys one keeps it for good.
--
--   - kennel_items.available_until: the last day an item can be bought
--     (the member's own date, as every Kennel call already passes it).
--     Null for the everyday items.
--   - buy_kennel_item refuses an item after its last day. Wearing one
--     you already have is unaffected.
--
-- Run this once, after 0001-0111, in the SQL Editor, before publishing
-- the app update that goes with it.

alter table public.kennel_items add column if not exists available_until date;

insert into public.kennel_items (id, slot, name, cost_bones, available_until) values
  ('hat_pumpkin', 'head', 'Pumpkin Hat', 80, '2026-10-31'),
  ('hat_witch', 'head', 'Witch Hat', 120, '2026-10-31'),
  ('bandana_spooky', 'neck', 'Spooky Bandana', 60, '2026-10-31'),
  ('mask_masquerade', 'face', 'Masquerade Mask', 100, '2026-10-31'),
  ('coat_pumpkin', 'coat', 'Pumpkin Spice', 120, '2026-10-31')
on conflict (id) do update set available_until = excluded.available_until;

-- 0104's buy_kennel_item, refusing an item past its last day.
create or replace function public.buy_kennel_item(p_local_date date, p_item_id text)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
  item public.kennel_items;
  balance integer;
begin
  select * into item from public.kennel_items i where i.id = p_item_id;
  if not found then
    raise exception 'That item doesn''t exist.';
  end if;
  if item.available_until is not null and p_local_date > item.available_until then
    raise exception 'That one was only around for a while, and it''s gone now.';
  end if;
  select p.bones_balance into balance from public.profiles p where p.id = me for update;
  if exists (select 1 from public.kennel_purchases pu where pu.user_id = me and pu.item_id = p_item_id) then
    raise exception 'You already have that.';
  end if;
  if coalesce(balance, 0) < item.cost_bones then
    raise exception 'Not enough Bones.';
  end if;
  update public.profiles p set bones_balance = p.bones_balance - item.cost_bones where p.id = me;
  insert into public.kennel_purchases (user_id, item_id, bones) values (me, p_item_id, item.cost_bones);
  return balance - item.cost_bones;
end;
$$;

revoke execute on function public.buy_kennel_item(date, text) from public, anon;
grant execute on function public.buy_kennel_item(date, text) to authenticated;

-- Undo, if needed (the items stay with anyone who bought them):
--   update public.kennel_items set available_until = '2000-01-01' where available_until is not null;
