-- Hound shop, phase 1 (the "Hound shop: design" doc).
--
-- Clothes: two new slots on the hound, body and feet, and 17 items to
-- wear in them (sweaters in three colours, a hoodie, raincoat, puffer
-- vest, tutu, superhero cape, tuxedo and designer trench; booties in four
-- colours, sneakers, rain boots and gold sneakers). Bought with Bones like
-- every other item; buy_kennel_item needs no change.
--
-- The Winter drop starts Nov 15 (the app shows it from then; the server
-- only enforces the last day, as for every limited-time item): a Santa
-- Hat, Reindeer Antlers and a Christmas Sweater for the hound, and an
-- Igloo and a Lit Tree for the Yard, all through Dec 31, with 0149's
-- Gingerbread House, Snowman and Garland.
--
-- kennel_view, my_kennel and friend_kennel return body_id and feet_id,
-- equip_kennel_item takes the two slots, and yard_view puts them on a
-- guest hound. admin_shop_overview() is the Admin → Shop numbers.
--
-- Run this once, after 0001-0155, in the SQL Editor, before publishing
-- the app update that goes with it.

alter table public.kennel_items drop constraint if exists kennel_items_slot_check;
alter table public.kennel_items add constraint kennel_items_slot_check check (
  slot in ('neck', 'head', 'face', 'coat', 'breed', 'body', 'feet', 'house', 'bed', 'bowl', 'toy', 'plant', 'fence', 'ground', 'tree', 'pond')
);

-- src/kennel/kennelItems.ts and yardItems.ts mirror these (and draw them).
insert into public.kennel_items (id, slot, name, cost_bones) values
  ('sweater_red', 'body', 'Red Sweater', 120),
  ('sweater_blue', 'body', 'Blue Sweater', 120),
  ('sweater_green', 'body', 'Green Sweater', 120),
  ('body_hoodie', 'body', 'Hoodie', 150),
  ('body_raincoat', 'body', 'Raincoat', 150),
  ('body_puffer', 'body', 'Puffer Vest', 200),
  ('body_tutu', 'body', 'Tutu', 180),
  ('body_cape', 'body', 'Superhero Cape', 300),
  ('body_tux', 'body', 'Tuxedo', 400),
  ('body_trench', 'body', 'Designer Trench', 800),
  ('booties_red', 'feet', 'Red Booties', 80),
  ('booties_blue', 'feet', 'Blue Booties', 80),
  ('booties_pink', 'feet', 'Pink Booties', 80),
  ('booties_black', 'feet', 'Black Booties', 80),
  ('feet_sneakers', 'feet', 'Sneakers', 120),
  ('feet_rainboots', 'feet', 'Rain Boots', 120),
  ('feet_gold', 'feet', 'Gold Sneakers', 500)
on conflict (id) do nothing;

insert into public.kennel_items (id, slot, name, cost_bones, available_until) values
  ('hat_santa', 'head', 'Santa Hat', 120, '2026-12-31'),
  ('hat_antlers', 'head', 'Reindeer Antlers', 100, '2026-12-31'),
  ('sweater_holiday', 'body', 'Christmas Sweater', 150, '2026-12-31'),
  ('house_igloo', 'house', 'Igloo', 300, '2026-12-31'),
  ('tree_lit', 'tree', 'Lit Tree', 180, '2026-12-31')
on conflict (id) do update set available_until = excluded.available_until;

alter table public.kennels add column if not exists body_id text;
alter table public.kennels add column if not exists feet_id text;

drop function if exists public.my_kennel(date);
drop function if exists public.friend_kennel(uuid, date);
drop function if exists public.kennel_view(uuid, date);

-- 0132's, with body_id and feet_id.
create function public.kennel_view(p_user uuid, p_day date)
returns table (
  name text,
  care_mode text,
  mood text,
  goal_days_7 integer,
  goal_day_today boolean,
  treated_today boolean,
  hearts integer,
  neck_id text,
  head_id text,
  face_id text,
  coat_id text,
  ears text,
  tail text,
  markings text,
  breed_id text,
  body_id text,
  feet_id text
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  k public.kennels;
  days integer;
  today_hit boolean;
  treated boolean;
  h integer;
  score integer;
  m text;
begin
  select * into k from public.kennels x where x.user_id = p_user;
  if not found then
    k.name := 'Scout';
    k.care_mode := 'gentle';
    k.hearts := 3;
    k.ears := 'floppy';
    k.tail := 'wavy';
    k.markings := 'none';
  end if;
  select count(*)::integer into days from public.activity_events e
    where e.user_id = p_user and e.kind = 'goal_day' and e.created_at > now() - interval '7 days';
  today_hit := exists (select 1 from public.goal_streaks g where g.user_id = p_user and g.last_hit_on >= p_day);
  treated := coalesce(k.treated_on >= p_day, false);
  h := public.kennel_hearts(k, p_day);
  score := least(days, 7) + case when treated then 2 else 0 end;
  m := case
    when k.care_mode = 'classic' and h = 0 then 'hungry'
    when today_hit or score >= 4 then 'happy'
    when score >= 2 then 'okay'
    else 'sleepy'
  end;
  return query select
    k.name, k.care_mode, m, least(days, 7), today_hit, treated,
    case when k.care_mode = 'classic' then h end,
    k.neck_id, k.head_id, k.face_id, k.coat_id, k.ears, k.tail, k.markings, k.breed_id, k.body_id, k.feet_id;
end;
$$;

revoke execute on function public.kennel_view(uuid, date) from public, anon, authenticated;

create function public.my_kennel(p_local_date date)
returns table (
  name text,
  care_mode text,
  mood text,
  goal_days_7 integer,
  goal_day_today boolean,
  treated_today boolean,
  hearts integer,
  neck_id text,
  head_id text,
  face_id text,
  coat_id text,
  ears text,
  tail text,
  markings text,
  owned text[],
  xp_total integer,
  bones_balance integer,
  breed_id text,
  body_id text,
  feet_id text
)
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
begin
  return query select
    v.name, v.care_mode, v.mood, v.goal_days_7, v.goal_day_today, v.treated_today, v.hearts,
    v.neck_id, v.head_id, v.face_id, v.coat_id, v.ears, v.tail, v.markings,
    coalesce((select array_agg(pu.item_id order by pu.item_id) from public.kennel_purchases pu where pu.user_id = me), '{}'),
    p.xp_total, p.bones_balance, v.breed_id, v.body_id, v.feet_id
  from public.kennel_view(me, p_local_date) v
  cross join public.profiles p
  where p.id = me;
end;
$$;

revoke execute on function public.my_kennel(date) from public, anon;
grant execute on function public.my_kennel(date) to authenticated;

create function public.friend_kennel(p_friend uuid, p_local_date date)
returns table (
  name text,
  mood text,
  neck_id text,
  head_id text,
  face_id text,
  coat_id text,
  ears text,
  tail text,
  markings text,
  xp_total integer,
  breed_id text,
  body_id text,
  feet_id text
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  utc_today date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  if public.friend_relation(auth.uid(), p_friend) <> 'friends' then
    raise exception 'Only friends can see each other''s hounds.';
  end if;
  return query select v.name, v.mood, v.neck_id, v.head_id, v.face_id, v.coat_id, v.ears, v.tail, v.markings, p.xp_total, v.breed_id, v.body_id, v.feet_id
  from public.kennel_view(p_friend, p_local_date) v
  cross join public.profiles p
  where p.id = p_friend;
end;
$$;

revoke execute on function public.friend_kennel(uuid, date) from public, anon;
grant execute on function public.friend_kennel(uuid, date) to authenticated;

create or replace function public.equip_kennel_item(p_local_date date, p_slot text, p_item_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
begin
  if p_slot not in ('neck', 'head', 'face', 'coat', 'breed', 'body', 'feet') then
    raise exception 'Unknown slot.';
  end if;
  if p_item_id is not null and not exists (
    select 1 from public.kennel_purchases pu
    join public.kennel_items i on i.id = pu.item_id
    where pu.user_id = me and pu.item_id = p_item_id and i.slot = p_slot
  ) then
    raise exception 'You don''t have that yet.';
  end if;
  update public.kennels k
    set neck_id = case when p_slot = 'neck' then p_item_id else k.neck_id end,
        head_id = case when p_slot = 'head' then p_item_id else k.head_id end,
        face_id = case when p_slot = 'face' then p_item_id else k.face_id end,
        coat_id = case when p_slot = 'coat' then p_item_id else k.coat_id end,
        breed_id = case when p_slot = 'breed' then p_item_id else k.breed_id end,
        body_id = case when p_slot = 'body' then p_item_id else k.body_id end,
        feet_id = case when p_slot = 'feet' then p_item_id else k.feet_id end,
        updated_at = now()
    where k.user_id = me;
end;
$$;

revoke execute on function public.equip_kennel_item(date, text, text) from public, anon;
grant execute on function public.equip_kennel_item(date, text, text) to authenticated;

-- 0150's yard_view, with a guest hound's body and feet.
create or replace function public.yard_view(p_user uuid, p_day date, p_private boolean)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  y public.kennel_yards;
  sz int;
  won jsonb;
  shown text[];
  spots jsonb := '{}'::jsonb;
  spot text;
  item text;
  prints int;
  visitors jsonb := '[]'::jsonb;
  guest jsonb := null;
  friend uuid;
  together text;
begin
  select public.yard_size(p.xp_total) into sz from public.profiles p where p.id = p_user;
  sz := coalesce(sz, 0);
  select * into y from public.kennel_yards k where k.user_id = p_user;
  foreach spot in array public.yard_spots(sz) loop
    item := case spot
      when 'house' then y.house_id
      when 'bed' then y.bed_id
      when 'bowl' then y.bowl_id
      when 'toy' then y.toy_id
      when 'plant_left' then y.plant_left_id
      when 'plant_right' then y.plant_right_id
      when 'fence' then y.fence_id
      when 'ground' then y.ground_id
      when 'tree' then y.tree_id
      when 'pond' then y.pond_id
    end;
    if item is null then
      select i.id into item from public.kennel_items i
        where i.slot = public.yard_spot_slot(spot) and i.cost_bones = 0
        order by i.id limit 1;
    end if;
    spots := spots || jsonb_build_object(spot, item);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('kind', t.kind, 'wins', t.wins, 'last_won', t.last_won) order by t.last_won desc, t.kind), '[]'::jsonb)
    into won
    from public.yard_trophies(p_user) t;

  if y.trophies is not null then
    select coalesce(array_agg(k order by o), '{}') into shown
    from unnest(y.trophies) with ordinality as u (k, o)
    where exists (select 1 from jsonb_array_elements(won) w where w ->> 'kind' = u.k)
      and o <= sz + 1;
  else
    select coalesce(array_agg(w ->> 'kind' order by n), '{}') into shown
    from jsonb_array_elements(won) with ordinality as x (w, n)
    where n <= sz + 1;
  end if;

  select count(distinct v.visitor_id)::int into prints
  from public.yard_visits v
  where v.host_id = p_user and v.pawprint and v.updated_at > now() - interval '1 day';

  if p_private then
    select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', x.visitor_id,
        'name', case when p.use_username and p.username is not null then p.username else p.name end,
        'pawprint', x.pawprint,
        'treat', x.treat
      ) order by x.at desc), '[]'::jsonb)
      into visitors
    from (
      select v.visitor_id, bool_or(v.pawprint) as pawprint, bool_or(v.treat) as treat, max(v.updated_at) as at
      from public.yard_visits v
      where v.host_id = p_user and v.updated_at > now() - interval '1 day'
      group by v.visitor_id
    ) x
    join public.profiles p on p.id = x.visitor_id;

    -- A friend's hound over to play: both of you finished your goals
    -- today, in a challenge together that's on now.
    if exists (select 1 from public.goal_streaks g where g.user_id = p_user and g.last_hit_on >= p_day) then
      select f.other, c.name into friend, together
      from (
        select case when fr.requester_id = p_user then fr.recipient_id else fr.requester_id end as other
        from public.friendships fr
        where fr.status = 'accepted' and (fr.requester_id = p_user or fr.recipient_id = p_user)
      ) f
      join public.goal_streaks g on g.user_id = f.other and g.last_hit_on >= p_day
      join lateral (
        select c.name
        from public.challenge_participants a
        join public.challenge_participants b on b.challenge_id = a.challenge_id and b.user_id = f.other
        join public.challenges c on c.id = a.challenge_id
        where a.user_id = p_user and c.starts_at <= now() and c.ends_at > now()
        order by c.ends_at
        limit 1
      ) c on true
      order by md5(f.other::text || p_day::text)
      limit 1;

      if friend is not null then
        select jsonb_build_object(
            'user_id', friend,
            'owner', case when p.use_username and p.username is not null then p.username else p.name end,
            'challenge', together,
            'name', v.name,
            'xp_total', p.xp_total,
            'neck_id', v.neck_id,
            'head_id', v.head_id,
            'face_id', v.face_id,
            'coat_id', v.coat_id,
            'ears', v.ears,
            'tail', v.tail,
            'markings', v.markings,
            'breed_id', v.breed_id,
            'body_id', v.body_id,
            'feet_id', v.feet_id
          )
          into guest
        from public.kennel_view(friend, p_day) v
        cross join public.profiles p
        where p.id = friend;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'size', sz, 'spots', spots, 'trophies', won, 'shown', to_jsonb(shown),
    'pawprints', prints, 'visitors', visitors, 'guest', guest
  );
end;
$$;

revoke execute on function public.yard_view(uuid, date, boolean) from public, anon, authenticated;

-- ── Admin → Shop ─────────────────────────────────────────────────────
-- Packs sold and what they brought in (list prices: $1.99, $4.99, $9.99,
-- before the stores' cut), who buys, and where Bones get spent.
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
      join public.kennel_items i on i.id = pu.item_id where i.slot in ('body', 'feet'))
  ) into result;

  return result;
end;
$$;

revoke execute on function public.admin_shop_overview() from public, anon;
grant execute on function public.admin_shop_overview() to authenticated;
