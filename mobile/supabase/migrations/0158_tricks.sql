-- Hound: tricks (the "Hound shop: design" doc, Steve's go on decision 7).
--
-- Four tricks, bought once with Bones like any other item: High Five
-- (200), Spin (200), Roll Over (250) and Play Dead (300). The app does
-- the rest: a double-tap on the hound in the Yard does the next one you
-- own. buy_kennel_item needs no change. admin_shop_overview adds how
-- many tricks were bought and by how many people. Tricks can be gifts.
--
-- Run this once, after 0001-0157, in the SQL Editor, before publishing
-- the app update that goes with it.

alter table public.kennel_items drop constraint if exists kennel_items_slot_check;
alter table public.kennel_items add constraint kennel_items_slot_check check (
  slot in ('neck', 'head', 'face', 'coat', 'breed', 'body', 'feet', 'house', 'bed', 'bowl', 'toy', 'plant', 'fence', 'ground', 'tree', 'pond', 'zone', 'porch', 'trick')
);

-- src/kennel/tricks.ts mirrors these.
insert into public.kennel_items (id, slot, name, cost_bones) values
  ('trick_highfive', 'trick', 'High Five', 200),
  ('trick_spin', 'trick', 'Spin', 200),
  ('trick_rollover', 'trick', 'Roll Over', 250),
  ('trick_playdead', 'trick', 'Play Dead', 300)
on conflict (id) do nothing;

-- 0157's Admin → Shop, with tricks.
create or replace function public.admin_shop_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  with packs as (
    select b.user_id, b.product_id, b.created_at,
      case b.product_id when 'bones_pack_small' then 1.99 when 'bones_pack_medium' then 4.99
        when 'bones_pack_large' then 9.99 else 0 end as usd
    from public.bones_purchases b
    where b.status = 'credited'
  ),
  firsts as (
    select p.user_id, min(p.created_at) as first_at from packs p group by p.user_id
  ),
  spent as (
    select pu.item_id, i.name, i.slot, pu.bones, pu.purchased_at, i.available_until
    from public.kennel_purchases pu
    join public.kennel_items i on i.id = pu.item_id
    where pu.bones > 0
  )
  select jsonb_build_object(
    'revenue_7d', (select coalesce(sum(usd), 0) from packs where created_at > now() - interval '7 days'),
    'revenue_30d', (select coalesce(sum(usd), 0) from packs where created_at > now() - interval '30 days'),
    'revenue_all', (select coalesce(sum(usd), 0) from packs),
    'buyers_30d', (select count(distinct user_id) from packs where created_at > now() - interval '30 days'),
    'buyers_all', (select count(distinct user_id) from packs),
    'first_buyers_30d', (select count(*) from firsts where first_at > now() - interval '30 days'),
    'packs_30d', jsonb_build_object(
      'small', (select count(*) from packs where product_id = 'bones_pack_small' and created_at > now() - interval '30 days'),
      'medium', (select count(*) from packs where product_id = 'bones_pack_medium' and created_at > now() - interval '30 days'),
      'large', (select count(*) from packs where product_id = 'bones_pack_large' and created_at > now() - interval '30 days')
    ),
    'spent_30d', jsonb_build_object(
      'clothes', (select coalesce(sum(bones), 0) from spent
        where slot in ('neck', 'head', 'face', 'body', 'feet') and purchased_at > now() - interval '30 days'),
      'coats_breeds', (select coalesce(sum(bones), 0) from spent
        where slot in ('coat', 'breed') and purchased_at > now() - interval '30 days'),
      'yard', (select coalesce(sum(bones), 0) from spent
        where slot not in ('neck', 'head', 'face', 'body', 'feet', 'coat', 'breed') and purchased_at > now() - interval '30 days'),
      'limited', (select coalesce(sum(bones), 0) from spent
        where available_until is not null and purchased_at > now() - interval '30 days')
    ),
    'top_items_30d', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'sold', t.sold, 'bones', t.bones) order by t.sold desc, t.bones desc)
      from (
        select name, count(*) as sold, sum(bones) as bones
        from spent where purchased_at > now() - interval '30 days'
        group by name order by count(*) desc, sum(bones) desc limit 10
      ) t
    ), '[]'::jsonb),
    'wearing_body', (select count(*) from public.kennels k where k.body_id is not null),
    'wearing_feet', (select count(*) from public.kennels k where k.feet_id is not null),
    'clothes_buyers', (select count(distinct pu.user_id) from public.kennel_purchases pu
      join public.kennel_items i on i.id = pu.item_id where i.slot in ('body', 'feet')),
    -- 0157: the Porch, the bougie houses, and gifts.
    'porch_unlocks', (select count(*) from public.kennel_purchases pu where pu.item_id = 'zone_porch'),
    'hot_tubs', (select count(*) from public.kennel_purchases pu where pu.item_id = 'porch_hottub'),
    'bougie_houses', (select count(*) from public.kennel_purchases pu
      where pu.item_id in ('house_bungalow', 'house_glass', 'house_treehouse', 'house_castle', 'house_mansion')),
    'gifts_30d', (select count(*) from public.kennel_gifts g where g.created_at > now() - interval '30 days'),
    'gift_bones_30d', (select coalesce(sum(g.bones), 0) from public.kennel_gifts g where g.created_at > now() - interval '30 days'),
    'gifters_30d', (select count(distinct g.from_id) from public.kennel_gifts g where g.created_at > now() - interval '30 days'),
    -- 0158: tricks.
    'tricks_bought', (select count(*) from public.kennel_purchases pu
      join public.kennel_items i on i.id = pu.item_id where i.slot = 'trick'),
    'trick_owners', (select count(distinct pu.user_id) from public.kennel_purchases pu
      join public.kennel_items i on i.id = pu.item_id where i.slot = 'trick')
  ) into result;

  return result;
end;
$$;

revoke execute on function public.admin_shop_overview() from public, anon;
grant execute on function public.admin_shop_overview() to authenticated;
