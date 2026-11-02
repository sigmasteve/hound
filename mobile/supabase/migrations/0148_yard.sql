-- Hound: the Yard. Your hound's backyard, on the Kennel screen: a
-- doghouse, a bed, a bowl, a toy and more, each in its own fixed spot,
-- and a row of trophies from challenges you've won. Friends can look
-- around each other's yards.
--
--   Yard items are kennel_items with a yard slot, bought with Bones
--   through buy_kennel_item like any other (kept for good). Each slot
--   has one free item, which is what a spot shows until you change it,
--   so a new spot is never empty. Plants go in either plant spot.
--
--   The yard grows with your rank (level_for_xp, as the app's ranks):
--
--     size  rank     spots                                     trophies
--     0     Pup      house, bed, bowl, toy                         1
--     1     Tracker  + left plant, ground                          2
--     2     Hunter   + right plant, fence                          3
--     3     Alpha    + tree                                        4
--     4     Legend   + pond                                        5
--
--   Nothing is lost going down a size (it can't happen: XP only
--   grows), and a spot keeps what you put in it.
--
--   Trophies can't be bought: they're your challenge wins, read from
--   activity_events (0058's ledger), one kind of trophy per kind of
--   challenge with how many times you've won it:
--     steps, houndopoly   first place (50 points), against someone
--     soccer, rally, cricket, tictacgo   on the winning side (35)
--     bingo               first BINGO or a blackout (35 or more)
--     streak              survived every day (40)
--     journey             finished the course
--   kennel_yards.trophies is the ones you chose to show, newest wins
--   first when you haven't chosen.
--
-- Run this once, after 0001-0147, in the SQL Editor, before publishing
-- the app update that goes with it.

alter table public.kennel_items drop constraint if exists kennel_items_slot_check;
alter table public.kennel_items add constraint kennel_items_slot_check check (
  slot in ('neck', 'head', 'face', 'coat', 'breed', 'house', 'bed', 'bowl', 'toy', 'plant', 'fence', 'ground', 'tree', 'pond')
);

-- src/kennel/yardItems.ts mirrors these (and draws them).
insert into public.kennel_items (id, slot, name, cost_bones) values
  ('house_classic', 'house', 'Hound House', 0),
  ('house_barn', 'house', 'Red Barn', 120),
  ('house_cabin', 'house', 'Log Cabin', 200),
  ('bed_cushion', 'bed', 'Cushion', 0),
  ('bed_donut', 'bed', 'Donut Bed', 60),
  ('bed_hammock', 'bed', 'Hammock', 150),
  ('bowl_classic', 'bowl', 'Hound Bowl', 0),
  ('bowl_gold', 'bowl', 'Gold Bowl', 100),
  ('toy_ball', 'toy', 'Tennis Ball', 0),
  ('toy_rope', 'toy', 'Rope Toy', 40),
  ('toy_duck', 'toy', 'Rubber Duck', 60),
  ('plant_fern', 'plant', 'Fern', 0),
  ('plant_sunflower', 'plant', 'Sunflower', 40),
  ('plant_cactus', 'plant', 'Cactus', 60),
  ('fence_plain', 'fence', 'Plain Fence', 0),
  ('fence_bunting', 'fence', 'Bunting', 50),
  ('fence_lights', 'fence', 'String Lights', 90),
  ('ground_grass', 'ground', 'Just Grass', 0),
  ('ground_stones', 'ground', 'Stepping Stones', 40),
  ('ground_flowers', 'ground', 'Flower Bed', 80),
  ('tree_oak', 'tree', 'Oak', 0),
  ('tree_cherry', 'tree', 'Cherry Blossom', 150),
  ('pond_lily', 'pond', 'Lily Pond', 0),
  ('pond_fountain', 'pond', 'Fountain', 200)
on conflict (id) do nothing;

-- One row per yard, made on the first change. A null spot shows its
-- slot's free item.
create table public.kennel_yards (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  house_id text references public.kennel_items (id),
  bed_id text references public.kennel_items (id),
  bowl_id text references public.kennel_items (id),
  toy_id text references public.kennel_items (id),
  plant_left_id text references public.kennel_items (id),
  plant_right_id text references public.kennel_items (id),
  fence_id text references public.kennel_items (id),
  ground_id text references public.kennel_items (id),
  tree_id text references public.kennel_items (id),
  pond_id text references public.kennel_items (id),
  -- Trophy kinds to show, in order; null for newest wins first.
  trophies text[],
  updated_at timestamptz not null default now()
);

alter table public.kennel_yards enable row level security;

create policy "Users can view their own yard"
  on public.kennel_yards for select to authenticated
  using (user_id = auth.uid());

revoke all on public.kennel_yards from anon;
revoke insert, update, delete on public.kennel_yards from authenticated;

-- 0 (Pup) to 4 (Legend), from XP, the way src/challenges/ranks.ts does.
create or replace function public.yard_size(p_xp int)
returns int
language sql
immutable
as $$
  select case
    when public.level_for_xp(coalesce(p_xp, 0)) >= 20 then 4
    when public.level_for_xp(coalesce(p_xp, 0)) >= 15 then 3
    when public.level_for_xp(coalesce(p_xp, 0)) >= 10 then 2
    when public.level_for_xp(coalesce(p_xp, 0)) >= 5 then 1
    else 0
  end;
$$;

revoke execute on function public.yard_size(int) from public, anon, authenticated;

-- The spots a yard of this size has, in the order the app lists them.
create or replace function public.yard_spots(p_size int)
returns text[]
language sql
immutable
as $$
  select array['house', 'bed', 'bowl', 'toy']
    || case when p_size >= 1 then array['plant_left', 'ground'] else '{}'::text[] end
    || case when p_size >= 2 then array['plant_right', 'fence'] else '{}'::text[] end
    || case when p_size >= 3 then array['tree'] else '{}'::text[] end
    || case when p_size >= 4 then array['pond'] else '{}'::text[] end;
$$;

revoke execute on function public.yard_spots(int) from public, anon, authenticated;

-- The item slot a spot takes: both plant spots take plants.
create or replace function public.yard_spot_slot(p_spot text)
returns text
language sql
immutable
as $$
  select case when p_spot in ('plant_left', 'plant_right') then 'plant' else p_spot end;
$$;

revoke execute on function public.yard_spot_slot(text) from public, anon, authenticated;

-- Your challenge wins, one row per kind of trophy, newest first.
create or replace function public.yard_trophies(p_user uuid)
returns table (kind text, wins integer, last_won timestamptz)
language sql
stable
security definer set search_path = public
as $$
  with won as (
    select e.created_at,
      case e.kind
        when 'steps_result' then 'steps'
        when 'houndopoly_result' then 'houndopoly'
        when 'soccer_result' then 'soccer'
        when 'rally_result' then 'rally'
        when 'cricket_result' then 'cricket'
        when 'tictacgo_result' then 'tictacgo'
        when 'bingo_result' then 'bingo'
        when 'streak_result' then 'streak'
        when 'journey_result' then 'journey'
      end as trophy
    from public.activity_events e
    where e.user_id = p_user
      and (
        (e.kind in ('steps_result', 'houndopoly_result') and e.score_points >= 50
          and exists (
            select 1 from public.activity_events o
            where o.challenge_id = e.challenge_id and o.kind = e.kind and o.user_id <> p_user
          ))
        or (e.kind in ('soccer_result', 'rally_result', 'cricket_result', 'tictacgo_result') and e.score_points = 35)
        or (e.kind = 'bingo_result' and e.score_points >= 35)
        or (e.kind = 'streak_result' and e.score_points = 40)
        or (e.kind = 'journey_result' and exists (
          select 1 from public.challenges c
          where c.id = e.challenge_id
            and c.distance_goal_mi is not null
            and (select coalesce(sum(ps.distance_mi), 0) from public.progress_snapshots ps
                 where ps.challenge_id = e.challenge_id and ps.user_id = p_user) >= c.distance_goal_mi
        ))
      )
  )
  select trophy, count(*)::integer, max(created_at)
  from won
  group by trophy
  order by max(created_at) desc, trophy;
$$;

revoke execute on function public.yard_trophies(uuid) from public, anon, authenticated;

-- Everything the app draws a yard from:
--   { size, spots: { spot: item id, ... }, trophies: [{ kind, wins,
--     last_won }], shown: [kind, ...] }
-- Only the spots the yard has are in spots, each with its item or the
-- slot's free one.
create or replace function public.yard_view(p_user uuid)
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

  -- The chosen ones you still have (all of them, always), else the newest.
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

  return jsonb_build_object('size', sz, 'spots', spots, 'trophies', won, 'shown', to_jsonb(shown));
end;
$$;

revoke execute on function public.yard_view(uuid) from public, anon, authenticated;

create or replace function public.my_yard(p_local_date date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  return public.yard_view(public.kennel_caller(p_local_date));
end;
$$;

revoke execute on function public.my_yard(date) from public, anon;
grant execute on function public.my_yard(date) to authenticated;

-- A friend's yard, to look around (friends only, like friend_kennel).
create or replace function public.friend_yard(p_friend uuid, p_local_date date)
returns jsonb
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
    raise exception 'Only friends can visit each other''s yards.';
  end if;
  return public.yard_view(p_friend);
end;
$$;

revoke execute on function public.friend_yard(uuid, date) from public, anon;
grant execute on function public.friend_yard(uuid, date) to authenticated;

-- Puts an item you have (or a free one) in a spot your yard has; null
-- puts the free one back.
create or replace function public.place_yard_item(p_local_date date, p_spot text, p_item_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
  sz int;
  item public.kennel_items;
begin
  if p_spot is null or p_spot not in ('house', 'bed', 'bowl', 'toy', 'plant_left', 'plant_right', 'fence', 'ground', 'tree', 'pond') then
    raise exception 'Unknown spot.';
  end if;
  select public.yard_size(p.xp_total) into sz from public.profiles p where p.id = me;
  if not (p_spot = any (public.yard_spots(coalesce(sz, 0)))) then
    raise exception 'That spot opens up when your hound ranks up.';
  end if;
  if p_item_id is not null then
    select * into item from public.kennel_items i where i.id = p_item_id;
    if not found or item.slot <> public.yard_spot_slot(p_spot) then
      raise exception 'That doesn''t go there.';
    end if;
    if item.cost_bones > 0 and not exists (
      select 1 from public.kennel_purchases pu where pu.user_id = me and pu.item_id = p_item_id
    ) then
      raise exception 'You don''t have that yet.';
    end if;
  end if;
  insert into public.kennel_yards (user_id) values (me) on conflict (user_id) do nothing;
  update public.kennel_yards y
    set house_id = case when p_spot = 'house' then p_item_id else y.house_id end,
        bed_id = case when p_spot = 'bed' then p_item_id else y.bed_id end,
        bowl_id = case when p_spot = 'bowl' then p_item_id else y.bowl_id end,
        toy_id = case when p_spot = 'toy' then p_item_id else y.toy_id end,
        plant_left_id = case when p_spot = 'plant_left' then p_item_id else y.plant_left_id end,
        plant_right_id = case when p_spot = 'plant_right' then p_item_id else y.plant_right_id end,
        fence_id = case when p_spot = 'fence' then p_item_id else y.fence_id end,
        ground_id = case when p_spot = 'ground' then p_item_id else y.ground_id end,
        tree_id = case when p_spot = 'tree' then p_item_id else y.tree_id end,
        pond_id = case when p_spot = 'pond' then p_item_id else y.pond_id end,
        updated_at = now()
    where y.user_id = me;
end;
$$;

revoke execute on function public.place_yard_item(date, text, text) from public, anon;
grant execute on function public.place_yard_item(date, text, text) to authenticated;

-- Which trophies stand in the yard, in order; null for newest first.
create or replace function public.set_yard_trophies(p_local_date date, p_kinds text[])
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
  sz int;
begin
  if p_kinds is not null then
    select public.yard_size(p.xp_total) into sz from public.profiles p where p.id = me;
    if cardinality(p_kinds) > coalesce(sz, 0) + 1 then
      raise exception 'Your yard has room for % trophies.', coalesce(sz, 0) + 1;
    end if;
    if (select count(distinct k) from unnest(p_kinds) k) <> cardinality(p_kinds) then
      raise exception 'Each trophy goes up once.';
    end if;
    if exists (
      select 1 from unnest(p_kinds) k
      where k is null or not exists (select 1 from public.yard_trophies(me) t where t.kind = k)
    ) then
      raise exception 'Win one of those first.';
    end if;
  end if;
  insert into public.kennel_yards (user_id, trophies) values (me, p_kinds)
  on conflict (user_id) do update set trophies = excluded.trophies, updated_at = now();
end;
$$;

revoke execute on function public.set_yard_trophies(date, text[]) from public, anon;
grant execute on function public.set_yard_trophies(date, text[]) to authenticated;

-- Undo, if needed:
--   drop function public.set_yard_trophies(date, text[]);
--   drop function public.place_yard_item(date, text, text);
--   drop function public.friend_yard(uuid, date);
--   drop function public.my_yard(date);
--   drop function public.yard_view(uuid);
--   drop function public.yard_trophies(uuid);
--   drop function public.yard_spot_slot(text);
--   drop function public.yard_spots(int);
--   drop function public.yard_size(int);
--   drop table public.kennel_yards;
--   delete from public.kennel_purchases where item_id in (select id from public.kennel_items where slot in ('house', 'bed', 'bowl', 'toy', 'plant', 'fence', 'ground', 'tree', 'pond'));
--   delete from public.kennel_items where slot in ('house', 'bed', 'bowl', 'toy', 'plant', 'fence', 'ground', 'tree', 'pond');
