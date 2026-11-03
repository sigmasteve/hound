-- Hound shop, phase 2 (the "Hound shop: design" doc).
--
-- The bougie houses: Beach Bungalow (800), Modern Glass House (900),
-- Treehouse (1,000), Castle (1,500) and Doghouse Mansion (2,500), for the
-- Yard's house spot like any other house.
--
-- The Porch (#476): a second zone you swipe to from the Yard, unlocked
-- for 1,500 Bones at Hunter (level 10) and up, holding what doesn't fit
-- in the backyard: the Hot Tub (1,200), Lounge Chair (300), Porch Swing
-- (350), Fire Pit (400), Patio Umbrella (200) and Grill (250). Each has
-- its own place on the porch, so owning one puts it there. Porch items
-- can only be bought once the Porch is yours. yard_view gains 'porch':
-- the items on it, or null before it's unlocked (friends see it too).
--
-- Gifts: buy an item with your Bones for a friend, with a short note.
-- kennel_gifts keeps them; the friend gets it straight away, a push, and
-- the note when they next open Hound (my_new_gifts). Not the Porch itself
-- (it needs Hunter), not something they already have, up to 10 a day.
--
-- admin_shop_overview adds Porch unlocks, hot tubs, bougie houses and
-- gifts.
--
-- Run this once, after 0001-0156, in the SQL Editor, and deploy
-- send-social-push (its new 'gift' kind), before publishing the app
-- update that goes with it.

alter table public.kennel_items drop constraint if exists kennel_items_slot_check;
alter table public.kennel_items add constraint kennel_items_slot_check check (
  slot in ('neck', 'head', 'face', 'coat', 'breed', 'body', 'feet', 'house', 'bed', 'bowl', 'toy', 'plant', 'fence', 'ground', 'tree', 'pond', 'zone', 'porch')
);

-- src/kennel/yardItems.ts mirrors these (and draws them).
insert into public.kennel_items (id, slot, name, cost_bones) values
  ('house_bungalow', 'house', 'Beach Bungalow', 800),
  ('house_glass', 'house', 'Modern Glass House', 900),
  ('house_treehouse', 'house', 'Treehouse', 1000),
  ('house_castle', 'house', 'Castle', 1500),
  ('house_mansion', 'house', 'Doghouse Mansion', 2500),
  ('zone_porch', 'zone', 'The Porch', 1500),
  ('porch_hottub', 'porch', 'Hot Tub', 1200),
  ('porch_lounge', 'porch', 'Lounge Chair', 300),
  ('porch_swing', 'porch', 'Porch Swing', 350),
  ('porch_firepit', 'porch', 'Fire Pit', 400),
  ('porch_umbrella', 'porch', 'Patio Umbrella', 200),
  ('porch_grill', 'porch', 'Grill', 250)
on conflict (id) do nothing;

-- Why this person can't have this item yet, or null: the Porch needs
-- Hunter, and porch items need the Porch.
create or replace function public.kennel_item_problem(p_user uuid, p_item public.kennel_items)
returns text
language sql
stable
security definer set search_path = public
as $$
  select case
    when p_item.slot = 'zone' and public.level_for_xp(coalesce((select p.xp_total from public.profiles p where p.id = p_user), 0)) < 10
      then 'The Porch opens at Hunter (level 10).'
    when p_item.slot = 'porch' and not exists (
      select 1 from public.kennel_purchases pu where pu.user_id = p_user and pu.item_id = 'zone_porch'
    ) then 'Unlock the Porch first.'
  end;
$$;

revoke execute on function public.kennel_item_problem(uuid, public.kennel_items) from public, anon, authenticated;

-- 0112's, with kennel_item_problem.
create or replace function public.buy_kennel_item(p_local_date date, p_item_id text)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
  item public.kennel_items;
  balance integer;
  problem text;
begin
  select * into item from public.kennel_items i where i.id = p_item_id;
  if not found then
    raise exception 'That item doesn''t exist.';
  end if;
  if item.available_until is not null and p_local_date > item.available_until then
    raise exception 'That one was only around for a while, and it''s gone now.';
  end if;
  problem := public.kennel_item_problem(me, item);
  if problem is not null then
    raise exception '%', problem;
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

-- 0156's yard_view, with the Porch.
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
  porch jsonb := null;
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

  -- The Porch (0157): what's on it, once it's been unlocked; null before.
  if exists (select 1 from public.kennel_purchases pu where pu.user_id = p_user and pu.item_id = 'zone_porch') then
    select coalesce(jsonb_agg(pu.item_id order by pu.item_id), '[]'::jsonb) into porch
    from public.kennel_purchases pu
    join public.kennel_items i on i.id = pu.item_id
    where pu.user_id = p_user and i.slot = 'porch';
  end if;

  return jsonb_build_object(
    'size', sz, 'spots', spots, 'trophies', won, 'shown', to_jsonb(shown),
    'pawprints', prints, 'visitors', visitors, 'guest', guest, 'porch', porch
  );
end;
$$;

revoke execute on function public.yard_view(uuid, date, boolean) from public, anon, authenticated;

-- ── Gifts ────────────────────────────────────────────────────────────

create table public.kennel_gifts (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.kennel_items (id),
  note text check (note is null or char_length(note) between 1 and 80),
  bones integer not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);

create index kennel_gifts_to on public.kennel_gifts (to_id, seen_at);

alter table public.kennel_gifts enable row level security;

create policy "Givers and receivers can view their gifts"
  on public.kennel_gifts for select to authenticated
  using (from_id = auth.uid() or to_id = auth.uid());

revoke insert, update, delete on public.kennel_gifts from authenticated;
revoke all on public.kennel_gifts from anon;

-- Buys it for a friend. Returns your balance after.
create or replace function public.gift_kennel_item(p_friend uuid, p_item_id text, p_note text, p_local_date date)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
  item public.kennel_items;
  balance integer;
  note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
  problem text;
begin
  if public.friend_relation(me, p_friend) <> 'friends' then
    raise exception 'You can only send gifts to friends.';
  end if;
  select * into item from public.kennel_items i where i.id = p_item_id;
  if not found or item.cost_bones = 0 or item.slot = 'zone' then
    raise exception 'That can''t be sent as a gift.';
  end if;
  if item.available_until is not null and p_local_date > item.available_until then
    raise exception 'That one was only around for a while, and it''s gone now.';
  end if;
  problem := public.kennel_item_problem(p_friend, item);
  if problem is not null then
    raise exception 'They can''t have that yet: %', lower(left(problem, 1)) || substr(problem, 2);
  end if;
  if exists (select 1 from public.kennel_purchases pu where pu.user_id = p_friend and pu.item_id = p_item_id) then
    raise exception 'They already have that.';
  end if;
  if note is not null then
    if char_length(note) > 80 then
      raise exception 'Keep the note to 80 characters.';
    end if;
    problem := public.community_words_problem(note);
    if problem is not null then
      raise exception '%', problem;
    end if;
  end if;
  if (select count(*) from public.kennel_gifts g where g.from_id = me and g.created_at > now() - interval '1 day') >= 10 then
    raise exception 'That''s 10 gifts today. Send more tomorrow.';
  end if;

  select p.bones_balance into balance from public.profiles p where p.id = me for update;
  if coalesce(balance, 0) < item.cost_bones then
    raise exception 'Not enough Bones.';
  end if;
  update public.profiles p set bones_balance = p.bones_balance - item.cost_bones where p.id = me;
  -- Theirs now. 0 Bones on their row: they didn't spend any; the gift
  -- row has what it cost.
  insert into public.kennel_purchases (user_id, item_id, bones) values (p_friend, p_item_id, 0);
  insert into public.kennel_gifts (from_id, to_id, item_id, note, bones) values (me, p_friend, p_item_id, note, item.cost_bones);

  if public.social_push_reachable(p_friend) then
    perform public.social_notify(jsonb_build_object(
      'kind', 'gift', 'from_user', me, 'to_user', p_friend, 'challenge_id', null,
      'item_name', item.name,
      'hound_name', coalesce((select k.name from public.kennels k where k.user_id = p_friend), 'Scout')
    ));
  end if;
  return balance - item.cost_bones;
end;
$$;

revoke execute on function public.gift_kennel_item(uuid, text, text, date) from public, anon;
grant execute on function public.gift_kennel_item(uuid, text, text, date) to authenticated;

-- Gifts you haven't seen yet, oldest first; marks them seen.
create or replace function public.my_new_gifts()
returns table (id uuid, from_name text, item_id text, item_name text, note text, created_at timestamptz)
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  return query
    with fresh as (
      update public.kennel_gifts g set seen_at = now()
      where g.to_id = auth.uid() and g.seen_at is null
      returning g.id, g.from_id, g.item_id, g.note, g.created_at
    )
    select f.id,
      case when p.use_username and p.username is not null then p.username else p.name end,
      f.item_id, i.name, f.note, f.created_at
    from fresh f
    join public.profiles p on p.id = f.from_id
    join public.kennel_items i on i.id = f.item_id
    order by f.created_at;
end;
$$;

revoke execute on function public.my_new_gifts() from public, anon;
grant execute on function public.my_new_gifts() to authenticated;

-- 0156's Admin → Shop, with the Porch, houses and gifts.
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
    'gifters_30d', (select count(distinct g.from_id) from public.kennel_gifts g where g.created_at > now() - interval '30 days')
  ) into result;

  return result;
end;
$$;

revoke execute on function public.admin_shop_overview() from public, anon;
grant execute on function public.admin_shop_overview() to authenticated;
